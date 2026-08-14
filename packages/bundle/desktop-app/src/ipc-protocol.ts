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

/** One process-IPC envelope. RPC `payload` is an `IpcMessage` object; main must not parse it. */
export type DesktopIpcEnvelope =
  | { channel: 'rpc'; payload: unknown }
  | { channel: 'control'; payload: DesktopControlMessage }

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
  return undefined
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
