/**
 * Desktop Host IPC adapter: HostIpcGateway plus boot-graph / plugin-byte control.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { IpcApiClient, type IpcMessage, type IpcPort } from '@deepseek-ai/dsh-host-apiproxy'
import { fakeApi } from '../../../host/apiproxy/tests/fake-api.ts'
import { apply, attachDesktopIpcHost, type DesktopIpcTransport } from '../src/ipc-host.ts'
import type { DesktopIpcEnvelope } from '../src/ipc-protocol.ts'
import { parseDesktopEnvelope } from '../src/ipc-protocol.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** In-memory parent/child transport for attachDesktopIpcHost. */
function memoryIpc(): {
  transport: DesktopIpcTransport
  posted: DesktopIpcEnvelope[]
  deliver(value: unknown): void
} {
  const posted: DesktopIpcEnvelope[] = []
  let handler: ((value: unknown) => void) | undefined
  return {
    posted,
    deliver(value) { handler?.(value) },
    transport: {
      send(value) { posted.push(value) },
      onMessage(next) {
        handler = next
        return () => { handler = undefined }
      },
    },
  }
}

function hostPort(ipc: ReturnType<typeof memoryIpc>): IpcPort {
  return {
    post(message) {
      ipc.deliver({ channel: 'rpc', payload: message })
    },
    subscribe(handler) {
      const originalSend = ipc.transport.send
      ipc.transport.send = (value) => {
        originalSend.call(ipc.transport, value)
        const envelope = parseDesktopEnvelope(value)
        if (envelope?.channel === 'rpc') handler(envelope.payload as IpcMessage)
      }
      return () => { ipc.transport.send = originalSend }
    },
  }
}

