/**
 * Derive the Windows installer brand images (light / dark, 1x / 2x) from the `brand/` lockups.
 * Output: `brand/derived/installer-brand{,-2x,-dark,-dark-2x}.png`, consumed by
 * `prepare-windows-installer.ps1 -BrandDirectory` when `DSH_DESKTOP_BRAND_RESOURCES` is set.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { BRAND_PATHS, svgAttribute, svgInner } from './derive-brand-icons.ts'

const CANVAS = { width: 1200, height: 392 } as const
/** The 200x24 lockup scaled 5.4x and centred on the 1x = 600x196 installer canvas. */
const DRAW = { width: 1080, height: 129.6, x: 60, y: 131.2 } as const

/** One installer page image: the mode lockup centred on the official 1200x392 canvas. */
function installerBrandSvg(lockup: string): string {
  const width = Number(svgAttribute(lockup, 'width'))
  const height = Number(svgAttribute(lockup, 'height'))
  if (width !== 200 || height !== 24) {
    throw new Error(`derive-installer-brand: lockup canvas is ${String(width)}x${String(height)}, expected 200x24`)
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">`,
    `<svg x="${DRAW.x}" y="${DRAW.y}" width="${DRAW.width}" height="${DRAW.height}" viewBox="${svgAttribute(lockup, 'viewBox')}">${svgInner(lockup)}</svg>`,
    '</svg>',
    '',
  ].join('\n')
}

/**
 * Write the four installer page images.
 * @param outputDir - Directory that receives the PNGs; defaults to `brand/derived`.
 * @returns derived file names mapped to the paths written.
 */
export async function deriveInstallerBrand(outputDir: string = BRAND_PATHS.derived): Promise<Readonly<Record<string, string>>> {
  const [light, dark] = await Promise.all([
    readFile(BRAND_PATHS.installerLight, 'utf8'),
    readFile(BRAND_PATHS.installerDark, 'utf8'),
  ])
  const written: Record<string, string> = {}
  for (const [suffix, lockup] of [['', light], ['-dark', dark]] as const) {
    const svg = Buffer.from(installerBrandSvg(lockup))
    const doubled = resolve(outputDir, `installer-brand${suffix}-2x.png`)
    const single = resolve(outputDir, `installer-brand${suffix}.png`)
    await sharp(svg).png().toFile(doubled)
    await sharp(svg).resize(CANVAS.width / 2, CANVAS.height / 2).png().toFile(single)
    written[`installer-brand${suffix}-2x.png`] = doubled
    written[`installer-brand${suffix}.png`] = single
  }
  return written
}

async function main(): Promise<void> {
  const written = await deriveInstallerBrand()
  process.stdout.write(`derive-installer-brand: wrote ${Object.keys(written).join(', ')}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
