import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertTreeHasNoSymlinks,
  installerCliArgv,
  packedResourcesCandidates,
  packagerTarget,
} from './build-desktop-installer.ts'
import { packageBinInvocation } from './stage-runtime-closure.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

function posixJsBin(args: readonly string[]): string {
  const entry = args[0]
  if (entry === undefined) throw new Error('expected a JS bin path')
  expect(entry).not.toMatch(/\.cmd$/i)
  return entry.replaceAll('\\', '/')
}

describe('desktop installer packager target', () => {
  it('selects macOS arm64 and Windows x64 and rejects other hosts', () => {
    expect(packagerTarget('darwin', 'arm64')).toEqual({ os: 'mac', arch: 'arm64' })
    expect(packagerTarget('win32', 'x64')).toEqual({ os: 'win', arch: 'x64' })
    expect(() => packagerTarget('darwin', 'x64')).toThrow(/macOS arm64/)
    expect(() => packagerTarget('linux', 'x64')).toThrow(/Windows x64/)
  })
})

describe('desktop installer CLI argv', () => {
  it('drops a lone -- so pnpm run forwards flags', () => {
    expect(installerCliArgv(['--', '--skip-build'])).toEqual(['--skip-build'])
    expect(installerCliArgv(['--skip-packager'])).toEqual(['--skip-packager'])
  })
})

describe('profile template symlink assertion', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('accepts a materialized tree and rejects leftover symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-template-links-'))
    roots.push(root)
    mkdirSync(join(root, 'node_modules', 'leftpad'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"name":"dsh-profile-desktop"}\n')
    writeFileSync(join(root, 'node_modules', 'leftpad', 'index.js'), 'module.exports = 1\n')
    expect(() => assertTreeHasNoSymlinks(root)).not.toThrow()
    symlinkSync(join(root, 'package.json'), join(root, 'link.json'))
    expect(() => assertTreeHasNoSymlinks(root)).toThrow(/still has symlinks/)
  })
})

describe('packed extraResources locations', () => {
  it('names the unpacked Resources directory for each host target', () => {
    const dist = '/tmp/desktop-dist'
    expect(packedResourcesCandidates(dist, { os: 'mac', arch: 'arm64' }, 'DeepSeek Harness')).toEqual([
      join(dist, 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'Resources'),
    ])
    expect(packedResourcesCandidates(dist, { os: 'win', arch: 'x64' }, 'DeepSeek Harness')).toEqual([
      join(dist, 'win-unpacked', 'resources'),
      join(dist, 'win-x64-unpacked', 'resources'),
    ])
  })
})

describe('desktop installer tool spawn', () => {
  it('runs tsx and electron-builder through node and their JS bins', () => {
    const tsx = packageBinInvocation(join(root, 'package.json'), 'tsx', 'tsx', [
      'scripts/verify-runtime-closure.ts',
    ])
    expect(tsx.command).toBe(process.execPath)
    expect(posixJsBin(tsx.args)).toMatch(/tsx\/dist\/cli\.mjs$/)

    const builder = packageBinInvocation(
      join(root, 'apps/desktop/package.json'),
      'electron-builder',
      'electron-builder',
      ['--publish', 'never'],
    )
    expect(builder.command).toBe(process.execPath)
    expect(posixJsBin(builder.args)).toMatch(/electron-builder\/cli\.js$/)
  })
})
