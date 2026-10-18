package br.com.soulfork.tv

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

const val USER_AGENT = "Mozilla/5.0 (Linux; Android) SoulForkTV/1.0"

enum class Kind { LIVE, MOVIE, SERIES, EPISODE }

data class Item(
    val name: String,
    val logo: String?,
    val group: String,
    val url: String,
    val kind: Kind,
    val seriesId: String? = null,
    // Only filled by the Xtream API:
    val genre: String = "",
    val year: Int = 0,
    val rating: String = "",
    val plot: String = "",
)

/** TMDB's English TV genres -> the names the list already uses for movies. */
private val GENRE_PT = mapOf(
    "Action & Adventure" to listOf("Ação", "Aventura"), "Sci-Fi & Fantasy" to listOf("Ficção científica", "Fantasia"),
    "War & Politics" to listOf("Guerra", "Política"), "Soap" to listOf("Novela"), "Kids" to listOf("Infantil"),
    "News" to listOf("Notícias"), "Talk" to listOf("Talk show"), "Reality" to listOf("Reality show"), "Comedia" to listOf("Comédia"),
)

fun genresOf(i: Item): List<String> =
    i.genre.split(Regex("""\s*[,/]\s*""")).filter { it.isNotEmpty() }.flatMap { GENRE_PT[it] ?: listOf(it) }.distinct()

private val THIS_YEAR = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)

/** Last plausible year in a title: "Blade Runner 2049 (2017)" -> 2017. */
fun yearOf(name: String): Int =
    Regex("""\b(19|20)\d{2}\b""").findAll(name).map { it.value.toInt() }.lastOrNull { it <= THIS_YEAR + 1 } ?: 0

/** Everything loaded from the playlist, kept in memory while the app runs. */
object Repo {
    var live = emptyList<Item>()
    var movies = emptyList<Item>()
    var series = emptyList<Item>()
    var xtream: Xtream? = null
    @Volatile var loaded = false

    /** List the player walks through with channel up/down. */
    var playlist = emptyList<Item>()

    fun list(kind: Kind) = when (kind) {
        Kind.LIVE -> live
        Kind.MOVIE -> movies
        else -> series
    }

    private const val MAX_AGE_MS = 24 * 60 * 60 * 1000L

    // New name whenever the saved format changes, so old copies are downloaded again.
    fun cacheFile(ctx: Context) = java.io.File(ctx.filesDir, "items-v2.tsv")

    /**
     * Blocking: call off the main thread. Uses the copy saved on the device when there is one
     * (big lists take minutes to download) and refreshes it in the background once a day.
     */
    fun load(ctx: Context, refresh: Boolean) {
        val p = Prefs(ctx)
        xtream = xtreamCreds(p)?.let { (base, user, pass) -> Xtream(base, user, pass) }
        val cache = cacheFile(ctx)
        val all = if (!refresh && cache.exists()) {
            if (System.currentTimeMillis() - cache.lastModified() > MAX_AGE_MS) {
                thread(isDaemon = true) { runCatching { save(cache, fetch(p)) } } // shows up on next launch
            }
            cache.bufferedReader().use(::readItems)
        } else {
            fetch(p).also { save(cache, it) }
        }
        apply(all)
    }

    // get.php links carry Xtream credentials: the API is faster than the M3U and brings genre, year and plot.
    private fun fetch(p: Prefs): List<Item> =
        xtreamCreds(p)?.let { (base, user, pass) -> Xtream(base, user, pass).loadAll() }
            ?: httpGet(p.m3uUrl).use(::parseM3u)

    private fun save(file: java.io.File, items: List<Item>) {
        val tmp = java.io.File(file.path + ".tmp")
        tmp.bufferedWriter().use { writeItems(items, it) }
        tmp.renameTo(file)
    }

