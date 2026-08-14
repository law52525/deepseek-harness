/**
 * Built-artifact proof that a Node boot of the desktop profile composes the
 * client graph without HTTP. Self-skips until `pnpm run build` emits client
 * bundles (the e2e lane runs unbuilt).
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-desktop-app'

/** Host-side clientModules face used without importing the client-half package. */
interface ClientModulesHost {
  graph(): { entries: { id: string; immediately?: boolean }[] }
  clientPath(id: string): string | undefined
}

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const MODULES_CLIENT = join(REPO_ROOT, 'packages/client/modules/lib/client.js')
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const DESKTOP_PATCH = join(REPO_ROOT, 'packages/bundle/desktop-app/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
const CONFIG_DIR = join(REPO_ROOT, 'apps/cli/config')

/** Immediately-tier `dsh.client` packages the web roster also prefetches, minus HMR. */
const IMMEDIATE_PACKAGES = [
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-api-remotes',
] as const

describe.skipIf(!existsSync(MODULES_CLIENT))('desktop profile Host graph (built client bundles)', () => {
  let ctx: Context

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-graph-'))
    const settingsFile = join(home, 'settings.yaml')
    await writeFile(settingsFile, '{}\n')
    const storageRoot = join(home, 'storages')
    const patches: PatchOptions[] = [
      ...loadOverlayPatches('dsh-test', BASE_PATCH),
      ...loadOverlayPatches('dsh-test', DESKTOP_PATCH),
      { id: 'settings', config: { path: settingsFile, watch: false } },
      { id: 'storage-json', config: { root: storageRoot } },
      { id: 'session-telemetry-otel', disabled: true },
      {
        id: 'agent-presets',
        config: {
          default: 'standard',
          roots: [{ path: join(CONFIG_DIR, 'agent-presets'), trust: 'system' }],
          includeUserRoot: false,
        },
      },
    ]
    healProfilesModuleFallback(INSTALL_ANCHOR, home)
    const profileDir = join(home, 'profiles', 'desktop')
    await mkdir(profileDir, { recursive: true })
    const rootConfig = join(profileDir, 'cordis.yml')
    await writeFile(rootConfig, '[]\n')
    ctx = await boot('dsh-test', rootConfig, patches, (bootCtx) => {
      provideCmdline(bootCtx, { args: [], exit: () => {} })
    })
  }, 120_000)

  afterAll(async () => {
    await ctx?.fiber.dispose()
  })

  it('provides a complete immediately-tier graph without a webServer', () => {
    expect(ctx.get('webServer')).toBeUndefined()
    expect(ctx.desktopRuntime).toEqual({ surface: 'desktop' })
    const modules = ctx.get('clientModules') as ClientModulesHost
    const graph = modules.graph()
    const immediate = new Set(
      graph.entries.filter(entry => entry.immediately === true).map(entry => entry.id),
    )
    expect([...immediate].sort()).toEqual([...IMMEDIATE_PACKAGES].sort())
    for (const id of IMMEDIATE_PACKAGES) {
      const path = modules.clientPath(id)
      expect(path, id).toBeDefined()
      expect(existsSync(path!), id).toBe(true)
    }
  })
})
