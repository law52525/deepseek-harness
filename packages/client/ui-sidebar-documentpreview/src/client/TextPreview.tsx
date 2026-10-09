/**
 * The text preview's body: a file's content, or the reason it is not showing.
 *
 * Two sources meet here. The standard `useResource` hook gives the file's
 * metadata — its version — and this type's
 * own store holds the content it read through its face. Metadata changes reload
 * the current preview while automatic refresh is enabled. A failed metadata frame — the file gone, its
 * workspace unknown — takes the same bar's place over the pages already loaded,
 * with the same reload. The type's controls, viewer choice, wrap and reload, sit at the end of
 * the path row; the Sidebar's strip carries none of them.
 *
 * A document the source viewers may edit (markdown, yaml — see `edit/access`)
 * replaces its read-only rendering with the editor over the complete text,
 * saved automatically; the viewer menu is the entry, so choosing the viewer is
 * what starts and stops editing. The editor's own bars carry a disk change the
 * reader has to answer, and the header carries the save state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import clsx from 'clsx'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Conversation standard-prop merge (`addToConversation`).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  ContextMenu, FileTypeIcon, IconNowrapFillRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconRefreshOutlineRegular, IconWarningOutlineRegular, IconWrapFillRegular, Menu, PathLabel, Toast, Tooltip,
  classifyFileType, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextMenuPoint, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { TextInjected } from './face.ts'
import { emptyFailureRecourse, failureLine, humanBytes } from './failure-line.ts'
import { EDIT_MAX_BYTES, decideEditAccess } from './edit/access.ts'
import { EditBody, scrollEditorToLine } from './edit/EditBody.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { hostFileOf } from './rpc.ts'
import type { TextStore } from './store.ts'
import type { DocumentContent } from './document/contract.ts'
import { binaryDocumentPath, matchingDocumentPreviews } from './document/registry.ts'
import type { DocumentPreviewDefinition } from './document/registry.ts'
import { unviewableBinaryPath } from './document/unviewable.ts'
import { CODE_BODY_ID } from './code/index.ts'
import { PLAIN_BODY_ID } from './text/index.ts'
import { loadedPages, lastLineLoaded, scrollToLine } from './text/lines.ts'
import { buildSelectionSnippet, isSelectionAtLoadedEnd, readPreviewSelection } from './selection-snippet.ts'
import type { PreviewSelection } from './selection-snippet.ts'
import css from './TextPreview.module.css'

export { linesOf, loadedPages, lastLineLoaded, scrollToLine } from './text/lines.ts'
export type { LoadedPage } from './text/lines.ts'

/** Private registration inputs; the framework binds the registry source to useDocumentPreviews. */
export interface TextPreviewInjected extends TextInjected {
  readonly hooks: { readonly documentPreviews: ObservableSnapshot<readonly DocumentPreviewDefinition[]> }
}

/** The body's composed props: the tab, its navigation, the shared store and face, and copy. */
export type TextPreviewProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidebar.right.tab.document' | 'sidebar.right.tab.document.action' | 'sidebar.right.tab.document.actions' | 'sidebar.right.tab.document.unpreviewable'>
  & PropsStore<TextStore>
  & InjectFace<TextPreviewInjected>
  & PropsLocale<'sidebarDocumentPreview'>

/**
 * The text type's body, registered under `sidebar.right.pane.tab` as `text`.
 * @param props - composed slot props.
 * @returns the content read so far with its controls, or a progress line.
 */