    private fun apply(all: List<Item>) {
        live = all.filter { it.kind == Kind.LIVE }
        movies = all.filter { it.kind == Kind.MOVIE }
        // M3U lists series as loose episodes; fold them into one entry per show, like Xtream does.
        m3uEpisodes = groupEpisodes(all.filter { it.kind == Kind.EPISODE })
        // The show keeps the list's category ("Séries | Netflix"); its episodes were regrouped by season.
        val category = HashMap<String, String>()
        for (e in all) if (e.kind == Kind.EPISODE) category.getOrPut(showOf(e.name)) { e.group }
        series = all.filter { it.kind == Kind.SERIES } + m3uEpisodes.map { (show, eps) ->
            Item(show, eps[0].logo, category[show] ?: eps[0].group, "", Kind.SERIES, "m3u:$show")
        }
        loaded = true
    }

    var m3uEpisodes = emptyMap<String, List<Item>>()

    /** Episodes of a series, either from the M3U grouping or fetched from Xtream. Blocking. */
    fun episodes(seriesId: String) =
        if (seriesId.startsWith("m3u:")) m3uEpisodes[seriesId.removePrefix("m3u:")].orEmpty()
        else xtream!!.episodes(seriesId)
}

private val firstNumber = Regex("""(\d+)""")
private val lastEpisode = Regex("""[Ee](\d+)(?!.*[Ee]\d)""")

/** Season, then episode number ("Temporada 2" + "... S02 E05" / "T2 E5 · ..."). */
val byEpisode: Comparator<Item> = compareBy<Item>(
    { firstNumber.find(it.group)?.value?.toIntOrNull() ?: 0 },
    { lastEpisode.find(it.name)?.groupValues?.get(1)?.toIntOrNull() ?: 0 },
)

/** Xtream credentials: from the login, or from an M3U link of the get.php?username=&password= kind. */
fun xtreamCreds(p: Prefs): Triple<String, String, String>? {
    if (p.mode == "xtream") {
        val base = p.server.trimEnd('/').let { if ("://" in it) it else "http://$it" }
        return Triple(base, p.user, p.pass)
    }
    val m = Regex("""^(https?://[^/]+)/get\.php\?(.*)$""", RegexOption.IGNORE_CASE).find(p.m3uUrl.trim()) ?: return null
    val q = m.groupValues[2].split('&').associate {
        it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
    }
    val user = q["username"] ?: return null
    val pass = q["password"] ?: return null
    return Triple(m.groupValues[1], user, pass)
}

fun b64(s: String) = runCatching { String(android.util.Base64.decode(s, android.util.Base64.DEFAULT)) }.getOrDefault(s)

private val epgCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, String>>()

/** "Agora: X (23:30–01:15)\nA seguir: Y", or "" when there is no guide. Blocking. */
fun epgNow(p: Prefs, item: Item): String {
    val (base, user, pass) = xtreamCreds(p) ?: return ""
    val id = Regex("""/(\d+)(\.\w+)?$""").find(item.url)?.groupValues?.get(1) ?: return ""
    epgCache[id]?.let { (at, text) -> if (System.currentTimeMillis() - at < 5 * 60_000) return text }
    val raw = httpGet("$base/player_api.php?username=${URLEncoder.encode(user, "UTF-8")}" +
        "&password=${URLEncoder.encode(pass, "UTF-8")}&action=get_short_epg&stream_id=$id&limit=2").use { it.readText() }.trim()
    // Some panels base64 the whole answer.
    val json = JSONObject(if (raw.startsWith("\"")) b64(raw.trim('"')) else raw)
    val list = json.optJSONArray("epg_listings") ?: return ""
    val text = (0 until list.length()).joinToString("\n") { i ->
        val e = list.getJSONObject(i)
        (if (i == 0) "Agora: " else "A seguir: ") + b64(e.optString("title")) +
            " (${e.optString("start").drop(11).take(5)}–${e.optString("end").drop(11).take(5)})"
    }
    epgCache[id] = System.currentTimeMillis() to text
    return text
}

private val episodeRe =Regex("""^(.*?)[\s._-]*[Ss](\d{1,2})\s*[Ee]\d{1,3}""")

/** "The Office S02 E05" -> show "The Office", episode grouped under "Temporada 2". */
fun showOf(name: String) = episodeRe.find(name)?.groupValues?.get(1)?.trim()?.ifEmpty { null } ?: name

