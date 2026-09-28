import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { resolveProductBundles } from '../src/project-manager.ts'
import {
  applyPackagedProductConfig,
  DESKTOP_EXTRA_BUNDLES_ENV,
  DESKTOP_PRODUCT_VERSION_ENV,
  DESKTOP_PROFILE_NAME_ENV,
  resolveDesktopExtraBundles,
  resolveDesktopProfileName,
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
    expect(resolveProductBundles(resolveDesktopExtraBundles(env))).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])
  })
})
