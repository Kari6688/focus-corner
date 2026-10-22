// A small, safe bridge between the widget UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusCorner', {
  platform: process.platform,
  setMode: (mode) => ipcRenderer.send('set-mode', mode),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  setAlwaysOnTop: (on) => ipcRenderer.send('always-on-top', on),
  setLaunchAtLogin: (on) => ipcRenderer.send('launch-at-login', on),
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  reportStatus: (status) => ipcRenderer.send('status', status),
  onCommand: (cb) => ipcRenderer.on('command', (_e, cmd) => cb(cmd)),
  onBlur: (cb) => ipcRenderer.on('blur', () => cb()),
});
