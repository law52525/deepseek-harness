/** NSIS overlay must skip the old uninstaller and not use find.exe substring matching. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(import.meta.dirname, '..')
const nsh = readFileSync(resolve(desktopRoot, 'installer.nsh'), 'utf8')

function macroBody(name: string): string {
  const start = nsh.indexOf(`!macro ${name}`)
  expect(start, `missing !macro ${name}`).toBeGreaterThan(-1)
  const end = nsh.indexOf('!macroend', start)
  expect(end, `missing !macroend for ${name}`).toBeGreaterThan(start)
  return nsh.slice(start, end)
}

function assertMirrorGuard(body: string, label: string) {
  const robocopy = body.search(/nsExec::ExecToLog `robocopy /)
  expect(robocopy, `${label} must robocopy`).toBeGreaterThan(-1)
  const before = body.slice(0, robocopy)
  expect(before, `${label} must refuse empty $INSTDIR`).toMatch(/"\$INSTDIR" != ""/)
  expect(before, `${label} must require PRODUCT_FILENAME`).toContain('${PRODUCT_FILENAME}')
  expect(before, `${label} must accept APP_EXECUTABLE_FILENAME marker`).toContain(
    '$INSTDIR\\${APP_EXECUTABLE_FILENAME}',
  )
  expect(before, `${label} must not treat name-only as enough to /MIR`).toMatch(
    /\$R3 == "1"\s*\n\s*\$\{AndIf\} \$\{FileExists\} "\$INSTDIR\\resources\\app\.asar"/,
  )
  expect(before, `${label} must not accept generic app.asar alone`).not.toMatch(
    /\$\{ElseIf\} \$\{FileExists\} "\$INSTDIR\\resources\\app\.asar"\s*\n\s*StrCpy \$R8 "ok"/,
  )
  expect(before, `${label} must DetailPrint why mirror was skipped`).toMatch(/DetailPrint `Skip mirror:/)
}

function assertRobocopyExit(body: string, label: string) {
  const pop = body.indexOf('Pop $R9')
  expect(pop, `${label} must Pop robocopy exit`).toBeGreaterThan(-1)
  const after = body.slice(pop)
  expect(after, `${label} must treat robocopy >= 8 as failure`).toMatch(/\$R9 >= 8/)
  expect(after, `${label} must Abort on robocopy failure`).toContain('Abort')
  expect(after, `${label} abort text must include $INSTDIR`).toContain('$INSTDIR')
}

describe('desktop NSIS overlay include', () => {
  it('replaces process detection with an exact Electron exe name plus packaged Host path', () => {
    expect(nsh).toContain('!macro customCheckAppRunning')
    expect(nsh).toContain('!macro customRemoveFiles')
    expect(nsh).toContain('!macro customUnInstallCheck')
    expect(nsh).toContain('taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"')
    expect(nsh).toContain('Join-Path $$InstDir \'resources\\host\\node.exe\'')
    expect(nsh).toContain('-InstDir "$INSTDIR"')
    expect(nsh).not.toContain('*\\${PRODUCT_NAME}\\resources\\host\\node.exe')
    expect(nsh).toContain('-File "$PLUGINSDIR\\stop-host.ps1"')
    expect(nsh).not.toMatch(/^\s*[^;].*taskkill \/IM node\.exe/im)
    expect(nsh).not.toContain('find.exe')
    expect(nsh).not.toMatch(/MessageBox.*appCannotBeClosed/)
  })

  it('clears the install dir with robocopy and skips uninstallOldVersion', () => {
    expect(nsh).toContain('robocopy "$PLUGINSDIR\\empty-mirror" "$INSTDIR" /MIR')
    expect(nsh).toContain('DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString')
  })

  it('guards $INSTDIR before robocopy /MIR in both overlay macros', () => {
    assertMirrorGuard(macroBody('maybeMirrorInstallDir'), 'maybeMirrorInstallDir')
    expect(macroBody('customCheckAppRunning')).toContain('!insertmacro maybeMirrorInstallDir')
    expect(macroBody('customRemoveFiles')).toContain('!insertmacro maybeMirrorInstallDir')
    const remove = macroBody('customRemoveFiles')
    expect(remove).toContain('RMDir /r $INSTDIR')
    expect(remove).toMatch(/\$R8 == "ok"[\s\S]*\$R3 == "1"/)
  })

  it('aborts when robocopy returns >= 8', () => {
    assertRobocopyExit(macroBody('maybeMirrorInstallDir'), 'maybeMirrorInstallDir')
  })

  it('matches packaged Host against $INSTDIR, not a product-name glob', () => {
    const check = macroBody('customCheckAppRunning')
    expect(check).toContain('-InstDir "$INSTDIR"')
    expect(check).toContain('Join-Path $$InstDir \'resources\\host\\node.exe\'')
    expect(check).not.toMatch(/GetFullPath\('\$INSTDIR/)
    expect(check).not.toContain('*\\${PRODUCT_NAME}\\resources\\host\\node.exe')
    expect(check).toContain('GetFullPath($$_.ExecutablePath) -eq $$target')
    expect(nsh).not.toMatch(/^\s*[^;].*taskkill \/IM node\.exe/im)
  })

  it('writes UninstallString back after skipping uninstallOldVersion', () => {
    const writeBack = macroBody('writeUninstallString')
    expect(writeBack).toContain('WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString')
    expect(writeBack).toContain('$INSTDIR\\${UNINSTALL_FILENAME}')
    expect(macroBody('customInstall')).toContain('!insertmacro writeUninstallString')
    const restore = macroBody('restoreUninstallerAndString')
    expect(restore).toContain('$PLUGINSDIR\\saved-uninstaller.exe')
    expect(restore).toMatch(
      /FileExists\} "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"\s*\n\s*!insertmacro writeUninstallString/,
    )
    expect(macroBody('customCheckAppRunning')).toContain('!insertmacro saveUninstallerAside')
    expect(macroBody('customUnInstallCheck')).toContain('!insertmacro restoreUninstallerAndString')
    expect(macroBody('customUnInstallCheck')).toContain('!insertmacro maybeMirrorInstallDir')
    const deleteAt = nsh.indexOf('DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString')
    const customInstallAt = nsh.indexOf('!macro customInstall')
    expect(deleteAt).toBeGreaterThan(-1)
    expect(customInstallAt).toBeGreaterThan(deleteAt)
  })
})
