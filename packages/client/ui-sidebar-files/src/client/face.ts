/**
 * The tree's asynchronous half: listing directories into the store, and
 * creating one entry from the tree's name row.
 *
 * The component never awaits anything. It calls `start` / `refresh` / `toggle` /
 * `create`, and this face performs the Remote call and writes the outcome through
 * the store's own actions — the Slot-standard `inject` shape, so the session id is resolved by
 * the framework and the write set stays the store's.
 *
 * The listing itself is bound here to the Client Remote face: the tree keys
 * every level by absolute path and hands the endpoint that same absolute path;
 * the endpoint answers with the directory's workspace-relative path as well,
 * which the tree has no use for and drops.
 *
 * One level has one listing in force: asking for a level again — the reload
 * gesture, a directory reopened after a reset — retires the listing still in
 * flight for it, whose settlement then writes nothing. Cleanup rides the owner's
 * `signal`: a request is not made for a record that already ended, and when the
 * record goes away the bucket and the tab's listing bookkeeping are forgotten,
 * so no later settlement writes to it.
 *
 * A creation follows the same rule and one more: its settlement writes the name
 * row only while that row is still the one it was submitted from.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CreateDraft, DirLevel, createFilesStore } from './store.ts'
import type { WorkspaceCreatedEntry, WorkspaceFileWatchFrame } from '@deepseek-ai/dsh-api-workspace-files/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { DirectoryNode } from './directory-node.ts'

/**
 * Observe one directory without recursively watching its descendants.
 * @param sessionId - Session owning the directory tree.
 * @param path - absolute directory path.
 * @param signal - node lifetime.
 * @returns readiness and invalidation notifications.
 */
export type WatchWorkspaceDirectory = (sessionId: SessionId, path: string, signal: AbortSignal) => AsyncIterable<'ready' | 'change'>

/**
 * Bind directory observation to the Remote stream supervisor.
 * @param remote - Client Remote with workspace file streams.
 * @returns a watcher that awaits stream disposal when its node ends.
 */