describe('desktop IPC host', () => {
  it('is a no-op when this process has no parent IPC channel', () => {
    const ctx = new Context()
    const send = process.send
    Object.defineProperty(process, 'send', { value: undefined, configurable: true })
    try {
      apply(ctx)
      expect(ctx.registry).toBeDefined()
    } finally {
      if (send === undefined) delete (process as { send?: unknown }).send
      else Object.defineProperty(process, 'send', { value: send, configurable: true })
    }
  })

  it('announces host-ready immediately without a Loader and answers control plus RPC', async () => {
    const fixture = join(mkdtempSync(join(tmpdir(), 'dsh-desktop-ipc-')), 'client.js')
    writeFileSync(fixture, 'window.__ModuleLoader__.load({ id: "fx", factory: () => ({}) })\n')
    const ctx = new Context()
    ctx.provide('apiProxy', fakeApi())
    ctx.provide('clientModules', {
      graph: () => ({ rev: 'r1', entries: [{ id: '@p/connection', url: '/plugins/@p/connection/client.js?rev=r1', rev: 'r1' }] }),
      clientPath: (id: string) => id === '@p/connection' ? fixture : undefined,
    })
    const ipc = memoryIpc()
    attachDesktopIpcHost(ctx, ipc.transport)
    expect(ipc.posted).toEqual([{ channel: 'control', payload: { type: 'host-ready' } }])

    ipc.deliver({ channel: 'control', payload: { type: 'boot-graph-request', id: 'g1' } })
    const graph = ipc.posted.find(entry =>
      entry.channel === 'control' && entry.payload.type === 'boot-graph-response')
    expect(graph).toMatchObject({
      channel: 'control',
      payload: {
        type: 'boot-graph-response',
        id: 'g1',
        themePreference: 'system',
        graph: { rev: 'r1' },
      },
    })

    ipc.deliver({ channel: 'control', payload: { type: 'plugin-bytes-request', id: 'b1', pluginId: '@p/connection' } })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control' && entry.payload.type === 'plugin-bytes-response')).toBe(true)
    })
    const bytes = ipc.posted.find(entry =>
      entry.channel === 'control' && entry.payload.type === 'plugin-bytes-response')
    expect(bytes).toMatchObject({ payload: { id: 'b1', bytes: expect.stringContaining('__ModuleLoader__') } })

    ipc.deliver({ channel: 'control', payload: { type: 'plugin-bytes-request', id: 'b2', pluginId: '@p/missing' } })
    expect(ipc.posted.at(-1)).toMatchObject({
      payload: { type: 'plugin-bytes-failure', id: 'b2', message: 'unknown plugin @p/missing' },
    })

    const client = new IpcApiClient(hostPort(ipc))
    const described = await client.host.describe({})
    expect(described.result.ok).toBe(true)
    client.dispose()
    await ctx.fiber.dispose()
  })

  it('reads a settings-backed theme, fails plugin reads, drops malformed envelopes, and stays quiet on loader failure', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'dsh-desktop-ipc-miss-')), 'gone.js')
    const ctx = new Context()
    ctx.provide('apiProxy', fakeApi())
    ctx.provide('clientModules', {
      graph: () => ({ rev: 'r', entries: [] }),
      clientPath: () => missing,
    })
    ctx.provide('settings', {
      get: () => ({ preference: 'dark' }),
    })
    ctx.provide('loader', {
      await: () => Promise.reject(new Error('boot failed')),
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ipc = memoryIpc()
    attachDesktopIpcHost(ctx, ipc.transport)
    await Promise.resolve()
    expect(ipc.posted).toEqual([])

    ipc.deliver({ channel: 'control', payload: { type: 'boot-graph-request', id: 'g' } })
    expect(ipc.posted.at(-1)).toMatchObject({ payload: { themePreference: 'dark' } })

    ipc.deliver({ channel: 'control', payload: { type: 'plugin-bytes-request', id: 'b', pluginId: '@p/x' } })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control' && entry.payload.type === 'plugin-bytes-failure')).toBe(true)
    })

    ipc.deliver('not-an-envelope')
    expect(errorSpy).toHaveBeenCalled()
    ipc.deliver({ channel: 'control', payload: { type: 'host-ready' } })
    ipc.deliver({
      channel: 'control',
      payload: { type: 'boot-graph-response', id: 'x', graph: { rev: 'r', entries: [] }, themePreference: 'light' },
    })
    ipc.deliver({ channel: 'control', payload: { type: 'plugin-bytes-response', id: 'x', bytes: '' } })
    ipc.deliver({ channel: 'control', payload: { type: 'plugin-bytes-failure', id: 'x', message: 'n' } })

    const throwing = memoryIpc()
    const throwCtx = new Context()
    throwCtx.provide('apiProxy', fakeApi())
    throwCtx.provide('clientModules', {
      graph: () => { throw new Error('graph boom') },
      clientPath: () => undefined,
    })
    attachDesktopIpcHost(throwCtx, throwing.transport)
    throwing.deliver({ channel: 'control', payload: { type: 'boot-graph-request', id: 'g' } })
    expect(errorSpy).toHaveBeenCalled()

    await ctx.fiber.dispose()
    await throwCtx.fiber.dispose()
  })

  it('uses the schema default when settings is absent or not a built-in preference', async () => {
    const ctx = new Context()
    ctx.provide('apiProxy', fakeApi())
    ctx.provide('clientModules', {
      graph: () => ({ rev: 'r', entries: [] }),
      clientPath: () => undefined,
    })
    ctx.provide('settings', { get: () => undefined })
    const ipc = memoryIpc()
    attachDesktopIpcHost(ctx, ipc.transport)
    ipc.deliver({ channel: 'control', payload: { type: 'boot-graph-request', id: 'g' } })
    expect(ipc.posted.at(-1)).toMatchObject({ payload: { themePreference: 'system' } })

    const other = new Context()
    other.provide('apiProxy', fakeApi())
    other.provide('clientModules', {
      graph: () => ({ rev: 'r', entries: [] }),
      clientPath: () => undefined,
    })
    other.provide('settings', { get: () => ({ preference: 'sepia' }) })
    other.provide('loader', { await: () => Promise.resolve() })
    const delayed = memoryIpc()
    attachDesktopIpcHost(other, delayed.transport)
    expect(delayed.posted).toEqual([])
    await vi.waitFor(() => {
      expect(delayed.posted).toEqual([{ channel: 'control', payload: { type: 'host-ready' } }])
    })
    delayed.deliver({ channel: 'control', payload: { type: 'boot-graph-request', id: 'g' } })
    expect(delayed.posted.at(-1)).toMatchObject({ payload: { themePreference: 'system' } })
    await ctx.fiber.dispose()
    await other.fiber.dispose()
  })

  it('applies onto process IPC when process.send exists', async () => {
    const ctx = new Context()
    ctx.provide('apiProxy', fakeApi())
    ctx.provide('clientModules', {
      graph: () => ({ rev: 'r', entries: [] }),
      clientPath: () => undefined,
    })
    const posted: unknown[] = []
    const originalSend = process.send
    Object.defineProperty(process, 'send', {
      value: (value: unknown) => { posted.push(value) },
      configurable: true,
    })
    try {
      apply(ctx)
      expect(posted).toEqual([{ channel: 'control', payload: { type: 'host-ready' } }])
      await ctx.fiber.dispose()
    } finally {
      if (originalSend === undefined) delete (process as { send?: unknown }).send
      else Object.defineProperty(process, 'send', { value: originalSend, configurable: true })
    }
  })
})
