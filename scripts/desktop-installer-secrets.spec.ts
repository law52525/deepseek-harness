import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applySigningEnv,
  assertStagingHasNoSecrets,
  credentialLeakInText,
  isDotenvBasename,
  leakableSecretValues,
  parseSigningEnvFile,
} from './desktop-installer-secrets.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('signing dotenv parse', () => {
  it('loads only APPLE_* and CSC_* and ignores DEEPSEEK_API_KEY', () => {
    const parsed = parseSigningEnvFile([
      'DEEPSEEK_API_KEY=sk-should-not-load',
      'APPLE_ID=dev@example.com',
      'APPLE_TEAM_ID=ABCD123456',
      'APPLE_APP_SPECIFIC_PASSWORD="xxxx-yyyy"',
      'CSC_LINK=/tmp/cert.p12',
      '# APPLE_ID=commented',
      'OTHER=1',
    ].join('\n'))
    expect(parsed).toEqual({
      APPLE_ID: 'dev@example.com',
      APPLE_TEAM_ID: 'ABCD123456',
      APPLE_APP_SPECIFIC_PASSWORD: 'xxxx-yyyy',
      CSC_LINK: '/tmp/cert.p12',
    })
  })

  it('does not overwrite keys already set on the target env', () => {
    const target: NodeJS.ProcessEnv = { APPLE_ID: 'from-actions' }
    applySigningEnv(target, { APPLE_ID: 'from-file', CSC_NAME: 'Dev ID' })
    expect(target.APPLE_ID).toBe('from-actions')
    expect(target.CSC_NAME).toBe('Dev ID')
  })
})

describe('extraResources secret scan', () => {
  it('treats .env basenames as forbidden and allows documenting the key name', () => {
    expect(isDotenvBasename('.env')).toBe(true)
    expect(isDotenvBasename('.env.local')).toBe(true)
    expect(isDotenvBasename('env.example')).toBe(false)
    expect(credentialLeakInText('Set DEEPSEEK_API_KEY in Settings after first launch.', [])).toBeUndefined()
    expect(credentialLeakInText('DEEPSEEK_API_KEY=… dsh', [])).toBeUndefined()
    expect(credentialLeakInText('DEEPSEEK_API_KEY=sk-live-secret', [])).toBe(
      'credential assignment DEEPSEEK_API_KEY=',
    )
    expect(leakableSecretValues({ DEEPSEEK_API_KEY: 'short' })).toEqual([])
    expect(leakableSecretValues({ DEEPSEEK_API_KEY: 'sk-live-secret' })).toEqual(['sk-live-secret'])
    expect(credentialLeakInText('token sk-live-secret leaked', ['sk-live-secret'])).toBe(
      'builder secret value',
    )
  })

  it('fails when staged extraResources contain a dotenv file or an assigned key', async () => {
    const staging = mkdtempSync(join(tmpdir(), 'dsh-desktop-secrets-'))
    roots.push(staging)
    mkdirSync(join(staging, 'host'), { recursive: true })
    writeFileSync(join(staging, 'host', '.env'), 'DEEPSEEK_API_KEY=sk-from-file\n')
    await expect(assertStagingHasNoSecrets(staging, {})).rejects.toThrow(/developer secrets/)

    rmSync(join(staging, 'host', '.env'))
    writeFileSync(join(staging, 'host', 'readme.txt'), 'Use DEEPSEEK_API_KEY in Settings.\n')
    await expect(assertStagingHasNoSecrets(staging, {})).resolves.toBeUndefined()

    writeFileSync(join(staging, 'host', 'copied.env.txt'), 'APPLE_APP_SPECIFIC_PASSWORD=aaaa-bbbb-cccc-dddd\n')
    await expect(assertStagingHasNoSecrets(staging, {})).rejects.toThrow(/developer secrets/)
  })
})
