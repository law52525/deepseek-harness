/**
 * The file tree's view state: which directories are expanded, what each
 * loaded level contains, where the body is scrolled to, and the one name row
 * open for a new entry.
 *
 * The tree is not one resource. A directory listing per level, expanded lazily,
 * is state the type owns — so it lives in a Slot-standard exclusive store
 * (one instance per session), bucketed by tab id because two tabs of this kind
 * in one session expand independently.
 *
 * Writers run between `start` and `forget`: the owner's `signal` is what ends a
 * bucket's life, and the face stops dispatching once it aborts.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'

/**
 * One directory's contents, as one expanded level of the tree.
 *
 * The endpoint's listing also names the directory as a workspace-relative path;
 * the tree keys every level by absolute path instead, so the adapter drops it.
 */
export interface DirLevel {
  /** The directory's entries, in the endpoint's order. */
  readonly entries: readonly WorkspaceDirectoryEntry[]
  /** The listing hit the endpoint's entry cap, so entries are missing. */
  readonly truncated: boolean
}

/** What one directory level is doing right now. */
export type LevelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly level: DirLevel; readonly failure?: RemoteFailure }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }

/**
 * The name row open for one new entry. A tab has at most one: opening another
 * replaces it.
 */
export interface CreateDraft {
  /** Absolute path of the directory the entry will be created in. */
  readonly parent: string
  /** What the row will create. */
  readonly type: 'file' | 'directory'
  /** A submission is in flight, so the row takes no input. */
  readonly pending: boolean
  /** Why the last submission was refused; the row stays open for another name. */
  readonly failure?: RemoteFailure
}

/**
 * One tab's tree: its root, the levels it has asked for, and what is open.
 *
 * Every path here is absolute: the root is the session's working directory as
 * the Host reports it, and a child is the parent joined with the entry name.
 */
export interface FilesTabState {
  autoRefresh: boolean
  /** Absolute path of the workspace root this tree is rooted at. */
  root: string
  /** Level state by absolute directory path; a path absent here was never asked for. */
  levels: Record<string, LevelState>
  /** Expanded absolute directory paths, root included. */
  expanded: string[]
  /** The body's scroll offset in px, so a remounted tree comes back where the reader was. */
  scrollTop: number
  /** The open name row for a new entry; absent while none is open. */
  draft?: CreateDraft
}

/** Every tab's tree, keyed by tab id. */
export interface FilesState {
  byTab: Record<TabId, FilesTabState>
}

/**
 * One tab's bucket, which every writer after `start` relies on: the face only
 * dispatches while the record's signal is live, and `forget` runs on its abort.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's tree.
 */
function bucket(state: FilesState, tabId: TabId): FilesTabState {
  const tree = state.byTab[tabId]
  if (tree === undefined) throw new Error(`ui-sidebar-files: no tree for tab "${tabId}"`)
  return tree
}

/**
 * Close the name row when the directory it sits in leaves the tree.
 * @param state - the tab's tree.
 * @param path - absolute path of the directory that was collapsed or removed.
 */
function closeDraftUnder(state: FilesTabState, path: string): void {
  const parent = state.draft?.parent
  if (parent === path || parent?.startsWith(`${path}/`) === true) delete state.draft
}

/** The tree store's write set; every action names the tab it writes. */
type FilesActions = {
  autoRefresh: (draft: FilesState, tabId: TabId, enabled: boolean) => void
  start: (draft: FilesState, tabId: TabId, root: string) => void
  loading: (draft: FilesState, tabId: TabId, path: string) => void
  loaded: (draft: FilesState, tabId: TabId, path: string, level: DirLevel) => void
  failed: (draft: FilesState, tabId: TabId, path: string, failure: RemoteFailure) => void
  toggled: (draft: FilesState, tabId: TabId, path: string) => void
  draftOpened: (draft: FilesState, tabId: TabId, parent: string, type: CreateDraft['type']) => void
  draftPending: (draft: FilesState, tabId: TabId) => void
  draftFailed: (draft: FilesState, tabId: TabId, failure: RemoteFailure) => void
  draftClosed: (draft: FilesState, tabId: TabId) => void
  scrolled: (draft: FilesState, tabId: TabId, scrollTop: number) => void
  reset: (draft: FilesState, tabId: TabId) => void
  forget: (draft: FilesState, tabId: TabId) => void
}

