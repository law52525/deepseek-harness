/**
 * The editable source body: one monospace textarea over the complete file text.
 *
 * The textarea is the whole editor — no highlighting, no line numbers, native
 * undo — and it is controlled: every input reaches its owner, which keeps the
 * draft and decides when it is saved. What the editor owns itself is the text
 * area's own behaviour the browser does not give: Tab inserts two spaces
 * without leaving the field, an active input method composition is announced so
 * saving waits for it, and the secondary-press menu reads the selection by
 * offsets, which is why line numbers here are exact rather than best-effort.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type {
  ChangeEvent, CompositionEvent as ReactCompositionEvent, KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent, ReactNode,
} from 'react'
import { ContextMenu, IconWarningOutlineRegular, Toast, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextMenuPoint, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationInsert, ConversationInsertOutcome } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { buildSelectionSnippet } from '../selection-snippet.ts'
import css from './EditBody.module.css'

/** What one Tab press inserts. */
const INDENT = '  '

/** Localized text the editor's own menu and snippet notes need. */
export interface EditBodyLabels {
  /** Copy the selection. */
  readonly copy: string
  /** Cut the selection. */
  readonly cut: string
  /** Add the selection to the conversation. */
  readonly addSelection: string
  /** The visible notice when adding a snippet was refused. */
  readonly addFailed: string
  /** The snippet note for dropped lines; `{count}` is replaced by the number dropped. */
  readonly truncated: string
  /** The snippet note for a selection made while the file was not complete. */
  readonly incomplete: string
}

/** Props of the editor body. */
export interface EditBodyProps {
  /** The draft the editor shows. */
  readonly text: string
  /** Whether long lines wrap; follows the toolbar's wrap control. */
  readonly wrap: boolean
  /** Scroll offset to restore on mount, from the tab's stored view state. */
  readonly scrollTop: number
  /** Absolute path shown in an added snippet's header. */
  readonly absolutePath: string
  /** Localized menu and note text. */
  readonly labels: EditBodyLabels
  /** Add-to-conversation verb; absent disables the menu entry. */
  readonly addToConversation?: ((insert: ConversationInsert) => ConversationInsertOutcome) | undefined
  /** The editor's new text. */
  readonly onDraft: (text: string) => void
  /** An input method composition started or ended. */
  readonly onComposing: (active: boolean) => void
  /** Save now without waiting for the debounce. */
  readonly onSave: () => void
  /** The editor scrolled to this offset. */
  readonly onScrolled: (scrollTop: number) => void
}

/**
 * The 1-based line the offset sits on.
 * @param text - the edited text.
 * @param offset - a UTF-16 offset into `text`.
 * @returns the line number the offset falls on.
 */
