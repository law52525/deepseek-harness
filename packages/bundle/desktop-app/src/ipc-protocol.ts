/**
 * Process-IPC envelope between the Electron shell and the desktop Host child.
 * RPC documents stay opaque on the `rpc` channel so main never decodes bodies.
 * Control documents travel on `control` for handshake, boot graph, plugin bytes,
 * and Session-log export (a Host-written temp ZIP path, never JSON RPC bytes).
 * @module @deepseek-ai/dsh-desktop-app/ipc-protocol
 */

import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'

export type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** Built-in theme preference copied beside the boot graph (no HTTP index tap). */
export type DesktopThemePreference = 'light' | 'dark' | 'system'

/** HTTP methods the `dsh:` Session-export handler may forward. */
export type DesktopSessionExportMethod = 'GET' | 'HEAD'

/** Control documents the shell sends to the Host child. */
export type DesktopControlToHost =
  | { type: 'boot-graph-request'; id: string }
  | { type: 'plugin-bytes-request'; id: string; pluginId: string }
  | {
    type: 'session-export-request'
    id: string
    method: DesktopSessionExportMethod
    sessionId: string
    includeDescendants: boolean
  }

/** Control documents the Host child sends to the shell. */
export type DesktopControlToShell =
  | { type: 'host-ready' }
  | { type: 'boot-graph-response'; id: string; graph: WebBootGraph; themePreference: DesktopThemePreference }
  | { type: 'plugin-bytes-response'; id: string; bytes: string }
  | { type: 'plugin-bytes-failure'; id: string; message: string }
  | {
    type: 'session-export-response'
    id: string
    status: number
    headers: Record<string, string>
    bodyPath?: string
  }
  | { type: 'session-export-failure'; id: string; message: string }

/** Every control document that may appear on the process IPC channel. */
export type DesktopControlMessage = DesktopControlToHost | DesktopControlToShell

/** Host → shell requests that need a BrowserWindow (generic; callers supply URLs). */
export type DesktopShellToParent =
  | {
    type: 'open-auth-window'
    id: string
    url: string
    callbackUrlPrefix: string
    width?: number
    height?: number
    timeoutMs?: number
  }
  | {
    type: 'arm-blocking-overlay'
    id: string
    timeoutMs: number
    title: string
    body: string
    failedInstallTitle?: string
    failedInstallBody?: string
  }
  | { type: 'overlay-rendered'; id: string }
  | { type: 'disarm-blocking-overlay'; id: string }
  | { type: 'check-for-updates'; id: string; feedUrl: string }
  | { type: 'blocking-overlay-fatal'; id: string; detail: string }

/** Shell → Host replies for {@link DesktopShellToParent}. */
export type DesktopShellToChild =
  | {
    type: 'open-auth-window-result'
    id: string
    callbackUrl?: string
    canceled?: true
  }

export type DesktopShellMessage = DesktopShellToParent | DesktopShellToChild

/** One process-IPC envelope. RPC `payload` is an `IpcMessage` object; main must not parse it. */
export type DesktopIpcEnvelope =
  | { channel: 'rpc'; payload: unknown }
  | { channel: 'control'; payload: DesktopControlMessage }
  | { channel: 'shell'; payload: DesktopShellMessage }

const THEME_PREFERENCES: readonly DesktopThemePreference[] = ['light', 'dark', 'system']

/**
 * Whether a value is a persistable built-in theme preference.
 * @param value - candidate from settings or a control document.
 * @returns whether the value is light, dark, or system.
 */
export function isDesktopThemePreference(value: unknown): value is DesktopThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Parse one process-IPC envelope. RPC payloads are not validated here.
 * @param value - cloned `process.send` / Electron IPC payload.
 * @returns the envelope, or undefined when the channel tag is missing or control is malformed.
 */
export function parseDesktopEnvelope(value: unknown): DesktopIpcEnvelope | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.channel === 'rpc') return { channel: 'rpc', payload: record.payload }
  if (record.channel === 'control') {
    const payload = parseControl(record.payload)
    return payload === undefined ? undefined : { channel: 'control', payload }
  }
  if (record.channel === 'shell') {
    const payload = parseShell(record.payload)
    return payload === undefined ? undefined : { channel: 'shell', payload }
  }
  return undefined
}

/**
 * Parse a shell-channel document (Host ↔ Electron main, not RPC).
 * @param value - the `shell` channel payload.
 * @returns the typed document, or undefined when required fields are missing.
 */
export function parseDesktopShell(value: unknown): DesktopShellMessage | undefined {
  return parseShell(value)
}

