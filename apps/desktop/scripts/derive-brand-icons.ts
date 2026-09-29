/**
 * Derive every desktop brand bitmap the official packager expects from one SVG.
 *
 * Input: a square glyph SVG (the v2 W mark). Output: mac 1024 PNG with a solid
 * rounded plate, Windows PNG + multi-size ICO, tray ICO (official sizes),
 * installer sidebar 164×314 BMP, and the welcome-window wordmark SVG.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { packIco, renderTrayIconEntries, TRAY_ICON_SIZES } from './render-tray-icon.ts'

/** W glyph from v2 `BrandWordmark` / `icon.svg`; keep in lockstep with `brand/icon.svg`. */
export const W_PATH = 'M 0.409 5.581 L 5.602 20.287 L 10.984 11.827 L 16.367 20.287 L 21.56 5.581 A 1.47 1.47 0 0 1 18.738 4.759 L 15.977 17.373 L 10.984 8.888 L 5.992 17.373 L 3.231 4.759 A 1.47 1.47 0 0 1 0.409 5.581 Z'

/** Official tray bitmap edges; reused so Windows scale picks a crisp size. */
export { TRAY_ICON_SIZES }

/** Windows application ICO edges (electron-builder also generates from PNG; this ICO is the committed source). */
export const WINDOWS_APP_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const

/** Solid plate behind the glyph so the Dock / taskbar stays readable in light and dark. */
export const PLATE_FILL = '#1C1C1E'

/** Path layout relative to `apps/desktop`. */
export const BRAND_PATHS = {
  source: fileURLToPath(new URL('../brand/icon.svg', import.meta.url)),
  derived: fileURLToPath(new URL('../brand/derived', import.meta.url)),
} as const

const SOURCE_EDGE = 1024
const SOURCE_DENSITY = 72
const SIDEBAR_WIDTH = 164
const SIDEBAR_HEIGHT = 314

function platformGlyphSvg(options: { fill: string; plate: string; trayGlyph: boolean }): string {
  const inner = `<g transform="translate(512 512) scale(32) translate(-10.98 -12.02)"><path fill="${options.fill}" d="${W_PATH}"/></g>`
  const glyph = options.trayGlyph ? `<g id="tray-glyph">${inner}</g>` : inner
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    `<rect x="72" y="72" width="880" height="880" rx="196" fill="${options.plate}"/>`,
    glyph,
    '</svg>',
    '',
  ].join('\n')
}

function welcomeBrandSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="472" height="40" viewBox="0 0 472 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<style>
  :root {
    --dsw-alias-label-primary: #0f1115;
    --dsw-alias-label-primary-inverted: #fff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --dsw-alias-label-primary: #f9fafb;
      --dsw-alias-label-primary-inverted: #353638;
    }
  }
</style>
<g transform="translate(128 7) scale(1.2)">
  <path d="${W_PATH}" fill="var(--dsw-alias-label-primary)"/>
</g>
<text x="164" y="29" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="-0.2" fill="var(--dsw-alias-label-primary)">Wandox</text>
<rect x="272" y="10" width="54" height="20" rx="3" fill="var(--dsw-alias-label-primary)"/>
<text x="299" y="24.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="12.5" font-weight="700" letter-spacing="0.8" fill="var(--dsw-alias-label-primary-inverted)">WORK</text>
</svg>
`
}

/** Pack a 24-bit BMP (no compression, bottom-up). */
export function encodeBmp24(width: number, height: number, rgba: Buffer): Buffer {
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowStride * height
  const header = 54
  const out = Buffer.alloc(header + pixelBytes)
  out.write('BM', 0)
  out.writeUInt32LE(out.length, 2)
  out.writeUInt32LE(header, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(pixelBytes, 34)
  for (let y = 0; y < height; y += 1) {
    const srcY = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const i = (srcY * width + x) * 4
      const dest = header + y * rowStride + x * 3
      out[dest] = rgba[i + 2]!
      out[dest + 1] = rgba[i + 1]!
      out[dest + 2] = rgba[i]!
    }
  }
  return out
}

async function rasterPng(svg: string, edge: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: SOURCE_DENSITY * edge / SOURCE_EDGE }).resize(edge, edge).png().toBuffer()
}

/**
 * Derive every committed brand asset from `brand/icon.svg`.
 * @param source - Glyph SVG; default the committed v2 W mark.
 * @param outputDir - Directory that receives derived files.
 */
export async function deriveBrandIcons(
  source: string = BRAND_PATHS.source,
  outputDir: string = BRAND_PATHS.derived,
): Promise<Readonly<Record<string, string>>> {
  const glyph = await readFile(source, 'utf8')
  if (!glyph.includes(W_PATH)) throw new Error('derive-brand-icons: source SVG must contain the W glyph path')
  await mkdir(outputDir, { recursive: true })
  const macosSvg = platformGlyphSvg({ fill: '#FFFFFF', plate: PLATE_FILL, trayGlyph: false })
  const windowsSvg = platformGlyphSvg({ fill: '#FFFFFF', plate: PLATE_FILL, trayGlyph: true })
  const macosPng = await rasterPng(macosSvg, SOURCE_EDGE)
  const windowsPng = await rasterPng(windowsSvg, SOURCE_EDGE)
  const windowsIco = packIco(await Promise.all(WINDOWS_APP_ICO_SIZES.map(async size => ({
    size,
    png: await rasterPng(windowsSvg, size),
  }))))
  const trayIco = packIco(await renderTrayIconEntries(Buffer.from(windowsSvg)))
  const sidebarSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">',
    '<rect width="164" height="314" fill="#F4F4F5"/>',
    `<rect x="22" y="72" width="120" height="120" rx="28" fill="${PLATE_FILL}"/>`,
    `<g transform="translate(82 132) scale(4.2) translate(-10.98 -12.02)"><path fill="#FFFFFF" d="${W_PATH}"/></g>`,
    '</svg>',
    '',
  ].join('\n')
  const sidebarPng = await sharp(Buffer.from(sidebarSvg))
    .resize(SIDEBAR_WIDTH, SIDEBAR_HEIGHT)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const sidebarBmp = encodeBmp24(sidebarPng.info.width, sidebarPng.info.height, sidebarPng.data)
  const files = {
    'icon-macos.png': macosPng,
    'icon-windows.png': windowsPng,
    'icon-windows.svg': Buffer.from(windowsSvg),
    'icon-windows.ico': windowsIco,
    'tray-windows.ico': trayIco,
    'uninstaller-sidebar.png': await sharp(Buffer.from(sidebarSvg)).resize(SIDEBAR_WIDTH, SIDEBAR_HEIGHT).png().toBuffer(),
    'uninstaller-sidebar.bmp': sidebarBmp,
    'welcome-brand.svg': Buffer.from(welcomeBrandSvg()),
  } as const
  const written: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(files)) {
    const path = resolve(outputDir, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    written[name] = path
  }
  return written
}

async function main(): Promise<void> {
  const written = await deriveBrandIcons()
  process.stdout.write(`derive-brand-icons: wrote ${Object.keys(written).join(', ')}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
