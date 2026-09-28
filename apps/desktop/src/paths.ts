/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveDesktopProfileName } from './product-config.ts'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @param profileName - Electron-managed profile directory name; defaults to the packaging configuration.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(
  dshHome: string = resolveDshHome(),
  profileName: string = resolveDesktopProfileName(),
): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', profileName),
    lock: join(dshHome, 'profiles', profileName, 'lock'),
  }
}
