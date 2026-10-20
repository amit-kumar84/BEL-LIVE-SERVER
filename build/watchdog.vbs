Option Explicit

Dim shell, fileSystem, wmi, appPath, query, processes, keepAlive
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
appPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName)), "BEL CyberNOC.exe")
query = "SELECT ProcessId FROM Win32_Process WHERE Name='BEL CyberNOC.exe'"

Do
  On Error Resume Next
  keepAlive = shell.RegRead("HKCU\Software\BEL CyberNOC\KeepAlive")
  If Err.Number <> 0 Then WScript.Quit 0
  Err.Clear
  On Error GoTo 0
  If CLng(keepAlive) <> 1 Then WScript.Quit 0

  Set processes = wmi.ExecQuery(query)
  If processes.Count = 0 Then shell.Run """" & appPath & """ --kiosk-guard", 0, False
  WScript.Sleep 30000
Loop