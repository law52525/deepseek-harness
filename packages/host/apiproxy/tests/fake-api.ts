/** Shared in-memory ApiProxy for fetch-carrier tests. */

import type { ApiProxy, HostFrame, MuxFrame } from '../src/api/index.ts'
import type { ClientResponse, RpcReceipt, RpcRequest } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'

/** Minimal in-memory ApiProxy: echoes rpcIds, scripts one frame per stream. */
export function fakeApi(overrides: Partial<{ muxFrames: MuxFrame[]; hostFrames: HostFrame[]; crashOn: string }> = {}): ApiProxy {
  const muxFrames = overrides.muxFrames ?? [{ type: 'session/subscribed', sessionId: 's1' as never, lastSeq: -1 }]
  const hostFrames = overrides.hostFrames ?? [{ type: 'host/session-removed', sessionId: 's1' as never }]
  async function * stream<F>(frames: F[], signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
    for (const payload of frames) {
      if (signal.aborted) return
      yield { rpcId: RpcId(`frame-${String(frames.indexOf(payload))}`), payload }
    }
  }
  return {
    sessions: {
      async list(request) {
        if (overrides.crashOn === 'session.list') throw new Error('impl crashed')
        return { rpcId: request.rpcId, result: { ok: true, value: { items: [] } } }
      },
      async search(request, signal) {
        if (request.payload.query === 'hang') {
          if (!signal.aborted) {
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => { resolve() }, { once: true })
            })
          }
          return {
            rpcId: request.rpcId,
            result: { ok: false, error: { code: 'cancelled', message: 'aborted', details: {} } },
          }
        }
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: { items: [{ sessionId: 's1' as never, snippet: 'fixture match' }], hasMore: false },
          },
        }
      },
      async create(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { sessionId: 's-new' as never } } }
      },
      async history(request) {
        if (request.payload.sessionId === ('with-projections' as never)) {
          return {
            rpcId: request.rpcId,
            result: { ok: true, value: { events: [], hasMore: false, projections: { asOfSeq: 9, values: { todos: [{ content: 'current', status: 'in_progress' as const }] } } } },
          }
        }
        return {
          rpcId: request.rpcId,
          result: { ok: false, error: { code: 'session-not-found', message: 'nope', details: { sessionId: request.payload.sessionId } } },
        }
      },
      async models(request) {
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
              routable: true,
              groups: [],
              failures: [],
            },
          },
        }
      },
      async selectModel(request) {
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              selected: {
                provider: request.payload.provider,
                model: request.payload.model,
                ...request.payload.reasoningEffort === undefined
                  ? {}
                  : { reasoningEffort: request.payload.reasoningEffort },
              },
            },
          },
        }
      },
      async rename(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { title: request.payload.title, seq: 0 } } }
      },
      async fork(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { sessionId: 's-fork' as never } } }
      },
      async prompt(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true as const } } }
      },
      async attachment(request) {
        return {
          rpcId: request.rpcId,
          result: { ok: true, value: { attachment: { attachmentId: 'a' as never, mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }, data: 'AA==' } },
        }
      },
      async updateQueue(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true as const } } }
      },
      async cancel(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true as const } } }
      },
    },
    subagents: {
      async list(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { entries: [], parentAvailable: false } } }
      },
      async history(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { events: [], hasMore: false } } }
      },
      async prompt(request, signal) {
        if (request.payload.content.some(block => block.type === 'text' && block.text === 'hang')) {
          if (!signal.aborted) {
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => { resolve() }, { once: true })
            })
          }
          return {
            rpcId: request.rpcId,
            result: { ok: false, error: { code: 'cancelled' as const, message: 'aborted', details: {} } },
          }
        }
        return {
          rpcId: request.rpcId,
          result: { ok: true, value: { messageId: 'message-1' as never } },
        }
      },
      async interrupt(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true as const } } }
      },
    },
    host: {
      async describe(request) {
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: { version: 'v', cwd: '/w', attachedSessions: 0, home: '/h', canOpenPath: true },
          },
        }
      },
      async pickDirectory(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { path: null } } }
      },
      async listDirectory(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { path: '/w', home: '/w', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [], truncated: false } } }
      },
      async createDirectory(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { path: '/w/new' } } }
      },
      async openPath(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { opened: true as const } } }
      },
    },
    workspace: {
      async list(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { items: [], archivedSessionIds: [] } } }
      },
      async create(request) {
        return {
          rpcId: request.rpcId,
          result: { ok: true, value: { workspace: { workspaceId: 'w1' as never, path: '/w', title: 'w', sessionIds: [], createdAt: 't', updatedAt: 't' }, created: true } },
        }
      },
      async rename(request) {
        return {
          rpcId: request.rpcId,
          result: { ok: true, value: { workspace: { workspaceId: 'w1' as never, path: '/w', title: 'w', sessionIds: [], createdAt: 't', updatedAt: 't' } } },
        }
      },
      async delete(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { deleted: true as const } } }
      },
      async insertBefore(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { workspaceIds: [request.payload.workspaceId] } } }
      },
      async insertSessionBefore(request) {
        return {
          rpcId: request.rpcId,
          result: { ok: true, value: { workspace: { workspaceId: 'w1' as never, path: '/w', title: 'w', sessionIds: [], createdAt: 't', updatedAt: 't' } } },
        }
      },
      async archiveSession(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { archivedSessionIds: [request.payload.sessionId] } } }
      },
    },
    agentPresets: {
      list(request: RpcRequest<{}>) {
        return Promise.resolve({
          rpcId: request.rpcId,
          result: { ok: true as const, value: { presets: [], authorable: false, hasDocument: false } },
        })
      },
      select(request: RpcRequest<{ agentPreset: string }>) {
        const value = { agentPreset: request.payload.agentPreset }
        return Promise.resolve({ rpcId: request.rpcId, result: { ok: true as const, value } })
      },
      read(request: RpcRequest<{ agentPreset: string }>) {
        const value = { agentPreset: request.payload.agentPreset, trust: 'user' as const, content: '' }
        return Promise.resolve({ rpcId: request.rpcId, result: { ok: true as const, value } })
      },
      copy(request: RpcRequest<{ from: string; agentPreset: string }>) {
        const value = { agentPreset: request.payload.agentPreset }
        return Promise.resolve({ rpcId: request.rpcId, result: { ok: true as const, value } })
      },
      openDocument(request: RpcRequest<{ agentPreset: string }>) {
        return Promise.resolve({ rpcId: request.rpcId, result: { ok: true as const, value: { opened: true as const } } })
      },
      remove(request: RpcRequest<{ agentPreset: string }>) {
        return Promise.resolve({ rpcId: request.rpcId, result: { ok: true as const, value: {} } })
      },
    },
    skills: {
      async list(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { skills: [{ name: 'commit-helper', description: 'Git commits', modelInvocable: true }] } } }
      },
    },
    goals: {
      async create(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }
      },
      async edit(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }
      },
      async pause(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }
      },
      async resume(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }
      },
      async complete(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }
      },
      async clear(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }
      },
    },
    settings: {
      async describe(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } } }
      },
      async openDocument(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { opened: true as const } } }
      },
      async update(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'settings-rejected', message: 'stub', details: { ns: request.payload.ns } } } }
      },
      async replace(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'settings-rejected', message: 'stub', details: { ns: request.payload.ns } } } }
      },
      async mutate(request) {
        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'settings-rejected', message: 'stub', details: { ns: request.payload.ns } } } }
      },
    },
    credentials: {
      async describe(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { credentials: {} } } }
      },
      async set(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: {} } }
      },
      async unset(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: {} } }
      },
    },
    llm: {
      async providers(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { providers: [] } } }
      },
      async models(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { groups: [], failures: [] } } }
      },
      async discoverModels(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { models: [] } } }
      },
    },
    events: {
      mux: (_request, signal) => stream(muxFrames, signal),
      host: (_request, signal) => stream(hostFrames, signal),
    },
    async respond(message: ClientResponse): Promise<RpcReceipt> {
      return message.rpcId === 'known' ? { accepted: true } : { accepted: false, reason: 'not-pending' }
    },
    downloads: {
      async sessionLog() {
        return new Response('stub', { status: 404 })
      },
    },
  }
}
