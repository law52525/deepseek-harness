/**
 * The paged read this type performs, bound to the Client Remote.
 *
 * Content is the consumer's business: the `file` resource carries metadata only,
 * and the text arrives here one page of lines at a time. The endpoint takes a
 * session and a workspace path while a tab carries a `dsh-resource://file/`
 * session address, so this module also owns that translation.
 */
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileBytes, WorkspaceFileRange, WorkspaceFileStat, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The slice of the Client Remote this package calls. */
export interface WorkspaceFilesReadRemote {
  readonly workspaceFiles: {
    /**
     * Read one page of lines.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param range - 1-based start line; the Host's page cap applies when `limit` is absent.
     * @param signal - cancels the call.
     * @returns the page, or the failure the Host declares.
     */
    read(
      sessionId: SessionId,
      path: string,
      range: WorkspaceFileRange,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileText>>
  }
}

/**
 * The read one page performs, injected so the face stays host-free.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different files in different sessions. A
 * Remote call does not reject: the result carries the failure.
 */
export type ReadWorkspaceFilePage = (
  sessionId: SessionId,
  path: string,
  offset: number,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileText>>

/** The file one tab reads: the session the read runs under and the path handed to the Host. */
export interface SessionFile {
  /** The Session whose workspace resolves relative paths. */
  readonly sessionId: SessionId
  /** The path the Host receives, absolute or relative to the addressed Session's workspace. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * A `session` address names its own session and a relative or absolute path, so
 * a tab addressed into another session reads from that session. An `absolute`
 * address carries no session and cannot be read here. The registry routes only
 * session-scoped `file` addresses to this type, so an address `parseFileAddress`
 * rejects or that carries no session is a programming error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @returns the session and the path to hand the endpoint.
 */
export function hostFileOf(address: string): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`ui-sidebar-documentpreview: not a session file address "${address}"`)
  // The address is a string boundary: its id segment is the Session id it names.
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}

/**
 * The failure a rejected Remote call amounts to. Only assembly faults reject
 * (the carrier folds its own failures into the result), and a caller that
 * cannot await one must still record a settled failure rather than a request
 * that never answers.
 * @param error - the rejection value.
 * @returns the failure to record.
 */
export function carrierFailure(error: unknown): RemoteFailure {
  return Object.assign(
    new Error(error instanceof Error ? error.message : String(error), { cause: error }),
    { name: 'RemoteError', isDSHRemoteError: true as const, code: 'gateway/internal' as const, details: {} },
  )
}

/**
 * Bind the paged read to one Remote face. The page length is the Host's
 * configured cap, so no `limit` travels.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the read the face performs.
 */
export function createReadPage(remote: WorkspaceFilesReadRemote): ReadWorkspaceFilePage {
  return (sessionId, path, offset, signal) => remote.workspaceFiles.read(sessionId, path, { offset }, signal)
}

/** Document bytes borrowed read-only by renderers; copy before transferring to a Worker. */
export type DocumentFileBytes = WorkspaceFileBytes<Uint8Array<ArrayBuffer>>

/**
 * Read a complete file through the Host endpoint.
 * @param file - Session and path decoded from the tab address.
 * @param signal - owning tab lifetime.
 * @returns complete native bytes, including declared failures.
 */
export type ReadDocumentBytes = (file: SessionFile, signal: AbortSignal) => Promise<RemoteResult<DocumentFileBytes>>

/** The slice of the Client Remote the editor calls, beside the paged read. */
export interface WorkspaceFilesEditRemote {
  readonly workspaceFiles: {
    /**
     * Replace one file's complete text under a version guard.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param content - the complete replacement text.
     * @param expectedVersion - the version the caller read the text at; a moved disk refuses instead of writing.
     * @param signal - cancels the call.
     * @returns the file's identity and freshness after the write, or the failure the Host declares.
     */
    writeText(
      sessionId: SessionId,
      path: string,
      content: string,
      expectedVersion: string,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileStat>>
    /**
     * Observe one file's identity and freshness without reading it.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param signal - cancels the call.
     * @returns the stat, or the failure the Host declares.
     */
    stat(
      sessionId: SessionId,
      path: string,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileStat>>
  }
}

/** The version-guarded write one editor save performs. */
export type WriteWorkspaceFileText = (
  file: SessionFile,
  content: string,
  expectedVersion: string,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileStat>>

/** The fresh stat the overwrite path performs before writing. */
export type StatWorkspaceFile = (file: SessionFile, signal: AbortSignal) => Promise<RemoteResult<WorkspaceFileStat>>

/**
 * Bind the version-guarded write to one Remote face.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the write the editor performs.
 */
export function createWriteText(remote: WorkspaceFilesEditRemote): WriteWorkspaceFileText {
  return (file, content, expectedVersion, signal) =>
    remote.workspaceFiles.writeText(file.sessionId, file.path, content, expectedVersion, signal)
}

/**
 * Bind the fresh stat to one Remote face.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the stat the overwrite path performs.
 */
export function createStatFile(remote: WorkspaceFilesEditRemote): StatWorkspaceFile {
  return (file, signal) => remote.workspaceFiles.stat(file.sessionId, file.path, signal)
}
