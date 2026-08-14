/**
 * Verify that each executable deploy manifest supplies every required workspace
 * peer in its dependency graph. With auto peer installation disabled, a missing
 * root peer can otherwise fail only when Cordis loads the packaged plugin.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  inspectRuntimeClosure,
  loadManifest,
  loadWorkspacePackages,
  RUNTIME_CLOSURE_MANIFESTS,
} from './runtime-closure.ts'

const root = resolve(import.meta.dirname, '..')

/**
 * Check one or more deploy-root manifests and exit 1 on the first missing peer.
 * @param manifestRels - repository-relative package.json paths.
 */
export async function verifyRuntimeClosures(manifestRels: readonly string[]): Promise<void> {
  const workspace = await loadWorkspacePackages(root)
  let failed = false
  for (const relative of manifestRels) {
    const runtimeManifestPath = resolve(root, relative)
    const runtimeManifest = await loadManifest(runtimeManifestPath)
    const runtimeName = runtimeManifest.name ?? relative
    const inspection = inspectRuntimeClosure(runtimeName, runtimeManifest.dependencies ?? {}, workspace)
    if (inspection.failures.length > 0) {
      failed = true
      console.error(`verify-runtime-closure: required workspace peers are missing from ${relative} dependencies:`)
      for (const failure of inspection.failures) console.error(`  ${failure}`)
      continue
    }
    console.log(
      `verify-runtime-closure: ${relative}: ${inspection.packages.length} workspace packages form a closed runtime dependency graph.`,
    )
  }
  if (failed) process.exit(1)
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { manifest: { type: 'string', multiple: true } },
    allowPositionals: false,
  })
  const manifests = values.manifest !== undefined && values.manifest.length > 0
    ? values.manifest
    : [...RUNTIME_CLOSURE_MANIFESTS]
  await verifyRuntimeClosures(manifests)
}
