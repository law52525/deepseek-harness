import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { BRAND_PATHS, deriveBrandIcons, WINDOWS_APP_ICO_SIZES } from '../scripts/derive-brand-icons.ts'
import { deriveInstallerBrand } from '../scripts/derive-installer-brand.ts'
import { TRAY_ICON_SIZES, unpackIco } from '../scripts/render-tray-icon.ts'

type Rgba = readonly [number, number, number, number]

const INK: Rgba = [17, 18, 22, 255]
const BLUE: Rgba = [77, 107, 254, 255]
const WHITE: Rgba = [255, 255, 255, 255]
const TRANSPARENT: Rgba = [0, 0, 0, 0]
const SIDEBAR_BG: Rgba = [244, 244, 245, 255]
const BRAND_DIR = fileURLToPath(new URL('../brand', import.meta.url))

/** The exact committed derived set, in readdir order. */
const DERIVED_FILES = [
  'icon-macos.png',
  'icon-windows.ico',
  'icon-windows.png',
  'icon-windows.svg',
  'installer-brand-2x.png',
  'installer-brand-dark-2x.png',
  'installer-brand-dark.png',
  'installer-brand.png',
  'tray-windows.ico',
  'uninstaller-sidebar.bmp',
  'uninstaller-sidebar.png',
  'welcome-brand.svg',
] as const

let stage: string

beforeAll(async () => {
  stage = mkdtempSync(join(tmpdir(), 'brand-derive-'))
  await deriveBrandIcons(stage)
  await deriveInstallerBrand(stage)
}, 120_000)

afterAll(() => {
  rmSync(stage, { recursive: true, force: true })
})

function staged(name: string): Buffer {
  return readFileSync(join(stage, name))
}

function committed(name: string): Buffer {
  return readFileSync(join(BRAND_PATHS.derived, name))
}

function close(actual: Rgba, expected: Rgba): boolean {
  return actual.every((channel, index) => Math.abs(channel - expected[index]!) <= 3)
}

async function pixel(png: Buffer, x: number, y: number): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
}

/** True when some pixel in the region and its whole 3x3 neighbourhood carry the wanted colour. */
async function findSolid(
  png: Buffer,
  region: readonly [number, number, number, number],
  rgb: readonly [number, number, number],
): Promise<boolean> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const [x0, y0, x1, y1] = region
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      let solid = true
      for (let dy = -1; dy <= 1 && solid; dy += 1) {
        for (let dx = -1; dx <= 1 && solid; dx += 1) {
          const i = ((y + dy) * info.width + (x + dx)) * 4
          solid = data[i] === rgb[0] && data[i + 1] === rgb[1] && data[i + 2] === rgb[2]
        }
      }
      if (solid) return true
    }
  }
  return false
}

function bmpPixel(bmp: Buffer, x: number, y: number): Rgba {
  const width = bmp.readInt32LE(18)
  const height = bmp.readInt32LE(22)
  const offset = bmp.readUInt32LE(10)
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const at = offset + (height - 1 - y) * rowStride + x * 3
  return [bmp[at + 2]!, bmp[at + 1]!, bmp[at]!, 255]
}

