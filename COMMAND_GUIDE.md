# BEL Cyber Network Operations Status — Windows Command Guide

This guide contains the commands required to install, run, build, test, restart, and stop the BEL Cyber Network Operations Status application on Windows.

## Important: where to run commands

Unless a section explicitly says otherwise, run commands from the **repository root** in PowerShell:

```powershell
cd "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER"
```

The repository root is the folder that contains:

```text
backend\
src\
package.json
start_dashboard.bat
```

Use separate PowerShell windows when running the backend and frontend at the same time:

- **PowerShell window 1:** repository root, backend command
- **PowerShell window 2:** repository root, frontend command

Do not run the commands from `backend\`, `src\`, or `.venv\Scripts\` unless a command explicitly says so. The commands use paths relative to the repository root.

## 1. Required software

Install:

- Python 3.11 or newer
- Node.js 20 or newer
- npm (included with Node.js)
- Microsoft Edge, Chrome, or another modern browser

Verify the installations:

```powershell
py --version
python --version
node --version
npm --version
```

## 2. Create the Python environment

**Run in:** repository root (`C:\Users\ASUS\Downloads\BEL-LIVE-SERVER`)

Create the virtual environment once:

```powershell
py -3 -m venv .venv
```

Activate it for the current PowerShell window:

```powershell
.\.venv\Scripts\Activate.ps1
```

After activation, the prompt normally starts with `(.venv)`. The activation command is run from the repository root; it is not run inside `.venv\Scripts`.

If PowerShell blocks activation, use the Python executable directly as shown in the commands below. You do not need to change the system execution policy.

## 3. Install backend dependencies

**Run in:** repository root

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

## 4. Install frontend dependencies

**Run in:** repository root

```powershell
npm install
```

## 5. Start the backend

**Run in:** PowerShell window 1, repository root

Open PowerShell window 1:

```powershell
cd "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Backend URLs:

- API base: <http://127.0.0.1:8000>
- Health check: <http://127.0.0.1:8000/api/health>
- Dashboard data: <http://127.0.0.1:8000/api/dashboard>

Expected health response:

```json
{"ok":true,"mode":"live","bind":"127.0.0.1"}
```

Keep this terminal open while using the application. The `--app-dir backend` option tells Uvicorn where the backend Python package is located; do not remove it when running from the repository root.

## 6. Start the frontend development server

**Run in:** PowerShell window 2, repository root

Open PowerShell window 2:

```powershell
cd "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER"
npm run dev -- --host 127.0.0.1
```

Open the dashboard:

```text
http://127.0.0.1:5173
```

Keep this terminal open while using the application. Do not run this command from `src\`; Vite reads `package.json` from the repository root.

## 7. Start only the backend with one script

**Run in:** repository root

```powershell
.\start_backend.bat
```

This script creates the virtual environment if required, installs backend dependencies if required, starts only FastAPI/Uvicorn on port `8000`, writes `backend.log` and `backend-error.log`, and verifies the health endpoint.

Backend-only health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

## 8. Start everything automatically

**Run in:** repository root

The recommended normal startup command is:

```powershell
.\start_dashboard.bat
```

This script:

1. Creates `.venv` if required.
2. Installs backend dependencies if required.
3. Installs npm dependencies if required.
4. Starts the backend on port `8000`.
5. Starts the frontend on port `5173`.
6. Checks both services.
7. Opens the browser.

For Edge full-screen kiosk mode:

```powershell
.\start_kiosk.bat
```

## 9. Production build and startup

**Run in:** repository root

Create a production build:

```powershell
npm run build
```

This command runs TypeScript compilation and Vite production bundling:

```text
tsc -b
vite build
```

The generated files are written to `dist\`. `start_dashboard.bat` builds the frontend and serves `dist\` on port `5173`; it does not use Vite's development server.

Start the production dashboard and backend:

```powershell
.\start_dashboard.bat
```

The dashboard remains at <http://127.0.0.1:5173> and the API at <http://127.0.0.1:8000>.

For automatic startup with Windows and restart after process crashes, put `nssm.exe` in the repository root and run `install_services.bat` as Administrator once. It registers `BELCyberNOCBackend` and `BELCyberNOCFrontend` Windows services.

`stop_application.bat` stops only the backend. The frontend service remains running; stop it separately from Windows Services (`services.msc`) when needed.

## 10. Run backend tests

**Run in:** repository root

Run the complete backend test suite:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
```

Run one test file:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests\test_api.py -q
.\.venv\Scripts\python.exe -m pytest backend\tests\test_monitoring.py -q
```

Run a specific test by name:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q -k "bandwidth"
```

## 11. Check whether ports are running

**Run in:** any PowerShell window; repository root is recommended

Check backend port `8000`:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen
```

Check frontend port `5173`:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen
```

Check the API directly:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

