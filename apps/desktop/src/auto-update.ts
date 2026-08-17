/**
 * Full-app auto-update from GitHub Releases. A missing feed must not quit the app.
 */

/** Subset of `electron-updater` used by the desktop shell. */
export interface DesktopAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  setFeedURL?(options: { provider: 'generic'; url: string }): void
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'update-downloaded', listener: () => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

export interface DesktopAutoUpdateTimers {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

/** Process still alive this long after quitAndInstall → re-arm the overlay. */
export const INSTALL_WATCHDOG_MS = 10_000

const wiredErrorListeners = new WeakSet<DesktopAutoUpdater>()
const wiredDownloadListeners = new WeakSet<DesktopAutoUpdater>()
const armedGetters = new WeakMap<DesktopAutoUpdater, () => boolean>()
const installDisarmers = new WeakMap<DesktopAutoUpdater, () => void>()
const downloadedReady = new WeakSet<DesktopAutoUpdater>()
const installStarted = new WeakSet<DesktopAutoUpdater>()
const rearms = new WeakMap<DesktopAutoUpdater, () => void>()
const watchdogMs = new WeakMap<DesktopAutoUpdater, number>()
const watchdogTimers = new WeakMap<DesktopAutoUpdater, DesktopAutoUpdateTimers>()
const watchdogHandles = new WeakMap<DesktopAutoUpdater, ReturnType<typeof setTimeout>>()
const logs = new WeakMap<DesktopAutoUpdater, (message: string, error?: unknown) => void>()

export interface DesktopAutoUpdateOptions {
  /** `app.isPackaged`; unpackaged `electron .` has no GitHub feed. */
  isPackaged: boolean
  updater: DesktopAutoUpdater
  /** Current `app.getVersion()`; prerelease versions must see rc feeds. */
  appVersion: string
  /**
   * Generic provider URL for this app's major-version channel.
   * Callers supply it; the shell does not hardcode a product origin.
   */
  feedUrl?: string
  log?: (message: string, error?: unknown) => void
  /**
   * When true at `maybeInstall`, call `quitAndInstall` (blocking overlay
   * is up; the user cannot quit otherwise). When false/omitted, keep the
   * downloaded package for the next voluntary quit.
   */
  isArmed?: () => boolean
  /**
   * Disarm the blocking overlay in the same function as `quitAndInstall`.
   * The reason is known at this call site; do not wait for
   * `before-quit-for-update` (Mac emits it on native autoUpdater; NSIS may
   * not emit it at all). Disarm is reversible: if the process is still
   * alive after {@link INSTALL_WATCHDOG_MS}, `rearmAfterFailedInstall` runs.
   */
  disarmForUpdateInstall?: () => void
  /** Re-arm the overlay; caller supplies copy. No-op if the process exited. */
  rearmAfterFailedInstall?: () => void
  installWatchdogMs?: number
  timers?: DesktopAutoUpdateTimers
}

/**
 * Start a GitHub Releases update check. Swallows feed and network failures.
 * @param options - packaged flag, updater, and app version.
 * @returns after the check settles or is skipped.
 */
export async function startDesktopAutoUpdate(options: DesktopAutoUpdateOptions): Promise<void> {
  if (!options.isPackaged) return
  const log = options.log ?? ((message, error) => {
    if (error === undefined) console.error(message)
    else console.error(message, error)
  })
  const { updater } = options
  logs.set(updater, log)
  if (options.isArmed !== undefined) armedGetters.set(updater, options.isArmed)
  if (options.disarmForUpdateInstall !== undefined) installDisarmers.set(updater, options.disarmForUpdateInstall)
  if (options.rearmAfterFailedInstall !== undefined) rearms.set(updater, options.rearmAfterFailedInstall)
  if (options.installWatchdogMs !== undefined) watchdogMs.set(updater, options.installWatchdogMs)
  watchdogTimers.set(updater, options.timers ?? { setTimeout, clearTimeout })
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = options.appVersion.includes('-')
  if (options.feedUrl !== undefined && options.feedUrl !== '' && updater.setFeedURL !== undefined) {
    updater.setFeedURL({ provider: 'generic', url: options.feedUrl })
  }
  if (!wiredErrorListeners.has(updater)) {
    wiredErrorListeners.add(updater)
    updater.on('error', (error) => {
      log('[desktop] auto-update:', error)
    })
  }
  if (!wiredDownloadListeners.has(updater)) {
    wiredDownloadListeners.add(updater)
    updater.on('update-downloaded', () => {
      downloadedReady.add(updater)
      maybeInstall(updater)
    })
  }
  maybeInstall(updater)
  try {
    await updater.checkForUpdates()
  } catch (error) {
    log('[desktop] auto-update check failed:', error)
  }
}

/**
 * Overlay just became armed. `update-downloaded` fires once; if it already
 * happened, install now. Order of arm vs download must not matter.
 */
export function noteBlockingOverlayArmed(updater: DesktopAutoUpdater): void {
  maybeInstall(updater)
}

function maybeInstall(updater: DesktopAutoUpdater): void {
  if (!downloadedReady.has(updater)) return
  if (armedGetters.get(updater)?.() !== true) return
  if (installStarted.has(updater)) return
  installStarted.add(updater)
  quitAndInstallArmedUpdate(updater)
}

/** Disarm first; the reason is known here. Do not wait for a platform event. */
function quitAndInstallArmedUpdate(updater: DesktopAutoUpdater): void {
  installDisarmers.get(updater)?.()
  try {
    updater.quitAndInstall()
  } catch (error) {
    logs.get(updater)?.('[desktop] auto-update quitAndInstall failed:', error)
  }
  scheduleInstallWatchdog(updater)
}

function scheduleInstallWatchdog(updater: DesktopAutoUpdater): void {
  const rearm = rearms.get(updater)
  if (rearm === undefined) return
  const timers = watchdogTimers.get(updater) ?? { setTimeout, clearTimeout }
  const previous = watchdogHandles.get(updater)
  if (previous !== undefined) timers.clearTimeout(previous)
  const handle = timers.setTimeout(() => {
    watchdogHandles.delete(updater)
    rearm()
  }, watchdogMs.get(updater) ?? INSTALL_WATCHDOG_MS)
  watchdogHandles.set(updater, handle)
}
