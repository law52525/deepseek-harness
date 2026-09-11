/** Packaged Windows CJK install paths must still show a window. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

describe('desktop shell startup', () => {
  it('creates the main window before waiting for host-ready', () => {
    const windowIdx = main.indexOf('windowRef = createMainWindow()')
    const awaitIdx = main.indexOf('await child.awaitReady()')
    expect(windowIdx).toBeGreaterThan(-1)
    expect(awaitIdx).toBeGreaterThan(-1)
    expect(windowIdx).toBeLessThan(awaitIdx)
  })

  it('packaged ready path does not start electron-updater (D-14 AC-15)', () => {
    const readyIdx = main.indexOf('void app.whenReady()')
    const closedIdx = main.indexOf("app.on('window-all-closed'")
    expect(readyIdx).toBeGreaterThan(-1)
    expect(closedIdx).toBeGreaterThan(readyIdx)
    const ready = main.slice(readyIdx, closedIdx)
    expect(ready).not.toContain('startDesktopAutoUpdate')
    expect(main).toContain("from './auto-update.ts'")
  })

  it('open-path-and-quit disarms the overlay before quit (D-14)', () => {
    const start = main.indexOf('openPathAndQuit:')
    const end = main.indexOf('openExternal:')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(main.slice(start, end)).toContain("disarm('update-install')")
  })

  it('installs process crash listeners so a pre-window throw is not silent', () => {
    expect(main).toMatch(/uncaughtException/)
    expect(main).toMatch(/unhandledRejection/)
  })

  it('does not re-load the Host error page after the first terminal failure', () => {
    const start = main.indexOf('function enterHostFailure')
    const end = main.indexOf('function registerProtocol')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(main.slice(start, end)).toContain('if (hostFailed) return')
  })

  it('does not turn a failed error-page loadURL into another unhandledRejection', () => {
    const start = main.indexOf('function showHostError')
    const end = main.indexOf('function enterHostFailure')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(main.slice(start, end)).toContain('.catch(')
  })

  it('clips process-failure text before logging or showing it', () => {
    expect(main).toContain('summarizeDesktopFailure')
  })
})