/**
 * Declare the file tree's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createFilesStore(): EngineStoreHandle<FilesState, FilesActions> {
  return defineStore({
    init: (): FilesState => ({ byTab: {} }),
    actions: {
      autoRefresh: (d, tabId: TabId, enabled: boolean) => { bucket(d, tabId).autoRefresh = enabled },
      /**
       * Seed one tab's tree at its workspace root, with the root expanded.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param root - absolute path of the workspace root.
       */
      start: (d, tabId: TabId, root: string) => {
        d.byTab[tabId] = { root, levels: {}, expanded: [root], scrollTop: 0, autoRefresh: true }
      },
      /**
       * Mark one directory as being listed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       */
      loading: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        if (state.levels[path]?.kind !== 'ready') state.levels[path] = { kind: 'loading' }
      },
      /**
       * Record one directory's contents.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       * @param level - the listing to show under it.
       */
      loaded: (d, tabId: TabId, path: string, level: DirLevel) => {
        const state = bucket(d, tabId)
        const previous = state.levels[path]
        if (previous?.kind === 'ready') {
          const directories = new Set(level.entries.filter(entry => entry.type === 'directory').map(entry => entry.name))
          for (const entry of previous.level.entries) {
            if (entry.type !== 'directory' || directories.has(entry.name)) continue
            const removed = `${path.replace(/[/\\]+$/, '')}/${entry.name}`
            state.expanded = state.expanded.filter(value => value !== removed && !value.startsWith(`${removed}/`))
            closeDraftUnder(state, removed)
            state.levels = Object.fromEntries(Object.entries(state.levels)
              .filter(([key]) => key !== removed && !key.startsWith(`${removed}/`)))
          }
        }
        state.levels[path] = { kind: 'ready', level }
      },
      /**
       * Record why one directory could not be listed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, path: string, failure: RemoteFailure) => {
        const level = bucket(d, tabId).levels[path]
        bucket(d, tabId).levels[path] = level?.kind === 'ready'
          ? { ...level, failure }
          : { kind: 'failed', failure }
      },
      /**
       * Open a collapsed directory, or collapse an open one.
       *
       * A collapsed level keeps what it loaded, so reopening it draws at once.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       */
      toggled: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        const at = state.expanded.indexOf(path)
        if (at >= 0) {
          state.expanded.splice(at, 1)
          closeDraftUnder(state, path)
        } else {
          state.expanded.push(path)
        }
      },
      /**
       * Open the name row for a new entry, replacing any row already open.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param parent - absolute path of the directory to create in.
       * @param type - what the row will create.
       */
      draftOpened: (d, tabId: TabId, parent: string, type: CreateDraft['type']) => {
        bucket(d, tabId).draft = { parent, type, pending: false }
      },
      /**
       * Mark the open name row as submitted and drop its previous refusal.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      draftPending: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        if (state.draft !== undefined) state.draft = { parent: state.draft.parent, type: state.draft.type, pending: true }
      },
      /**
       * Record why the open name row's submission was refused, keeping the row.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure, or the Client's own refusal of the name.
       */
      draftFailed: (d, tabId: TabId, failure: RemoteFailure) => {
        const state = bucket(d, tabId)
        if (state.draft !== undefined) state.draft = { parent: state.draft.parent, type: state.draft.type, pending: false, failure }
      },
      /**
       * Remove the name row, after a creation or a cancellation.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      draftClosed: (d, tabId: TabId) => {
        delete bucket(d, tabId).draft
      },
      /**
       * Record where one tab's body is scrolled to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param scrollTop - the body's scroll offset, in px.
       */
      scrolled: (d, tabId: TabId, scrollTop: number) => {
        bucket(d, tabId).scrollTop = scrollTop
      },
      /**
       * Drop every loaded level, keeping what is expanded.
       *
       * This is the reload gesture's first half: the expanded set says which
       * levels to fetch again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      reset: (d, tabId: TabId) => {
        bucket(d, tabId).levels = {}
      },
      /**
       * Forget one tab's tree, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}
