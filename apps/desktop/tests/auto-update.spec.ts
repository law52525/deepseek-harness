import { describe, expect, it, vi } from 'vitest'
import { startDesktopAutoUpdate, type DesktopAutoUpdater } from '../src/auto-update.ts'

function fakeUpdater(checkForUpdates: DesktopAutoUpdater['checkForUpdates']): DesktopAutoUpdater {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    on() {
      return undefined
    },
    checkForUpdates,
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

  it('leaves allowPrerelease false for a stable version', async () => {
    const updater = fakeUpdater(async () => undefined)
    await startDesktopAutoUpdate({
      isPackaged: true,
      updater,
      appVersion: '1.0.0',
    })
    expect(updater.allowPrerelease).toBe(false)
  })
})
