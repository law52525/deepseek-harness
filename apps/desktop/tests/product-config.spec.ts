import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import {
  applyPackagedProductConfig,
  DESKTOP_EXTRA_BUNDLES_ENV,
  DESKTOP_PROFILE_NAME_ENV,
  resolveDesktopExtraBundles,
  resolveDesktopProfileName,
} from '../src/product-config.ts'

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

  it('hydrates env from packaged extraMetadata without overriding live values', () => {
    const env: NodeJS.ProcessEnv = {}
    applyPackagedProductConfig({
      dshDesktopProfileName: 'product-desktop',
      dshDesktopExtraBundles: ['extra-bundle'],
    }, env)
    expect(env[DESKTOP_PROFILE_NAME_ENV]).toBe('product-desktop')
    expect(env[DESKTOP_EXTRA_BUNDLES_ENV]).toBe('extra-bundle')
    applyPackagedProductConfig({
      dshDesktopProfileName: 'other',
      dshDesktopExtraBundles: ['ignored'],
    }, env)
    expect(env[DESKTOP_PROFILE_NAME_ENV]).toBe('product-desktop')
    expect(env[DESKTOP_EXTRA_BUNDLES_ENV]).toBe('extra-bundle')
  })
})