describe('derived desktop brand assets', () => {
  it('reproduces the committed derived files byte for byte, with no leftovers', () => {
    expect(readdirSync(BRAND_PATHS.derived).sort()).toEqual([...DERIVED_FILES])
    expect(readdirSync(stage).sort()).toEqual([...DERIVED_FILES])
    for (const name of DERIVED_FILES) {
      expect(staged(name).equals(committed(name)), name).toBe(true)
    }
  })

  it('keeps only the A4 sources under brand/ and no v2 mark strings in the pipeline', () => {
    expect(readdirSync(BRAND_DIR).sort()).toEqual(
      ['derived', 'double-light.svg', 'icon-ink.svg', 'icon.svg', 'single-dark.svg', 'single-light.svg'],
    )
    const sources = ['icon.svg', 'icon-ink.svg', 'single-light.svg', 'single-dark.svg', 'double-light.svg']
    for (const name of sources) {
      const text = readFileSync(join(BRAND_DIR, name), 'utf8')
      expect(text.length, name).toBeGreaterThan(100)
      expect(text, name).not.toContain('0.409')
      expect(text, name).not.toContain('1C1C1E')
    }
    const scripts = ['derive-brand-icons.ts', 'derive-installer-brand.ts']
      .map(name => readFileSync(fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)), 'utf8'))
    for (const script of scripts) {
      expect(script).not.toContain('0.409')
      expect(script).not.toContain('1C1C1E')
      expect(script).not.toContain('W_PATH')
      expect(script.toLowerCase()).not.toContain('wandox')
    }
    // The tray renderer enlarges its glyph by 1.2; the derived tray markup compensates for it.
    expect(readFileSync(fileURLToPath(new URL('../scripts/render-tray-icon.ts', import.meta.url)), 'utf8'))
      .toContain('scale(1.2)')
  })

  it('maps each derived artifact onto its brand source colours', async () => {
    const appIco = unpackIco(committed('icon-windows.ico'))
    expect(appIco.map(entry => entry.size)).toEqual([...WINDOWS_APP_ICO_SIZES])
    const trayIco = unpackIco(committed('tray-windows.ico'))
    expect(trayIco.map(entry => entry.size)).toEqual([...TRAY_ICON_SIZES])

    // Application icons carry the ink mark: macOS dock and Windows exe / taskbar / shortcuts.
    for (const name of ['icon-macos.png', 'icon-windows.png']) {
      const png = committed(name)
      expect(close(await pixel(png, 512, 154), INK), `${name} plate`).toBe(true)
      expect(close(await pixel(png, 512, 512), WHITE), `${name} face`).toBe(true)
      expect(close(await pixel(png, 61, 61), TRANSPARENT), `${name} outside the rounded plate`).toBe(true)
    }
    const app256 = appIco.find(entry => entry.size === 256)!
    expect(close(await pixel(app256.png, 128, 38), INK), '256px plate').toBe(true)
    expect(close(await pixel(app256.png, 128, 128), WHITE), '256px face').toBe(true)
    expect(close(await pixel(app256.png, 15, 15), TRANSPARENT), '256px outside the rounded plate').toBe(true)
    const app16 = appIco.find(entry => entry.size === 16)!
    expect(close(await pixel(app16.png, 8, 2), INK), '16px plate stays solid').toBe(true)
    expect(close(await pixel(app16.png, 8, 8), WHITE), '16px face stays readable').toBe(true)

    // The tray shows the same tile as the application icon.
    const tray64 = trayIco.find(entry => entry.size === 64)!
    expect(close(await pixel(tray64.png, 32, 10), INK), 'tray plate').toBe(true)
    expect(close(await pixel(tray64.png, 32, 32), WHITE), 'tray face').toBe(true)
    expect(trayIco.find(entry => entry.size === 16)!.png.equals(app16.png), 'tray 16px entry').toBe(true)
    expect(trayIco.find(entry => entry.size === 64)!.png.equals(appIco.find(entry => entry.size === 64)!.png), 'tray 64px entry').toBe(true)

    // The uninstaller sidebar embeds the primary blue mark.
    const sidebar = committed('uninstaller-sidebar.png')
    expect(close(await pixel(sidebar, 82, 90), BLUE), 'sidebar blue tile').toBe(true)
    expect(close(await pixel(sidebar, 10, 10), SIDEBAR_BG), 'sidebar background').toBe(true)
    const sidebarBmp = committed('uninstaller-sidebar.bmp')
    expect(close(bmpPixel(sidebarBmp, 82, 90), BLUE), 'sidebar BMP tile').toBe(true)
    expect(close(bmpPixel(sidebarBmp, 10, 10), SIDEBAR_BG), 'sidebar BMP background').toBe(true)

    // The installer artwork is the blue lockup: ink letters on light, white letters on dark.
    for (const [name, k] of [['installer-brand-2x.png', 1], ['installer-brand.png', 0.5]] as const) {
      const png = committed(name)
      expect(await findSolid(png, [Math.round(110 * k), Math.round(138 * k), Math.round(140 * k), Math.round(155 * k)], [77, 107, 254]), `${name} blue tile`).toBe(true)
      expect(await findSolid(png, [Math.round(233 * k), Math.round(160 * k), Math.round(330 * k), Math.round(234 * k)], [17, 18, 22]), `${name} ink letters`).toBe(true)
    }
    for (const [name, k] of [['installer-brand-dark-2x.png', 1], ['installer-brand-dark.png', 0.5]] as const) {
      const png = committed(name)
      expect(await findSolid(png, [Math.round(110 * k), Math.round(138 * k), Math.round(140 * k), Math.round(155 * k)], [77, 107, 254]), `${name} blue tile`).toBe(true)
      expect(await findSolid(png, [Math.round(233 * k), Math.round(160 * k), Math.round(330 * k), Math.round(234 * k)], [255, 255, 255]), `${name} white letters`).toBe(true)
    }

    // The committed Windows SVG is the ink canvas the PNG / ICO derive from.
    const windowsSvg = committed('icon-windows.svg').toString('utf8')
    expect(windowsSvg).toContain('fill="#111216"')
    expect(windowsSvg).not.toContain('#4D6BFE')
  })

  it('ships a theme-aware welcome brand projected from the stacked lockup', () => {
    const svg = committed('welcome-brand.svg').toString('utf8')
    expect(svg).toContain('viewBox="0 0 282 82"')
    expect(svg).toContain('currentColor')
    expect(svg).toContain('@media (prefers-color-scheme: dark)')
    expect(svg).toContain('color: #FFFFFF')
    expect(svg.match(/#4D6BFE/gu)).toHaveLength(6)
    // Only the light colour-scheme declaration stays literal; every letter follows currentColor.
    expect(svg.match(/#111216/gu)).toHaveLength(1)
  })
})
