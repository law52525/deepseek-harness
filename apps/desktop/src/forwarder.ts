/**
 * Opaque RPC envelope helpers. Main forwards `payload` by identity and never
 * JSON-parses RPC bodies.
 */

import {
  parseDesktopEnvelope,
  type DesktopControlMessage,
  type DesktopIpcEnvelope,
} from '@deepseek-ai/dsh-desktop-app/ipc-protocol'

/**
 * Wrap one RPC document for the child's process-IPC channel.
 * @param payload - an `IpcMessage` object; treated as opaque JSON.
 * @returns the `rpc` envelope.
 */
export function rpcEnvelope(payload: unknown): DesktopIpcEnvelope {
  return { channel: 'rpc', payload }
}

/**
 * Unwrap an RPC document arriving from the child. Control envelopes return undefined.
 * @param value - cloned `process` IPC value.
 * @returns the opaque RPC payload, or undefined when the value is not an rpc envelope.
 */
export function rpcPayloadFromChild(value: unknown): unknown | undefined {
  const envelope = parseDesktopEnvelope(value)
  if (envelope === undefined || envelope.channel !== 'rpc') return undefined
  return envelope.payload
}

/**
 * Unwrap a control document arriving from the child. RPC envelopes return undefined.
 * @param value - cloned `process` IPC value.
 * @returns the control document, or undefined when the value is not a control envelope.
 */
export function controlFromChild(value: unknown): DesktopControlMessage | undefined {
  const envelope = parseDesktopEnvelope(value)
  if (envelope === undefined || envelope.channel !== 'control') return undefined
  return envelope.payload
}

/**
 * Wrap one control document for the child's process-IPC channel.
 * @param payload - a typed control document.
 * @returns the `control` envelope.
 */
export function controlEnvelope(payload: DesktopControlMessage): DesktopIpcEnvelope {
  return { channel: 'control', payload }
}
