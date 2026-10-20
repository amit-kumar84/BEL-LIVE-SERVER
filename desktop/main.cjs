const { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { FOCUS_RETURN_DELAY_MS, shouldRestoreWindow, shouldForceWindowFocus } = require('./window-policy.cjs');

const host = '127.0.0.1';
const port = 8000;
const apiUrl = `http://${host}:${port}`;
const focusReturnDelayMs = FOCUS_RETURN_DELAY_MS;
let backendProcess;
let mainWindow;
let quitting = false;
let powerSaveBlockerId = null;
let focusReturnTimeout = null;
const kioskMode = app.isPackaged && (process.argv.includes('--kiosk-guard') || isKeepAliveEnabled());

app.setName('BEL CyberNOC');
app.setAppUserModelId('com.bel.cybernoc');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

ipcMain.handle('bel:fullscreen:get', () => mainWindow?.isFullScreen() ?? false);
ipcMain.handle('bel:fullscreen:toggle', () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});
ipcMain.handle('bel:window:focus', focusDashboardWindow);
ipcMain.handle('bel:audio:alert', () => ensureAlertAudioAtFullVolume());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusDashboardWindow();
  });

  app.whenReady().then(() => {
    if (app.isPackaged) powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    return startDesktopApp();
  });
}

app.on('before-quit', () => {
  quitting = true;
  if (focusReturnTimeout) clearTimeout(focusReturnTimeout);
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
});

app.on('window-all-closed', () => {
  app.quit();
});

async function startDesktopApp() {
  const paths = getAppPaths();
  try {
    fs.mkdirSync(paths.data, { recursive: true });
    fs.mkdirSync(paths.audio, { recursive: true });
    seedDefaultAudioFiles(paths);
    migrateLegacyAudio(path.join(app.getPath('userData'), 'audio'), paths.audio);
  } catch (error) {
    showStartupError(`Cannot create or access ${paths.audio}. Install or run BEL CyberNOC with permission to write to C:\\CyberNOC\\audio.\n\n${error.message || error}`);
    return;
  }
  if (app.isPackaged && !fs.existsSync(path.join(paths.data, 'monitors.json'))) {
    fs.copyFileSync(paths.exampleConfig, path.join(paths.data, 'monitors.json'));
  }

  const existingUrl = await findExistingDashboard();
  if (existingUrl) {
    await openWindow(existingUrl);
    return;
  }

  if (!(await isPortAvailable(port))) {
    showStartupError(`Port ${port} is already in use. Close the other CyberNOC server and try again.`);
    return;
  }

  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'CyberNOCBackend.exe')
    : path.join(paths.root, '.venv', 'Scripts', 'python.exe');
  const args = app.isPackaged
    ? []
    : ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', host, '--port', String(port)];

  if (!fs.existsSync(executable)) {
    showStartupError(`Backend executable was not found:\n${executable}`);
    return;
  }

  const env = {
    ...process.env,
    CYBERNOC_DATA_DIR: paths.data,
    CYBERNOC_AUDIO_DIR: paths.audio,
    CYBERNOC_WEB_DIR: paths.web,
    CYBERNOC_HOST: host,
    CYBERNOC_PORT: String(port),
  };

  backendProcess = spawn(executable, args, {
    cwd: app.isPackaged ? app.getPath('userData') : paths.root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logPath = path.join(app.getPath('userData'), 'backend.log');
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  backendProcess.stdout?.pipe(log);
  backendProcess.stderr?.pipe(log);
  backendProcess.on('error', (error) => {
    log.write(`${new Date().toISOString()} ${error.stack || error}\n`);
    if (!quitting) showStartupError(`Could not start the backend. See the log at:\n${logPath}`);
  });
  backendProcess.on('exit', (code) => {
    log.end();
    if (!quitting && code !== 0) {
      dialog.showErrorBox('BEL CyberNOC stopped', `The backend exited with code ${code}. Log: ${logPath}`);
      app.quit();
    }
  });

  const ready = await waitForDashboard(30000);
  if (!ready) {
    showStartupError(`The backend did not become ready. Review the log at:\n${logPath}`);
    return;
  }

  await openWindow(apiUrl);
}

function getAppPaths() {
  const root = path.resolve(__dirname, '..');
  return {
    root,
    web: app.isPackaged ? path.join(process.resourcesPath, 'frontend') : path.join(root, 'dist'),
    data: path.join(app.getPath('userData'), 'data'),
    audio: app.isPackaged ? path.join('C:\\', 'CyberNOC', 'audio') : path.join(app.getPath('userData'), 'audio'),
    defaultAudio: app.isPackaged ? path.join(process.resourcesPath, 'audio-defaults') : path.join(root, 'public'),
    exampleConfig: app.isPackaged
      ? path.join(process.resourcesPath, 'monitors.example.json')
      : path.join(root, 'config', 'monitors.example.json'),
  };
}

function seedDefaultAudioFiles(paths) {
  for (const filename of ['down-default-alert.mp3', 'restored-default-alert.mp3']) {
    const source = path.join(paths.defaultAudio, filename);
    const destination = path.join(paths.audio, filename);
    if (fs.existsSync(source) && !fs.existsSync(destination)) fs.copyFileSync(source, destination);
  }
}

function migrateLegacyAudio(legacyAudioPath, audioPath) {
  if (path.resolve(legacyAudioPath).toLowerCase() === path.resolve(audioPath).toLowerCase() || !fs.existsSync(legacyAudioPath)) return;
  for (const filename of fs.readdirSync(legacyAudioPath)) {
    if (!['.mp3', '.wav'].includes(path.extname(filename).toLowerCase())) continue;
    const source = path.join(legacyAudioPath, filename);
    const destination = path.join(audioPath, filename);
    if (fs.statSync(source).isFile() && !fs.existsSync(destination)) fs.copyFileSync(source, destination);
  }
}

async function findExistingDashboard() {
  try {
    const health = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1200) });
    if (!health.ok) return null;
    const payload = await health.json();
    if (payload.mode !== 'live' || payload.bind !== host) return null;
    const root = await fetch(`${apiUrl}/`, { signal: AbortSignal.timeout(1200) });
    if (root.ok && (await root.text()).includes('BEL CyberNOC')) return apiUrl;
    const frontend = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(1200) });
    if (frontend.ok) return 'http://127.0.0.1:5173';
  } catch {
    return null;
  }
  return null;
}

