/**
 * Derive the Windows installer brand images (light / dark, 1x / 2x) from `brand/icon.svg`.
 * Output: `brand/derived/installer-brand{,-2x,-dark,-dark-2x}.png`, consumed by
 * `prepare-windows-installer.ps1 -BrandDirectory` when `DSH_DESKTOP_BRAND_RESOURCES` is set.
 * Usage: `pnpm exec tsx scripts/derive-installer-brand.ts [product name]`.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SOURCE = fileURLToPath(new URL('../brand/icon.svg', import.meta.url))
const DERIVED = fileURLToPath(new URL('../brand/derived', import.meta.url))
const PRODUCT_NAME = process.argv[2] ?? 'Wandox Work'

/** Official layout at 2x: 1200 x 392 canvas, badge centred at (600, 150) r 120, wordmark on the bottom band. */
function brandSvg(markGroup: string, dark: boolean): string {
  const text = dark ? '#F5F5F7' : '#15151A'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="392" viewBox="0 0 1200 392">
  <defs>
    <radialGradient id="badge" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#EEEEF1"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="${dark ? '0.35' : '0.10'}"/>
    </filter>
  </defs>
  <circle cx="600" cy="150" r="120" fill="url(#badge)" filter="url(#shadow)"/>
  <g transform="translate(600 152) scale(5.4) translate(-10.98 -12.02)">${markGroup}</g>
  <text x="600" y="368" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="54" font-weight="600" letter-spacing="0.5" fill="${text}">${PRODUCT_NAME}</text>
</svg>`
}

const source = await readFile(SOURCE, 'utf8')
const path = /<path\b[^>]*\/>/u.exec(source)?.[0]
if (path === undefined) throw new Error('derive-installer-brand: brand/icon.svg has no <path>')
const mark = path.replace(/fill="[^"]*"/u, 'fill="#15151A"')

for (const dark of [false, true]) {
  const svg = Buffer.from(brandSvg(mark, dark))
  const suffix = dark ? '-dark' : ''
  await sharp(svg).png().toFile(`${DERIVED}/installer-brand${suffix}-2x.png`)
  await sharp(svg).resize(600, 196).png().toFile(`${DERIVED}/installer-brand${suffix}.png`)
}
process.stdout.write(`derive-installer-brand: wrote installer-brand{,-2x,-dark,-dark-2x}.png to ${DERIVED}\n`)
