/**
 * Desktop renderer boot: install the Host-owned ModuleLoader facade, parser-preload
 * modules and runtime through IPC, inject the Host graph, apply the pre-plugin
 * theme, and load remaining plugin factories through BootSeams.
 */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
// Import the facade installer from source, not `./client`: that export is the
// plugin bundle AppWebEntry must materialize through the pending queue.
import {
  PARSER_PRELOAD_IDS,
  installBootstrapFacade,
} from '@deepseek-ai/dsh-client-modules/src/client/bootstrap-facade.ts'
import type { DshWindow, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'

/** Built-in theme preference copied beside the boot graph (no HTTP index tap). */
export type DesktopThemePreference = 'light' | 'dark' | 'system'

/** Preload control face the Electron shell exposes on the window. */
export interface DesktopRendererHost {
  /**
   * Ask the Host child for the composed client graph and current theme.
   * @returns graph plus the durable built-in preference.
   */
  bootGraph(): Promise<{ graph: WebBootGraph; themePreference: DesktopThemePreference }>
  /**
   * Read one packaged client bundle by graph id.
   * @param id - `dsh.client` package id from the graph; never a filesystem path.
   * @returns UTF-8 factory source.
   */
  readPlugin(id: string): Promise<string>
}

const PLUGIN_PREFIX = '/plugins/'
const PLUGIN_SUFFIX = '/client.js'

/**
 * Parse `/plugins/<id>/client.js?rev=…` into the graph package id.
 * @param url - bundle URL from the boot graph.
 * @returns the package id, which may contain slashes.
 */
export function pluginIdFromUrl(url: string): string {
  const path = new URL(url, 'http://dsh.internal').pathname
  if (!path.startsWith(PLUGIN_PREFIX) || !path.endsWith(PLUGIN_SUFFIX)) {
    throw new Error(`desktop boot: unrecognized plugin URL ${url}`)
  }
  const id = path.slice(PLUGIN_PREFIX.length, -PLUGIN_SUFFIX.length)
  if (id === '') throw new Error(`desktop boot: unrecognized plugin URL ${url}`)
  return id
}

/**
 * Evaluate one Host-authored client factory the same way jsdom assembled boot does.
 * @param url - graph bundle URL.
 * @param readPlugin - IPC reader for packaged bytes.
 */
export async function loadDesktopBundle(
  url: string,
  readPlugin: (id: string) => Promise<string>,
): Promise<void> {
  const code = await readPlugin(pluginIdFromUrl(url))
  ;(0, eval)(code)
}

/**
 * Write the pre-plugin palette the same way ui-theme's index tap does, without importing it.
 * @param preference - durable built-in preference from the Host.
 */
export function applyBootTheme(preference: DesktopThemePreference): void {
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
}

/**
 * Desktop AppWebEntry boot: install the ModuleLoader facade, parser-preload
 * modules and runtime, set `window.__DSH_BOOT__`, apply theme, then `create()`.
 * @param el - `#root` mount point.
 * @param host - preload control face.
 * @returns the running shell entry.
 */
export async function runDesktopBoot(el: HTMLElement, host: DesktopRendererHost): Promise<AppWebEntry> {
  const { graph, themePreference } = await host.bootGraph()
  const win = window as DshWindow
  win.__DSH_BOOT__ = graph
  applyBootTheme(themePreference)
  installBootstrapFacade()
  for (const id of PARSER_PRELOAD_IDS) {
    const row = graph.entries.find(entry => entry.id === id)
    if (row === undefined) {
      throw new Error(`desktop boot: Host graph is missing parser-preload row ${id}`)
    }
    await loadDesktopBundle(row.url, pluginId => host.readPlugin(pluginId))
  }
  const entry = new AppWebEntry(el, {
    loadBundle: url => loadDesktopBundle(url, id => host.readPlugin(id)),
  })
  await entry.run()
  return entry
}