Check the frontend directly:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173
```

## 12. Find service process IDs

**Run in:** any PowerShell window

Find the backend process:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
  Where-Object { $_.CommandLine -like '*uvicorn*app.main*' } |
  Select-Object ProcessId, CommandLine
```

Find Node/Vite processes:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*vite*' } |
  Select-Object ProcessId, CommandLine
```

## 13. Stop the backend or frontend

**Run in:** any PowerShell window

Use the process ID found above:

```powershell
Stop-Process -Id <PROCESS_ID>
```

Example:

```powershell
Stop-Process -Id 14772
```

Do not use name-based process termination when other Python or Node applications may be running.

If services were started in visible PowerShell windows, press:

```text
Ctrl + C
```

in each service window.

## 14. Restart the backend

**Run in:** repository root; use one PowerShell window to stop/start and another to verify

Find and stop the current backend process:

```powershell
$backend = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
  Where-Object { $_.CommandLine -like '*uvicorn*app.main*' }

if ($backend) {
  Stop-Process -Id $backend.ProcessId
}
```

Start the updated backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In another PowerShell window, verify it:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

## 15. Restart the frontend

**Run in:** repository root; use one PowerShell window to stop/start and another to verify

Stop the Vite process using its exact process ID:

```powershell
$vite = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*vite*' }

if ($vite) {
  Stop-Process -Id $vite.ProcessId
}
```

Start the development server again:

```powershell
npm run dev -- --host 127.0.0.1
```

Refresh the browser without using cache:

```text
Ctrl + F5
```

## 16. Run backend and frontend in the background

**Run in:** repository root

Start the backend in a separate process:

```powershell
Start-Process -FilePath ".\.venv\Scripts\python.exe" `
  -ArgumentList "-m","uvicorn","app.main:app","--app-dir","backend","--host","127.0.0.1","--port","8000" `
  -WorkingDirectory (Get-Location)
```

Start the frontend in a separate process:

```powershell
Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run","dev","--","--host","127.0.0.1" `
  -WorkingDirectory (Get-Location)
```

Verify readiness before opening the browser:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173
```

## 17. Common recovery commands

**Run in:** repository root

If the browser shows **Failed to fetch**, check the backend first:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

If the backend is unavailable, start it again:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

If the frontend is unavailable, start it again:

```powershell
npm run dev -- --host 127.0.0.1
```

If dependencies are missing:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm install
```

If the build fails after dependency changes:

```powershell
npm install
npm run build
```

## 18. Local data and logs

Important local paths:

```text
data\monitors.json       Monitor configuration
data\cybernoc.sqlite3    History and incident database
data\admin.password      Local admin password
C:\CyberNOC\audio        MP3/WAV alert files
backend.log              Automatic backend launcher log
frontend.log             Automatic frontend launcher log
```

Do not commit passwords, `.env`, database files, logs, or private monitor addresses.

## 19. Recommended always-on setup: Windows service plus kiosk browser

For a computer that should start the dashboard automatically after Windows starts, use this design:

```text
Windows service  -> FastAPI backend on 127.0.0.1:8000
User logon       -> start_kiosk.bat
start_kiosk.bat  -> Vite frontend on 127.0.0.1:5173 + Microsoft Edge full-screen
```

The backend service starts before a user signs in. The browser must start after user logon because Windows services run in a non-interactive session and must not open a desktop browser.

### 19.1 Prepare the application once

**Run in:** repository root (`C:\Users\ASUS\Downloads\BEL-LIVE-SERVER`)

```powershell
cd "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER"
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

These commands create the virtual environment and install the required Python packages. Do not start Uvicorn manually before installing the service; the service will own port `8000`.

Install and verify the frontend dependencies:

```powershell
npm install
npm run build
```

Close any manually started backend or Vite windows before installing the service. Otherwise the service may report that port `8000` is already in use.

### 19.2 Install NSSM

NSSM (Non-Sucking Service Manager) is a service wrapper required to run the Python process reliably as a Windows service.

1. Download NSSM from its official project website.
2. Extract `nssm.exe` to a protected folder, for example:

```text
C:\Tools\nssm\nssm.exe
```

3. Open **PowerShell as Administrator**.
4. Confirm that the file exists:

```powershell
Test-Path "C:\Tools\nssm\nssm.exe"
```

Do not download or run unknown copies of service-management tools. Do not place `nssm.exe` inside the Git repository.

### 19.3 Create the backend service

**Run in:** PowerShell **as Administrator**

The commands below use the current project path. If the project is moved, replace every occurrence of `C:\Users\ASUS\Downloads\BEL-LIVE-SERVER`.

