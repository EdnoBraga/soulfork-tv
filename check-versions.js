// The repo declares its version twice: windows/package.json for the Windows app and
// tizen/config.xml for the TV widget. The APK takes its own from the git tag at release time
// (VERSION_NAME in release.yml), so these two are the pair that drifts apart unnoticed.
// Run: node check-versions.js
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'windows', 'package.json'), 'utf8')).version;
const xml = fs.readFileSync(path.join(__dirname, 'tizen', 'config.xml'), 'utf8');
// The file opens with <?xml version="1.0"?>, so match the widget tag, not the first version= it finds.
const found = /<widget[\s\S]*?\sversion="([^"]+)"/.exec(xml);
const tizen = found && found[1];

if (pkg !== tizen) {
  console.error(`version mismatch: windows/package.json is ${pkg}, tizen/config.xml is ${tizen}`);
  console.error('Both must carry the version of the release they ship in (the git tag, without the v).');
  process.exit(1);
}
console.log(`version ok: ${pkg}`);
