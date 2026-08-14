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
import { DesktopHostChild, hostChildArgv } from '../src/host-child.ts'
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

  it('builds source-launch argv when the CLI src bin exists', () => {
    const argv = hostChildArgv(process.execPath)
    expect(argv.command).toBe(process.execPath)
    expect(argv.args).toContain('--profile')
    expect(argv.args).toContain('desktop')
    expect(argv.args.some(arg => arg.endsWith('bin.ts') || arg.endsWith('bin.js'))).toBe(true)
    expect(existsSync(argv.args.find(arg => arg.endsWith('bin.ts') || arg.endsWith('bin.js')) ?? '')).toBe(true)
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
