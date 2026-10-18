'use strict';
// SoulFork TV for Samsung Tizen. Written for the Chromium 56 engine of 2018 TVs:
// no optional chaining, no ??, no object spread, no flex gap.

var AV = typeof webapis !== 'undefined' && webapis.avplay;
var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8,
  CHUP: 427, CHDOWN: 428, PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, FF: 417, RW: 412, STOP: 413,
  IME_DONE: 65376, IME_CANCEL: 65385, LONG: 'long' };
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
var I_KIND = 0, I_NAME = 1, I_LOGO = 2, I_GROUP = 3, I_URL = 4, I_SID = 5;

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
  return r.json();
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
  return getJson(xtreamBase() + '/player_api.php?username=' + encodeURIComponent(prefs.get('user')) +
    '&password=' + encodeURIComponent(prefs.get('pass')) + (action ? '&action=' + action : '') + (extra || ''));
}

async function fetchXtream(onProgress) {
  var b = xtreamBase(), u = prefs.get('user'), p = prefs.get('pass');
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
      b + '/movie/' + u + '/' + p + '/' + o.stream_id + '.' + (o.container_extension || 'mp4'), ''];
  });
  await section('get_series_categories', 'get_series', function (o, g) {
    return [SERIES, o.name, o.cover || '', g, '', String(o.series_id)];
  });
  return out;
}

async function xtreamEpisodes(sid) {
  var b = xtreamBase(), u = prefs.get('user'), p = prefs.get('pass');
  var info = await xtreamApi('get_series_info', '&series_id=' + sid);
  var eps = info.episodes, out = [];
  if (!eps || Array.isArray(eps)) return out; // empty series come back as []
  Object.keys(eps).sort(function (a, c) { return a - c; }).forEach(function (season) {
    eps[season].forEach(function (e) {
      out.push([EPISODE, 'T' + season + ' E' + e.episode_num + ' · ' + (e.title || ''),
        (e.info && e.info.movie_image) || '', 'Temporada ' + season,
        b + '/series/' + u + '/' + p + '/' + e.id + '.' + (e.container_extension || 'mp4'), '']);
    });
  });
  return out;
}

async function fetchAll(onProgress) {
  if (prefs.get('mode') === 'xtream') return fetchXtream(onProgress);
  var out = [];
  await fetchLines(prefs.get('m3u').trim(), m3uParser(out), function () { if (onProgress) onProgress(out.length); });
  return out;
}

// ---------- cache (IndexedDB, in chunks) ----------
var CHUNK = 5000;
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
  var cachedAt = Number(prefs.get('cachedAt'));
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

function b64utf8(s) { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s; } }

var epgCache = new Map();
/** "Agora: X (23:30–01:15)\nA seguir: Y", or '' when the server has no guide for the channel. */
async function epgNow(it) {
  var c = xtreamCreds(), id = /\/(\d+)(\.\w+)?$/.exec(it[I_URL]);
  if (!c || !id) return '';
  var hit = epgCache.get(id[1]);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.text;
  var d = await getJson(c.base + '/player_api.php?username=' + encodeURIComponent(c.user) + '&password=' +
    encodeURIComponent(c.pass) + '&action=get_short_epg&stream_id=' + id[1] + '&limit=2');
  if (typeof d === 'string') d = JSON.parse(b64utf8(d)); // some panels base64 the whole answer
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
      '<div class="hint">Para colar o link: use o teclado do app SmartThings no celular.</div>' +
      '<div class="status">' + esc(status) + '</div></div>';
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
  var idx = 0;
  var cards = [['TV ao Vivo', repo.live.length + ' canais', LIVE], ['Filmes', repo.movies.length + ' títulos', MOVIE],
    ['Séries', repo.series.length + ' títulos', SERIES]];
  function render() {
    app.innerHTML = '<div class="home"><div class="brand"><img src="logo.png"><h1>SoulFork TV</h1></div><div class="cards">' +
      cards.map(function (c, i) { return '<div class="tile" id="h' + i + '">' + c[0] + '<small>' + c[1] + '</small></div>'; }).join('') +
      '</div><div class="actions"><div class="tile" id="h3">Atualizar lista</div><div class="tile" id="h4">Trocar lista</div></div></div>';
    document.getElementById('h' + idx).classList.add('focus');
  }
  return {
    render: render,
    key: function (k) {
      if (k === KEY.ENTER) {
        if (idx < 3) {
          var c = cards[idx];
          show(Browse(c[0], c[2] === LIVE ? repo.live : c[2] === MOVIE ? repo.movies : repo.series));
        } else if (idx === 3) reset(Login(true, true));
        else {
          ['m3u', 'server', 'user', 'pass'].forEach(prefs.del);
          clearCache().catch(function () {});
          reset(Login(false));
        }
        return;
      }
      if (k === KEY.DOWN && idx < 3) idx = 3;
      else if (k === KEY.UP && idx >= 3) idx = 0;
      else if (k === KEY.LEFT) idx = idx === 3 ? 3 : Math.max(idx === 4 ? 3 : 0, idx - 1);
      else if (k === KEY.RIGHT) idx = idx < 2 ? idx + 1 : idx === 3 ? 4 : idx;
      render();
    },
  };
}

