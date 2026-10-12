/**
 * Derive every desktop brand bitmap the official packager expects from the committed brand sources.
 *
 * Inputs live under `brand/`: the primary blue mark `icon.svg`, the ink mark `icon-ink.svg`, the
 * 200x24 lockups `single-{light,dark}.svg` (installer page artwork) and the 282x82 stacked lockup
 * `double-light.svg` (welcome-window brand). Output: mac 1024 PNG with a solid rounded plate,
 * Windows PNG + multi-size ICO, tray ICO (official sizes), uninstaller sidebar 164x314 BMP, and
 * the welcome-brand SVG.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { packIco, renderTrayIconEntries, TRAY_ICON_SIZES } from './render-tray-icon.ts'

/** Official tray bitmap edges; reused so Windows scale picks a crisp size. */
export { TRAY_ICON_SIZES }

/** Windows application ICO edges (electron-builder also generates from PNG; this ICO is the committed source). */
export const WINDOWS_APP_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const

/** Brand source SVGs and the directory that receives derived files, relative to `apps/desktop`. */
export const BRAND_PATHS = {
  /** Primary blue square mark; the uninstaller sidebar embeds it whole. */
  mark: fileURLToPath(new URL('../brand/icon.svg', import.meta.url)),
  /** Ink square mark; the macOS / Windows application icons and the Windows tray derive from it. */
  markInk: fileURLToPath(new URL('../brand/icon-ink.svg', import.meta.url)),
  /** Light-mode 200x24 lockup for the installer page artwork. */
  installerLight: fileURLToPath(new URL('../brand/single-light.svg', import.meta.url)),
  /** Dark-mode 200x24 lockup for the installer page artwork. */
  installerDark: fileURLToPath(new URL('../brand/single-dark.svg', import.meta.url)),
  /** Stacked 282x82 lockup projected into the welcome-window brand SVG. */
  welcomeLockup: fileURLToPath(new URL('../brand/double-light.svg', import.meta.url)),
  derived: fileURLToPath(new URL('../brand/derived', import.meta.url)),
} as const

const SOURCE_EDGE = 1024
const SOURCE_DENSITY = 72
const SIDEBAR_WIDTH = 164
const SIDEBAR_HEIGHT = 314
/** Undo the 1.2 tray-glyph enlargement `render-tray-icon.ts` applies around the tile centre. */
const TRAY_GLYPH_COMPENSATION = 1 / 1.2
/** Rounded plate drawn at the macOS icon proportions; the mark artwork scales into it. */
const ICON_TILE = { x: 72, y: 72, edge: 880, radius: 196 } as const
const UNINSTALLER_TILE = { x: 22, y: 72, edge: 120 } as const
const INK_ON_LIGHT = '#111216'

/** Attributes of the SVG root element of one brand source. */
export function svgAttributes(svg: string): string {
  const root = /<svg\b([^>]*)>/u.exec(svg)
  if (root?.[1] === undefined) throw new Error('derive-brand-icons: source SVG has no root element')
  return root[1]
}

/**
 * Value of one attribute on the SVG root element.
 * @param svg - SVG document text.
 * @param name - Attribute name, matched as a whole word.
 * @returns the attribute value.
 */
export function svgAttribute(svg: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]+)"`, 'u').exec(svgAttributes(svg))
  if (match?.[1] === undefined) throw new Error(`derive-brand-icons: source SVG root has no ${name} attribute`)
  return match[1]
}

/**
 * Markup between the SVG root element's tags.
 * @param svg - SVG document text.
 * @returns inner markup with no root element.
 */
export function svgInner(svg: string): string {
  const open = /<svg\b[^>]*>/u.exec(svg)
  const close = svg.lastIndexOf('</svg>')
  if (open === null || close < 0) throw new Error('derive-brand-icons: source SVG has no root element')
  return svg.slice(open.index + open[0].length, close).trim()
}

/** Split a square mark source into its plate fill and the artwork that sits on the plate. */
function markPlateAndFace(markSource: string): { plate: string; face: string } {
  const plate = /<rect\b[^>]*\bfill="(#[0-9A-Fa-f]{6})"[^>]*\/>/u.exec(markSource)
  if (plate?.[1] === undefined) throw new Error('derive-brand-icons: mark source has no filled plate rect')
  const face = svgInner(markSource).replace(plate[0], '').trim()
  if (face === '') throw new Error('derive-brand-icons: mark source has no face artwork next to the plate')
  return { plate: plate[1], face }
}

