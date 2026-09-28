import { describe, expect, it } from 'vitest'
import {
  assertReleasedV2Header,
  releasedV2SessionFormatCodec,
  sessionFormatV1ToV2,
} from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { assertReleasedV2Artifact } from '../src/testing/validation.ts'
import {
  INVALID_TOOL_CALL_NAME,
  releasedV0SessionFormatCodec,
  releasedV1SessionFormatCodec,
  sessionFormatV0ToV1,
} from '@deepseek-ai/dsh-session-format-v0-to-v1'
import type {
  SessionFormatArtifact,
  SessionFormatEvent,
  SessionFormatEventRun,
  SessionFormatHeader,
  SessionFormatJsonObject,
} from '@deepseek-ai/dsh-session-format'
import { createSessionFormatCatalog, SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'

const catalog = createSessionFormatCatalog({
  currentVersion: 2,
  codecs: [releasedV0SessionFormatCodec, releasedV1SessionFormatCodec, releasedV2SessionFormatCodec],
  currentEncoder: releasedV2SessionFormatCodec,
  migrations: [sessionFormatV0ToV1, sessionFormatV1ToV2],
  restoreCurrent(artifact) {
    assertReleasedV2Artifact(artifact)
    return artifact
  },
  restoreTransformedCurrent(artifact) {
    assertReleasedV2Artifact(artifact)
    return artifact
  },
  restoreCurrentHeader(header) {
    assertReleasedV2Header(header)
    return header
  },
})

function event(type: string, seq: number, time: number, data: SessionFormatEvent['data']): SessionFormatEvent {
  return { type, seq, time, data }
}

function physicalV1Header(header: SessionFormatHeader, inheritedEventCount: number) {
  return {
    type: 'session',
    version: 1,
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
    ...(header.isSeeded ? { seedLength: inheritedEventCount } : {}),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    delegationDepth: header.delegationDepth,
    ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
  }
}

function migrateV1ToV2(source: SessionFormatArtifact): SessionFormatArtifact {
  const restore = catalog.createRestore(
    physicalV1Header(source.header, source.inheritedEventCount),
    { recovery: 'strict', validation: 'current' },
  )
  for (const row of source.events) restore.decodeRow(row)
  return restore.finish()
}

function toolSession(finalName: string, deltaName: string | null): SessionFormatArtifact {
  const block = { type: 'tool-call', id: 'call', name: finalName, arguments: '{}' }
  return {
    header: { version: 1, id: 'null-delta', createdAt: 1, isSeeded: false, delegationDepth: 0 },
    inheritedEventCount: 0,
    events: [
      event('turn/start', 0, 1, { turn: 1 }),
      event('step/start', 1, 2, { turn: 1, step: 1 }),
      event('assistant/chunk', 2, 3, {
        turn: 1, step: 1,
        chunk: {
          type: 'tool-call-delta', index: 0, id: 'call', name: deltaName, argumentsDelta: '{}',
        },
      }),
      event('assistant/chunk', 3, 4, {
        turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block },
      }),
      {
        ...event('assistant/message', 4, 5, {
          turn: 1, step: 1,
          message: {
            id: 'assistant', role: 'assistant', content: [block],
            source: { kind: 'model', provider: 'mock', model: 'mock' },
          },
        }),
        sourceEventSeqs: [2, 3],
        surfaceOp: 'append',
      },
      event('tool/call', 5, 6, { turn: 1, step: 1, callId: 'call', name: finalName, arguments: '{}' }),
      {
        ...event('tool/result', 6, 7, {
          turn: 1, step: 1,
          message: {
            id: 'result', role: 'user',
            content: [{
              type: 'tool-result', toolCallId: 'call',
              content: [{ type: 'text', text: 'ok' }], isError: true,
            }],
            source: { kind: 'tool', callId: 'call' },
          },
        }),
        sourceEventSeqs: [5],
        surfaceOp: 'append',
      },
      event('step/end', 7, 8, { turn: 1, step: 1 }),
      event('turn/end', 8, 9, { turn: 1, reason: { kind: 'completed' } }),
    ],
  }
}

function assistantMessage(artifact: SessionFormatArtifact): SessionFormatEvent {
  const found = artifact.events.find(candidate => candidate.type === 'assistant/message')
  if (found === undefined) throw new Error('missing assistant/message')
  return found
}

function packedRun(options: {
  readonly firstSeq: number
  readonly eventCount?: number
  readonly lastTime: number
  readonly stream: SessionFormatJsonObject
}): SessionFormatEventRun {
  const eventCount = options.eventCount ?? 1
  return {
    runType: 'released-assistant-chunks',
    firstSeq: options.firstSeq,
    eventCount,
    turn: 1,
    step: 1,
    lastSeq: options.firstSeq + eventCount - 1,
    lastTime: options.lastTime,
    stream: options.stream,
    *expand() {},
  } as SessionFormatEventRun
}

describe('sessionFormatV1ToV2 vacant tool names', () => {
  it('keeps a settled legal name when a tool-call-delta carried name: null', () => {
    const migrated = migrateV1ToV2(toolSession('read', null))
    const data = assistantMessage(migrated).data as {
      message: { content: Array<{ name: string }> }
      stream: Array<{ type: string; name?: string; chunk?: { type: string; name?: string } }>
    }
    expect(data.message.content[0]?.name).toBe('read')
    expect(data.stream.some(record => record.name === INVALID_TOOL_CALL_NAME
      || record.chunk?.name === INVALID_TOOL_CALL_NAME)).toBe(false)
    const call = migrated.events.find(candidate => candidate.type === 'tool/call')
    expect((call?.data as { name: string }).name).toBe('read')
  })

  it('rewrites a settled empty name to invalid_tool_call when a delta carried name: null', () => {
    const migrated = migrateV1ToV2(toolSession('', null))
    const data = assistantMessage(migrated).data as {
      message: { content: Array<{ name: string }> }
      stream: Array<{ type: string; chunk?: { block?: { name?: string } } }>
    }
    expect(data.message.content[0]?.name).toBe(INVALID_TOOL_CALL_NAME)
    const blockEnd = data.stream.find(record => record.chunk?.block !== undefined)
    expect(blockEnd?.chunk?.block?.name).toBe(INVALID_TOOL_CALL_NAME)
    const call = migrated.events.find(candidate => candidate.type === 'tool/call')
    expect((call?.data as { name: string }).name).toBe(INVALID_TOOL_CALL_NAME)
    expect((migrated.events.find(candidate => candidate.type === 'tool/result')
      ?.data as { message: { source: { callId: string } } }).message.source.callId).toBe('call')
  })

  it('rewrites a packed tool-call-chunks run whose name is blank', () => {
    const sourceHeader: SessionFormatHeader = {
      version: 1, id: 'packed-blank', createdAt: 1, isSeeded: false, delegationDepth: 0,
    }
    const stage = sessionFormatV1ToV2.createStage({
      sourceHeader,
      targetHeader: sessionFormatV1ToV2.migrateHeader(sourceHeader),
      sourceInheritedEventCount: 0,
      sourceKind: 'transformed',
    })
    const output = new SessionFormatEventCollector()
    stage.transformRun(packedRun({
      firstSeq: 0, lastTime: 1,
      stream: { type: 'tool-call-chunks', time0: 1, index: 0, id: 'call', name: '', dt: [], args: ['{}'] },
    }), output)
    stage.finish(output)
    expect(output.values[0]?.data).toMatchObject({
      stream: [{ type: 'tool-call-chunks', name: INVALID_TOOL_CALL_NAME }],
    })
  })
})
