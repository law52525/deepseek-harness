/**
 * Open a local installer and quit. Host plugins send an absolute path;
 * this module does not know product names or download URLs.
 */
import { isAbsolute } from 'node:path'

export interface SpawnedInstaller {
  unref(): void
  once(event: 'error', listener: (error: Error) => void): void
  removeListener(event: 'error', listener: (error: Error) => void): void
}

export interface OpenPathAndQuitDeps {
  platform: NodeJS.Platform
  spawn: (
    command: string,
    args: string[],
    options: { detached: true; stdio: 'ignore' },
  ) => SpawnedInstaller
  openPath: (target: string) => Promise<string>
  quit: () => void
}

export type OpenPathAndQuitResult = { ok: true } | { ok: false; detail: string }

/**
 * Open `path` with the OS default handler, then quit on success.
 * Windows starts the exe detached first so NSIS can overwrite files.
 * Failure must not quit. A Windows spawn that only fails on the async
 * `error` event (ENOENT) must not quit either.
 * @param path - absolute filesystem path
 * @param deps - process/platform seams
 */
export async function openPathAndQuit(path: string, deps: OpenPathAndQuitDeps): Promise<OpenPathAndQuitResult> {
  if (typeof path !== 'string' || path.trim() === '' || !isAbsolute(path)) {
    return { ok: false, detail: 'path must be absolute' }
  }
  if (deps.platform === 'win32') {
    let child: SpawnedInstaller
    try {
      child = deps.spawn(path, [], { detached: true, stdio: 'ignore' })
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
    const spawned = await waitWindowsSpawn(child)
    if (!spawned.ok) return spawned
    deps.quit()
    return { ok: true }
  }
  let opened: string
  try {
    opened = await deps.openPath(path)
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  if (opened !== '') {
    return { ok: false, detail: opened }
  }
  deps.quit()
  return { ok: true }
}

/**
 * Node often emits spawn ENOENT on `error` in the next tick instead of throwing.
 * setImmediate runs after that tick; an `error` before it means do not quit.
 */
function waitWindowsSpawn(child: SpawnedInstaller): Promise<OpenPathAndQuitResult> {
  return new Promise((resolve) => {
    const onError = (error: Error): void => {
      clearImmediate(ok)
      resolve({ ok: false, detail: error.message })
    }
    child.once('error', onError)
    const ok = setImmediate(() => {
      child.removeListener('error', onError)
      child.unref()
      resolve({ ok: true })
    })
  })
}
