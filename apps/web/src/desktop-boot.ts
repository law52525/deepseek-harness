/**
 * Desktop renderer boot: inject the Host graph, apply the pre-plugin theme,
 * and load plugin factories through BootSeams instead of `<script src>`.
 */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'

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
 * Desktop AppWebEntry boot: set `window.__DSH_BOOT__`, apply theme, load via IPC.
 * @param el - `#root` mount point.
 * @param host - preload control face.
 * @returns the running shell entry.
 */
export async function runDesktopBoot(el: HTMLElement, host: DesktopRendererHost): Promise<AppWebEntry> {
  const { graph, themePreference } = await host.bootGraph()
  ;(window as Window & { __DSH_BOOT__?: WebBootGraph }).__DSH_BOOT__ = graph
  applyBootTheme(themePreference)
  const entry = new AppWebEntry(el, {
    loadBundle: url => loadDesktopBundle(url, id => host.readPlugin(id)),
  })
  await entry.run()
  return entry
}
