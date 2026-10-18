# SoulFork TV

Player de IPTV para Fire Stick / Android TV. Aceita link M3U/M3U8 ou login Xtream Codes.
É só o player: o conteúdo vem da lista que você informar.

## Instalar no Fire Stick

1. Fire Stick → Configurações → Minha Fire TV → Opções do desenvolvedor → ative **Apps de fontes desconhecidas** (ou, nas versões novas, permita o app Downloader).
2. Instale o app **Downloader** (loja da Amazon).
3. No Downloader, digite o link do APK (seção abaixo) e instale.
4. Abra o SoulFork TV. A tela mostra um endereço: abra-o no celular (no mesmo Wi-Fi) e cole o link da sua lista lá.

Link do APK (sempre a versão mais nova):
`https://github.com/<usuario>/soulfork-tv/releases/latest/download/SoulForkTV.apk`

## Controle remoto

- **OK**: abre o item. **Segurar OK**: favorita ou desfavorita.
- No canal ao vivo: **↑/↓** troca de canal e **OK** mostra o nome do canal.

## Publicar nova versão

```bash
git tag v1.0.1 && git push --tags
```

O GitHub Actions compila, assina (secret `KEYSTORE_B64` = base64 de `keystore/soulforktv.jks`) e publica o APK.

## Build local

JDK 17+ (o JBR do Android Studio serve): `./gradlew assembleRelease`. O `keystore/soulforktv.jks` não vai para o repositório. Guarde uma cópia: sem ele, o Fire Stick não aceita atualização por cima da versão instalada.
