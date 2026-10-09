/**
 * The file tree's body: the session's workspace root, listed one level at a time.
 *
 * Everything the tree keeps lives in its store, keyed by tab; everything it asks
 * for goes through its injected face. The component itself only decides what to
 * draw for each absolute path and what a click means: a directory toggles, a
 * file opens through the owner's `tabActions` for a `file:` viewer to claim, and
 * anything else is shown but refuses to open. The header uses the shared
 * PathLabel for the root, followed by reload for the expanded directories.
 *
 * A secondary press on a directory row, or on the body outside every row,
 * offers a new file or folder there; the choice opens one name row at the top
 * of that directory's level.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Conversation standard-prop merge (`addToConversation`).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  ContextMenu, FileTypeIcon, IconFolderCloseRegular, IconFolderOpenRegular, IconRefreshOutlineRegular,
  IconWarningOutlineRegular, Toast, Tooltip, classifyFileType, IconPauseOutlineRegular, IconPlayOutlineRegular, PathLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextMenuPoint, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { childPath } from './face.ts'
import type { FilesInjected } from './face.ts'
import type {} from './locales.ts'
import type { CreateDraft, FilesTabState, createFilesStore } from './store.ts'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * Say why a directory could not be listed, in terms of the directory.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory.
 */
export function failureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/**
 * Say why a new entry could not be created, in terms of the name row.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure, or the Client's own refusal of the name.
 * @returns the line to show under the name row.
 */
export function createFailureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/already-exists': return t('create.exists')
    case 'workspace-file/invalid-name': return t('create.invalidName')
    case 'workspace-file/not-found':
    case 'workspace-file/not-directory': return t('create.parentGone')
    // A provider that cannot create, a sandbox refusal, and a transport
    // failure reach the reader as themselves.
    default: return t('create.failed', { message: failure.message })
  }
}

/** One entry the reader can offer to the current conversation. */
interface RowTarget {
  /** Absolute path of the level the row is listed in. */
  readonly parent: string
  readonly path: string
  readonly name: string
  readonly kind: 'file' | 'directory'
}

/** What every level shares: the tab's tree and the row gestures. */
interface TreeContext {
  readonly state: FilesTabState
  readonly onToggle: (parent: string, path: string) => void
  readonly onOpen: (path: string) => void
  /** Open the row's context menu at the pointer. */
  readonly onRowMenu: (target: RowTarget, point: ContextMenuPoint) => void
  /** Submit the open name row. */
  readonly onCreate: (draft: CreateDraft, name: string) => void
  /** Close the open name row without creating anything. */
  readonly onCancelCreate: () => void
  readonly t: TranslateNS<'sidebarFiles'>
}

/** One entry's row, and its children when it is an expanded directory. */
function Entry({ parent, entry, tree }: { parent: string; entry: WorkspaceDirectoryEntry; tree: TreeContext }): ReactNode {
  const path = childPath(parent, entry.name)
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className={css.item} data-files-entry="directory" data-files-path={path}>
        <button
          type="button"
          className={css.row}
          aria-expanded={expanded}
          onClick={() => { tree.onToggle(parent, path) }}
          onContextMenu={(event) => {
            event.preventDefault()
            tree.onRowMenu({ parent, path, name: entry.name, kind: 'directory' }, { x: event.clientX, y: event.clientY })
          }}
        >
          {expanded ? <IconFolderOpenRegular className={css.icon} /> : <IconFolderCloseRegular className={css.icon} />}
          <span className={css.name}>{entry.name}</span>
        </button>
        {expanded && <ul className={css.level}><Level path={path} tree={tree} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    return (
      <li className={css.item} data-files-entry="file" data-files-path={path}>
        <button
          type="button"
          className={css.row}
          onClick={() => { tree.onOpen(path) }}
          onContextMenu={(event) => {
            event.preventDefault()
            tree.onRowMenu({ parent, path, name: entry.name, kind: 'file' }, { x: event.clientX, y: event.clientY })
          }}
        >
          <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
          <span className={css.name}>{entry.name}</span>
        </button>
      </li>
    )
  }
  return (
    <li className={css.item} data-files-entry="other" data-files-path={path}>
      <span className={clsx(css.row, css.other)} aria-disabled="true" title={tree.t('entry.other')}>
        <span className={css.name}>{entry.name}</span>
      </span>
    </li>
  )
}

