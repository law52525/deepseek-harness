import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatEventRun, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import {
  INVALID_TOOL_CALL_NAME,
  V0_VACANT_TOOL_NAME_REWRITE,
  V1_VACANT_TOOL_NAME_REWRITE,
  isBlankToolName,
  isReleasedAssistantChunkRun,
  rewriteReleasedVacantToolNameRun,
  rewriteReleasedVacantToolNames,
  sessionFormatV0ToV1,
  type ReleasedAssistantChunkRun,
} from '../src/index.ts'
import { restoreV0ToV1 } from '../src/testing/restore.ts'

function packedAssistantRun(
  stream: SessionFormatJsonObject,
  expand: ReleasedAssistantChunkRun['expand'] = function* () {},
): ReleasedAssistantChunkRun {
  return {
    runType: 'released-assistant-chunks',
    firstSeq: 0,
    eventCount: 1,
    turn: 1,
    step: 1,
    lastSeq: 0,
    lastTime: 1,
    stream,
    expand,
  }
}

const v0Header = {
  type: 'session', version: 0, id: 'empty-tool', createdAt: 1, delegationDepth: 0,
}

const toolCall = (name: string) => ({ type: 'tool-call' as const, id: 'call', name, arguments: '{}' })

function emptyNameSession(name: string) {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/chunk', seq: 2, time: 3,
      data: {
        turn: 1, step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'call', name, argumentsDelta: '{}' },
      },
    },
    {
      type: 'assistant/chunk', seq: 3, time: 4,
      data: {
        turn: 1, step: 1,
        chunk: { type: 'block-end', index: 0, block: toolCall(name) },
      },
    },
    {
      type: 'assistant/message', seq: 4, time: 5, sourceEventSeqs: [2, 3], surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: {
          id: 'assistant', role: 'assistant', content: [toolCall(name)],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        },
      },
    },
    { type: 'tool/call', seq: 5, time: 6, data: { turn: 1, step: 1, callId: 'call', name, arguments: '{}' } },
    {
      type: 'tool/result', seq: 6, time: 7, sourceEventSeqs: [5], surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: {
          id: 'result', role: 'user',
          content: [{
            type: 'tool-result', toolCallId: 'call',
            content: [{ type: 'text', text: 'Error: unknown tool ""' }], isError: true,
          }],
          source: { kind: 'tool', callId: 'call' },
        },
      },
    },
    { type: 'step/end', seq: 7, time: 8, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 8, time: 9, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

function namesOf(events: readonly SessionFormatEvent[]): string[] {
  const names: string[] = []
  for (const event of events) {
    if (event.type === 'assistant/chunk') {
      const data = event.data as { chunk: { type: string; name?: string; block?: { name?: string } } }
      if (data.chunk.type === 'tool-call-delta' && data.chunk.name !== undefined) names.push(data.chunk.name)
      if (data.chunk.type === 'block-end' && data.chunk.block?.name !== undefined) names.push(data.chunk.block.name)
    }
    if (event.type === 'assistant/message') {
      const content = (event.data as { message: { content: Array<{ type: string; name?: string }> } })
        .message.content
      for (const block of content) {
        if (block.type === 'tool-call' && block.name !== undefined) names.push(block.name)
      }
    }
    if (event.type === 'tool/call') names.push((event.data as { name: string }).name)
  }
  return names
}

function resultCallId(events: readonly SessionFormatEvent[]): string | undefined {
  const result = events.find(event => event.type === 'tool/result')
  return (result?.data as { message: { source: { callId: string } } } | undefined)?.message.source.callId
}

describe('vacant tool-name rewrite', () => {
  it('classifies only empty and whitespace strings as blank', () => {
    expect(isBlankToolName('')).toBe(true)
    expect(isBlankToolName(' \t')).toBe(true)
    expect(isBlankToolName('read')).toBe(false)
    expect(isBlankToolName(null)).toBe(false)
    expect(isBlankToolName(1)).toBe(false)
    expect(isBlankToolName(undefined)).toBe(false)
  })

  it('leaves non-object data, non-tool chunks, and non-blank names unchanged', () => {
    const unrelated: SessionFormatEvent = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }
    expect(rewriteReleasedVacantToolNames(unrelated, V0_VACANT_TOOL_NAME_REWRITE)).toBe(unrelated)

    const scalarChunk: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1, data: { turn: 1, step: 1, chunk: 'x' },
    }
    expect(rewriteReleasedVacantToolNames(scalarChunk, V0_VACANT_TOOL_NAME_REWRITE)).toBe(scalarChunk)

    const scalar: SessionFormatEvent = { type: 'tool/call', seq: 0, time: 1, data: 'scalar' }
    expect(rewriteReleasedVacantToolNames(scalar, V0_VACANT_TOOL_NAME_REWRITE)).toBe(scalar)

    const scalarChunkData: SessionFormatEvent = { type: 'assistant/chunk', seq: 0, time: 1, data: 'scalar' }
    expect(rewriteReleasedVacantToolNames(scalarChunkData, V0_VACANT_TOOL_NAME_REWRITE)).toBe(scalarChunkData)

    const text: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } },
    }
    expect(rewriteReleasedVacantToolNames(text, V0_VACANT_TOOL_NAME_REWRITE)).toBe(text)

    const omitted: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'call', argumentsDelta: '{}' } },
    }
    expect(rewriteReleasedVacantToolNames(omitted, V0_VACANT_TOOL_NAME_REWRITE)).toBe(omitted)

    const legal: SessionFormatEvent = {
      type: 'tool/call', seq: 0, time: 1,
      data: { turn: 1, step: 1, callId: 'call', name: 'read', arguments: '{}' },
    }
    expect(rewriteReleasedVacantToolNames(legal, V0_VACANT_TOOL_NAME_REWRITE)).toBe(legal)
    expect(rewriteReleasedVacantToolNames(legal, V1_VACANT_TOOL_NAME_REWRITE)).toBe(legal)

    const blankCall: SessionFormatEvent = {
      type: 'tool/call', seq: 0, time: 1,
      data: { turn: 1, step: 1, callId: 'call', name: '', arguments: '{}' },
    }
    expect(
      (rewriteReleasedVacantToolNames(blankCall, V0_VACANT_TOOL_NAME_REWRITE).data as { name: string }).name,
    ).toBe(INVALID_TOOL_CALL_NAME)
  })

  it('omits null tool-call-delta names only on the v1 policy', () => {
    const event: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: {
        turn: 1, step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'call', name: null, argumentsDelta: '{}' },
      },
    }
    expect(rewriteReleasedVacantToolNames(event, V0_VACANT_TOOL_NAME_REWRITE)).toBe(event)
    const omitted = rewriteReleasedVacantToolNames(event, V1_VACANT_TOOL_NAME_REWRITE)
    expect((omitted.data as { chunk: { name?: unknown } }).chunk.name).toBeUndefined()
    expect(Object.hasOwn((omitted.data as { chunk: object }).chunk, 'name')).toBe(false)
  })

  it('rewrites null block-end and tool/call names only when treatNullAsVacant is set', () => {
    const blockEnd: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: {
        turn: 1, step: 1,
        chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call', name: null, arguments: '{}' } },
      },
    }
    expect(rewriteReleasedVacantToolNames(blockEnd, V0_VACANT_TOOL_NAME_REWRITE)).toBe(blockEnd)
    const rewritten = rewriteReleasedVacantToolNames(blockEnd, V1_VACANT_TOOL_NAME_REWRITE)
    expect((rewritten.data as { chunk: { block: { name: string } } }).chunk.block.name)
      .toBe(INVALID_TOOL_CALL_NAME)

    const call: SessionFormatEvent = {
      type: 'tool/call', seq: 0, time: 1,
      data: { turn: 1, step: 1, callId: 'call', name: null, arguments: '{}' },
    }
    expect(rewriteReleasedVacantToolNames(call, V0_VACANT_TOOL_NAME_REWRITE)).toBe(call)
    expect((rewriteReleasedVacantToolNames(call, V1_VACANT_TOOL_NAME_REWRITE).data as { name: string }).name)
      .toBe(INVALID_TOOL_CALL_NAME)
  })

  it('rewrites a delta null to the placeholder when omit is off but null is vacant', () => {
    const event: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: {
        turn: 1, step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'call', name: null, argumentsDelta: '{}' },
      },
    }
    const rewritten = rewriteReleasedVacantToolNames(event, {
      treatNullAsVacant: true, omitNullToolCallDelta: false,
    })
    expect((rewritten.data as { chunk: { name: string } }).chunk.name).toBe(INVALID_TOOL_CALL_NAME)
  })

  it('leaves assistant/message payloads without tool-call blocks unchanged', () => {
    const missingMessage: SessionFormatEvent = {
      type: 'assistant/message', seq: 0, time: 1, data: { turn: 1, step: 1 },
    }
    expect(rewriteReleasedVacantToolNames(missingMessage, V0_VACANT_TOOL_NAME_REWRITE)).toBe(missingMessage)

    const scalarMessage: SessionFormatEvent = {
      type: 'assistant/message', seq: 0, time: 1, data: { turn: 1, step: 1, message: 'x' },
    }
    expect(rewriteReleasedVacantToolNames(scalarMessage, V0_VACANT_TOOL_NAME_REWRITE)).toBe(scalarMessage)

    const nonArray: SessionFormatEvent = {
      type: 'assistant/message', seq: 0, time: 1,
      data: { turn: 1, step: 1, message: { id: 'a', role: 'assistant', content: 'x', source: { kind: 'model' } } },
    }
    expect(rewriteReleasedVacantToolNames(nonArray, V0_VACANT_TOOL_NAME_REWRITE)).toBe(nonArray)

    const mixed: SessionFormatEvent = {
      type: 'assistant/message', seq: 0, time: 1,
      data: {
        turn: 1, step: 1,
        message: {
          id: 'a', role: 'assistant',
          content: [{ type: 'text', text: 'hi' }, 1, { type: 'tool-call', id: 'call', name: 'read', arguments: '{}' }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        },
      },
    }
    expect(rewriteReleasedVacantToolNames(mixed, V0_VACANT_TOOL_NAME_REWRITE)).toBe(mixed)

    const vacant: SessionFormatEvent = {
      type: 'assistant/message', seq: 0, time: 1,
      data: {
        turn: 1, step: 1,
        message: {
          id: 'a', role: 'assistant',
          content: [{ type: 'tool-call', id: 'call', name: ' ', arguments: '{}' }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        },
      },
    }
    expect(
      (rewriteReleasedVacantToolNames(vacant, V0_VACANT_TOOL_NAME_REWRITE).data as {
        message: { content: Array<{ name: string }> }
      }).message.content[0]?.name,
    ).toBe(INVALID_TOOL_CALL_NAME)
  })

  it('leaves block-end payloads that are not vacant tool-call blocks unchanged', () => {
    const scalarBlock: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: 'x' } },
    }
    expect(rewriteReleasedVacantToolNames(scalarBlock, V1_VACANT_TOOL_NAME_REWRITE)).toBe(scalarBlock)

    const textBlock: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } } },
    }
    expect(rewriteReleasedVacantToolNames(textBlock, V1_VACANT_TOOL_NAME_REWRITE)).toBe(textBlock)

    const missingName: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1,
      data: {
        turn: 1, step: 1,
        chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call', arguments: '{}' } },
      },
    }
    expect(rewriteReleasedVacantToolNames(missingName, V1_VACANT_TOOL_NAME_REWRITE)).toBe(missingName)

    const missingChunk: SessionFormatEvent = {
      type: 'assistant/chunk', seq: 0, time: 1, data: { turn: 1, step: 1 },
    }
    expect(rewriteReleasedVacantToolNames(missingChunk, V0_VACANT_TOOL_NAME_REWRITE)).toBe(missingChunk)
  })

  it('rewrites packed tool-call-chunks runs and leaves other runs unchanged', () => {
    const generic: SessionFormatEventRun = {
      runType: 'test-run', firstSeq: 0, eventCount: 1, *expand() {},
    }
    expect(rewriteReleasedVacantToolNameRun(generic, V0_VACANT_TOOL_NAME_REWRITE)).toBe(generic)

    const textRun = packedAssistantRun({ type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['a'] })
    expect(rewriteReleasedVacantToolNameRun(textRun, V0_VACANT_TOOL_NAME_REWRITE)).toBe(textRun)

    const omittedName = packedAssistantRun({
      type: 'tool-call-chunks', time0: 1, index: 0, id: 'call', dt: [], args: ['{}'],
    })
    expect(rewriteReleasedVacantToolNameRun(omittedName, V0_VACANT_TOOL_NAME_REWRITE)).toBe(omittedName)

    const legal = packedAssistantRun({
      type: 'tool-call-chunks', time0: 1, index: 0, id: 'call', name: 'read', dt: [], args: ['{}'],
    })
    expect(rewriteReleasedVacantToolNameRun(legal, V0_VACANT_TOOL_NAME_REWRITE)).toBe(legal)

    const blank = packedAssistantRun(
      { type: 'tool-call-chunks', time0: 1, index: 0, id: 'call', name: '', dt: [], args: ['{}'] },
      function* () {
        yield {
          type: 'assistant/chunk', seq: 0, time: 1,
          data: {
            turn: 1, step: 1,
            chunk: { type: 'tool-call-delta', index: 0, id: 'call', name: '', argumentsDelta: '{}' },
          },
        }
      },
    )
    const rewritten = rewriteReleasedVacantToolNameRun(blank, V0_VACANT_TOOL_NAME_REWRITE)
    expect(rewritten).not.toBe(blank)
    expect(isReleasedAssistantChunkRun(rewritten)).toBe(true)
    if (!isReleasedAssistantChunkRun(rewritten)) throw new Error('expected packed Assistant run')
    expect(rewritten.stream['name']).toBe(INVALID_TOOL_CALL_NAME)
    expect([...rewritten.expand()][0]).toMatchObject({
      data: { chunk: { name: INVALID_TOOL_CALL_NAME } },
    })
  })
})

