!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Var KeepAliveCheckbox
Var KeepAliveEnabled
Var LicenseAcceptanceCheckbox
Var AuthorizedCheckbox

!macro customPageAfterChangeDir
  !insertmacro MUI_PAGE_LICENSE "${BUILD_RESOURCES_DIR}\installer-agreement.txt"
  Page custom DeploymentOptionsPage DeploymentOptionsPageLeave
!macroend

!macro customInit
  nsExec::ExecToLog 'sc.exe stop BELCyberNOCBackend'
  nsExec::ExecToLog 'taskkill.exe /F /T /IM "BEL CyberNOC.exe"'
  nsExec::ExecToLog 'taskkill.exe /F /T /IM "CyberNOCBackend.exe"'
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq ''python.exe'' -and $$_.CommandLine -like ''*uvicorn app.main:app*--app-dir backend*--port 8000*'' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
  Sleep 1500
!macroend

Function DeploymentOptionsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "DEPLOYMENT OPTIONS"
  SetCtlColors $0 0x00F5FF 0x09111A
  ${NSD_CreateLabel} 0 27 100% 52u "BEL CyberNOC performs local network monitoring. Confirm that you are authorized to monitor the systems and networks you configure. You are responsible for protecting credentials and complying with applicable policies and law."
  SetCtlColors $0 0xA8F7FF 0x09111A

  ${NSD_CreateCheckbox} 0 91 100% 25u "I have read and accept the license and deployment terms."
  Pop $LicenseAcceptanceCheckbox
  ${NSD_SetState} $LicenseAcceptanceCheckbox 0

  ${NSD_CreateCheckbox} 0 123 100% 25u "I am authorized to monitor these systems and networks."
  Pop $AuthorizedCheckbox
  ${NSD_SetState} $AuthorizedCheckbox 0

  ${NSD_CreateCheckbox} 0 155 100% 30u "Start at sign-in and restore after closure (24/7 operation mode)."
  Pop $KeepAliveCheckbox
  ${NSD_SetState} $KeepAliveCheckbox 1

  nsDialogs::Show
FunctionEnd

Function DeploymentOptionsPageLeave
  ${NSD_GetState} $LicenseAcceptanceCheckbox $0
  ${If} $0 != 1
    MessageBox MB_OK|MB_ICONSTOP "Read and accept the license and deployment terms before continuing."
    Abort
  ${EndIf}

  ${NSD_GetState} $AuthorizedCheckbox $0
  ${If} $0 != 1
    MessageBox MB_OK|MB_ICONSTOP "Confirm that you are authorized to monitor these systems and networks before continuing."
    Abort
  ${EndIf}

  ${NSD_GetState} $KeepAliveCheckbox $KeepAliveEnabled
FunctionEnd
!endif

!macro customInstall
  SetShellVarContext current
  CreateDirectory "C:\CyberNOC\audio"
  CreateDirectory "$SMPROGRAMS\BEL CyberNOC"
  CreateShortCut "$SMPROGRAMS\BEL CyberNOC\Alert Audio Folder.lnk" "C:\CyberNOC\audio"
  IfFileExists "C:\CyberNOC\audio\down-default-alert.mp3" defaultDownAudioExists
  CopyFiles /SILENT "$INSTDIR\resources\audio-defaults\down-default-alert.mp3" "C:\CyberNOC\audio"
defaultDownAudioExists:
  IfFileExists "C:\CyberNOC\audio\restored-default-alert.mp3" defaultRestoredAudioExists
  CopyFiles /SILENT "$INSTDIR\resources\audio-defaults\restored-default-alert.mp3" "C:\CyberNOC\audio"
defaultRestoredAudioExists:
  ${If} $KeepAliveEnabled == 1
    CreateDirectory "$SMSTARTUP"
    CreateShortCut "$SMSTARTUP\BEL CyberNOC 24-7.lnk" "$SYSDIR\wscript.exe" "//B //NoLogo $\"$INSTDIR\resources\watchdog.vbs$\"" "$INSTDIR\bel.ico"
    WriteRegDWORD HKCU "Software\BEL CyberNOC" "KeepAlive" 1
  ${Else}
    Delete "$SMSTARTUP\BEL CyberNOC 24-7.lnk"
    WriteRegDWORD HKCU "Software\BEL CyberNOC" "KeepAlive" 0
  ${EndIf}
!macroend

!macro customUnInstall
  SetShellVarContext current
  WriteRegDWORD HKCU "Software\BEL CyberNOC" "KeepAlive" 0
  Delete "$SMSTARTUP\BEL CyberNOC 24-7.lnk"
  Delete "$SMPROGRAMS\BEL CyberNOC\Alert Audio Folder.lnk"
  DeleteRegKey HKCU "Software\BEL CyberNOC"
!macroend