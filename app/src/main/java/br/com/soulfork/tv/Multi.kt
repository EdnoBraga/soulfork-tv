package br.com.soulfork.tv

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView

/**
 * Up to 4 live channels at once. Shows one more cell than there are channels (to add the next one):
 * 1 cell full screen, 2 side by side, 3-4 in a 2x2 grid. Only the selected cell has sound.
 * OK on an empty cell picks a channel, OK on a channel opens it full screen, holding OK removes it.
 */
@OptIn(UnstableApi::class)
class MultiActivity : Activity() {
    private class Cell(val frame: FrameLayout, val video: PlayerView, val label: TextView, val hint: TextView)

    private lateinit var prefs: Prefs
    private val channels = ArrayList<Item>()
    private val players = arrayOfNulls<ExoPlayer>(4)
    private lateinit var cells: List<Cell>
    private lateinit var rows: List<LinearLayout>
    private var sel = 0
    private var longPressed = false

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (!Repo.loaded) { startActivity(Intent(this, LoginActivity::class.java)); finish(); return }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        prefs = Prefs(this)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        rows = List(2) { LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL } }
        rows.forEach { root.addView(it, LinearLayout.LayoutParams(-1, 0, 1f)) }
        cells = List(4) { i ->
            val video = PlayerView(this).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            }
            val label = TextView(this).apply {
                textSize = 16f
                setTextColor(Color.WHITE)
                setBackgroundColor(0xB3000000.toInt())
                setPadding(16, 8, 16, 8)
            }
            val hint = TextView(this).apply {
                text = "+ Adicionar canal"
                textSize = 22f
                setTextColor(0xFF9AA3C7.toInt())
                gravity = Gravity.CENTER
            }
            val frame = FrameLayout(this).apply {
                setPadding(6, 6, 6, 6)
                addView(video, FrameLayout.LayoutParams(-1, -1))
                addView(hint, FrameLayout.LayoutParams(-1, -1))
                addView(label, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START))
            }
            rows[i / 2].addView(frame, LinearLayout.LayoutParams(0, -1, 1f))
            Cell(frame, video, label, hint)
        }
        setContentView(root)
    }

    // Players live only while the screen is visible: each one holds a decoder and a server connection.
    override fun onResume() {
        super.onResume()
        if (!::cells.isInitialized) return
        // The saved list is the source of truth: the player adds channels to it too (hold OK).
        val byUrl = Repo.live.associateBy { it.url }
        channels.clear()
        prefs.multi.split('\n').mapNotNullTo(channels) { byUrl[it] }
        intent.getStringExtra("url")?.let { url ->
            channels.indexOfFirst { it.url == url }.takeIf { it >= 0 }?.let { sel = it }
            intent.removeExtra("url")
        }
        layoutCells()
        channels.indices.forEach(::startPlayer)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        players.indices.forEach(::stopPlayer)
    }

    private val count get() = minOf(4, channels.size + 1)

    private fun layoutCells() {
        sel = sel.coerceIn(0, count - 1)
        rows[1].visibility = if (count >= 3) View.VISIBLE else View.GONE
        cells.forEachIndexed { i, c ->
            c.frame.visibility = if (i < count) View.VISIBLE else View.GONE
            val ch = channels.getOrNull(i)
            c.hint.visibility = if (ch == null) View.VISIBLE else View.GONE
            c.label.visibility = if (ch == null) View.GONE else View.VISIBLE
            c.label.text = ch?.let { (if (i == sel) "🔊 " else "") + it.name }
            c.frame.background = GradientDrawable().apply {
                setColor(0xFF0B0F1F.toInt())
                setStroke(if (i == sel) 8 else 2, if (i == sel) 0xFF5EE6E6.toInt() else 0xFF1A2140.toInt())
            }
        }
        players.forEachIndexed { i, p -> p?.volume = if (i == sel) 1f else 0f }
    }

    private fun startPlayer(i: Int) {
        val ch = channels.getOrNull(i) ?: return
        stopPlayer(i)
        val p = newPlayer(this)
        p.addListener(object : Player.Listener {
            override fun onPlayerError(e: PlaybackException) {
                // Usually the device ran out of video decoders for one more channel.
                cells[i].label.text = "${ch.name}: não abriu (${e.errorCodeName})"
            }
        })
        p.volume = if (i == sel) 1f else 0f
        p.setMediaItem(MediaItem.fromUri(ch.url))
        p.prepare()
        p.playWhenReady = true
        cells[i].video.player = p
        players[i] = p
    }

    private fun stopPlayer(i: Int) {
        players[i]?.release()
        players[i] = null
        if (::cells.isInitialized) cells[i].video.player = null
    }

    private fun save() { prefs.multi = channels.joinToString("\n") { it.url } }

    override fun onKeyDown(code: Int, e: KeyEvent): Boolean {
        when (code) {
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { e.startTracking(); return true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> {
                move(code); return true
            }
        }
        return super.onKeyDown(code, e)
    }

    override fun onKeyLongPress(code: Int, e: KeyEvent): Boolean {
        if (code != KeyEvent.KEYCODE_DPAD_CENTER && code != KeyEvent.KEYCODE_ENTER) return super.onKeyLongPress(code, e)
        longPressed = true
        val ch = channels.getOrNull(sel) ?: return true
        players.indices.forEach(::stopPlayer)
        channels.removeAt(sel)
        save()
        Toast.makeText(this, "${ch.name} saiu da tela", Toast.LENGTH_SHORT).show()
        layoutCells()
        channels.indices.forEach(::startPlayer)
        return true
    }

    override fun onKeyUp(code: Int, e: KeyEvent): Boolean {
        if (code != KeyEvent.KEYCODE_DPAD_CENTER && code != KeyEvent.KEYCODE_ENTER) return super.onKeyUp(code, e)
        if (longPressed) { longPressed = false; return true }
        if (!e.isCanceled) ok()
        return true
    }

    private fun move(code: Int) {
        val n = count
        if (n == 1) return
        var r = sel / 2
        var c = sel % 2
        when (code) {
            KeyEvent.KEYCODE_DPAD_LEFT -> c = 0
            KeyEvent.KEYCODE_DPAD_RIGHT -> c = 1
            KeyEvent.KEYCODE_DPAD_UP -> r = 0
            KeyEvent.KEYCODE_DPAD_DOWN -> r = 1
        }
        val next = r * 2 + c
        if (next < n) { sel = next; layoutCells() }
    }

    private fun ok() {
        val ch = channels.getOrNull(sel)
        if (ch == null) {
            startActivityForResult(Intent(this, BrowseActivity::class.java)
                .putExtra("kind", Kind.LIVE.name).putExtra("title", "Escolha o canal").putExtra("pick", true), PICK)
        } else {
            Repo.playlist = channels.toList()
            startActivity(Intent(this, PlayerActivity::class.java).putExtra("index", sel))
        }
    }

    override fun onActivityResult(request: Int, result: Int, data: Intent?) {
        super.onActivityResult(request, result, data)
        val url = data?.getStringExtra("url") ?: return
        if (request != PICK || result != RESULT_OK) return
        // The server refuses the same channel twice at the same time.
        if (channels.any { it.url == url }) { Toast.makeText(this, "Esse canal já está na tela", Toast.LENGTH_SHORT).show(); return }
        val ch = Repo.live.firstOrNull { it.url == url } ?: return
        channels.add(ch)
        sel = channels.lastIndex
        save()
    }

    private companion object { const val PICK = 1 }
}
