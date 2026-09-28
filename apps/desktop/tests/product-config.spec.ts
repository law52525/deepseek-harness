import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { resolveProductBundles } from '../src/project-manager.ts'
import {
  applyPackagedProductConfig,
  DEFAULT_DESKTOP_ARTIFACT_PREFIX,
  DEFAULT_DESKTOP_PRODUCT_NAME,
  DEFAULT_DESKTOP_PROTOCOL_SCHEME,
  DESKTOP_EXTRA_BUNDLES_ENV,
  DESKTOP_IN_APP_AUTH_ENV,
  DESKTOP_PRODUCT_NAME_ENV,
  DESKTOP_PRODUCT_VERSION_ENV,
  DESKTOP_PROFILE_NAME_ENV,
  DESKTOP_PROTOCOL_SCHEME_ENV,
  DESKTOP_WELCOME_API_KEY_ENV,
  isDesktopOpenUrl,
  resolveDesktopArtifactPrefix,
  resolveDesktopExtraBundles,
  resolveDesktopInAppAuth,
  resolveDesktopProductName,
  resolveDesktopProfileName,
  resolveDesktopProtocolScheme,
  resolveDesktopWelcomeApiKeyEnabled,
  desktopApplicationMenuTopLevelLabel,
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

  it('uses the product display name as the Darwin application-menu top-level label', () => {
    const official = resolveDesktopProductName({})
    expect(official).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(desktopApplicationMenuTopLevelLabel('darwin', official, 'Application')).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(desktopApplicationMenuTopLevelLabel('linux', official, 'Application')).toBe('Application')
    expect(desktopApplicationMenuTopLevelLabel('win32', official, 'Application')).toBe('Application')
    const branded = resolveDesktopProductName({ [DESKTOP_PRODUCT_NAME_ENV]: 'Wandox Work' })
    expect(desktopApplicationMenuTopLevelLabel('darwin', branded, 'Application')).toBe('Wandox Work')
    expect(desktopApplicationMenuTopLevelLabel('darwin', branded, 'Application'))
      .not.toBe('wandox-harness')
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

  it('defaults in-app authorization and the welcome API Key page to official behavior', () => {
    expect(resolveDesktopInAppAuth({})).toBeUndefined()
    expect(resolveDesktopWelcomeApiKeyEnabled({})).toBe(true)
  })

  it('parses a valid in-app authorization allow-list from env', () => {
    const config = {
      origins: ['https://sso.example.test'],
      callbackPrefix: 'https://sso.example.test/callback',
      forwardPath: '/auth/callback',
    }
    vi.stubEnv(DESKTOP_IN_APP_AUTH_ENV, JSON.stringify(config))
    expect(resolveDesktopInAppAuth()).toEqual(config)
    vi.stubEnv(DESKTOP_WELCOME_API_KEY_ENV, '0')
    expect(resolveDesktopWelcomeApiKeyEnabled()).toBe(false)
  })

  it('packaged in-app authorization ignores a hijacked process env', () => {
    const baked = {
      origins: ['https://sso.example.test'],
      callbackPrefix: 'https://sso.example.test/callback',
      forwardPath: '/auth/callback',
    }
    const env: NodeJS.ProcessEnv = {
      [DESKTOP_IN_APP_AUTH_ENV]: JSON.stringify({
        origins: ['https://evil.example'],
        callbackPrefix: 'https://evil.example/cb',
        forwardPath: '/hijack',
      }),
      [DESKTOP_WELCOME_API_KEY_ENV]: '1',
    }
    applyPackagedProductConfig({
      dshDesktopInAppAuth: baked,
      dshDesktopWelcomeApiKey: '0',
      version: '3.0.0',
    }, env)
    expect(resolveDesktopInAppAuth(env)).toEqual(baked)
    expect(resolveDesktopWelcomeApiKeyEnabled(env)).toBe(false)
  })

  it('packaged official identity clears in-app authorization even when the live env is set', () => {
    const env: NodeJS.ProcessEnv = {
      [DESKTOP_IN_APP_AUTH_ENV]: JSON.stringify({
        origins: ['https://sso.example.test'],
        callbackPrefix: 'https://sso.example.test/callback',
        forwardPath: '/auth/callback',
      }),
      [DESKTOP_WELCOME_API_KEY_ENV]: '0',
    }
    applyPackagedProductConfig({ version: '0.1.7-rc.2' }, env)
    expect(resolveDesktopInAppAuth(env)).toBeUndefined()
    expect(resolveDesktopWelcomeApiKeyEnabled(env)).toBe(true)
  })
})
