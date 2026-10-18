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
    fun cacheRoundTripKeepsEveryField() {
        val items = listOf(
            Item("Canal\tcom tab", "http://x/l.png", "Notícias", "http://s/live/1.ts", Kind.LIVE),
            Item("Série", null, "Séries", "", Kind.SERIES, "42"),
        )
        val sw = java.io.StringWriter()
        writeItems(items, sw)
        val back = readItems(sw.toString().reader().buffered())

        assertEquals(items[1], back[1])
        assertEquals("Canal com tab", back[0].name)
        assertEquals(items[0].copy(name = "Canal com tab"), back[0])
    }

    @Test
    fun sortsEpisodesBySeasonThenEpisode() {
        fun ep(n: String, s: Int) = Item(n, null, "Temporada $s", "u", Kind.EPISODE)
        val sorted = listOf(ep("Zorro S02 E01", 2), ep("Zorro S01 E10", 1), ep("Zorro S01 E02", 1), ep("T1 E1 · Piloto", 1))
            .sortedWith(byEpisode)
        assertEquals(listOf("T1 E1 · Piloto", "Zorro S01 E02", "Zorro S01 E10", "Zorro S02 E01"), sorted.map { it.name })
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
