/**
 * Resolve the system Node executable. Electron's `process.execPath` is not
 * Node; native addons in the Host child stay on the system Node ABI.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

/**
 * Whether a path is an Electron binary rather than Node.
 * @param executable - candidate executable path.
 * @returns true when the path names Electron.
 */
export function isElectronExecutable(executable: string): boolean {
  const base = basename(executable.replaceAll('\\', '/')).toLowerCase()
  return base === 'electron' || base === 'electron.exe' || executable.includes('Electron.app')
}

/**
 * Find a system Node binary. Never returns Electron, and never uses `ELECTRON_RUN_AS_NODE`.
 * @returns an existing Node executable path.
 */
export function resolveNodeExecutable(): string {
  for (const candidate of [process.env.npm_node_execpath, process.env.NODE_BINARY]) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate) && !isElectronExecutable(candidate)) {
      return candidate
    }
  }
  if (!isElectronExecutable(process.execPath)) return process.execPath
  const finder = process.platform === 'win32' ? 'where' : 'which'
  let listed: string
  try {
    listed = execFileSync(finder, ['node'], { encoding: 'utf8' })
  } catch (error) {
    throw new Error(
      `desktop: system Node executable not found (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  for (const line of listed.split(/\r?\n/)) {
    const found = line.trim()
    if (found !== '' && existsSync(found) && !isElectronExecutable(found)) return found
  }
  throw new Error('desktop: system Node executable not found; Electron cannot spawn the Host child')
}
