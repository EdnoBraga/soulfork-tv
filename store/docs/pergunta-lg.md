# Pergunta para a LG (Seller Lounge → Support → 1:1 Q&A)

**Onde enviar:** seller.lgappstv.com → login com a conta corporativa da SoulFork → Support → 1:1 Q&A.
**Categoria sugerida:** App Registration / Billing.
**Objetivo:** ter por escrito, antes de programar a cobrança, se a LG aceita o nosso modelo (risco A1 dos requisitos).

---

## Texto para colar (inglês)

**Subject:** Pre-submission question: external subscription activation (PIX) for a media player app with no content

Hello LG Seller team,

We are SoulFork, a registered company in Brazil, preparing to submit a webOS TV app named "SoulFork IPTV" to the LG Content Store (Brazil only). Before we build the billing part, we would like written confirmation that our business model complies with LG Content Store policies.

**About the app**
- It is a media player for streams the user already has (M3U playlists or Xtream Codes logins typed in by the user).
- The app does not include, sell, recommend or link to any channel, playlist or content. The store listing, the app and our Terms of Use state this clearly.

**Business model**
1. The app is free to download and fully functional for a 5-day free trial.
2. After the trial, the app asks for a 1-year activation that costs BRL 29.90.
3. Payment is made with PIX (the Brazilian Central Bank instant payment system). The TV shows a PIX QR code, the user pays with their own banking app on a phone, and our server activates the license for that TV. No card or banking data is entered on the TV.
4. The license is bound to the TV through the LGUDID (webOSTV.js `webOSDev.LGUDID()`), read only after the user accepts a consent screen. We store only a hash of it.

**Our questions**
1. Is it allowed to sell this activation through our own external PIX payment, as described, instead of webOS Pay / 3rd Party Billing set up in the Seller Lounge? If it is not allowed, which billing option should we use, and does webOS Pay support PIX in Brazil?
2. If external payment is allowed, are there any requirements for the store listing (price disclosure, "offers in-app purchases" flag, etc.)?
3. Is using the LGUDID for this licensing purpose, with prior user consent, compliant with LG's policies? Is any extra permission or declaration needed in appinfo.json?
4. Are there specific review requirements for media player apps that play user-provided streams (IPTV players)?

Thank you very much. We will follow your guidance before submitting the app.

Best regards,
SoulFork — soulfork.com.br

---

## Tradução (para conferência)

**Assunto:** Pergunta antes do envio: ativação de assinatura externa (PIX) para um app player sem conteúdo

Olá, equipe de vendedores da LG.

Somos a SoulFork, empresa registrada no Brasil, e estamos preparando o envio de um app para webOS TV chamado "SoulFork IPTV" à LG Content Store, só para o Brasil. Antes de construir a parte de cobrança, queremos confirmar por escrito que o nosso modelo segue as políticas da loja.

**Sobre o app**
- É um player para transmissões que o usuário já tem: listas M3U ou login Xtream, digitados pelo próprio usuário.
- O app não inclui, não vende, não recomenda e não aponta para nenhum canal, lista ou conteúdo. A ficha da loja, o app e os nossos Termos de Uso deixam isso claro.

**Modelo de negócio**
1. O app é gratuito para baixar e funciona por completo durante 5 dias de teste.
2. Depois do teste, pede uma ativação de 1 ano por R$ 29,90.
3. O pagamento é por PIX, o sistema de pagamento instantâneo do Banco Central do Brasil. A TV mostra um QR Code, o usuário paga com o app do banco no celular, e o nosso servidor ativa a licença daquela TV. Nenhum dado de cartão ou de banco é digitado na TV.
4. A licença fica ligada à TV pelo LGUDID (`webOSDev.LGUDID()` do webOSTV.js), lido só depois que o usuário aceita uma tela de consentimento. Guardamos apenas um hash dele.

**Nossas perguntas**
1. É permitido vender essa ativação pelo nosso pagamento PIX externo, como descrito, em vez do webOS Pay ou do 3rd Party Billing configurado no Seller Lounge? Se não for, qual opção de cobrança devemos usar, e o webOS Pay aceita PIX no Brasil?
2. Se o pagamento externo for permitido, há exigências para a ficha da loja (informar o preço, marcar "oferece compras no app" etc.)?
3. Usar o LGUDID para essa licença, com consentimento prévio do usuário, está de acordo com as políticas da LG? É preciso alguma permissão ou declaração extra no appinfo.json?
4. Existem exigências específicas de revisão para apps player que tocam transmissões fornecidas pelo usuário (players de IPTV)?

Muito obrigado. Seguiremos a orientação de vocês antes de enviar o app.

Atenciosamente,
SoulFork — soulfork.com.br
