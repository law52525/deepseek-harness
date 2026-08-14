import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findSymlink, materializeStagedLinks, preservePnpmWorkspaceState } from './stage-runtime-closure.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('stage-runtime-closure', () => {
  it('replaces package symlinks with copied files and drops .bin links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-stage-'))
    roots.push(root)
    const nodeModules = join(root, 'node_modules')
    const realPkg = join(root, 'real-pkg')
    mkdirSync(join(realPkg, 'lib'), { recursive: true })
    writeFileSync(join(realPkg, 'lib', 'index.js'), 'export default 1\n')
    mkdirSync(join(nodeModules, '.bin'), { recursive: true })
    mkdirSync(join(nodeModules, '@scope'), { recursive: true })
    symlinkSync(realPkg, join(nodeModules, '@scope', 'pkg'))
    symlinkSync(join(realPkg, 'lib', 'index.js'), join(nodeModules, '.bin', 'pkg'))

    expect(await findSymlink(nodeModules)).toBeDefined()
    await materializeStagedLinks(nodeModules, false, 'test')
    expect(await findSymlink(nodeModules)).toBeUndefined()
    expect(readFileSync(join(nodeModules, '@scope', 'pkg', 'lib', 'index.js'), 'utf8')).toBe('export default 1\n')
  })

  it('restores pnpm workspace state after the action rewrites it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-state-'))
    roots.push(root)
    const path = join(root, 'node_modules', '.pnpm-workspace-state-v1.json')
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    writeFileSync(path, '{"settings":{"production":false,"dev":true}}\n')
    await preservePnpmWorkspaceState(root, false, 'test', async () => {
      writeFileSync(path, '{"settings":{"production":true,"dev":false}}\n')
    })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ settings: { production: false, dev: true } })
  })
})
