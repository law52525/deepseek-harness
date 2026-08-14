import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installerCliArgv,
  packedResourcesCandidates,
  packagerTarget,
} from './build-desktop-installer.ts'

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
