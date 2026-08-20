/**
 * Desktop renderer boot: inject the Host graph, apply the pre-plugin theme,
 * and load plugin factories through BootSeams instead of `<script src>`.
 *
 * rc.8 moved the web boot protocol to a `window.__ModuleLoader__` facade that
 * the HTTP index tap installs. The desktop Host has no webserver, so this file
 * installs the same queue-mode facade itself and preloads the two bootstrap
 * bundles (modules + runtime) through the IPC transport before `AppWebEntry`
 * calls `facade.create(...)`.
 */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import type {
  ClientBundleRegistration, ClientModuleCreateOptions, ClientModuleLoaderTarget, ClientModuleSystem, WebBootGraph,
} from '@deepseek-ai/dsh-client-modules/client'

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

/** Bootstrap package whose client bundle supplies the module-system implementation. */
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

/** Dynamic package whose client bundle must be registered before plugin boot starts. */
const CLIENT_RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

/** Stage-one bootstrap bundles, in the same order the HTTP index tap preloads them. */
const BOOTSTRAP_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID] as const

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
 * Install the queue-mode module-loader facade the web boot protocol expects.
 * It mirrors `injectBootManifest`'s inline script: `load` queues early bundle
 * registrations, and `create` materializes the preloaded modules bundle and
 * hands it to its `createClientModuleSystem` export.
 * @returns the facade installed on `window.__ModuleLoader__`.
 */
function installModuleLoaderFacade(): ClientModuleLoaderTarget {
  const pendingQueue: ClientBundleRegistration[] = []
  const facade: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load(registration) {
      pendingQueue.push(registration)
    },
    create(options: ClientModuleCreateOptions): ClientModuleSystem {
      if (facade.mode !== 'queue') {
        throw new Error('client-modules: window.__ModuleLoader__.create called after module-system boot')
      }
      const index = pendingQueue.findIndex(registration => registration.id === CLIENT_MODULES_ID)
      const registration = pendingQueue[index]
      if (registration === undefined) {
        throw new Error(`client-modules: desktop did not preload ${CLIENT_MODULES_ID}/client.js`)
      }
      pendingQueue.splice(index, 1)
      const exports = registration.factory((specifier) => {
        throw new Error(`client-modules: ${CLIENT_MODULES_ID}/client.js requested external "${specifier}" before the module system existed`)
      })
      if (typeof exports !== 'object' || exports === null
        || typeof (exports as { createClientModuleSystem?: unknown }).createClientModuleSystem !== 'function'
        || typeof (exports as { apply?: unknown }).apply !== 'function') {
        throw new Error(`client-modules: ${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face`)
      }
      const face = exports as unknown as {
        createClientModuleSystem: (
          target: ClientModuleLoaderTarget,
          bootstrapModule: { id: string; exports: Record<string, unknown> },
          options: ClientModuleCreateOptions,
        ) => ClientModuleSystem
        apply: (ctx: unknown) => void
      }
      return face.createClientModuleSystem(facade, { id: registration.id, exports }, options)
    },
  }
  return facade
}

/**
 * Preload the stage-one bootstrap bundles so their factories are queued before
 * `AppWebEntry` calls `facade.create(...)`.
 * @param graph - composed boot graph.
 * @param loadBundle - IPC bundle transport.
 */
async function preloadBootstrapBundles(
  graph: WebBootGraph,
  loadBundle: (url: string) => Promise<void>,
): Promise<void> {
  for (const id of BOOTSTRAP_PRELOAD_IDS) {
    const entry = graph.entries.find(entry => entry.id === id)
    if (entry !== undefined) await loadBundle(entry.url)
  }
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
 * Desktop AppWebEntry boot: install the module-loader facade, preload the
 * bootstrap bundles, set `window.__DSH_BOOT__`, apply theme, and boot via IPC.
 * @param el - `#root` mount point.
 * @param host - preload control face.
 * @returns the running shell entry.
 */
export async function runDesktopBoot(el: HTMLElement, host: DesktopRendererHost): Promise<AppWebEntry> {
  const { graph, themePreference } = await host.bootGraph()
  const loadBundle = (url: string): Promise<void> => loadDesktopBundle(url, id => host.readPlugin(id))
  ;(window as Window & { __ModuleLoader__?: ClientModuleLoaderTarget }).__ModuleLoader__ = installModuleLoaderFacade()
  await preloadBootstrapBundles(graph, loadBundle)
  ;(window as Window & { __DSH_BOOT__?: WebBootGraph }).__DSH_BOOT__ = graph
  applyBootTheme(themePreference)
  const entry = new AppWebEntry(el, { loadBundle })
  await entry.run()
  return entry
}