var ROWS = 9; // visible rows per list

/** Categories on the left, items on the right; used for live, movies, series and one series' episodes. */
function Browse(title, items, loading, episodes) {
  var all = items || [], groups = [], shown = [], cur = 1, col = 0, gi = 1, ii = 0, q = '', msg = loading || '';
  var epgTimer = 0;

  function key(it) { return it[I_SID] ? 'series:' + it[I_SID] : it[I_URL]; }
  function setData(list) {
    var seen = new Set();
    if (episodes) {
      // A series: only its seasons on the left, opening on the first one, episodes in order.
      all = list.slice().sort(byEpisode);
      groups = [];
      cur = gi = 0;
      col = 1;
    } else {
      all = list;
      groups = ['★ Favoritos', 'Todos'];
      var favs = favorites();
      cur = gi = all.some(function (it) { return favs.has(key(it)); }) ? 0 : 1;
    }
    all.forEach(function (it) { if (!seen.has(it[I_GROUP])) { seen.add(it[I_GROUP]); groups.push(it[I_GROUP]); } });
    filter();
  }
  function filter() {
    var favs = favorites(), needle = q.toLowerCase(), g = groups[cur];
    shown = all.filter(function (it) {
      if (episodes) { if (it[I_GROUP] !== g) return false; }
      else if (cur === 0 && !favs.has(key(it))) return false;
      else if (cur > 1 && it[I_GROUP] !== g) return false;
      return !needle || it[I_NAME].toLowerCase().indexOf(needle) >= 0;
    });
    ii = 0;
  }
  function rows(list, sel, focused, label, logo) {
    var start = Math.max(0, Math.min(sel - 4, list.length - ROWS));
    return list.slice(start, start + ROWS).map(function (x, i) {
      var n = start + i, img = logo ? logo(x) : '';
      return '<div class="row' + (n === sel ? (focused ? ' focus' : ' sel') : '') + '">' +
        (img ? '<img src="' + esc(img) + '" onerror="this.style.visibility=\'hidden\'">' : '') +
        '<span>' + esc(label(x)) + '</span></div>';
    }).join('');
  }
  function render() {
    var empty = msg || (shown.length ? '' : cur === 0 && !episodes ? 'Sem favoritos ainda. Segure OK num item para favoritar.' : 'Nada aqui.');
    var liveList = shown.length && shown[ii][I_KIND] === LIVE;
    app.innerHTML = '<div class="browse"><div class="left"><h2>' + esc(title) + '</h2><div class="list">' +
      rows(groups, col === 0 ? gi : cur, col === 0, function (g) { return g; }) + '</div></div>' +
      '<div class="right"><div class="search' + (col === 2 ? ' focus' : '') + '"><input id="q" placeholder="Buscar…" value="' + esc(q) + '"></div>' +
      (empty ? '<div class="empty">' + esc(empty) + '</div>'
        : '<div class="list">' + rows(shown, ii, col === 1, function (it) { return it[I_NAME]; },
          function (it) { return it[I_LOGO]; }) + '</div><div class="count">' + (ii + 1) + ' de ' + shown.length + '</div>' +
          (liveList ? '<div class="epg" id="epg"></div>' : '')) +
      '</div></div>';
    if (liveList) showEpg();
    var qi = document.getElementById('q'), timer = 0;
    qi.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { q = qi.value; filter(); }, 400);
    });
    qi.addEventListener('blur', function () { q = qi.value; filter(); col = shown.length ? 1 : 2; render(); });
  }
  /** Guide for the highlighted channel, fetched only once the remote stops moving. */
  function showEpg() {
    var it = shown[ii];
    clearTimeout(epgTimer);
    epgTimer = setTimeout(function () {
      epgNow(it).then(function (text) {
        var el = document.getElementById('epg');
        if (el && shown[ii] === it) el.textContent = text;
      }, function () {});
    }, 500);
  }
  function open() {
    var it = shown[ii];
    if (it[I_KIND] === SERIES) {
      var b = Browse(it[I_NAME], [], 'Carregando episódios…', true);
      show(b);
      episodesOf(it[I_SID]).then(b.setData, function (e) { b.fail('Não deu para carregar: ' + (e.message || e)); });
    } else show(Player(shown, ii));
  }
  function move(n, d) { return Math.max(0, Math.min(n - 1, d)); }

  var screen = {
    render: render,
    setData: function (list) { msg = ''; setData(list); if (current() === screen) render(); },
    fail: function (m) { msg = m; if (current() === screen) render(); },
    key: function (k) {
      var page = k === KEY.CHUP ? -ROWS : k === KEY.CHDOWN ? ROWS : 0;
      if (col === 0) {
        if (k === KEY.UP || k === KEY.DOWN || page) gi = move(groups.length, gi + (page || (k === KEY.UP ? -1 : 1)));
        else if (k === KEY.ENTER) { cur = gi; filter(); if (shown.length) col = 1; }
        else if (k === KEY.RIGHT && shown.length) col = 1;
      } else if (col === 1) {
        if (k === KEY.UP && ii === 0) { col = 2; render(); document.getElementById('q').focus(); return; }
        if (k === KEY.UP || k === KEY.DOWN || page) ii = move(shown.length, ii + (page || (k === KEY.UP ? -1 : 1)));
        else if (k === KEY.LEFT) { col = 0; gi = cur; }
        else if (k === KEY.ENTER && shown.length) { open(); return; }
        else if (k === KEY.LONG && shown.length) {
          var favs = favorites(), id = key(shown[ii]);
          if (favs.has(id)) { favs.delete(id); toast('Removido dos favoritos'); } else { favs.add(id); toast('Adicionado aos favoritos'); }
          saveFavorites(favs);
          if (cur === 0) filter();
        }
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
  var idx = start, paused = false, vid = document.getElementById('vid');
  function item() { return list[idx]; }
  function live() { return item()[I_KIND] === LIVE; }

  function stop() {
    if (AV) { try { webapis.avplay.stop(); } catch (e) {} try { webapis.avplay.close(); } catch (e) {} }
    vid.pause(); vid.removeAttribute('src'); vid.load(); vid.hidden = true;
  }
  function play() {
    var it = item();
    stop();
    paused = false;
    toast(live() ? (idx + 1) + '. ' + it[I_NAME] : it[I_NAME]);
    if (live()) showGuide(5000);
    if (AV) {
      try {
        webapis.avplay.open(it[I_URL]);
        webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
        webapis.avplay.setListener({
          onbufferingstart: function () { toast('Carregando…', 0); },
          onbufferingcomplete: hideToast,
          onstreamcompleted: function () { if (!live()) back(); },
          onerror: function (e) { toast('Não foi possível tocar (' + e + ')', 6000); },
        });
        webapis.avplay.prepareAsync(function () { webapis.avplay.play(); },
          function (e) { toast('Não foi possível tocar (' + e + ')', 6000); });
      } catch (e) { toast('Não foi possível tocar (' + (e.message || e) + ')', 6000); }
    } else { // desktop browser, for development
      vid.hidden = false;
      vid.src = it[I_URL];
      vid.play().catch(function (e) { toast('Não foi possível tocar (' + e.message + ')', 6000); });
    }
  }
  function showGuide(ms) {
    var it = item();
    epgNow(it).then(function (text) {
      if (item() === it) toast((idx + 1) + '. ' + it[I_NAME] + (text ? '\n' + text : ''), ms);
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
    toast(paused ? '❚❚ Pausado' : '▶ ' + item()[I_NAME]);
  }

  var screen = {
    render: function () { document.body.classList.add('playing'); play(); },
    back: function () { stop(); hideToast(); document.body.classList.remove('playing'); back(); },
    suspend: function () { if (AV) try { webapis.avplay.suspend(); } catch (e) {} },
    restore: function () { if (AV) try { webapis.avplay.restore(); } catch (e) {} },
    key: function (k) {
      if (live()) {
        if (k === KEY.UP || k === KEY.CHUP) { idx = (idx - 1 + list.length) % list.length; play(); }
        else if (k === KEY.DOWN || k === KEY.CHDOWN) { idx = (idx + 1) % list.length; play(); }
        else if (k === KEY.ENTER) { toast((idx + 1) + '. ' + item()[I_NAME]); showGuide(6000); }
        return;
      }
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
