/**
 * DesktopHostChild: host-ready handshake, opaque RPC, boot-graph control, dispose.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { IpcApiClient } from '@deepseek-ai/dsh-host-apiproxy'
import { fakeApi } from '../../../packages/host/apiproxy/tests/fake-api.ts'
import { attachDesktopIpcHost } from '@deepseek-ai/dsh-desktop-app/ipc-host'
import { parseDesktopEnvelope } from '@deepseek-ai/dsh-desktop-app/ipc-protocol'
import { DesktopHostChild, hostChildArgv, hostChildEnv, hostChildSpawnOptions, killHostChildTree } from '../src/host-child.ts'
import { rpcEnvelope } from '../src/forwarder.ts'
import { existsSync } from 'node:fs'

class FakeChild extends EventEmitter {
  sent: unknown[] = []
  killed: NodeJS.Signals | undefined
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  send(value: unknown): boolean {
    this.sent.push(value)
    this.emit('child-receive', value)
    return true
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed = signal
    this.exitCode = signal === 'SIGKILL' ? null : 0
    this.signalCode = signal
    this.emit('exit', this.exitCode, this.signalCode)
    return true
  }
}

describe('desktop host child', () => {
  it('waits for host-ready, answers boot-graph, and forwards RPC without decoding bodies', async () => {
    const ctx = new Context()
    ctx.provide('apiProxy', fakeApi())
    ctx.provide('clientModules', {
      graph: () => ({
        rev: 'r1',
        entries: [{ id: '@p/connection', url: '/plugins/@p/connection/client.js?rev=r1', rev: 'r1' }],
      }),
      clientPath: () => undefined,
    })
    ctx.provide('connection', {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch(request: Request): Promise<Response> }) => fallback,
      rpc: {
        handle: () => () => Promise.resolve(),
        intercept: () => () => Promise.resolve(),
      },
    })
    const child = new FakeChild()
    const host = new DesktopHostChild(child as never)
    attachDesktopIpcHost(ctx, {
      send(value) { child.emit('message', value) },
      onMessage(handler) {
        child.on('child-receive', handler)
        return () => { child.off('child-receive', handler) }
      },
    })
    await host.awaitReady()
    const graph = await host.bootGraph()
    expect(graph.graph.rev).toBe('r1')
    expect(graph.themePreference).toBe('system')

    await expect(host.readPlugin('@p/missing')).rejects.toThrow('unknown plugin')

    const exportPending = host.sessionExport({
      method: 'GET',
      sessionId: 'session-root',
      includeDescendants: true,
    })
    const exportEnvelope = parseDesktopEnvelope(child.sent.at(-1))
    if (exportEnvelope?.channel !== 'control' || exportEnvelope.payload.type !== 'session-export-request') {
      throw new Error('expected session-export-request')
    }
    expect(exportEnvelope.payload).toMatchObject({
      method: 'GET',
      sessionId: 'session-root',
      includeDescendants: true,
    })
    child.emit('message', {
      channel: 'control',
      payload: {
        type: 'session-export-response',
        id: exportEnvelope.payload.id,
        status: 200,
        headers: { 'content-type': 'application/zip' },
        bodyPath: '/tmp/dsh-session-export-x.zip',
      },
    })
    await expect(exportPending).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/zip' },
      bodyPath: '/tmp/dsh-session-export-x.zip',
    })

    const headPending = host.sessionExport({
      method: 'HEAD',
      sessionId: 'session-root',
      includeDescendants: true,
    })
    const headEnvelope = parseDesktopEnvelope(child.sent.at(-1))
    if (headEnvelope?.channel !== 'control' || headEnvelope.payload.type !== 'session-export-request') {
      throw new Error('expected session-export-request')
    }
    child.emit('message', {
      channel: 'control',
      payload: {
        type: 'session-export-response',
        id: headEnvelope.payload.id,
        status: 404,
        headers: {},
      },
    })
    await expect(headPending).resolves.toEqual({ status: 404, headers: {} })

    const failPending = host.sessionExport({
      method: 'HEAD',
      sessionId: 'missing',
      includeDescendants: false,
    })
    const failEnvelope = parseDesktopEnvelope(child.sent.at(-1))
    if (failEnvelope?.channel !== 'control' || failEnvelope.payload.type !== 'session-export-request') {
      throw new Error('expected session-export-request')
    }
    child.emit('message', {
      channel: 'control',
      payload: { type: 'session-export-failure', id: failEnvelope.payload.id, message: 'export boom' },
    })
    await expect(failPending).rejects.toThrow('export boom')

    const unexpected = host.sessionExport({
      method: 'GET',
      sessionId: 'session-root',
      includeDescendants: true,
    })
    const unexpectedEnvelope = parseDesktopEnvelope(child.sent.at(-1))
    if (
      unexpectedEnvelope?.channel !== 'control'
      || unexpectedEnvelope.payload.type !== 'session-export-request'
    ) {
      throw new Error('expected session-export-request')
    }
    child.emit('message', {
      channel: 'control',
      payload: {
        type: 'boot-graph-response',
        id: unexpectedEnvelope.payload.id,
        graph: { rev: 'r', entries: [] },
        themePreference: 'system',
      },
    })
    await expect(unexpected).rejects.toThrow('unexpected session-export reply')

    const client = new IpcApiClient({
      post(message) { host.postRpc(message) },
      subscribe(handler) { return host.subscribeRpc((payload) => { handler(payload as never) }) },
    })
    const described = await client.host.describe({})
    expect(described.result.ok).toBe(true)
    client.dispose()

    const opaque = { type: 'unary-request', body: '{"keep":true}' }
    host.subscribeRpc((payload) => {
      expect(payload).toEqual(opaque)
    })
    child.emit('message', rpcEnvelope(opaque))

    await ctx.fiber.dispose()
  })

  it('surfaces a crash instead of leaving a dead port, and dispose is idempotent', async () => {
    const child = new FakeChild()
    const host = new DesktopHostChild(child as never)
    const seen: string[] = []
    host.onExit((error) => { seen.push(error.message) })
    host.onExit(() => { throw new Error('listener bug') })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    child.exitCode = 1
    child.emit('exit', 1, null)
    await expect(host.awaitReady()).rejects.toThrow('exited')
    expect(seen[0]).toMatch(/exited/)
    expect(errorSpy).toHaveBeenCalled()
    await host.dispose()
    await host.dispose()
    errorSpy.mockRestore()
  })

  it('rejects host-ready when spawn emits error instead of crashing the shell', async () => {
    const child = new FakeChild()
    const host = new DesktopHostChild(child as never)
    const seen: string[] = []
    host.onExit((error) => { seen.push(error.message) })
    const assertion = expect(host.awaitReady()).rejects.toThrow(/ENOENT/)
    const error = new Error('spawn ENOENT')
    ;(error as NodeJS.ErrnoException).code = 'ENOENT'
    child.emit('error', error)
    await assertion
    expect(seen[0]).toMatch(/ENOENT/)
    await host.dispose()
  })

  it('builds source-launch argv when the CLI src bin exists', () => {
    const argv = hostChildArgv(process.execPath)
    expect(argv.command).toBe(process.execPath)
    expect(argv.args).toContain('--profile')
    expect(argv.args).toContain('desktop')
    expect(argv.args.some(arg => arg.endsWith('bin.ts') || arg.endsWith('bin.js'))).toBe(true)
    expect(existsSync(argv.args.find(arg => arg.endsWith('bin.ts') || arg.endsWith('bin.js')) ?? '')).toBe(true)
  })

  it('merges child env overrides and always drops ELECTRON_RUN_AS_NODE', () => {
    const env = hostChildEnv({ ELECTRON_RUN_AS_NODE: '1', DSH_HOME: '/tmp/dsh-desktop-host' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.DSH_HOME).toBe('/tmp/dsh-desktop-host')
  })

  it('hides the Host console window', () => {
    expect(hostChildSpawnOptions().windowsHide).toBe(true)
    expect(hostChildSpawnOptions().stdio).toEqual(['ignore', 'inherit', 'inherit', 'ipc'])
    expect(hostChildSpawnOptions({ hostLogPath: '/tmp/desktop-host.log' }).stdio)
      .toEqual(['ignore', 'pipe', 'pipe', 'ipc'])
  })

  it('kills the Host process tree on Windows via taskkill /T /F', () => {
    const calls: unknown[] = []
    killHostChildTree(4242, ((command, args, options) => {
      calls.push([command, args, options])
      return { status: 0 }
    }) as typeof import('node:child_process').spawnSync)
    expect(calls).toEqual([
      ['taskkill', ['/PID', '4242', '/T', '/F'], { stdio: 'ignore', windowsHide: true }],
    ])
  })

  it('does not treat host-bound control documents as replies', async () => {
    const child = new FakeChild()
    const host = new DesktopHostChild(child as never)
    child.emit('message', { channel: 'control', payload: { type: 'host-ready' } })
    await host.awaitReady()
    const pending = host.bootGraph()
    const envelope = parseDesktopEnvelope(child.sent.at(-1))
    if (envelope?.channel !== 'control' || envelope.payload.type !== 'boot-graph-request') {
      throw new Error('expected boot-graph-request')
    }
    const { id } = envelope.payload
    child.emit('message', { channel: 'control', payload: { type: 'boot-graph-request', id } })
    child.emit('message', {
      channel: 'control',
      payload: {
        type: 'boot-graph-response',
        id,
        graph: { rev: 'r2', entries: [] },
        themePreference: 'light',
      },
    })
    await expect(pending).resolves.toMatchObject({ graph: { rev: 'r2' }, themePreference: 'light' })
    await host.dispose()
  })
})
