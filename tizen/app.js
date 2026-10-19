'use strict';
// SoulFork TV for Samsung Tizen. Written for the Chromium 56 engine of 2018 TVs:
// no optional chaining, no ??, no object spread, no flex gap.

var AV = typeof webapis !== 'undefined' && webapis.avplay;
// Windows app (Electron): its preload exposes window.soulfork. Adds mouse, multiscreen and "open in VLC".
var DESKTOP = typeof window.soulfork !== 'undefined';
var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8,
  CHUP: 427, CHDOWN: 428, PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, FF: 417, RW: 412, STOP: 413,
  IME_DONE: 65376, IME_CANCEL: 65385, LONG: 'long',
  PGUP: 33, PGDN: 34, V: 86, C: 67, T: 84 }; // PageUp/PageDown stand in for CH+/CH- on a PC keyboard
if (typeof tizen !== 'undefined') {
  ['ChannelUp', 'ChannelDown', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward',
    'MediaRewind', 'MediaStop'].forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
}

var app = document.getElementById('app');
var DAY = 24 * 60 * 60 * 1000;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

var toastTimer = 0;
function toast(msg, ms) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  if (ms !== 0) toastTimer = setTimeout(function () { t.style.display = 'none'; }, ms || 3000);
}
function hideToast() { document.getElementById('toast').style.display = 'none'; }

// ---------- settings ----------
var prefs = {
  get: function (k) { return localStorage.getItem('sf.' + k) || ''; },
  set: function (k, v) { localStorage.setItem('sf.' + k, v); },
  del: function (k) { localStorage.removeItem('sf.' + k); },
};
function hasLogin() {
  return prefs.get('mode') === 'xtream' ? !!(prefs.get('server') && prefs.get('user')) : !!prefs.get('m3u');
}
function favorites() {
  try { return new Set(JSON.parse(prefs.get('fav') || '[]')); } catch (e) { return new Set(); }
}
function saveFavorites(set) { prefs.set('fav', JSON.stringify(Array.from(set))); }

// ---------- items ----------
// Compact arrays instead of objects: big lists have ~300k entries and TVs are short on memory.
var LIVE = 0, MOVIE = 1, SERIES = 2, EPISODE = 3;
var I_KIND = 0, I_NAME = 1, I_LOGO = 2, I_GROUP = 3, I_URL = 4, I_SID = 5,
  I_GENRE = 6, I_YEAR = 7, I_RATING = 8, I_PLOT = 9; // the last four only come from the Xtream API

/** TMDB's English TV genres -> the names the list already uses for movies. */
var GENRE_PT = {
  'Action & Adventure': ['Ação', 'Aventura'], 'Sci-Fi & Fantasy': ['Ficção científica', 'Fantasia'],
  'War & Politics': ['Guerra', 'Política'], 'Soap': ['Novela'], 'Kids': ['Infantil'], 'News': ['Notícias'],
  'Talk': ['Talk show'], 'Reality': ['Reality show'], 'Comedia': ['Comédia'],
};

var THIS_YEAR = new Date().getFullYear();
/** Last plausible year in a title: "Blade Runner 2049 (2017)" -> 2017. */
function yearOf(name) {
  var m = String(name).match(/\b(19|20)\d{2}\b/g) || [];
  for (var i = m.length - 1; i >= 0; i--) { var y = parseInt(m[i], 10); if (y <= THIS_YEAR + 1) return y; }
  return 0;
}

function kindOf(url) {
  if (url.indexOf('/movie/') >= 0) return MOVIE;
  if (url.indexOf('/series/') >= 0) return EPISODE;
  return LIVE;
}

/** attr="value" from an #EXTINF header. */
function attr(head, key) {
  var i = head.toLowerCase().indexOf(key + '="');
  if (i < 0) return '';
  var start = i + key.length + 2, end = head.indexOf('"', start);
  return end < 0 ? '' : head.substring(start, end);
}

/** Returns a line consumer that appends parsed entries to `out`. */
function m3uParser(out) {
  var name = '', head = '';
  return function (raw) {
    var line = raw.trim();
    if (/^#EXTINF/i.test(line)) {
      var q = false, comma = -1;
      for (var i = 0; i < line.length; i++) {
        var c = line.charAt(i);
        if (c === '"') q = !q;
        else if (c === ',' && !q) { comma = i; break; }
      }
      head = comma >= 0 ? line.substring(0, comma) : line;
      name = comma >= 0 ? line.substring(comma + 1).trim() : '';
    } else if (line && line.charAt(0) !== '#') {
      out.push([kindOf(line), name || attr(head, 'tvg-name') || line.split('/').pop(),
        attr(head, 'tvg-logo'), attr(head, 'group-title') || 'Sem categoria', line, '']);
      name = head = '';
    }
  };
}

var episodeRe = /^(.*?)[\s._-]*[Ss](\d{1,2})\s*[Ee]\d{1,3}/;

/** "The Office S02 E05" -> show "The Office", season group "Temporada 2". */
function showOf(name) {
  var m = episodeRe.exec(name);
  return (m && m[1].trim()) || name;
}

function groupEpisodes(eps) {
  var shows = new Map();
  eps.forEach(function (e) {
    var m = episodeRe.exec(e[I_NAME]);
    var show = showOf(e[I_NAME]);
    var ep = m ? [e[I_KIND], e[I_NAME], e[I_LOGO], 'Temporada ' + parseInt(m[2], 10), e[I_URL], ''] : e;
    if (!shows.has(show)) shows.set(show, []);
    shows.get(show).push(ep);
  });
  return shows;
}

// ---------- network ----------
async function getJson(url) {
  var r = await fetch(url);
  if (!r.ok) throw new Error('o servidor respondeu ' + r.status);
  var d = await r.json();
  return typeof d === 'string' ? JSON.parse(b64utf8(d)) : d; // some panels base64 the whole answer
}

function b64utf8(s) {
  try {
    var bin = atob(s);
    if (typeof TextDecoder === 'undefined') return decodeURIComponent(escape(bin));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e) { return s; }
}

/** Streams a big text response line by line so a 130 MB list never sits in memory as one string. */
async function fetchLines(url, onLine, onProgress) {
  var r = await fetch(url);
  if (!r.ok) throw new Error('o servidor respondeu ' + r.status);
  if (!r.body || typeof TextDecoder === 'undefined') { (await r.text()).split('\n').forEach(onLine); return; }
  var reader = r.body.getReader(), dec = new TextDecoder(), rest = '', bytes = 0;
  for (;;) {
    var chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.length;
    var lines = (rest + dec.decode(chunk.value, { stream: true })).split('\n');
    rest = lines.pop();
    lines.forEach(onLine);
    if (onProgress) onProgress(bytes);
  }
  if (rest) onLine(rest);
}

