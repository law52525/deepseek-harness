/**
 * Desktop Host IPC adapter: when this process has a parent IPC channel it
 * constructs HostIpcGateway over process IPC, answers boot-graph, plugin-byte,
 * and Session-export control documents, and posts `host-ready` after Loader settle.
 * Unary RPC uses Connection's shared `/api` fetch so Typert remotes
 * (`commands/list`) reach the interceptor before the API Proxy fallback.
 * @module @deepseek-ai/dsh-desktop-app/ipc-host
 */

import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { HostIpcGateway, toFetchHandler, type IpcMessage, type IpcPort } from '@deepseek-ai/dsh-host-apiproxy'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, type ThemeSettings,
} from '@deepseek-ai/dsh-client-ui-theme'
import {
  isDesktopThemePreference,
  parseDesktopEnvelope,
  type DesktopControlToHost,
  type DesktopControlToShell,
  type DesktopIpcEnvelope,
  type DesktopThemePreference,
} from './ipc-protocol.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-ipc'

/** Wait for startup acceptance, the API gateway, the client graph, and Host Connection. */
export const inject = ['desktopStartup', 'apiProxy', 'clientModules', 'connection']

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Parent process IPC used by {@link attachDesktopIpcHost}. */
export interface DesktopIpcTransport {
  /**
   * Send one envelope to the parent.
   * @param value - RPC or control envelope.
   */
  send(value: DesktopIpcEnvelope): void
  /**
   * Receive envelopes from the parent.
   * @param handler - called with each received value.
   * @returns unsubscribe function.
   */
  onMessage(handler: (value: unknown) => void): () => void
}

/**
 * Wire HostIpcGateway and control handlers onto an IPC transport.
 * @param ctx - settled-enough Host context with apiProxy, clientModules, and connection.
 * @param ipc - parent process send/subscribe.
 */
export function attachDesktopIpcHost(ctx: Context, ipc: DesktopIpcTransport): void {
  const connection = ctx.get('connection')
  if (connection === undefined) throw new Error('desktop-ipc: connection unavailable')
  const rpcHandlers = new Set<(message: IpcMessage) => void>()
  const port: IpcPort = {
    post(message) {
      ipc.send({ channel: 'rpc', payload: message })
    },
    subscribe(handler) {
      rpcHandlers.add(handler)
      return () => { rpcHandlers.delete(handler) }
    },
  }
  const gateway = new HostIpcGateway(
    port,
    connection.createSharedFetchHandler('/api', toFetchHandler(ctx.apiProxy)),
    ctx.apiProxy.events,
  )
  const off = ipc.onMessage((raw) => {
    try {
      dispatchEnvelope(ctx, ipc, rpcHandlers, raw)
    } catch (error) {
      console.error('[desktop-ipc] host IPC dispatch threw:', error)
    }
  })
  ctx.effect(() => () => {
    off()
    void gateway.dispose()
  }, 'desktop-ipc: gateway')

  const announce = (): void => {
    sendControl(ipc, { type: 'host-ready' })
  }
  const settled = ctx.get('loader')?.await()
  if (settled === undefined) announce()
  else {
    void settled.then(announce, () => {
      // Loader reports a failed boot; this row stays quiet instead of faking ready.
    })
  }
}

/**
 * Attach when spawned with a parent IPC channel; a terminal `dsh desktop` has none.
 * @param ctx - plugin context after desktopStartup, apiProxy, and clientModules exist.
 */
export function apply(ctx: Context): void {
  const send = process.send
  if (send === undefined) return
  const boundSend = send.bind(process)
  attachDesktopIpcHost(ctx, {
    send(value) {
      boundSend(value)
    },
    onMessage(handler) {
      process.on('message', handler)
      return () => { process.off('message', handler) }
    },
  })
}

