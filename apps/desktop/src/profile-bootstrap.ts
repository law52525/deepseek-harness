/**
 * Packaged extraResources hold a profile template plus a content-hash stamp.
 * The shell copies the template into `$DSH_HOME/profiles/desktop` when the
 * stamp mismatches. It does not know which plugins the template contains.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Matches `hostChildArgv`'s hardcoded `--profile desktop`. */
export const DESKTOP_PROFILE_NAME = 'desktop'
export const PROFILE_STAMP_NAME = 'version-stamp'
const INSTALLING_SUFFIX = '.installing'
const PREVIOUS_SUFFIX = '.previous'

export type ProfileBootstrapResult = 'copied' | 'unchanged' | 'skipped'

export interface ProfileBootstrapPaths {
  dshHome?: string
  templateRoot?: string
}

/**
 * Copy `templateRoot` over `$DSH_HOME/profiles/desktop` when stamps differ.
 * Stamp is written last inside a staging directory; dest is swapped by rename
 * so a crash cannot leave a half-copied tree with a new stamp.
 * @returns what happened.
 */
export function ensureProfileFromTemplate(options: ProfileBootstrapPaths = {}): ProfileBootstrapResult {
  const templateRoot = options.templateRoot
  if (templateRoot === undefined || templateRoot === '') return 'skipped'
  const stampPath = join(templateRoot, PROFILE_STAMP_NAME)
  if (!existsSync(stampPath)) {
    throw new Error(`desktop: profile template is missing ${PROFILE_STAMP_NAME} at ${stampPath}`)
  }
  const stamp = readFileSync(stampPath, 'utf8').trim()
  if (stamp.length === 0) throw new Error(`desktop: profile template ${PROFILE_STAMP_NAME} is empty`)

  const dshHome = options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dest = join(dshHome, 'profiles', DESKTOP_PROFILE_NAME)
  const destStamp = join(dest, PROFILE_STAMP_NAME)
  if (existsSync(destStamp) && readFileSync(destStamp, 'utf8').trim() === stamp) {
    return 'unchanged'
  }

  mkdirSync(join(dshHome, 'profiles'), { recursive: true })
  const staging = dest + INSTALLING_SUFFIX
  rmSync(staging, { recursive: true, force: true })
  cpSync(templateRoot, staging, { recursive: true })
  writeFileSync(join(staging, PROFILE_STAMP_NAME), `${stamp}\n`)

  const previous = dest + PREVIOUS_SUFFIX
  if (existsSync(dest)) {
    rmSync(previous, { recursive: true, force: true })
    renameSync(dest, previous)
  }
  renameSync(staging, dest)
  rmSync(previous, { recursive: true, force: true })
  return 'copied'
}