export function TextPreview({
  useTabInfo, useResource, useSessions, sessionId, useStore, actions, loadPage, reloadPages,
  loadAll, reloadAll, prepareRenderer, openEditor, editChanged, editComposing, saveNow,
  retryEdit, overwriteEdit, reloadEdit, conflictEdit, goneEdit,
  useDocumentPreviews, renderSlot, addToConversation, t,
  addResource, setResources,
}: TextPreviewProps): ReactNode {
  const { tab } = useTabInfo()
  const { navigation, signal } = tab
  const meta = useResource<'file'>(tab.contentId)
  const canRead = meta.status !== 'none'
  const file = useMemo(() => hostFileOf(tab.contentId), [tab.contentId])
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(s => s.byTab[tab.id])
  const editState = state?.edit
  const definitions = useDocumentPreviews(value => value)
  const unviewable = useMemo(() => unviewableBinaryPath(file.path), [file.path])
  const candidates = useMemo(() => {
    const matched = matchingDocumentPreviews(definitions, file.path)
    if (matched.length > 0 && binaryDocumentPath(definitions, file.path)) return matched
    if (matched.length === 0 && unviewable) return matched
    const fallback = definitions.find(definition => definition.id === PLAIN_BODY_ID)
    return fallback === undefined ? matched : [...matched, fallback]
  }, [definitions, file.path, unviewable])
  const selected = candidates.find(candidate => candidate.id === state?.rendererId) ?? candidates[0]
  const mode = selected?.loading
  const contentRendererId = mode === 'renderer' ? selected?.id : undefined
  const current = (state?.mode ?? 'text-pages') === mode && state?.contentRendererId === contentRendererId ? state : undefined
  // The source viewers edit the documents the edit rules accept; every other
  // viewer and file keeps its read-only rendering, and a refusal the rules made
  // for an otherwise editable file is named in the header.
  const editableViewer = selected?.id === CODE_BODY_ID || selected?.id === PLAIN_BODY_ID
  const editAccess = decideEditAccess({
    cwd, path: file.path, editableViewer, bytes: meta.value?.bytes, blocked: editState?.blocked,
  })
  const inEditor = editAccess.kind === 'open'
  const readonlyReason = editAccess.kind === 'readonly' ? editAccess.reason : undefined
  // The editor session once its read settled; a refusal leaves it absent so the
  // read-only rendering stands.
  const edit = editState !== undefined && editState.blocked === undefined ? editState : undefined
  const add = useCallback((address: string) => {
    addResource(tab.id, address, signal)
  }, [addResource, tab.id, signal])
  const set = useCallback((addresses: readonly string[]) => {
    setResources(tab.id, [tab.contentId, ...addresses], signal)
  }, [setResources, tab.id, tab.contentId, signal])
  useEffect(() => {
    set([])
  }, [set, selected?.id])
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollportRef = useRef<HTMLElement | null>(null)
  const storedScrollTopRef = useRef(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectionMenu, setSelectionMenu] = useState<{ point: ContextMenuPoint; selection: PreviewSelection } | null>(null)
  // Counts refused snippet adds so the same failure replays the banner (0 = none shown).
  const [addFailure, setAddFailure] = useState(0)
  const absolutePath = meta.value?.absolutePath ?? current?.complete?.absolutePath
  const displayPath = absolutePath ?? file.path
  // Contributions that hand the file to the Host wait for its Host path.
  const fileOwner = absolutePath === undefined ? undefined : { absolutePath }
  // Every tab of this type is a `file` resource address, so its params are the
  // `file` type's; the union is narrowed on the one field read, not validated.
  const line = navigation.params !== undefined && 'line' in navigation.params ? navigation.params.line : undefined
  const pages = current?.pages
  const loaded = useMemo(() => loadedPages(pages ?? {}), [pages])
  const loadedThrough = lastLineLoaded(loaded)
  const hasContent = mode === 'renderer' ? current?.version !== undefined : loaded.length > 0 || current?.complete !== undefined
  storedScrollTopRef.current = state?.scrollTop ?? 0
  const bindBody = useCallback((body: HTMLDivElement | null): void => {
    const previous = bodyRef.current
    bodyRef.current = body
    if (scrollportRef.current === null || scrollportRef.current === previous) scrollportRef.current = body
  }, [])
  const bindScrollport = useCallback((scrollport: HTMLElement | null): void => {
    const next = scrollport ?? bodyRef.current
    scrollportRef.current = next
    if (next !== null) next.scrollTop = storedScrollTopRef.current
  }, [])

  // First mount reads the first page; a body coming back to a tab with content
  // reads nothing, because the store outlives the body. A read records the mode
  // it started, and an editor's bucket records none, so an editable tab reads no
  // page at all.
  const started = current !== undefined && current.mode !== undefined
  useEffect(() => {
    if (inEditor || started || !canRead || mode === undefined || selected === undefined) return
    if (mode === 'text-pages') loadPage(tab.id, file, 1, signal, meta.value?.version)
    else if (mode === 'bytes-complete') loadAll(tab.id, file, signal, meta.value?.version)
    else prepareRenderer(tab.id, signal, selected.id, meta.value?.version)
  }, [inEditor, started, tab.id, file, signal, loadPage, loadAll, prepareRenderer, canRead, mode, selected, meta.value?.version])

  // Opening the editor reads the complete file once per tab record; a body
  // remounting over a record that already loaded reads nothing and keeps the
  // draft, so switching viewers never loses input.
  useEffect(() => {
    if (!inEditor || editState !== undefined || !canRead) return
    openEditor(tab.id, tab.contentId, file, signal, meta.value?.version)
  }, [inEditor, editState, canRead, openEditor, tab.id, tab.contentId, file, signal, meta.value?.version])

  // Query the editor's textarea, which no other body part draws.
  const editorArea = (): HTMLTextAreaElement | undefined => {
    const area = bodyRef.current?.querySelector('[data-textpreview-editor]')
    return area instanceof HTMLTextAreaElement ? area : undefined
  }

  // Come back where the reader was once there is content to scroll: on a remount,
  // after a reload rebuilt the content, or after the selected renderer changed.
  // Scroll writes preserve both identities, so they never re-land.
  useEffect(() => {
    const body = scrollportRef.current
    if (hasContent && body !== null && state !== undefined) body.scrollTop = state.scrollTop
  }, [hasContent, selected?.id])

  // Answer a navigation once: a line the pages do not reach yet loads the next
  // page (again, until the pages cover it or the file ends); a line they hold
  // is scrolled to and marked. The store remembers the answer, so a remount
  // restores the reader's place instead.
  useEffect(() => {
    const body = scrollportRef.current
    if (inEditor || current === undefined || body === null || current.revision === navigation.revision) return
    if (line === undefined || mode !== 'text-pages') {
      actions.navigated(tab.id, navigation.revision)
      return
    }
    if (line > loadedThrough && !current.eof) {
      if (!current.loading && current.failure === undefined && canRead) {
        loadPage(tab.id, file, loadedThrough + 1, signal, meta.value?.version)
      }
      return
    }
    const landed = scrollToLine(body, line)
    if (!landed && line <= loadedThrough) return
    actions.navigated(tab.id, navigation.revision)
    // Recorded here as well as by the scroll event, so the store holds the
    // landing before any later navigation reads it.
    actions.scrolled(tab.id, body.scrollTop)
  }, [
    inEditor, navigation.revision, line, loadedThrough, current?.eof, current?.loading, current?.failure, started,
    selected?.id, mode, file, canRead, meta.value?.version,
  ])

  // An editor holds the whole file, so its navigation answers as soon as the
  // text is there: scroll the textarea to the line's measured share of the
  // text and mark the revision answered.
  useEffect(() => {
    if (!inEditor || edit === undefined || current === undefined || current.revision === navigation.revision) return
    if (line !== undefined) {
      const area = editorArea()
      if (area !== undefined) {
        scrollEditorToLine(area, line, edit.text)
        actions.scrolled(tab.id, area.scrollTop)
      }
    }
    actions.navigated(tab.id, navigation.revision)
  }, [inEditor, edit?.text, current?.revision, navigation.revision, line, actions, tab.id])

  const rendererReload = useCallback((): void => {
    if (canRead && selected !== undefined) prepareRenderer(tab.id, signal, selected.id, meta.value?.version, true)
  }, [canRead, prepareRenderer, tab.id, signal, selected?.id, meta.value?.version])
  const observedVersion = meta.value?.version
  // The editor's own saves echo back as metadata versions; comparing against
  // the version its text was loaded at and the one a save returned keeps the
  // echo from reading as an external write.
  const changed = inEditor
    ? edit !== undefined && observedVersion !== undefined
      && observedVersion !== edit.version && observedVersion !== edit.observedVersion
    : (current?.version !== undefined && observedVersion !== undefined
      && observedVersion !== current.version && observedVersion !== current.observedVersion)
      || state?.resourcesDirty === true
  const reload = useCallback((): void => {
    if (!canRead) return
    if (inEditor) {
      reloadEdit(tab.id, observedVersion)
      return
    }
    if (mode === 'text-pages') reloadPages(tab.id, file, signal, observedVersion)
    else if (mode === 'bytes-complete') reloadAll(tab.id, file, signal, observedVersion)
    else rendererReload()
  }, [canRead, inEditor, reloadEdit, mode, reloadPages, reloadAll, rendererReload, tab.id, file, signal, observedVersion])
  useEffect(() => tab.actions.bindCommands({ refresh: reload }), [tab.actions, reload])
  // External writes reach the editor over the same metadata channel: a clean
  // draft follows the disk silently, a dirty one asks the reader first. The
  // echo of this tab's own save never lands here (see `changed`).
  useEffect(() => {
    if (!state?.autoRefresh || !changed || meta.status !== 'live') return
    if (inEditor) {
      if (editState === undefined || editState.saving || editState.conflict || editState.gone) return
      if (editState.text !== editState.savedText) {
        conflictEdit(tab.id)
        return
      }
      reloadEdit(tab.id, observedVersion)
      return
    }
    if (current !== undefined && !current.loading) reload()
  }, [
    state?.autoRefresh, changed, inEditor, editState, current?.loading, meta.status,
    reload, conflictEdit, reloadEdit, tab.id, observedVersion,
  ])
  // Metadata loss of an open editor pauses saving: the draft must not be
  // written over a path that is gone.
  useEffect(() => {
    if (!inEditor || edit === undefined) return
    if (meta.failure?.code === 'workspace-file/not-found') goneEdit(tab.id)
  }, [inEditor, edit, meta.failure?.code, goneEdit, tab.id])
  // Leaving the editor flushes what the debounce still holds: the window's own
  // blur, and ⌘S / Ctrl+S without the browser's save-page dialog.
  useEffect(() => {
    if (!inEditor) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      saveNow(tab.id)
    }
    const onBlur = (): void => { saveNow(tab.id) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [inEditor, saveNow, tab.id])
  // The body unmounting — the reader switched to another tab — flushes too; a
  // record without unsaved input has nothing to write.
  useEffect(() => () => { saveNow(tab.id) }, [saveNow, tab.id])
  const content = useMemo((): DocumentContent | undefined => {
    if (mode === 'renderer') {
      if (current === undefined) return undefined
      const revision = current.loadRevision
      return { kind: 'renderer', revision, reload: rendererReload,
        failed: () => { actions.rendererFailed(tab.id, revision) },
        loaded: (version) => { actions.rendered(tab.id, revision, version) } }
    }
    if (mode === 'bytes-complete') {
      return current?.complete === undefined ? undefined : {
        kind: 'bytes', data: current.complete.data,
      }
    }
    if (current === undefined || loaded.length === 0) return undefined
    return { kind: 'text', pages: loaded, text: loaded.filter(page => page.lines > 0).map(page => page.text).join('\n'), eof: current.eof }
  }, [mode, loaded, current?.complete, current?.eof, current?.loadRevision, rendererReload, actions, tab.id])

  // A known binary suffix with no matching renderer never reads: no plain-text
  // fallback, no viewer control, only the path, the unsupported line, and the
  // contributions that hand the file to the Host.
  if (selected === undefined && unviewable) {
    const { name: unsupportedName } = pathPartsOf(displayPath)
    return (
      <div className={css.preview} data-textpreview-state="unsupported" data-textpreview-url={tab.contentId}>
        <div className={css.header}>
          <PathLabel path={displayPath} className={css.path} data-textpreview-path />
          {fileOwner !== undefined && renderSlot('sidebar.right.tab.document.actions', fileOwner)}
        </div>
        <div className={css.body} data-textpreview-body>
          <div className={css.empty} data-textpreview-unsupported>
            <FileTypeIcon kind={classifyFileType(unsupportedName)} size={36} className={css.emptyIcon} />
            <p className={css.emptyLine}>{t('unsupportedFile')}</p>
            {fileOwner !== undefined && renderSlot('sidebar.right.tab.document.unpreviewable', fileOwner)}
          </div>
        </div>
      </div>
    )
  }
  if (state === undefined || selected === undefined) {
    return (
      <div className={css.status} data-textpreview-state="loading">
        {meta.status === 'none'
          ? <p className={css.statusLine}>{t('resourceUnavailable')}</p>
          : <LoadingIndicator label={t('loading')} />}
      </div>
    )
  }
  const next = loadedThrough + 1
  const { name } = pathPartsOf(displayPath)
  const loadNext = (): void => {
    if (inEditor || !canRead || current?.loading || current?.eof) return
    loadPage(tab.id, file, next, signal, meta.value?.version)
  }
  // A secondary press over selected text offers Copy (the platform menu is
  // suppressed) and "add to conversation". Only the paginated text renderers
  // take part; a binary or renderer-owned body keeps its default, and the
  // editor's own menu handles its interior.
  const onBodyContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (inEditor || mode !== 'text-pages') return
    const selection = readPreviewSelection(event.currentTarget)
    if (selection === null) return
    event.preventDefault()
    setSelectionMenu({ point: { x: event.clientX, y: event.clientY }, selection })
  }
  const closeSelectionMenu = (): void => { setSelectionMenu(null) }
  const selectionItems: readonly MenuItem[] = [
    { id: 'copy', label: t('menu.copy') },
    { id: 'add-selection', label: t('menu.addSelection'), disabled: addToConversation === undefined },
  ]
  const selectSelectionItem = (open: PreviewSelection, id: string): void => {
    setSelectionMenu(null)
    if (id === 'copy') {
      void writeClipboard(open.text)
      return
    }
    /* v8 ignore next -- the add row is disabled when no verb is supplied, so this guard is belt-and-braces. */
    if (addToConversation === undefined) return
    // The selection may end at the last loaded line of a still-loading file;
    // the note tells the model the snippet is a prefix, never a silent splice.
    const snippet = buildSelectionSnippet(
      { path: displayPath, selection: open, incomplete: isSelectionAtLoadedEnd(open, current, loadedThrough) },
      { truncated: t('snippet.truncated'), incomplete: t('snippet.incomplete') },
    )
    // A refusal (the composer is locked or gone) lands nothing; say so rather
    // than closing the menu on a silent no-op.
    if (addToConversation({ kind: 'fragment', text: snippet.text }) !== 'inserted') {
      setAddFailure(seq => seq + 1)
    }
  }
  // The editor's own bars outrank the metadata ones: a conflict asks the reader
  // which side wins before anything reloads or writes again.
  const editNotice = inEditor && editState !== undefined
    && (editState.conflict || editState.gone || editState.failure !== undefined)
  const editStatus = !inEditor || editState === undefined || editState.blocked !== undefined
    ? undefined
    : editState.saving ? 'saving'
      : editState.failure !== undefined && !editState.conflict && !editState.gone ? 'failed'
        : editState.text === editState.savedText ? 'saved' : undefined
  return (
    <div className={css.preview} data-textpreview-state="text" data-textpreview-url={tab.contentId} data-document-preview={selected.id}>
      {inEditor && editState !== undefined && editState.conflict && (
        <p className={css.changed} data-textpreview-edit-conflict>
          <span>{t('edit.conflict')}</span>
          <button
            type="button"
            className={css.action}
            data-textpreview-edit-load-disk
            onClick={() => { reloadEdit(tab.id, meta.value?.version) }}
          >
            {t('edit.loadDisk')}
          </button>
          <button
            type="button"
            className={css.action}
            data-textpreview-edit-overwrite
            onClick={() => { overwriteEdit(tab.id) }}
          >
            {t('edit.overwrite')}
          </button>
        </p>
      )}
      {inEditor && editState !== undefined && !editState.conflict && editState.gone && (
        <p className={css.changed} data-textpreview-edit-gone>
          <span>{t('edit.gone')}</span>
        </p>
      )}
      {inEditor && editState !== undefined && !editState.conflict && !editState.gone && editState.failure !== undefined && (
        <p className={css.changed} data-textpreview-edit-failed={editState.failure.code}>
          <span>{failureLine(t, editState.failure)}</span>
          <button
            type="button"
            className={css.action}
            data-textpreview-edit-retry
            onClick={() => { retryEdit(tab.id) }}
          >
            {t('retry')}
          </button>
        </p>
      )}
      {!editNotice && (meta.failure !== undefined && hasContent
        ? (
          // The file's metadata failed — gone, or its workspace unknown — which
          // outranks a pending change; the pages already read stay under it.
          // With nothing read the body's own failure already says it, so the
          // bar would only repeat the same line.
          <p className={css.changed} data-textpreview-meta-failed={meta.failure.code}>
            <span>{failureLine(t, meta.failure)}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        )
        : changed && (
          <p className={css.changed} data-textpreview-changed>
            <span>{t('changed')}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        ))}
      <div className={css.header}>
        <PathLabel path={displayPath} className={css.path} data-textpreview-path />
        {editStatus !== undefined && (
          <span className={css.editStatus} data-textpreview-edit-status={editStatus}>
            {t(editStatus === 'saving' ? 'edit.saving' : editStatus === 'saved' ? 'edit.saved' : 'edit.failed')}
          </span>
        )}
        {readonlyReason !== undefined && (
          <span className={css.editReason} data-textpreview-readonly={readonlyReason}>
            {readonlyReason === 'outside' ? t('edit.readonly.outside')
              : readonlyReason === 'too-large' ? t('edit.readonly.tooLarge', { limit: humanBytes(EDIT_MAX_BYTES) })
                : readonlyReason === 'not-text' ? t('edit.readonly.notText')
                  : t('edit.readonly.bom')}
          </span>
        )}
        {candidates.length > 1
          && (
            <Menu
              open={menuOpen}
              anchor={(
                <button type="button" className={clsx(css.tool, css.viewerTool)} aria-label={t('openWith')} title={selected.title()} data-document-viewer-menu onClick={() => { setMenuOpen(value => !value) }}>
                  {selected.title()}
                </button>
              )}
              items={candidates.map(candidate => ({ id: candidate.id, label: candidate.title() }))}
              selectedId={selected.id}
              // The viewer menu is the entry to and the exit from editing:
              // whatever the debounce still holds is saved before the body
              // changes what it shows.
              onSelect={(id) => { saveNow(tab.id); actions.selected(tab.id, id); setMenuOpen(false) }}
              onClose={() => { setMenuOpen(false) }}
              align="end"
              portal
              dense
            />
          )}
        {selected.wrap === true && (
          // The tooltip names the action while the stable aria name and
          // `aria-pressed` expose the control and its current state.
          <Tooltip label={t(state.wrap ? 'wrap.disable' : 'wrap.enable')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.tool}
              aria-pressed={state.wrap}
              aria-label={t('wrap.aria')}
              data-textpreview-tool="wrap"
              onClick={() => { actions.toggledWrap(tab.id) }}
            >
              {state.wrap ? <IconNowrapFillRegular /> : <IconWrapFillRegular />}
            </button>
          </Tooltip>
        )}
        {content !== undefined && renderSlot('sidebar.right.tab.document.action', { content }, { entryKey: selected.id, hookContext: useTabInfo })}
        <span hidden>
          <Tooltip label={t(state.autoRefresh ? 'autoRefresh.disable' : 'autoRefresh.enable')} side="bottom" delayMs={500}>
            <button type="button" className={css.tool} aria-label={t('autoRefresh')}
              aria-pressed={state.autoRefresh} data-textpreview-tool="auto-refresh"
              onClick={() => { actions.toggledAutoRefresh(tab.id) }}>
              {state.autoRefresh ? <IconPauseOutlineRegular /> : <IconPlayOutlineRegular />}
            </button>
          </Tooltip>
        </span>
        {/* Preview and file-tree refresh controls own different reload lifecycles and locale namespaces. */}
        {/* jscpd:ignore-start */}
        <Tooltip label={t('reload')} shortcutKeys={tab.refreshShortcut?.keys} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('reload')}
            data-textpreview-tool="reload"
            aria-keyshortcuts={tab.refreshShortcut?.aria}
            onClick={reload}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
        {/* jscpd:ignore-end */}
        {fileOwner !== undefined && renderSlot('sidebar.right.tab.document.actions', fileOwner)}
      </div>
      <div
        ref={bindBody}
        className={clsx(css.body, state.wrap && css.wrap)}
        data-textpreview-body
        data-textpreview-wrap={state.wrap ? '' : undefined}
        onContextMenu={onBodyContextMenu}
        onScrollCapture={(event) => {
          const body = scrollportRef.current
          /* v8 ignore next -- callback refs bind the scrollport during commit, before user input. */
          if (body === null) return
          if (event.target !== body) return
          actions.scrolled(tab.id, body.scrollTop)
          if (mode === 'text-pages' && current?.failure === undefined && body.clientHeight > 0
            && body.scrollTop + body.clientHeight >= body.scrollHeight - 1) loadNext()
        }}
      >
        {inEditor && edit === undefined && (
          <LoadingIndicator label={t('loading')} />
        )}
        {inEditor && edit !== undefined && (
          <EditBody
            text={edit.text}
            wrap={state.wrap}
            scrollTop={state.scrollTop}
            absolutePath={displayPath}
            labels={{
              copy: t('menu.copy'), cut: t('menu.cut'), addSelection: t('menu.addSelection'),
              addFailed: t('menu.addFailed'), truncated: t('snippet.truncated'), incomplete: t('snippet.incomplete'),
            }}
            addToConversation={addToConversation}
            onDraft={(text) => { editChanged(tab.id, text) }}
            onComposing={(active) => { editComposing(tab.id, active) }}
            onSave={() => { saveNow(tab.id) }}
            onScrolled={(scrollTop) => { actions.scrolled(tab.id, scrollTop) }}
          />
        )}
        {!inEditor && mode !== 'renderer' && !hasContent && current?.failure === undefined && (
          <LoadingIndicator label={t('loading')} />
        )}
        {!inEditor && content !== undefined && renderSlot('sidebar.right.tab.document', {
          resourceAddress: tab.contentId, content, wrap: state.wrap, scrollportRef: bindScrollport,
          addResource: add, setResources: set,
        }, {
          entryKey: selected.id, hookContext: useTabInfo,
          fallback: <p className={css.statusLine}>{t('rendererUnavailable', { name: selected.title() })}</p>,
        })}
        {!inEditor && current?.failure !== undefined && (hasContent
          ? (
            <p className={css.statusLine} data-textpreview-failed={current.failure.code}>
              <span>{failureLine(t, current.failure)}</span>
              <button
                type="button"
                className={css.action}
                data-textpreview-retry
                onClick={loadNext}
              >
                {t('retry')}
              </button>
            </p>
          )
          : (
            // With no content, the failure names its recourse: retry the
            // selected renderer's read when a second read may resolve it, hand
            // a file this preview cannot render to the unpreviewable
            // contributions, and offer nothing for a path with nothing to show.
            // Metadata observation remains owned by the resource provider.
            <div className={css.empty} data-textpreview-failed={current.failure.code}>
              <FileTypeIcon kind={classifyFileType(name)} size={36} className={css.emptyIcon} />
              <p className={css.emptyLine}>{failureLine(t, current.failure)}</p>
              {emptyFailureRecourse(current.failure) === 'open' && fileOwner !== undefined
                && renderSlot('sidebar.right.tab.document.unpreviewable', fileOwner)}
              {emptyFailureRecourse(current.failure) === 'retry' && (
                <button
                  type="button"
                  className={css.retry}
                  data-textpreview-retry
                  onClick={reload}
                >
                  <IconRefreshOutlineRegular size={14} />
                  {t('retry')}
                </button>
              )}
            </div>
          ))}
        {!inEditor && mode === 'text-pages' && current !== undefined && loaded.length > 0 && !current.eof && current.failure === undefined && (
          <button
            type="button"
            className={css.more}
            disabled={current.loading}
            data-textpreview-more
            onClick={loadNext}
          >
            {current.loading ? <LoadingIndicator inline label={t('loading')} /> : t('loadMore')}
          </button>
        )}
      </div>
      {selectionMenu !== null && (
        <ContextMenu
          point={selectionMenu.point}
          items={selectionItems}
          onSelect={(id) => { selectSelectionItem(selectionMenu.selection, id) }}
          onClose={closeSelectionMenu}
        />
      )}
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
