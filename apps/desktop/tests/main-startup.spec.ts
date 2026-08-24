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

  it('installs process crash listeners so a pre-window throw is not silent', () => {
    expect(main).toMatch(/uncaughtException/)
    expect(main).toMatch(/unhandledRejection/)
  })
})
