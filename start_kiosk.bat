@echo off
rem BEL Cyber Network Operations Status - Edge kiosk launcher.
call "%~dp0start_dashboard.bat" --no-browser
if errorlevel 1 exit /b 1
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
	start "BEL CyberNOC Kiosk" "%EDGE%" --kiosk http://127.0.0.1:5173 --edge-kiosk-type=fullscreen --no-first-run --autoplay-policy=no-user-gesture-required
) else (
	echo Microsoft Edge was not found at its standard install paths. Opening the dashboard in your default browser.
	start "" "http://127.0.0.1:5173"
)