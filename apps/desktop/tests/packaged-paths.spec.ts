/** Packaged extraResource layout wins over system Node and workspace resolution. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveBundledDshBin,
  resolveBundledFrontendDist,
  resolveBundledNode,
} from '../src/packaged-resources.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('packaged resources', () => {
  it('resolves bundled Node, dsh bin, and frontend dist from extraResources', () => {
    const resources = mkdtempSync(join(tmpdir(), 'dsh-desktop-res-'))
    roots.push(resources)
    const host = join(resources, 'host')
    const frontend = join(resources, 'frontend')
    mkdirSync(join(host, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    mkdirSync(frontend, { recursive: true })
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
    writeFileSync(join(host, nodeName), '')
    writeFileSync(join(host, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '')
    writeFileSync(join(frontend, 'index.html'), '<html></html>')

    const processLike = { resourcesPath: resources, platform: process.platform }
    expect(resolveBundledNode(processLike)).toBe(join(host, nodeName))
    expect(resolveBundledDshBin(processLike)).toBe(join(host, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    expect(resolveBundledFrontendDist(processLike)).toBe(frontend)
  })

  it('returns undefined when extraResources are absent', () => {
    const processLike = { platform: process.platform }
    expect(resolveBundledNode(processLike)).toBeUndefined()
    expect(resolveBundledDshBin(processLike)).toBeUndefined()
    expect(resolveBundledFrontendDist(processLike)).toBeUndefined()
  })
})
