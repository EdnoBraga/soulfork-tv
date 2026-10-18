// The Windows app runs the same web app as the Samsung TV (../tizen) plus hls.js; copy it into ./web.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'web');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of ['app.js', 'style.css', 'logo.png', 'icon.png']) {
  fs.copyFileSync(path.join(__dirname, '..', 'tizen', f), path.join(out, f));
}
fs.copyFileSync(path.join(__dirname, 'node_modules', 'hls.js', 'dist', 'hls.light.min.js'), path.join(out, 'hls.light.min.js'));

// Same page as the TV's, minus the Samsung player API, plus hls.js for live channels.
const html = fs.readFileSync(path.join(__dirname, '..', 'tizen', 'index.html'), 'utf8')
  .replace('<script src="$WEBAPIS/webapis/webapis.js"></script>', '<script src="hls.light.min.js"></script>')
  .replace('<object id="av" type="application/avplayer"></object>', '');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('web app copied to', out);
