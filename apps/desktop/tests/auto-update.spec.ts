import { describe, expect, it, vi } from 'vitest'
import {
  INSTALL_WATCHDOG_MS,
  noteBlockingOverlayArmed,
  onBeforeQuitForUpdate,
  startDesktopAutoUpdate,
  type DesktopAutoUpdater,
} from '../src/auto-update.ts'

function fakeUpdater(checkForUpdates: DesktopAutoUpdater['checkForUpdates']): DesktopAutoUpdater {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    on() {
      return undefined
    },
    checkForUpdates,
    quitAndInstall() {},
  }
}

describe('desktop auto-update', () => {
  it('does not touch the updater when unpackaged', async () => {
    const checkForUpdates = vi.fn(async () => {
      throw new Error('feed missing')
    })
    const updater = fakeUpdater(checkForUpdates)
    await startDesktopAutoUpdate({
      isPackaged: false,
      updater,
      appVersion: '0.1.0-rc.5',
    })
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
  })

  it('does not throw when the GitHub feed is missing', async () => {
    const log = vi.fn()
    const updater = fakeUpdater(async () => {
      throw new Error('ERR_UPDATER_INVALID_RELEASE_FEED')
    })
    await expect(startDesktopAutoUpdate({
      isPackaged: true,
      updater,
      appVersion: '0.1.0-rc.5',
      log,
    })).resolves.toBeUndefined()
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.allowPrerelease).toBe(true)
    expect(log).toHaveBeenCalledWith(
      '[desktop] auto-update check failed:',
      expect.objectContaining({ message: 'ERR_UPDATER_INVALID_RELEASE_FEED' }),
    )
  })

  it('points the updater at a caller-supplied generic feed', async () => {
    const setFeedURL = vi.fn()
    const updater = fakeUpdater(async () => undefined)
    updater.setFeedURL = setFeedURL
    await startDesktopAutoUpdate({
      isPackaged: true,
      updater,
      appVersion: '2.0.0',
      feedUrl: 'https://example.invalid/v2',
    })
    expect(setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://example.invalid/v2' })
  })

  it('registers the error listener only once on a shared updater', async () => {
    const on = vi.fn()
    const updater = fakeUpdater(async () => undefined)
    updater.on = on
    await startDesktopAutoUpdate({ isPackaged: true, updater, appVersion: '2.0.0' })
    await startDesktopAutoUpdate({ isPackaged: true, updater, appVersion: '2.0.0' })
    expect(on.mock.calls.filter(call => call[0] === 'error')).toHaveLength(1)
    expect(on.mock.calls.filter(call => call[0] === 'update-downloaded')).toHaveLength(1)
  })

  it('quitAndInstall only when downloadedReady and armed, regardless of order', async () => {
    const listeners: Record<string, () => void> = {}
    const order: string[] = []
    const updater: DesktopAutoUpdater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      on(event, listener) {
        listeners[event] = listener as () => void
        return undefined
      },
      checkForUpdates: async () => undefined,
      quitAndInstall() { order.push('quit') },
    }
    let armed = false
    await startDesktopAutoUpdate({
      isPackaged: true,
      updater,
      appVersion: '2.0.0',
      isArmed: () => armed,
      disarmForUpdateInstall: () => { order.push('disarm') },
    })
    listeners['update-downloaded']?.()
    expect(order).toEqual([])
    armed = true
    noteBlockingOverlayArmed(updater)
    expect(order).toEqual(['disarm', 'quit'])
  })

  it('quitAndInstall no-op: watchdog re-arms after T seconds', async () => {
    vi.useFakeTimers()
    const listeners: Record<string, () => void> = {}
    const updater: DesktopAutoUpdater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      on(event, listener) {
        listeners[event] = listener as () => void
        return undefined
      },
      checkForUpdates: async () => undefined,
      quitAndInstall() {},
    }
    let armed = true
    const rearm = vi.fn(() => { armed = true })
    await startDesktopAutoUpdate({
      isPackaged: true,
      updater,
      appVersion: '2.0.0',
      isArmed: () => armed,
      disarmForUpdateInstall: () => { armed = false },
      rearmAfterFailedInstall: rearm,
      installWatchdogMs: INSTALL_WATCHDOG_MS,
    })
    listeners['update-downloaded']?.()
    expect(armed).toBe(false)
    expect(rearm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(INSTALL_WATCHDOG_MS - 1)
    expect(rearm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(rearm).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('registers a before-quit-for-update listener on the native updater', () => {
    const on = vi.fn()
    onBeforeQuitForUpdate({ on }, () => undefined)
    expect(on).toHaveBeenCalledWith('before-quit-for-update', expect.any(Function))
  })
})
