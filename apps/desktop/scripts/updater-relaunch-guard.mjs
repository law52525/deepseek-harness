/** Decide whether a packaged updater may call the system installer and relaunch. */

/** Opt-in flag. Any value other than `1` keeps installer relaunch skipped. */
export const DESKTOP_UPDATER_RELAUNCH_OK_ENV = 'DSH_DESKTOP_UPDATER_RELAUNCH_OK'

/** Comma-separated dedicated test accounts allowed to relaunch when the flag is set. */
export const DESKTOP_UPDATER_RELAUNCH_USERS_ENV = 'DSH_DESKTOP_UPDATER_RELAUNCH_USERS'

/** Optional comma-separated daily-login accounts that can never relaunch. */
export const DESKTOP_UPDATER_RELAUNCH_DENIED_USERS_ENV = 'DSH_DESKTOP_UPDATER_RELAUNCH_DENIED_USERS'

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseUserList(raw) {
  if (raw === undefined || raw.trim() === '') return []
  return [...new Set(raw.split(',').map((item) => item.trim()).filter((item) => item !== ''))]
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function readProcessUsername(env = process.env) {
  const override = env.DSH_DESKTOP_UPDATER_USERNAME?.trim()
  if (override) return override
  return (env.USER ?? env.USERNAME ?? env.LOGNAME ?? '').trim()
}

/**
 * Default path is check → download → checksum. Install-and-relaunch needs the
 * explicit flag and a username on the dedicated-account allowlist, and not on
 * the denied daily-login list. Packaged Squirrel/NSIS relaunch drops isolated
 * HOME / user-data-dir, so daily accounts must never take that step.
 *
 * @param {{ env?: NodeJS.ProcessEnv, username?: string }} [input]
 * @returns {{
 *   allowed: boolean,
 *   reason: string,
 *   username: string,
 *   flagSet: boolean,
 *   allowlisted: boolean,
 *   denied: boolean,
 *   allowlist: string[],
 *   denylist: string[],
 * }}
 */
export function decideDesktopUpdaterRelaunch(input = {}) {
  const env = input.env ?? process.env
  const username = (input.username ?? readProcessUsername(env)).trim()
  const flagSet = env[DESKTOP_UPDATER_RELAUNCH_OK_ENV] === '1'
  const allowlist = parseUserList(env[DESKTOP_UPDATER_RELAUNCH_USERS_ENV])
  const denylist = parseUserList(env[DESKTOP_UPDATER_RELAUNCH_DENIED_USERS_ENV])
  const denied = username !== '' && denylist.includes(username)
  const allowlisted = username !== '' && allowlist.includes(username)
  if (!flagSet) {
    return {
      allowed: false, username, flagSet, allowlisted, denied, allowlist, denylist,
      reason: `${DESKTOP_UPDATER_RELAUNCH_OK_ENV} is not 1; skip install-and-relaunch (check/download/sha512 only)`,
    }
  }
  if (username === '') {
    return {
      allowed: false, username, flagSet, allowlisted, denied, allowlist, denylist,
      reason: 'current username is empty; skip install-and-relaunch',
    }
  }
  if (denied) {
    return {
      allowed: false, username, flagSet, allowlisted, denied, allowlist, denylist,
      reason: `user ${username} is on the daily-login denylist; skip install-and-relaunch`,
    }
  }
  if (allowlist.length === 0) {
    return {
      allowed: false, username, flagSet, allowlisted, denied, allowlist, denylist,
      reason: `${DESKTOP_UPDATER_RELAUNCH_USERS_ENV} is empty; relaunch requires a dedicated test user allowlist`,
    }
  }
  if (!allowlisted) {
    return {
      allowed: false, username, flagSet, allowlisted, denied, allowlist, denylist,
      reason: `user ${username} is not on ${DESKTOP_UPDATER_RELAUNCH_USERS_ENV}=${allowlist.join(',')}; skip install-and-relaunch`,
    }
  }
  return {
    allowed: true, username, flagSet, allowlisted, denied, allowlist, denylist,
    reason: `user ${username} may install-and-relaunch under ${DESKTOP_UPDATER_RELAUNCH_OK_ENV}=1`,
  }
}

/** @typedef {'check' | 'download' | 'verify' | 'relaunch'} DesktopUpdaterE2eStep */

/**
 * @param {ReturnType<typeof decideDesktopUpdaterRelaunch>} decision
 * @returns {DesktopUpdaterE2eStep[]}
 */
export function allowedDesktopUpdaterE2eSteps(decision) {
  const steps = /** @type {DesktopUpdaterE2eStep[]} */ (['check', 'download', 'verify'])
  if (decision.allowed) steps.push('relaunch')
  return steps
}
