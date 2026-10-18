package br.com.soulfork.tv

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.load
import kotlin.concurrent.thread

/** Android may kill the process while the app is in the background; reload through the login screen. */
private fun Activity.restartIfEmpty(): Boolean {
    if (Repo.loaded) return false
    startActivity(Intent(this, LoginActivity::class.java))
    finish()
    return true
}

private fun Activity.toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

class LoginActivity : Activity() {
    private lateinit var prefs: Prefs
    private var mode = "m3u"

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setContentView(R.layout.activity_login)
        prefs = Prefs(this)
        val m3u = findViewById<EditText>(R.id.m3u)
        val server = findViewById<EditText>(R.id.server)
        val user = findViewById<EditText>(R.id.user)
        val pass = findViewById<EditText>(R.id.pass)
        m3u.setText(prefs.m3uUrl)
        server.setText(prefs.server)
        user.setText(prefs.user)
        pass.setText(prefs.pass)

        findViewById<Button>(R.id.tabM3u).setOnClickListener { setMode("m3u") }
        findViewById<Button>(R.id.tabXtream).setOnClickListener { setMode("xtream") }
        setMode(prefs.mode.ifEmpty { "m3u" })

        val submit = {
            prefs.mode = mode
            prefs.m3uUrl = m3u.text.toString()
            prefs.server = server.text.toString()
            prefs.user = user.text.toString()
            prefs.pass = pass.text.toString()
            if (prefs.hasLogin) load(refresh = true) else status("Preencha os campos.")
        }
        findViewById<Button>(R.id.enter).setOnClickListener { submit() }

        // Typing a long link with the remote is painful: accept it from a phone on the same Wi-Fi.
        phoneForm = runCatching {
            PhoneForm { f ->
                runOnUiThread {
                    setMode(if (f["mode"] == "xtream") "xtream" else "m3u")
                    f["m3u"]?.let { m3u.setText(it) }
                    f["server"]?.let { server.setText(it) }
                    f["user"]?.let { user.setText(it) }
                    f["pass"]?.let { pass.setText(it) }
                    submit()
                }
            }.apply { start() }
        }.getOrNull()
        val ip = localIp()
        if (phoneForm != null && ip != null) {
            findViewById<TextView>(R.id.phone).text = "Mais fácil pelo celular (mesmo Wi-Fi): abra  http://$ip:${phoneForm!!.port}  e cole o link lá."
        }

        if (prefs.hasLogin) load(intent.getBooleanExtra("refresh", false)) else findViewById<View>(R.id.tabM3u).requestFocus()
    }

    private var phoneForm: PhoneForm? = null

    override fun onDestroy() {
        super.onDestroy()
        phoneForm?.stop()
    }

    private fun setMode(m: String) {
        mode = m
        val xt = m == "xtream"
        findViewById<View>(R.id.m3u).visibility = if (xt) View.GONE else View.VISIBLE
        for (id in listOf(R.id.server, R.id.user, R.id.pass)) findViewById<View>(id).visibility = if (xt) View.VISIBLE else View.GONE
        findViewById<View>(R.id.tabM3u).isSelected = !xt
        findViewById<View>(R.id.tabXtream).isSelected = xt
    }

    private fun status(s: String) { findViewById<TextView>(R.id.status).text = s }

    private fun load(refresh: Boolean) {
        val enter = findViewById<Button>(R.id.enter)
        enter.isEnabled = false
        status(if (refresh || !Repo.cacheFile(this).exists()) "Baixando sua lista… listas grandes podem levar alguns minutos, só na primeira vez." else "Abrindo sua lista…")
        thread {
            val r = runCatching { Repo.load(this, refresh) }
            runOnUiThread {
                enter.isEnabled = true
                r.onSuccess {
                    if (Repo.live.isEmpty() && Repo.movies.isEmpty() && Repo.series.isEmpty()) {
                        status("A lista veio vazia. Confira o link.")
                    } else {
                        startActivity(Intent(this, HomeActivity::class.java))
                        finish()
                    }
                }.onFailure { status("Não deu para carregar: ${it.message ?: it.javaClass.simpleName}") }
            }
        }
    }
}

class HomeActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (restartIfEmpty()) return
        setContentView(R.layout.activity_home)
        tile(R.id.live, "TV ao Vivo", "${Repo.live.size} canais", Kind.LIVE).requestFocus()
        tile(R.id.movies, "Filmes", "${Repo.movies.size} títulos", Kind.MOVIE)
        tile(R.id.series, "Séries", "${Repo.series.size} títulos", Kind.SERIES)
        findViewById<Button>(R.id.multi).apply {
            text = "Multitela\naté 4 canais"
            setOnClickListener { startActivity(Intent(this@HomeActivity, MultiActivity::class.java)) }
        }
        findViewById<Button>(R.id.reload).setOnClickListener { goLogin(refresh = true) }
        findViewById<Button>(R.id.logout).setOnClickListener { Prefs(this).clearLogin(); Repo.cacheFile(this).delete(); goLogin(refresh = false) }
    }

    private fun tile(id: Int, title: String, count: String, kind: Kind) = findViewById<Button>(id).apply {
        text = "$title\n$count"
        setOnClickListener {
            startActivity(Intent(this@HomeActivity, BrowseActivity::class.java)
                .putExtra("kind", kind.name).putExtra("title", title))
        }
    }

    private fun goLogin(refresh: Boolean) {
        Repo.loaded = false
        startActivity(Intent(this, LoginActivity::class.java).putExtra("refresh", refresh))
        finish()
    }
}

/** Categories on the left; a list (channels, episodes) or a poster grid with details (movies, series) on the right. */
class BrowseActivity : Activity() {
    private class Group(val label: String, val sort: Comparator<Item>? = null, val test: (Item, Set<String>) -> Boolean)

