/**
 * Host end of the JSON IPC carrier: unary documents feed a Fetch handler,
 * and each downlink iterates `api.events` without SSE encoding. The peer is
 * a loopback, same-origin, already-authenticated product shell — this gateway
 * never listens on a TCP port and does not apply the browser Host/Origin fence.
 */

import type { ApiProxy, HostFrame, MuxFrame } from '../api/index.ts'
import type { RpcRequest, ServerRequest } from '../api/rpc.ts'
import { RpcId } from '../api/rpc.ts'
import {
  IPC_HOST_PATH,
  IPC_MUX_PATH,
  type IpcId,
  type IpcMessage,
  type IpcPort,
  parseIpcMessage,
} from './ipc.ts'

/**
 * Host end of the JSON IPC carrier. Privileged methods (`host.pickDirectory`,
 * settings, credentials, and the loopback-only set in `dsh-client-connection`)
 * are allowed for this peer. The gateway is unreachable from a web page.
 */
export class HostIpcGateway {
  private readonly unaries = new Map<IpcId, AbortController>()
  private readonly streams = new Map<IpcId, AbortController>()
  private readonly abortedUnaries = new Set<IpcId>()
  private readonly abortedStreams = new Set<IpcId>()
  private readonly inflight = new Set<Promise<void>>()
  private readonly unsubscribe: () => void

  /**
   * @param port - the peer's IPC port.
   * @param handler - Fetch handler for unary POST (tests pass `toFetchHandler(api)`).
   * @param events - `api.events` mux and host iterables.
   */
  constructor(
    private readonly port: IpcPort,
    private readonly handler: { fetch(request: Request): Promise<Response> },
    private readonly events: ApiProxy['events'],
  ) {
    this.unsubscribe = port.subscribe((message) => {
      try {
        this.dispatch(message)
      } catch (error) {
        /* v8 ignore next -- subscribe must not throw into the port; dispatch is exhaustive after parse */
        console.error('[apiproxy] ipc gateway dispatch threw:', error)
      }
    })
  }

  /**
   * Abort in-flight unary calls and streams, unsubscribe from the port, and
   * wait until those tasks settle.
   * @returns after in-flight work has stopped.
   */
  async dispose(): Promise<void> {
    this.unsubscribe()
    for (const ac of this.unaries.values()) ac.abort()
    for (const ac of this.streams.values()) ac.abort()
    await Promise.all(this.inflight)
  }

  private dispatch(raw: IpcMessage): void {
    const message = parseIpcMessage(raw)
    if (message === undefined) {
      console.error('[apiproxy] dropping malformed IPC message')
      return
    }
    switch (message.type) {
      case 'unary-request':
        this.beginUnary(message)
        return
      case 'unary-abort':
        this.abortedUnaries.add(message.id)
        this.unaries.get(message.id)?.abort()
        return
      case 'stream-open':
        this.beginStream(message.id, message.path)
        return
      case 'stream-abort':
        this.abortedStreams.add(message.id)
        this.streams.get(message.id)?.abort()
        return
      case 'unary-response':
      case 'unary-failure':
      case 'stream-frame':
      case 'stream-end':
        return
    }
  }

  private beginUnary(message: Extract<IpcMessage, { type: 'unary-request' }>): void {
    if (this.unaries.has(message.id)) {
      this.port.post({ type: 'unary-failure', id: message.id, message: 'duplicate unary id' })
      return
    }
    const ac = new AbortController()
    this.unaries.set(message.id, ac)
    if (this.abortedUnaries.delete(message.id)) ac.abort()
    this.track(this.runUnary(message, ac))
  }

  private async runUnary(
    message: Extract<IpcMessage, { type: 'unary-request' }>,
    ac: AbortController,
  ): Promise<void> {
    try {
      const init: RequestInit = {
        method: message.method,
        headers: message.headers,
        signal: ac.signal,
      }
      if (message.body !== undefined) init.body = message.body
      const response = await this.handler.fetch(new Request(message.url, init))
      if (ac.signal.aborted) return
      this.port.post({
        type: 'unary-response',
        id: message.id,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      })
    } catch (error: unknown) {
      if (ac.signal.aborted) return
      this.port.post({
        type: 'unary-failure',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.unaries.delete(message.id)
      this.abortedUnaries.delete(message.id)
    }
  }

  private beginStream(id: IpcId, path: string): void {
    if (this.streams.has(id)) {
      this.port.post({ type: 'stream-end', id, error: 'duplicate stream id' })
      return
    }
    const source = this.streamSource(path)
    if (source === undefined) {
      this.port.post({ type: 'stream-end', id, error: `unknown stream path: ${path}` })
      return
    }
    const ac = new AbortController()
    this.streams.set(id, ac)
    if (this.abortedStreams.delete(id)) ac.abort()
    this.track(this.runStream(id, source(ac.signal), ac))
  }

  private streamSource(
    path: string,
  ): ((signal: AbortSignal) => AsyncIterable<RpcRequest<MuxFrame | HostFrame>>) | undefined {
    if (path === IPC_MUX_PATH) {
      return signal => this.events.mux({ rpcId: RpcId(crypto.randomUUID()), payload: {} }, signal)
    }
    if (path === IPC_HOST_PATH) {
      return signal => this.events.host({ rpcId: RpcId(crypto.randomUUID()), payload: {} }, signal)
    }
    return undefined
  }

  private async runStream(
    id: IpcId,
    frames: AsyncIterable<RpcRequest<MuxFrame | HostFrame>>,
    ac: AbortController,
  ): Promise<void> {
    try {
      for await (const narrow of frames) {
        if (ac.signal.aborted) return
        this.port.post({ type: 'stream-frame', id, envelope: fullFrame(narrow) })
      }
      if (!ac.signal.aborted) this.port.post({ type: 'stream-end', id })
    } catch (error: unknown) {
      if (ac.signal.aborted) return
      this.port.post({
        type: 'stream-end',
        id,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.streams.delete(id)
      this.abortedStreams.delete(id)
    }
  }

  private track(task: Promise<void>): void {
    this.inflight.add(task)
    void task.finally(() => { this.inflight.delete(task) })
  }
}

/** Complete a narrow frame into a ServerRequest full form (method = frame type). */
function fullFrame(narrow: RpcRequest<MuxFrame | HostFrame>): ServerRequest {
  return { type: 'server-request', rpcId: narrow.rpcId, method: narrow.payload.type, payload: narrow.payload }
}
