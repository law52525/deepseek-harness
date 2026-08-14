/**
 * Map a privileged `dsh://app/…` request onto a file inside the frontend dist.
 */

import { posix, resolve as resolvePath, sep } from 'node:path'

/**
 * Resolve one custom-protocol URL to a dist file, rejecting path escape.
 * @param requestUrl - `dsh://app/…` URL.
 * @param distRoot - absolute frontend dist directory.
 * @returns the absolute file path, or undefined when the URL is outside dist.
 */
export function fileFromDshUrl(requestUrl: string, distRoot: string): string | undefined {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== 'dsh:' || url.hostname !== 'app') return undefined
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  const relative = posix.normalize(pathname.replace(/^\/+/, ''))
  if (relative === '' || relative === '.' || relative.startsWith('..')) return undefined
  const resolved = resolvePath(distRoot, relative.split('/').join(sep))
  const root = distRoot.endsWith(sep) ? distRoot : `${distRoot}${sep}`
  if (resolved !== distRoot && !resolved.startsWith(root)) return undefined
  return resolved
}