    private lateinit var prefs: Prefs
    private lateinit var groupsView: RecyclerView
    private lateinit var itemsView: RecyclerView
    private lateinit var search: EditText
    private lateinit var empty: TextView
    private lateinit var epg: TextView
    private lateinit var details: View
    private var all = emptyList<Item>()
    private var groups = emptyList<Group>()
    private var shown = emptyList<Item>()
    private var current = 1
    private var groupsAdapter: Rows? = null
    private var episodes = false
    private var grid = false
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (restartIfEmpty()) return
        setContentView(R.layout.activity_browse)
        prefs = Prefs(this)
        groupsView = findViewById(R.id.groups)
        itemsView = findViewById(R.id.items)
        search = findViewById(R.id.search)
        empty = findViewById(R.id.empty)
        epg = findViewById(R.id.epg)
        details = findViewById(R.id.details)
        groupsView.layoutManager = LinearLayoutManager(this)
        findViewById<TextView>(R.id.title).text = intent.getStringExtra("title")
        search.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = refresh()
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        val seriesId = intent.getStringExtra("seriesId")
        episodes = seriesId != null
        if (seriesId == null) {
            setData(Repo.list(Kind.valueOf(intent.getStringExtra("kind")!!)))
        } else {
            itemsView.layoutManager = LinearLayoutManager(this)
            showEmpty("Carregando episódios…")
            thread {
                val r = runCatching { Repo.episodes(seriesId) }
                runOnUiThread { r.onSuccess { setData(it) }.onFailure { showEmpty("Não deu para carregar: ${it.message}") } }
            }
        }
    }

    private fun setData(list: List<Item>) {
        grid = !episodes && list.firstOrNull()?.kind.let { it == Kind.MOVIE || it == Kind.SERIES }
        itemsView.layoutManager = if (grid) GridLayoutManager(this, 3) else LinearLayoutManager(this)
        details.visibility = if (grid) View.VISIBLE else View.GONE
        val byGroup = list.map { it.group }.distinct().map { g -> Group(g) { i, _ -> i.group == g } }
        if (episodes) {
            // A series: only its seasons on the left, opening on the first one, episodes in order.
            all = list.sortedWith(byEpisode)
            groups = all.map { it.group }.distinct().map { g -> Group(g) { i, _ -> i.group == g } }
            current = 0
        } else {
            all = list
            val extra = if (!grid) emptyList() else {
                // Genres from the server (series), most common first, then release years, newest first.
                val genres = all.flatMap(::genresOf).groupingBy { it }.eachCount().entries.sortedByDescending { it.value }
                    .map { (g, _) -> Group("Gênero · $g") { i, _ -> g in genresOf(i) } }
                val years = all.map { it.year }.filter { it > 0 }.distinct().sortedDescending()
                    .map { y -> Group("Ano $y") { i, _ -> i.year == y } }
                genres + years
            }
            groups = listOf(Group("★ Favoritos") { i, f -> key(i) in f }, Group("Todos") { _, _ -> true }) +
                (if (grid) listOf(Group("Mais novos", compareByDescending { it.year }) { i, _ -> i.year > 0 }) else emptyList()) +
                byGroup + extra
            // Start on "Todos" unless there are favorites. A category opens on click (OK or mouse), not on focus:
            // focus-driven switching fired on RecyclerView's own default focus and never fired for mouse clicks.
            current = if (all.any { key(it) in prefs.favorites }) 0 else 1
        }
        groupsAdapter = Rows(groups.map { it.label to null }, onClick = {
            current = it
            refresh()
            itemsView.post { itemsView.getChildAt(0)?.requestFocus() }
        })
        groupsView.adapter = groupsAdapter
        refresh()
        if (episodes) itemsView.post { itemsView.getChildAt(0)?.requestFocus() }
        else groupsView.post { groupsView.findViewHolderForAdapterPosition(current)?.itemView?.requestFocus() }
    }

    private fun key(i: Item) = i.seriesId?.let { "series:$it" } ?: i.url

    private fun refresh() {
        // Mark the selected group without notify*, which would rebind rows and drop the remote's focus.
        groupsAdapter?.selected = current
        for (i in 0 until groupsView.childCount) groupsView.getChildAt(i).let { it.isSelected = groupsView.getChildAdapterPosition(it) == current }
        val g = groups.getOrNull(current) ?: return
        val favs = prefs.favorites
        val q = search.text.toString().trim()
        shown = all.filter { g.test(it, favs) && (q.isEmpty() || it.name.contains(q, ignoreCase = true)) }
            .let { if (g.sort != null) it.sortedWith(g.sort) else it }

        val toGroups = { groupsView.findViewHolderForAdapterPosition(current)?.itemView?.requestFocus(); Unit }
        itemsView.adapter = if (grid) Posters(shown, onClick = ::open, onLong = ::toggleFavorite, onLeft = toGroups, onFocus = ::showDetails)
        else Rows(shown.map { it.name to it.logo }, onClick = ::open, onLong = ::toggleFavorite, onLeft = toGroups, onFocus = ::showEpg)
        if (shown.isEmpty()) showEmpty(if (current == 0 && !episodes) "Sem favoritos ainda. Segure OK num item para favoritar." else "Nada aqui.")
        else empty.visibility = View.GONE
        if (grid) showDetails(0)
    }

    private fun showEmpty(msg: String) {
        empty.text = msg
        empty.visibility = View.VISIBLE
    }

    /** Guide for the highlighted channel, fetched only once the remote stops moving. */
    private fun showEpg(pos: Int) {
        val item = shown.getOrNull(pos)
        handler.removeCallbacksAndMessages(null)
        if (item?.kind != Kind.LIVE) { epg.visibility = View.GONE; return }
        epg.text = ""
        epg.visibility = View.VISIBLE
        handler.postDelayed({
            thread {
                val text = runCatching { epgNow(prefs, item) }.getOrDefault("")
                runOnUiThread { if (shown.getOrNull(pos) === item) epg.text = text }
            }
        }, 500)
    }

    /** Title, year, rating, genre and plot of the highlighted poster; movies fetch their plot on demand. */
    private fun showDetails(pos: Int) {
        val item = shown.getOrNull(pos) ?: return
        fun fill(genre: String, year: String, rating: String, plot: String) {
            findViewById<TextView>(R.id.dTitle).text = item.name
            val stars = rating.toDoubleOrNull()?.takeIf { it > 0 }?.let { "★ " + String.format("%.1f", it).replace('.', ',') }
            findViewById<TextView>(R.id.dMeta).text = listOfNotNull(year.ifEmpty { null }, stars, genre.ifEmpty { null }).joinToString("  ·  ")
            findViewById<TextView>(R.id.dPlot).text = plot
        }
        val year = if (item.year > 0) item.year.toString() else ""
        val needsInfo = item.kind == Kind.MOVIE && item.plot.isEmpty() && Repo.xtream != null
        fill(genresOf(item).joinToString(", "), year, item.rating,
            item.plot.ifEmpty { if (needsInfo) "Carregando sinopse…" else "Sem sinopse." })
        handler.removeCallbacksAndMessages(null)
        if (!needsInfo) return
        handler.postDelayed({
            thread {
                val info = runCatching { Repo.xtream?.vodInfo(item) }.getOrNull()
                runOnUiThread {
                    if (shown.getOrNull(pos) !== item) return@runOnUiThread
                    fill(info?.optString("genre").orEmpty(), year.ifEmpty { info?.optString("releasedate").orEmpty().take(4) },
                        item.rating.ifEmpty { info?.optString("rating").orEmpty() },
                        info?.optString("plot").orEmpty().ifEmpty { "Sem sinopse." })
                }
            }
        }, 500)
    }

    private fun open(pos: Int) {
        val item = shown[pos]
        if (intent.getBooleanExtra("pick", false)) { // choosing a channel for the multiscreen
            setResult(RESULT_OK, Intent().putExtra("url", item.url))
            finish()
        } else if (item.kind == Kind.SERIES) {
            startActivity(Intent(this, BrowseActivity::class.java)
                .putExtra("seriesId", item.seriesId).putExtra("title", item.name))
        } else {
            Repo.playlist = shown
            startActivity(Intent(this, PlayerActivity::class.java).putExtra("index", pos))
        }
    }

    private fun toggleFavorite(pos: Int) {
        val k = key(shown[pos])
        val favs = prefs.favorites.toMutableSet()
        if (!favs.remove(k)) favs.add(k)
        prefs.favorites = favs
        toast(if (k in favs) "Adicionado aos favoritos" else "Removido dos favoritos")
        if (current == 0) refresh()
    }
}

