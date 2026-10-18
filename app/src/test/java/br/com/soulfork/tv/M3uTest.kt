package br.com.soulfork.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class M3uTest {
    @Test
    fun parsesAttributesNamesAndKinds() {
        val m3u = """
            #EXTM3U
            #EXTINF:-1 tvg-id="g1" tvg-logo="http://x/logo.png" group-title="Notícias, 24h",Globo News HD
            http://srv:8080/live/u/p/1.ts
            #EXTINF:-1 group-title="Filmes",Matrix (1999)
            http://srv:8080/movie/u/p/2.mkv
            #EXTINF:-1,
            #EXTVLCOPT:http-user-agent=Foo
            http://srv:8080/series/u/p/3.mp4
        """.trimIndent()

        val items = parseM3u(m3u.reader().buffered())

        assertEquals(3, items.size)
        assertEquals("Globo News HD", items[0].name)
        assertEquals("Notícias, 24h", items[0].group)
        assertEquals("http://x/logo.png", items[0].logo)
        assertEquals(Kind.LIVE, items[0].kind)
        assertEquals(Kind.MOVIE, items[1].kind)
        assertNull(items[1].logo)
        assertEquals("3.mp4", items[2].name)
        assertEquals("Sem categoria", items[2].group)
        assertEquals(Kind.EPISODE, items[2].kind)
    }

    @Test
    fun groupsLooseEpisodesIntoShowsAndSeasons() {
        fun ep(n: String) = Item(n, null, "Séries | Comédia", "http://s/series/$n.mp4", Kind.EPISODE)
        val shows = groupEpisodes(listOf(ep("The Office S01 E01"), ep("The Office S02E05"), ep("Dark S1 E1"), ep("Avulso")))

        assertEquals(listOf("The Office", "Dark", "Avulso"), shows.keys.toList())
        assertEquals(listOf("Temporada 1", "Temporada 2"), shows["The Office"]!!.map { it.group })
        assertEquals("Séries | Comédia", shows["Avulso"]!![0].group)
    }
}
