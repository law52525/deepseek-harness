/**
 * Node Host child: spawn `--profile desktop` with stdio IPC, wait for
 * `host-ready`, forward opaque RPC, and dispose SIGTERM then SIGKILL.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { controlEnvelope, controlFromChild, rpcEnvelope, rpcPayloadFromChild } from './forwarder.ts'
import { resolveNodeExecutable } from './node-executable.ts'
import type {
  DesktopControlToShell,
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
   */
  constructor(private readonly child: ChildProcess) {
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

  private requestControl(
    payload: { type: 'boot-graph-request'; id: string } | { type: 'plugin-bytes-request'; id: string; pluginId: string },
  ): Promise<DesktopControlToShell> {
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
    const control = controlFromChild(value)
    if (
      control === undefined
      || (
        control.type !== 'boot-graph-response'
        && control.type !== 'plugin-bytes-response'
        && control.type !== 'plugin-bytes-failure'
      )
    ) {
      return
    }
    const pending = this.pending.get(control.id)
    if (pending === undefined) return
    this.pending.delete(control.id)
    pending.resolve(control)
  }
}

/**
 * Build argv for the desktop Host child: source `dsh` when present, else the built bin.
 * @param node - system Node executable.
 * @returns argv for `spawn`.
 */
export function hostChildArgv(node: string): { command: string; args: string[] } {
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

/**
 * Spawn the desktop Host child with stdio IPC.
 * @returns a live child wrapper.
 */
export function spawnDesktopHost(): DesktopHostChild {
  const node = resolveNodeExecutable()
  const argv = hostChildArgv(node)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(argv.command, argv.args, {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env,
    windowsHide: false,
  })
  return new DesktopHostChild(child)
}
