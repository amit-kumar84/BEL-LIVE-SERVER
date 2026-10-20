@echo off
rem BEL Cyber Network Operations Status - desktop application launcher.
setlocal
set "ROOT=%~dp0"
set "INSTALLED_APP=%LOCALAPPDATA%\Programs\BEL CyberNOC\BEL CyberNOC.exe"

if exist "%INSTALLED_APP%" (
  start "" "%INSTALLED_APP%" %*
  exit /b 0
)

if exist "%ROOT%node_modules\electron\dist\electron.exe" (
  cd /d "%ROOT%"
  call npm run desktop:dev -- %*
  exit /b %errorlevel%
)

echo ERROR: BEL CyberNOC Desktop is not installed and Electron is unavailable.
echo Install the application from the release folder or run npm install first.
pause
exit /b 1