/**
 * The preview's own state: the pages it has read, and how the reader views them.
 *
 * The `file` resource carries metadata only, so the text is this type's to fetch
 * and keep — page by page, keyed by the 1-based line each page starts at. The
 * view state (scroll offset, wrap, the navigation already answered) must outlive
 * the body: a tab switched away from unmounts its body and must come back where
 * it was rather than re-read or jump to its opening line again. Bucketed by tab
 * id because two tabs of one file scroll independently.
 *
 * One bucket may also hold the tab's editor: the complete text being edited,
 * the version it was loaded from, and how the last save went. That text is one
 * whole file rather than pages, so it lives beside the pages and replaces them
 * as what the body shows while the tab's viewer allows editing.
 *
 * A bucket lives as long as its tab record: the face's first read of a tab arms
 * one listener on the owner's `signal` that forgets the bucket when the record
 * ends, and a tab that never read has no bucket to forget.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { DocumentFileBytes } from './rpc.ts'
import type { DocumentLoadMode } from './document/registry.ts'

/**
 * One page as the store keeps it: its text and the Host's line count, which
 * tells a page past the file's last line (`lines: 0`) from a page holding one
 * empty line (`lines: 1`, `text: ''`).
 */
export interface TextPage {
  readonly text: string
  readonly lines: number
}

/** Why a file cannot be edited, as the editor learned it from the disk bytes. */
export type EditBlockReason = 'not-text' | 'bom' | 'too-large' | 'unavailable'

/**
 * One tab's editor session: the complete text being edited and its disk state.
 *
 * `observedVersion` is the `file` metadata version the text was loaded under;
 * together with `version` it tells an external write from the echo of this
 * tab's own save, whose returned version arrives in the metadata afterwards.
 */
export interface EditTabState {
  /** The text the body shows and edits; the draft when it differs from `savedText`. */
  text: string
  /** The text last known to be on disk; a save is skipped while `text` equals it. */
  savedText: string
  /** Version token of `savedText`; the baseline every save carries. */
  version: string
  /** Metadata version observed at load, so this tab's own saves read as no change. */
  observedVersion: string | undefined
  /** A save request is in flight. */
  saving: boolean
  /** Why the last save failed; cleared when the next one starts. */
  failure: RemoteFailure | undefined
  /** The last save was refused because the disk moved; the reader decides which side wins. */
  conflict: boolean
  /** The file is gone from disk; the text is kept for copying. */
  gone: boolean
  /** Why this file cannot be edited at all; absent while it can. */
  blocked: EditBlockReason | undefined
}

/** One tab's pages and view. */
export interface TextTabState {
  autoRefresh: boolean
  resourcesDirty: boolean
  /** The tab's editor session; absent until the body opens or refuses one. */
  edit?: EditTabState
  /** Explicit viewer choice for this tab; absence follows automatic matching. */
  rendererId?: string
  /** Current display-loading mode; absent before the first read. */
  mode?: DocumentLoadMode
  /** Implementation owning source loading; absent for ordinary file reads. */
  contentRendererId?: string
  /** Current content revision, incremented whenever loaded content is discarded. */
  loadRevision: number
  /** Full byte result used by complete-file renderers. */
  complete?: DocumentFileBytes
  /** The file version the loaded pages belong to; absent before the first page. */
  version: string | undefined
  /** Metadata version observed when this tab began its current read generation. */
  observedVersion: string | undefined
  /** Pages by the 1-based line each starts at. */
  pages: Record<number, TextPage>
  /** Whether the last loaded page reached the end of the file. */
  eof: boolean
  /** A page read is in flight. */
  loading: boolean
  /** Why the last page read failed; cleared by the next page. */
  failure: RemoteFailure | undefined
  /** Scroll offset of the body, in px. */
  scrollTop: number
  /** Whether long lines wrap instead of scrolling horizontally; on until the reader turns it off. */
  wrap: boolean
  /** The `navigation.revision` the body already answered; absent before the first. */
  revision: number | undefined
}

/** Every tab's state, keyed by tab id. */
export interface TextState {
  byTab: Record<TabId, TextTabState>
}

/**
 * A tab's state before it reads, scrolls, toggles, or answers anything.
 * @returns the empty bucket.
 */
export function fresh(): TextTabState {
  return {
    autoRefresh: true,
    resourcesDirty: false,
    loadRevision: 0,
    version: undefined,
    observedVersion: undefined,
    pages: {},
    eof: false,
    loading: false,
    failure: undefined,
    scrollTop: 0,
    wrap: true,
    revision: undefined,
  }
}

