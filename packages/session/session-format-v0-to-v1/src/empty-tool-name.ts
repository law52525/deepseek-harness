import { isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatEvent,
  SessionFormatEventRun,
  SessionFormatJsonObject,
  SessionFormatJsonValue,
} from '@deepseek-ai/dsh-session-format'
import { isReleasedAssistantChunkRun, type ReleasedAssistantChunkRun } from './codec.ts'

/** Name substituted for a historical tool call that recorded an empty, whitespace-only, or null name. */
export const INVALID_TOOL_CALL_NAME = 'invalid_tool_call'

/**
 * How one adjacent edge rewrites vacant historical tool names.
 * v0→v1 rewrites only blank strings so a later fragment may still supply a real name;
 * v1→v2 omits `tool-call-delta` `name: null` (streaming “this fragment did not carry name”)
 * and rewrites remaining null or blank names to {@link INVALID_TOOL_CALL_NAME}.
 */
export interface VacantToolNameRewrite {
  readonly treatNullAsVacant: boolean
  readonly omitNullToolCallDelta: boolean
}

/** v0→v1: rewrite blank strings only; leave `null` for the v1→v2 delta rule. */
export const V0_VACANT_TOOL_NAME_REWRITE: VacantToolNameRewrite = {
  treatNullAsVacant: false,
  omitNullToolCallDelta: false,
}

/** v1→v2: omit null deltas; rewrite other null or blank tool names. */
export const V1_VACANT_TOOL_NAME_REWRITE: VacantToolNameRewrite = {
  treatNullAsVacant: true,
  omitNullToolCallDelta: true,
}

/**
 * Whether a historical tool name is an empty or whitespace-only string.
 * @param value - candidate name from a tool-call payload.
 * @returns true only for blank strings; null, omitted, and non-blank strings are false.
 */
export function isBlankToolName(value: SessionFormatJsonValue | undefined): boolean {
  return typeof value === 'string' && value.trim() === ''
}

/**
 * Rewrite vacant tool names on one released event. Non-tool payloads and non-blank names are unchanged.
 * @param event - decoded released event.
 * @param options - adjacent-edge rewrite policy.
 * @returns a new event when a name changed; otherwise the original event.
 */
export function rewriteReleasedVacantToolNames(
  event: SessionFormatEvent,
  options: VacantToolNameRewrite,
): SessionFormatEvent {
  const data = event.data
  if (!isJsonRecord(data)) return event
  switch (event.type) {
    case 'assistant/chunk': {
      const chunk = data['chunk']
      if (!isJsonRecord(chunk)) return event
      const nextChunk = rewriteChunk(chunk, options)
      if (nextChunk === undefined) return event
      return { ...event, data: { ...data, chunk: nextChunk } }
    }
    case 'assistant/message': {
      const message = data['message']
      if (!isJsonRecord(message)) return event
      const content = message['content']
      if (!Array.isArray(content)) return event
      const nextContent = rewriteToolCallBlocks(content, options)
      if (nextContent === undefined) return event
      return { ...event, data: { ...data, message: { ...message, content: nextContent } } }
    }
    case 'tool/call': {
      const next = rewriteName(data, nullPolicy(options, false))
      if (next === undefined) return event
      return { ...event, data: next }
    }
    default:
      return event
  }
}

/**
 * Rewrite a vacant `name` on a packed `tool-call-chunks` run. Other runs are unchanged.
 * @param run - compact migration item.
 * @param options - adjacent-edge rewrite policy.
 * @returns a run whose `stream` and `expand()` agree after the rewrite.
 */
export function rewriteReleasedVacantToolNameRun(
  run: SessionFormatEventRun,
  options: VacantToolNameRewrite,
): SessionFormatEventRun {
  if (!isReleasedAssistantChunkRun(run)) return run
  const stream = run.stream
  if (stream['type'] !== 'tool-call-chunks') return run
  const nextStream = rewriteName(stream, nullPolicy(options, false))
  if (nextStream === undefined) return run
  const rewritten: ReleasedAssistantChunkRun = {
    ...run,
    stream: nextStream,
    *expand() {
      for (const event of run.expand()) yield rewriteReleasedVacantToolNames(event, options)
    },
  }
  return rewritten
}

function nullPolicy(options: VacantToolNameRewrite, omitNull: boolean): 'omit' | 'vacant' | 'ignore' {
  if (omitNull && options.omitNullToolCallDelta) return 'omit'
  if (options.treatNullAsVacant) return 'vacant'
  return 'ignore'
}

function rewriteChunk(
  chunk: SessionFormatJsonObject,
  options: VacantToolNameRewrite,
): SessionFormatJsonObject | undefined {
  if (chunk['type'] === 'tool-call-delta') {
    return rewriteName(chunk, nullPolicy(options, true))
  }
  if (chunk['type'] !== 'block-end') return undefined
  const block = chunk['block']
  if (!isJsonRecord(block) || block['type'] !== 'tool-call') return undefined
  const nextBlock = rewriteName(block, nullPolicy(options, false))
  if (nextBlock === undefined) return undefined
  return { ...chunk, block: nextBlock }
}

function rewriteToolCallBlocks(
  content: readonly SessionFormatJsonValue[],
  options: VacantToolNameRewrite,
): SessionFormatJsonValue[] | undefined {
  let changed = false
  const next = content.map((block) => {
    if (!isJsonRecord(block) || block['type'] !== 'tool-call') return block
    const rewritten = rewriteName(block, nullPolicy(options, false))
    if (rewritten === undefined) return block
    changed = true
    return rewritten
  })
  return changed ? next : undefined
}

function rewriteName(
  record: SessionFormatJsonObject,
  policy: 'omit' | 'vacant' | 'ignore',
): SessionFormatJsonObject | undefined {
  if (!Object.hasOwn(record, 'name')) return undefined
  const name = record['name']
  if (name === null) {
    if (policy === 'omit') return omitName(record)
    if (policy === 'vacant') return { ...record, name: INVALID_TOOL_CALL_NAME }
    return undefined
  }
  if (!isBlankToolName(name)) return undefined
  return { ...record, name: INVALID_TOOL_CALL_NAME }
}

function omitName(record: SessionFormatJsonObject): SessionFormatJsonObject {
  const next: Record<string, SessionFormatJsonValue> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'name') continue
    next[key] = value
  }
  return next
}

function isJsonRecord(value: SessionFormatJsonValue | undefined): value is SessionFormatJsonObject {
  return isSessionFormatJsonObject(value)
}
