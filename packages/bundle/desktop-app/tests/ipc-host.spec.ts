/**
 * Desktop Host IPC adapter: HostIpcGateway plus boot-graph / plugin-byte / session-export control.
 */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
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

function provideIpcHostServices(
  ctx: Context,
  extras?: {
    api?: ReturnType<typeof fakeApi>
    clientModules?: {
      graph: () => { rev: string; entries: readonly { id: string; url: string; rev: string }[] }
      clientPath: (id: string) => string | undefined
    }
  },
): void {
  ctx.provide('apiProxy', extras?.api ?? fakeApi())
  ctx.provide('clientModules', extras?.clientModules ?? {
    graph: () => ({ rev: 'r', entries: [] }),
    clientPath: () => undefined,
  })
  new HostConnectionService(ctx, [])
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
    provideIpcHostServices(ctx, {
      clientModules: {
        graph: () => ({ rev: 'r1', entries: [{ id: '@p/connection', url: '/plugins/@p/connection/client.js?rev=r1', rev: 'r1' }] }),
        clientPath: (id: string) => id === '@p/connection' ? fixture : undefined,
      },
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
    provideIpcHostServices(ctx, {
      clientModules: {
        graph: () => ({ rev: 'r', entries: [] }),
        clientPath: () => missing,
      },
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
    ipc.deliver({
      channel: 'control',
      payload: { type: 'session-export-response', id: 'x', status: 200, headers: {} },
    })
    ipc.deliver({ channel: 'control', payload: { type: 'session-export-failure', id: 'x', message: 'n' } })

    const throwing = memoryIpc()
    const throwCtx = new Context()
    provideIpcHostServices(throwCtx, {
      clientModules: {
        graph: () => { throw new Error('graph boom') },
        clientPath: () => undefined,
      },
    })
    attachDesktopIpcHost(throwCtx, throwing.transport)
    throwing.deliver({ channel: 'control', payload: { type: 'boot-graph-request', id: 'g' } })
    expect(errorSpy).toHaveBeenCalled()

    await ctx.fiber.dispose()
    await throwCtx.fiber.dispose()
  })

  it('uses the schema default when settings is absent or not a built-in preference', async () => {
    const ctx = new Context()
    provideIpcHostServices(ctx)
    ctx.provide('settings', { get: () => undefined })
    const ipc = memoryIpc()
    attachDesktopIpcHost(ctx, ipc.transport)
    ipc.deliver({ channel: 'control', payload: { type: 'boot-graph-request', id: 'g' } })
    expect(ipc.posted.at(-1)).toMatchObject({ payload: { themePreference: 'system' } })

    const other = new Context()
    provideIpcHostServices(other)
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

  it('answers session.export GET with a temp ZIP and HEAD without a body path', async () => {
    const zip = Buffer.from('PK\x03\x04zip')
    const ctx = new Context()
    const api = fakeApi()
    api.downloads.sessionLog = async (request) => {
      expect(request.includeDescendants).toBe(true)
      return new Response(zip, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="dsh-session-root.zip"',
        },
      })
    }
    provideIpcHostServices(ctx, { api })
    const ipc = memoryIpc()
    attachDesktopIpcHost(ctx, ipc.transport)

    ipc.deliver({
      channel: 'control',
      payload: {
        type: 'session-export-request',
        id: 'e1',
        method: 'GET',
        sessionId: 'session-root',
        includeDescendants: true,
      },
    })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control' && entry.payload.type === 'session-export-response')).toBe(true)
    })
    const get = ipc.posted.find(entry =>
      entry.channel === 'control' && entry.payload.type === 'session-export-response')
    if (get?.channel !== 'control' || get.payload.type !== 'session-export-response') {
      throw new Error('expected session-export-response')
    }
    expect(get.payload.status).toBe(200)
    expect(get.payload.headers['content-type']).toBe('application/zip')
    expect(get.payload.bodyPath).toBeDefined()
    const bodyPath = get.payload.bodyPath as string
    expect(existsSync(bodyPath)).toBe(true)
    await unlink(bodyPath)

    ipc.deliver({
      channel: 'control',
      payload: {
        type: 'session-export-request',
        id: 'e2',
        method: 'HEAD',
        sessionId: 'session-root',
        includeDescendants: true,
      },
    })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control'
        && entry.payload.type === 'session-export-response'
        && entry.payload.id === 'e2')).toBe(true)
    })
    const head = ipc.posted.find(entry =>
      entry.channel === 'control'
      && entry.payload.type === 'session-export-response'
      && entry.payload.id === 'e2')
    expect(head).toMatchObject({ payload: { status: 200 } })
    if (head?.channel === 'control' && head.payload.type === 'session-export-response') {
      expect(head.payload.bodyPath).toBeUndefined()
    }

    await ctx.fiber.dispose()
  })

  it('forwards empty GET bodies, omitted descendants, and sessionLog throws', async () => {
    const ctx = new Context()
    const api = fakeApi()
    let calls = 0
    api.downloads.sessionLog = async (request) => {
      calls += 1
      if (calls === 1) {
        expect(request.includeDescendants).toBeUndefined()
        return new Response(new Uint8Array(), { status: 200 })
      }
      if (calls === 2) return new Response(null, { status: 204 })
      if (calls === 3) throw new Error('export boom')
      throw 'export boom'
    }
    provideIpcHostServices(ctx, { api })
    const ipc = memoryIpc()
    attachDesktopIpcHost(ctx, ipc.transport)

    ipc.deliver({
      channel: 'control',
      payload: {
        type: 'session-export-request',
        id: 'empty',
        method: 'GET',
        sessionId: 'session-root',
        includeDescendants: false,
      },
    })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control'
        && entry.payload.type === 'session-export-response'
        && entry.payload.id === 'empty')).toBe(true)
    })
    expect(ipc.posted.at(-1)).toMatchObject({
      payload: { type: 'session-export-response', id: 'empty', status: 200 },
    })

    ipc.deliver({
      channel: 'control',
      payload: {
        type: 'session-export-request',
        id: 'nobody',
        method: 'GET',
        sessionId: 'session-root',
        includeDescendants: true,
      },
    })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control'
        && entry.payload.type === 'session-export-response'
        && entry.payload.id === 'nobody')).toBe(true)
    })
    expect(ipc.posted.at(-1)).toMatchObject({
      payload: { type: 'session-export-response', id: 'nobody', status: 204 },
    })

    ipc.deliver({
      channel: 'control',
      payload: {
        type: 'session-export-request',
        id: 'fail',
        method: 'GET',
        sessionId: 'session-root',
        includeDescendants: true,
      },
    })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control' && entry.payload.type === 'session-export-failure')).toBe(true)
    })
    expect(ipc.posted.at(-1)).toMatchObject({
      payload: { type: 'session-export-failure', id: 'fail', message: 'export boom' },
    })

    ipc.deliver({
      channel: 'control',
      payload: {
        type: 'session-export-request',
        id: 'fail2',
        method: 'GET',
        sessionId: 'session-root',
        includeDescendants: true,
      },
    })
    await vi.waitFor(() => {
      expect(ipc.posted.some(entry =>
        entry.channel === 'control'
        && entry.payload.type === 'session-export-failure'
        && entry.payload.id === 'fail2')).toBe(true)
    })
    expect(ipc.posted.at(-1)).toMatchObject({
      payload: { type: 'session-export-failure', id: 'fail2', message: 'export boom' },
    })

    await ctx.fiber.dispose()
  })

  it('applies onto process IPC when process.send exists', async () => {
    const ctx = new Context()
    provideIpcHostServices(ctx)
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

  it('fails loud when connection is missing', () => {
    const ctx = new Context()
    ctx.provide('apiProxy', fakeApi())
    ctx.provide('clientModules', {
      graph: () => ({ rev: 'r', entries: [] }),
      clientPath: () => undefined,
    })
    expect(() => attachDesktopIpcHost(ctx, memoryIpc().transport)).toThrow('desktop-ipc: connection unavailable')
  })

  it('dispatches claimed /api remotes through Connection interceptors', async () => {
    const ctx = new Context()
    provideIpcHostServices(ctx)
    const ipc = memoryIpc()
    attachDesktopIpcHost(ctx, ipc.transport)
    const client = new IpcApiClient(hostPort(ipc))
    const listBody = JSON.stringify({
      type: 'client-request',
      rpcId: 'cmd-1',
      method: 'commands/list',
      payload: { args: { sessionId: 's1' } },
    })
    const missing = await client.fetch(new URL('http://dsh.internal/api/commands/list'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: listBody,
    })
    expect(missing.status).toBe(404)

    ctx.connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'commands/list',
      async () => ({ ok: true, value: [{ name: 'compact' }] }),
      { authority: 'trusted-host' },
    )
    const claimed = await client.fetch(new URL('http://dsh.internal/api/commands/list'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: listBody,
    })
    expect(claimed.status).toBe(200)
    expect(await claimed.json()).toEqual({
      type: 'server-response',
      rpcId: 'cmd-1',
      result: { ok: true, value: [{ name: 'compact' }] },
    })
    const described = await client.host.describe({})
    expect(described.result.ok).toBe(true)
    client.dispose()
    await ctx.fiber.dispose()
  })
})
