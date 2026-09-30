// @vitest-environment jsdom
/** Preview selection reading and snippet rendering (path + line header, truncation). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SNIPPET_LINES, buildSelectionSnippet, isSelectionAtLoadedEnd, lineNumberAt, readPreviewSelection,
} from '../src/client/selection-snippet.ts'

const NOTES = { truncated: '(dropped {count})', incomplete: '(incomplete)' }

afterEach(() => { window.getSelection()?.removeAllRanges() })

describe('buildSelectionSnippet', () => {
  it('renders a fenced block with a path:line-line header and the verbatim selection', () => {
    const { text, truncated } = buildSelectionSnippet(
      { path: '/host/notes.md', selection: { text: 'line one\nline two\n', startLine: 3, endLine: 4 }, incomplete: false },
      NOTES,
    )
    expect(text).toBe('```markdown\n/host/notes.md:3-4\nline one\nline two\n```')
    expect(truncated).toBe(false)
  })

  it('collapses a one-line range to a single line number', () => {
    const { text } = buildSelectionSnippet(
      { path: '/host/a.ts', selection: { text: 'const x = 1', startLine: 5, endLine: 5 }, incomplete: false },
      NOTES,
    )
    expect(text).toBe('```typescript\n/host/a.ts:5\nconst x = 1\n```')
  })

  it('falls back to the path alone when the renderer exposes no lines', () => {
    const { text } = buildSelectionSnippet(
      { path: '/host/notes.md', selection: { text: 'quote', startLine: undefined, endLine: undefined }, incomplete: false },
      NOTES,
    )
    expect(text).toBe('```markdown\n/host/notes.md\nquote\n```')
  })

  it('uses an empty info string for an unknown extension', () => {
    const { text } = buildSelectionSnippet(
      { path: '/host/notes.unknown', selection: { text: 'x', startLine: undefined, endLine: undefined }, incomplete: false },
      NOTES,
    )
    expect(text.startsWith('```\n')).toBe(true)
  })

  it('cuts a long selection to the line cap and notes the dropped lines', () => {
    const lines = Array.from({ length: MAX_SNIPPET_LINES + 5 }, (_value, index) => `l${index}`)
    const { text, truncated } = buildSelectionSnippet(
      { path: '/host/big.txt', selection: { text: lines.join('\n'), startLine: 1, endLine: lines.length }, incomplete: false },
      NOTES,
    )
    expect(truncated).toBe(true)
    // The end line reflects the kept prefix, not the full selection.
    expect(text).toContain(`/host/big.txt:1-${MAX_SNIPPET_LINES}\n`)
    expect(text.endsWith('\n\n(dropped 5)')).toBe(true)
    expect(text.split('\n').filter(line => line.startsWith('l'))).toHaveLength(MAX_SNIPPET_LINES)
  })

  it('notes an incomplete file when nothing was truncated', () => {
    const { text, truncated } = buildSelectionSnippet(
      { path: '/host/notes.md', selection: { text: 'tail', startLine: 9, endLine: 9 }, incomplete: true },
      NOTES,
    )
    expect(truncated).toBe(false)
    expect(text.endsWith('\n\n(incomplete)')).toBe(true)
  })

  it('renders an empty selection with its known start line', () => {
    const { text } = buildSelectionSnippet(
      { path: '/host/x.md', selection: { text: '', startLine: 5, endLine: undefined }, incomplete: false },
      NOTES,
    )
    expect(text).toBe('```markdown\n/host/x.md:5\n\n```')
  })

  it('uses the start line as the end when only the start is known', () => {
    const { text } = buildSelectionSnippet(
      { path: '/host/x.md', selection: { text: 'x', startLine: 3, endLine: undefined }, incomplete: false },
      NOTES,
    )
    expect(text).toContain('/host/x.md:3\n')
  })
})

describe('isSelectionAtLoadedEnd', () => {
  const selection = { text: 'x', startLine: 1, endLine: 4 }

  it('is false before the tab state exists or once the file is complete', () => {
    expect(isSelectionAtLoadedEnd(selection, undefined, 4)).toBe(false)
    expect(isSelectionAtLoadedEnd(selection, { eof: true }, 4)).toBe(false)
  })

  it('is false when the selection has no known end line', () => {
    expect(isSelectionAtLoadedEnd({ text: 'x', startLine: undefined, endLine: undefined }, { eof: false }, 4)).toBe(false)
  })

  it('is true only when a still-loading selection reaches the last loaded line', () => {
    expect(isSelectionAtLoadedEnd(selection, { eof: false }, 4)).toBe(true)
    expect(isSelectionAtLoadedEnd(selection, { eof: false }, 9)).toBe(false)
  })
})

describe('lineNumberAt', () => {
  it('gives no line for a detached node', () => {
    expect(lineNumberAt(document.createTextNode('x'))).toBeUndefined()
  })

  it('gives no line for a non-numeric plain marker', () => {
    const div = document.createElement('div')
    div.setAttribute('data-textpreview-line', 'not-a-number')
    expect(lineNumberAt(div)).toBeUndefined()
  })

  it('maps an element endpoint through its marked ancestor', () => {
    const div = document.createElement('div')
    div.setAttribute('data-textpreview-line', '7')
    const child = document.createElement('span')
    div.appendChild(child)
    expect(lineNumberAt(child)).toBe(7)
  })

  it('gives no line for a line span outside a pre', () => {
    const span = document.createElement('span')
    span.className = 'line'
    expect(lineNumberAt(span)).toBeUndefined()
  })

  it('gives no line for a span that is not a code line', () => {
    expect(lineNumberAt(document.createElement('span'))).toBeUndefined()
  })
})

describe('readPreviewSelection', () => {
  /** Build a plain-renderer body with one marked line per string (each row ends in its own newline, as TextBody renders). */
  function plainBody(lines: readonly string[]): HTMLElement {
    const body = document.createElement('div')
    for (const [index, text] of lines.entries()) {
      const line = document.createElement('div')
      line.setAttribute('data-textpreview-line', String(index + 1))
      line.append(text, '\n')
      body.appendChild(line)
    }
    document.body.appendChild(body)
    return body
  }

  it('reads nothing without a selection', () => {
    const body = plainBody(['first', 'second'])
    window.getSelection()?.removeAllRanges()
    expect(readPreviewSelection(body)).toBeNull()
  })

  it('reads nothing when the selection lies outside the body', () => {
    const body = plainBody(['first'])
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    document.body.appendChild(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(readPreviewSelection(body)).toBeNull()
  })

  it('reads the text and mapped source lines of a plain selection', () => {
    const body = plainBody(['first', 'second', 'third'])
    const first = body.children[1]!.firstChild!
    const second = body.children[2]!.firstChild!
    const range = document.createRange()
    range.setStart(first, 0)
    // Stop at the end of the third row's own text node, before its trailing newline.
    range.setEnd(second, second.textContent!.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const read = readPreviewSelection(body)
    expect(read).toMatchObject({ text: 'second\nthird', startLine: 2, endLine: 3 })
  })

  it('maps a code-renderer selection to its 1-based line index', () => {
    const body = document.createElement('div')
    const pre = document.createElement('pre')
    for (const text of ['a', 'b', 'c']) {
      const span = document.createElement('span')
      span.className = 'line'
      span.textContent = text
      pre.appendChild(span)
    }
    body.appendChild(pre)
    document.body.appendChild(body)
    const range = document.createRange()
    range.setStart(pre.children[1]!.firstChild!, 0)
    range.setEnd(pre.children[2]!.firstChild!, 1)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(readPreviewSelection(body)).toMatchObject({ startLine: 2, endLine: 3 })
  })

  it('reads nothing for an empty non-collapsed range', () => {
    const body = document.createElement('div')
    const first = document.createElement('div')
    const second = document.createElement('div')
    body.append(first, second)
    document.body.appendChild(body)
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(second, 0)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(readPreviewSelection(body)).toBeNull()
  })

  it('reads nothing when the document exposes no selection', () => {
    const spy = vi.spyOn(document, 'getSelection').mockReturnValue(null)
    try {
      expect(readPreviewSelection(document.body)).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
