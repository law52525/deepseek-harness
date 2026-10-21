import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, loadConfigFromFile } from 'vite'
import { expect, it, onTestFinished, vi } from 'vitest'
import { resolveClientBuildEnvironment } from '../../../scripts/client-build-environment.ts'

const CONFIG_PATH = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const PUBLIC_MANIFEST_PATH = fileURLToPath(new URL('../public/manifest.webmanifest', import.meta.url))

it('bakes DSH_DESKTOP_PRODUCT_NAME into the document title and PWA manifest', async () => {
  vi.stubEnv('DSH_BUILD_CLIENT_PROFILE', 'official')
  vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
  vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
  vi.stubEnv('DSH_DESKTOP_PRODUCT_NAME', 'Wandox Work')
  onTestFinished(() => { vi.unstubAllEnvs() })

  // Exactly the values scripts/build.ts overlays on the web build for the official profile.
  const clientEnvironment = resolveClientBuildEnvironment(process.env)
  expect(clientEnvironment.DSH_CLIENT_TITLE).toBe('Wandox Work')
  for (const [name, value] of Object.entries(clientEnvironment)) vi.stubEnv(name, value)

  // Vite canonicalizes its root, so a symlinked temp path would place the HTML entry outside it.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-manifest-brand-')))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'public'), { recursive: true })
  await writeFile(join(root, 'public', 'manifest.webmanifest'), await readFile(PUBLIC_MANIFEST_PATH))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>DSH Local Build</title></head><body></body></html>')

  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, CONFIG_PATH)
  if (!loaded) throw new Error('Expected the Web build configuration')
  const plugins = (loaded.config.plugins ?? []).flat().filter(plugin => plugin && typeof plugin === 'object'
    && 'name' in plugin && (plugin.name === 'dsh-client-document-title' || plugin.name === 'dsh-client-manifest-brand'))
  await build({ configFile: false, plugins, root, logLevel: 'silent', build: { outDir: 'dist' } })

  expect(await readFile(join(root, 'dist', 'index.html'), 'utf8')).toContain('<title>Wandox Work</title>')
  const manifest: unknown = JSON.parse(await readFile(join(root, 'dist', 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toMatchObject({ name: 'Wandox Work', short_name: 'Wandox', start_url: './' })
})
