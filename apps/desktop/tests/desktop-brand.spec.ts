import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const RELEASE = {
  DSH_DESKTOP_APP_ID: 'com.example.desktop',
  DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
  DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
  DSH_DESKTOP_TARGET_ARCH: 'arm64',
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_API_KEY: '/private/credentials/AuthKey_TEST123456.p8',
  APPLE_API_KEY_ID: 'TEST123456',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
  DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
  DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef',
} as const

describe('desktop brand identity in electron-builder config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps official productName, protocol, and artifactName when brand env is unset', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig({ ...RELEASE }, 'darwin', 'arm64')
    expect(config.productName).toBe('DeepSeek Harness')
    expect(config.protocols).toEqual([{ name: 'DeepSeek Harness', schemes: ['dsh'] }])
    expect(config.artifactName).toBe('deepseek-harness-${version}-${os}-${arch}.${ext}')
    expect(config.extraMetadata.dshDesktopProductName).toBeUndefined()
    expect(config.extraMetadata.dshDesktopProtocolScheme).toBeUndefined()
    expect(config.mac.extendInfo.NSMicrophoneUsageDescription).toContain('DeepSeek Harness')
    expect(config.mac.extendInfo.CFBundleLocalizations).toEqual(['en', 'zh_CN'])
  })

  it('applies product name, wandox scheme, artifact prefix, and brand resources', async () => {
    const brand = mkdtempSync(join(tmpdir(), 'd19-brand-'))
    for (const name of ['icon-macos.png', 'icon-windows.png', 'tray-windows.ico', 'welcome-brand.svg', 'uninstaller-sidebar.bmp']) {
      writeFileSync(join(brand, name), 'x')
    }
    const env = {
      ...RELEASE,
      DSH_DESKTOP_PRODUCT_NAME: 'Wandox Work',
      DSH_DESKTOP_PROTOCOL_SCHEME: 'wandox',
      DSH_DESKTOP_ARTIFACT_PREFIX: 'wandox-work',
      DSH_DESKTOP_BRAND_RESOURCES: brand,
    }
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig(env, 'darwin', 'arm64')
    expect(config.productName).toBe('Wandox Work')
    expect(config.protocols).toEqual([{ name: 'Wandox Work', schemes: ['wandox'] }])
    expect(config.artifactName).toBe('wandox-work-${version}-${os}-${arch}.${ext}')
    expect(config.extraMetadata.dshDesktopProductName).toBe('Wandox Work')
    expect(config.extraMetadata.dshDesktopProtocolScheme).toBe('wandox')
    expect(String(config.mac.icon)).toBe(join(brand, 'icon-macos.png'))
    expect(config.files.some((entry: unknown) => typeof entry === 'object' && entry !== null
      && 'to' in entry && (entry as { to: string }).to === 'renderer/assets/welcome-brand.svg')).toBe(true)
    expect(config.files).not.toContain('renderer/**/*')
    expect(config.files.some((entry: unknown) => typeof entry === 'object' && entry !== null
      && 'filter' in entry && Array.isArray((entry as { filter: string[] }).filter)
      && (entry as { filter: string[] }).filter.includes('!assets/welcome-brand.svg'))).toBe(true)
    expect(config.artifactName).toContain('${version}')
    expect(config.artifactName).toContain('${os}')
    expect(config.artifactName).toContain('${arch}')
    expect(config.mac.extendInfo.NSMicrophoneUsageDescription).toContain('Wandox Work')
    expect(config.mac.extendInfo.CFBundleLocalizations).toEqual(['en', 'zh_CN'])
  })
})
