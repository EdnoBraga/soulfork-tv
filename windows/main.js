const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// A window covered by another one counts as hidden, and Chromium then pauses muted videos (the other cells).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-media-suspend');

// Same identity as the TV apps: the IPTV panel ties its stream tokens to the user agent.
const USER_AGENT = 'Mozilla/5.0 (Linux; Android) SoulForkTV/1.0';

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0B0F1F',
    title: 'SoulFork TV',
    icon: path.join(__dirname, 'web', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // IPTV servers send no CORS headers; the page only ever loads our own local files.
      webSecurity: false,
      // Keep the multiscreen running when the window is behind others or minimized.
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);

  // The web app is laid out for a 1920x1080 TV: scale it to whatever size the window has.
  const fit = () => {
    const [w, h] = win.getContentSize();
    win.webContents.setZoomFactor(Math.min(w / 1920, h / 1080));
  };
  win.on('resize', fit);
  win.webContents.on('did-finish-load', fit);

  // F11 toggles full screen (the page swallows keys for remote-style navigation).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, 'web', 'index.html'));
}

function findVlc() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  return roots.map((r) => path.join(r, 'VideoLAN', 'VLC', 'vlc.exe')).find((p) => fs.existsSync(p));
}

ipcMain.handle('open-in-vlc', async (_e, url) => {
  const vlc = findVlc();
  if (!vlc) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'SoulFork TV',
      message: 'O VLC não está instalado.',
      detail: 'Instale o VLC (videolan.org) para abrir os formatos que o player do app não toca.',
    });
    return false;
  }
  spawn(vlc, [`--http-user-agent=${USER_AGENT}`, url], { detached: true, stdio: 'ignore' }).unref();
  return true;
});

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(USER_AGENT);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
