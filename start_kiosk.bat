@echo off
rem BEL Cyber Network Operations Status - Edge kiosk launcher.
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"
set "CLOSE_DELAY=10"

cls
echo =========================================================
echo BEL CyberNOC Kiosk Startup
echo =========================================================
echo Root: %ROOT%
echo This window will close automatically in %CLOSE_DELAY% seconds after success.
echo =========================================================
echo.

echo [1/3] Starting dashboard services...
call "%~dp0start_dashboard.bat" --no-browser
if errorlevel 1 (
  echo ERROR: Dashboard startup failed. The kiosk did not launch.
  echo.
  pause
  exit /b 1
)
echo [OK] Dashboard services are running.

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE%" (
  echo [2/3] Launching Edge in kiosk mode...
  start "BEL CyberNOC Kiosk" "%EDGE%" --kiosk http://127.0.0.1:5173 --edge-kiosk-type=fullscreen --no-first-run --autoplay-policy=no-user-gesture-required
  echo [OK] Edge kiosk launched.
) else (
  echo [WARN] Microsoft Edge was not found. Opening the dashboard in your default browser instead.
  start "" "http://127.0.0.1:5173"
)

echo [3/3] Kiosk launch complete.
echo.
echo =========================================================
echo BEL CyberNOC kiosk is ready at http://127.0.0.1:5173
echo =========================================================
echo.
echo Auto-closing window in %CLOSE_DELAY% seconds...
ping -n %CLOSE_DELAY% 127.0.0.1 >nul
exit /b 0