'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const HOST_BINARIES = ['host/node', 'host/node-spawn-helper']

/**
 * Sign nested Host Mach-O binaries after extraResources copy, before osx-sign.
 * No-op unless `DSH_MAC_SIGNED=1` (unsigned `dist:desktop` keeps ad-hoc).
 * @param context - electron-builder pack context (`appOutDir`, `electronPlatformName`, `packager`).
 * @returns {void}
 */
module.exports = function afterPack(context) {
  if (process.env.DSH_MAC_SIGNED !== '1') return
  if (context.electronPlatformName !== 'darwin') return
  const identity = process.env.DSH_MAC_SIGN_IDENTITY
  if (identity === undefined || identity === '' || identity === '-') {
    throw new Error('desktop afterPack: DSH_MAC_SIGN_IDENTITY is not a Developer ID Application identity')
  }
  const resources = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
  )
  const entitlements = join(__dirname, 'resources', 'entitlements.mac.plist')
  for (const relative of HOST_BINARIES) {
    const binary = join(resources, relative)
    if (!existsSync(binary)) {
      throw new Error(`desktop afterPack: missing ${binary}`)
    }
    const result = spawnSync(
      'codesign',
      [
        '--sign',
        identity,
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--entitlements',
        entitlements,
        binary,
      ],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) {
      throw new Error(
        `desktop afterPack: codesign ${relative} failed: ${result.stderr || result.stdout || String(result.status)}`,
      )
    }
  }
}
