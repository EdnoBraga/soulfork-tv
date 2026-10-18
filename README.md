# SoulFork TV

Player de IPTV para Fire Stick / Android TV. Aceita link M3U/M3U8 ou login Xtream Codes.
É só o player: o conteúdo vem da lista que você informar.

## Instalar no Fire Stick

1. Fire Stick → Configurações → Minha Fire TV → Opções do desenvolvedor → ative **Apps de fontes desconhecidas** (ou, nas versões novas, permita o app Downloader).
2. Instale o app **Downloader** (loja da Amazon).
3. No Downloader, digite o link do APK (seção abaixo) e instale.
4. Abra o SoulFork TV. A tela mostra um endereço: abra-o no celular (no mesmo Wi-Fi) e cole o link da sua lista lá.

Link do APK (sempre a versão mais nova):
`https://github.com/EdnoBraga/soulfork-tv/releases/latest/download/SoulForkTV.apk`

## Instalar no Windows

Baixe e execute `https://github.com/EdnoBraga/soulfork-tv/releases/latest/download/SoulForkTV-Setup.exe`.
O instalador não tem assinatura paga: no aviso "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.

- Teclado: setas, Enter (OK), Esc (voltar), PageUp/PageDown (trocar canal no Multitela), **F11** tela cheia, **V** abre no VLC o que o player do app não tocar.
- Mouse: clique = OK, botão direito = segurar OK (favoritar / tirar do Multitela), rolagem = subir e descer.
- Código: `windows/` (Electron) usa o mesmo app web de `tizen/`. Gerar o instalador: `cd windows && npm install && npm run dist`.

## Instalar na Smart TV Samsung (Tizen)

O app da Samsung fica em `tizen/` e é instalado pelo PC, com a TV em modo desenvolvedor.

1. TV: Aplicativos → digitar `12345` → Developer mode **On** → Host PC IP = IP do PC → reiniciar a TV.
2. PC: Tizen Studio em `C:\tizen-studio` com o perfil de certificado **Soulfork** (Certificate Manager).
3. Empacotar e instalar:

```bash
C:\tizen-studio\tools\sdb.exe connect <IP-da-TV>
C:\tizen-studio\tools\ide\bin\tizen.bat package -t wgt -s Soulfork -- <copia-da-pasta-tizen>
C:\tizen-studio\tools\ide\bin\tizen.bat install -n SoulForkTV.wgt -t <modelo-da-TV> -- <copia-da-pasta-tizen>
```

Para colar o link da lista na TV, use o teclado do app SmartThings no celular.

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
