import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ApiProxy, MuxFrame } from '../src/api/index.ts'
import { RpcId } from '../src/api/rpc.ts'
import { IpcApiClient, type IpcMessage, type IpcPort } from '../src/fetch/client.ts'
import { HostIpcGateway } from '../src/fetch/ipc-gateway.ts'
import { IpcId, parseIpcMessage } from '../src/fetch/ipc.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { fakeApi } from './fake-api.ts'

function asPort(port: MessagePort): IpcPort {
  port.start()
  return {
    post(message) { port.postMessage(message) },
    subscribe(handler) {
      const listener = (event: MessageEvent): void => { handler(event.data as IpcMessage) }
      port.addEventListener('message', listener)
      return () => { port.removeEventListener('message', listener) }
    },
  }
}

function linkedPorts(): {
  clientPort: IpcPort
  hostPort: IpcPort
  injectTowardClient: (value: unknown) => void
  injectTowardHost: (value: unknown) => void
  dispose: () => void
} {
  const channel = new MessageChannel()
  return {
    clientPort: asPort(channel.port1),
    hostPort: asPort(channel.port2),
    injectTowardClient: (value) => { channel.port2.postMessage(value) },
    injectTowardHost: (value) => { channel.port1.postMessage(value) },
    dispose: () => {
      channel.port1.close()
      channel.port2.close()
    },
  }
}

function mockPort(): { port: IpcPort; send: (value: unknown) => void; posted: IpcMessage[] } {
  let handler: ((message: IpcMessage) => void) | undefined
  const posted: IpcMessage[] = []
  return {
    posted,
    send(value) { handler?.(value as IpcMessage) },
    port: {
      post(message) { posted.push(message) },
      subscribe(next) {
        handler = next
        return () => { handler = undefined }
      },
    },
  }
}

class ProbeClient extends IpcApiClient {
  fetchForTest(input: URL, init?: RequestInit): Promise<Response> {
    return this.doFetch(input, init)
  }
}

async function collect<F>(stream: AsyncIterable<F>): Promise<F[]> {
  const out: F[] = []
  for await (const item of stream) out.push(item)
  return out
}

function hangingPickDirectory(api: ApiProxy): { api: ApiProxy; started: Promise<AbortSignal> } {
  const started = Promise.withResolvers<AbortSignal>()
  api.host.pickDirectory = async (request, signal) => {
    started.resolve(signal)
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    return {
      rpcId: request.rpcId,
      result: { ok: false, error: { code: 'cancelled', message: 'aborted', details: {} } },
    }
  }
  return { api, started: started.promise }
}

describe('parseIpcMessage', () => {
  it('accepts each document type and rejects malformed values', () => {
    const id = IpcId('id-1')
    expect(parseIpcMessage({ type: 'unary-abort', id })?.type).toBe('unary-abort')
    expect(parseIpcMessage({ type: 'stream-abort', id })?.type).toBe('stream-abort')
    expect(parseIpcMessage({ type: 'stream-open', id, path: '/api/events.mux' })?.type).toBe('stream-open')
    expect(parseIpcMessage({ type: 'stream-end', id })?.type).toBe('stream-end')
    expect(parseIpcMessage({ type: 'stream-end', id, error: 'boom' })?.type).toBe('stream-end')
    expect(parseIpcMessage({
      type: 'unary-request', id, url: 'http://dsh.internal/api/session.list',
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })?.type).toBe('unary-request')
    expect(parseIpcMessage({
      type: 'unary-response', id, status: 200, headers: {}, body: '{}',
    })?.type).toBe('unary-response')
    expect(parseIpcMessage({ type: 'unary-failure', id, message: 'down' })?.type).toBe('unary-failure')
    expect(parseIpcMessage({ type: 'stream-frame', id, envelope: { x: 1 } })?.type).toBe('stream-frame')
    expect(parseIpcMessage({ nope: true })).toBeUndefined()
    expect(parseIpcMessage(null)).toBeUndefined()
  })
})

