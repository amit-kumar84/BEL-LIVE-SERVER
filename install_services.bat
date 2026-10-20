@echo off
rem Install BEL CyberNOC as automatic Windows services using NSSM.
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"
set "VENV=%ROOT%\.venv"
set "PY=%VENV%\Scripts\python.exe"
set "NSSM=%ROOT%\nssm.exe"
set "NODE="

echo =========================================================
echo BEL CyberNOC Windows Service Setup
echo =========================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: Run this file as Administrator.
  pause
  exit /b 1
)

if not exist "%NSSM%" set "NSSM="
if not defined NSSM for /f "delims=" %%N in ('where nssm.exe 2^>nul') do if not defined NSSM set "NSSM=%%N"
if not defined NSSM (
  echo ERROR: NSSM was not found.
  echo Put nssm.exe beside this BAT file or add it to PATH, then rerun.
  echo NSSM is required to register Python and Node as Windows services.
  pause
  exit /b 1
)

for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%N"
if not defined NODE (
  echo ERROR: Node.js 20 or newer is required.
  pause
  exit /b 1
)

sc query BELCyberNOCBackend >nul 2>&1
if not errorlevel 1 goto :already_installed
sc query BELCyberNOCFrontend >nul 2>&1
if not errorlevel 1 goto :already_installed

powershell -NoProfile -ExecutionPolicy Bypass -Command "if(Get-NetTCPConnection -State Listen -LocalPort 8000,5173 -ErrorAction SilentlyContinue){exit 1}; exit 0"
if errorlevel 1 goto :ports_in_use

if not exist "%PY%" (
  echo Creating Python virtual environment...
  where py >nul 2>nul
  if errorlevel 1 goto :python_missing
  py -3 -m venv "%VENV%"
  if errorlevel 1 goto :failed
)

echo Installing backend dependencies...
"%PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 goto :failed

echo Installing locked frontend dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto :failed

echo Building production frontend...
call npm run build
if errorlevel 1 goto :failed
if not exist "dist\index.html" goto :failed
if not exist "data" mkdir data
if not exist "C:\CyberNOC\audio" mkdir "C:\CyberNOC\audio" 2>nul

echo Registering backend service with automatic crash restart...
"%NSSM%" install BELCyberNOCBackend "%PY%" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCBackend AppDirectory "%ROOT%"
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCBackend AppStdout "%ROOT%\backend.log"
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCBackend AppStderr "%ROOT%\backend-error.log"
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCBackend AppRotateFiles 1
"%NSSM%" set BELCyberNOCBackend AppRotateBytes 10485760
"%NSSM%" set BELCyberNOCBackend AppExit Default Restart
"%NSSM%" set BELCyberNOCBackend AppRestartDelay 5000
"%NSSM%" set BELCyberNOCBackend Start SERVICE_AUTO_START
if errorlevel 1 goto :failed

echo Registering production frontend service with automatic crash restart...
"%NSSM%" install BELCyberNOCFrontend "%NODE%" "%ROOT%\node_modules\serve\build\main.js" -s dist -l tcp://127.0.0.1:5173
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCFrontend AppDirectory "%ROOT%"
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCFrontend AppStdout "%ROOT%\frontend.log"
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCFrontend AppStderr "%ROOT%\frontend-error.log"
if errorlevel 1 goto :failed
"%NSSM%" set BELCyberNOCFrontend AppRotateFiles 1
"%NSSM%" set BELCyberNOCFrontend AppRotateBytes 10485760
"%NSSM%" set BELCyberNOCFrontend AppExit Default Restart
"%NSSM%" set BELCyberNOCFrontend AppRestartDelay 5000
"%NSSM%" set BELCyberNOCFrontend Start SERVICE_AUTO_START
if errorlevel 1 goto :failed

echo Starting Windows services...
"%NSSM%" start BELCyberNOCBackend
if errorlevel 1 goto :failed
"%NSSM%" start BELCyberNOCFrontend
if errorlevel 1 goto :failed

powershell -NoProfile -ExecutionPolicy Bypass -Command "$api=$false; $web=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){$api=$true} } catch {}; try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173 -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content -match '/assets/' -and $r.Content -notmatch '/@vite/client'){$web=$true} } catch {}; if($api -and $web){break}; Start-Sleep -Milliseconds 500 }; if(-not $api -or -not $web){exit 1}"
if errorlevel 1 goto :not_ready

echo.
echo BEL CyberNOC Windows services installed and running.
echo Dashboard: http://127.0.0.1:5173
echo Backend health: http://127.0.0.1:8000/api/health
echo Services start automatically with Windows and restart after process crashes.
echo To stop only the backend, run stop_application.bat. The frontend stays running.
exit /b 0

:python_missing
echo ERROR: Python 3.11 or newer is required.
pause
exit /b 1

:already_installed
echo ERROR: One or both BEL CyberNOC services already exist.
echo Inspect or remove existing services before reinstalling.
pause
exit /b 1

:ports_in_use
echo ERROR: Port 8000 or 5173 is already in use.
echo Stop the existing BEL CyberNOC processes before installing services.
echo The installer did not terminate any running process.
pause
exit /b 1

:not_ready
echo ERROR: Services were installed, but health checks did not pass.
echo Review backend.log, backend-error.log, frontend.log, and frontend-error.log.
pause
exit /b 1

:failed
echo ERROR: Service setup failed. Check the command output above.
pause
exit /b 1
