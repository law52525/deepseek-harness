/**
 * The editor's asynchronous half: reading complete text, writing it back under
 * the version guard, and flushing the last input when the tab closes.
 *
 * One record per (Session, tab) — tab ids are minted per Session, so the pair is
 * the identity — holding the draft, the disk baseline, and whatever request is
 * in flight. Every save is single-flight: input during one is written by the
 * settlement, which starts the next save itself, so the newest draft always
 * lands without two requests racing. A save never rides the tab's `signal`:
 * closing the tab must not cancel the write that closing asked for. Store
 * writes stop the moment a close starts, because the tab's bucket is forgotten
 * with its record; the request itself still settles.
 *
 * The disk moving under a draft (a save refused as stale, or an external write
 * the body noticed) pauses saving until the reader picks a side; nothing here
 * writes while paused. When the reader's chosen request fails — the disk read,
 * or the overwrite's stat — the failure bar retries that same request, so the
 * draft a "load the disk" choice abandoned never reaches the writer.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { DocumentFileBytes, ReadDocumentBytes, SessionFile, StatWorkspaceFile, WriteWorkspaceFileText } from '../rpc.ts'
import type { TextStore } from '../store.ts'
import { carrierFailure } from '../rpc.ts'
import { decodeEditBytes, EDIT_DEBOUNCE_MS } from './access.ts'

/** What one editor session needs from the Remote. */
export interface EditReads {
  /** Complete-file byte read; the editor's own read, never a page walk. */
  readonly readAll: ReadDocumentBytes
  /** Version-guarded whole-file replacement. */
  readonly write: WriteWorkspaceFileText
  /** Fresh identity and version of the file, for the overwrite path. */
  readonly stat: StatWorkspaceFile
}

/**
 * The editor's operations, one per body interaction. Every tab id is paired
 * with its Session because tab ids are unique only within one.
 */
export interface EditEngine {
  /**
   * Start editing a tab: read the complete file, keep it, and remember the
   * version the text was read at. Reading is asynchronous; the store gains the
   * editor when it settles. An editor already open for the same address is
   * left alone; one open for a different address (the tab was replaced) is
   * replaced with the new file.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   * @param address - the tab's content address, telling a replacement from a remount.
   * @param file - the Session and path the address names.
   * @param observedVersion - the metadata version observed at open.
   * @param actions - the store's bound actions for this Session.
   * @param signal - the tab record's lifetime.
   */
  open(
    sessionId: SessionId,
    tabId: TabId,
    address: string,
    file: SessionFile,
    observedVersion: string | undefined,
    actions: BoundActions<TextStore>,
    signal: AbortSignal,
  ): void
  /**
   * Keep the editor's newest text; a save follows the debounce unless one is
   * already in flight, in which case its settlement saves the newer text.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   * @param text - the text the editor now holds.
   */
  changed(sessionId: SessionId, tabId: TabId, text: string): void
  /**
   * Note that an input method editor is composing, which suspends saving until
   * it ends.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   * @param active - whether a composition is in progress.
   */
  composition(sessionId: SessionId, tabId: TabId, active: boolean): void
  /**
   * Save now, without waiting for the debounce; nothing is written while a
   * conflict or a lost file is unresolved.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   */
  flush(sessionId: SessionId, tabId: TabId): void
  /**
   * Retry what the failure bar failed at: the reader's chosen disk read while
   * one is outstanding, the conflict's overwrite while the disk question
   * stands, otherwise the save. A failed read is never retried as the
   * overwrite, so the draft the reader abandoned stays unwritten.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   */
  retry(sessionId: SessionId, tabId: TabId): void
  /**
   * Write the draft over the disk version, whatever it is now: stat for the
   * current version, then write with it.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   */
  overwrite(sessionId: SessionId, tabId: TabId): void
  /**
   * Replace the text with what is on disk now, for a reader who picks the disk
   * over their draft.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   * @param observedVersion - the metadata version observed when the reload was decided.
   */
  reload(sessionId: SessionId, tabId: TabId, observedVersion: string | undefined): void
  /**
   * Pause saving because the disk moved under a non-empty draft. While a
   * failed chosen answer owns the failure bar, this keeps that bar: re-asking
   * would hide the retry that is the only way out of the failure.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   */
  conflict(sessionId: SessionId, tabId: TabId): void
  /**
   * Pause saving because the file is gone; the text stays for copying.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being edited.
   */
  gone(sessionId: SessionId, tabId: TabId): void
  /**
   * Flush the last input of a closing tab. Called by the Sidebar's close hook
   * before the record commits away, so the write outlives the tab.
   * @param sessionId - the Session the tab belongs to.
   * @param tabId - the tab being closed.
   */
  close(sessionId: SessionId, tabId: TabId): void
}

