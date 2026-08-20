/**
 * Verify that each executable deploy manifest supplies every required workspace
 * peer in its dependency graph, and that the Python SDK runtime manifest
 * supplies every plugin referenced by a shipped agent preset. With auto peer
 * installation disabled, either omission can otherwise fail only when Cordis
 * loads the packaged plugin.
 */

import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { isCordisGroupEntry, loadCordisYaml } from './cordis-yaml.ts'
import {
  inspectRuntimeClosure,
  loadManifest,
  loadWorkspacePackages,
  RUNTIME_CLOSURE_MANIFESTS,
} from './runtime-closure.ts'

const repoRoot = resolve(import.meta.dirname, '..')

const AGENT_PRESET_GLOB = 'apps/cli/config/agent-presets/*/agent.cordis.yml'

interface RuntimePlatform {
  tag: string
  executable: string
}

type RuntimePlatformManifest = Record<string, RuntimePlatform>

/** Result of one deploy-root closure inspection. */
export interface RuntimeClosureResult {
  failures: string[]
  presetCount: number
  workspacePackageCount: number
}

/** Agent-preset closure result: failures plus the number of discovered presets. */
interface PresetClosureResult {
  failures: string[]
  presetCount: number
}

/**
 * Check one deploy-root manifest (defaulting to the Python SDK runtime) against
 * the workspace peer graph and the shipped agent presets.
 * @param root - repository root.
 * @param manifestPath - runtime manifest path relative to {@link root}.
 * @returns discovered preset count, reachable workspace package count, and violations.
 */
export async function verifyRuntimeClosure(
  root: string,
  manifestPath = 'python/sdk-runtime/package.json',
): Promise<RuntimeClosureResult> {
  const runtimeManifest = await loadManifest(resolve(root, manifestPath))
  const runtimeName = runtimeManifest.name ?? manifestPath
  const runtimeDependencies = runtimeManifest.dependencies ?? {}
  const workspace = await loadWorkspacePackages(root)
  const inspection = inspectRuntimeClosure(runtimeName, runtimeDependencies, workspace)
  const preset = await missingPresetPlugins(root, runtimeDependencies)
  return {
    failures: [...inspection.failures, ...preset.failures],
    presetCount: preset.presetCount,
    workspacePackageCount: inspection.packages.length,
  }
}

/**
 * Check one or more deploy-root manifests and exit 1 on the first missing peer.
 * @param manifestRels - repository-relative package.json paths.
 */
export async function verifyRuntimeClosures(manifestRels: readonly string[]): Promise<void> {
  const workspace = await loadWorkspacePackages(repoRoot)
  let failed = false
  for (const relative of manifestRels) {
    const runtimeManifestPath = resolve(repoRoot, relative)
    const runtimeManifest = await loadManifest(runtimeManifestPath)
    const runtimeName = runtimeManifest.name ?? relative
    const runtimeDependencies = runtimeManifest.dependencies ?? {}
    const inspection = inspectRuntimeClosure(runtimeName, runtimeDependencies, workspace)
    const presetFailures = relative === 'python/sdk-runtime/package.json'
      ? (await missingPresetPlugins(repoRoot, runtimeDependencies)).failures
      : []
    if (inspection.failures.length > 0 || presetFailures.length > 0) {
      failed = true
      if (inspection.failures.length > 0) {
        console.error(`verify-runtime-closure: required workspace peers are missing from ${relative} dependencies:`)
        for (const failure of inspection.failures) console.error(`  ${failure}`)
      }
      for (const failure of presetFailures) console.error(`  ${failure}`)
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

/**
 * Verify that every shipped agent preset's active bare plugin packages are
 * listed as `workspace:` dependencies of the Python SDK runtime manifest.
 * @param root - repository root.
 * @param runtimeDependencies - the Python SDK deploy root `dependencies` map.
 * @returns discovered preset count and the preset/target chains whose plugins are missing or non-workspace.
 */
async function missingPresetPlugins(
  root: string,
  runtimeDependencies: Readonly<Record<string, string>>,
): Promise<PresetClosureResult> {
  const failures: string[] = []
  const platforms = await loadJson<RuntimePlatformManifest>(resolve(root, 'python/sdk-runtime/platforms.json'))
  const targets = Object.keys(platforms).sort()
  const presetPaths = globSync(AGENT_PRESET_GLOB, { cwd: root }).sort()
  if (presetPaths.length === 0) failures.push(`no agent presets matched ${AGENT_PRESET_GLOB}`)
  if (targets.length === 0) failures.push('python/sdk-runtime/platforms.json defines no runtime targets')
  const missing = new Map<string, Set<string>>()
  for (const presetPath of presetPaths) {
    const document = loadCordisYaml(await readFile(resolve(root, presetPath), 'utf8'))
    if (!Array.isArray(document)) {
      failures.push(`${presetPath}: preset root must be a Loader entry array`)
      continue
    }
    for (const target of targets) {
      const processPlatform = processPlatformForTarget(target)
      for (const plugin of activeBarePluginPackages(document, processPlatform)) {
        const version = runtimeDependencies[plugin]
        if (version?.startsWith('workspace:') === true) continue
        const preset = basename(dirname(presetPath))
        const declaration = version === undefined
          ? ''
          : ` [runtime dependency is ${JSON.stringify(version)}; expected workspace:]`
        const key = `${preset} preset -> ${plugin}${declaration}`
        const missingTargets = missing.get(key) ?? new Set<string>()
        missingTargets.add(target)
        missing.set(key, missingTargets)
      }
    }
  }
  failures.push(...[...missing.entries()].map(([chain, missingTargets]) =>
    `${chain} (${[...missingTargets].sort().join(', ')})`))
  return { failures, presetCount: presetPaths.length }
}

function activeBarePluginPackages(entries: unknown[], processPlatform: string): Set<string> {
  const packages = new Set<string>()
  const visit = (value: unknown, parentDisabled: boolean): void => {
    if (!isRecord(value)) return
    const disabled = parentDisabled || disabledOnPlatform(value.disabled, processPlatform)
    if (disabled) return
    if (typeof value.name === 'string') {
      const packageName = barePackageName(value.name)
      if (packageName !== undefined) packages.add(packageName)
    }
    if (isCordisGroupEntry(value)) {
      for (const child of value.config) visit(child, disabled)
    }
  }
  for (const entry of entries) visit(entry, false)
  return packages
}

function disabledOnPlatform(value: unknown, processPlatform: string): boolean {
  if (typeof value === 'boolean') return value
  if (!isRecord(value) || typeof value.__jsExpr !== 'string') return false
  const match = /^process\.platform\s*(===|!==)\s*(['"])(win32|linux|darwin)\2$/.exec(value.__jsExpr.trim())
  if (match === null) return false
  const [, operator, , expected] = match
  return operator === '===' ? processPlatform === expected : processPlatform !== expected
}

function processPlatformForTarget(target: string): string {
  if (target.startsWith('linux-')) return 'linux'
  if (target.startsWith('macos-')) return 'darwin'
  throw new Error(`verify-runtime-closure: unsupported runtime target ${JSON.stringify(target)}`)
}

function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) return undefined
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  }
  return parts[0] || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