describe('released Session format v0 to v1 vacant tool names', () => {
  it('rewrites empty names on all four tool-call locations and keeps tool/result callId', () => {
    const migrated = restoreV0ToV1(v0Header, emptyNameSession(''))
    expect(namesOf(migrated.events)).toEqual([
      INVALID_TOOL_CALL_NAME, INVALID_TOOL_CALL_NAME, INVALID_TOOL_CALL_NAME, INVALID_TOOL_CALL_NAME,
    ])
    expect(resultCallId(migrated.events)).toBe('call')
    expect(migrated.header.version).toBe(1)
  })

  it('rewrites whitespace-only names and leaves a legal name unchanged', () => {
    expect(namesOf(restoreV0ToV1(v0Header, emptyNameSession('  ')).events))
      .toEqual([INVALID_TOOL_CALL_NAME, INVALID_TOOL_CALL_NAME, INVALID_TOOL_CALL_NAME, INVALID_TOOL_CALL_NAME])
    expect(namesOf(restoreV0ToV1(v0Header, emptyNameSession('read')).events))
      .toEqual(['read', 'read', 'read', 'read'])
  })

  it('rewrites a packed tool-call-chunks row with a blank name', () => {
    const migrated = restoreV0ToV1(v0Header, [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
      {
        type: 'tool-call-chunks', seq0: 2, time0: 3,
        data: { turn: 1, step: 1, index: 0, id: 'call', name: '', dt: [], args: ['{}'] },
      },
      { type: 'step/end', seq: 3, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 4, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    expect(namesOf(migrated.events)).toEqual([INVALID_TOOL_CALL_NAME])
  })

  it('rewrites a packed run emitted through the identity stage', () => {
    const sourceHeader = {
      version: 0, id: 'packed-blank', createdAt: 1, isSeeded: false, delegationDepth: 0,
    } as const
    const stage = sessionFormatV0ToV1.createStage({
      sourceHeader,
      targetHeader: sessionFormatV0ToV1.migrateHeader(sourceHeader),
      sourceInheritedEventCount: 0,
      sourceKind: 'transformed',
    })
    const output = new SessionFormatEventCollector()
    const run = packedAssistantRun(
      { type: 'tool-call-chunks', time0: 1, index: 0, id: 'call', name: ' ', dt: [], args: ['{}'] },
      function* () {
        yield {
          type: 'assistant/chunk', seq: 0, time: 1,
          data: {
            turn: 1, step: 1,
            chunk: { type: 'tool-call-delta', index: 0, id: 'call', name: ' ', argumentsDelta: '{}' },
          },
        }
      },
    )
    stage.transformRun(run, output)
    expect(output.values[0]).toMatchObject({ data: { chunk: { name: INVALID_TOOL_CALL_NAME } } })
  })
})