function isPortAvailable(portNumber) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(portNumber, host, () => server.close(() => resolve(true)));
  });
}

async function waitForDashboard(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) {
        const root = await fetch(`${apiUrl}/`, { signal: AbortSignal.timeout(1000) });
        if (root.ok && (await root.text()).includes('BEL CyberNOC')) return true;
      }
    } catch {
      if (backendProcess?.exitCode !== null && backendProcess?.exitCode !== undefined) return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

async function openWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'BEL CyberNOC',
    show: false,
    fullscreen: app.isPackaged,
    autoHideMenuBar: true,
    icon: path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'public'), 'bel.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.on('blur', () => {
    if (app.isPackaged) scheduleDashboardRestore();
  });
  mainWindow.on('focus', cancelDashboardRestore);
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('bel:fullscreen:changed', true));
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('bel:fullscreen:changed', false);
    if (kioskMode) setTimeout(() => mainWindow?.setFullScreen(true), 700);
  });
  await mainWindow.loadURL(url);
  focusDashboardWindow();
  mainWindow.on('closed', () => {
    cancelDashboardRestore();
    mainWindow = null;
  });
}

function scheduleDashboardRestore() {
  cancelDashboardRestore();
  focusReturnTimeout = setTimeout(() => {
    focusReturnTimeout = null;
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    const shouldRestore = shouldRestoreWindow({
      isQuitting: quitting,
      isWindowFocused: mainWindow.isFocused(),
      isMinimized: mainWindow.isMinimized(),
    });
    if (!shouldRestore) return;
    focusDashboardWindow();
  }, focusReturnDelayMs);
}

function focusDashboardWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setFullScreen(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setAlwaysOnTop(false);
  return true;
}

function cancelDashboardRestore() {
  if (!focusReturnTimeout) return;
  clearTimeout(focusReturnTimeout);
  focusReturnTimeout = null;
}

function ensureAlertAudioAtFullVolume() {
  if (process.platform !== 'win32') return;
  const script = `
  Add-Type -TypeDefinition @'
  using System;
  using System.Runtime.InteropServices;
  public class AudioController {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
      int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
      int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    }
    [ComImport, Guid("A95664D2-9614-4F35-A7A3-DE4662F71756"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
      int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
    }
    [ComImport, Guid("D666063F-1587-4EF4-9B9E-3D4B3D1A2A68"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
      int RegisterControlChangeNotify(IntPtr pNotify);
      int UnregisterControlChangeNotify(IntPtr pNotify);
      int GetChannelCount(out int pnChannelCount);
      int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
      int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
      int GetMasterVolumeLevel(out float pfLevelDB);
      int GetMasterVolumeLevelScalar(out float pfLevel);
      int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
      int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
      int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
      int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
      int SetMute(bool bMute, ref Guid pguidEventContext);
      int GetMute(out bool pbMute);
      int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
      int VolumeStepUp(ref Guid pguidEventContext);
      int VolumeStepDown(ref Guid pguidEventContext);
      int QueryHardwareSupport(out uint pdwHardwareSupportMask);
      int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
    }
    public static void Maximize() {
      Type enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
      object enumerator = Activator.CreateInstance(enumeratorType);
      var deviceEnumerator = (IMMDeviceEnumerator)enumerator;
      IntPtr devicePtr;
      int hr = deviceEnumerator.GetDefaultAudioEndpoint(0, 1, out devicePtr);
      if (hr != 0) throw new Exception("GetDefaultAudioEndpoint failed: " + hr);
      var device = (IMMDevice)Marshal.GetObjectForIUnknown(devicePtr);
      Guid iid = new Guid("5CDF2C82-841E-4546-9CF7-93E3809E2588");
      IntPtr volumePtr;
      hr = device.Activate(ref iid, 0x17, IntPtr.Zero, out volumePtr);
      if (hr != 0) throw new Exception("Activate failed: " + hr);
      var volume = (IAudioEndpointVolume)Marshal.GetObjectForIUnknown(volumePtr);
      Guid eventContext = Guid.Empty;
      volume.SetMute(false, ref eventContext);
      volume.SetMasterVolumeLevelScalar(1.0f, ref eventContext);
    }
  }
'@; [AudioController]::Maximize();`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error || result.status !== 0) {
    console.error('Unable to set Windows master volume to 100%.', result.error || result.stderr || result.status);
    return false;
  }
  return true;
}

function triggerAlertFocusIfNeeded({ alertActive } = {}) {
  if (!alertActive || !mainWindow || mainWindow.isDestroyed()) return;
  const shouldForce = shouldForceWindowFocus({ alertActive, isWindowFocused: mainWindow.isFocused() });
  if (!shouldForce) return;
  focusDashboardWindow();
}

function showStartupError(message) {
  dialog.showErrorBox('BEL CyberNOC could not start', message);
  app.quit();
}

function isKeepAliveEnabled() {
  const result = spawnSync('reg.exe', ['query', 'HKCU\\Software\\BEL CyberNOC', '/v', 'KeepAlive'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 && /KeepAlive\s+REG_DWORD\s+0x1\b/i.test(result.stdout || '');
}