/** The bucket for one tab, created on first write. */
function bucket(state: TextState, tabId: TabId): TextTabState {
  return state.byTab[tabId] ??= fresh()
}

/** The preview store's write set; every action names the tab it writes. */
type TextActions = {
  toggledAutoRefresh: (draft: TextState, tabId: TabId) => void
  resourceChanged: (draft: TextState, tabId: TabId) => void
  selected: (draft: TextState, tabId: TabId, rendererId: string | undefined) => void
  loading: (draft: TextState, tabId: TabId, mode?: DocumentLoadMode, observedVersion?: string, contentRendererId?: string) => void
  rendered: (draft: TextState, tabId: TabId, revision: number, version: string) => void
  rendererFailed: (draft: TextState, tabId: TabId, revision: number) => void
  complete: (draft: TextState, tabId: TabId, file: DocumentFileBytes) => void
  page: (draft: TextState, tabId: TabId, page: WorkspaceFileText) => void
  failed: (draft: TextState, tabId: TabId, failure: RemoteFailure) => void
  reset: (draft: TextState, tabId: TabId) => void
  scrolled: (draft: TextState, tabId: TabId, scrollTop: number) => void
  toggledWrap: (draft: TextState, tabId: TabId) => void
  navigated: (draft: TextState, tabId: TabId, revision: number) => void
  editLoaded: (draft: TextState, tabId: TabId, text: string, version: string, observedVersion: string | undefined) => void
  editDraft: (draft: TextState, tabId: TabId, text: string) => void
  editSaving: (draft: TextState, tabId: TabId) => void
  editSaved: (draft: TextState, tabId: TabId, text: string, version: string) => void
  editFailed: (draft: TextState, tabId: TabId, failure: RemoteFailure) => void
  editConflicted: (draft: TextState, tabId: TabId) => void
  editGone: (draft: TextState, tabId: TabId) => void
  editBlocked: (draft: TextState, tabId: TabId, reason: EditBlockReason) => void
  forget: (draft: TextState, tabId: TabId) => void
}

/**
 * Declare the preview's store.
 *
 * Constructed once in apply and shared by the body and the tools registrations,
 * which the slot runtime allows because both are session-scoped.
 * @returns the store handle to declare on both registrations.
 */
