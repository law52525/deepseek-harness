/**
 * Packaged extraResource layout for the desktop installer. Unpackaged
 * `electron .` leaves `process.resourcesPath` without these directories and
 * falls back to system Node plus workspace resolution.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** extraResources destination for the Host Node closure. */
const DESKTOP_HOST_RESOURCE = 'host'
/** extraResources destination for the web frontend dist. */
const DESKTOP_FRONTEND_RESOURCE = 'frontend'
/** extraResources destination for the generic profile template + stamp. */
const DESKTOP_PROFILE_TEMPLATE_RESOURCE = 'profile-template'

/** Process fields the packaged layout reads. */
export interface DesktopProcessPaths {
  /** Electron `process.resourcesPath` when running inside a packaged app. */
  resourcesPath?: string
  platform: NodeJS.Platform
}

/**
 * Resources directory of a packaged Electron app, if present.
 * @param processLike - `process` or a test stub.
 * @returns absolute resources path, or undefined when unpackaged.
 */
function desktopResourcesRoot(processLike: DesktopProcessPaths = process): string | undefined {
  const resources = processLike.resourcesPath
  if (typeof resources !== 'string' || resources === '') return undefined
  return resources
}

/**
 * Bundled Node executable inside extraResources/host.
 * @param processLike - `process` or a test stub.
 * @returns an existing Node path, or undefined when unpackaged.
 */
export function resolveBundledNode(processLike: DesktopProcessPaths = process): string | undefined {
  const resources = desktopResourcesRoot(processLike)
  if (resources === undefined) return undefined
  const name = processLike.platform === 'win32' ? 'node.exe' : 'node'
  const candidate = join(resources, DESKTOP_HOST_RESOURCE, name)
  return existsSync(candidate) ? candidate : undefined
}

/**
 * Bundled `dsh` CLI bin inside the Host closure.
 * @param processLike - `process` or a test stub.
 * @returns an existing bin path, or undefined when unpackaged.
 */
export function resolveBundledDshBin(processLike: DesktopProcessPaths = process): string | undefined {
  const resources = desktopResourcesRoot(processLike)
  if (resources === undefined) return undefined
  const candidate = join(
    resources,
    DESKTOP_HOST_RESOURCE,
    'node_modules',
    '@deepseek-ai/dsh',
    'lib',
    'bin.js',
  )
  return existsSync(candidate) ? candidate : undefined
}

/**
 * Bundled frontend dist directory.
 * @param processLike - `process` or a test stub.
 * @returns the directory that contains `index.html`, or undefined when unpackaged.
 */
export function resolveBundledFrontendDist(processLike: DesktopProcessPaths = process): string | undefined {
  const resources = desktopResourcesRoot(processLike)
  if (resources === undefined) return undefined
  const index = join(resources, DESKTOP_FRONTEND_RESOURCE, 'index.html')
  return existsSync(index) ? dirname(index) : undefined
}

/**
 * Bundled profile template directory (stamp + profile files).
 * @param processLike - `process` or a test stub.
 * @returns the directory that contains `version-stamp`, or undefined when unpackaged.
 */
export function resolveBundledProfileTemplate(processLike: DesktopProcessPaths = process): string | undefined {
  const resources = desktopResourcesRoot(processLike)
  if (resources === undefined) return undefined
  const dir = join(resources, DESKTOP_PROFILE_TEMPLATE_RESOURCE)
  if (!existsSync(dir)) return undefined
  const stamp = join(dir, 'version-stamp')
  if (!existsSync(stamp)) {
    throw new Error(`desktop: profile-template is present but missing version-stamp at ${stamp}`)
  }
  return dir
}
