; Overlay install: electron-builder's "app cannot be closed" dialog is a lie.
; The Electron exe is usually already gone. Overlay fails because the *old*
; uninstaller atomicRMDir cannot rename MAX_PATH files under
; resources\host\node_modules, then retries 5 times and shows that dialog.
; Also: packaged Host is hidden resources\host\node.exe.
;
; This include:
;   1. taskkill exact APP_EXECUTABLE_FILENAME (not the installer, not Uninstall)
;   2. stop packaged Host node.exe via a .ps1 (no nsExec -Command $ _ eating)
;   3. robocopy /MIR an empty dir over $INSTDIR (handles long paths)
;   4. drop UninstallString so uninstallOldVersion never runs the old uninstaller
;
; customCheckAppRunning also deletes the previous install (robocopy /MIR).
; That is beyond the stock macro (which only checks/closes the running app).
; Known and accepted: if the user cancels after this step, the old files
; are already gone. The previous uninstaller is copied to $PLUGINSDIR before
; /MIR and copied back in customUnInstallCheck so Apps & Features still has
; a working UninstallString (customInstall / registryAddInstallInfo rewrite
; it at success).

!macro writeUninstallString
  ; Same shape as electron-builder registryAddInstallInfo.
  ${if} $installMode == "all"
    StrCpy $0 "/allusers"
  ${else}
    StrCpy $0 "/currentuser"
  ${endIf}
  StrCpy $2 "$INSTDIR\${UNINSTALL_FILENAME}"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$2" $0'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$2" $0 /S'
  !ifdef UNINSTALL_REGISTRY_KEY_2
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString '"$2" $0'
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString '"$2" $0 /S'
  !endif
!macroend

!macro saveUninstallerAside
  ${If} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
    CopyFiles /SILENT "$INSTDIR\${UNINSTALL_FILENAME}" "$PLUGINSDIR\saved-uninstaller.exe"
  ${EndIf}
!macroend

!macro restoreUninstallerAndString
  ; Only rewrite UninstallString when the exe is actually on disk, so a
  ; cancelled first install does not create a dead Apps & Features entry,
  ; and an overlay cancel still has a working uninstaller (saved before /MIR).
  ${If} ${FileExists} "$PLUGINSDIR\saved-uninstaller.exe"
  ${AndIfNot} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
    CopyFiles /SILENT "$PLUGINSDIR\saved-uninstaller.exe" "$INSTDIR\${UNINSTALL_FILENAME}"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
    !insertmacro writeUninstallString
  ${EndIf}
!macroend

!macro maybeMirrorInstallDir
  ; /MIR deletes the target. Refuse empty $INSTDIR and directories that
  ; are not this product (user changed the wizard path to something else).
  ; Name-only is not enough (a folder merely named ${PRODUCT_FILENAME} can
  ; hold unrelated files). Generic resources\app.asar is not enough either
  ; (any Electron app). Require our exe, or our name plus app.asar.
  StrCpy $R8 "skip"
  StrCpy $R3 "0"
  ${If} "$INSTDIR" != ""
    StrCpy $R7 "$INSTDIR"
    StrCpy $R6 "$R7" 1 -1
    ${If} $R6 == "\"
      StrLen $R5 $R7
      IntOp $R5 $R5 - 1
      StrCpy $R7 "$R7" $R5
    ${EndIf}
    StrLen $R5 "${PRODUCT_FILENAME}"
    IntOp $R4 $R5 + 1
    StrCpy $R6 "$R7" $R4 -$R4
    ${If} $R6 == "\${PRODUCT_FILENAME}"
    ${OrIf} $R7 == "${PRODUCT_FILENAME}"
      StrCpy $R3 "1"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      StrCpy $R8 "ok"
    ${ElseIf} $R3 == "1"
    ${AndIf} ${FileExists} "$INSTDIR\resources\app.asar"
      StrCpy $R8 "ok"
    ${Else}
      DetailPrint `Skip mirror: $INSTDIR is not a ${PRODUCT_FILENAME} install`
    ${EndIf}
  ${Else}
    DetailPrint `Skip mirror: installation directory is empty`
  ${EndIf}

  ${If} $R8 == "ok"
    CreateDirectory "$PLUGINSDIR\empty-mirror"
    nsExec::ExecToLog `robocopy "$PLUGINSDIR\empty-mirror" "$INSTDIR" /MIR /NFL /NDL /NJH /NJS /R:0 /W:0`
    Pop $R9
    ; robocopy: 0-7 success, >=8 failure. Do not continue into a mixed tree.
    ${If} $R9 >= 8
      DetailPrint `robocopy failed ($R9) under $INSTDIR`
      !insertmacro restoreUninstallerAndString
      MessageBox MB_OK|MB_ICONSTOP `Could not replace previous files in $INSTDIR.`
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customCheckAppRunning
  DetailPrint `Closing ${PRODUCT_NAME} and packaged Host...`
  nsExec::Exec `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R9
  FileOpen $R8 "$PLUGINSDIR\stop-host.ps1" w
  FileWrite $R8 "param([Parameter(Mandatory=$$true)][string]$$InstDir)$\r$\n"
  FileWrite $R8 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
  ; Exact $INSTDIR host (not a PRODUCT_NAME glob). Pass INSTDIR as -InstDir so
  ; apostrophes/spaces do not break a quoted literal. GetFullPath -eq avoids
  ; -like wildcards. Never image-kill every node.exe.
  FileWrite $R8 "$$target = [System.IO.Path]::GetFullPath((Join-Path $$InstDir 'resources\host\node.exe'))$\r$\n"
  FileWrite $R8 "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and ([System.IO.Path]::GetFullPath($$_.ExecutablePath) -eq $$target) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }$\r$\n"
  FileClose $R8
  nsExec::ExecToLog `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-host.ps1" -InstDir "$INSTDIR"`
  Pop $R9
  Sleep 400
  DetailPrint `Removing previous ${PRODUCT_NAME} files...`
  !insertmacro saveUninstallerAside
  !insertmacro maybeMirrorInstallDir
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
  !endif
!macroend

!macro customRemoveFiles
  DetailPrint `Removing ${PRODUCT_NAME} files...`
  !insertmacro maybeMirrorInstallDir
  ; Uninstall also ran customCheckAppRunning, which may already have /MIR'd
  ; the tree (exe/asar gone). Still RMDir when the folder name is ours.
  ${If} $R8 == "ok"
  ${OrIf} $R3 == "1"
    RMDir /r $INSTDIR
  ${EndIf}
!macroend

!macro customUnInstallCheck
  ; If an older installer still launched the previous uninstaller, do not Quit.
  ; Assisted UAC inner skips CHECK_APP_RUNNING — save whatever uninstaller is
  ; left, guarded /MIR the mixed tree, then put the uninstaller back so Cancel
  ; still has a working Apps & Features entry.
  !insertmacro saveUninstallerAside
  !insertmacro maybeMirrorInstallDir
  !insertmacro restoreUninstallerAndString
!macroend

!macro customInstall
  ; registryAddInstallInfo (installSection, after installApplicationFiles)
  ; already writes UninstallString. Write again so overlay always restores
  ; the value customCheckAppRunning deleted to skip uninstallOldVersion.
  !insertmacro writeUninstallString
!macroend
