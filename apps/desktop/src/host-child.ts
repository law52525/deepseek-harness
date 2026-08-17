/**
 * Node Host child: spawn `--profile desktop` with stdio IPC, wait for
 * `host-ready`, forward opaque RPC, and dispose SIGTERM then SIGKILL.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { controlEnvelope, controlFromChild, rpcEnvelope, rpcPayloadFromChild, shellEnvelope, shellFromChild } from './forwarder.ts'
import { resolveNodeExecutable } from './node-executable.ts'
import { resolveBundledDshBin } from './packaged-resources.ts'
import type {
  DesktopControlMessage,
  DesktopControlToHost,
  DesktopControlToShell,
  DesktopShellToParent,
  DesktopThemePreference,
  WebBootGraph,
} from '@deepseek-ai/dsh-desktop-app/ipc-protocol'

const HOST_READY_TIMEOUT_MS = 60_000
const DISPOSE_GRACE_MS = 3_000

/** One pending control request keyed by correlation id. */
interface PendingControl {
  resolve: (value: DesktopControlToShell) => void
  reject: (error: Error) => void
}

/** Spawned desktop Host child plus the control/RPC mux. */
export class DesktopHostChild {
  private readonly pending = new Map<string, PendingControl>()
  private readonly rpcHandlers = new Set<(payload: unknown) => void>()
  private readonly exitHandlers = new Set<(error: Error) => void>()
  private readonly ready: Promise<void>
  private readySettled = false
  private disposing = false
  private exitError: Error | undefined

