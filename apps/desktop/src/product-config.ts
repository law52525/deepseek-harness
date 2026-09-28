/** Build-time product identity read from the packaging environment or packaged manifest. */

/** Environment variable that names the Electron-managed profile directory. */
export const DESKTOP_PROFILE_NAME_ENV = 'DSH_DESKTOP_PROFILE_NAME'

/** Environment variable that lists extra product bundles, comma-separated. */
export const DESKTOP_EXTRA_BUNDLES_ENV = 'DSH_DESKTOP_EXTRA_BUNDLES'

/** Environment variable that overrides the packaged npm package name (userData). */
export const DESKTOP_PACKAGE_NAME_ENV = 'DSH_DESKTOP_PACKAGE_NAME'

/** Environment variable that lists extra package-set roots, comma-separated. */
export const DESKTOP_EXTRA_ROOT_PACKAGES_ENV = 'DSH_DESKTOP_EXTRA_ROOT_PACKAGES'

/** Environment variable that points at an extra directory of packed tarballs. */
export const DESKTOP_EXTRA_PACKED_DIR_ENV = 'DSH_DESKTOP_EXTRA_PACKED_DIR'

/** Profile directory name when no override is configured. */
export const DEFAULT_DESKTOP_PROFILE_NAME = 'desktop'

/**
 * Split a comma-separated env value into unique trimmed names.
 * @param value - Raw environment value.
 * @returns Names in first-seen order; empty when unset.
 */
export function parseCommaSeparatedNames(value: string | undefined): string[] {
  if (value === undefined) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (const part of value.split(',')) {
    const name = part.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/**
 * Resolve the Electron-managed profile directory name.
 * @param env - Process environment.
 * @returns Configured name, or `desktop` when unset.
 */
export function resolveDesktopProfileName(env: NodeJS.ProcessEnv = process.env): string {
  const value = env[DESKTOP_PROFILE_NAME_ENV]?.trim()
  return value === undefined || value === '' ? DEFAULT_DESKTOP_PROFILE_NAME : value
}

/**
 * Resolve extra product bundles baked in at packaging time.
 * @param env - Process environment.
 * @returns Extra bundle package names; empty when unset.
 */
export function resolveDesktopExtraBundles(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseCommaSeparatedNames(env[DESKTOP_EXTRA_BUNDLES_ENV])
}

/**
 * Copy packaged extraMetadata into the process environment when the caller has not set it.
 * Packaged identity is immutable; a live environment variable still wins so tests can override.
 * @param manifest - Packaged application `package.json`.
 * @param env - Process environment to update.
 */
export function applyPackagedProductConfig(
  manifest: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (typeof manifest.dshDesktopProfileName === 'string' && manifest.dshDesktopProfileName.trim() !== '') {
    env[DESKTOP_PROFILE_NAME_ENV] ??= manifest.dshDesktopProfileName.trim()
  }
  if (Array.isArray(manifest.dshDesktopExtraBundles)) {
    const names = manifest.dshDesktopExtraBundles.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    )
    if (names.length > 0) env[DESKTOP_EXTRA_BUNDLES_ENV] ??= names.join(',')
  }
}
