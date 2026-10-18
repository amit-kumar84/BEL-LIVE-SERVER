# BEL Cyber Network Operations Status - offline package builder.
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot ".")).Path
$Package = Join-Path $Root "offline\BEL-CyberNOC-Offline"
$Tools = Join-Path $Package "tools"
$PythonDir = Join-Path $Tools "python"
$NodeDir = Join-Path $Tools "node"
$Wheels = Join-Path $Package "packages\python-wheels"

$PythonVersion = "3.14.5"
$NodeVersion = "20.19.5"
$PythonInstaller = "python-$PythonVersion-amd64.exe"
$NodeArchive = "node-v$NodeVersion-win-x64.zip"
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/$PythonInstaller"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchive"

New-Item -ItemType Directory -Force $Package, $Tools, $Wheels | Out-Null

function Get-Download([string]$Url, [string]$Destination) {
  if (-not (Test-Path $Destination)) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
  }
}

$PythonInstallerPath = Join-Path $Tools $PythonInstaller
$NodeArchivePath = Join-Path $Tools $NodeArchive
Get-Download $PythonUrl $PythonInstallerPath
Get-Download $NodeUrl $NodeArchivePath

$Pip = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Pip)) {
  throw "The project virtual environment is missing. Run start_dashboard.bat once first."
}

Write-Host "Downloading Python wheels..."
& $Pip -m pip download --disable-pip-version-check --only-binary=:all: `
  --dest $Wheels -r (Join-Path $Root "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) {
  throw "Python wheel download failed."
}

Write-Host "Copying application files..."
$excludeDirectories = @(
  ".git", ".venv", "backend\.venv", "node_modules", "offline", "offline-bundle",
  ".offline-cache", ".pytest_cache", "data", "dist"
)
$excludeFiles = @(
  "*.log", "*.sqlite3", "admin.password", "tsconfig.tsbuildinfo"
)
$robocopyArgs = @($Root, $Package, "/E", "/COPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NP")
foreach ($directory in $excludeDirectories) { $robocopyArgs += @("/XD", (Join-Path $Root $directory)) }
foreach ($file in $excludeFiles) { $robocopyArgs += @("/XF", $file) }
& robocopy @robocopyArgs | Out-Host
if ($LASTEXITCODE -gt 7) { throw "Application file copy failed." }

Write-Host "Copying preinstalled frontend libraries..."
& robocopy (Join-Path $Root "node_modules") (Join-Path $Package "node_modules") /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NP | Out-Host
if ($LASTEXITCODE -gt 7) { throw "Frontend library copy failed." }

Copy-Item (Join-Path $Root "offline\OFFLINE_DOWNLOAD_GUIDE.md") (Join-Path $Package "OFFLINE_DOWNLOAD_GUIDE.md") -Force
Copy-Item (Join-Path $Root "offline\install_offline.bat") (Join-Path $Package "install_offline.bat") -Force
Copy-Item (Join-Path $Root "offline\run_offline.bat") (Join-Path $Package "run_offline.bat") -Force
Copy-Item (Join-Path $Root "offline\run_offline_kiosk.bat") (Join-Path $Package "run_offline_kiosk.bat") -Force

Write-Host "Creating offline package metadata..."
$manifest = @"
BEL Cyber Network Operations Status - Offline Package
Created: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Python installer: $PythonInstaller
Node archive: $NodeArchive
Frontend dependencies: bundled in node_modules
Backend dependencies: packages/python-wheels
"@
Set-Content -Path (Join-Path $Package "PACKAGE-MANIFEST.txt") -Value $manifest -Encoding ASCII
Write-Host "Offline package created at: $Package"
