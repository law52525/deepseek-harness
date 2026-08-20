/**
 * Closed-runtime dependency walk shared by the Python exe and desktop installer
 * deploy roots. A missing required workspace peer fails only when Cordis loads
 * the packaged plugin unless the deploy manifest lists it.
 */

import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

export interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

/** One deploy-root walk: reachable workspace packages plus missing required peers. */
export interface RuntimeClosureInspection {
  /** Workspace packages reached from the deploy root's declared dependencies. */
  packages: string[]
  /** `root -> … -> missingPeer` lines for required workspace peers not listed at the root. */
  failures: string[]
}

/** Deploy-root manifests whose required workspace peers hygiene checks. */
export const RUNTIME_CLOSURE_MANIFESTS = [
  'python/sdk-runtime/package.json',
  'desktop-runtime/package.json',
] as const

/**
 * Load every workspace package the closure walk can name as a peer or dependency.
 * @param root - repository root.
 * @returns packages keyed by manifest name.
 */
export async function loadWorkspacePackages(root: string): Promise<Map<string, WorkspacePackage>> {
  const paths = globSync(
    ['packages/*/*/package.json', 'vendor/*/package.json', 'apps/*/package.json'],
    { cwd: root },
  )
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, WorkspacePackage>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

/**
 * Read one package.json.
 * @param path - absolute manifest path.
 * @returns the parsed manifest.
 */
export async function loadManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

/**
 * Walk a deploy root's declared dependencies and collect missing required peers.
 * @param runtimeName - deploy-root package name, used in failure chains.
 * @param runtimeDependencies - the deploy root `dependencies` map.
 * @param workspace - packages keyed by name.
 * @returns reachable workspace packages and missing-peer chains.
 */
export function inspectRuntimeClosure(
  runtimeName: string,
  runtimeDependencies: Record<string, string>,
  workspace: ReadonlyMap<string, WorkspacePackage>,
): RuntimeClosureInspection {
  const parents = new Map<string, string | undefined>()
  const packages: string[] = []
  for (const dependency of Object.keys(runtimeDependencies).sort()) {
    if (!workspace.has(dependency)) continue
    parents.set(dependency, undefined)
    packages.push(dependency)
  }
  const failures: string[] = []
  for (let index = 0; index < packages.length; index += 1) {
    const packageName = packages[index]
    if (packageName === undefined) continue
    const current = workspace.get(packageName)
    if (current === undefined) continue
    const peers = current.manifest.peerDependencies ?? {}
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    for (const peer of Object.keys(peers).sort()) {
      if (!workspace.has(peer) || peerMeta[peer]?.optional === true) continue
      if (runtimeDependencies[peer]?.startsWith('workspace:') === true) continue
      failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${peer}`)
    }
    const dependencies = {
      ...current.manifest.dependencies,
      ...current.manifest.optionalDependencies,
    }
    for (const dependency of Object.keys(dependencies).sort()) {
      if (!workspace.has(dependency) || parents.has(dependency)) continue
      parents.set(dependency, packageName)
      packages.push(dependency)
    }
  }
  return { packages, failures }
}

/**
 * Every workspace package a set of seeds pulls, including required peers.
 * @param seeds - package names to start from.
 * @param workspace - packages keyed by name.
 * @returns sorted unique names.
 */
export function closedWorkspacePackages(
  seeds: readonly string[],
  workspace: ReadonlyMap<string, WorkspacePackage>,
): string[] {
  const seen = new Set<string>()
  const queue = [...seeds.filter(seed => workspace.has(seed))]
  for (const seed of queue) seen.add(seed)
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    if (packageName === undefined) continue
    const current = workspace.get(packageName)
    if (current === undefined) continue
    const peers = current.manifest.peerDependencies ?? {}
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    const next = {
      ...current.manifest.dependencies,
      ...current.manifest.optionalDependencies,
    }
    for (const peer of Object.keys(peers).sort()) {
      if (peerMeta[peer]?.optional === true) continue
      next[peer] = current.manifest.peerDependencies?.[peer] ?? '*'
    }
    for (const dependency of Object.keys(next).sort()) {
      if (!workspace.has(dependency) || seen.has(dependency)) continue
      seen.add(dependency)
      queue.push(dependency)
    }
  }
  return [...seen].sort()
}

function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}
