// @vitest-environment jsdom
/** Desktop renderer boot: plugin URL parse, loadBundle eval, theme DOM fields, and facade preloads. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import type { DshWindow, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { PARSER_PRELOAD_IDS } from '@deepseek-ai/dsh-client-modules/src/client/bootstrap-facade.ts'
import {
  applyBootTheme,
  loadDesktopBundle,
  pluginIdFromUrl,
  runDesktopBoot,
  type DesktopRendererHost,
} from '../src/desktop-boot.ts'

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.style.colorScheme = ''
  document.body.removeAttribute('data-ds-dark-theme')
  delete (window as DshWindow).__ModuleLoader__
  delete (window as DshWindow).__DSH_BOOT__
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

  it('installs the ModuleLoader facade and parser-preloads before AppWebEntry.run', async () => {
    const loaded: string[] = []
    const run = vi.spyOn(AppWebEntry.prototype, 'run').mockImplementation(async () => {
      const loader = (window as DshWindow).__ModuleLoader__
      expect(loader?.mode).toBe('queue')
      expect(loader?.pendingQueue.map(registration => registration.id)).toEqual([...PARSER_PRELOAD_IDS])
      expect(loaded).toEqual([...PARSER_PRELOAD_IDS])
    })
    const el = document.createElement('div')
    document.body.append(el)
    await runDesktopBoot(el, fixtureHost((id) => {
      loaded.push(id)
      return `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: () => ({}) })`
    }))
    expect(run).toHaveBeenCalledOnce()
  })

  it('rejects a Host graph that omits a parser-preload row', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const graph: WebBootGraph = {
      rev: 'r',
      entries: [{
        id: '@deepseek-ai/dsh-client-modules',
        url: '/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=r',
        rev: 'r',
      }],
    }
    await expect(runDesktopBoot(el, {
      bootGraph: async () => ({ graph, themePreference: 'light' }),
      readPlugin: async () => '',
    })).rejects.toThrow('missing parser-preload row @deepseek-ai/dsh-client-runtime')
  })
})

/** Host graph that includes both parser-preload rows so runDesktopBoot can IPC-eval them. */
function fixtureHost(readPlugin: (id: string) => string): DesktopRendererHost {
  return {
    bootGraph: async () => ({
      graph: {
        rev: 'r',
        entries: PARSER_PRELOAD_IDS.map(id => ({
          id,
          url: `/plugins/${id}/client.js?rev=r`,
          rev: 'r',
        })),
      },
      themePreference: 'light',
    }),
    readPlugin: async id => readPlugin(id),
  }
}