describe('IpcApiClient + HostIpcGateway over MessageChannel', () => {
  it('carries a success result and echoes the minted rpcId', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const response = await client.sessions.list({})
      expect(response.result).toEqual({ ok: true, value: { items: [] } })
      expect(response.rpcId).toMatch(/[0-9a-f-]{36}/)
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('lets host.pickDirectory succeed without browser Origin or Host markers', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    api.host.pickDirectory = async (request) => {
      return { rpcId: request.rpcId, result: { ok: true, value: { path: '/tmp/project' } } }
    }
    let seen: Headers | undefined
    const inner = toFetchHandler(api)
    const handler = {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const request = input instanceof Request ? input : new Request(input, init)
        seen = request.headers
        return inner.fetch(request)
      },
    }
    const gateway = new HostIpcGateway(ports.hostPort, handler, api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const response = await client.host.pickDirectory({})
      expect(response.result).toEqual({ ok: true, value: { path: '/tmp/project' } })
      expect(seen?.get('content-type')).toBe('application/json')
      expect(seen?.get('origin')).toBeNull()
      expect(seen?.get('sec-fetch-site')).toBeNull()
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('aborts a hanging unary handler via unary-abort', async () => {
    const ports = linkedPorts()
    const { api, started } = hangingPickDirectory(fakeApi())
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const controller = new AbortController()
      const execution = client.host.pickDirectory({}, controller.signal)
      const handlerSignal = await started
      controller.abort(new Error('connection closed'))
      await expect(execution).rejects.toThrow('connection closed')
      await vi.waitFor(() => { expect(handlerSignal.aborted).toBe(true) })
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('yields mux and host frames on independent streams', async () => {
    const ports = linkedPorts()
    const hostDone = Promise.withResolvers<undefined>()
    const api = fakeApi({
      muxFrames: [
        { type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 },
        { type: 'session/subscribed', sessionId: 's2' as never, lastSeq: 3 },
      ],
      hostFrames: [{ type: 'host/session-removed', sessionId: 's1' as never }],
    })
    api.events.mux = async function * (_request, signal): AsyncGenerator<{ rpcId: ReturnType<typeof RpcId>; payload: MuxFrame }> {
      yield { rpcId: RpcId('mux-0'), payload: { type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 } }
      await hostDone.promise
      if (signal.aborted) return
      yield { rpcId: RpcId('mux-1'), payload: { type: 'session/subscribed', sessionId: 's2' as never, lastSeq: 3 } }
    }
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const muxAc = new AbortController()
      const hostAc = new AbortController()
      let muxOpened = false
      const muxIter = client.events.mux({}, muxAc.signal, () => { muxOpened = true })[Symbol.asyncIterator]()
      const hostFrames = await collect(client.events.host({}, hostAc.signal))
      expect(hostFrames).toHaveLength(1)
      expect(hostFrames[0]?.payload).toMatchObject({ type: 'host/session-removed' })
      hostDone.resolve(undefined)
      const first = await muxIter.next()
      const second = await muxIter.next()
      const done = await muxIter.next()
      expect(muxOpened).toBe(true)
      expect(first.value?.payload).toMatchObject({ type: 'session/subscribed', sessionId: 's1' })
      expect(second.value?.payload).toMatchObject({ type: 'session/subscribed', sessionId: 's2' })
      expect(done.done).toBe(true)
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('aborts a live stream without killing the sibling', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    api.events.mux = async function * (_request, signal) {
      yield { rpcId: RpcId('mux-0'), payload: { type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 } }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const muxAc = new AbortController()
      const hostAc = new AbortController()
      const muxIter = client.events.mux({}, muxAc.signal)[Symbol.asyncIterator]()
      const first = await muxIter.next()
      expect(first.value?.payload).toMatchObject({ type: 'session/subscribed' })
      muxAc.abort()
      const muxDone = await muxIter.next()
      expect(muxDone.done).toBe(true)
      const hostFrames = await collect(client.events.host({}, hostAc.signal))
      expect(hostFrames[0]?.payload).toMatchObject({ type: 'host/session-removed' })
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('drops a malformed stream-frame without killing the sibling stream', async () => {
    const ports = linkedPorts()
    const releaseSecond = Promise.withResolvers<undefined>()
    const api = fakeApi()
    api.events.mux = async function * (_request, signal) {
      yield { rpcId: RpcId('mux-0'), payload: { type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 } }
      await releaseSecond.promise
      if (signal.aborted) return
      yield { rpcId: RpcId('mux-1'), payload: { type: 'session/subscribed', sessionId: 's2' as never, lastSeq: 1 } }
    }
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const posted: IpcMessage[] = []
    const tappingClient: IpcPort = {
      post(message) {
        posted.push(message)
        ports.clientPort.post(message)
      },
      subscribe: handler => ports.clientPort.subscribe(handler),
    }
    const client = new IpcApiClient(tappingClient)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const muxAc = new AbortController()
      const hostAc = new AbortController()
      const muxIter = client.events.mux({}, muxAc.signal)[Symbol.asyncIterator]()
      const first = await muxIter.next()
      expect(first.value?.payload).toMatchObject({ sessionId: 's1' })
      const open = posted.find(message => message.type === 'stream-open')
      expect(open?.type).toBe('stream-open')
      if (open?.type !== 'stream-open') throw new Error('expected stream-open')
      ports.injectTowardClient({ type: 'stream-frame', id: open.id, envelope: { nope: true } })
      await vi.waitFor(() => { expect(errorSpy).toHaveBeenCalled() })
      releaseSecond.resolve(undefined)
      const second = await muxIter.next()
      expect(second.value?.payload).toMatchObject({ sessionId: 's2' })
      const hostFrames = await collect(client.events.host({}, hostAc.signal))
      expect(hostFrames[0]?.payload).toMatchObject({ type: 'host/session-removed' })
    } finally {
      errorSpy.mockRestore()
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('turns gateway unary-failure into a transport throw', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    const gateway = new HostIpcGateway(ports.hostPort, {
      fetch: async () => { throw new Error('ipc pipe broken') },
    }, api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      await expect(client.sessions.list({})).rejects.toThrow('ipc pipe broken')
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('stringifies a non-Error unary throw as unary-failure', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    const gateway = new HostIpcGateway(ports.hostPort, {
      fetch: async () => { throw 'pipe down' },
    }, api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      await expect(client.sessions.list({})).rejects.toThrow('pipe down')
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('turns a mid-stream impl throw into a failed generator', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    api.events.mux = async function * () {
      yield { rpcId: RpcId('mux-0'), payload: { type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 } }
      throw new Error('mux died')
    }
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const frames: unknown[] = []
      await expect((async () => {
        for await (const envelope of client.events.mux({}, new AbortController().signal)) {
          frames.push(envelope)
        }
      })()).rejects.toThrow('mux died')
      expect(frames).toHaveLength(1)
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('stringifies a non-Error stream throw', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    api.events.host = async function * () {
      throw 'host died'
    }
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      await expect(collect(client.events.host({}, new AbortController().signal))).rejects.toThrow('host died')
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })

  it('round-trips respond over IPC', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const receipt = await client.respond({
        type: 'client-response', rpcId: RpcId('known'), result: { ok: true, value: null },
      })
      expect(receipt).toEqual({ accepted: true })
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })
})

describe('IpcApiClient edge cases', () => {
  it('rejects an already-aborted unary and ignores unknown or reverse-direction documents', async () => {
    const { port, send } = mockPort()
    const client = new ProbeClient(port)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const aborted = new AbortController()
      aborted.abort(new Error('already aborted'))
      await expect(client.fetchForTest(new URL('http://dsh.internal/api/session.list'), {
        signal: aborted.signal,
      })).rejects.toThrow('already aborted')

      const pending = client.fetchForTest(new URL('http://dsh.internal/api/session.list'))
      send({ nope: true })
      send({ type: 'unary-request', id: IpcId('x'), url: 'http://x', method: 'POST', headers: {} })
      send({ type: 'unary-abort', id: IpcId('x') })
      send({ type: 'stream-open', id: IpcId('x'), path: '/api/events.mux' })
      send({ type: 'stream-abort', id: IpcId('x') })
      send({ type: 'unary-response', id: IpcId('missing'), status: 200, headers: {}, body: '{}' })
      send({ type: 'unary-failure', id: IpcId('missing'), message: 'gone' })
      send({ type: 'stream-frame', id: IpcId('missing'), envelope: {} })
      send({ type: 'stream-end', id: IpcId('missing') })
      expect(errorSpy).toHaveBeenCalled()
      void client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]().next()
      client.dispose()
      await expect(pending).rejects.toThrow('This operation was aborted')
    } finally {
      errorSpy.mockRestore()
      client.dispose()
    }
  })

  it('covers a GET-shaped doFetch and an already-aborted stream', async () => {
    const { port, posted, send } = mockPort()
    const client = new ProbeClient(port)
    try {
      const pending = client.fetchForTest(new URL('http://dsh.internal/api/session.list'), {
        headers: { accept: 'application/json' },
        body: new Blob(),
      })
      expect(posted[0]).toMatchObject({ type: 'unary-request', method: 'GET' })
      if (posted[0]?.type !== 'unary-request') throw new Error('expected unary-request')
      send({
        type: 'unary-response',
        id: posted[0].id,
        status: 200,
        headers: {},
        body: '{}',
      })
      const response = await pending
      expect(response.status).toBe(200)

      const ac = new AbortController()
      ac.abort()
      const frames = await collect(client.events.mux({}, ac.signal, () => {
        throw new Error('onOpen must not fire for an already-aborted stream')
      }))
      expect(frames).toHaveLength(0)

      const live = new AbortController()
      const iter = client.events.mux({}, live.signal)[Symbol.asyncIterator]()
      const first = iter.next()
      const open = posted.find(message => message.type === 'stream-open')
      if (open?.type !== 'stream-open') throw new Error('expected stream-open')
      send({ type: 'stream-end', id: open.id })
      live.abort()
      expect((await first).done).toBe(true)

      const abortAfterDispose = new AbortController()
      const hanging = client.fetchForTest(new URL('http://dsh.internal/api/session.list'), {
        method: 'POST',
        signal: abortAfterDispose.signal,
      })
      client.dispose()
      abortAfterDispose.abort()
      await expect(hanging).rejects.toThrow('This operation was aborted')
    } finally {
      client.dispose()
    }
  })

  it('posts stream-abort when the consumer stops iterating', async () => {
    const ports = linkedPorts()
    const api = fakeApi()
    api.events.mux = async function * (_request, signal) {
      yield { rpcId: RpcId('mux-0'), payload: { type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 } }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    const gateway = new HostIpcGateway(ports.hostPort, toFetchHandler(api), api.events)
    const client = new IpcApiClient(ports.clientPort)
    try {
      const ac = new AbortController()
      const received: unknown[] = []
      for await (const envelope of client.events.mux({}, ac.signal)) {
        received.push(envelope)
        break
      }
      expect(received).toHaveLength(1)
    } finally {
      client.dispose()
      await gateway.dispose()
      ports.dispose()
    }
  })
})

describe('HostIpcGateway edge cases', () => {
  it('ignores reverse-direction documents, unknown paths, duplicates, and pre-abort', async () => {
    const { port, send, posted } = mockPort()
    const api = fakeApi()
    const { started } = hangingPickDirectory(api)
    const gateway = new HostIpcGateway(port, toFetchHandler(api), api.events)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      send({ nope: true })
      send({ type: 'unary-response', id: IpcId('x'), status: 200, headers: {}, body: '{}' })
      send({ type: 'unary-failure', id: IpcId('x'), message: 'nope' })
      send({ type: 'stream-frame', id: IpcId('x'), envelope: {} })
      send({ type: 'stream-end', id: IpcId('x') })
      send({ type: 'stream-open', id: IpcId('bad-path'), path: '/not-a-stream' })
      await vi.waitFor(() => {
        expect(posted.some(message => message.type === 'stream-end' && message.error?.includes('unknown stream path'))).toBe(true)
      })

      const hangId = IpcId('hang')
      const body = JSON.stringify({
        type: 'client-request', rpcId: 'r-hang', method: 'host.pickDirectory', payload: {},
      })
      send({
        type: 'unary-request', id: hangId, url: 'http://dsh.internal/api/host.pickDirectory',
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      })
      await started
      send({
        type: 'unary-request', id: hangId, url: 'http://dsh.internal/api/host.pickDirectory',
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      })
      await vi.waitFor(() => {
        expect(posted.some(message => message.type === 'unary-failure' && message.message === 'duplicate unary id')).toBe(true)
      })

      const early = IpcId('early')
      send({ type: 'unary-abort', id: early })
      send({
        type: 'unary-request', id: early, url: 'http://dsh.internal/api/host.pickDirectory',
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      })
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(posted.some(message => message.id === early && (
        message.type === 'unary-response' || message.type === 'unary-failure'
      ))).toBe(false)

      send({ type: 'stream-abort', id: IpcId('unknown-stream') })
      send({ type: 'unary-abort', id: IpcId('unknown-unary') })
      send({
        type: 'unary-request', id: IpcId('nobody'), url: 'http://dsh.internal/api/session.list',
        method: 'POST', headers: { 'content-type': 'application/json' },
      })

      const preAbortStream = IpcId('pre-abort-stream')
      send({ type: 'stream-abort', id: preAbortStream })
      send({ type: 'stream-open', id: preAbortStream, path: '/api/events.host' })

      const hangMux = fakeApi()
      hangMux.events.mux = async function * (_request, signal) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      }
      await gateway.dispose()
      const hanging = new HostIpcGateway(port, toFetchHandler(hangMux), hangMux.events)
      const dupStream = IpcId('dup-stream')
      send({ type: 'stream-open', id: dupStream, path: '/api/events.mux' })
      send({ type: 'stream-open', id: dupStream, path: '/api/events.mux' })
      await vi.waitFor(() => {
        expect(posted.some(message => message.type === 'stream-end' && message.error === 'duplicate stream id')).toBe(true)
      })
      await hanging.dispose()

      const abortingFetch: { fetch: typeof fetch } = {
        async fetch(_input, init): Promise<Response> {
          const signal = init?.signal
          if (signal == null) throw new Error('missing signal')
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => { reject(new Error('aborted fetch')) }, { once: true })
          })
          return new Response(null, { status: 500 })
        },
      }
      const abortGw = new HostIpcGateway(port, abortingFetch, fakeApi().events)
      const abortId = IpcId('abort-throw')
      send({
        type: 'unary-request', id: abortId, url: 'http://dsh.internal/api/session.list',
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })
      send({ type: 'unary-abort', id: abortId })
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(posted.some(message => message.id === abortId && (
        message.type === 'unary-response' || message.type === 'unary-failure'
      ))).toBe(false)

      const abortingMux = fakeApi()
      abortingMux.events.mux = async function * (_request, signal) {
        yield { rpcId: RpcId('mux-0'), payload: { type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 } }
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        throw new Error('should be ignored after abort')
      }
      await abortGw.dispose()
      const streamGw = new HostIpcGateway(port, toFetchHandler(abortingMux), abortingMux.events)
      const liveId = IpcId('live-abort')
      send({ type: 'stream-open', id: liveId, path: '/api/events.mux' })
      await vi.waitFor(() => {
        expect(posted.some(message => message.type === 'stream-frame' && message.id === liveId)).toBe(true)
      })
      send({ type: 'stream-abort', id: liveId })
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(posted.some(message => message.type === 'stream-end' && message.id === liveId)).toBe(false)

      const yieldAfterAbort = fakeApi()
      yieldAfterAbort.events.host = async function * (_request, signal) {
        yield { rpcId: RpcId('host-0'), payload: { type: 'host/session-removed', sessionId: 's1' as never } }
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        yield { rpcId: RpcId('host-1'), payload: { type: 'host/session-removed', sessionId: 's2' as never } }
      }
      await streamGw.dispose()
      const yieldGw = new HostIpcGateway(port, toFetchHandler(yieldAfterAbort), yieldAfterAbort.events)
      const yieldId = IpcId('yield-abort')
      send({ type: 'stream-open', id: yieldId, path: '/api/events.host' })
      await vi.waitFor(() => {
        expect(posted.some(message => message.type === 'stream-frame' && message.id === yieldId)).toBe(true)
      })
      send({ type: 'stream-abort', id: yieldId })
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(posted.filter(message => message.type === 'stream-frame' && message.id === yieldId)).toHaveLength(1)
      await yieldGw.dispose()

      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      await gateway.dispose()
    }
  })

  it('does not depend on electron', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.electron).toBeUndefined()
    expect(manifest.devDependencies?.electron).toBeUndefined()
  })
})