/**
 * The name row for one new entry: Enter submits, Escape or losing focus closes
 * it, and neither does anything while a submission is in flight.
 */
function DraftRow({ draft, tree }: { draft: CreateDraft; tree: TreeContext }): ReactNode {
  const { t } = tree
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Focus on open, and again when a refused submission hands the row back:
  // the browser drops focus from an input while it is disabled.
  useEffect(() => {
    if (!draft.pending) inputRef.current?.focus()
  }, [draft.pending])
  return (
    <li className={css.item} data-files-draft={draft.type}>
      <span className={css.draft}>
        {draft.type === 'directory'
          ? <IconFolderCloseRegular className={css.icon} />
          : <FileTypeIcon kind={classifyFileType(name)} size={16} className={css.fileIcon} />}
        <input
          ref={inputRef}
          className={css.draftInput}
          value={name}
          disabled={draft.pending}
          placeholder={t('create.placeholder')}
          aria-label={t(draft.type === 'directory' ? 'menu.newFolder' : 'menu.newFile')}
          aria-invalid={draft.failure !== undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setName(event.target.value) }}
          onKeyDown={(event) => {
            // Enter and Escape that settle an IME composition belong to the IME.
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              tree.onCreate(draft, name)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              tree.onCancelCreate()
            }
          }}
          onBlur={() => {
            if (!draft.pending) tree.onCancelCreate()
          }}
        />
      </span>
      {draft.failure !== undefined && (
        <p className={css.draftError} role="alert" data-files-draft-error={draft.failure.code}>
          {createFailureLine(t, draft.failure)}
        </p>
      )}
    </li>
  )
}

