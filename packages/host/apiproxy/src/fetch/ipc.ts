/**
 * JSON IPC documents that wrap the four-quadrant fetch protocol onto a port.
 * One object per `IpcPort.post`. Bodies are UTF-8 strings (JSON RPC); this
 * carrier cannot carry binary. Correlation `id` values are distinct from
 * `RpcId`: they name one unary call or one downlink stream on the port.
 */

import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Mux downlink path, matching the in-process SSE and browser WebSocket routes. */
export const IPC_MUX_PATH = '/api/events.mux'

/** Host downlink path, matching the in-process SSE and browser WebSocket routes. */
export const IPC_HOST_PATH = '/api/events.host'

/**
 * IPC correlation id: the client mints one per unary call and per downlink
 * stream. Distinct from `RpcId`, which correlates four-quadrant envelopes.
 */
export type IpcId = Branded<'ipc-id'>

/**
 * Brands a string as an IPC correlation id.
 * @param id - raw id string (implementations mint UUIDs; tests may pass fixtures).
 * @returns the same string, branded (compile-time cast, zero runtime cost).
 */
export function IpcId(id: string): IpcId {
  return id as IpcId
}

const ipcIdSchema = z.string().min(1) as unknown as z.ZodType<IpcId>

const headersSchema = z.record(z.string(), z.string())

const unaryRequestSchema = z.object({
  type: z.literal('unary-request'),
  id: ipcIdSchema,
  url: z.string(),
  method: z.string(),
  headers: headersSchema,
  body: z.string().optional(),
})

const unaryResponseSchema = z.object({
  type: z.literal('unary-response'),
  id: ipcIdSchema,
  status: z.number(),
  headers: headersSchema,
  body: z.string(),
})

const unaryFailureSchema = z.object({
  type: z.literal('unary-failure'),
  id: ipcIdSchema,
  message: z.string(),
})

const unaryAbortSchema = z.object({
  type: z.literal('unary-abort'),
  id: ipcIdSchema,
})

const streamOpenSchema = z.object({
  type: z.literal('stream-open'),
  id: ipcIdSchema,
  path: z.string(),
})

const streamFrameSchema = z.object({
  type: z.literal('stream-frame'),
  id: ipcIdSchema,
  envelope: z.unknown(),
})

const streamEndSchema = z.object({
  type: z.literal('stream-end'),
  id: ipcIdSchema,
  error: z.string().optional(),
})

const streamAbortSchema = z.object({
  type: z.literal('stream-abort'),
  id: ipcIdSchema,
})

const ipcMessageSchema = z.discriminatedUnion('type', [
  unaryRequestSchema,
  unaryResponseSchema,
  unaryFailureSchema,
  unaryAbortSchema,
  streamOpenSchema,
  streamFrameSchema,
  streamEndSchema,
  streamAbortSchema,
])

/** One JSON document on the IPC port, discriminated by `type`. */
export type IpcMessage = z.infer<typeof ipcMessageSchema>

/**
 * Bidirectional JSON document port. Tests implement this with `MessageChannel`
 * or a pair of EventEmitters. The Electron shell adapts `ipcMain` /
 * `ipcRenderer` (and Node child `process` IPC) without changing message types.
 */
export interface IpcPort {
  /**
   * Send one document to the peer.
   * @param message - a single IPC document.
   */
  post(message: IpcMessage): void
  /**
   * Receive documents from the peer.
   * @param handler - called with each received document.
   * @returns unsubscribe function.
   */
  subscribe(handler: (message: IpcMessage) => void): () => void
}

/**
 * Parse one IPC document. Malformed values return undefined so a corrupt
 * message cannot kill the carrier.
 * @param value - cloned `post` payload.
 * @returns the typed document, or undefined when validation fails.
 */
export function parseIpcMessage(value: unknown): IpcMessage | undefined {
  const parsed = ipcMessageSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