/** Scale the mark artwork into the 72..952 tile on the 1024 canvas. */
function iconCanvasSvg(mark: { plate: string; face: string; viewBox: string }, trayGlyph: boolean): string {
  const { x, y, edge, radius } = ICON_TILE
  const face = `<svg x="${x}" y="${y}" width="${edge}" height="${edge}" viewBox="${mark.viewBox}">${mark.face}</svg>`
  const tile = `<rect x="${x}" y="${y}" width="${edge}" height="${edge}" rx="${radius}" fill="${mark.plate}"/>${face}`
  const glyph = trayGlyph
    ? `<g id="tray-glyph"><g transform="translate(552 544) scale(${String(TRAY_GLYPH_COMPENSATION)}) translate(-552 -544)">${tile}</g></g>`
    : tile
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    glyph,
    '</svg>',
    '',
  ].join('\n')
}

/** Embed the whole primary mark in the 164x314 uninstaller sidebar. */
function uninstallerSidebarSvg(mark: { inner: string; viewBox: string }): string {
  const { x, y, edge } = UNINSTALLER_TILE
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDEBAR_WIDTH}" height="${SIDEBAR_HEIGHT}" viewBox="0 0 ${SIDEBAR_WIDTH} ${SIDEBAR_HEIGHT}">`,
    `<rect width="${SIDEBAR_WIDTH}" height="${SIDEBAR_HEIGHT}" fill="#F4F4F5"/>`,
    `<svg x="${x}" y="${y}" width="${edge}" height="${edge}" viewBox="${mark.viewBox}">${mark.inner}</svg>`,
    '</svg>',
    '',
  ].join('\n')
}

/** Project the stacked lockup into a theme-aware welcome-window SVG: letters follow the colour scheme, blue accents stay fixed. */
function welcomeBrandSvg(lockup: string): string {
  const artwork = svgInner(lockup).replaceAll(INK_ON_LIGHT, 'currentColor')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg width="${svgAttribute(lockup, 'width')}" height="${svgAttribute(lockup, 'height')}" viewBox="${svgAttribute(lockup, 'viewBox')}" xmlns="http://www.w3.org/2000/svg">`,
    '<style>',
    `  :root { color: ${INK_ON_LIGHT}; }`,
    '  @media (prefers-color-scheme: dark) {',
    '    :root { color: #FFFFFF; }',
    '  }',
    '</style>',
    artwork,
    '</svg>',
    '',
  ].join('\n')
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
 * Derive every committed brand asset from the `brand/` sources.
 * @param outputDir - Directory that receives derived files; defaults to `brand/derived`.
 * @returns derived file names mapped to the paths written.
 */
export async function deriveBrandIcons(outputDir: string = BRAND_PATHS.derived): Promise<Readonly<Record<string, string>>> {
  const [blueMark, inkMark, welcomeLockup] = await Promise.all([
    readFile(BRAND_PATHS.mark, 'utf8'),
    readFile(BRAND_PATHS.markInk, 'utf8'),
    readFile(BRAND_PATHS.welcomeLockup, 'utf8'),
  ])
  const ink = { ...markPlateAndFace(inkMark), viewBox: svgAttribute(inkMark, 'viewBox') }
  const blue = { inner: svgInner(blueMark), viewBox: svgAttribute(blueMark, 'viewBox') }
  await mkdir(outputDir, { recursive: true })
  const appSvg = iconCanvasSvg(ink, false)
  const traySvg = iconCanvasSvg(ink, true)
  const macosPng = await rasterPng(appSvg, SOURCE_EDGE)
  const windowsPng = await rasterPng(appSvg, SOURCE_EDGE)
  const windowsIco = packIco(await Promise.all(WINDOWS_APP_ICO_SIZES.map(async size => ({
    size,
    png: await rasterPng(appSvg, size),
  }))))
  const trayIco = packIco(await renderTrayIconEntries(Buffer.from(traySvg)))
  const sidebarSvg = uninstallerSidebarSvg(blue)
  const sidebarPng = await sharp(Buffer.from(sidebarSvg))
    .resize(SIDEBAR_WIDTH, SIDEBAR_HEIGHT)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const sidebarBmp = encodeBmp24(sidebarPng.info.width, sidebarPng.info.height, sidebarPng.data)
  const files = {
    'icon-macos.png': macosPng,
    'icon-windows.png': windowsPng,
    'icon-windows.svg': Buffer.from(appSvg),
    'icon-windows.ico': windowsIco,
    'tray-windows.ico': trayIco,
    'uninstaller-sidebar.png': await sharp(Buffer.from(sidebarSvg)).resize(SIDEBAR_WIDTH, SIDEBAR_HEIGHT).png().toBuffer(),
    'uninstaller-sidebar.bmp': sidebarBmp,
    'welcome-brand.svg': Buffer.from(welcomeBrandSvg(welcomeLockup)),
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