function xtreamBase() {
  var s = prefs.get('server').trim().replace(/\/+$/, '');
  return s.indexOf('://') >= 0 ? s : 'http://' + s;
}
function xtreamApi(action, extra) {
  var c = xtreamCreds();
  return getJson(c.base + '/player_api.php?username=' + encodeURIComponent(c.user) +
    '&password=' + encodeURIComponent(c.pass) + (action ? '&action=' + action : '') + (extra || ''));
}

/** Plot/genre/date/rating of one movie, for the details panel. */
var vodInfoCache = new Map();
async function vodInfo(it) {
  var id = /\/(\d+)\.\w+$/.exec(it[I_URL]);
  if (!id) return null;
  if (!vodInfoCache.has(id[1])) {
    var d = await xtreamApi('get_vod_info', '&vod_id=' + id[1]);
    vodInfoCache.set(id[1], (d && d.info) || {});
  }
  return vodInfoCache.get(id[1]);
}

async function fetchXtream(onProgress) {
  var c = xtreamCreds(), b = c.base, u = c.user, p = c.pass;
  var auth = await xtreamApi();
  if (!auth.user_info || String(auth.user_info.auth) !== '1') throw new Error('usuário ou senha inválidos');
  var out = [];
  async function section(catAction, action, make) {
    var cats = {};
    (await xtreamApi(catAction)).forEach(function (c) { cats[String(c.category_id)] = c.category_name; });
    (await xtreamApi(action)).forEach(function (o) { out.push(make(o, cats[String(o.category_id)] || 'Sem categoria')); });
    if (onProgress) onProgress(out.length);
  }
  await section('get_live_categories', 'get_live_streams', function (o, g) {
    return [LIVE, o.name, o.stream_icon || '', g, b + '/live/' + u + '/' + p + '/' + o.stream_id + '.ts', ''];
  });
  await section('get_vod_categories', 'get_vod_streams', function (o, g) {
    return [MOVIE, o.name, o.stream_icon || '', g,
      b + '/movie/' + u + '/' + p + '/' + o.stream_id + '.' + (o.container_extension || 'mp4'), '',
      '', yearOf(o.name), o.rating || '', ''];
  });
  await section('get_series_categories', 'get_series', function (o, g) {
    return [SERIES, o.name, o.cover || '', g, '', String(o.series_id),
      o.genre || '', parseInt(String(o.releaseDate || '').substr(0, 4), 10) || yearOf(o.name), o.rating || '', o.plot || ''];
  });
  return out;
}

async function xtreamEpisodes(sid) {
  var c = xtreamCreds(), b = c.base, u = c.user, p = c.pass;
  var info = await xtreamApi('get_series_info', '&series_id=' + sid);
  var eps = info.episodes, out = [];
  if (!eps || Array.isArray(eps)) return out; // empty series come back as []
  Object.keys(eps).sort(function (a, c) { return a - c; }).forEach(function (season) {
    eps[season].forEach(function (e) {
      // Titles often repeat the show: "Pinky e o Cérebro - S01E01 - Ratos" -> "Ratos".
      var t = String(e.title || '').replace(/^.*?S\d+\s*E\d+\s*[-–:]?\s*/i, '');
      out.push([EPISODE, 'E' + e.episode_num + (t ? ' · ' + t : ''),
        (e.info && e.info.movie_image) || '', 'Temporada ' + season,
        b + '/series/' + u + '/' + p + '/' + e.id + '.' + (e.container_extension || 'mp4'), '']);
    });
  });
  return out;
}

async function fetchAll(onProgress) {
  // get.php links carry Xtream credentials: the API is faster than the M3U and brings genre, year and plot.
  if (xtreamCreds()) return fetchXtream(onProgress);
  var out = [];
  await fetchLines(prefs.get('m3u').trim(), m3uParser(out), function () { if (onProgress) onProgress(out.length); });
  return out;
}

