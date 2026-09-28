import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { resolveProductBundles } from '../src/project-manager.ts'
import {
  applyPackagedProductConfig,
  DEFAULT_DESKTOP_ARTIFACT_PREFIX,
  DEFAULT_DESKTOP_PRODUCT_NAME,
  DEFAULT_DESKTOP_PROTOCOL_SCHEME,
  DESKTOP_EXTRA_BUNDLES_ENV,
  DESKTOP_PRODUCT_NAME_ENV,
  DESKTOP_PRODUCT_VERSION_ENV,
  DESKTOP_PROFILE_NAME_ENV,
  DESKTOP_PROTOCOL_SCHEME_ENV,
  isDesktopOpenUrl,
  resolveDesktopArtifactPrefix,
  resolveDesktopExtraBundles,
  resolveDesktopProductName,
  resolveDesktopProfileName,
  resolveDesktopProtocolScheme,
} from '../src/product-config.ts'

const BAKED = {
  dshDesktopProfileName: 'product-desktop',
  dshDesktopExtraBundles: ['extra-bundle'],
  version: '3.0.0',
} as const

describe('desktop product configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults the profile name to desktop', () => {
    expect(resolveDesktopProfileName({})).toBe('desktop')
    expect(resolveDesktopPaths('/tmp/dsh').profile).toBe('/tmp/dsh/profiles/desktop')
  })

  it('relocates the profile when DSH_DESKTOP_PROFILE_NAME is set', () => {
    vi.stubEnv(DESKTOP_PROFILE_NAME_ENV, 'product-desktop')
    expect(resolveDesktopProfileName()).toBe('product-desktop')
    expect(resolveDesktopPaths('/tmp/dsh').profile).toBe('/tmp/dsh/profiles/product-desktop')
    expect(resolveDesktopPaths('/tmp/dsh').lock).toBe('/tmp/dsh/profiles/product-desktop/lock')
  })

  it('reads extra bundles as a unique comma-separated list', () => {
    expect(resolveDesktopExtraBundles({})).toEqual([])
    vi.stubEnv(DESKTOP_EXTRA_BUNDLES_ENV, ' extra-a, extra-b, extra-a ')
    expect(resolveDesktopExtraBundles()).toEqual(['extra-a', 'extra-b'])
  })

  it('unpackaged extra bundles follow an empty or conflicting process env', () => {
    expect(resolveDesktopExtraBundles({ [DESKTOP_EXTRA_BUNDLES_ENV]: '' })).toEqual([])
    expect(resolveDesktopExtraBundles({ [DESKTOP_EXTRA_BUNDLES_ENV]: 'other' })).toEqual(['other'])
    expect(resolveProductBundles(resolveDesktopExtraBundles({}))).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])
  })

  it('packaged extra bundles ignore an empty or conflicting process env', () => {
    for (const live of ['', 'other']) {
      const env: NodeJS.ProcessEnv = {
        [DESKTOP_EXTRA_BUNDLES_ENV]: live,
        [DESKTOP_PROFILE_NAME_ENV]: 'hijacked',
        [DESKTOP_PRODUCT_VERSION_ENV]: '9.9.9',
      }
      applyPackagedProductConfig(BAKED, env)
      expect(resolveDesktopExtraBundles(env)).toEqual(['extra-bundle'])
      expect(resolveDesktopProfileName(env)).toBe('product-desktop')
      expect(env[DESKTOP_PRODUCT_VERSION_ENV]).toBe('3.0.0')
      expect(resolveProductBundles(resolveDesktopExtraBundles(env))).toEqual([
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
        'extra-bundle',
      ])
    }
  })

  it('packaged official identity ignores process env when extraMetadata omits product extras', () => {
    const env: NodeJS.ProcessEnv = {
      [DESKTOP_EXTRA_BUNDLES_ENV]: 'other',
      [DESKTOP_PROFILE_NAME_ENV]: 'hijacked',
      [DESKTOP_PRODUCT_VERSION_ENV]: '9.9.9',
    }
    applyPackagedProductConfig({ version: '0.1.7-rc.2' }, env)
    expect(resolveDesktopExtraBundles(env)).toEqual([])
    expect(resolveDesktopProfileName(env)).toBe('desktop')
    expect(env[DESKTOP_PRODUCT_VERSION_ENV]).toBe('0.1.7-rc.2')
    expect(resolveDesktopProductName(env)).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(resolveDesktopProtocolScheme(env)).toBe(DEFAULT_DESKTOP_PROTOCOL_SCHEME)
    expect(resolveProductBundles(resolveDesktopExtraBundles(env))).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])
  })

  it('defaults brand identity to official DeepSeek Harness values', () => {
    expect(resolveDesktopProductName({})).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(resolveDesktopProtocolScheme({})).toBe(DEFAULT_DESKTOP_PROTOCOL_SCHEME)
    expect(resolveDesktopArtifactPrefix({})).toBe(DEFAULT_DESKTOP_ARTIFACT_PREFIX)
    expect(isDesktopOpenUrl('dsh://open')).toBe(true)
    expect(isDesktopOpenUrl('dsh://open/')).toBe(true)
    expect(isDesktopOpenUrl('wandox://open')).toBe(false)
  })

  it('relocates product name, protocol, and artifact prefix from env', () => {
    vi.stubEnv(DESKTOP_PRODUCT_NAME_ENV, 'Wandox Work')
    vi.stubEnv(DESKTOP_PROTOCOL_SCHEME_ENV, 'wandox')
    vi.stubEnv('DSH_DESKTOP_ARTIFACT_PREFIX', 'wandox-work')
    expect(resolveDesktopProductName()).toBe('Wandox Work')
    expect(resolveDesktopProtocolScheme()).toBe('wandox')
    expect(resolveDesktopArtifactPrefix()).toBe('wandox-work')
    expect(isDesktopOpenUrl('wandox://open', 'wandox')).toBe(true)
    expect(isDesktopOpenUrl('dsh://open', 'wandox')).toBe(false)
  })

  it('packaged brand identity ignores a hijacked process env', () => {
    const env: NodeJS.ProcessEnv = {
      [DESKTOP_PRODUCT_NAME_ENV]: 'Hijacked',
      [DESKTOP_PROTOCOL_SCHEME_ENV]: 'evil',
    }
    applyPackagedProductConfig({
      dshDesktopProductName: 'Wandox Work',
      dshDesktopProtocolScheme: 'wandox',
      version: '3.0.0',
    }, env)
    expect(resolveDesktopProductName(env)).toBe('Wandox Work')
    expect(resolveDesktopProtocolScheme(env)).toBe('wandox')
  })
})
