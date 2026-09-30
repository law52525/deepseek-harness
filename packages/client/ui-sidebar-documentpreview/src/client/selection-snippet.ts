/**
 * Reading one preview text selection and turning it into a quote-ready snippet.
 *
 * Two responsibilities, both renderer-agnostic:
 *
 * - {@link readPreviewSelection} reads the live DOM selection only when it lies
 *   inside a preview body and is non-empty, and best-effort maps its endpoints
 *   to source line numbers through the renderers' own line markers (the plain
 *   renderer's `data-textpreview-line` rows, the code renderer's `span.line`
 *   rows). Markdown has no source-line markers, so its selections carry no
 *   lines and the snippet header falls back to the path alone.
 * - {@link buildSelectionSnippet} renders the fenced body: a location header
 *   (`path:line[-line]`), the verbatim selection, and a truncation note when the
 *   selection was cut or the file's later pages were still unloaded.
 */
import { languageForPath } from '@deepseek-ai/dsh-client-ui-primitives'

/** Longest selection carried verbatim; the rest is dropped and noted. */
export const MAX_SNIPPET_LINES = 200

/** One live preview selection, in the terms a snippet needs. */
export interface PreviewSelection {
  /** Selected text, exactly as rendered. */
  readonly text: string
  /** First selected source line (1-based), or undefined when the renderer exposes no lines. */
  readonly startLine: number | undefined
  /** Last selected source line (1-based), or undefined when unknown. */
  readonly endLine: number | undefined
}

/** Localized annotations appended below a snippet. */
export interface SnippetAnnotations {
  /** Note for dropped lines; every `{count}` is replaced with the number dropped. */
  readonly truncated: string
  /** Note when the file had unloaded pages under the selection. */
  readonly incomplete: string
}

/** A rendered snippet and what was cut from it. */
export interface BuiltSnippet {
  /** The snippet text to insert (fenced block, plus any trailing note). */
  readonly text: string
  /** Whether selected lines were dropped. */
  readonly truncated: boolean
}

/**
 * Map one DOM node to the source line it sits on, when the renderer marks lines.
 * Exported for the renderer-agnostic unit tests (no caller outside this module).
 * @param node - a selection endpoint (text or element node).
 * @returns the 1-based source line, or undefined for a renderer without markers.
 */
export function lineNumberAt(node: Node): number | undefined {
  const element = node instanceof Element ? node : node.parentElement
  if (element === null) return undefined
  const plain = element.closest('[data-textpreview-line]')
  if (plain !== null) {
    const value = Number(plain.getAttribute('data-textpreview-line'))
    return Number.isFinite(value) ? value : undefined
  }
  const codeLine = element.closest('span.line')
  const pre = codeLine?.closest('pre') ?? null
  if (codeLine === null || pre === null) return undefined
  // `closest` resolved the line inside this very pre, so it is always listed; indexOf is never -1 here.
  return Array.from(pre.querySelectorAll('span.line')).indexOf(codeLine) + 1
}

/**
 * Read the current selection only when it is a non-empty range inside `body`.
 * @param body - the preview's scrollable body element.
 * @returns the selected text and its best-effort line endpoints, or null.
 */
export function readPreviewSelection(body: HTMLElement): PreviewSelection | null {
  const selection = body.ownerDocument.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null
  const text = selection.toString()
  if (text === '') return null
  return { text, startLine: lineNumberAt(range.startContainer), endLine: lineNumberAt(range.endContainer) }
}

/**
 * Render a preview selection as a fenced snippet: a `path:line[-line]` header
 * line, the selection, and a note when it was truncated or incomplete.
 * @param input.path - source path shown in the header (the Host-reported absolute path).
 * @param input.selection - the selected text and any known line endpoints.
 * @param input.incomplete - whether the file had unloaded pages under the selection.
 * @param input.annotations - localized notes.
 * @returns the snippet text and whether it was truncated.
 */
export function buildSelectionSnippet(
  input: { readonly path: string; readonly selection: PreviewSelection; readonly incomplete: boolean },
  annotations: SnippetAnnotations,
): BuiltSnippet {
  const normalized = input.selection.text.replace(/\n+$/u, '')
  const lines = normalized === '' ? [] : normalized.split('\n')
  const kept = lines.slice(0, MAX_SNIPPET_LINES)
  const dropped = lines.length - kept.length
  const truncated = dropped > 0
  const start = input.selection.startLine
  // A capped snippet ends where the kept lines do, even when the reader had
  // selected further; endLine is only trustworthy while nothing was dropped.
  const end = start === undefined
    ? undefined
    : truncated || input.selection.endLine === undefined
      ? start + Math.max(kept.length - 1, 0)
      : input.selection.endLine
  const location = start === undefined
    ? input.path
    : end !== undefined && end !== start
      ? `${input.path}:${start}-${end}`
      : `${input.path}:${start}`
  const language = languageForPath(input.path) ?? ''
  const body = `\`\`\`${language}\n${location}\n${kept.join('\n')}\n\`\`\``
  const note = truncated
    ? `\n\n${annotations.truncated.replaceAll('{count}', String(dropped))}`
    : input.incomplete
      ? `\n\n${annotations.incomplete}`
      : ''
  return { text: `${body}${note}`, truncated }
}

/**
 * Whether a selection ends at the last loaded line of a still-loading file, so
 * its snippet is a prefix rather than the whole file.
 * @param selection - the selected text and its best-effort line endpoints.
 * @param state - the tab's loaded page state, or undefined before it exists.
 * @param lastLoadedLine - the last source line loaded so far.
 * @returns whether the snippet must carry the incomplete note.
 */
export function isSelectionAtLoadedEnd(
  selection: PreviewSelection,
  state: { readonly eof: boolean } | undefined,
  lastLoadedLine: number,
): boolean {
  return state?.eof === false && selection.endLine !== undefined && selection.endLine >= lastLoadedLine
}
