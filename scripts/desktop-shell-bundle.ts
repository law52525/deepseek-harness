/**
 * Packaged Electron main/preload must be self-contained: electron-builder
 * `files` omit `node_modules`, so a leftover package import crashes at launch.
 */

const FROM_IMPORT = /\bfrom\s+["']([^"']+)["']/g
const SIDE_EFFECT_IMPORT = /\bimport\s+["']([^"']+)["']/g

/**
 * Package specifiers that would need `node_modules` next to the asar bundle.
 * `electron` and `node:` stay external; relative imports are local.
 * @param source - `lib/main.js` or `lib/preload.js` text.
 * @returns leftover specifiers, sorted.
 */
export function leftoverPackageImports(source: string): string[] {
  const found = new Set<string>()
  for (const pattern of [FROM_IMPORT, SIDE_EFFECT_IMPORT]) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      if (specifier === 'electron' || specifier.startsWith('node:') || specifier.startsWith('.')) {
        continue
      }
      found.add(specifier)
    }
  }
  return [...found].sort()
}

/**
 * Fail when a packaged shell file still imports a package that is not bundled.
 * @param source - bundled file text.
 * @param label - path used in the error.
 */
export function assertDesktopShellBundleSelfContained(source: string, label: string): void {
  const leftover = leftoverPackageImports(source)
  if (leftover.length === 0) return
  throw new Error(
    `${label}: packaged Electron shell must not import ${leftover.join(', ')} `
    + '(electron-builder files omit node_modules; add the package to apps/desktop tsdown alwaysBundle).',
  )
}