/** One directory's rows: its open name row first, then its state while listing or its entries once listed. */
function Level({ path, tree }: { path: string; tree: TreeContext }): ReactNode {
  const { state, t } = tree
  const level = state.levels[path]
  const draft = state.draft?.parent === path
    ? <DraftRow key={state.draft.type} draft={state.draft} tree={tree} />
    : null
  if (level === undefined || level.kind === 'loading') {
    return (
      <>
        {draft}
        <li className={css.note} data-files-row="loading">{t('loading')}</li>
      </>
    )
  }
  if (level.kind === 'failed') {
    return (
      <>
        {draft}
        <li className={css.note} data-files-row="failed" data-files-code={level.failure.code}>
          {failureLine(t, level.failure)}
        </li>
      </>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {draft}
      {level.failure !== undefined && <li className={css.note} data-files-row="failed">{failureLine(t, level.failure)}</li>}
      {entries.length === 0 && <li className={css.note} data-files-row="empty">{t('empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.level.truncated && <li className={css.note} data-files-row="truncated">{t('truncated')}</li>}
    </>
  )
}

/** The file tree's body: the workspace root and whatever the reader has opened under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, start, refresh, setAutoRefresh, toggle, beginCreate, cancelCreate, create,
  addToConversation, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  useEffect(() => tab.actions.bindCommands({ refresh: () => { refresh(tab.id) } }), [tab.actions, tab.id, refresh])
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  const [rowMenu, setRowMenu] = useState<{ target: RowTarget; point: ContextMenuPoint } | null>(null)
  // The menu for a press on the body outside every row; its target is the root.
  const [bodyMenu, setBodyMenu] = useState<ContextMenuPoint | null>(null)
  // Counts failed adds so the same refusal replays the banner (0 = none shown).
  const [addFailure, setAddFailure] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. A fresh tree stores 0.
  const seeded = state !== undefined
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded])
  // Scrolling only moves the ref; the store hears about it once, on unmount,
  // so a scroll neither re-renders the tree nor writes after the owner's
  // abort has forgotten the bucket.
  useEffect(() => () => {
    if (seeded && !signal.aborted) actions.scrolled(tab.id, scrollTopRef.current)
  }, [seeded, signal, tab.id, actions])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null
  const tree: TreeContext = {
    state,
    onToggle: (parent, path) => { toggle(tab.id, parent, path, state.expanded, signal) },
    // Every row is under the tree's root, so its address is session-relative.
    onOpen: (path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path), { preferOtherPane: true }) },
    onRowMenu: (target, point) => {
      setBodyMenu(null)
      setRowMenu({ target, point })
    },
    onCreate: (draft, name) => { create(tab.id, draft.parent, name, draft.type, signal) },
    onCancelCreate: () => { cancelCreate(tab.id, signal) },
    t,
  }
  const reload = (): void => {
    refresh(tab.id)
  }
  const createItems: readonly MenuItem[] = [
    { id: 'new-file', label: t('menu.newFile') },
    { id: 'new-folder', label: t('menu.newFolder') },
  ]
  const addItems: readonly MenuItem[] = [
    { id: 'add-to-conversation', label: t('menu.addToConversation'), disabled: addToConversation === undefined },
  ]
  const rowItems = rowMenu?.target.kind === 'directory' ? [...createItems, ...addItems] : addItems
  /** Open the name row in one directory, expanding that directory first when it is a collapsed row. */
  const startCreate = (parent: string, path: string, id: string): void => {
    if (!state.expanded.includes(path)) toggle(tab.id, parent, path, state.expanded, signal)
    beginCreate(tab.id, path, id === 'new-folder' ? 'directory' : 'file', signal)
  }
  const addRow = (target: RowTarget): void => {
    /* v8 ignore next -- the row is disabled when the verb is absent, so this guard is belt-and-braces. */
    if (addToConversation === undefined) return
    // The chip's label is the row's own name; a folder keeps the trailing slash
    // the reference grammar uses for directories.
    const label = target.kind === 'directory' ? `${target.name}/` : target.name
    // A refusal (a path the mention grammar cannot represent, or a composer that
    // is locked or gone) writes nothing; say so instead of closing on a no-op.
    if (addToConversation({ kind: 'reference', path: target.path, target: target.kind, label }) !== 'inserted') {
      setAddFailure(seq => seq + 1)
    }
  }
  return (
    <div className={css.root} data-files-state="tree" data-files-root={state.root}>
      <div className={css.header}>
        <PathLabel path={state.root} className={css.path} data-files-path />
        <span hidden>
          <button type="button" className={css.tool} aria-label={t('autoRefresh')}
            aria-pressed={state.autoRefresh} data-files-auto-refresh
            title={t(state.autoRefresh ? 'autoRefresh.disable' : 'autoRefresh.enable')}
            onClick={() => { setAutoRefresh(tab.id, !state.autoRefresh) }}>
            {state.autoRefresh ? <IconPauseOutlineRegular /> : <IconPlayOutlineRegular />}
          </button>
        </span>
        <Tooltip label={t('reload')} shortcutKeys={tab.refreshShortcut?.keys} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('reload')}
            aria-keyshortcuts={tab.refreshShortcut?.aria}
            data-files-reload
            onClick={reload}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
      </div>
      <div
        ref={bodyRef}
        className={css.body}
        data-files-body
        onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
        onContextMenu={(event) => {
          // A row answers for itself, and the name row keeps the platform's text menu.
          if ((event.target as Element).closest('[data-files-entry], [data-files-draft]') !== null) return
          event.preventDefault()
          setRowMenu(null)
          setBodyMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        <ul className={css.level}><Level path={state.root} tree={tree} /></ul>
      </div>
      {rowMenu !== null && (
        <ContextMenu
          point={rowMenu.point}
          items={rowItems}
          onSelect={(id) => {
            if (id === 'add-to-conversation') addRow(rowMenu.target)
            else startCreate(rowMenu.target.parent, rowMenu.target.path, id)
            setRowMenu(null)
          }}
          onClose={() => { setRowMenu(null) }}
        />
      )}
      <ContextMenu
        point={bodyMenu}
        items={createItems}
        onSelect={(id) => {
          startCreate(state.root, state.root, id)
          setBodyMenu(null)
        }}
        onClose={() => { setBodyMenu(null) }}
      />
      {addFailure > 0 && (
        <Toast
          key={addFailure}
          text={t('menu.addFailed')}
          icon={<IconWarningOutlineRegular />}
          onDone={() => { setAddFailure(0) }}
        />
      )}
    </div>
  )
}
