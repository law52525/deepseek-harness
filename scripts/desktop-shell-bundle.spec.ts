import { describe, expect, it } from 'vitest'
import {
  assertDesktopShellBundleSelfContained,
  leftoverPackageImports,
} from './desktop-shell-bundle.ts'

describe('desktop shell bundle', () => {
  it('allows electron and node builtins and rejects leftover package imports', () => {
    expect(leftoverPackageImports(
      'import { app } from "electron"\nimport { readFile } from "node:fs/promises"\n',
    )).toEqual([])
    expect(leftoverPackageImports(
      'import { parseDesktopEnvelope } from "@deepseek-ai/dsh-desktop-app/ipc-protocol"\n'
      + 'import { autoUpdater } from "electron-updater"\n',
    )).toEqual(['@deepseek-ai/dsh-desktop-app/ipc-protocol', 'electron-updater'])
    expect(() => {
      assertDesktopShellBundleSelfContained(
        'import { parseDesktopEnvelope } from "@deepseek-ai/dsh-desktop-app/ipc-protocol"\n',
        'lib/main.js',
      )
    }).toThrow(/dsh-desktop-app\/ipc-protocol/)
  })
})