fun groupEpisodes(eps: List<Item>): Map<String, List<Item>> = eps.groupBy { showOf(it.name) }.mapValues { (_, list) ->
    list.map { e -> episodeRe.find(e.name)?.let { e.copy(group = "Temporada ${it.groupValues[2].toInt()}") } ?: e }
}

class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("soulfork", Context.MODE_PRIVATE)
    var mode by str("mode")
    var m3uUrl by str("m3u")
    var server by str("server")
    var user by str("user")
    var pass by str("pass")
    /** Multiscreen channel URLs, one per line. */
    var multi by str("multi")

    val hasLogin get() = if (mode == "xtream") server.isNotEmpty() && user.isNotEmpty() else m3uUrl.isNotEmpty()

    var favorites: Set<String>
        get() = sp.getStringSet("fav", emptySet())!!
        set(v) = sp.edit().putStringSet("fav", v).apply()

    fun clearLogin() = sp.edit().remove("m3u").remove("server").remove("user").remove("pass").apply()

    private fun str(key: String) = object : kotlin.properties.ReadWriteProperty<Any, String> {
        override fun getValue(thisRef: Any, property: kotlin.reflect.KProperty<*>) = sp.getString(key, "")!!
        override fun setValue(thisRef: Any, property: kotlin.reflect.KProperty<*>, value: String) =
            sp.edit().putString(key, value.trim()).apply()
    }
}

/** GET following redirects, including http <-> https (HttpURLConnection won't do that alone). */
fun httpGet(url: String): BufferedReader {
    var u = url.trim()
    repeat(5) {
        val c = URL(u).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", USER_AGENT)
        c.connectTimeout = 15_000
        c.readTimeout = 60_000
        c.instanceFollowRedirects = false
        val code = c.responseCode
        if (code in 300..399) {
            u = URL(URL(u), c.getHeaderField("Location")).toString()
            c.disconnect()
            return@repeat
        }
        if (code != 200) throw Exception("O servidor respondeu $code")
        return c.inputStream.bufferedReader()
    }
    throw Exception("Redirecionamentos demais")
}

/** One item per line, tab-separated: kind, name, logo, group, url, seriesId, genre, year, rating, plot. */
fun writeItems(items: List<Item>, w: java.io.Writer) {
    fun clean(s: String?) = s.orEmpty().replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')
    for (i in items) {
        w.write("${i.kind.ordinal}\t${clean(i.name)}\t${clean(i.logo)}\t${clean(i.group)}\t${clean(i.url)}\t${clean(i.seriesId)}" +
            "\t${clean(i.genre)}\t${i.year}\t${clean(i.rating)}\t${clean(i.plot)}\n")
    }
}

fun readItems(r: BufferedReader): List<Item> {
    val kinds = Kind.values()
    val out = ArrayList<Item>()
    r.forEachLine { line ->
        val f = line.split('\t')
        if (f.size == 10) out += Item(f[1], f[2].ifEmpty { null }, f[3], f[4], kinds[f[0].toInt()], f[5].ifEmpty { null },
            f[6], f[7].toIntOrNull() ?: 0, f[8], f[9])
    }
    return out
}

/** attr="value" from an #EXTINF header; plain indexOf is much faster than a regex on 300k lines. */
private fun attr(head: String, key: String): String? {
    val i = head.indexOf("$key=\"", ignoreCase = true)
    if (i < 0) return null
    val start = i + key.length + 2
    val end = head.indexOf('"', start)
    return if (end < 0) null else head.substring(start, end).ifEmpty { null }
}

fun kindOf(url: String) = when {
    "/movie/" in url -> Kind.MOVIE
    "/series/" in url -> Kind.EPISODE
    else -> Kind.LIVE
}