/** Poster grid cell: cover image with the title over it. */
class Posters(
    private val items: List<Item>,
    private val onClick: (Int) -> Unit,
    private val onLong: (Int) -> Unit,
    private val onLeft: () -> Unit,
    private val onFocus: (Int) -> Unit,
) : RecyclerView.Adapter<Posters.VH>() {
    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val cover: ImageView = v.findViewById(R.id.cover)
        val caption: TextView = v.findViewById(R.id.caption)
    }

    override fun onCreateViewHolder(parent: ViewGroup, type: Int): VH {
        val vh = VH(LayoutInflater.from(parent.context).inflate(R.layout.poster, parent, false))
        val v = vh.itemView
        fun pos(f: (Int) -> Unit) { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let(f) }
        v.setOnClickListener { pos(onClick) }
        v.setOnLongClickListener { pos(onLong); true }
        v.setOnFocusChangeListener { _, has ->
            v.animate().scaleX(if (has) 1.08f else 1f).scaleY(if (has) 1.08f else 1f).setDuration(120).start()
            if (has) pos(onFocus)
        }
        // Leaving the first column goes back to the categories.
        v.setOnKeyListener { _, code, e ->
            if (code == KeyEvent.KEYCODE_DPAD_LEFT && e.action == KeyEvent.ACTION_DOWN && vh.bindingAdapterPosition % 3 == 0) {
                onLeft(); true
            } else false
        }
        return vh
    }

    override fun onBindViewHolder(vh: VH, pos: Int) {
        val item = items[pos]
        vh.caption.text = item.name
        vh.cover.setImageDrawable(null)
        if (item.logo != null) vh.cover.load(item.logo)
    }

    override fun getItemCount() = items.size
}

class Rows(
    private val rows: List<Pair<String, String?>>,
    private val onClick: (Int) -> Unit,
    private val onLong: ((Int) -> Unit)? = null,
    private val onLeft: (() -> Unit)? = null,
    private val onFocus: ((Int) -> Unit)? = null,
) : RecyclerView.Adapter<Rows.VH>() {
    var selected = -1

    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val name: TextView = v.findViewById(R.id.name)
        val logo: ImageView = v.findViewById(R.id.logo)
    }

    override fun onCreateViewHolder(parent: ViewGroup, type: Int): VH {
        val vh = VH(LayoutInflater.from(parent.context).inflate(R.layout.row, parent, false))
        val v = vh.itemView
        v.setOnClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let(onClick) }
        if (onFocus != null) v.setOnFocusChangeListener { _, has ->
            if (has) vh.bindingAdapterPosition.takeIf { it >= 0 }?.let(onFocus)
        }
        if (onLong != null) v.setOnLongClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let(onLong); true }
        if (onLeft != null) v.setOnKeyListener { _, code, e ->
            if (code == KeyEvent.KEYCODE_DPAD_LEFT && e.action == KeyEvent.ACTION_DOWN) { onLeft.invoke(); true } else false
        }
        return vh
    }

    override fun onBindViewHolder(vh: VH, pos: Int) {
        val (name, logo) = rows[pos]
        vh.name.text = name
        vh.itemView.isSelected = pos == selected
        if (logo == null) {
            vh.logo.visibility = View.GONE
            vh.logo.setImageDrawable(null)
        } else {
            vh.logo.visibility = View.VISIBLE
            vh.logo.load(logo)
        }
    }

    override fun getItemCount() = rows.size
}

