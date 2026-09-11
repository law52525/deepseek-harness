/** NSIS overlay must skip the old uninstaller and not use find.exe substring matching. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(import.meta.dirname, '..')

describe('desktop NSIS overlay include', () => {
  const nsh = readFileSync(resolve(desktopRoot, 'installer.nsh'), 'utf8')

  it('replaces process detection with an exact Electron exe name plus packaged Host path', () => {
    expect(nsh).toContain('!macro customCheckAppRunning')
    expect(nsh).toContain('!macro customRemoveFiles')
    expect(nsh).toContain('!macro customUnInstallCheck')
    expect(nsh).toContain('taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"')
    expect(nsh).toContain('*\\${PRODUCT_NAME}\\resources\\host\\node.exe')
    expect(nsh).toContain('-File "$PLUGINSDIR\\wandox-stop-host.ps1"')
    expect(nsh).not.toMatch(/taskkill \/IM node\.exe/i)
    expect(nsh).not.toContain('find.exe')
    expect(nsh).not.toMatch(/MessageBox.*appCannotBeClosed/)
  })

  it('clears the install dir with robocopy and skips uninstallOldVersion', () => {
    expect(nsh).toContain('robocopy "$PLUGINSDIR\\wandox-empty" "$INSTDIR" /MIR')
    expect(nsh).toContain('DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString')
  })
})
