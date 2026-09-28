/** Build-time product identity read from the packaging environment or packaged manifest. */

/** Environment variable that names the Electron-managed profile directory. */
export const DESKTOP_PROFILE_NAME_ENV = 'DSH_DESKTOP_PROFILE_NAME'

/** Environment variable that lists extra product bundles, comma-separated. */
export const DESKTOP_EXTRA_BUNDLES_ENV = 'DSH_DESKTOP_EXTRA_BUNDLES'

/** Environment variable that publishes a product version distinct from the bundled dsh version. */
export const DESKTOP_PRODUCT_VERSION_ENV = 'DSH_DESKTOP_PRODUCT_VERSION'

/** Environment variable that overrides the packaged npm package name (userData). */
export const DESKTOP_PACKAGE_NAME_ENV = 'DSH_DESKTOP_PACKAGE_NAME'

/** Environment variable that lists extra package-set roots, comma-separated. */
export const DESKTOP_EXTRA_ROOT_PACKAGES_ENV = 'DSH_DESKTOP_EXTRA_ROOT_PACKAGES'

/** Environment variable that points at an extra directory of packed tarballs. */
export const DESKTOP_EXTRA_PACKED_DIR_ENV = 'DSH_DESKTOP_EXTRA_PACKED_DIR'

/** Environment variable that overrides the Electron productName / about-panel name. */
export const DESKTOP_PRODUCT_NAME_ENV = 'DSH_DESKTOP_PRODUCT_NAME'

/** Environment variable that overrides the custom URL scheme (official `dsh`). */
export const DESKTOP_PROTOCOL_SCHEME_ENV = 'DSH_DESKTOP_PROTOCOL_SCHEME'

/** Environment variable that prefixes electron-builder artifactName. */
export const DESKTOP_ARTIFACT_PREFIX_ENV = 'DSH_DESKTOP_ARTIFACT_PREFIX'

/** Environment variable that points at derived brand resources (icons, welcome SVG). */
export const DESKTOP_BRAND_RESOURCES_ENV = 'DSH_DESKTOP_BRAND_RESOURCES'

/** Profile directory name when no override is configured. */
export const DEFAULT_DESKTOP_PROFILE_NAME = 'desktop'

/**
 * Official productName when no brand override is configured.
 * Packaged branded builds replace `DSH_BUNDLE_PRODUCT_NAME` at bundle time so
 * the official fallback string is dropped from the asar.
 */
export const DEFAULT_DESKTOP_PRODUCT_NAME = process.env.DSH_BUNDLE_PRODUCT_NAME || 'DeepSeek Harness'

/** Official custom URL scheme when no brand override is configured. */
export const DEFAULT_DESKTOP_PROTOCOL_SCHEME = 'dsh'

/**
 * Official artifactName prefix when no brand override is configured.
 * Packaged branded builds replace `DSH_BUNDLE_ARTIFACT_PREFIX` at bundle time.
 */
export const DEFAULT_DESKTOP_ARTIFACT_PREFIX = process.env.DSH_BUNDLE_ARTIFACT_PREFIX || 'deepseek-harness'

const ARTIFACT_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PROTOCOL_SCHEME = /^[a-z][a-z0-9+.-]*$/

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
 * Resolve extra product bundles from the process environment.
 * Packaged Electron overwrites this env from extraMetadata before calling; unpackaged reads the live env.
 * @param env - Process environment.
 * @returns Extra bundle package names; empty when unset.
 */
export function resolveDesktopExtraBundles(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseCommaSeparatedNames(env[DESKTOP_EXTRA_BUNDLES_ENV])
}

function extraBundleNames(manifest: Readonly<Record<string, unknown>>): string[] {
  if (!Array.isArray(manifest.dshDesktopExtraBundles)) return []
  return manifest.dshDesktopExtraBundles.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  ).map(item => item.trim())
}

function trimmedEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim()
  return value === undefined || value === '' ? undefined : value
}

/**
 * Resolve the Electron productName used for the .app / .exe, menus, and about panel.
 * @param env - Process environment.
 * @returns Configured name, or the official product name when unset.
 */
export function resolveDesktopProductName(env: NodeJS.ProcessEnv = process.env): string {
  return trimmedEnv(env, DESKTOP_PRODUCT_NAME_ENV) ?? DEFAULT_DESKTOP_PRODUCT_NAME
}

/**
 * Resolve the custom URL scheme registered with the OS.
 * @param env - Process environment.
 * @returns Configured scheme, or `dsh` when unset.
 */
export function resolveDesktopProtocolScheme(env: NodeJS.ProcessEnv = process.env): string {
  const value = trimmedEnv(env, DESKTOP_PROTOCOL_SCHEME_ENV)
  if (value === undefined) return DEFAULT_DESKTOP_PROTOCOL_SCHEME
  if (!PROTOCOL_SCHEME.test(value)) {
    throw new Error(`${DESKTOP_PROTOCOL_SCHEME_ENV} must be a lowercase URI scheme; got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Resolve the electron-builder artifactName prefix. Must keep `${version}`, `${os}`, `${arch}`
 * in the assembled pattern; this value is only the leading token.
 * @param env - Process environment.
 * @returns Configured prefix, or `deepseek-harness` when unset.
 */
export function resolveDesktopArtifactPrefix(env: NodeJS.ProcessEnv = process.env): string {
  const value = trimmedEnv(env, DESKTOP_ARTIFACT_PREFIX_ENV)
  if (value === undefined) return DEFAULT_DESKTOP_ARTIFACT_PREFIX
  if (!ARTIFACT_PREFIX.test(value)) {
    throw new Error(`${DESKTOP_ARTIFACT_PREFIX_ENV} must be a file-name token; got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Resolve the derived brand-resource directory used by electron-builder icon / welcome mappings.
 * @param env - Process environment.
 * @returns Absolute or relative directory, or `undefined` when official resources apply.
 */
export function resolveDesktopBrandResources(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return trimmedEnv(env, DESKTOP_BRAND_RESOURCES_ENV)
}

/**
 * Whether `url` is this product's `open` deep link (`<scheme>://open` with optional trailing slash).
 * @param url - Incoming custom-protocol URL.
 * @param scheme - Registered scheme.
 */
export function isDesktopOpenUrl(url: string, scheme: string = resolveDesktopProtocolScheme()): boolean {
  const base = `${scheme}://open`
  return url === base || url === `${base}/`
}

/**
 * Replace process env with packaged extraMetadata. Packaged identity is immutable:
 * extra bundles, profile name, product version, product name, and protocol scheme
 * come only from the baked manifest. Unpackaged development never calls this, so
 * the live environment still applies.
 * @param manifest - Packaged application `package.json`.
 * @param env - Process environment to update.
 */
export function applyPackagedProductConfig(
  manifest: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env[DESKTOP_PROFILE_NAME_ENV] = typeof manifest.dshDesktopProfileName === 'string'
    ? manifest.dshDesktopProfileName.trim()
    : ''
  env[DESKTOP_EXTRA_BUNDLES_ENV] = extraBundleNames(manifest).join(',')
  env[DESKTOP_PRODUCT_VERSION_ENV] = typeof manifest.version === 'string' ? manifest.version.trim() : ''
  env[DESKTOP_PRODUCT_NAME_ENV] = typeof manifest.dshDesktopProductName === 'string'
    ? manifest.dshDesktopProductName.trim()
    : ''
  env[DESKTOP_PROTOCOL_SCHEME_ENV] = typeof manifest.dshDesktopProtocolScheme === 'string'
    ? manifest.dshDesktopProtocolScheme.trim()
    : ''
}