export function createTextStore(): EngineStoreHandle<TextState, TextActions> {
  return defineStore({
    init: (): TextState => ({ byTab: {} }),
    actions: {
      toggledAutoRefresh: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.autoRefresh = !state.autoRefresh
      },
      resourceChanged: (d, tabId: TabId) => { bucket(d, tabId).resourcesDirty = true },
      /** @param d - draft. @param tabId - owning tab. @param rendererId - manual choice, or automatic selection. */
      selected: (d, tabId: TabId, rendererId: string | undefined) => {
        if (rendererId === undefined) delete bucket(d, tabId).rendererId
        else bucket(d, tabId).rendererId = rendererId
      },
      /**
       * Mark a page read as in flight.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param mode - selected renderer's loading mode.
       * @param observedVersion - metadata version at read start; later pages retain the initial observation.
       * @param contentRendererId - implementation owning source loading.
       */
      loading: (d, tabId: TabId, mode?: DocumentLoadMode, observedVersion?: string, contentRendererId?: string) => {
        const state = bucket(d, tabId)
        if (state.version === undefined && !state.loading) state.observedVersion = observedVersion
        if (contentRendererId === undefined) delete state.contentRendererId
        else state.contentRendererId = contentRendererId
        state.loading = true
        state.failure = undefined
        if (mode !== undefined) state.mode = mode
      },
      /**
       * @param d - draft. @param tabId - owning tab.
       * @param revision - active content revision. @param version - displayed source version.
       */
      rendered: (d, tabId: TabId, revision: number, version: string) => {
        const state = d.byTab[tabId]
        if (state?.mode !== 'renderer' || state.loadRevision !== revision) return
        state.version = version
        state.loading = false
      },
      /** @param d - draft. @param tabId - owning tab. @param revision - failed content revision. */
      rendererFailed: (d, tabId: TabId, revision: number) => {
        const state = d.byTab[tabId]
        if (state?.mode !== 'renderer' || state.loadRevision !== revision) return
        state.loading = false
      },
      /** @param d - draft. @param tabId - owning tab. @param file - complete byte result for this view. */
      complete: (d, tabId: TabId, file: DocumentFileBytes) => {
        const state = bucket(d, tabId)
        state.complete = file
        state.version = file.version
        state.eof = true
        state.loading = false
        state.failure = undefined
      },
      /**
       * Keep one page. A page from a newer file version invalidates the pages
       * of the older one, so the body never shows two versions at once.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param page - the page the Host returned.
       */
      page: (d, tabId: TabId, page: WorkspaceFileText) => {
        const state = bucket(d, tabId)
        if (state.version !== undefined && state.version !== page.version) state.pages = {}
        state.version = page.version
        state.pages[page.offset] = { text: page.text, lines: page.lines }
        state.eof = page.eof
        state.loading = false
        state.failure = undefined
      },
      /**
       * Record why a page read failed; the pages already held stay.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        const state = bucket(d, tabId)
        state.loading = false
        state.failure = failure
      },
      /**
       * Drop every page, keeping the view, for a re-read from the first line.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      reset: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.resourcesDirty = false
        state.loadRevision++
        state.pages = {}
        delete state.complete
        state.eof = false
        state.version = undefined
        state.observedVersion = undefined
        state.loading = false
        state.failure = undefined
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
       * Switch one tab between wrapped and unwrapped lines.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      toggledWrap: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.wrap = !state.wrap
      },
      /**
       * Record that the body answered one navigation, so a remount restores the
       * reader's position instead of jumping again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param revision - the `navigation.revision` answered.
       */
      navigated: (d, tabId: TabId, revision: number) => {
        bucket(d, tabId).revision = revision
      },
      /**
       * Adopt complete text read from disk as the editor's content and baseline.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param text - the complete file text.
       * @param version - the version token the text was read at.
       * @param observedVersion - the metadata version observed at load.
       */
      editLoaded: (d, tabId: TabId, text: string, version: string, observedVersion: string | undefined) => {
        bucket(d, tabId).edit = {
          text, savedText: text, version, observedVersion,
          saving: false, failure: undefined, conflict: false, gone: false, blocked: undefined,
        }
      },
      /**
       * Keep the editor's current text; the draft may be ahead of disk.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param text - the text the editor shows.
       */
      editDraft: (d, tabId: TabId, text: string) => {
        const edit = d.byTab[tabId]?.edit
        if (edit === undefined) return
        edit.text = text
        edit.failure = undefined
      },
      /** @param d - draft. @param tabId - owning tab. A save request is in flight. */
      editSaving: (d, tabId: TabId) => {
        const edit = d.byTab[tabId]?.edit
        if (edit === undefined) return
        edit.saving = true
        edit.failure = undefined
      },
      /**
       * Record the text now on disk; a draft may already have moved past it.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param text - the content the Host confirmed.
       * @param version - the version token the Host returned.
       */
      editSaved: (d, tabId: TabId, text: string, version: string) => {
        const edit = d.byTab[tabId]?.edit
        if (edit === undefined) return
        edit.savedText = text
        edit.version = version
        edit.saving = false
        edit.failure = undefined
        edit.conflict = false
        edit.gone = false
      },
      /**
       * Record why a save failed; the draft stays for a retry.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      editFailed: (d, tabId: TabId, failure: RemoteFailure) => {
        const edit = d.byTab[tabId]?.edit
        if (edit === undefined) return
        edit.saving = false
        edit.failure = failure
        edit.conflict = false
        edit.gone = false
      },
      /**
       * Record that the disk moved under the draft; saving pauses until the
       * reader picks a side.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      editConflicted: (d, tabId: TabId) => {
        const edit = d.byTab[tabId]?.edit
        if (edit === undefined) return
        edit.saving = false
        edit.conflict = true
        edit.gone = false
      },
      /**
       * Record that the file is gone; the text stays for copying.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      editGone: (d, tabId: TabId) => {
        const edit = d.byTab[tabId]?.edit
        if (edit === undefined) return
        edit.saving = false
        edit.gone = true
        edit.conflict = false
      },
      /**
       * Record that this file cannot be edited, so the read-only rendering stands.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param reason - what the disk read or the file's bytes showed.
       */
      editBlocked: (d, tabId: TabId, reason: EditBlockReason) => {
        bucket(d, tabId).edit = {
          text: '', savedText: '', version: '', observedVersion: undefined,
          saving: false, failure: undefined, conflict: false, gone: false, blocked: reason,
        }
      },
      /**
       * Drop one tab's state, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        const byTab: TextState['byTab'] = {}
        // Keys were written from tab ids; reading them back as ids is exact.
        for (const [id, state] of Object.entries(d.byTab) as [TabId, TextTabState][]) {
          if (id !== tabId) byTab[id] = state
        }
        d.byTab = byTab
      },
    },
  })
}

/** The store handle type both registrations declare. */
export type TextStore = ReturnType<typeof createTextStore>
