@echo off
rem BEL Cyber Network Operations Status - production launcher.
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "ROOT=%CD%"
set "VENV=%ROOT%\.venv"
set "PY=%VENV%\Scripts\python.exe"
set "PYTHON_EXE=py -3"
set "BACKEND_LOG=%ROOT%\backend.log"
set "FRONTEND_LOG=%ROOT%\frontend.log"
set "CLOSE_DELAY=10"

cls
echo =========================================================
echo BEL CyberNOC Startup
echo =========================================================
echo Root: %ROOT%
echo This window will close automatically in %CLOSE_DELAY% seconds after success.
echo =========================================================
echo.

if not exist "%PY%" (
  echo [1/6] Python virtual environment not found. Creating it...
  where py >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Python 3 is required. Install Python 3.11 or newer and try again.
    echo.
    pause
    exit /b 1
  )
  %PYTHON_EXE% -m venv "%VENV%"
  if errorlevel 1 goto :failed
  echo [OK] Virtual environment created.
) else (
  echo [1/6] Python virtual environment already exists.
)

if not exist "%VENV%\cybernoc-deps.ok" (
  echo [2/6] Installing Python dependencies...
  "%PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
  if errorlevel 1 goto :failed
  type nul > "%VENV%\cybernoc-deps.ok"
  echo [OK] Python dependencies installed.
) else (
  echo [2/6] Python dependencies already installed.
)

if not exist "node_modules\serve\build\main.js" (
  echo [3/6] Installing frontend dependencies...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Node.js 20 or newer with npm is required.
    echo.
    pause
    exit /b 1
  )
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :failed
  echo [OK] Frontend dependencies installed.
) else (
  echo [3/6] Frontend dependencies already installed.
)
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 20 or newer is required to serve the production frontend.
  echo.
  pause
  exit /b 1
)

echo [4/6] Building production frontend...
call npm run build
if errorlevel 1 goto :build_failed
if not exist "dist\index.html" goto :build_failed
echo [OK] Production frontend built in dist\.

if not exist "data" mkdir data
if not exist "C:\CyberNOC\audio" mkdir "C:\CyberNOC\audio" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0} } catch {}; exit 1"
if errorlevel 1 (
  sc query BELCyberNOCBackend >nul 2>&1
  if not errorlevel 1 (
    echo [5/6] Starting backend Windows service...
    sc start BELCyberNOCBackend >nul
    if errorlevel 1 goto :backend_failed
  ) else (
    echo [5/6] Starting backend API in the background...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$null = Start-Process -FilePath '%PY%' -ArgumentList '-m','uvicorn','app.main:app','--app-dir','backend','--host','127.0.0.1','--port','8000' -WorkingDirectory '%ROOT%' -RedirectStandardOutput '%BACKEND_LOG%' -RedirectStandardError '%ROOT%\backend-error.log' -WindowStyle Hidden -ErrorAction Stop"
    if errorlevel 1 goto :backend_failed
  )
) else (
  echo [5/6] Backend API already running.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){$ready=$true;break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ready){exit 1}"
if errorlevel 1 goto :backend_failed

echo [OK] Backend API is healthy.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173 -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content -match '/assets/' -and $r.Content -notmatch '/@vite/client'){exit 0} } catch {}; exit 1"
if errorlevel 1 (
  echo [INFO] Checking for this project's old Vite development server...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=[regex]::Escape('%ROOT%'); $legacy=Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'node.exe' -and $_.CommandLine -match ($root + '.*node_modules.*vite\\bin\\vite\.js') }; foreach($p in $legacy){ Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host 'Stopped old project Vite process PID' $p.ProcessId }; if($legacy){Start-Sleep -Milliseconds 500}"
  if errorlevel 1 goto :frontend_failed
  sc query BELCyberNOCFrontend >nul 2>&1
  if not errorlevel 1 (
    echo [6/6] Starting production frontend Windows service...
    sc start BELCyberNOCFrontend >nul
    if errorlevel 1 goto :frontend_failed
  ) else (
    echo [6/6] Starting production frontend server in the background...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$null = Start-Process -FilePath 'node.exe' -ArgumentList '%ROOT%\node_modules\serve\build\main.js','-s','dist','-l','tcp://127.0.0.1:5173' -WorkingDirectory '%ROOT%' -RedirectStandardOutput '%FRONTEND_LOG%' -RedirectStandardError '%ROOT%\frontend-error.log' -WindowStyle Hidden -ErrorAction Stop"
    if errorlevel 1 goto :frontend_failed
  )
) else (
  echo [6/6] Production frontend already running.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173 -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content -match '/assets/' -and $r.Content -notmatch '/@vite/client'){$ready=$true;break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ready){exit 1}"
if errorlevel 1 goto :frontend_failed

echo [OK] Frontend dashboard is reachable.

if /I "%~1"=="--no-browser" goto :browser_skipped
echo [INFO] Opening the dashboard in your default browser...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath 'http://127.0.0.1:5173' -ErrorAction Stop; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "" "http://127.0.0.1:5173"
  if errorlevel 1 echo [WARN] Automatic browser opening failed. Open http://127.0.0.1:5173 manually.
)
goto :browser_done

:browser_skipped
echo [INFO] Browser auto-open skipped by --no-browser.

:browser_done
echo.
echo =========================================================
echo BEL CyberNOC production dashboard is ready at http://127.0.0.1:5173
echo Admin password: data\admin.password ^(keep private^)
echo API log: backend.log
echo Frontend log: frontend.log
echo =========================================================
echo.
echo Auto-closing window in %CLOSE_DELAY% seconds...
ping -n %CLOSE_DELAY% 127.0.0.1 >nul
exit /b 0

:backend_failed
echo ERROR: BEL CyberNOC API did not become ready. Review backend.log.
echo.
pause
exit /b 1

:build_failed
echo ERROR: Production frontend build failed. Review the build output above.
echo.
pause
exit /b 1

:frontend_failed
echo ERROR: Production frontend did not become ready. Port 5173 may be occupied by another process.
echo Review frontend.log and frontend-error.log.
echo.
pause
exit /b 1

:failed
echo ERROR: BEL CyberNOC setup failed. Review the error above.
echo.
pause
exit /b 1