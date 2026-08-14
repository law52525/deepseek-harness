/** System Node resolution never returns Electron. */

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isElectronExecutable, resolveNodeExecutable } from '../src/node-executable.ts'

describe('node executable', () => {
  it('rejects Electron binaries and returns a real Node path', () => {
    expect(isElectronExecutable('/usr/local/bin/electron')).toBe(true)
    expect(isElectronExecutable('C:\\Program Files\\electron.exe')).toBe(true)
    expect(isElectronExecutable('/Applications/Electron.app/Contents/MacOS/Electron')).toBe(true)
    expect(isElectronExecutable(process.execPath)).toBe(false)
    const resolved = resolveNodeExecutable()
    expect(isElectronExecutable(resolved)).toBe(false)
    expect(existsSync(resolved)).toBe(true)
  })
})
