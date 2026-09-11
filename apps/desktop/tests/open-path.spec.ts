/** openPathAndQuit: quit only after a successful open. */

import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openPathAndQuit } from '../src/open-path.ts'

const absWin = resolve('Setup.exe')
const absDmg = resolve('App.dmg')

describe('open-path-and-quit', () => {
  it('windows: detached spawn then quit; spawn throw does not quit', async () => {
    const quit = vi.fn()
    const child = {
      unref: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
    }
    const spawn = vi.fn(() => child)
    const result = await openPathAndQuit(absWin, {
      platform: 'win32',
      spawn,
      openPath: async () => '',
      quit,
    })
    expect(result).toEqual({ ok: true })
    expect(spawn).toHaveBeenCalledWith(absWin, [], { detached: true, stdio: 'ignore' })
    expect(child.unref).toHaveBeenCalled()
    expect(quit).toHaveBeenCalledTimes(1)

    const quit2 = vi.fn()
    const failed = await openPathAndQuit(absWin, {
      platform: 'win32',
      spawn: () => { throw new Error('spawn failed') },
      openPath: async () => '',
      quit: quit2,
    })
    expect(failed).toEqual({ ok: false, detail: 'spawn failed' })
    expect(quit2).not.toHaveBeenCalled()
  })

  it('windows: async spawn error does not quit', async () => {
    const quit = vi.fn()
    const child = {
      unref: vi.fn(),
      once: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') queueMicrotask(() => { listener(new Error('spawn ENOENT')) })
      },
      removeListener: vi.fn(),
    }
    const failed = await openPathAndQuit(absWin, {
      platform: 'win32',
      spawn: () => child,
      openPath: async () => '',
      quit,
    })
    expect(failed).toEqual({ ok: false, detail: 'spawn ENOENT' })
    expect(quit).not.toHaveBeenCalled()
    expect(child.unref).not.toHaveBeenCalled()
  })

  it('darwin: openPath empty string then quit; error string does not quit', async () => {
    const quit = vi.fn()
    const ok = await openPathAndQuit(absDmg, {
      platform: 'darwin',
      spawn: vi.fn(),
      openPath: async () => '',
      quit,
    })
    expect(ok).toEqual({ ok: true })
    expect(quit).toHaveBeenCalledTimes(1)

    const quit2 = vi.fn()
    const failed = await openPathAndQuit(absDmg, {
      platform: 'darwin',
      spawn: vi.fn(),
      openPath: async () => 'Failed to open',
      quit: quit2,
    })
    expect(failed).toEqual({ ok: false, detail: 'Failed to open' })
    expect(quit2).not.toHaveBeenCalled()
  })

  it('rejects a relative path and does not quit', async () => {
    const quit = vi.fn()
    const result = await openPathAndQuit('Setup.exe', {
      platform: 'darwin',
      spawn: vi.fn(),
      openPath: async () => '',
      quit,
    })
    expect(result.ok).toBe(false)
    expect(quit).not.toHaveBeenCalled()
  })
})
