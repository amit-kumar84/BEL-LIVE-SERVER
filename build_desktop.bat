@echo off
rem Build a Windows installer for BEL CyberNOC Desktop.
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"
set "PY=%ROOT%\.venv\Scripts\python.exe"

echo =========================================================
echo BEL CyberNOC Desktop Build
echo =========================================================
echo.

if not exist "%PY%" (
  echo Creating Python build environment...
  where py >nul 2>nul
  if errorlevel 1 goto :python_missing
  py -3 -m venv "%ROOT%\.venv"
  if errorlevel 1 goto :failed
)

echo Installing Python backend and packager dependencies...
"%PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 goto :failed
"%PY%" -m pip install --disable-pip-version-check pyinstaller
if errorlevel 1 goto :failed

echo Installing Node desktop build dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

set "ELECTRON_SKIP_BINARY_DOWNLOAD="
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading Electron for Windows...
  set "force_no_cache=true"
  call node node_modules\electron\install.js
  set "force_no_cache="
  if errorlevel 1 goto :failed
)
if not exist "node_modules\electron\dist\electron.exe" goto :electron_missing
if not exist "node_modules\electron\path.txt" echo electron.exe>"node_modules\electron\path.txt"

echo Building production frontend...
call npm run build
if errorlevel 1 goto :failed

echo Generating Windows installer icon...
"%PY%" -m pip install --disable-pip-version-check pillow
if errorlevel 1 goto :failed
"%PY%" -c "from PIL import Image; import os; os.makedirs('build', exist_ok=True); img = Image.open(r'public\\Bharat_Electronics_logo.png').convert('RGBA'); img = img.resize((256, 256), Image.Resampling.LANCZOS); img.save(r'build\\icon.ico'); print('icon-ready')"
if errorlevel 1 goto :failed

echo Packaging the Python backend...
"%PY%" -m PyInstaller --noconfirm --clean --onedir --distpath backend-dist --name CyberNOCBackend --paths backend --collect-all uvicorn --collect-all fastapi --collect-all pysnmp --collect-all psutil backend\desktop_entry.py
if errorlevel 1 goto :failed

echo Cleaning any stale installer temporary output...
if exist "release\win-unpacked.tmp" rmdir /s /q "release\win-unpacked.tmp"
if exist "release\win-unpacked.tmp.lock" rmdir /s /q "release\win-unpacked.tmp.lock"

echo Preparing the scrollable installer agreement...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File build\prepare_installer_agreement.ps1
if errorlevel 1 goto :failed

echo Creating the Windows desktop installer...
call npx electron-builder --win nsis --publish never
if errorlevel 1 goto :failed

echo.
echo =========================================================
echo YOUR DESKTOP INSTALLER IS READY!
echo Installer location: "%ROOT%\release"
echo =========================================================
exit /b 0

:python_missing
echo ERROR: Python 3.11 or newer is required.
pause
exit /b 1

:electron_missing
echo ERROR: Electron's Windows runtime could not be installed.
echo Check access to GitHub release downloads, then run this file again.
pause
exit /b 1

:failed
echo ERROR: Desktop build failed. Review the command output above.
pause
exit /b 1