/** Parses #EXTINF lines; the title is whatever follows the first comma outside quotes. */
fun parseM3u(reader: BufferedReader): List<Item> {
    val out = ArrayList<Item>()
    var name = ""
    var head = ""
    reader.forEachLine { raw ->
        val line = raw.trim()
        when {
            line.startsWith("#EXTINF", ignoreCase = true) -> {
                var inQuote = false
                var comma = -1
                for (i in line.indices) {
                    if (line[i] == '"') inQuote = !inQuote
                    else if (line[i] == ',' && !inQuote) { comma = i; break }
                }
                head = if (comma >= 0) line.substring(0, comma) else line
                name = if (comma >= 0) line.substring(comma + 1).trim() else ""
            }
            line.isNotEmpty() && !line.startsWith("#") -> {
                out += Item(
                    name = name.ifEmpty { attr(head, "tvg-name") ?: line.substringAfterLast('/') },
                    logo = attr(head, "tvg-logo"),
                    group = attr(head, "group-title") ?: "Sem categoria",
                    url = line,
                    kind = kindOf(line),
                )
                name = ""
                head = ""
            }
        }
    }
    return out
}

/** First LAN IPv4 of this device, so the phone knows where to reach the form. */
fun localIp(): String? = java.net.NetworkInterface.getNetworkInterfaces().asSequence()
    .filter { it.isUp && !it.isLoopback }
    .flatMap { it.inetAddresses.asSequence() }
    .firstOrNull { it is java.net.Inet4Address && it.isSiteLocalAddress }?.hostAddress

/**
 * Tiny HTTP server so the playlist link can be pasted on a phone instead of typed with the remote.
 * GET serves the form, POST hands the fields to [onSubmit].
 */
class PhoneForm(private val onSubmit: (Map<String, String>) -> Unit) {
    val port = 8686
    private val server = java.net.ServerSocket(port)

    fun start() = thread(isDaemon = true) {
        while (!server.isClosed) {
            val s = runCatching { server.accept() }.getOrNull() ?: break
            thread(isDaemon = true) { runCatching { handle(s) } }
        }
    }

    fun stop() = server.close()

    private fun handle(s: java.net.Socket): Unit = s.use {
        val r = s.getInputStream().bufferedReader()
        val request = r.readLine() ?: return
        var length = 0
        while (true) {
            val h = r.readLine() ?: break
            if (h.isEmpty()) break
            if (h.startsWith("Content-Length:", true)) length = h.substringAfter(':').trim().toInt()
        }
        var page = FORM
        if (request.startsWith("POST") && length in 1..100_000) {
            // Form bodies are percent-encoded ASCII, so chars == bytes.
            val buf = CharArray(length)
            var n = 0
            while (n < length) { val k = r.read(buf, n, length - n); if (k < 0) break; n += k }
            val fields = String(buf, 0, n).split('&').filter { '=' in it }.associate {
                java.net.URLDecoder.decode(it.substringBefore('='), "UTF-8") to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8")
            }
            onSubmit(fields)
            page = DONE
        }
        val body = page.toByteArray()
        s.getOutputStream().apply {
            write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(body)
            flush()
        }
    }

    private companion object {
        const val STYLE = """<meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:sans-serif;background:#0B0F1F;color:#fff;margin:0;padding:24px;max-width:520px}
h1{color:#5EE6E6}h2{margin-top:28px}input,button{width:100%;box-sizing:border-box;padding:14px;margin:6px 0;
border-radius:10px;border:0;font-size:16px}input{background:#1A2140;color:#fff}
button{background:linear-gradient(90deg,#5EE6E6,#5B2FC9);color:#fff;font-weight:bold}</style>"""
        const val FORM = """<!doctype html><html><head>$STYLE<title>SoulFork TV</title></head><body>
<h1>SoulFork TV</h1><p>Cole aqui e toque em Enviar. A TV carrega sozinha.</p>
<h2>Link M3U</h2><form method="post"><input type="hidden" name="mode" value="m3u">
<input name="m3u" type="url" placeholder="http://servidor/lista.m3u8" required><button>Enviar para a TV</button></form>
<h2>Xtream Codes</h2><form method="post"><input type="hidden" name="mode" value="xtream">
<input name="server" placeholder="http://servidor:porta" required><input name="user" placeholder="Usuário" required>
<input name="pass" placeholder="Senha" required><button>Enviar para a TV</button></form></body></html>"""
        const val DONE = """<!doctype html><html><head>$STYLE</head><body><h1>Enviado!</h1>
<p>Olhe a TV: a lista está carregando.</p><p><a style="color:#5EE6E6" href="/">Enviar outro</a></p></body></html>"""
    }
}