function lineAtOffset(text: string, offset: number): number {
  let line = 1
  const end = Math.min(offset, text.length)
  for (let index = 0; index < end; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/**
 * Reveal one source line, as far as a plain textarea allows: line offsets are
 * not measurable, so the scroll is proportional to the line's share of the text.
 * @param area - the editor's textarea.
 * @param line - 1-based source line to reveal.
 * @param text - the text the line numbers count through.
 */
export function scrollEditorToLine(area: HTMLTextAreaElement, line: number, text: string): void {
  const lastLine = lineAtOffset(text, text.length)
  const target = Math.min(Math.max(line, 1), lastLine)
  const share = lastLine <= 1 ? 0 : (target - 1) / (lastLine - 1)
  area.scrollTop = Math.max(0, share * area.scrollHeight)
}

/**
 * The editable body of a source viewer.
 * @param props - the draft, its view state, and the callbacks its owner supplies.
 * @returns the textarea with the editor's own menus.
 */
export function EditBody({
  text, wrap, scrollTop, absolutePath, labels, addToConversation,
  onDraft, onComposing, onSave, onScrolled,
}: EditBodyProps): ReactNode {
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const initialScrollTop = useRef(scrollTop)
  // A caret the component must restore after a programmatic text change; null
  // while the browser owns it, so typing never moves the caret.
  const caretRef = useRef<{ start: number; end: number } | null>(null)
  const [menu, setMenu] = useState<{ point: ContextMenuPoint; start: number; end: number } | null>(null)
  // Counts refused snippet adds so the same failure replays the banner (0 = none shown).
  const [addFailure, setAddFailure] = useState(0)

  useLayoutEffect(() => {
    const area = areaRef.current
    if (area !== null) area.scrollTop = initialScrollTop.current
  }, [])
  useLayoutEffect(() => {
    const area = areaRef.current
    const caret = caretRef.current
    if (area === null || caret === null) return
    caretRef.current = null
    area.setSelectionRange(caret.start, caret.end)
  })

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onDraft(event.currentTarget.value)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // An active composition owns Tab and Enter until it commits.
    if (event.nativeEvent.isComposing) return
    if (event.key !== 'Tab' || event.altKey || event.metaKey || event.ctrlKey) return
    event.preventDefault()
    const { selectionStart, selectionEnd } = event.currentTarget
    caretRef.current = { start: selectionStart + INDENT.length, end: selectionStart + INDENT.length }
    onDraft(`${text.slice(0, selectionStart)}${INDENT}${text.slice(selectionEnd)}`)
  }
  const onCompositionStart = (_event: ReactCompositionEvent<HTMLTextAreaElement>): void => {
    onComposing(true)
  }
  const onCompositionEnd = (_event: ReactCompositionEvent<HTMLTextAreaElement>): void => {
    onComposing(false)
  }
  // A secondary press over selected text offers the platform-independent menu;
  // without a selection the platform's own menu (paste, select all) stays.
  const onContextMenu = (event: ReactMouseEvent<HTMLTextAreaElement>): void => {
    const { selectionStart, selectionEnd } = event.currentTarget
    if (selectionStart === selectionEnd) return
    event.preventDefault()
    setMenu({ point: { x: event.clientX, y: event.clientY }, start: selectionStart, end: selectionEnd })
  }
  const items: readonly MenuItem[] = [
    { id: 'copy', label: labels.copy },
    { id: 'cut', label: labels.cut },
    { id: 'add-selection', label: labels.addSelection, disabled: addToConversation === undefined },
  ]
  const run = (id: string): void => {
    const open = menu
    setMenu(null)
    if (open === null) return
    const start = Math.min(Math.max(open.start, 0), text.length)
    const end = Math.min(Math.max(open.end, start), text.length)
    const selected = text.slice(start, end)
    if (id === 'copy') {
      void writeClipboard(selected)
      return
    }
    if (id === 'cut') {
      void writeClipboard(selected)
      caretRef.current = { start, end: start }
      onDraft(`${text.slice(0, start)}${text.slice(end)}`)
      return
    }
    /* v8 ignore next -- the add row is disabled when no verb is supplied, so this guard is belt-and-braces. */
    if (addToConversation === undefined) return
    // The snippet must describe the file, not the draft: save before quoting.
    onSave()
    // The snippet keeps the selection verbatim, so its end line is the line of
    // the last character the snippet will still carry.
    const kept = selected.replace(/\n+$/u, '')
    const snippet = buildSelectionSnippet(
      {
        path: absolutePath,
        selection: { text: selected, startLine: lineAtOffset(text, start), endLine: lineAtOffset(text, start + kept.length) },
        incomplete: false,
      },
      { truncated: labels.truncated, incomplete: labels.incomplete },
    )
    if (addToConversation({ kind: 'fragment', text: snippet.text }) !== 'inserted') {
      setAddFailure(seq => seq + 1)
    }
  }
  return (
    <>
      <textarea
        ref={areaRef}
        className={css.editor}
        data-textpreview-editor
        data-textpreview-wrap={wrap ? '' : undefined}
        value={text}
        wrap={wrap ? 'soft' : 'off'}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onBlur={onSave}
        onScroll={(event) => { onScrolled(event.currentTarget.scrollTop) }}
        onContextMenu={onContextMenu}
      />
      {menu !== null && (
        <ContextMenu
          point={menu.point}
          items={items}
          onSelect={run}
          onClose={() => { setMenu(null) }}
        />
      )}
      {addFailure > 0 && (
        <Toast
          key={addFailure}
          text={labels.addFailed}
          icon={<IconWarningOutlineRegular />}
          onDone={() => { setAddFailure(0) }}
        />
      )}
    </>
  )
}
