# SoulFork IPTV — Documento de Requisitos v0

- **Produto:** SoulFork IPTV, SaaS próprio da SoulFork Brasil (CNPJ ativo). O nome na loja leva "IPTV" para facilitar a busca.
- **Iteração 1:** LG webOS, publicado na LG Content Store. Depois virão Samsung, Fire Stick, Sony e outras.
- **Status:** aprovado pelo Edno em 18/10/2026.
- **Processo:** incremental. Cada versão roda sozinha e passa por todas as fases.

## 1. O que é

Player de IPTV **sem conteúdo**: o usuário traz a própria lista (M3U ou Xtream). A SoulFork não fornece, não indica e não vende listas.

- **Modelo de venda:** 5 dias de teste grátis, depois assinatura de 1 ano por **R$ 29,90**, paga por PIX com QR Code na tela da TV.
- **Licença:** vinculada à TV.

## 2. Requisitos funcionais

| ID | Requisito |
|---|---|
| RF1 | **Player.** Lista M3U ou Xtream do usuário, TV ao vivo com guia (Agora/A seguir), filmes e séries com capas, sinopse, gênero e ano, séries por temporada, favoritos. Reaproveita o app web atual (`tizen/`). |
| RF2 | **Primeiro uso.** Tela de consentimento (LGPD e exigência da LG) → o app lê o ID oficial da TV (LGUDID) → o servidor registra a TV e começa o teste de 5 dias. A data vem do servidor, nunca do relógio da TV. |
| RF3 | **Durante o teste.** Aviso "faltam X dias de teste". |
| RF4 | **Teste vencido sem pagamento.** Ao abrir, só aparece a tela de pagamento: QR PIX de R$ 29,90, código curto da TV (ex.: `SF-4K7Q`) e WhatsApp da SoulFork. |
| RF5 | **Pagamento.** O servidor cria o PIX dinâmico no Mercado Pago. O aviso de pagamento (webhook) ativa a licença por 365 dias. A TV libera sozinha em segundos, sem reiniciar. |
| RF6 | **Renovação.** Aviso a partir de 7 dias antes do vencimento. Vencida, volta a tela de pagamento (RF4). |
| RF7 | **Reinstalação.** Reinstalar o app não reinicia o teste: o controle é do servidor, preso ao ID da TV. |
| RF8 | **Reembolso em 7 dias** (CDC art. 49). Pedido pelo WhatsApp; a operação cancela a licença e estorna o PIX pelo Mercado Pago. |
| RF9 | **Várias listas.** Listas ilimitadas na mesma TV, cada uma com um nome; a pessoa alterna entre elas num menu. A assinatura cobre todas. |
| RF10 | **Adicionar lista pelo celular.** A TV mostra um QR Code; o celular abre uma página da SoulFork, a pessoa cola a lista e envia. O envio é criptografado de ponta a ponta com uma chave que só a TV tem. O servidor só repassa e apaga ao entregar, ou em até 10 minutos. Digitar com o controle continua disponível. |
| RF11 | **Suporte.** WhatsApp da SoulFork na tela de pagamento e na ajuda do app. |

## 3. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF1 | **Prioridade de qualidade: cobrança certa** (ISO 9126: funcionalidade e confiabilidade). Quem pagou nunca fica bloqueado; quem não pagou não usa depois do teste. Aceitamos sacrificar portabilidade e idiomas nesta iteração. |
| RNF2 | **Funciona com o servidor fora do ar.** A TV guarda uma licença assinada digitalmente pelo servidor (Ed25519), com data de validade, e confere a assinatura offline. Editar o armazenamento do app não libera nada. |
| RNF3 | **Segurança.** Nenhuma chave no app nem no repositório (o repositório é público). Chaves do Mercado Pago e de assinatura ficam nos segredos do Supabase. O webhook do Mercado Pago é conferido pela assinatura. Há limite de requisições por TV. |
| RNF4 | **LGPD.** O servidor guarda só o hash do LGUDID, as datas de teste e licença e os pagamentos. As listas nunca ficam no servidor (RF10 só repassa, cifrado). Política de privacidade e Termos de Uso são publicados antes do envio à LG. |
| RNF5 | **Custo.** Supabase no plano grátis no início. PIX a 0,99% no Mercado Pago (cerca de R$ 0,30 por venda). |
| RNF6 | **Desempenho na TV.** Listas grandes (cerca de 300 mil itens) abrem da cópia salva. A TV mantém a cópia das 3 últimas listas usadas; as outras são baixadas de novo quando escolhidas. |
| RNF7 | **Volume.** Desconhecido. A arquitetura não tem custo fixo e cresce sob demanda. |

