/**
 * @deepseek-ai/dsh-desktop-app — the desktop-surface bundle's runtime glue
 * plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin registers the harness-source
 * prompt section when `surfaceContext` is true and provides `desktopRuntime`
 * with no bind address. App command-line acceptance arrives through the
 * `desktopStartup` service expression in the bundle patch.
 * @module @deepseek-ai/dsh-desktop-app
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Runtime service that marks the desktop Host as settled with no bind address. */
const DESKTOP_RUNTIME_SERVICE = 'desktopRuntime'

/** Plugin config: composed deployment settings. */
export interface Config {
  /**
   * Register the model-visible harness-source prompt section. A one-shot
   * non-interactive layer can turn it off when its user is not in the GUI.
   */
  surfaceContext: boolean
}

export const Config: z<Config> = z.object({
  surfaceContext: z.boolean().default(true),
})

/** Desktop Host marker shared by later shell wiring; carries no bind address. */
export interface DesktopRuntimeValues {
  /** Discriminator for this Host surface. */
  surface: 'desktop'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desktop Host marker; absent until desktop-startup accepts the invocation. */
    desktopRuntime: DesktopRuntimeValues
  }
}

/**
 * Mount the desktop runtime: harness-source prompt and the surface marker.
 * @param ctx - plugin context after desktopStartup is provided.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide(DESKTOP_RUNTIME_SERVICE, { surface: 'desktop' } satisfies DesktopRuntimeValues)
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      addHarnessSourceSection(promptCtx, SOURCE_ROOT)
    })
  }
}
