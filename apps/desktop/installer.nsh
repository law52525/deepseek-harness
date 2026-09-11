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

!macro customCheckAppRunning
  DetailPrint `Closing ${PRODUCT_NAME} and packaged Host...`
  nsExec::Exec `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R9
  FileOpen $R8 "$PLUGINSDIR\wandox-stop-host.ps1" w
  FileWrite $R8 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
  FileWrite $R8 "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '*\${PRODUCT_NAME}\resources\host\node.exe' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }$\r$\n"
  FileClose $R8
  nsExec::ExecToLog `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\wandox-stop-host.ps1"`
  Pop $R9
  Sleep 400
  DetailPrint `Removing previous ${PRODUCT_NAME} files...`
  CreateDirectory "$PLUGINSDIR\wandox-empty"
  nsExec::ExecToLog `robocopy "$PLUGINSDIR\wandox-empty" "$INSTDIR" /MIR /NFL /NDL /NJH /NJS /R:0 /W:0`
  Pop $R9
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
  !endif
!macroend

!macro customRemoveFiles
  DetailPrint `Removing ${PRODUCT_NAME} files...`
  CreateDirectory "$PLUGINSDIR\wandox-empty"
  nsExec::ExecToLog `robocopy "$PLUGINSDIR\wandox-empty" "$INSTDIR" /MIR /NFL /NDL /NJH /NJS /R:0 /W:0`
  Pop $R9
  RMDir /r $INSTDIR
!macroend

!macro customUnInstallCheck
  ; If an older installer still launched the previous uninstaller, do not Quit.
!macroend