/** Why saving is paused: the disk moved under the draft, or the file is gone. */
type EditPause = 'conflict' | 'gone' | undefined

/**
 * How the disk question was last answered, while that answer's request is
 * failed: a disk read, or the overwrite's stat. The failure bar's retry
 * repeats the recorded side, never the other one.
 */
type FailedAnswer =
  | { readonly side: 'read'; readonly failure: RemoteFailure; readonly observedVersion: string | undefined }
  | { readonly side: 'overwrite'; readonly failure: RemoteFailure }

/** One tab's live editor: its draft, its baseline, and its in-flight request. */
interface EditRecord {
  readonly key: string
  readonly tabId: TabId
  readonly address: string
  readonly file: SessionFile
  readonly actions: BoundActions<TextStore>
  readonly signal: AbortSignal
  draft: string
  savedText: string
  version: string
  /** Newest complete-text read; an earlier read's settlement writes nothing. */
  loadGeneration: number
  /** The save request in flight, while one is. */
  controller: AbortController | undefined
  /** Complete text was read and editing began. */
  loaded: boolean
  /** An input method editor is composing; no save may start. */
  composing: boolean
  /** Saving is suspended until the reader answers the disk question. */
  pause: EditPause
  /** The reader's last explicit answer, while its request is failed. */
  failedAnswer: FailedAnswer | undefined
  /** A close started: the store is going away, but the save still finishes. */
  closing: boolean
  /** The tab record ended; nothing more is written. */
  aborted: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Whether a refusal is the version guard telling the caller the disk moved. */
function isStaleVersion(failure: RemoteFailure): boolean {
  return failure.code === 'workspace-file/stale-version'
}

/**
 * Bind the editor to one Remote-backed read, write, and stat.
 * @param reads - the Remote calls the editor performs.
 * @returns the engine the body and the close hook drive.
 */
export function createEditEngine(reads: EditReads): EditEngine {
  /** One key per (Session, tab): tab ids repeat across Sessions. */
  const keyOf = (sessionId: SessionId, tabId: TabId): string => `${sessionId}\u0000${tabId}`
  const records = new Map<string, EditRecord>()

  const discard = (record: EditRecord): void => {
    if (records.get(record.key) === record) records.delete(record.key)
  }
  /** The record for a tab that is still open and accepting writes. */
  const live = (sessionId: SessionId, tabId: TabId): EditRecord | undefined => {
    const record = records.get(keyOf(sessionId, tabId))
    return record === undefined || record.aborted ? undefined : record
  }
  /** Whether store writes are over: the close started or the record ended. */
  const muted = (record: EditRecord): boolean => record.closing || record.aborted
  /**
   * Whether the record still owes its newest draft to disk. After a close that
   * did not ask for a flush, it does not: only the close path may write once
   * the tab is gone.
   */
  const owesWrite = (record: EditRecord): boolean =>
    record.loaded && record.pause === undefined && !record.composing
    && record.draft !== record.savedText && (!record.aborted || record.closing)
  const clearTimer = (record: EditRecord): void => {
    if (record.timer === undefined) return
    clearTimeout(record.timer)
    record.timer = undefined
  }
  /** Drop a record that neither a request nor a pending write needs. */
  const retire = (record: EditRecord): void => {
    if ((record.closing || record.aborted) && record.controller === undefined && !owesWrite(record)) discard(record)
  }
  const schedule = (record: EditRecord): void => {
    clearTimer(record)
    record.timer = setTimeout(() => {
      record.timer = undefined
      if (!owesWrite(record) || record.controller !== undefined) return
      send(record)
    }, EDIT_DEBOUNCE_MS)
  }
  const settleSave = (record: EditRecord, text: string, result: RemoteResult<WorkspaceFileStat>): void => {
    record.controller = undefined
    if (result.ok) {
      record.savedText = text
      record.version = result.value.version
      record.pause = undefined
      if (!muted(record)) record.actions.editSaved(record.tabId, text, result.value.version)
      // Input that arrived during the request goes out now: one request at a
      // time, and never a dropped last edit.
      if (owesWrite(record)) send(record)
      retire(record)
      return
    }
    const failure = result.error
    if (!muted(record)) {
      if (isStaleVersion(failure)) {
        record.pause = 'conflict'
        record.actions.editConflicted(record.tabId)
      } else if (failure.code === 'workspace-file/not-found') {
        record.pause = 'gone'
        record.actions.editGone(record.tabId)
      } else {
        record.actions.editFailed(record.tabId, failure)
      }
    }
    retire(record)
  }
  /** Send the draft under the record's own baseline; callers checked `owesWrite`. */
  const send = (record: EditRecord): void => {
    const controller = new AbortController()
    record.controller = controller
    const text = record.draft
    if (!muted(record)) record.actions.editSaving(record.tabId)
    void reads.write(record.file, text, record.version, controller.signal).then((result) => {
      settleSave(record, text, result)
    }, (error: unknown) => {
      settleSave(record, text, { ok: false, error: carrierFailure(error) })
    })
  }
  const loadFailure = (record: EditRecord, failure: RemoteFailure, observedVersion: string | undefined): void => {
    if (record.loaded && failure.code === 'workspace-file/not-found') {
      record.pause = 'gone'
      record.failedAnswer = undefined
      record.actions.editGone(record.tabId)
      return
    }
    // A disk read that failed under the standing question is a failed answer,
    // not a new one: its own retry re-reads, and nothing writes meanwhile.
    // A loss inside an editor that never loaded falls back to the read-only
    // body, which carries the reason on its own.
    if (record.loaded && record.pause === 'conflict') {
      record.failedAnswer = { side: 'read', failure, observedVersion }
      record.actions.editFailed(record.tabId, failure)
      return
    }
    record.actions.editBlocked(record.tabId, 'unavailable')
  }
  const load = (record: EditRecord, observedVersion: string | undefined): void => {
    const generation = ++record.loadGeneration
    const applied = (result: RemoteResult<DocumentFileBytes>): void => {
      if (muted(record) || record.loadGeneration !== generation) return
      if (!result.ok) {
        loadFailure(record, result.error, observedVersion)
        return
      }
      const decoded = decodeEditBytes(result.value.data)
      if (decoded.kind === 'blocked') {
        record.actions.editBlocked(record.tabId, decoded.reason)
        return
      }
      record.draft = decoded.text
      record.savedText = decoded.text
      record.version = result.value.version
      record.loaded = true
      record.pause = undefined
      record.failedAnswer = undefined
      record.actions.editLoaded(record.tabId, decoded.text, result.value.version, observedVersion)
    }
    void reads.readAll(record.file, record.signal).then((result) => {
      applied(result)
    }, (error: unknown) => {
      applied({ ok: false, error: carrierFailure(error) })
    })
  }
  /**
   * Write the draft over whatever is on disk: stat for the current version,
   * then write with it. The write finishes even when the tab closes meanwhile,
   * because overwriting is what the reader chose.
   */
  const overwrite = (record: EditRecord): void => {
    const controller = new AbortController()
    record.controller = controller
    if (!muted(record)) record.actions.editSaving(record.tabId)
    void reads.stat(record.file, controller.signal).then((result) => {
      if (record.controller !== controller) return
      record.controller = undefined
      if (!result.ok) {
        if (!muted(record)) {
          record.failedAnswer = { side: 'overwrite', failure: result.error }
          record.actions.editFailed(record.tabId, result.error)
        }
        retire(record)
        return
      }
      // The reader answered the disk question with this overwrite: the fresh
      // version is the new baseline and saving resumes, so the draft goes out
      // even when it happens to match the tab's last known disk text.
      record.version = result.value.version
      record.pause = undefined
      record.failedAnswer = undefined
      send(record)
    }, (error: unknown) => {
      if (record.controller !== controller) return
      record.controller = undefined
      if (!muted(record)) {
        const failure = carrierFailure(error)
        record.failedAnswer = { side: 'overwrite', failure }
        record.actions.editFailed(record.tabId, failure)
      }
      retire(record)
    })
  }
  return {
    open: (sessionId, tabId, address, file, observedVersion, actions, signal) => {
      if (signal.aborted) return
      const key = keyOf(sessionId, tabId)
      const held = records.get(key)
      if (held !== undefined) {
        // The body remounts freely; only a different address is a new file.
        if (held.address === address) return
        discard(held)
      }
      const record: EditRecord = {
        key, tabId, address, file, actions, signal,
        draft: '', savedText: '', version: '',
        loadGeneration: 0, controller: undefined, loaded: false,
        composing: false, pause: undefined, failedAnswer: undefined,
        closing: false, aborted: false, timer: undefined,
      }
      records.set(key, record)
      signal.addEventListener('abort', () => {
        record.aborted = true
        clearTimer(record)
        // The bucket dies with the record; a request still in flight settles
        // silently and retires what it holds.
        actions.forget(tabId)
        retire(record)
      }, { once: true })
      load(record, observedVersion)
    },
    changed: (sessionId, tabId, text) => {
      const record = live(sessionId, tabId)
      if (record === undefined) return
      record.draft = text
      record.actions.editDraft(tabId, text)
      // Typing moves the draft, not the question: the failure bar the reader
      // still has to answer stays (the draft action clears it otherwise).
      if (record.failedAnswer !== undefined) record.actions.editFailed(tabId, record.failedAnswer.failure)
      if (owesWrite(record) && record.controller === undefined) schedule(record)
    },
    composition: (sessionId, tabId, active) => {
      const record = live(sessionId, tabId)
      if (record === undefined) return
      record.composing = active
      if (!active && owesWrite(record) && record.controller === undefined) schedule(record)
    },
    flush: (sessionId, tabId) => {
      const record = live(sessionId, tabId)
      if (record === undefined) return
      clearTimer(record)
      if (!owesWrite(record) || record.controller !== undefined) return
      send(record)
    },
    retry: (sessionId, tabId) => {
      const record = live(sessionId, tabId)
      if (record === undefined) return
      if (record.pause === 'gone') return
      // Repeat the reader's own answer: a failed disk read re-reads, and never
      // turns into the overwrite it would then be.
      if (record.failedAnswer?.side === 'read') {
        load(record, record.failedAnswer.observedVersion)
        return
      }
      if (record.pause === 'conflict') {
        overwrite(record)
        return
      }
      clearTimer(record)
      if (owesWrite(record) && record.controller === undefined) send(record)
    },
    overwrite: (sessionId, tabId) => {
      const record = live(sessionId, tabId)
      if (record === undefined || record.pause !== 'conflict' || record.controller !== undefined) return
      overwrite(record)
    },
    reload: (sessionId, tabId, observedVersion) => {
      const record = live(sessionId, tabId)
      if (record === undefined) return
      load(record, observedVersion)
    },
    conflict: (sessionId, tabId) => {
      const record = live(sessionId, tabId)
      if (record === undefined || muted(record)) return
      // A failed answer owns the bar: re-asking would replace its retry with
      // the same question and hide the failure's only way out.
      if (record.failedAnswer !== undefined) return
      clearTimer(record)
      record.pause = 'conflict'
      record.actions.editConflicted(tabId)
    },
    gone: (sessionId, tabId) => {
      const record = live(sessionId, tabId)
      if (record === undefined || muted(record)) return
      clearTimer(record)
      record.pause = 'gone'
      record.actions.editGone(tabId)
    },
    close: (sessionId, tabId) => {
      const record = records.get(keyOf(sessionId, tabId))
      if (record === undefined) return
      // Store writes are over, but this record still owes its draft: the last
      // input was typed after the debounce's last save.
      record.closing = true
      clearTimer(record)
      if (owesWrite(record) && record.controller === undefined) send(record)
      retire(record)
    },
  }
}
