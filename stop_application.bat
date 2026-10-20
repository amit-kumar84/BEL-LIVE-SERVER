@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Stopping BEL CyberNOC backend only. Frontend will stay running...
echo.

sc query BELCyberNOCBackend >nul 2>&1
if errorlevel 1 goto :stop_process
sc query BELCyberNOCBackend | findstr /I "RUNNING" >nul
if errorlevel 1 goto :stop_process
sc stop BELCyberNOCBackend >nul
if errorlevel 1 (
  echo Could not stop backend service. Check Windows Services or run as Administrator.
  exit /b 1
)
echo Backend Windows service stop requested.
powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 30;$i++){ $s=Get-Service BELCyberNOCBackend -ErrorAction SilentlyContinue; if(-not $s -or $s.Status -eq 'Stopped'){exit 0}; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo Backend service did not stop within 15 seconds.
  exit /b 1
)
goto :done

:stop_process
powershell -NoProfile -ExecutionPolicy Bypass -Command "$python=(Join-Path (Get-Location).Path '.venv\Scripts\python.exe'); $procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*' + $python + '*') -and $_.CommandLine -match 'uvicorn|app\.main:app' }; if ($null -eq $procs) { Write-Host 'No BEL CyberNOC backend process found.'; exit 0 }; $count = 0; foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $count++; Write-Host 'Stopped backend PID ' $p.ProcessId } catch { Write-Host 'Could not stop backend PID ' $p.ProcessId } }; Write-Host 'Backend processes stopped: ' $count;"

if errorlevel 1 (
  echo.
  echo Failed to stop some BEL CyberNOC background services.
  exit /b 1
)

echo.
echo Backend stopped. Frontend remains running.
exit /b 0

:done
echo Frontend service was not stopped.
exit /b 0
