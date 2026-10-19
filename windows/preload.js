// Tells the shared web app it runs on Windows (window.soulfork) and gives it "open in VLC".
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soulfork', {
  openInVlc: (url) => ipcRenderer.invoke('open-in-vlc', url),
  // 'fullscreen' or 'top': the same toggles as F11 and F10.
  toggleWindow: (what) => ipcRenderer.invoke('window-toggle', what),
});
