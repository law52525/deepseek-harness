/**
 * Which files the source viewers may edit, and why the others stay read-only.
 *
 * The rules are one place because two moments apply them: the body decides
 * before any read whether the viewers show an editor, and the editor re-checks
 * the bytes it actually read, because the file resource's metadata can be
 * absent or stale. A refusal keeps the viewer's existing read-only rendering
 * and, for a file that would otherwise be editable, names the reason.
 */
import type { EditBlockReason } from '../store.ts'
import { documentFileName, matchedSuffixLength } from '../document/suffix.ts'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

/** Longest complete file the editor reads and writes, in bytes. */
export const EDIT_MAX_BYTES = 1024 * 1024

/** How long an input rests before it is saved, in ms. */
export const EDIT_DEBOUNCE_MS = 800

/** The byte-order mark a file may not carry; edits would not preserve it. */
const BOM = [0xef, 0xbb, 0xbf] as const

/** Suffixes whose source text the code and plain viewers edit. */
export const EDITABLE_SUFFIXES: readonly string[] = ['md', 'markdown', 'yaml', 'yml']

/** Whether a path's suffix makes it an editable document at all. */
export function editableDocumentPath(path: string): boolean {
  return matchedSuffixLength(documentFileName(path), EDITABLE_SUFFIXES) > 0
}

/** Whether a path is absolute in either spelling the Host accepts. */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/u.test(value) || value.startsWith('\\\\')
}

/**
 * Collapse `.` and `..` segments into a rooted slash-separated path. A `..`
 * climbing above the root is dropped, so the result is the path the filesystem
 * would reach, whatever spelling arrived.
 */
function normalizeSegments(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return `/${parts.join('/')}`
}

/**
 * Whether an editable path sits inside the Session's workspace.
 *
 * The preview reads files outside the workspace and must not write them, so
 * this is the write's own containment check. It is not the Host's: the Host
 * still refuses an unwritable target on its side.
 * @param cwd - the Session's workspace root; absent means every path is outside.
 * @param path - the path the tab's address names, absolute or workspace-relative.
 * @returns `true` when the resolved path is the root itself or under it.
 */
export function withinWorkspacePath(cwd: string | undefined, path: string): boolean {
  if (cwd === undefined || cwd === '') return false
  const fold = (value: string): string => {
    const normalized = normalizeSegments(value.replaceAll('\\', '/'))
    const windows = isWindowsStylePath(cwd) || isWindowsStylePath(path)
    return windows ? normalized.toLowerCase() : normalized
  }
  const root = fold(cwd)
  const target = fold(resolveWorkspacePath(cwd, path))
  return target === root || target.startsWith(`${root}/`)
}

/**
 * Decode complete disk bytes as text an editor can write back verbatim, or name
 * the rule that refuses them.
 * @param bytes - the file's complete bytes.
 * @returns the decoded text, or the reason the file stays read-only.
 */
export function decodeEditBytes(
  bytes: Uint8Array<ArrayBuffer>,
): { readonly kind: 'ok'; readonly text: string } | { readonly kind: 'blocked'; readonly reason: EditBlockReason } {
  if (bytes.length > EDIT_MAX_BYTES) return { kind: 'blocked', reason: 'too-large' }
  // A decoded BOM survives as U+FEFF, which a rewrite would not put back; the
  // check is on the bytes, so it never mistakes that character for it.
  if (BOM.every((byte, index) => bytes[index] === byte)) return { kind: 'blocked', reason: 'bom' }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Fatal decoding is the UTF-8 validity test; a partial character is not text.
    return { kind: 'blocked', reason: 'not-text' }
  }
  if (text.includes('\u0000')) return { kind: 'blocked', reason: 'not-text' }
  return { kind: 'ok', text }
}

/** What the body shows for the selected viewer, and why when it cannot edit. */
export type EditAccess =
  | { readonly kind: 'open' }
  | { readonly kind: 'readonly'; readonly reason: 'outside' | 'too-large' | 'not-text' | 'bom' | undefined }

/** The inputs the editability decision reads. */
export interface EditAccessInput {
  /** The Session's workspace root; absent leaves every path outside it. */
  readonly cwd: string | undefined
  /** The path the tab's address names. */
  readonly path: string
  /** Whether the selected viewer renders editable source text. */
  readonly editableViewer: boolean
  /** Complete file size from the file's metadata, when the Host reported it. */
  readonly bytes: number | undefined
  /** The refusal an earlier read already found; it outranks the metadata. */
  readonly blocked: EditBlockReason | undefined
}

/**
 * Decide whether the selected viewer edits this file now.
 * @param input - workspace root, path, viewer capability, metadata size, and any read-time refusal.
 * @returns the decision; a reason is present only for a file the rules would otherwise allow.
 */
export function decideEditAccess(input: EditAccessInput): EditAccess {
  const accept = input.editableViewer && editableDocumentPath(input.path)
  if (!accept) return { kind: 'readonly', reason: undefined }
  // A read-time refusal is a fact about the bytes; 'unavailable' only means the
  // read failed, and the read-only rendering already carries that failure.
  if (input.blocked === 'too-large' || input.blocked === 'not-text' || input.blocked === 'bom') {
    return { kind: 'readonly', reason: input.blocked }
  }
  if (input.blocked === 'unavailable') return { kind: 'readonly', reason: undefined }
  // An absolute path outside the workspace is rejected here like a relative
  // one: the address's spelling never decides editability on its own.
  if (!withinWorkspacePath(input.cwd, input.path)) return { kind: 'readonly', reason: 'outside' }
  if (input.bytes !== undefined && input.bytes > EDIT_MAX_BYTES) return { kind: 'readonly', reason: 'too-large' }
  return { kind: 'open' }
}
