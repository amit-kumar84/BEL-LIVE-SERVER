@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"
set "VENV=%ROOT%\.venv"
set "PY=%VENV%\Scripts\python.exe"
set "PYTHON_EXE=py -3"
set "BACKEND_LOG=%ROOT%\backend.log"
set "FRONTEND_LOG=%ROOT%\frontend.log"

if not exist "%PY%" (
  where py >nul 2>nul
  if errorlevel 1 (
    echo Python 3 is required. Install Python 3.11 or newer and try again.
    pause
    exit /b 1
  )
  %PYTHON_EXE% -m venv "%VENV%"
  if errorlevel 1 goto :failed
)

if not exist "%VENV%\cybernoc-deps.ok" (
  "%PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
  if errorlevel 1 goto :failed
  type nul > "%VENV%\cybernoc-deps.ok"
)

if not exist "node_modules\vite\bin\vite.js" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Node.js 20 or newer with npm is required.
    pause
    exit /b 1
  )
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
)

if not exist "data" mkdir data
if not exist "C:\CyberNOC\audio" mkdir "C:\CyberNOC\audio" 2>nul
 powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content.Contains('127.0.0.1')){exit 0} } catch {}; exit 1"
if errorlevel 1 start "BEL CyberNOC API" /min cmd /c ""%PY%" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 1^>^>"%BACKEND_LOG%" 2^>^&1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content.Contains('127.0.0.1')){$ready=$true;break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ready){exit 1}"
if errorlevel 1 (
  echo BEL CyberNOC API did not become ready. Review backend.log.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173 -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content.Contains('CyberNOC')){exit 0} } catch {}; exit 1"
if errorlevel 1 start "BEL CyberNOC UI" /min cmd /c "call npm run dev -- --host 127.0.0.1 1^>^>"%FRONTEND_LOG%" 2^>^&1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173 -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content.Contains('CyberNOC')){$ready=$true;break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ready){exit 1}"
if errorlevel 1 (
  echo BEL CyberNOC frontend did not become ready. Review frontend.log.
  pause
  exit /b 1
)
if /I not "%~1"=="--no-browser" start "" "http://127.0.0.1:5173"
echo BEL CyberNOC is ready at http://127.0.0.1:5173
echo Admin password: data\admin.password ^(keep private^)
echo API and frontend logs: backend.log, frontend.log
exit /b 0

:failed
echo BEL CyberNOC setup failed. Review the error above.
pause
exit /b 1