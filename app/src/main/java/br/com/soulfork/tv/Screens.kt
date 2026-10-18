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
            if (prefs.hasLogin) load() else status("Preencha os campos.")
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

        if (prefs.hasLogin) load() else findViewById<View>(R.id.tabM3u).requestFocus()
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

    private fun load() {
        val enter = findViewById<Button>(R.id.enter)
        enter.isEnabled = false
        status("Carregando sua lista…")
        thread {
            val r = runCatching { Repo.load(this) }
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
        findViewById<Button>(R.id.reload).setOnClickListener { goLogin() }
        findViewById<Button>(R.id.logout).setOnClickListener { Prefs(this).clearLogin(); goLogin() }
    }

    private fun tile(id: Int, title: String, count: String, kind: Kind) = findViewById<Button>(id).apply {
        text = "$title\n$count"
        setOnClickListener {
            startActivity(Intent(this@HomeActivity, BrowseActivity::class.java)
                .putExtra("kind", kind.name).putExtra("title", title))
        }
    }

    private fun goLogin() {
        Repo.loaded = false
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}

/** Categories on the left, items on the right — used for live, movies, series and a series' episodes. */
class BrowseActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var groupsView: RecyclerView
    private lateinit var itemsView: RecyclerView
    private lateinit var search: EditText
    private lateinit var empty: TextView
    private var all = emptyList<Item>()
    private var groups = emptyList<String>()
    private var shown = emptyList<Item>()
    private var current = 1
    private var groupsAdapter: Rows? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (restartIfEmpty()) return
        setContentView(R.layout.activity_browse)
        prefs = Prefs(this)
        groupsView = findViewById(R.id.groups)
        itemsView = findViewById(R.id.items)
        search = findViewById(R.id.search)
        empty = findViewById(R.id.empty)
        groupsView.layoutManager = LinearLayoutManager(this)
        itemsView.layoutManager = LinearLayoutManager(this)
        findViewById<TextView>(R.id.title).text = intent.getStringExtra("title")
        search.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = refresh()
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        val seriesId = intent.getStringExtra("seriesId")
        if (seriesId == null) {
            setData(Repo.list(Kind.valueOf(intent.getStringExtra("kind")!!)))
        } else {
            showEmpty("Carregando episódios…")
            thread {
                val r = runCatching { Repo.xtream!!.episodes(seriesId) }
                runOnUiThread { r.onSuccess { setData(it) }.onFailure { showEmpty("Não deu para carregar: ${it.message}") } }
            }
        }
    }

    private fun setData(list: List<Item>) {
        all = list
        groups = listOf("★ Favoritos", "Todos") + list.map { it.group }.distinct()
        groupsAdapter = Rows(groups.map { it to null },
            onClick = { itemsView.getChildAt(0)?.requestFocus() },
            onFocus = { if (it != current) { current = it; refresh() } })
        groupsView.adapter = groupsAdapter
        refresh()
        groupsView.post { groupsView.findViewHolderForAdapterPosition(current)?.itemView?.requestFocus() }
    }

    private fun key(i: Item) = i.seriesId?.let { "series:$it" } ?: i.url

    private fun refresh() {
        // Mark the selected group without notify*, which would rebind rows and drop the remote's focus.
        groupsAdapter?.selected = current
        for (i in 0 until groupsView.childCount) groupsView.getChildAt(i).let { it.isSelected = groupsView.getChildAdapterPosition(it) == current }
        val favs = prefs.favorites
        val q = search.text.toString().trim()
        shown = when (current) {
            0 -> all.filter { key(it) in favs }
            1 -> all
            else -> all.filter { it.group == groups[current] }
        }.filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) }

        itemsView.adapter = Rows(shown.map { it.name to it.logo },
            onClick = ::open,
            onLong = ::toggleFavorite,
            onLeft = { groupsView.findViewHolderForAdapterPosition(current)?.itemView?.requestFocus() })
        if (shown.isEmpty()) showEmpty(if (current == 0) "Sem favoritos ainda. Segure OK num item para favoritar." else "Nada aqui.")
        else empty.visibility = View.GONE
    }

    private fun showEmpty(msg: String) {
        empty.text = msg
        empty.visibility = View.VISIBLE
    }

    private fun open(pos: Int) {
        val item = shown[pos]
        if (item.kind == Kind.SERIES) {
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

class Rows(
    private val rows: List<Pair<String, String?>>,
    private val onClick: (Int) -> Unit,
    private val onFocus: ((Int) -> Unit)? = null,
    private val onLong: ((Int) -> Unit)? = null,
    private val onLeft: (() -> Unit)? = null,
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
        v.setOnFocusChangeListener { _, has -> if (has) vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { onFocus?.invoke(it) } }
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
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(http))
            .build()
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
        if (item.kind == Kind.LIVE) toast(item.name)
    }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        if (::player.isInitialized && item.kind == Kind.LIVE && e.action == KeyEvent.ACTION_DOWN) {
            when (e.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> { zap(-1); return true }
                KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> { zap(1); return true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { toast("${index + 1}. ${item.name}"); return true }
            }
        }
        return super.dispatchKeyEvent(e)
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
