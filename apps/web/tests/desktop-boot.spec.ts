// @vitest-environment jsdom
/** Desktop renderer boot: plugin URL parse, loadBundle eval, and theme DOM fields. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyBootTheme,
  loadDesktopBundle,
  pluginIdFromUrl,
} from '../src/desktop-boot.ts'

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.style.colorScheme = ''
  document.body.removeAttribute('data-ds-dark-theme')
  vi.restoreAllMocks()
})

describe('desktop renderer boot', () => {
  it('parses scoped plugin URLs and rejects anything else', () => {
    expect(pluginIdFromUrl('/plugins/@deepseek-ai/dsh-client-connection/client.js?rev=r1'))
      .toBe('@deepseek-ai/dsh-client-connection')
    expect(() => pluginIdFromUrl('/other/@p/x/client.js')).toThrow(/unrecognized plugin URL/)
    expect(() => pluginIdFromUrl('/plugins/client.js')).toThrow(/unrecognized plugin URL/)
  })

  it('evaluates a fixture factory through loadBundle', async () => {
    const code = 'globalThis.__DSH_DESKTOP_BOOT_FACTORY__ = \'loaded\''
    await loadDesktopBundle(
      '/plugins/@p/connection/client.js?rev=fx',
      async (id) => {
        expect(id).toBe('@p/connection')
        return code
      },
    )
    expect((globalThis as { __DSH_DESKTOP_BOOT_FACTORY__?: string }).__DSH_DESKTOP_BOOT_FACTORY__).toBe('loaded')
    delete (globalThis as { __DSH_DESKTOP_BOOT_FACTORY__?: string }).__DSH_DESKTOP_BOOT_FACTORY__
  })

  it('applies dark and light palettes from the Host preference', () => {
    applyBootTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    applyBootTheme('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
  })

  it('resolves system preference through matchMedia', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener() { /* unused */ },
      removeEventListener() { /* unused */ },
    }))
    applyBootTheme('system')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
