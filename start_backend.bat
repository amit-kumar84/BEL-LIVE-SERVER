@echo off
rem BEL Cyber Network Operations Status - backend-only launcher.
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"
set "VENV=%ROOT%\.venv"
set "PY=%VENV%\Scripts\python.exe"
set "BACKEND_LOG=%ROOT%\backend.log"
set "BACKEND_ERROR_LOG=%ROOT%\backend-error.log"

if not exist "%PY%" (
  where py >nul 2>nul
  if errorlevel 1 (
    echo Python 3.11 or newer is required.
    pause
    exit /b 1
  )
  py -3 -m venv "%VENV%"
  if errorlevel 1 goto :failed
)

if not exist "%VENV%\cybernoc-deps.ok" (
  "%PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
  if errorlevel 1 goto :failed
  type nul > "%VENV%\cybernoc-deps.ok"
)

if not exist "data" mkdir data
if not exist "C:\CyberNOC\audio" mkdir "C:\CyberNOC\audio" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content.Contains('127.0.0.1')){exit 0} } catch {}; exit 1"
if errorlevel 1 powershell -NoProfile -ExecutionPolicy Bypass -Command "$null = Start-Process -FilePath '%PY%' -ArgumentList '-m','uvicorn','app.main:app','--app-dir','backend','--host','127.0.0.1','--port','8000' -WorkingDirectory '%ROOT%' -RedirectStandardOutput '%BACKEND_LOG%' -RedirectStandardError '%BACKEND_ERROR_LOG%' -WindowStyle Minimized"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content.Contains('127.0.0.1')){$ready=$true;break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ready){exit 1}"
if errorlevel 1 (
  echo BEL CyberNOC backend did not become ready.
  echo Review backend.log and backend-error.log.
  pause
  exit /b 1
)

echo BEL CyberNOC backend is ready at http://127.0.0.1:8000
echo Health check: http://127.0.0.1:8000/api/health
echo Logs: backend.log and backend-error.log
exit /b 0

:failed
echo BEL CyberNOC backend setup failed.
pause
exit /b 1
