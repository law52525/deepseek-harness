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
<g transform="translate(140 6) scale(1.1667)">
  <path transform="matrix(1.095 0 0 1.095 -0.448 -5.211)" d="${W_PATH}" fill="var(--dsw-alias-label-primary)"/>
</g>
<g transform="translate(178 8)">
  <g transform="translate(-38.304 0)">
    <path d="M40.396 12.496 38.304 12.119Q38.657 10.855 39.518 10.248Q40.38 9.641 42.078 9.641Q43.62 9.641 44.375 10.006Q45.129 10.371 45.437 10.933Q45.745 11.495 45.745 12.996L45.72 15.687Q45.72 16.836 45.831 17.381Q45.941 17.927 46.245 18.55H43.964Q43.874 18.32 43.743 17.869Q43.686 17.664 43.661 17.598Q43.07 18.173 42.398 18.46Q41.725 18.747 40.962 18.747Q39.617 18.747 38.842 18.017Q38.066 17.287 38.066 16.171Q38.066 15.433 38.419 14.854Q38.772 14.276 39.408 13.969Q40.043 13.661 41.241 13.431Q42.857 13.128 43.48 12.865V12.636Q43.48 11.971 43.152 11.688Q42.824 11.405 41.914 11.405Q41.298 11.405 40.954 11.647Q40.609 11.889 40.396 12.496ZM43.48 14.366Q43.038 14.514 42.078 14.719Q41.118 14.924 40.823 15.121Q40.371 15.441 40.371 15.933Q40.371 16.417 40.732 16.77Q41.093 17.123 41.651 17.123Q42.275 17.123 42.841 16.713Q43.259 16.401 43.39 15.95Q43.48 15.654 43.48 14.826Z" fill="var(--dsw-alias-label-primary)"/>
    <path d="M55.941 18.55H53.636V14.104Q53.636 12.693 53.488 12.279Q53.341 11.864 53.008 11.635Q52.676 11.405 52.209 11.405Q51.61 11.405 51.134 11.733Q50.658 12.061 50.482 12.603Q50.305 13.144 50.305 14.604V18.55H48V9.838H50.141V11.118Q51.282 9.641 53.013 9.641Q53.775 9.641 54.407 9.916Q55.039 10.191 55.363 10.618Q55.687 11.044 55.814 11.586Q55.941 12.127 55.941 13.136Z" fill="var(--dsw-alias-label-primary)"/>
    <path d="M66.269 18.55H64.128V17.27Q63.595 18.017 62.869 18.382Q62.143 18.747 61.404 18.747Q59.903 18.747 58.833 17.537Q57.762 16.327 57.762 14.161Q57.762 11.946 58.804 10.794Q59.846 9.641 61.437 9.641Q62.897 9.641 63.964 10.855V6.524H66.269ZM60.116 14.005Q60.116 15.4 60.502 16.023Q61.06 16.926 62.061 16.926Q62.856 16.926 63.414 16.249Q63.972 15.572 63.972 14.227Q63.972 12.726 63.43 12.065Q62.889 11.405 62.044 11.405Q61.224 11.405 60.67 12.057Q60.116 12.709 60.116 14.005Z" fill="var(--dsw-alias-label-primary)"/>
    <path d="M68.008 14.071Q68.008 12.923 68.574 11.848Q69.14 10.773 70.178 10.207Q71.215 9.641 72.495 9.641Q74.472 9.641 75.735 10.925Q76.998 12.209 76.998 14.17Q76.998 16.146 75.723 17.447Q74.447 18.747 72.511 18.747Q71.314 18.747 70.227 18.205Q69.14 17.664 68.574 16.618Q68.008 15.572 68.008 14.071ZM70.37 14.194Q70.37 15.49 70.986 16.179Q71.601 16.868 72.503 16.868Q73.405 16.868 74.017 16.179Q74.628 15.49 74.628 14.178Q74.628 12.898 74.017 12.209Q73.405 11.52 72.503 11.52Q71.601 11.52 70.986 12.209Q70.37 12.898 70.37 14.194Z" fill="var(--dsw-alias-label-primary)"/>
    <path d="M77.696 18.55 80.837 14.063 77.827 9.838H80.641L82.183 12.234L83.807 9.838H86.514L83.561 13.964L86.785 18.55H83.955L82.183 15.851L80.395 18.55Z" fill="var(--dsw-alias-label-primary)"/>
  </g>
  <g transform="translate(-72.652 0)">
    <rect x="129.348" y="5.5" width="34" height="14" rx="2" fill="var(--dsw-alias-label-primary)"/>
    <text x="146.348" y="16.05" textAnchor="middle" fill="var(--dsw-alias-label-primary-inverted)" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="9" fontWeight="700" letterSpacing="0.5">WORK</text>
  </g>
</g>
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
