import { describe, expect, it } from 'vitest'
import {
  DESKTOP_UPDATER_RELAUNCH_OK_ENV,
  DESKTOP_UPDATER_RELAUNCH_USERS_ENV,
  allowedDesktopUpdaterE2eSteps,
  decideDesktopUpdaterRelaunch,
  parseUserList,
} from '../scripts/updater-relaunch-guard.mjs'

const dedicated = 'd21-isolated'

describe('desktop updater relaunch guard', () => {
  it('parses a comma-separated allowlist', () => {
    expect(parseUserList(undefined)).toEqual([])
    expect(parseUserList('')).toEqual([])
    expect(parseUserList(` ${dedicated}, other ,${dedicated} `)).toEqual([dedicated, 'other'])
  })

  it('skips install-and-relaunch by default', () => {
    const decision = decideDesktopUpdaterRelaunch({
      env: { USER: 'eccang' },
      username: 'eccang',
    })
    expect(decision.allowed).toBe(false)
    expect(decision.flagSet).toBe(false)
    expect(decision.reason).toMatch(/is not 1/u)
    expect(allowedDesktopUpdaterE2eSteps(decision)).toEqual(['check', 'download', 'verify'])
  })

  it('skips when the username is empty even with the flag', () => {
    const decision = decideDesktopUpdaterRelaunch({
      env: { DSH_DESKTOP_UPDATER_RELAUNCH_OK: '1', DSH_DESKTOP_UPDATER_RELAUNCH_USERS: dedicated },
      username: '',
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/username is empty/u)
  })

  it('skips when the flag is set but no dedicated allowlist is present', () => {
    const decision = decideDesktopUpdaterRelaunch({
      env: { [DESKTOP_UPDATER_RELAUNCH_OK_ENV]: '1' },
      username: dedicated,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/empty/u)
    expect(allowedDesktopUpdaterE2eSteps(decision)).not.toContain('relaunch')
  })

  it('skips a daily-login user even with the flag and a self-allowlist', () => {
    const decision = decideDesktopUpdaterRelaunch({
      env: {
        [DESKTOP_UPDATER_RELAUNCH_OK_ENV]: '1',
        [DESKTOP_UPDATER_RELAUNCH_USERS_ENV]: 'eccang',
        DSH_DESKTOP_UPDATER_RELAUNCH_DENIED_USERS: 'eccang',
      },
      username: 'eccang',
    })
    expect(decision.allowed).toBe(false)
    expect(decision.denied).toBe(true)
    expect(decision.reason).toMatch(/denylist/u)
    expect(allowedDesktopUpdaterE2eSteps(decision)).toEqual(['check', 'download', 'verify'])
  })

  it('skips when the current user is not on the dedicated allowlist', () => {
    const decision = decideDesktopUpdaterRelaunch({
      env: {
        [DESKTOP_UPDATER_RELAUNCH_OK_ENV]: '1',
        [DESKTOP_UPDATER_RELAUNCH_USERS_ENV]: dedicated,
      },
      username: 'eccang',
    })
    expect(decision.allowed).toBe(false)
    expect(decision.allowlisted).toBe(false)
    expect(allowedDesktopUpdaterE2eSteps(decision)).not.toContain('relaunch')
  })

  it('allows relaunch only for a dedicated allowlisted user with the flag', () => {
    const decision = decideDesktopUpdaterRelaunch({
      env: {
        [DESKTOP_UPDATER_RELAUNCH_OK_ENV]: '1',
        [DESKTOP_UPDATER_RELAUNCH_USERS_ENV]: dedicated,
      },
      username: dedicated,
    })
    expect(decision.allowed).toBe(true)
    expect(allowedDesktopUpdaterE2eSteps(decision)).toEqual(['check', 'download', 'verify', 'relaunch'])
  })

  it('ignores a similarly named product flag that is not the generic opt-in', () => {
    const decision = decideDesktopUpdaterRelaunch({
      env: {
        PRODUCT_UPDATER_RELAUNCH_OK: '1',
        PRODUCT_UPDATER_RELAUNCH_USERS: dedicated,
      },
      username: dedicated,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.flagSet).toBe(false)
  })
})