```powershell
$Nssm = "C:\Tools\nssm\nssm.exe"
$Root = "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER"
$Python = "$Root\.venv\Scripts\python.exe"

New-Item -ItemType Directory -Force "C:\CyberNOC\service-logs" | Out-Null

& $Nssm install BELCyberNOCBackend $Python
& $Nssm set BELCyberNOCBackend AppDirectory $Root
& $Nssm set BELCyberNOCBackend AppParameters "-m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000"
& $Nssm set BELCyberNOCBackend Start SERVICE_AUTO_START
& $Nssm set BELCyberNOCBackend AppExit Default Restart
& $Nssm set BELCyberNOCBackend AppStdout "C:\CyberNOC\service-logs\backend-service.log"
& $Nssm set BELCyberNOCBackend AppStderr "C:\CyberNOC\service-logs\backend-service-error.log"
& $Nssm start BELCyberNOCBackend
```

Check that the service and API are working:

```powershell
Get-Service BELCyberNOCBackend
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

Expected API response:

```json
{"ok":true,"mode":"live","bind":"127.0.0.1"}
```

### 19.4 Start the frontend and Edge kiosk at user logon

The repository already contains [start_kiosk.bat](./start_kiosk.bat). It waits for the backend, starts the frontend if required, and opens Microsoft Edge in full-screen kiosk mode at:

```text
http://127.0.0.1:5173
```

To run it automatically whenever your Windows account signs in:

1. Press `Win+R`.
2. Enter:

```text
shell:startup
```

3. Create a shortcut in that folder.
4. Set the shortcut target to:

```text
C:\Users\ASUS\Downloads\BEL-LIVE-SERVER\start_kiosk.bat
```

5. Set **Start in** to:

```text
C:\Users\ASUS\Downloads\BEL-LIVE-SERVER
```

6. Restart Windows or sign out and sign in again.

The browser should open without address bar, tabs, or normal browser controls. To exit Edge kiosk mode, use `Alt+F4`.

#### Create the startup shortcut with PowerShell

Instead of creating the shortcut manually, run this once in a normal PowerShell window:

```powershell
$Startup = [Environment]::GetFolderPath("Startup")
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut("$Startup\BEL CyberNOC Kiosk.lnk")
$Shortcut.TargetPath = "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER\start_kiosk.bat"
$Shortcut.WorkingDirectory = "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER"
$Shortcut.WindowStyle = 7
$Shortcut.Save()
```

To remove automatic browser startup later:

```powershell
Remove-Item "$([Environment]::GetFolderPath('Startup'))\BEL CyberNOC Kiosk.lnk"
```

### 19.5 Service management

**Run in:** PowerShell as Administrator

```powershell
& "C:\Tools\nssm\nssm.exe" stop BELCyberNOCBackend
& "C:\Tools\nssm\nssm.exe" start BELCyberNOCBackend
& "C:\Tools\nssm\nssm.exe" restart BELCyberNOCBackend
Get-Service BELCyberNOCBackend
```

To uninstall the backend service:

```powershell
& "C:\Tools\nssm\nssm.exe" stop BELCyberNOCBackend
& "C:\Tools\nssm\nssm.exe" remove BELCyberNOCBackend confirm
```

### 19.6 Troubleshooting automatic startup

- **API is unavailable:** check `C:\CyberNOC\service-logs\backend-service-error.log`.
- **Port 8000 is already in use:** stop the manually running Uvicorn process before starting the service.
- **Edge does not open:** verify Microsoft Edge is installed and run `.\start_kiosk.bat` manually from the repository root.
- **Frontend is unavailable:** check `frontend.log` and `frontend-error.log` in the repository root.
- **The browser opens normally instead of kiosk mode:** confirm the shortcut target is `start_kiosk.bat`, not `start_dashboard.bat`.
- **The service starts but cannot read data:** verify the service account has access to the project folder, `data\`, and `C:\CyberNOC\audio`.

### 19.7 Security and production notes

- Keep the service bound to `127.0.0.1` unless a separate security review approves network exposure.
- Keep `data\admin.password`, `.env`, SQLite files, monitor addresses, SNMP credentials, and logs private.
- Do not run the service as a local administrator unless it is strictly required.
- The setup above uses the Vite development server for convenience. For a production deployment, build the frontend with `npm run build` and serve `dist\` through an approved static web server; do not treat Vite development mode as a production web server.

## 20. Create an offline installation package

The repository includes an offline package builder for isolated Windows or
intranet systems. Run this section on an internet-connected Windows x64 machine.

**Run in:** repository root

```powershell
cd "C:\Users\ASUS\Downloads\BEL-LIVE-SERVER"
Set-ExecutionPolicy -Scope Process Bypass
.\download_offline_bundle.ps1
```

The builder downloads the official Python installer, portable Node.js archive,
and all Python wheels required by `backend\requirements.txt`. It also copies the
application and complete frontend dependencies. The generated package is:

```text
offline\BEL-CyberNOC-Offline\
```

Copy that complete folder to the offline computer or an approved intranet share.
On the offline computer, run:

```bat
install_offline.bat
run_offline_kiosk.bat
```

The detailed offline procedure, package contents, troubleshooting, and security
notes are in [OFFLINE_DOWNLOAD_GUIDE.md](./offline/OFFLINE_DOWNLOAD_GUIDE.md).
