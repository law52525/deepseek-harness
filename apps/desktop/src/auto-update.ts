/**
 * Full-app auto-update from GitHub Releases. A missing feed must not quit the app.
 */

/** Subset of `electron-updater` used by the desktop shell. */
export interface DesktopAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
}

export interface DesktopAutoUpdateOptions {
  /** `app.isPackaged`; unpackaged `electron .` has no GitHub feed. */
  isPackaged: boolean
  updater: DesktopAutoUpdater
  /** Current `app.getVersion()`; prerelease versions must see rc feeds. */
  appVersion: string
  log?: (message: string, error?: unknown) => void
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
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = options.appVersion.includes('-')
  updater.on('error', (error) => {
    log('[desktop] auto-update:', error)
  })
  try {
    await updater.checkForUpdates()
  } catch (error) {
    log('[desktop] auto-update check failed:', error)
  }
}