/** Xtream Codes player_api.php client. */
class Xtream(server: String, private val user: String, private val pass: String) {
    private val base = server.trim().trimEnd('/').let { if ("://" in it) it else "http://$it" }

    private fun api(action: String = "", extra: String = ""): String {
        val q = "username=${enc(user)}&password=${enc(pass)}" + (if (action.isEmpty()) "" else "&action=$action") + extra
        val raw = httpGet("$base/player_api.php?$q").use { it.readText() }.trim()
        return if (raw.startsWith("\"")) b64(raw.trim('"')) else raw // some panels base64 the whole answer
    }

    private val vodCache = java.util.concurrent.ConcurrentHashMap<String, JSONObject>()

    /** Plot/genre/date/rating of one movie, for the details panel. Blocking. */
    fun vodInfo(item: Item): JSONObject? {
        val id = Regex("""/(\d+)\.\w+$""").find(item.url)?.groupValues?.get(1) ?: return null
        return vodCache.getOrPut(id) { JSONObject(api("get_vod_info", "&vod_id=$id")).optJSONObject("info") ?: JSONObject() }
    }

    private fun categories(action: String): Map<String, String> {
        val arr = JSONArray(api(action))
        return (0 until arr.length()).associate { arr.getJSONObject(it).let { c -> c.optString("category_id") to c.optString("category_name") } }
    }

    private fun streams(action: String, cats: Map<String, String>, make: (JSONObject, String) -> Item): List<Item> {
        val arr = JSONArray(api(action))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            make(o, cats[o.optString("category_id")] ?: "Sem categoria")
        }
    }

    fun loadAll(): List<Item> {
        val auth = JSONObject(api()).optJSONObject("user_info")
        if (auth?.optString("auth") != "1") throw Exception("Usuário ou senha inválidos")
        val live = streams("get_live_streams", categories("get_live_categories")) { o, g ->
            Item(o.optString("name"), o.optString("stream_icon").ifEmpty { null }, g,
                "$base/live/$user/$pass/${o.optString("stream_id")}.ts", Kind.LIVE)
        }
        val vod = streams("get_vod_streams", categories("get_vod_categories")) { o, g ->
            Item(o.optString("name"), o.optString("stream_icon").ifEmpty { null }, g,
                "$base/movie/$user/$pass/${o.optString("stream_id")}.${o.optString("container_extension", "mp4")}", Kind.MOVIE,
                year = yearOf(o.optString("name")), rating = o.optString("rating"))
        }
        val series = streams("get_series", categories("get_series_categories")) { o, g ->
            Item(o.optString("name"), o.optString("cover").ifEmpty { null }, g, "", Kind.SERIES, o.optString("series_id"),
                genre = o.optString("genre"), year = o.optString("releaseDate").take(4).toIntOrNull() ?: yearOf(o.optString("name")),
                rating = o.optString("rating"), plot = o.optString("plot"))
        }
        return live + vod + series
    }

    fun episodes(seriesId: String): List<Item> {
        // "episodes" is an object keyed by season, or an empty array when there are none.
        val eps = JSONObject(api("get_series_info", "&series_id=$seriesId")).opt("episodes") as? JSONObject ?: return emptyList()
        val out = ArrayList<Item>()
        for (season in eps.keys().asSequence().sortedBy { it.toIntOrNull() ?: 0 }) {
            val arr = eps.getJSONArray(season)
            for (i in 0 until arr.length()) {
                val e = arr.getJSONObject(i)
                out += Item(
                    // Titles often repeat the show: "Pinky e o Cérebro - S01E01 - Ratos" -> "Ratos".
                    "E${e.optString("episode_num")}" + e.optString("title")
                        .replace(Regex("""^.*?S\d+\s*E\d+\s*[-–:]?\s*""", RegexOption.IGNORE_CASE), "")
                        .let { if (it.isEmpty()) "" else " · $it" },
                    e.optJSONObject("info")?.optString("movie_image")?.ifEmpty { null },
                    "Temporada $season",
                    "$base/series/$user/$pass/${e.optString("id")}.${e.optString("container_extension", "mp4")}",
                    Kind.EPISODE,
                )
            }
        }
        return out
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}
