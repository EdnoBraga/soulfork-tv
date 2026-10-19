// Self-check for the player controls: npx electron test-player.js && cat test-player.log
// Boots the real app, opens the player on fake channels and drives the actual DOM, so the bar,
// the folder list and theater mode are what is under test. No stream is needed: nothing here
// checks playback, only the interface around it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

require('./main.js');

const report = (text, code) => {
  fs.writeFileSync(path.join(__dirname, 'test-player.log'), `${text}\n`);
  app.exit(code);
};

// Runs inside the page, where app.js keeps its screens and item helpers as globals.
const SUITE = `(async function () {
  var fails = [];
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var q = function (s) { return document.querySelector(s); };
  var check = function (cond, msg) { if (!cond) fails.push(msg); };
  // Never read through a missing element: a null here would hide which check actually failed.
  var text = function (s) { var el = q(s); return el ? el.textContent : '(nao existe ' + s + ')'; };
  var data = function (s) { var el = q(s); return el ? el.dataset.c : '(nao existe ' + s + ')'; };
  var click = function (s) {
    var el = q(s);
    if (!el) { fails.push('sem elemento ' + s); return; }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  var clickAt = function (s, frac) {
    var el = q(s);
    if (!el) { fails.push('sem elemento ' + s); return; }
    var r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: r.left + r.width * frac, clientY: r.top + r.height / 2,
    }));
  };
  var item = function (kind, name, group, url) {
    var it = [];
    it[I_KIND] = kind; it[I_NAME] = name; it[I_LOGO] = ''; it[I_GROUP] = group; it[I_URL] = url;
    return it;
  };
  var dead = 'http://127.0.0.1:1/nada';
  var channels = [
    item(LIVE, 'Globo', 'Abertos', dead),
    item(LIVE, 'SBT', 'Abertos', dead),
    item(LIVE, 'SporTV', 'Esportes', dead),
  ];

  // ---- live ----
  show(Player(channels, 0));
  await sleep(300);
  check(q('#ctl.on'), 'a barra devia aparecer sozinha ao abrir o player');
  check(q('#ctl [data-c="list"]'), 'falta o botao de canais');
  check(q('#ctl [data-c="multi"]'), 'falta o botao do multitela');
  check(q('#ctl .vol'), 'falta o controle de volume');
  check(!q('#ctl .seek'), 'canal ao vivo nao devia ter barra de progresso');
  check(text('#ctl .now') === 'Globo', 'a barra devia nomear o canal atual, mostrou ' + text('#ctl .now'));

  // ---- folder list ----
  click('#ctl [data-c="list"]');
  await sleep(200);
  check(q('#chlist.on'), 'o botao de canais devia abrir a lista');
  check(text('#chlist h2') === 'Abertos', 'a lista devia abrir na pasta do canal atual, abriu ' + text('#chlist h2'));
  var rows = document.querySelectorAll('#chlist .row');
  check(rows.length === 2, 'a lista devia trazer so os 2 canais da pasta, veio ' + rows.length);
  check(data('#chlist .row.sel') === 'ch:0', 'o canal atual devia estar destacado na lista');

  // ---- zapping from the list keeps it open ----
  click('#chlist [data-c="ch:1"]');
  await sleep(300);
  check(text('#ctl .now') === 'SBT', 'clicar na lista devia trocar o canal, ficou em ' + text('#ctl .now'));
  check(q('#chlist.on'), 'a lista devia continuar aberta depois de trocar');
  check(data('#chlist .row.sel') === 'ch:1', 'o destaque devia seguir o canal novo');

  // ---- volume ----
  clickAt('#ctl .vol', 0.25);
  await sleep(100);
  var vol = document.getElementById('vid').volume;
  check(Math.abs(vol - 0.25) < 0.05, 'clicar a 25% do volume devia dar 0.25, deu ' + vol);
  click('#ctl [data-c="mute"]');
  await sleep(100);
  check(document.getElementById('vid').muted, 'o botao de mudo devia silenciar');

  // ---- theater mode ----
  click('#ctl [data-c="theater"]');
  await sleep(100);
  check(!q('#ctl.on'), 'o teatro devia esconder a barra');
  check(!q('#chlist.on'), 'o teatro devia fechar a lista');
  check(document.body.classList.contains('nocursor'), 'o teatro devia esconder o cursor');
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  await sleep(100);
  check(q('#ctl.on'), 'mexer o mouse devia trazer a barra de volta no teatro');
  current().back();
  await sleep(100);
  check(document.body.classList.contains('playing'), 'o primeiro Esc devia sair do teatro, nao do player');

  // ---- a list left open must not survive into the next player ----
  click('#ctl [data-c="list"]');
  await sleep(200);
  check(q('#chlist.on'), 'a lista devia reabrir depois do teatro');
  check(document.body.classList.contains('list'), 'o body devia marcar que a lista esta aberta');
  var btns = q('#ctl .btns');
  check(btns && btns.scrollWidth <= btns.clientWidth + 1,
    'a barra nao devia transbordar com a lista aberta: ' + (btns ? btns.scrollWidth + ' > ' + btns.clientWidth : 'sem barra'));
  check(q('#chlist').getBoundingClientRect().bottom <= q('#ctl').getBoundingClientRect().top + 1,
    'a lista devia parar acima da barra');

  // ---- movie: timeline instead of channels ----
  show(Player([item(MOVIE, 'Filme Teste', 'Filmes', dead)], 0));
  await sleep(300);
  check(!q('#chlist.on'), 'abrir outro player devia fechar a lista do anterior');
  check(!document.body.classList.contains('list'), 'o body nao devia continuar marcado com a lista');
  check(q('#ctl .seek'), 'filme devia ter barra de progresso');
  check(q('#ctl .time'), 'filme devia mostrar o tempo');
  check(q('#ctl [data-c="play"]'), 'filme devia ter pausa');
  check(!q('#ctl [data-c="list"]'), 'filme nao devia ter botao de canais');
  current().back();

  return fails;
})()`;

app.whenReady().then(async () => {
  try {
    await new Promise((r) => setTimeout(r, 1500)); // let the page load app.js
    const win = BrowserWindow.getAllWindows()[0];
    assert(win, 'the app should open a window');
    const fails = await win.webContents.executeJavaScript(SUITE, true);
    assert(Array.isArray(fails), `the suite should return a list, got ${JSON.stringify(fails)}`);
    assert.deepStrictEqual(fails, [], `\n - ${fails.join('\n - ')}`);
    report('ok: bar, folder list, volume, theater and the movie timeline', 0);
  } catch (err) {
    report(`FAIL: ${err.message}`, 1);
  }
});