// ---------- cache (IndexedDB, in chunks) ----------
var CHUNK = 5000;
var CACHE_VERSION = '2'; // 2: genre, year, rating and plot from the Xtream API
function openDb() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('soulfork', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('chunks'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function tx(db, mode, fn) {
  return new Promise(function (res, rej) {
    var t = db.transaction('chunks', mode);
    var result = fn(t.objectStore('chunks'));
    t.oncomplete = function () { res(result && result.result); };
    t.onerror = t.onabort = function () { rej(t.error); };
  });
}
async function saveCache(items) {
  var db = await openDb();
  await tx(db, 'readwrite', function (s) {
    s.clear();
    for (var i = 0, n = 0; i < items.length; i += CHUNK, n++) s.put(items.slice(i, i + CHUNK), n);
  });
  prefs.set('cachedAt', String(Date.now()));
  prefs.set('cacheVersion', CACHE_VERSION);
}
async function loadCache() {
  var db = await openDb();
  var chunks = await tx(db, 'readonly', function (s) { return s.getAll(); });
  var all = [];
  (chunks || []).forEach(function (c) { for (var i = 0; i < c.length; i++) all.push(c[i]); });
  return all;
}
async function clearCache() {
  prefs.del('cachedAt');
  await tx(await openDb(), 'readwrite', function (s) { s.clear(); });
}

// ---------- repository ----------
var repo = { live: [], movies: [], series: [], shows: new Map() };

function applyItems(all) {
  var eps = [];
  repo.live = []; repo.movies = []; repo.series = [];
  all.forEach(function (it) {
    if (it[I_KIND] === LIVE) repo.live.push(it);
    else if (it[I_KIND] === MOVIE) repo.movies.push(it);
    else if (it[I_KIND] === SERIES) repo.series.push(it);
    else eps.push(it);
  });
  // M3U lists series as loose episodes; fold them into one entry per show.
  repo.shows = groupEpisodes(eps);
  // The show keeps the list's category ("Séries | Netflix"); its episodes were regrouped by season.
  var category = new Map();
  eps.forEach(function (e) { var s = showOf(e[I_NAME]); if (!category.has(s)) category.set(s, e[I_GROUP]); });
  repo.shows.forEach(function (list, show) {
    repo.series.push([SERIES, show, list[0][I_LOGO], category.get(show), '', 'm3u:' + show]);
  });
}

/** Opens from the copy saved on the TV when there is one; refreshes it in the background once a day. */
async function loadRepo(refresh, onProgress) {
  // Bump CACHE_VERSION when the saved item format changes, so old copies are downloaded again.
  var cachedAt = prefs.get('cacheVersion') === CACHE_VERSION ? Number(prefs.get('cachedAt')) : 0;
  if (!refresh && cachedAt) {
    var cached = await loadCache();
    if (cached.length) {
      applyItems(cached);
      if (Date.now() - cachedAt > DAY) {
        fetchAll().then(saveCache).catch(function (e) { console.warn('background refresh failed', e); });
      }
      return;
    }
  }
  var all = await fetchAll(onProgress);
  applyItems(all);
  await saveCache(all).catch(function (e) { console.warn('cache save failed', e); });
}

/** Season, then episode number ("Temporada 2" + "... S02 E05" / "T2 E5 · ..."). */
function byEpisode(a, b) {
  function num(s, re) { var m = re.exec(s); return m ? parseInt(m[1], 10) : 0; }
  return num(a[I_GROUP], /(\d+)/) - num(b[I_GROUP], /(\d+)/) ||
    num(a[I_NAME], /[Ee](\d+)(?!.*[Ee]\d)/) - num(b[I_NAME], /[Ee](\d+)(?!.*[Ee]\d)/);
}

// ---------- EPG (Xtream short EPG: now / next) ----------
/** Xtream credentials: from the login, or from an M3U link of the get.php?username=&password= kind. */
function xtreamCreds() {
  if (prefs.get('mode') === 'xtream') return { base: xtreamBase(), user: prefs.get('user'), pass: prefs.get('pass') };
  var m = /^(https?:\/\/[^\/]+)\/get\.php\?(.*)$/i.exec(prefs.get('m3u').trim());
  if (!m) return null;
  var q = {};
  m[2].split('&').forEach(function (kv) { var p = kv.split('='); q[p[0]] = decodeURIComponent(p[1] || ''); });
  return q.username && q.password ? { base: m[1], user: q.username, pass: q.password } : null;
}

var epgCache = new Map();
/** "Agora: X (23:30–01:15)\nA seguir: Y", or '' when the server has no guide for the channel. */
async function epgNow(it) {
  var id = /\/(\d+)(\.\w+)?$/.exec(it[I_URL]);
  if (!xtreamCreds() || !id) return '';
  var hit = epgCache.get(id[1]);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.text;
  var d = await xtreamApi('get_short_epg', '&stream_id=' + id[1] + '&limit=2');
  var text = (d.epg_listings || []).map(function (e, i) {
    return (i ? 'A seguir: ' : 'Agora: ') + b64utf8(e.title) + ' (' + String(e.start).substr(11, 5) + '–' + String(e.end).substr(11, 5) + ')';
  }).join('\n');
  epgCache.set(id[1], { at: Date.now(), text: text });
  return text;
}

function episodesOf(sid) {
  if (sid.indexOf('m3u:') === 0) return Promise.resolve(repo.shows.get(sid.substring(4)) || []);
  return xtreamEpisodes(sid);
}

// ---------- navigation ----------
var stack = [];
function show(screen) { stack.push(screen); screen.render(); }
function back() {
  if (stack.length > 1) { stack.pop(); stack[stack.length - 1].render(); }
  else if (typeof tizen !== 'undefined') tizen.application.getCurrentApplication().exit();
}
function reset(screen) { stack = []; show(screen); }
function current() { return stack[stack.length - 1]; }

// OK fires on key release so that holding it can mean "long press" (favorite).
var okDownAt = 0, longFired = false;
document.addEventListener('keydown', function (e) {
  var k = e.keyCode, s = current();
  if (!s) return;
  var input = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (input) {
    if (k === KEY.IME_DONE || k === KEY.IME_CANCEL || k === KEY.ENTER || k === KEY.BACK || k === KEY.ESC ||
        k === KEY.UP || k === KEY.DOWN) {
      document.activeElement.blur();
      if (k === KEY.UP || k === KEY.DOWN) s.key(k);
      e.preventDefault();
    }
    return;
  }
  e.preventDefault();
  if (k === KEY.ENTER) {
    if (!okDownAt) { okDownAt = Date.now(); longFired = false; }
    else if (!longFired && Date.now() - okDownAt > 700) { longFired = true; s.key(KEY.LONG); }
    return;
  }
  if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { s.back ? s.back() : back(); return; }
  s.key(k);
});
document.addEventListener('keyup', function (e) {
  if (e.keyCode !== KEY.ENTER || !okDownAt) return;
  okDownAt = 0;
  if (!longFired && current()) current().key(KEY.ENTER);
});

// Mouse (Windows): clickable elements carry data-n (simple screens), data-g (category), data-i (item)
// or data-c (a player control). Click = OK on that element, right click = hold OK (favorite / remove),
// wheel = up/down. The event goes through too: sliders need the click position.
function mouse(e, long) {
  var s = current(), el = e.target.closest && e.target.closest('[data-n],[data-g],[data-i],[data-c]');
  if (!s || !s.click) return;
  if (el || s.clickAnywhere) { e.preventDefault(); s.click(el ? el.dataset : {}, long, e); }
}
document.addEventListener('click', function (e) { mouse(e, false); });
document.addEventListener('contextmenu', function (e) { mouse(e, true); });
document.addEventListener('wheel', function (e) {
  var s = current();
  if (!s || !DESKTOP || document.body.classList.contains('playing')) return;
  if (s.wheel) s.wheel(e.deltaY > 0 ? KEY.DOWN : KEY.UP, e.target);
  else s.key(e.deltaY > 0 ? KEY.DOWN : KEY.UP);
});

/** Linear focus list for simple screens: returns new index. */
function step(i, k, n) {
  if (k === KEY.DOWN || k === KEY.RIGHT) return Math.min(n - 1, i + 1);
  if (k === KEY.UP || k === KEY.LEFT) return Math.max(0, i - 1);
  return i;
}

// ---------- screens ----------
function Login(autoload, refresh) {
  var mode = prefs.get('mode') || 'm3u', idx = 0, status = '', busy = false;
  var fields = { m3u: prefs.get('m3u'), server: prefs.get('server'), user: prefs.get('user'), pass: prefs.get('pass') };

  function ids() {
    return ['tabM3u', 'tabXt'].concat(mode === 'xtream' ? ['server', 'user', 'pass'] : ['m3u'], ['enter']);
  }
  function input(id, ph, type) {
    return '<input id="' + id + '" type="' + (type || 'text') + '" placeholder="' + ph + '" value="' + esc(fields[id]) + '">';
  }
  function render() {
    app.innerHTML = '<div class="login"><img src="logo.png"><h1>SoulFork TV</h1>' +
      '<div class="tabs"><div id="tabM3u" class="tile' + (mode === 'm3u' ? ' sel' : '') + '">Link M3U</div>' +
      '<div id="tabXt" class="tile' + (mode === 'xtream' ? ' sel' : '') + '">Xtream Codes</div></div>' +
      (mode === 'xtream'
        ? input('server', 'Servidor (http://servidor:porta)') + input('user', 'Usuário') + input('pass', 'Senha', 'password')
        : input('m3u', 'http://servidor/lista.m3u8')) +
      '<div id="enter" class="tile enter">' + (busy ? 'Carregando…' : 'Entrar') + '</div>' +
      '<div class="hint">' + (DESKTOP ? 'Clique no campo e cole o link com Ctrl+V.'
        : 'Para colar o link: use o teclado do app SmartThings no celular.') + '</div>' +
      '<div class="status">' + esc(status) + '</div></div>';
    ids().forEach(function (id, i) { document.getElementById(id).setAttribute('data-n', i); });
    Array.prototype.forEach.call(app.querySelectorAll('input'), function (el) {
      el.addEventListener('input', function () { fields[el.id] = el.value; });
    });
    focus();
  }
  function focus() {
    var list = ids();
    idx = Math.min(idx, list.length - 1);
    Array.prototype.forEach.call(app.querySelectorAll('.focus'), function (el) { el.classList.remove('focus'); });
    document.getElementById(list[idx]).classList.add('focus');
  }
  function setStatus(s) { status = s; var el = app.querySelector('.status'); if (el) el.textContent = s; }

  async function load(fresh) {
    if (busy) return;
    busy = true; render();
    setStatus(fresh || !prefs.get('cachedAt')
      ? 'Baixando sua lista… listas grandes levam alguns minutos, só na primeira vez.' : 'Abrindo sua lista…');
    try {
      await loadRepo(fresh, function (n) { setStatus('Baixando sua lista… ' + n.toLocaleString('pt-BR') + ' itens'); });
      busy = false;
      if (!repo.live.length && !repo.movies.length && !repo.series.length) { setStatus('A lista veio vazia. Confira o link.'); render(); }
      else reset(Home());
    } catch (e) {
      busy = false;
      status = 'Não deu para carregar: ' + (e.message || e);
      render();
    }
  }

  var screen = {
    render: render,
    click: function (d) { idx = Number(d.n); focus(); screen.key(KEY.ENTER); },
    key: function (k) {
      var id = ids()[idx];
      if (k !== KEY.ENTER) { idx = step(idx, k, ids().length); focus(); return; }
      if (id === 'tabM3u' || id === 'tabXt') { mode = id === 'tabXt' ? 'xtream' : 'm3u'; render(); }
      else if (id === 'enter') {
        prefs.set('mode', mode);
        Object.keys(fields).forEach(function (f) { prefs.set(f, (fields[f] || '').trim()); });
        if (hasLogin()) load(true); else setStatus('Preencha os campos.');
      } else document.getElementById(id).focus(); // opens the TV keyboard
    },
  };
  if (autoload && hasLogin()) setTimeout(function () { load(!!refresh); }, 0);
  return screen;
}

function Home() {
  var cards = [['TV ao Vivo', repo.live.length + ' canais'], ['Filmes', repo.movies.length + ' títulos'],
    ['Séries', repo.series.length + ' títulos']];
  if (DESKTOP) cards.push(['Multitela', 'até ' + MULTI_MAX + ' canais']); // TVs get a single video decoder, see Multi
  // 0..C-1: cards, C and C+1: the actions underneath.
  var C = cards.length, idx = 0;
  function render() {
    app.innerHTML = '<div class="home"><div class="brand"><img src="logo.png"><h1>SoulFork TV</h1></div><div class="cards">' +
      cards.map(function (c, i) { return '<div class="tile" id="h' + i + '" data-n="' + i + '">' + c[0] + '<small>' + c[1] + '</small></div>'; }).join('') +
      '</div><div class="actions"><div class="tile" id="h' + C + '" data-n="' + C + '">Atualizar lista</div>' +
      '<div class="tile" id="h' + (C + 1) + '" data-n="' + (C + 1) + '">Trocar lista</div></div></div>';
    document.getElementById('h' + idx).classList.add('focus');
  }
  var screen = {
    render: render,
    click: function (d) { idx = Number(d.n); screen.key(KEY.ENTER); },
    key: function (k) {
      if (k === KEY.ENTER) {
        if (idx < 3) show(Browse(cards[idx][0], [repo.live, repo.movies, repo.series][idx]));
        else if (idx < C) show(Multi());
        else if (idx === C) reset(Login(true, true));
        else {
          ['m3u', 'server', 'user', 'pass'].forEach(prefs.del);
          clearCache().catch(function () {});
          reset(Login(false));
        }
        return;
      }
      if (k === KEY.DOWN && idx < C) idx = C;
      else if (k === KEY.UP && idx >= C) idx = 0;
      else if (k === KEY.LEFT) idx = idx === C ? idx : Math.max(0, idx - 1);
      else if (k === KEY.RIGHT) idx = idx === C - 1 || idx === C + 1 ? idx : idx + 1;
      render();
    },
  };
  return screen;
}

/**
 * Multiscreen channels (URLs), shared by the multiscreen and "hold OK" in the live player.
 * Kept only while the app is open (sessionStorage): closing it starts the next multiscreen empty.
 */
var MULTI_MAX = 4;
var CELLS = [0, 1, 2, 3];
function multiUrls() { try { return JSON.parse(sessionStorage.getItem('sf.multi') || '[]'); } catch (e) { return []; } }
function saveMultiUrls(urls) { sessionStorage.setItem('sf.multi', JSON.stringify(urls)); }
prefs.del('multi'); // older versions kept them across restarts

/** Plays a live channel in a <video>: the .m3u8 variant of the stream through hls.js. Returns a stop function. */
function playHls(video, url, onFail) {
  var hls = null;
  var m3u8 = url.replace(/\.ts$/, '') + '.m3u8';
  if (window.Hls && Hls.isSupported()) {
    // Opening many channels at once makes the panel slow to answer: retry instead of giving up.
    hls = new Hls({ maxBufferLength: 10, backBufferLength: 0, manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 1500,
      levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 6 });
    hls.on(Hls.Events.ERROR, function (e, d) { if (d.fatal) onFail(d.details); });
    hls.loadSource(m3u8);
    hls.attachMedia(video);
  } else video.src = m3u8;
  var p = video.play();
  if (p && p.catch) p.catch(function () {});
  return function () {
    if (hls) hls.destroy();
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
  };
}

/**
 * Windows only: up to MULTI_MAX live channels at once, one <video> + hls.js each. (On the Samsung QN55Q80B an app gets
 * a single video decoder, so this was removed from the TV after on-device tests.) One more cell than channels is
 * shown: 1 full screen, 2 side by side, 3-4 in 2x2. The selected cell has the sound.
 * Left/right pick the cell, up/down (also CH+/CH-, PageUp/PageDown) zap its channel, OK picks or swaps it from
 * the list, holding OK removes it.
 */
function Multi(focusUrl) {
  var channels = [], sel = 0, cells = [];

  function load() {
    var byUrl = new Map();
    repo.live.forEach(function (it) { byUrl.set(it[I_URL], it); });
    channels = multiUrls().map(function (u) { return byUrl.get(u); }).filter(Boolean);
    if (focusUrl) { sel = Math.max(0, channels.map(function (c) { return c[I_URL]; }).indexOf(focusUrl)); focusUrl = null; }
  }
  function count() { return Math.min(MULTI_MAX, channels.length + 1); }

  function render() {
    load();
    app.innerHTML = '<div class="multi">' + CELLS.map(function (i) {
      return '<div class="cell" id="c' + i + '" data-n="' + i + '"><video muted playsinline></video>' +
        '<div class="hint">+ Adicionar canal</div><div class="label"></div></div>';
    }).join('') + '</div>';
    cells = CELLS.map(function (i) {
      var el = document.getElementById('c' + i);
      return { el: el, video: el.querySelector('video'), label: el.querySelector('.label'), hint: el.querySelector('.hint') };
    });
    update();
    channels.forEach(function (ch, i) { start(i); });
  }

  /** Positions, borders, labels and sound, without touching the running videos. */
  function update() {
    var n = count();
    sel = Math.min(sel, n - 1);
    var boxes = n === 1 ? [[0, 0, 1920, 1080]] : n === 2 ? [[0, 270, 960, 540], [960, 270, 960, 540]]
      : [[0, 0, 960, 540], [960, 0, 960, 540], [0, 540, 960, 540], [960, 540, 960, 540]];
    cells.forEach(function (c, i) {
      var b = i < n ? boxes[i] : null, ch = channels[i];
      c.el.style.display = b ? 'block' : 'none';
      if (b) { c.el.style.left = b[0] + 'px'; c.el.style.top = b[1] + 'px'; c.el.style.width = b[2] + 'px'; c.el.style.height = b[3] + 'px'; }
      c.el.className = 'cell' + (i === sel ? ' sel' : '');
      c.hint.style.display = ch ? 'none' : 'flex';
      c.label.style.display = ch ? 'block' : 'none';
      if (ch && !c.failed) c.label.textContent = (i === sel ? '🔊 ' : '') + ch[I_NAME];
      c.video.muted = i !== sel;
    });
  }

  function start(i) {
    var c = cells[i], ch = channels[i];
    stop(i);
    c.failed = false;
    c.stop = playHls(c.video, ch[I_URL], function (why) { c.failed = true; c.label.textContent = ch[I_NAME] + ': não abriu (' + why + ')'; });
    c.video.muted = i !== sel;
  }
  function stop(i) { var c = cells[i]; if (c && c.stop) { c.stop(); c.stop = null; } }
  function stopAll() { cells.forEach(function (c, i) { stop(i); }); }

  /** Left/right walk the cells in order (1 → 2 → 3 → 4); up/down are for changing the channel. */
  function move(k) {
    var n = count();
    if (k === KEY.LEFT) sel = (sel - 1 + n) % n;
    else if (k === KEY.RIGHT) sel = (sel + 1) % n;
  }

  /** Puts `it` in cell i (adding or replacing). The server refuses the same channel twice at the same time. */
  function setChannel(i, it) {
    var urls = multiUrls();
    if (urls.indexOf(it[I_URL]) >= 0) { toast('Esse canal já está na tela'); return false; }
    if (i < urls.length) urls[i] = it[I_URL]; else urls.push(it[I_URL]);
    saveMultiUrls(urls);
    sel = Math.min(i, urls.length - 1);
    return true;
  }

  /** Next/previous channel of the list in the selected cell, skipping ones already on screen. */
  function zap(d) {
    var ch = channels[sel], n = repo.live.length;
    if (!ch) return;
    var at = repo.live.indexOf(ch), urls = multiUrls();
    for (var s = 1; s < n; s++) {
      var it = repo.live[((at + d * s) % n + n) % n];
      if (urls.indexOf(it[I_URL]) < 0) { setChannel(sel, it); break; }
    }
    load();
    start(sel);
    update();
    toast(channels[sel][I_NAME]);
  }

  var screen = {
    isMulti: true,
    render: render,
    focus: function (url) { focusUrl = url; },
    back: function () { stopAll(); back(); },
    click: function (d, long) {
      var i = Number(d.n);
      if (i !== sel) { sel = i; update(); if (!long) return; } // first click selects (and moves the sound)
      screen.key(long ? KEY.LONG : KEY.ENTER);
    },
    key: function (k) {
      var ch = channels[sel];
      if (k === KEY.ENTER) {
        stopAll();
        var cell = sel;
        show(Browse(ch ? 'Trocar o canal' : 'Escolha o canal', repo.live, null, false, function (it) { setChannel(cell, it); }));
        return;
      }
      if (k === KEY.LONG && ch) {
        stopAll();
        saveMultiUrls(multiUrls().filter(function (u) { return u !== ch[I_URL]; }));
        toast(ch[I_NAME] + ' saiu da tela');
        render();
        return;
      }
      if (k === KEY.UP || k === KEY.CHUP || k === KEY.PGUP) { zap(-1); return; }
      if (k === KEY.DOWN || k === KEY.CHDOWN || k === KEY.PGDN) { zap(1); return; }
      move(k);
      update();
    },
  };
  return screen;
}

var ROWS = 9;      // visible rows in list mode (live channels, episodes)
var COLS = 3;      // poster grid for movies and series: 3 x 3
var GRID_ROWS = 3;

/** Categories on the left; a list (live, episodes) or a poster grid with details (movies, series) on the right. */
function Browse(title, items, loading, episodes, pick) {
  var all = [], groups = [], shown = [], cur = 1, col = 0, gi = 1, ii = 0, q = '', msg = loading || '';
  var grid = false, detailTimer = 0;

  function key(it) { return it[I_SID] ? 'series:' + it[I_SID] : it[I_URL]; }
  function group(label, test, sort) { return { label: label, test: test, sort: sort }; }
  function byGroup(g) { return function (it) { return it[I_GROUP] === g; }; }
  function genres(it) {
    var out = [];
    (it[I_GENRE] ? it[I_GENRE].split(/\s*[,\/]\s*/) : []).forEach(function (g) {
      (GENRE_PT[g] || [g]).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    });
    return out;
  }

  function setData(list) {
    var seen = new Set();
    grid = !episodes && list.length > 0 && (list[0][I_KIND] === MOVIE || list[0][I_KIND] === SERIES);
    if (episodes) {
      // A series: only its seasons on the left, opening on the first one, episodes in order.
      all = list.slice().sort(byEpisode);
      groups = [];
      cur = gi = 0;
      col = 1;
    } else {
      all = list;
      var favs = favorites();
      groups = [group('★ Favoritos', function (it, f) { return f.has(key(it)); }), group('Todos', function () { return true; })];
      if (grid) groups.push(group('Mais novos', function (it) { return it[I_YEAR] > 0; }, function (a, b) { return b[I_YEAR] - a[I_YEAR]; }));
      cur = gi = all.some(function (it) { return favs.has(key(it)); }) ? 0 : 1;
    }
    all.forEach(function (it) {
      if (!seen.has(it[I_GROUP])) { seen.add(it[I_GROUP]); groups.push(group(it[I_GROUP], byGroup(it[I_GROUP]))); }
    });
    if (grid) {
      // Genres from the server (series), most common first, then release years, newest first.
      var count = new Map(), years = new Set();
      all.forEach(function (it) {
        genres(it).forEach(function (g) { if (g) count.set(g, (count.get(g) || 0) + 1); });
        if (it[I_YEAR]) years.add(it[I_YEAR]);
      });
      Array.from(count).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (e) {
        groups.push(group('Gênero · ' + e[0], function (it) { return genres(it).indexOf(e[0]) >= 0; }));
      });
      Array.from(years).sort(function (a, b) { return b - a; }).forEach(function (y) {
        groups.push(group('Ano ' + y, function (it) { return it[I_YEAR] === y; }));
      });
    }
    filter();
  }
  function filter() {
    var favs = favorites(), needle = q.toLowerCase(), g = groups[cur];
    ii = 0;
    if (!g) { shown = []; return; } // episodes still loading
    shown = all.filter(function (it) {
      return g.test(it, favs) && (!needle || it[I_NAME].toLowerCase().indexOf(needle) >= 0);
    });
    if (g.sort) shown.sort(g.sort);
    ii = 0;
  }

  function rows(list, sel, focused, label, logo, attr) {
    var start = Math.max(0, Math.min(sel - 4, list.length - ROWS));
    return list.slice(start, start + ROWS).map(function (x, i) {
      var n = start + i, img = logo ? logo(x) : '';
      return '<div class="row' + (n === sel ? (focused ? ' focus' : ' sel') : '') + '" data-' + attr + '="' + n + '">' +
        (img ? '<img src="' + esc(img) + '" onerror="this.style.visibility=\'hidden\'">' : '') +
        '<span>' + esc(label(x)) + '</span></div>';
    }).join('');
  }
  function posters() {
    var lastRow = Math.ceil(shown.length / COLS) - 1;
    var startRow = Math.max(0, Math.min(Math.floor(ii / COLS) - 1, lastRow - GRID_ROWS + 1));
    return shown.slice(startRow * COLS, (startRow + GRID_ROWS) * COLS).map(function (it, i) {
      var n = startRow * COLS + i;
      return '<div class="poster' + (n === ii ? (col === 1 ? ' focus' : ' sel') : '') + '" data-i="' + n + '">' +
        (it[I_LOGO] ? '<img src="' + esc(it[I_LOGO]) + '" onerror="this.style.display=\'none\'">' : '') +
        '<span>' + esc(it[I_NAME]) + '</span></div>';
    }).join('');
  }
  function details(it, info) {
    info = info || {};
    var year = it[I_YEAR] || String(info.releasedate || '').substr(0, 4);
    var rating = it[I_RATING] || info.rating;
    var genre = it[I_GENRE] ? genres(it).join(', ') : info.genre || '';
    var plot = it[I_PLOT] || info.plot || (it[I_KIND] === MOVIE && xtreamCreds() ? 'Carregando sinopse…' : 'Sem sinopse.');
    var meta = [year, rating && Number(rating) ? '★ ' + Number(rating).toFixed(1).replace('.', ',') : '', genre]
      .filter(function (x) { return x; }).join('  ·  ');
    return '<h3>' + esc(it[I_NAME]) + '</h3><div class="meta">' + esc(meta) + '</div><p>' + esc(plot) + '</p>';
  }

  function render() {
    var empty = msg || (shown.length ? '' : cur === 0 && !episodes ? 'Sem favoritos ainda. Segure OK num item para favoritar.' : 'Nada aqui.');
    var liveList = shown.length && shown[ii][I_KIND] === LIVE;
    var body;
    if (empty) body = '<div class="empty">' + esc(empty) + '</div>';
    else if (grid) {
      body = '<div class="split"><div><div class="grid">' + posters() + '</div><div class="count">' + (ii + 1) + ' de ' + shown.length +
        '</div></div><div class="details" id="details">' + details(shown[ii]) + '</div></div>';
    } else {
      body = '<div class="list">' + rows(shown, ii, col === 1, function (it) { return it[I_NAME]; },
        function (it) { return it[I_LOGO]; }, 'i') + '</div><div class="count">' + (ii + 1) + ' de ' + shown.length + '</div>' +
        (liveList ? '<div class="epg" id="epg"></div>' : '');
    }
    app.innerHTML = '<div class="browse' + (grid ? ' gridmode' : '') + '"><div class="left"><h2>' + esc(title) + '</h2><div class="list">' +
      rows(groups, col === 0 ? gi : cur, col === 0, function (g) { return g.label; }, null, 'g') + '</div></div>' +
      '<div class="right"><div class="search' + (col === 2 ? ' focus' : '') + '"><input id="q" placeholder="Buscar…" value="' + esc(q) + '"></div>' +
      body + '</div></div>';
    if (!empty && (liveList || grid)) loadExtra();
    var qi = document.getElementById('q'), timer = 0;
    qi.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { q = qi.value; filter(); }, 400);
    });
    qi.addEventListener('blur', function () { q = qi.value; filter(); col = shown.length ? 1 : 2; render(); });
  }

  /** Guide (channels) or movie plot, fetched only once the remote stops moving. */
  function loadExtra() {
    var it = shown[ii];
    clearTimeout(detailTimer);
    if (it[I_KIND] === LIVE) {
      detailTimer = setTimeout(function () {
        epgNow(it).then(function (text) {
          var el = document.getElementById('epg');
          if (el && shown[ii] === it) el.textContent = text;
        }, function () {});
      }, 500);
    } else if (it[I_KIND] === MOVIE && !it[I_PLOT] && xtreamCreds()) {
      detailTimer = setTimeout(function () {
        vodInfo(it).then(function (info) {
          var el = document.getElementById('details');
          if (el && shown[ii] === it) el.innerHTML = details(it, info || { plot: 'Sem sinopse.' });
        }, function () {
          var el = document.getElementById('details');
          if (el && shown[ii] === it) el.innerHTML = details(it, { plot: 'Sem sinopse.' });
        });
      }, 500);
    }
  }

  function open() {
    var it = shown[ii];
    if (pick) { pick(it); back(); } // choosing a channel for the multiscreen
    else if (it[I_KIND] === SERIES) {
      var b = Browse(it[I_NAME], [], 'Carregando episódios…', true);
      show(b);
      episodesOf(it[I_SID]).then(b.setData, function (e) { b.fail('Não deu para carregar: ' + (e.message || e)); });
    } else show(Player(shown, ii));
  }
  function move(n, d) { return Math.max(0, Math.min(n - 1, d)); }
  function toggleFavorite() {
    var favs = favorites(), id = key(shown[ii]);
    if (favs.has(id)) { favs.delete(id); toast('Removido dos favoritos'); } else { favs.add(id); toast('Adicionado aos favoritos'); }
    saveFavorites(favs);
    if (cur === 0) filter();
  }

  var screen = {
    render: render,
    setData: function (list) { msg = ''; setData(list); if (current() === screen) render(); },
    fail: function (m) { msg = m; if (current() === screen) render(); },
    // Mouse: a click selects and opens; right click favorites; the wheel scrolls the list under the pointer.
    click: function (d, long) {
      if (d.g !== undefined) { col = 0; gi = Number(d.g); screen.key(KEY.ENTER); return; }
      if (d.i !== undefined) { col = 1; ii = Number(d.i); screen.key(long ? KEY.LONG : KEY.ENTER); }
    },
    wheel: function (k, target) {
      var left = target.closest && target.closest('.left');
      if (left && col !== 0) { col = 0; gi = cur; }
      if (!left && col !== 1 && shown.length) col = 1;
      screen.key(k);
    },
    key: function (k) {
      var step = grid ? COLS : 1, pageSize = grid ? COLS * GRID_ROWS : ROWS;
      var page = k === KEY.CHUP ? -pageSize : k === KEY.CHDOWN ? pageSize : 0;
      if (col === 0) {
        if (k === KEY.UP || k === KEY.DOWN || page) gi = move(groups.length, gi + (page ? (page > 0 ? ROWS : -ROWS) : k === KEY.UP ? -1 : 1));
        else if (k === KEY.ENTER) { cur = gi; filter(); if (shown.length) col = 1; }
        else if (k === KEY.RIGHT && shown.length) col = 1;
      } else if (col === 1) {
        if (k === KEY.UP && ii < step) { col = 2; render(); document.getElementById('q').focus(); return; }
        if (k === KEY.UP || k === KEY.DOWN || page) ii = move(shown.length, ii + (page || (k === KEY.UP ? -step : step)));
        else if (k === KEY.LEFT) { if (grid && ii % COLS) ii--; else { col = 0; gi = cur; } }
        else if (k === KEY.RIGHT) { if (grid && ii % COLS < COLS - 1 && ii + 1 < shown.length) ii++; }
        else if (k === KEY.ENTER && shown.length) { open(); return; }
        else if (k === KEY.LONG && shown.length) toggleFavorite();
      } else { // search box
        if (k === KEY.DOWN && shown.length) col = 1;
        else if (k === KEY.LEFT) col = 0;
        else if (k === KEY.ENTER) { document.getElementById('q').focus(); return; }
      }
      render();
    },
  };
  if (items) setData(items);
  return screen;
}