export function createWatch(remote: ClientRemote): WatchWorkspaceDirectory {
  return async function* (sessionId, path, signal) {
    const aborted = (): boolean => signal.aborted
    if (aborted()) return
    const stream = remote.$stream<WorkspaceFileWatchFrame>({
      name: `directory ${path}`,
      open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
      ended: () => new Error(`Directory watch ended: ${path}`),
    })
    const abort = (): void => { void stream.dispose() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for await (const item of stream) {
        if (aborted()) return
        if (item.value.kind === 'ready') item.accept()
        yield item.value.kind
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await stream.dispose()
    }
  }
}

/**
 * One directory listing, bound to a Remote face.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different directories in different sessions.
 * A Remote call does not reject — the result carries the failure.
 */
export type ListWorkspaceDirectory = (
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResult<DirLevel>>

/**
 * The slice of the Client Remote face this package calls: the `workspaceFiles`
 * namespace's `list`, exactly as the Host's generated client declares it.
 */
export type WorkspaceFilesListRemote = {
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'list'>
}

/**
 * Bind the listing to one Remote face, keeping only what the tree stores.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the listing the tree's face performs.
 */
export function createList(remote: WorkspaceFilesListRemote): ListWorkspaceDirectory {
  return async (sessionId, path, signal) => {
    const result = await remote.workspaceFiles.list(sessionId, path, signal)
    if (!result.ok) return result
    return { ok: true, value: { entries: result.value.entries, truncated: result.value.truncated } }
  }
}

/**
 * One entry creation, bound to a Remote face. Like a listing, it carries the
 * session and settles with the failure instead of rejecting.
 */
export type CreateWorkspaceEntry = (
  sessionId: SessionId,
  parentPath: string,
  name: string,
  type: CreateDraft['type'],
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceCreatedEntry>>

/**
 * The slice of the Client Remote face a creation calls: the `workspaceFiles`
 * namespace's `create`, exactly as the Host's generated client declares it.
 */
export type WorkspaceFilesCreateRemote = {
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'create'>
}

/**
 * Bind entry creation to one Remote face.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the creation the tree's face performs.
 */
export function createCreate(remote: WorkspaceFilesCreateRemote): CreateWorkspaceEntry {
  return (sessionId, parentPath, name, type, signal) => remote.workspaceFiles.create(sessionId, parentPath, name, type, signal)
}

/** The byte no path segment carries. */
const NUL = String.fromCharCode(0)

/**
 * Decide whether a typed name is one path segment, by the rule the Host
 * applies again on its side. A drive-rooted Host also refuses `:`; that answer
 * arrives as the Host's own `workspace-file/invalid-name`.
 * @param name - the name as typed.
 * @returns false for an empty or whitespace-only name, `.`, `..`, and a name carrying `/`, `\`, or NUL.
 */
export function isEntryName(name: string): boolean {
  if (name.trim().length === 0 || name === '.' || name === '..') return false
  return !(name.includes('/') || name.includes('\\') || name.includes(NUL))
}

/**
 * The absolute path of one child entry.
 *
 * Joined with `/` whatever the parent's separators: the Host resolves mixed
 * separators, and the tree only needs a stable key.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/** The tree's injected business face, as the body receives it. */
export interface FilesInjected {
  /** Refresh the open directory tree. @param tabId - owning tab. */
  readonly refresh: (tabId: TabId) => void
  /** Control automatic rereads without closing watches. @param tabId - owning tab. @param enabled - automatic-refresh setting. */
  readonly setAutoRefresh: (tabId: TabId, enabled: boolean) => void
  /**
   * Seed this tab's tree and list its root.
   * @param tabId - the tab being drawn.
   * @param root - absolute path of the workspace root.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, root: string, signal: AbortSignal) => void
  /**
   * List one directory into the store.
   * @param tabId - the tab being drawn.
   * @param path - absolute directory path.
   * @param signal - the tab record's lifetime.
   */
  readonly load: (tabId: TabId, path: string, signal: AbortSignal) => void
  /**
   * Open or collapse one directory, retaining intent during ancestor restoration.
   * @param tabId - the tab being drawn.
   * @param parentPath - the listed parent directory's exact tree key.
   * @param path - absolute directory path.
   * @param expanded - current expansion preferences, including descendants to restore.
   * @param signal - the tab record's lifetime.
   */
  readonly toggle: (tabId: TabId, parentPath: string, path: string, expanded: readonly string[], signal: AbortSignal) => void
  /**
   * Open the name row for a new entry in one directory, replacing any open row.
   * @param tabId - the tab being drawn.
   * @param parentPath - absolute path of the directory to create in.
   * @param type - what the row will create.
   * @param signal - the tab record's lifetime.
   */
  readonly beginCreate: (tabId: TabId, parentPath: string, type: CreateDraft['type'], signal: AbortSignal) => void
  /**
   * Close the name row without creating anything.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly cancelCreate: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Submit the name row: refuse an unusable name without a request, otherwise
   * create the entry, then close the row and list its directory again, or keep
   * the row with the failure. A submission already in flight for the tab makes
   * this a no-op.
   * @param tabId - the tab being drawn.
   * @param parentPath - absolute path of the directory to create in.
   * @param name - the name as typed.
   * @param type - what to create.
   * @param signal - the tab record's lifetime.
   */
  readonly create: (tabId: TabId, parentPath: string, name: string, type: CreateDraft['type'], signal: AbortSignal) => void
}

/**
 * Bind the tree's face to one directory listing.
 * @param list - the bound `workspaceFiles.list` call.
 * @param watch - target-scoped directory observation.
 * @param create - the bound `workspaceFiles.create` call.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function filesFace(
  list: ListWorkspaceDirectory,
  watch: WatchWorkspaceDirectory,
  create: CreateWorkspaceEntry,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createFilesStore>>) => FilesInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createFilesStore>>,
  ): FilesInjected => {
    /** Per tab, per absolute path: the listing generation a settlement must match; the latest request wins. */
    const generations = new Map<TabId, Map<string, number>>()
    const roots = new Map<TabId, DirectoryNode>()
    /** Per tab: the name row's generation, and whether its submission is in flight. A new row or a cancellation starts a generation. */
    const drafts = new Map<TabId, { readonly generation: number; readonly pending: boolean }>()
    const nextDraft = (tabId: TabId, pending: boolean): number => {
      const generation = (drafts.get(tabId)?.generation ?? 0) + 1
      drafts.set(tabId, { generation, pending })
      return generation
    }
    const nextGeneration = (tabId: TabId, path: string): number => {
      const byPath = generations.get(tabId) ?? new Map<string, number>()
      generations.set(tabId, byPath)
      const generation = (byPath.get(path) ?? 0) + 1
      byPath.set(path, generation)
      return generation
    }
    const load = async (tabId: TabId, path: string, signal: AbortSignal): Promise<DirLevel | undefined> => {
      if (signal.aborted) return
      const generation = nextGeneration(tabId, path)
      actions.loading(tabId, path)
      return list(sessionId, path, signal).then((result) => {
        // A newer listing of this level was asked for since, or the record is
        // gone and its bookkeeping with it: nothing left for this one to write.
        if (signal.aborted || generations.get(tabId)?.get(path) !== generation) return
        if (result.ok) actions.loaded(tabId, path, result.value)
        else actions.failed(tabId, path, result.error)
        return result.ok ? result.value : undefined
      })
    }
    return {
      refresh: (tabId) => { void roots.get(tabId)?.refreshTree() },
      setAutoRefresh: (tabId, enabled) => {
        actions.autoRefresh(tabId, enabled)
        roots.get(tabId)?.setAutomatic(enabled)
      },
      start(tabId, root, signal) {
        actions.start(tabId, root)
        signal.addEventListener('abort', () => {
          void roots.get(tabId)?.close()
          roots.delete(tabId)
          generations.delete(tabId)
          drafts.delete(tabId)
          actions.forget(tabId)
        }, { once: true })
        roots.set(tabId, new DirectoryNode(root,
          (path, lifetime) => load(tabId, path, lifetime),
          (path, lifetime) => watch(sessionId, path, lifetime),
          (path, error) => {
            if (!signal.aborted) actions.failed(tabId, path, new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {}))
          }, signal,
        ).open())
      },
      load: (tabId, path, signal) => { void load(tabId, path, signal) },
      toggle(tabId, parentPath, path, expanded, signal) {
        if (signal.aborted) return
        const root = roots.get(tabId)
        if (root === undefined) return
        const parent = root.find(parentPath)
        if (parent === undefined && !expanded.includes(parentPath)) return
        const collapsing = expanded.includes(path)
        const next = collapsing ? expanded.filter(value => value !== path) : [...expanded, path]
        root.setExpanded(next)
        if (collapsing) void parent?.collapse(path)
        else parent?.expand(path, next)
        actions.toggled(tabId, path)
      },
      beginCreate(tabId, parentPath, type, signal) {
        if (signal.aborted) return
        nextDraft(tabId, false)
        actions.draftOpened(tabId, parentPath, type)
      },
      cancelCreate(tabId, signal) {
        if (signal.aborted) return
        nextDraft(tabId, false)
        actions.draftClosed(tabId)
      },
      create(tabId, parentPath, name, type, signal) {
        if (signal.aborted || drafts.get(tabId)?.pending === true) return
        if (!isEntryName(name)) {
          actions.draftFailed(tabId, new RemoteError('workspace-file/invalid-name', 'name must be one path segment', { name }))
          return
        }
        const generation = nextDraft(tabId, true)
        actions.draftPending(tabId)
        void create(sessionId, parentPath, name, type, signal).then((result) => {
          // The record is gone and its bucket with it: nothing left to write.
          if (signal.aborted) return
          // The entry exists whatever became of the row. A provider without
          // watches sends no invalidation, so the level is listed again here.
          if (result.ok) void roots.get(tabId)?.find(parentPath)?.refresh()
          // A row opened or cancelled since belongs to another generation.
          if (drafts.get(tabId)?.generation !== generation) return
          drafts.set(tabId, { generation, pending: false })
          if (result.ok) actions.draftClosed(tabId)
          else actions.draftFailed(tabId, result.error)
        })
      },
    }
  }
}
