/**
 * Turn a Host Session-export control reply into a `dsh:` protocol Response.
 * GET bodies live in a Host-written temp file so JSON RPC never carries ZIP bytes.
 */

import { readFile, unlink } from 'node:fs/promises'
import { basename, resolve as resolvePath, sep } from 'node:path'
import { tmpdir } from 'node:os'

/** Status, download headers, and optional Host-written ZIP path from the child. */
export interface SessionExportControlResult {
  readonly status: number
  readonly headers: Record<string, string>
  readonly bodyPath?: string
}

/**
 * Read the Host-written ZIP (if any) and delete it after the Response is built.
 * @param result - control reply from the Host child.
 * @returns a protocol Response with the Host status and download headers.
 */
export async function responseFromSessionExport(
  result: SessionExportControlResult,
): Promise<Response> {
  if (result.bodyPath === undefined) {
    return new Response(null, { status: result.status, headers: result.headers })
  }
  const bodyPath = assertTempExportPath(result.bodyPath)
  try {
    const body = await readFile(bodyPath)
    return new Response(body, { status: result.status, headers: result.headers })
  } finally {
    try {
      await unlink(bodyPath)
    } catch {
      // The child already handed this temp file to main; a missing path here
      // is a late unlink or a crash between write and read.
    }
  }
}

/**
 * Reject a body path that is not a Host-written export temp file.
 * @param bodyPath - path from the control reply.
 * @returns the resolved path inside `os.tmpdir()`.
 */
export function assertTempExportPath(bodyPath: string): string {
  const resolved = resolvePath(bodyPath)
  const root = `${resolvePath(tmpdir())}${sep}`
  if (!resolved.startsWith(root) || !basename(resolved).startsWith('dsh-session-export-')) {
    throw new Error('desktop: session export path is outside the temp directory')
  }
  return resolved
}