/** ExoPlayer that follows http<->https redirects and identifies itself like the playlist requests. */
@OptIn(UnstableApi::class)
fun newPlayer(ctx: android.content.Context): ExoPlayer {
    val http = DefaultHttpDataSource.Factory()
        .setUserAgent(USER_AGENT)
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(15_000)
        .setReadTimeoutMs(30_000)
    return ExoPlayer.Builder(ctx)
        .setMediaSourceFactory(DefaultMediaSourceFactory(ctx).setDataSourceFactory(http))
        .build()
}

@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {
    private lateinit var player: ExoPlayer
    private lateinit var view: PlayerView
    private var index = 0
    private val item get() = Repo.playlist[index]

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (restartIfEmpty() || Repo.playlist.isEmpty()) return
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        player = newPlayer(this)
        player.addListener(object : Player.Listener {
            override fun onPlayerError(e: PlaybackException) {
                if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    player.seekToDefaultPosition()
                    player.prepare()
                } else toast("Não foi possível tocar: ${e.errorCodeName}")
            }
        })
        view = PlayerView(this)
        view.player = player
        setContentView(view)
        index = intent.getIntExtra("index", 0).coerceIn(0, Repo.playlist.lastIndex)
        play()
    }

    private fun play() {
        // Live channels: no seek bar, up/down zaps. Movies/episodes: normal controls.
        view.useController = item.kind != Kind.LIVE
        player.setMediaItem(MediaItem.fromUri(item.url))
        player.prepare()
        player.playWhenReady = true
        if (item.kind == Kind.LIVE) showGuide()
    }

    private fun showGuide() {
        val it = item
        toast("${index + 1}. ${it.name}")
        thread {
            val text = runCatching { epgNow(Prefs(this), it) }.getOrDefault("")
            runOnUiThread {
                if (text.isNotEmpty() && item === it) Toast.makeText(this, "${index + 1}. ${it.name}\n$text", Toast.LENGTH_LONG).show()
            }
        }
    }

    private var okDownAt = 0L
    private var okLong = false

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        if (!::player.isInitialized || item.kind != Kind.LIVE) return super.dispatchKeyEvent(e)
        val ok = e.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || e.keyCode == KeyEvent.KEYCODE_ENTER
        if (ok) {
            // Tap OK: channel guide. Hold OK: send the channel to the multiscreen.
            if (e.action == KeyEvent.ACTION_DOWN) {
                if (e.repeatCount == 0) { okDownAt = e.eventTime; okLong = false }
                else if (!okLong && (e.isLongPress || e.eventTime - okDownAt > 700)) { okLong = true; addToMulti() }
            } else if (e.action == KeyEvent.ACTION_UP && !okLong) showGuide()
            return true
        }
        if (e.action == KeyEvent.ACTION_DOWN) {
            when (e.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> { zap(-1); return true }
                KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> { zap(1); return true }
            }
        }
        return super.dispatchKeyEvent(e)
    }

    private fun addToMulti() {
        val prefs = Prefs(this)
        val urls = prefs.multi.split('\n').filter { it.isNotEmpty() }.toMutableList()
        if (item.url !in urls) {
            if (urls.size >= 4) { toast("O Multitela já tem 4 canais. Segure OK num quadro para tirar um."); return }
            urls += item.url
            prefs.multi = urls.joinToString("\n")
        }
        toast("${item.name} no Multitela")
        // Back to the open multiscreen if it is underneath, otherwise a new one.
        startActivity(Intent(this, MultiActivity::class.java).putExtra("url", item.url)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }

    private fun zap(delta: Int) {
        index = (index + delta).mod(Repo.playlist.size)
        play()
    }

    override fun onStart() {
        super.onStart()
        if (::player.isInitialized) player.playWhenReady = true
    }

    override fun onStop() {
        super.onStop()
        if (::player.isInitialized) player.playWhenReady = false
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::player.isInitialized) player.release()
    }
}