function Player(list, start) {
  var idx = start, paused = false, vid = document.getElementById('vid'), stopHls = null;
  var theater = false;
  function item() { return list[idx]; }
  function live() { return item()[I_KIND] === LIVE; }
  /** Theater mode means no interface at all, so routine messages stay quiet (errors never do). */
  function say(msg, ms) { if (!theater) toast(msg, ms); }

  function stop() {
    if (AV) { try { webapis.avplay.stop(); } catch (e) {} try { webapis.avplay.close(); } catch (e) {} }
    if (stopHls) { stopHls(); stopHls = null; }
    vid.pause(); vid.removeAttribute('src'); vid.load(); vid.hidden = true;
  }
  /** The PC's built-in player can't do every format (mkv, HEVC): offer VLC instead. */
  function failed(why) {
    toast('Não foi possível tocar (' + why + ')' + (DESKTOP ? '\nPressione V para abrir no VLC.' : ''), DESKTOP ? 15000 : 6000);
  }
  function play() {
    var it = item();
    stop();
    paused = false;
    say(live() ? (idx + 1) + '. ' + it[I_NAME] : it[I_NAME]);
    if (live()) showGuide(5000);
    if (AV) {
      try {
        webapis.avplay.open(it[I_URL]);
        webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
        webapis.avplay.setListener({
          onbufferingstart: function () { say('Carregando…', 0); },
          onbufferingcomplete: hideToast,
          onstreamcompleted: function () { if (!live()) back(); },
          onerror: function (e) { toast('Não foi possível tocar (' + e + ')', 6000); },
        });
        webapis.avplay.prepareAsync(function () { webapis.avplay.play(); },
          function (e) { toast('Não foi possível tocar (' + e + ')', 6000); });
      } catch (e) { toast('Não foi possível tocar (' + (e.message || e) + ')', 6000); }
    } else { // Windows app / desktop browser
      vid.hidden = false;
      vid.muted = false;
      if (live()) stopHls = playHls(vid, it[I_URL], failed);
      else {
        vid.onerror = function () { failed(vid.error ? 'formato não suportado' : 'erro'); };
        vid.src = it[I_URL];
        vid.play().catch(function () {});
      }
    }
  }
  function showGuide(ms) {
    var it = item();
    epgNow(it).then(function (text) {
      if (item() === it) say((idx + 1) + '. ' + it[I_NAME] + (text ? '\n' + text : ''), ms);
    }, function () {});
  }
  function seek(ms) {
    if (AV) { try { ms > 0 ? webapis.avplay.jumpForward(ms) : webapis.avplay.jumpBackward(-ms); } catch (e) {} }
    else vid.currentTime += ms / 1000;
  }
  function togglePause() {
    paused = !paused;
    if (AV) paused ? webapis.avplay.pause() : webapis.avplay.play();
    else paused ? vid.pause() : vid.play();
    say(paused ? '❚❚ Pausado' : '▶ ' + item()[I_NAME]);
  }

  // ---------- on-screen controls (Windows only: a TV has no mouse, and its volume is the set's) ----------
  var ctl = null, chlist = null, hideTimer = 0, ticker = 0, listOpen = false;

  function layer(id) {
    var el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
    return el;
  }
  function clock(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(t % 60);
  }
  function played() { return vid.duration ? Math.min(100, vid.currentTime / vid.duration * 100) : 0; }
  function slider(name, filled) {
    return '<div class="' + name + '" data-c="' + name + '"><div class="fill" style="width:' + filled + '%"></div></div>';
  }
  /** Where along a slider the click landed, 0..1. */
  function at(e) {
    var box = e.target.closest('[data-c]').getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
  }

  function controls() {
    var b = [];
    // Live has no pause and no timeline; a movie has no channel to zap to.
    if (live()) b.push('<b data-c="prev">⏮</b><b data-c="list">☰ Canais</b><b data-c="next">⏭</b>');
    else b.push('<b data-c="play">' + (paused ? '▶' : '❚❚') + '</b><b data-c="rw">⏪ 10s</b><b data-c="ff">30s ⏩</b>');
    b.push('<b data-c="mute">' + (vid.muted || !vid.volume ? '🔇' : '🔊') + '</b>');
    b.push(slider('vol', Math.round((vid.muted ? 0 : vid.volume) * 100)));
    if (!live()) b.push('<div class="time">' + clock(vid.currentTime) + ' / ' + clock(vid.duration) + '</div>');
    b.push('<b data-c="theater">◼ ' + (theater ? 'Sair do teatro' : 'Teatro') + '</b>');
    b.push('<b data-c="full">⛶</b><b data-c="top">📌</b>');
    if (live()) b.push('<b data-c="multi">⊞ Multitela</b>');
    b.push('<b data-c="vlc">VLC</b>');
    b.push('<div class="now">' + esc(item()[I_NAME]) + '</div>');
    return (live() ? '' : slider('seek', played())) + '<div class="btns">' + b.join('') + '</div>';
  }

  function showCtl() {
    if (!DESKTOP) return;
    ctl = ctl || layer('ctl');
    ctl.innerHTML = controls();
    ctl.className = 'on';
    // The body says what is on screen, so the toast can step aside and the bar can stop
    // under the channel list instead of hiding its last buttons behind it.
    document.body.classList.add('bar');
    document.body.classList.remove('nocursor');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCtl, 3000);
  }
  function hideCtl() {
    if (listOpen) return; // still picking a channel
    if (ctl) ctl.className = '';
    document.body.classList.remove('bar');
    document.body.classList.add('nocursor');
  }
  /** Move the timeline without rebuilding the buttons, which would drop the hover. */
  function refresh() {
    if (!ctl || ctl.className !== 'on' || live()) return;
    var fill = ctl.querySelector('.seek .fill'), time = ctl.querySelector('.time');
    if (fill) fill.style.width = played() + '%';
    if (time) time.textContent = clock(vid.currentTime) + ' / ' + clock(vid.duration);
  }

  /** The channels of the folder this channel belongs to, so zapping stays inside it. */
  function folder() {
    var g = item()[I_GROUP], out = [];
    list.forEach(function (it, i) { if (it[I_KIND] === LIVE && it[I_GROUP] === g) out.push(i); });
    return out;
  }
  function drawList() {
    chlist = chlist || layer('chlist');
    chlist.innerHTML = '<h2>' + esc(item()[I_GROUP] || 'Canais') + '</h2>' + folder().map(function (i) {
      var it = list[i];
      return '<div class="row' + (i === idx ? ' sel' : '') + '" data-c="ch:' + i + '">' +
        (it[I_LOGO] ? '<img src="' + esc(it[I_LOGO]) + '" onerror="this.style.visibility=\'hidden\'">' : '') +
        '<span>' + esc(it[I_NAME]) + '</span></div>';
    }).join('');
    chlist.className = 'on';
    document.body.classList.add('list');
    var sel = chlist.querySelector('.row.sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
  }
  /** By id, not by the local handle: a list left open by an earlier player is still on the page. */
  function closeList() {
    listOpen = false;
    var el = document.getElementById('chlist');
    if (el) el.className = '';
    document.body.classList.remove('list');
  }
  function toggleList() {
    if (listOpen) closeList();
    else listOpen = true;
  }
  function toggleTheater() {
    theater = !theater;
    if (!theater) { showCtl(); return; }
    hideToast();
    closeList();
    hideCtl();
  }

  function act(c, e) {
    if (c.indexOf('ch:') === 0) { idx = Number(c.slice(3)); play(); }
    else if (c === 'play') togglePause();
    else if (c === 'prev') { idx = (idx - 1 + list.length) % list.length; play(); }
    else if (c === 'next') { idx = (idx + 1) % list.length; play(); }
    else if (c === 'rw') seek(-10000);
    else if (c === 'ff') seek(30000);
    else if (c === 'list') toggleList();
    else if (c === 'mute') vid.muted = !vid.muted;
    else if (c === 'vol') { vid.volume = at(e); vid.muted = false; }
    else if (c === 'seek') { if (vid.duration) vid.currentTime = at(e) * vid.duration; }
    else if (c === 'full') window.soulfork.toggleWindow('fullscreen');
    else if (c === 'top') window.soulfork.toggleWindow('top');
    else if (c === 'theater') { toggleTheater(); return; }
    else if (c === 'multi') { addToMulti(); return; }
    else if (c === 'vlc') { stop(); window.soulfork.openInVlc(item()[I_URL]); return; }
    if (listOpen) drawList();
    showCtl();
  }
  function teardown() {
    clearTimeout(hideTimer);
    clearInterval(ticker);
    ticker = 0;
    document.removeEventListener('mousemove', showCtl);
    closeList();
    if (ctl) ctl.className = '';
    document.body.classList.remove('bar');
    document.body.classList.remove('nocursor');
  }

  /** Hold OK on a live channel (Windows): send it to the multiscreen and go there. */
  function addToMulti() {
    var url = item()[I_URL], urls = multiUrls();
    if (urls.indexOf(url) < 0) {
      if (urls.length >= MULTI_MAX) { toast('O Multitela já tem ' + MULTI_MAX + ' canais. Segure OK num quadro para tirar um.'); return; }
      urls.push(url);
      saveMultiUrls(urls);
    }
    toast(item()[I_NAME] + ' no Multitela');
    teardown();
    stop();
    document.body.classList.remove('playing');
    stack.pop(); // the player
    // Back to the multiscreen if it is underneath, otherwise a new one.
    var at = -1;
    stack.forEach(function (s, i) { if (s.isMulti) at = i; });
    if (at >= 0) { stack.length = at + 1; stack[at].focus(url); stack[at].render(); }
    else show(Multi(url));
  }

  var screen = {
    clickAnywhere: true,
    // A click on a control acts on it; anywhere else it is OK, and it brings the bar back.
    click: function (d, long, e) {
      if (d.c) { act(d.c, e); return; }
      showCtl();
      screen.key(long ? KEY.LONG : KEY.ENTER);
    },
    render: function () {
      document.body.classList.add('playing');
      play();
      if (!DESKTOP) return;
      closeList(); // a previous player may have left one open over the page
      document.addEventListener('mousemove', showCtl);
      if (!ticker) ticker = setInterval(refresh, 500);
      showCtl();
    },
    // Escape backs out of the channel list and of theater mode before it leaves the player.
    back: function () {
      if (listOpen) { toggleList(); showCtl(); return; }
      if (theater) { toggleTheater(); return; }
      teardown();
      stop();
      hideToast();
      document.body.classList.remove('playing');
      back();
    },
    suspend: function () { if (AV) try { webapis.avplay.suspend(); } catch (e) {} },
    restore: function () { if (AV) try { webapis.avplay.restore(); } catch (e) {} },
    key: function (k) {
      if (DESKTOP && k === KEY.T) { act('theater'); return; }
      if (DESKTOP && k === KEY.C && live()) { act('list'); return; }
      if (live()) {
        if (k === KEY.UP || k === KEY.CHUP) { idx = (idx - 1 + list.length) % list.length; play(); }
        else if (k === KEY.DOWN || k === KEY.CHDOWN) { idx = (idx + 1) % list.length; play(); }
        else if (k === KEY.ENTER) { say((idx + 1) + '. ' + item()[I_NAME]); showGuide(6000); }
        else if (k === KEY.LONG && DESKTOP) addToMulti();
        else if (k === KEY.V && DESKTOP) window.soulfork.openInVlc(item()[I_URL]);
        if (listOpen) drawList(); // zapping with the keyboard keeps the open list in sync
        return;
      }
      if (k === KEY.V && DESKTOP) { stop(); window.soulfork.openInVlc(item()[I_URL]); return; }
      if (k === KEY.ENTER || k === KEY.PLAYPAUSE || k === KEY.PLAY || k === KEY.PAUSE) togglePause();
      else if (k === KEY.RIGHT || k === KEY.FF) seek(30000);
      else if (k === KEY.LEFT || k === KEY.RW) seek(-10000);
      else if (k === KEY.STOP) screen.back();
    },
  };
  return screen;
}

document.addEventListener('visibilitychange', function () {
  var s = current();
  if (s && s.suspend) document.hidden ? s.suspend() : s.restore();
});

reset(Login(true, false));