  /**
   * @param child - process spawned with an IPC fd.
   * @param openAuthWindow - generic auth-window opener used by the shell channel.
   */
  constructor(
    private readonly child: ChildProcess,
    private readonly openAuthWindow: AuthWindowOpener = async () => ({ canceled: true }),
  ) {
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('desktop: Host child did not post host-ready'))
      }, HOST_READY_TIMEOUT_MS)
      this.child.on('message', (value: unknown) => {
        const control = controlFromChild(value)
        if (!this.readySettled && control?.type === 'host-ready') {
          this.readySettled = true
          clearTimeout(timer)
          resolve()
          return
        }
        this.dispatch(value)
      })
      this.child.on('exit', (code, signal) => {
        this.exitError = new Error(
          `desktop: Host child exited (code ${String(code)}, signal ${String(signal)})`,
        )
        for (const pending of this.pending.values()) pending.reject(this.exitError)
        this.pending.clear()
        for (const handler of this.exitHandlers) {
          try {
            handler(this.exitError)
          } catch (error) {
            console.error('[desktop] host exit listener threw:', error)
          }
        }
        if (!this.readySettled) {
          this.readySettled = true
          clearTimeout(timer)
          reject(this.exitError)
        }
      })
    })
  }

  /**
   * Wait until the child posts `host-ready` after Loader settle.
   * @returns after the handshake.
   */
  awaitReady(): Promise<void> {
    return this.ready
  }

  /**
   * Exit error once the child has left; undefined while it is alive.
   * @returns the recorded exit error.
   */
  get crash(): Error | undefined {
    return this.exitError
  }

  /**
   * Subscribe to opaque RPC documents from the child.
   * @param handler - receives each RPC payload.
   * @returns unsubscribe function.
   */
  subscribeRpc(handler: (payload: unknown) => void): () => void {
    this.rpcHandlers.add(handler)
    return () => { this.rpcHandlers.delete(handler) }
  }

  /**
   * Subscribe to child exit after construction.
   * @param handler - receives the recorded exit error.
   * @returns unsubscribe function.
   */
  onExit(handler: (error: Error) => void): () => void {
    this.exitHandlers.add(handler)
    if (this.exitError !== undefined) {
      try {
        handler(this.exitError)
      } catch (error) {
        console.error('[desktop] host exit listener threw:', error)
      }
    }
    return () => { this.exitHandlers.delete(handler) }
  }

  /**
   * Forward one opaque RPC document to the child.
   * @param payload - an `IpcMessage` object.
   */
  postRpc(payload: unknown): void {
    this.child.send(rpcEnvelope(payload))
  }

  /**
   * Request the composed client graph and theme preference.
   * @returns graph plus preference.
   */
  async bootGraph(): Promise<{ graph: WebBootGraph; themePreference: DesktopThemePreference }> {
    const response = await this.requestControl({ type: 'boot-graph-request', id: crypto.randomUUID() })
    if (response.type !== 'boot-graph-response') {
      throw new Error(`desktop: unexpected boot-graph reply ${response.type}`)
    }
    return { graph: response.graph, themePreference: response.themePreference }
  }

  /**
   * Read packaged client-bundle bytes for one graph id.
   * @param pluginId - `dsh.client` package id.
   * @returns UTF-8 factory source.
   */
  async readPlugin(pluginId: string): Promise<string> {
    const response = await this.requestControl({
      type: 'plugin-bytes-request',
      id: crypto.randomUUID(),
      pluginId,
    })
    if (response.type === 'plugin-bytes-response') return response.bytes
    if (response.type === 'plugin-bytes-failure') throw new Error(response.message)
    throw new Error(`desktop: unexpected plugin-bytes reply ${response.type}`)
  }

  /**
   * Run Host Session-log export for the `dsh:` protocol handler.
   * @param query - GET or HEAD plus the session.export query.
   * @returns Host status, download headers, and a temp ZIP path for GET bodies.
   */
  async sessionExport(query: {
    method: 'GET' | 'HEAD'
    sessionId: string
    includeDescendants: boolean
  }): Promise<{ status: number; headers: Record<string, string>; bodyPath?: string }> {
    const response = await this.requestControl({
      type: 'session-export-request',
      id: crypto.randomUUID(),
      method: query.method,
      sessionId: query.sessionId,
      includeDescendants: query.includeDescendants,
    })
    if (response.type === 'session-export-response') {
      return {
        status: response.status,
        headers: response.headers,
        ...response.bodyPath === undefined ? {} : { bodyPath: response.bodyPath },
      }
    }
    if (response.type === 'session-export-failure') throw new Error(response.message)
    throw new Error(`desktop: unexpected session-export reply ${response.type}`)
  }

  /**
   * SIGTERM the child, wait, then SIGKILL if it is still alive.
   * @returns after the process has exited.
   */
  async dispose(): Promise<void> {
    if (this.disposing) return
    this.disposing = true
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => {
      this.child.once('exit', () => { resolve() })
    })
    this.child.kill('SIGTERM')
    await Promise.race([
      exited,
      new Promise<void>((resolve) => { setTimeout(resolve, DISPOSE_GRACE_MS) }),
    ])
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGKILL')
      await exited
    }
  }

  private requestControl(payload: DesktopControlToHost): Promise<DesktopControlToShell> {
    if (this.exitError !== undefined) return Promise.reject(this.exitError)
    return new Promise((resolve, reject) => {
      this.pending.set(payload.id, { resolve, reject })
      this.child.send(controlEnvelope(payload))
    })
  }

  private dispatch(value: unknown): void {
    const rpc = rpcPayloadFromChild(value)
    if (rpc !== undefined) {
      for (const handler of this.rpcHandlers) {
        try {
          handler(rpc)
        } catch (error) {
          console.error('[desktop] rpc listener threw:', error)
        }
      }
      return
    }
    const shell = shellFromChild(value)
    if (shell !== undefined) {
      if (shell.type === 'open-auth-window') {
        void this.answerOpenAuthWindow(shell)
      }
      return
    }
    const control = controlFromChild(value)
    if (control === undefined || !isControlReply(control)) {
      return
    }
    const pending = this.pending.get(control.id)
    if (pending === undefined) return
    this.pending.delete(control.id)
    pending.resolve(control)
  }

  private async answerOpenAuthWindow(request: DesktopShellToParent): Promise<void> {
    try {
      const result = await this.openAuthWindow({
        url: request.url,
        callbackUrlPrefix: request.callbackUrlPrefix,
        ...request.width === undefined ? {} : { width: request.width },
        ...request.height === undefined ? {} : { height: request.height },
        ...request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs },
      })
      if ('canceled' in result) {
        this.child.send(shellEnvelope({ type: 'open-auth-window-result', id: request.id, canceled: true }))
        return
      }
      this.child.send(shellEnvelope({
        type: 'open-auth-window-result',
        id: request.id,
        callbackUrl: result.callbackUrl,
      }))
    } catch {
      this.child.send(shellEnvelope({ type: 'open-auth-window-result', id: request.id, canceled: true }))
    }
  }
}