function dispatchEnvelope(
  ctx: Context,
  ipc: DesktopIpcTransport,
  rpcHandlers: Set<(message: IpcMessage) => void>,
  raw: unknown,
): void {
  const envelope = parseDesktopEnvelope(raw)
  if (envelope === undefined) {
    console.error('[desktop-ipc] dropping malformed IPC envelope')
    return
  }
  if (envelope.channel === 'rpc') {
    for (const handler of rpcHandlers) handler(envelope.payload as IpcMessage)
    return
  }
  if (envelope.channel === 'shell') return
  const message = envelope.payload
  switch (message.type) {
    case 'boot-graph-request':
      sendControl(ipc, {
        type: 'boot-graph-response',
        id: message.id,
        graph: ctx.clientModules.graph(),
        themePreference: readThemePreference(ctx),
      })
      return
    case 'plugin-bytes-request': {
      const path = ctx.clientModules.clientPath(message.pluginId)
      if (path === undefined) {
        sendControl(ipc, {
          type: 'plugin-bytes-failure',
          id: message.id,
          message: `unknown plugin ${message.pluginId}`,
        })
        return
      }
      void readFile(path, 'utf8').then(
        (bytes) => {
          sendControl(ipc, { type: 'plugin-bytes-response', id: message.id, bytes })
        },
        (error: unknown) => {
          sendControl(ipc, {
            type: 'plugin-bytes-failure',
            id: message.id,
            /* v8 ignore next -- fs.promises.readFile rejects with an Error */
            message: error instanceof Error ? error.message : String(error),
          })
        },
      )
      return
    }
    case 'session-export-request':
      void answerSessionExport(ctx, ipc, message)
      return
    case 'host-ready':
    case 'boot-graph-response':
    case 'plugin-bytes-response':
    case 'plugin-bytes-failure':
    case 'session-export-response':
    case 'session-export-failure':
      return
  }
}

const DOWNLOAD_HEADER_NAMES = ['content-type', 'content-disposition'] as const

/**
 * Run ApiProxy `session.export` and reply with status, download headers, and
 * a temp ZIP path for GET bodies. JSON RPC cannot carry those bytes.
 * @param ctx - Host context with apiProxy.
 * @param ipc - parent process send/subscribe.
 * @param message - GET or HEAD export request from the shell.
 */
async function answerSessionExport(
  ctx: Context,
  ipc: DesktopIpcTransport,
  message: Extract<DesktopControlToHost, { type: 'session-export-request' }>,
): Promise<void> {
  try {
    const url = new URL('http://dsh.internal/api/session.export')
    url.searchParams.set('sessionId', message.sessionId)
    url.searchParams.set('includeDescendants', message.includeDescendants ? 'true' : 'false')
    const response = await toFetchHandler(ctx.apiProxy).fetch(new Request(url, { method: message.method }))
    const headers = downloadHeaders(response.headers)
    if (message.method === 'HEAD' || response.body === null) {
      sendControl(ipc, {
        type: 'session-export-response',
        id: message.id,
        status: response.status,
        headers,
      })
      return
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) {
      sendControl(ipc, {
        type: 'session-export-response',
        id: message.id,
        status: response.status,
        headers,
      })
      return
    }
    // Mint the filename here so a correlation id cannot escape os.tmpdir().
    const bodyPath = join(tmpdir(), `dsh-session-export-${crypto.randomUUID()}.zip`)
    await writeFile(bodyPath, bytes)
    sendControl(ipc, {
      type: 'session-export-response',
      id: message.id,
      status: response.status,
      headers,
      bodyPath,
    })
  } catch (error: unknown) {
    sendControl(ipc, {
      type: 'session-export-failure',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Keep only headers Chromium needs for the attachment download.
 * @param headers - Host download response headers.
 * @returns content-type and content-disposition when present.
 */
function downloadHeaders(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  for (const name of DOWNLOAD_HEADER_NAMES) {
    const value = headers.get(name)
    if (value !== null) record[name] = value
  }
  return record
}

function sendControl(ipc: DesktopIpcTransport, payload: DesktopControlToShell): void {
  ipc.send({ channel: 'control', payload })
}

function readThemePreference(ctx: Context): DesktopThemePreference {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_PREFERENCE
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return DEFAULT_PREFERENCE
  return isDesktopThemePreference(section.preference) ? section.preference : DEFAULT_PREFERENCE
}