function parseShell(value: unknown): DesktopShellMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'open-auth-window':
      return typeof record.id === 'string' && record.id !== ''
        && typeof record.url === 'string' && record.url !== ''
        && typeof record.callbackUrlPrefix === 'string' && record.callbackUrlPrefix !== ''
        && (record.width === undefined || typeof record.width === 'number')
        && (record.height === undefined || typeof record.height === 'number')
        && (record.timeoutMs === undefined || typeof record.timeoutMs === 'number')
        ? {
          type: 'open-auth-window',
          id: record.id,
          url: record.url,
          callbackUrlPrefix: record.callbackUrlPrefix,
          ...typeof record.width === 'number' ? { width: record.width } : {},
          ...typeof record.height === 'number' ? { height: record.height } : {},
          ...typeof record.timeoutMs === 'number' ? { timeoutMs: record.timeoutMs } : {},
        }
        : undefined
    case 'open-auth-window-result':
      return typeof record.id === 'string' && record.id !== ''
        && (record.callbackUrl === undefined || typeof record.callbackUrl === 'string')
        && (record.canceled === undefined || record.canceled === true)
        ? {
          type: 'open-auth-window-result',
          id: record.id,
          ...typeof record.callbackUrl === 'string' ? { callbackUrl: record.callbackUrl } : {},
          ...record.canceled === true ? { canceled: true as const } : {},
        }
        : undefined
    case 'arm-blocking-overlay':
      return typeof record.id === 'string' && record.id !== ''
        && typeof record.timeoutMs === 'number'
        && typeof record.title === 'string'
        && typeof record.body === 'string'
        ? {
          type: 'arm-blocking-overlay' as const,
          id: record.id,
          timeoutMs: record.timeoutMs,
          title: record.title,
          body: record.body,
          ...typeof record.failedInstallTitle === 'string' && typeof record.failedInstallBody === 'string'
            ? { failedInstallTitle: record.failedInstallTitle, failedInstallBody: record.failedInstallBody }
            : {},
        }
        : undefined
    case 'overlay-rendered':
      return typeof record.id === 'string' && record.id !== ''
        ? { type: 'overlay-rendered', id: record.id }
        : undefined
    case 'disarm-blocking-overlay':
      return typeof record.id === 'string' && record.id !== ''
        ? { type: 'disarm-blocking-overlay', id: record.id }
        : undefined
    case 'check-for-updates':
      return typeof record.id === 'string' && record.id !== ''
        && typeof record.feedUrl === 'string' && record.feedUrl !== ''
        ? { type: 'check-for-updates', id: record.id, feedUrl: record.feedUrl }
        : undefined
    case 'blocking-overlay-fatal':
      return typeof record.id === 'string' && record.id !== ''
        && typeof record.detail === 'string' && record.detail !== ''
        ? { type: 'blocking-overlay-fatal', id: record.id, detail: record.detail }
        : undefined
    default:
      return undefined
  }
}

/**
 * Parse a control document.
 * @param value - the `control` channel payload.
 * @returns the typed document, or undefined when required fields are missing.
 */
export function parseDesktopControl(value: unknown): DesktopControlMessage | undefined {
  return parseControl(value)
}

function parseControl(value: unknown): DesktopControlMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'host-ready':
      return { type: 'host-ready' }
    case 'boot-graph-request':
      return typeof record.id === 'string' && record.id !== ''
        ? { type: 'boot-graph-request', id: record.id }
        : undefined
    case 'boot-graph-response':
      return typeof record.id === 'string' && record.id !== ''
        && isGraph(record.graph) && isDesktopThemePreference(record.themePreference)
        ? {
          type: 'boot-graph-response',
          id: record.id,
          graph: record.graph,
          themePreference: record.themePreference,
        }
        : undefined
    case 'plugin-bytes-request':
      return typeof record.id === 'string' && record.id !== ''
        && typeof record.pluginId === 'string' && record.pluginId !== ''
        ? { type: 'plugin-bytes-request', id: record.id, pluginId: record.pluginId }
        : undefined
    case 'plugin-bytes-response':
      return typeof record.id === 'string' && record.id !== '' && typeof record.bytes === 'string'
        ? { type: 'plugin-bytes-response', id: record.id, bytes: record.bytes }
        : undefined
    case 'plugin-bytes-failure':
      return typeof record.id === 'string' && record.id !== '' && typeof record.message === 'string'
        ? { type: 'plugin-bytes-failure', id: record.id, message: record.message }
        : undefined
    case 'session-export-request':
      return typeof record.id === 'string' && record.id !== ''
        && (record.method === 'GET' || record.method === 'HEAD')
        && typeof record.sessionId === 'string'
        && typeof record.includeDescendants === 'boolean'
        ? {
          type: 'session-export-request',
          id: record.id,
          method: record.method,
          sessionId: record.sessionId,
          includeDescendants: record.includeDescendants,
        }
        : undefined
    case 'session-export-response':
      return typeof record.id === 'string' && record.id !== ''
        && typeof record.status === 'number'
        && isHeaderRecord(record.headers)
        && (record.bodyPath === undefined || typeof record.bodyPath === 'string')
        ? {
          type: 'session-export-response',
          id: record.id,
          status: record.status,
          headers: record.headers,
          ...typeof record.bodyPath === 'string' ? { bodyPath: record.bodyPath } : {},
        }
        : undefined
    case 'session-export-failure':
      return typeof record.id === 'string' && record.id !== '' && typeof record.message === 'string'
        ? { type: 'session-export-failure', id: record.id, message: record.message }
        : undefined
    default:
      return undefined
  }
}

function isGraph(value: unknown): value is WebBootGraph {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.rev === 'string' && Array.isArray(record.entries)
}

function isHeaderRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(entry => typeof entry === 'string')
}