function isControlReply(
  control: DesktopControlMessage,
): control is Extract<DesktopControlToShell, { id: string }> {
  return control.type === 'boot-graph-response'
    || control.type === 'plugin-bytes-response'
    || control.type === 'plugin-bytes-failure'
    || control.type === 'session-export-response'
    || control.type === 'session-export-failure'
}

/**
 * Build argv for the desktop Host child: source `dsh` when present, else the built bin.
 * @param node - system Node executable.
 * @returns argv for `spawn`.
 */
export function hostChildArgv(node: string): { command: string; args: string[] } {
  const bundledBin = resolveBundledDshBin()
  if (bundledBin !== undefined) {
    return { command: node, args: [bundledBin, '--profile', 'desktop'] }
  }
  const require = createRequire(import.meta.url)
  const cliRoot = dirname(require.resolve('@deepseek-ai/dsh/package.json'))
  const srcBin = join(cliRoot, 'src/bin.ts')
  const libBin = join(cliRoot, 'lib/bin.js')
  if (existsSync(srcBin)) {
    return { command: node, args: ['--import', 'tsx/esm', srcBin, '--profile', 'desktop'] }
  }
  if (!existsSync(libBin)) {
    throw new Error('desktop: dsh CLI bin not found; run pnpm run build from the repository root first')
  }
  return { command: node, args: [libBin, '--profile', 'desktop'] }
}

/** Optional spawn overrides for tests that isolate `$DSH_HOME` or intercept native commands. */
export interface SpawnDesktopHostOptions {
  /** Extra environment merged over `process.env`; `ELECTRON_RUN_AS_NODE` is always stripped. */
  env?: NodeJS.ProcessEnv
  /** Child working directory; defaults to the parent's cwd. */
  cwd?: string
  /** Open a generic auth window; Host plugins pass url + callback prefix. */
  openAuthWindow?: AuthWindowOpener
}

/** Caller-supplied BrowserWindow opener; the shell stays free of product URLs. */
export type AuthWindowOpener = (options: {
  url: string
  callbackUrlPrefix: string
  width?: number
  height?: number
  timeoutMs?: number
}) => Promise<{ callbackUrl: string } | { canceled: true }>

/**
 * Environment for the Host child: inherit the parent, apply overrides, drop Electron-as-Node.
 * @param overrides - values that win over `process.env`.
 * @returns the env object passed to `spawn`.
 */
export function hostChildEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/**
 * Spawn options for the Host child. `node.exe` is a console-subsystem binary;
 * `windowsHide: true` sets CREATE_NO_WINDOW. The Win32 `IFileOpenDialog` worker
 * already uses `windowsHide: true` and does not need a Host console.
 * @param options - test isolation (`env`, `cwd`); production callers pass nothing.
 * @returns options passed to `spawn`.
 */
export function hostChildSpawnOptions(options: SpawnDesktopHostOptions = {}): {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  env: NodeJS.ProcessEnv
  cwd: string | undefined
  windowsHide: true
} {
  return {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: hostChildEnv(options.env),
    cwd: options.cwd,
    windowsHide: true,
  }
}

/**
 * Spawn the desktop Host child with stdio IPC.
 * @param options - test isolation (`env`, `cwd`); production callers pass nothing.
 * @returns a live child wrapper.
 */
export function spawnDesktopHost(options: SpawnDesktopHostOptions = {}): DesktopHostChild {
  const node = resolveNodeExecutable()
  const argv = hostChildArgv(node)
  const child = spawn(argv.command, argv.args, hostChildSpawnOptions(options))
  return new DesktopHostChild(child, options.openAuthWindow)
}
