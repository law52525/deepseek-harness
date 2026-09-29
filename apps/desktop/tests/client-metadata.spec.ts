import { afterEach, expect, it, vi } from 'vitest'
import {
  desktopClientMetadata, desktopClientVersion, desktopPolicyClientMetadata, desktopPolicyClientVersion,
} from '../src/client-metadata.ts'
import { applyPackagedProductConfig, DESKTOP_PRODUCT_VERSION_ENV } from '../src/product-config.ts'

afterEach(() => { vi.unstubAllEnvs() })

it('reports the inlined client build version and the requested language', () => {
  vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
  expect(desktopClientVersion()).toBe('1.2.3')
  expect(desktopClientMetadata('zh-CN')).toMatchObject({ version: '1.2.3', locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 })
})

it('refuses a build that carries no client version instead of guessing one', () => {
  vi.stubEnv('DSH_CLIENT_VERSION', undefined)
  expect(() => desktopClientVersion()).toThrow(/DSH_CLIENT_VERSION/)
  vi.stubEnv('DSH_CLIENT_VERSION', '')
  expect(() => desktopClientMetadata('en')).toThrow(/DSH_CLIENT_VERSION/)
})

it('sends the inlined client version on policy requests when no product overlay is configured', () => {
  vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
  vi.stubEnv(DESKTOP_PRODUCT_VERSION_ENV, undefined)
  expect(desktopPolicyClientVersion()).toBe('1.2.3')
  expect(desktopPolicyClientVersion()).toBe(desktopClientVersion())
  expect(desktopPolicyClientMetadata('en').version).toBe('1.2.3')
})

it('sends the product version overlay on policy requests without changing account identity', () => {
  vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
  vi.stubEnv(DESKTOP_PRODUCT_VERSION_ENV, '3.0.0')
  expect(desktopPolicyClientVersion()).toBe('3.0.0')
  expect(desktopPolicyClientMetadata('zh-CN').version).toBe('3.0.0')
  expect(desktopClientVersion()).toBe('1.2.3')
  expect(desktopClientMetadata('zh-CN').version).toBe('1.2.3')
})

it('packaged policy version follows extraMetadata, not a hijacked process env', () => {
  vi.stubEnv('DSH_CLIENT_VERSION', '0.1.7-rc.2')
  const env: NodeJS.ProcessEnv = { [DESKTOP_PRODUCT_VERSION_ENV]: '9.9.9' }
  applyPackagedProductConfig({ version: '3.0.0-test.20260929.1' }, env)
  expect(desktopPolicyClientVersion(env)).toBe('3.0.0-test.20260929.1')
  expect(desktopClientVersion()).toBe('0.1.7-rc.2')
})

it('packaged official identity keeps the inlined client version on policy requests', () => {
  vi.stubEnv('DSH_CLIENT_VERSION', '0.1.7-rc.2')
  const env: NodeJS.ProcessEnv = { [DESKTOP_PRODUCT_VERSION_ENV]: '9.9.9' }
  applyPackagedProductConfig({ version: '0.1.7-rc.2' }, env)
  expect(desktopPolicyClientVersion(env)).toBe('0.1.7-rc.2')
  expect(desktopPolicyClientVersion(env)).toBe(desktopClientVersion())
})
