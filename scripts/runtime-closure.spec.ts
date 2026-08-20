import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  closedWorkspacePackages,
  inspectRuntimeClosure,
  type PackageManifest,
  type WorkspacePackage,
} from './runtime-closure.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function pkg(name: string, manifest: PackageManifest): [string, WorkspacePackage] {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-closure-'))
  roots.push(dir)
  const path = join(dir, 'package.json')
  writeFileSync(path, JSON.stringify({ name, ...manifest }))
  return [name, { path, manifest: { name, ...manifest } }]
}

function peerGraph(): Map<string, WorkspacePackage> {
  return new Map([
    pkg('root-seed', { dependencies: { 'leaf-pkg': 'workspace:^' } }),
    pkg('leaf-pkg', { peerDependencies: { 'peer-pkg': 'workspace:^' } }),
    pkg('peer-pkg', {}),
  ])
}

describe('runtime closure', () => {
  it('reports a required workspace peer missing from the deploy root', () => {
    const inspection = inspectRuntimeClosure('deploy', { 'root-seed': 'workspace:^' }, peerGraph())
    expect(inspection.failures).toEqual(['deploy -> root-seed -> leaf-pkg -> peer-pkg'])
  })

  it('accepts a closed graph when required peers are listed at the root', () => {
    const inspection = inspectRuntimeClosure(
      'deploy',
      { 'root-seed': 'workspace:^', 'peer-pkg': 'workspace:^' },
      peerGraph(),
    )
    expect(inspection.failures).toEqual([])
    expect(inspection.packages).toEqual(['peer-pkg', 'root-seed', 'leaf-pkg'])
  })

  it('collects seeds, dependencies, and required peers into a closed set', () => {
    const workspace = new Map([
      pkg('seed', { dependencies: { 'dep-pkg': 'workspace:^' }, peerDependencies: { 'peer-pkg': 'workspace:^' } }),
      pkg('dep-pkg', { optionalDependencies: { 'opt-pkg': 'workspace:^' } }),
      pkg('opt-pkg', {}),
      pkg('peer-pkg', {}),
      pkg('unrelated', {}),
    ])
    expect(closedWorkspacePackages(['seed'], workspace)).toEqual(['dep-pkg', 'opt-pkg', 'peer-pkg', 'seed'])
  })
})
