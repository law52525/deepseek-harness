/** Resolve the required policy service from the same deployment as updater publication. */
import { resolveDesktopAutoUpdateEnvironment } from './desktop-auto-update-environment.mjs'

/** Official policy request path when `DSH_DESKTOP_MANDATORY_UPDATE_PATH` is unset. */
export const DEFAULT_MANDATORY_UPDATE_PATH = '/api/v0/check_client_update'

function origin(value, name) {
  let url
  try { url = new URL(value) } catch { throw new Error(`desktop package: ${name} requires an HTTPS origin`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`desktop package: ${name} requires an HTTPS origin without credentials, path, query, or fragment`)
  }
  return url.origin
}

/**
 * Resolve the policy request pathname. Unset keeps the official `/api/v0/check_client_update`.
 * @param {NodeJS.ProcessEnv} environment File-owned release settings.
 * @returns {string} Absolute pathname with no query or fragment.
 */
export function resolveDesktopMandatoryUpdatePath(environment) {
  const raw = environment.DSH_DESKTOP_MANDATORY_UPDATE_PATH
  const value = raw === undefined || raw.trim() === '' ? DEFAULT_MANDATORY_UPDATE_PATH : raw.trim()
  if (!value.startsWith('/') || value.includes('?') || value.includes('#') || value.includes('//')) {
    throw new Error('desktop package: DSH_DESKTOP_MANDATORY_UPDATE_PATH must be an absolute pathname without query or fragment')
  }
  return value
}

/**
 * Resolve mandatory policy metadata before preparing artifacts or accessing signing hardware.
 * Unset `DSH_DESKTOP_MANDATORY_UPDATE_TEST_AUTH` keeps official `feishu-test` on the test channel.
 * @param {NodeJS.ProcessEnv} environment File-owned release settings; the unselected origin is not required.
 * @returns {{ origin: string, allowedPageOrigins: string[], authentication: 'anonymous' | 'feishu-test', path: string, [key: string]: unknown }} Selected policy.
 */
export function resolveDesktopPolicyEnvironment(environment) {
  const deployment = resolveDesktopAutoUpdateEnvironment(environment)
  const name = deployment === 'test' ? 'DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN' : 'DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN'
  const selected = origin(environment[name], name)
  let settings = {}
  if (environment.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG !== undefined) {
    try { settings = JSON.parse(environment.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG) }
    catch { throw new Error('desktop package: DSH_DESKTOP_MANDATORY_UPDATE_CONFIG must be valid JSON') }
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)
    || 'origin' in settings || 'authentication' in settings || 'path' in settings) {
    throw new Error('desktop package: policy options must be an object without origin, authentication, or path; use the deployment origin settings')
  }
  const pages = settings.allowedPageOrigins ?? [selected]
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('desktop package: allowedPageOrigins must be a nonempty array')
  const testAuthRaw = environment.DSH_DESKTOP_MANDATORY_UPDATE_TEST_AUTH?.trim()
  if (testAuthRaw !== undefined && testAuthRaw !== '' && testAuthRaw !== 'anonymous' && testAuthRaw !== 'feishu-test') {
    throw new Error('desktop package: DSH_DESKTOP_MANDATORY_UPDATE_TEST_AUTH must be anonymous or feishu-test')
  }
  const authentication = deployment === 'test'
    ? (testAuthRaw === 'anonymous' ? 'anonymous' : 'feishu-test')
    : 'anonymous'
  const authOrigins = settings.allowedAuthOrigins
  if (authentication === 'feishu-test' && (!Array.isArray(authOrigins) || authOrigins.length === 0)) {
    throw new Error('desktop package: test policy requires nonempty allowedAuthOrigins')
  }
  if (authentication === 'anonymous' && authOrigins !== undefined) {
    throw new Error(deployment === 'production'
      ? 'desktop package: production policy must not configure allowedAuthOrigins'
      : 'desktop package: anonymous policy must not configure allowedAuthOrigins')
  }
  return { ...settings, origin: selected,
    allowedPageOrigins: pages.map(value => origin(value, 'allowedPageOrigins')),
    ...(authentication === 'feishu-test' ? { allowedAuthOrigins: authOrigins.map(value => origin(value, 'allowedAuthOrigins')) } : {}),
    authentication,
    path: resolveDesktopMandatoryUpdatePath(environment) }
}
