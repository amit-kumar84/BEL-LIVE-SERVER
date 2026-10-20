const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('belCyberNoc', {
  isFullscreen: () => ipcRenderer.invoke('bel:fullscreen:get'),
  toggleFullscreen: () => ipcRenderer.invoke('bel:fullscreen:toggle'),
  focusWindow: () => ipcRenderer.invoke('bel:window:focus'),
  raiseAlertAudio: () => ipcRenderer.invoke('bel:audio:alert'),
  onFullscreenChange: (callback) => {
    const listener = (_event, fullscreen) => callback(fullscreen);
    ipcRenderer.on('bel:fullscreen:changed', listener);
    return () => ipcRenderer.removeListener('bel:fullscreen:changed', listener);
  },
});