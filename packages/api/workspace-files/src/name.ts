/**
 * The rule for a name `workspaceFiles.create` accepts: exactly one new path
 * segment under the chosen directory.
 */

/** The byte no path segment carries. */
const NUL = String.fromCharCode(0)

/**
 * Decide whether a name is one path segment that cannot address another directory.
 * @param name - the requested entry name, as received on the wire.
 * @param windowsPaths - whether the parent path is drive-rooted, where `:` selects a drive or an alternate data stream.
 * @returns false for an empty or whitespace-only name, `.`, `..`, and a name carrying `/`, `\`, or NUL;
 *   under `windowsPaths` also for a name carrying `:`.
 */
export function isEntryName(name: string, windowsPaths: boolean): boolean {
  if (name.trim().length === 0 || name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\') || name.includes(NUL)) return false
  return !(windowsPaths && name.includes(':'))
}
