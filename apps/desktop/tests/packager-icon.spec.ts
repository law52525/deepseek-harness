/** electron-builder uses a committed 1024 PNG so Mac/Windows packs are not the default Electron icon. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(import.meta.dirname, '..')
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('desktop packager icon', () => {
  it('points electron-builder at a 1024 PNG of the Harness mark', () => {
    const yml = readFileSync(resolve(desktopRoot, 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/^icon: resources\/icon\.png$/m)

    const png = readFileSync(resolve(desktopRoot, 'resources', 'icon.png'))
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC)
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
  })
})
