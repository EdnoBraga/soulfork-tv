// Self-check for the window shortcuts: npx electron test-keys.js && cat test-keys.log
// Boots the real app and feeds it key events, so the handler in main.js is the thing under test.
// The result goes to a file because Electron on Windows does not pipe console.log to the terminal.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const report = (text, code) => {
  fs.writeFileSync(path.join(__dirname, 'test-keys.log'), `${text}\n`);
  app.exit(code);
};

// A temporary profile: these checks must never touch the list and login of the installed app.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'soulfork-check-')));

require('./main.js');

const pressF10 = (win) => win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10' });
const settle = () => new Promise((r) => setTimeout(r, 300));

app.whenReady().then(async () => {
  try {
    await settle();
    const win = BrowserWindow.getAllWindows()[0];
    assert(win, 'the app should open a window');
    assert(!win.isAlwaysOnTop(), 'should not start pinned');

    pressF10(win);
    await settle();
    assert(win.isAlwaysOnTop(), 'F10 should pin the window on top');
    assert(win.getTitle().includes('sempre no topo'), `title should say it is pinned, got "${win.getTitle()}"`);

    pressF10(win);
    await settle();
    assert(!win.isAlwaysOnTop(), 'F10 again should unpin the window');
    assert.strictEqual(win.getTitle(), 'SoulFork TV', 'title should go back to normal');

    report('ok: F10 pins and unpins the window', 0);
  } catch (err) {
    report(`FAIL: ${err.message}`, 1);
  }
});
