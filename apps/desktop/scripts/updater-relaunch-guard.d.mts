/** Opt-in flag. Any value other than `1` keeps installer relaunch skipped. */
export const DESKTOP_UPDATER_RELAUNCH_OK_ENV: 'DSH_DESKTOP_UPDATER_RELAUNCH_OK'

/** Comma-separated dedicated test accounts allowed to relaunch when the flag is set. */
export const DESKTOP_UPDATER_RELAUNCH_USERS_ENV: 'DSH_DESKTOP_UPDATER_RELAUNCH_USERS'

/** Optional comma-separated daily-login accounts that can never relaunch. */
export const DESKTOP_UPDATER_RELAUNCH_DENIED_USERS_ENV: 'DSH_DESKTOP_UPDATER_RELAUNCH_DENIED_USERS'

/** Check/download/checksum always; relaunch only when the guard allows it. */
export type DesktopUpdaterE2eStep = 'check' | 'download' | 'verify' | 'relaunch'

/** Decision for whether packaged updater install-and-relaunch may run. */
export interface DesktopUpdaterRelaunchDecision {
  readonly allowed: boolean
  readonly reason: string
  readonly username: string
  readonly flagSet: boolean
  readonly allowlisted: boolean
  readonly denied: boolean
  readonly allowlist: string[]
  readonly denylist: string[]
}

/**
 * Split a comma-separated account list.
 * @param raw - Environment value or unset.
 * @returns Unique trimmed usernames.
 */
export function parseUserList(raw: string | undefined): string[]

/**
 * Read the current account name from env overrides or USER/USERNAME/LOGNAME.
 * @param env - Process environment.
 * @returns Trimmed username, possibly empty.
 */
export function readProcessUsername(env?: NodeJS.ProcessEnv): string

/**
 * Default path is check → download → checksum. Install-and-relaunch needs the
 * explicit flag and a username on the dedicated-account allowlist.
 * @param input - Optional env and username overrides for tests.
 * @returns Whether relaunch is allowed and why.
 */
export function decideDesktopUpdaterRelaunch(input?: {
  env?: NodeJS.ProcessEnv
  username?: string
}): DesktopUpdaterRelaunchDecision

/**
 * Steps an updater e2e may run for one decision.
 * @param decision - Result of decideDesktopUpdaterRelaunch.
 * @returns check/download/verify, plus relaunch only when allowed.
 */
export function allowedDesktopUpdaterE2eSteps(
  decision: DesktopUpdaterRelaunchDecision,
): DesktopUpdaterE2eStep[]
