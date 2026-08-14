import { describe, expect, it } from 'vitest'
import {
  assertAppleNotaryEnv,
  hostBinaryCodesignArgs,
  macSignedBuilderArgs,
  parseDeveloperIdIdentity,
  resolveMacSigningIdentity,
} from './desktop-mac-signing.ts'
import { githubPublishRepo, packagerArgs } from './build-desktop-installer.ts'

const FIND_IDENTITY = `
  1) ABCDEF0123456789 "Developer ID Application: Example Org (TEAMID1234)"
     1 valid identities found
`

describe('macOS Developer ID identity', () => {
  it('parses security find-identity without the electron-builder-forbidden prefix', () => {
    expect(parseDeveloperIdIdentity(FIND_IDENTITY)).toBe('Example Org (TEAMID1234)')
    expect(resolveMacSigningIdentity({ CSC_NAME: 'From Env (TEAM)' }, '')).toBe('From Env (TEAM)')
    expect(resolveMacSigningIdentity({
      CSC_NAME: 'Developer ID Application: From Env (TEAM)',
    }, '')).toBe('From Env (TEAM)')
    expect(resolveMacSigningIdentity({}, FIND_IDENTITY)).toBe('Example Org (TEAMID1234)')
    expect(() => resolveMacSigningIdentity({}, '')).toThrow(/Developer ID Application/)
  })

  it('requires Apple notary env and emits hardened-runtime builder args', () => {
    expect(() => { assertAppleNotaryEnv({}) }).toThrow(/APPLE_ID/)
    assertAppleNotaryEnv({
      APPLE_ID: 'dev@example.com',
      APPLE_TEAM_ID: 'TEAMID1234',
      APPLE_APP_SPECIFIC_PASSWORD: 'xxxx-yyyy-zzzz-wwww',
    })
    const args = macSignedBuilderArgs('Developer ID Application: Example Org (TEAMID1234)')
    expect(args).toContain('--config.mac.identity=Example Org (TEAMID1234)')
    expect(args).toContain('--config.mac.hardenedRuntime=true')
    expect(args).toContain('--config.mac.notarize=true')
    expect(args.some(flag => flag.includes('identity=-'))).toBe(false)
    expect(args.some(flag => flag.includes('Developer ID Application:'))).toBe(false)
    expect(hostBinaryCodesignArgs('ID', '/entitlements.plist', '/host/node')).toEqual([
      '--sign',
      'ID',
      '--force',
      '--options',
      'runtime',
      '--timestamp',
      '--entitlements',
      '/entitlements.plist',
      '/host/node',
    ])
  })
})

describe('desktop installer packager args', () => {
  it('keeps unsigned Mac ad-hoc and does not disable CSC discovery on the signed path', () => {
    expect(packagerArgs({ os: 'mac', arch: 'arm64' }, false)).toContain('--config.mac.identity=-')
    const signed = packagerArgs(
      { os: 'mac', arch: 'arm64' },
      true,
      'Developer ID Application: Example Org (TEAMID1234)',
      { owner: 'example', repo: 'fork' },
    )
    expect(signed).toContain('--config.mac.identity=Example Org (TEAMID1234)')
    expect(signed.some(flag => flag.includes('Developer ID Application:'))).toBe(false)
    expect(signed).toContain('--config.mac.notarize=true')
    expect(signed).toContain('--config.publish.owner=example')
    expect(signed).toContain('--config.publish.repo=fork')
    expect(signed).not.toContain('--config.mac.identity=-')
    expect(packagerArgs({ os: 'win', arch: 'x64' }, false)).toEqual([
      '--publish',
      'never',
      '--win',
      '--x64',
    ])
  })

  it('parses GITHUB_REPOSITORY for electron-updater publish config', () => {
    expect(githubPublishRepo('deepseek-ai/deepseek-harness')).toEqual({
      owner: 'deepseek-ai',
      repo: 'deepseek-harness',
    })
    expect(githubPublishRepo('owner-only')).toBeUndefined()
    expect(githubPublishRepo(undefined)).toBeUndefined()
  })
})
