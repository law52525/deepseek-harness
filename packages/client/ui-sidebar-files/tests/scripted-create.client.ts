/** Deferred entry creations: every call stays pending until the spec answers it. */
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceCreatedEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { CreateWorkspaceEntry } from '../src/client/face.ts'

/** The scripted creation: the mock the face receives, and the hand that settles it. */
export interface ScriptedCreate {
  readonly create: Mock<CreateWorkspaceEntry>
  /**
   * Answer the oldest outstanding creation as the Host would after creating it.
   * @returns once the face has handled the answer.
   */
  readonly succeed: () => Promise<void>
  /**
   * Answer the oldest outstanding creation with a failure.
   * @param error - what the Host answers.
   * @returns once the face has handled the answer.
   */
  readonly fail: (error: RemoteFailure) => Promise<void>
  /** How many creations are not yet answered. */
  readonly outstanding: () => number
  /** Answer every outstanding creation after the owner aborts. */
  readonly dispose: () => Promise<void>
}

interface PendingCreate {
  readonly parentPath: string
  readonly name: string
  readonly type: WorkspaceCreatedEntry['type']
  readonly result: Promise<RemoteResult<WorkspaceCreatedEntry>>
  resolve(result: RemoteResult<WorkspaceCreatedEntry>): void
}

/**
 * Build a creation whose every call stays pending until the spec settles it.
 * @returns the scripted creation.
 */
export function scriptedCreate(): ScriptedCreate {
  const pending: PendingCreate[] = []
  const create = vi.fn<CreateWorkspaceEntry>((_sessionId, parentPath, name, type) => {
    const result = Promise.withResolvers<RemoteResult<WorkspaceCreatedEntry>>()
    pending.push({ parentPath, name, type, result: result.promise, resolve: result.resolve })
    return result.promise
  })
  const land = async (answer: (call: PendingCreate) => RemoteResult<WorkspaceCreatedEntry>): Promise<void> => {
    const call = pending.shift()
    if (call === undefined) throw new Error('no outstanding creation to settle')
    call.resolve(answer(call))
    await call.result
  }
  return {
    create,
    succeed: () => land(call => ({ ok: true, value: { absolutePath: `${call.parentPath}/${call.name}`, type: call.type } })),
    fail: error => land(() => ({ ok: false, error })),
    outstanding: () => pending.length,
    dispose: async () => {
      for (const call of pending.splice(0)) {
        call.resolve({ ok: false, error: new RemoteError('gateway/internal', 'fixture closed', {}) })
      }
    },
  }
}
