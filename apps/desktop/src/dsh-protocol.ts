/**
 * Map a privileged `dsh://app/…` request onto a frontend dist file, or recognize
 * the Host Session-export path that must not be treated as a dist file.
 */

import { posix, resolve as resolvePath, sep } from 'node:path'
import type { DesktopSessionExportMethod } from '@deepseek-ai/dsh-desktop-app/ipc-protocol'

/** Query the `dsh:` Session-export handler forwards to the Host child. */
export interface DesktopSessionExportQuery {
  readonly method: DesktopSessionExportMethod
  readonly sessionId: string
  readonly includeDescendants: boolean
}

/**
 * Resolve one custom-protocol URL to a dist file, rejecting path escape.
 * @param requestUrl - `dsh://app/…` URL.
 * @param distRoot - absolute frontend dist directory.
 * @returns the absolute file path, or undefined when the URL is outside dist.
 */
export function fileFromDshUrl(requestUrl: string, distRoot: string): string | undefined {
  const url = parseDshAppUrl(requestUrl)
  if (url === undefined) return undefined
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  const relative = posix.normalize(pathname.replace(/^\/+/, ''))
  if (relative === '' || relative === '.' || relative.startsWith('..')) return undefined
  const resolved = resolvePath(distRoot, relative.split('/').join(sep))
  const root = distRoot.endsWith(sep) ? distRoot : `${distRoot}${sep}`
  if (resolved !== distRoot && !resolved.startsWith(root)) return undefined
  return resolved
}

/**
 * Whether a `dsh:` URL is the Host Session-export path (any method).
 * @param requestUrl - renderer request URL.
 * @returns true for `dsh://app/api/session.export`.
 */
export function isDesktopSessionExportPath(requestUrl: string): boolean {
  const url = parseDshAppUrl(requestUrl)
  return url !== undefined && url.pathname === '/api/session.export'
}

/**
 * Parse GET/HEAD Session-export query from a `dsh://app/api/session.export` URL.
 * @param requestUrl - renderer request URL.
 * @param method - HTTP method from the protocol handler.
 * @returns the Host query, or undefined when the URL or method is not export.
 */
export function sessionExportFromDshUrl(
  requestUrl: string,
  method: string,
): DesktopSessionExportQuery | undefined {
  if (method !== 'GET' && method !== 'HEAD') return undefined
  const url = parseDshAppUrl(requestUrl)
  if (url === undefined || url.pathname !== '/api/session.export') return undefined
  return {
    method,
    sessionId: url.searchParams.get('sessionId') ?? '',
    includeDescendants: url.searchParams.get('includeDescendants') === 'true',
  }
}

function parseDshAppUrl(requestUrl: string): URL | undefined {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return undefined
  }
  return url.protocol === 'dsh:' && url.hostname === 'app' ? url : undefined
}