## 4. Fora de escopo da v1

- Multitela (na Samsung a TV só deu 1 vídeo por vez; a LG deve ser igual)
- Renovação automática (PIX não é recorrente)
- Painel web do cliente (troca de TV e reembolso são pelo WhatsApp)
- Outros idiomas e países (PIX só existe no Brasil)
- Samsung, Fire Stick, Sony e outras plataformas (próximas iterações)
- Várias listas no Fire Stick, Samsung e Windows (próxima iteração)
- Qualquer venda, indicação ou distribuição de listas de canais

## 5. Em aberto e riscos

| # | Ponto | Risco | Como fechar |
|---|---|---|---|
| A1 | A LG aceita cobrança externa por PIX? A loja tem cobrança própria (webOS Pay ou Paymentwall), com comissão, e não há regra pública. Players como Smart IPTV e IBO Player usam ativação externa ligada ao ID da TV. | **Alto.** Pode obrigar a usar a cobrança da LG. | Pergunta escrita no 1:1 Q&A do Seller Lounge (`pergunta-lg.md`) **antes** de programar a cobrança. |
| A2 | Identificador da TV: o Edno pediu MAC, mas a LG não fornece o MAC a apps da loja e indica o LGUDID, que é gerado a partir do MAC. | Decidido: LGUDID com consentimento. | Confirmar no aparelho; definir o que acontece se a pessoa recusar o consentimento. |
| A3 | Termos do Mercado Pago para "software player sem conteúdo". | **Médio.** Bloqueio da conta. | Confirmar por escrito com o comercial do Mercado Pago. |
| A4 | Nota fiscal: cada venda é serviço de licença de software (ISS, LC 116 item 1.05) e gera NFS-e. | **Médio** (fiscal). | Ver com o contador; automatizar depois pelo webhook. |
| A5 | Prazo de revisão da LG: relatos de alguns dias até meses. | Atraso no lançamento. | Enviar cedo; ficha da loja e Termos claros sobre "sem conteúdo". |
| A6 | Associação com pirataria (Anatel derruba apps de IPTV); o nome "SoulFork IPTV" aumenta a atenção na revisão. | Reputação da SoulFork. | Termos, ficha da loja e app afirmam que não há conteúdo; nenhuma lista indicada. |
| A7 | TVs LG com webOS anterior ao 3.0 não têm LGUDID. | Pequeno. | Exigir webOS 3.0 ou mais novo (TVs a partir de 2016). |

## 6. Infraestrutura (prévia; o detalhe sai na fase de Projeto)

```
Celular (página tv.soulfork.com.br) ──lista cifrada──► Supabase: função de repasse ──► TV
TV LG (app webOS)  ──► Supabase novo (banco + funções: registrar TV, licença, criar PIX, webhook)
                                     │
                                     └──► Mercado Pago (PIX dinâmico + aviso de pagamento)
```

Pastas previstas neste repositório: `store/docs` (documentos), `store/webos` (app da LG), `store/server` (funções e migrations do Supabase), `store/phone` (página do celular).

## 7. Rastreabilidade (preenchida nas próximas fases)

| Requisito | Modelo / tabela | Código | Teste |
|---|---|---|---|
| RF2, RF7 | `devices` | — | — |
| RF4, RF5, RF6, RF8 | `licenses`, `payments` | — | — |
| RF10 | `pairings` | — | — |
| RNF2 | licença assinada | — | — |
