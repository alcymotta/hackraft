// =====================================================================
// Hackraft - Rede: multiplayer P2P com PeerJS
// ---------------------------------------------------------------------
// COMO FUNCIONA
//   - Quem clica em "Criar sala" vira o ANFITRIÃO. O mundo "de verdade"
//     é o dele: ele decide como ficam os blocos, manda a hora do dia e
//     salva tudo no navegador dele (inclusive o inventário dos visitantes).
//   - Quem digita o código e clica em "Entrar" vira CLIENTE. Ele recebe
//     uma cópia do mundo (a semente + a lista de blocos mudados) e NÃO
//     salva nada no próprio navegador.
//   - Topologia em ESTRELA: cada cliente fala só com o anfitrião. Quando
//     um cliente manda algo que os outros precisam saber (posição, bloco),
//     o anfitrião repassa:
//
//          cliente A ───┐
//                       ├─── anfitrião (a autoridade)
//          cliente B ───┘
//
//   - O PeerJS usa um servidor público (0.peerjs.com) só para os
//     navegadores se acharem, como uma "lista telefônica". Depois disso os
//     dados vão direto de um computador para o outro (WebRTC).
//   - O código da sala tem 5 letras/números, sem os que confundem
//     (0/O, 1/I/L). O anfitrião se registra no servidor com o nome
//     'hackraft-' + código, e o cliente procura esse nome.
//   - A conexão é "confiável e em ordem": as mensagens chegam todas e na
//     mesma ordem em que foram enviadas. Isso simplifica muito as contas.
//
// MENSAGENS (cada uma é um objeto com o campo `tipo`)
//   Cliente → anfitrião
//     ola        { versao, apelido, cores }
//                1ª mensagem: "quero entrar". `cores` = cores da roupa.
//     pos        { x, y, z, yaw, pitch, noAr, quebrando, morto, planando, nadando }
//                Posição, ~15 vezes por segundo (só se mudou; no mínimo
//                1 vez por segundo, que serve de "ainda estou aqui").
//                `morto` (Fase 8): o jogador está na tela de morte (os
//                monstros não o escolhem como alvo).
//     bloco      { x, y, z, id, e }
//                O cliente mudou um bloco (ele já mudou na tela dele).
//                `e` = estado do bloco, 0 a 255 (porta aberta, tocha na
//                parede, direção do baú...). Sem `e` vale 0 (Fase 6).
//     blocos     { lista: [[x, y, z, id, e], ...] }   (Fase 6)
//                Várias mudanças de uma vez (lote), de 1 a 512 entradas.
//                Se UMA entrada for inválida, o anfitrião ignora o lote todo.
//     bauAbrir   { x, y, z }   (Fase 6)
//                "Quero abrir o baú daqui". O anfitrião confere que é um baú,
//                que está perto do jogador, e responde `bauConteudo`.
//     bauEspaco  { x, y, z, i, item, qtd, antes? }   (Fase 6, nos dois sentidos)
//                O espaço `i` (0 a 26) do baú mudou. `item` = nome e `qtd` = 1
//                a 64 (até o tamanho da pilha do item); sem item (ou qtd 0) =
//                espaço vazio. O anfitrião aplica e repassa para os outros clientes.
//                Do cliente vem também `antes`: `{ item, qtd }` ou null, o que
//                o cliente via no espaço ANTES da mudança ("comparar e trocar").
//                O anfitrião só aplica se o espaço dele for igual a `antes`;
//                senão responde `bauRecusado` e não repassa.
//     meuEstado { pos: [x, y, z], yaw, pitch, inventario, equipamento, casa, xp }
//                A cada 10 s (ou ~1 s depois de pegar/soltar um item) e
//                ao fechar a página. O anfitrião guarda pelo apelido em
//                `dadosJogadores`, que vai no save dele. `xp` (Fase 8) é o
//                XP total do jogador (jogador.xpTotal); o nível sai dele.
//     soltar     { item, qtd, x, y, z, vx, vy, vz }
//                "Soltei um item aqui" (o item já saiu do meu inventário).
//                O anfitrião cria o item no chão e avisa todos (itemNovo).
//     pegar      { id, qtd }
//                "Encostei no item `id` e cabem `qtd` no meu inventário".
//                O anfitrião confere se o item ainda existe (outro pode ter
//                pegado antes), tira do chão e responde com `ganhou`.
//     aparencia  { ap }
//                Minha aparência completa: { cores, roupa, armadura, mao,
//                acessorio }. Ao entrar e sempre que mudar.
//     chat       { texto }
//                Mensagem de chat (Fase 4). O anfitrião confere (texto de até
//                200 caracteres, sem caracteres de controle) e manda `chat`
//                para todos, inclusive para quem escreveu.
//     pedirHora  { hora }
//                "Quero mudar a hora" (/dia, /noite). O anfitrião confere que
//                é um número, aplica e manda `hora` para todos na hora.
//     efeito     { efeito: { tipo, origem, direcao, fim?, cor?, cadeia?, poder? } }   (Fase 5)
//                (o `tipo` do efeito vai DENTRO de `efeito`, porque o `tipo` de fora
//                é o da mensagem.) "Atirei um poder": efeito.tipo = 'fogo' | 'raio' | 'gelo' | 'poder'.
//                origem/direcao/fim são { x, y, z } (ou [x, y, z]), cadeia é
//                uma lista de até 3 pontos (saltos do raio), cor é um número
//                0xRRGGBB ou um texto "#rrggbb", poder é o nome do poder. O
//                anfitrião confere tudo (números finitos, no máximo ~10 por
//                segundo por jogador) e repassa para os outros. Cada
//                computador DESENHA o efeito; os blocos queimados/congelados
//                vão pelo caminho normal da mensagem `bloco`.
//     poderes    { lista }   (Fase 5)
//                Os poderes que estão ativos em mim (nomes, no máximo 8).
//                Mandado quando a lista muda. Serve para a aura dos outros.
//     atacarMob  { id, dano, dir: [x, y, z], ataque, efeito? }   (Fase 7)
//                "Bati no mob `id`". `ataque` = 'golpe' (mão/espada) ou o poder
//                'fogo' | 'raio' | 'gelo'; `efeito` = { queimar: s }, { lento: s }
//                ou { veneno: s } (Fase 8: as espadas de chefão no golpe). O
//                anfitrião confere: o mob existe e está vivo, a distância do
//                jogador até o mob é de no máximo 6 blocos no golpe (32 nos
//                poderes, que voam longe) mais o raio do mob, no máximo 3
//                golpes e 12 acertos de poder por segundo. O dano é limitado
//                (Fase 8): golpe até 20 + nível do jogador (40 se o nível não
//                for conhecido); poderes até fogo 9, raio 12, gelo 5. Aí aplica.
//     tchau      { }   "estou fechando a página" (vale nos dois sentidos)
//
//   Por que existe o `tchau`? Quando uma aba é fechada, o navegador do
//   outro lado nem sempre percebe na hora que a conexão acabou (às vezes
//   leva 30 s ou mais). Com o `tchau`, o aviso "saiu" aparece na hora.
//   Se a aba travar ou a internet cair (sem `tchau`), quem ficou percebe
//   depois de TEMPO_SEM_RESPOSTA_S sem nenhuma mensagem.
//
//   Anfitrião → cliente
//     bemvindo   { versao, meuId, apelido, semente, hora, meuEstado,
//                  posAnfitriao: [x, y, z], totalMods, lotes,
//                  jogadores: [{ id, apelido, cores, anfitriao, estado, aparencia }],
//                  itensChao: [{ id, item, qtd, pos: [x, y, z], idade }] }
//                Resposta ao `ola`. `apelido` pode voltar diferente
//                ("Pai 2") se o nome já estava em uso. `meuEstado` é o
//                que o anfitrião guardou desse apelido (ou null), com o
//                inventário e o equipamento.
//     mods       { n, dados }
//                Logo depois do `bemvindo` vêm `lotes` mensagens destas
//                com os blocos mudados do mundo. `dados` é um Int32Array
//                [x, y, z, id, estado, x, y, z, id, estado, ...] (5 números
//                por bloco desde a Fase 6) com até MODS_POR_LOTE blocos.
//     recusado   { motivo }    não deu para entrar (sala cheia, versão diferente)
//     entrou     { id, apelido, cores }   alguém novo chegou
//     saiu       { id }                   alguém foi embora
//     pos        { id, x, y, z, yaw, pitch, noAr, quebrando, planando, nadando }
//                Posição de outro jogador (o anfitrião ou um repasse).
//     bloco      { x, y, z, id, e, de }
//                Um bloco mudou. `de` = id de quem mudou. O anfitrião manda
//                para TODOS, inclusive para quem mudou: para esse, a
//                mensagem é a "confirmação" (veja _blocoDoAnfitriao).
//     blocos     { lista: [[x, y, z, id, e], ...], de }   (Fase 6)
//                O mesmo, em lote (até 512 entradas).
//     bauConteudo { x, y, z, espacos }   (Fase 6)
//                Resposta ao `bauAbrir`: 27 posições, cada uma `{ item, qtd }`
//                ou null. `bauEspaco` também vem do anfitrião (alguém mexeu).
//     bauRecusado { x, y, z, i, antes, valor, atual }   (Fase 6)
//                Só para o cliente cuja mudança `bauEspaco` foi recusada porque
//                outro jogador mexeu no espaço antes. `antes` e `valor` são os
//                do pedido; `atual` é o que o espaço tem de verdade ({ item, qtd }
//                ou null). O cliente desfaz o efeito no inventário e corrige a tela.
//     hora       { hora, por? }   a cada 5 s (segundos desde o nascer do sol).
//                Quando alguém mudou a hora de propósito, vem `por` (o
//                apelido): todos aplicam na hora (sem tolerância) e mostram
//                o aviso "<apelido> mudou para dia/noite".
//     chat       { de, apelido, texto }
//                Mensagem de chat de `de` (id) para todos (Fase 4).
//     itemNovo   { id, item, qtd, x, y, z, vx, vy, vz, de }
//                Um item apareceu no chão (`de` = id de quem soltou, ou '').
//     itemRemovido { id }   o item sumiu (alguém pegou, ou o tempo acabou)
//     ganhou     { item, qtd }
//                Só para quem pediu `pegar`: o item é seu. Se não couber
//                tudo no inventário, o resto volta para o chão (`soltar`).
//     aparencia  { id, ap }  a aparência de outro jogador mudou
//     efeito     { de, efeito: { tipo, origem, direcao, fim?, cor?, cadeia?, poder? } }
//                Um jogador (`de` = id) atirou um poder (Fase 5). Só desenhar.
//     poderes    { id, lista }
//                Poderes ativos do jogador `id` (aura). O anfitrião também
//                manda, ao entrar alguém, os poderes de quem já estava na sala.
//     mobs       { t, dados }   (Fase 7, ~10 vezes por segundo)
//                Estado de todos os mobs vivos. `t` = relógio do anfitrião
//                (ms, performance.now) e `dados` = Float32Array com 8 números
//                por mob: [id, tipo, x, y, z, yaw, flags, vida, ...], onde `tipo`
//                é o índice em ORDEM_TIPOS (mobs.js), `vida` vai de 0 a 1 e
//                `flags` tem bits: 1 andando, 2 atacando, 4 queimando, 8 lento,
//                16 subindo parede, 32 no ar, 64 nadando; os bits 8 a 11 são
//                um contador de golpes (quando muda, o mob apanhou: pisca).
//                40 mobs = ~1,3 KB por mensagem. O cliente desenha 100 ms
//                "no passado", andando suave entre duas mensagens.
//     mobNovo    { id, mob, x, y, z, yaw, vida }   (Fase 7)
//                Nasceu um mob. `mob` é o nome do tipo ('porco', 'zumbi'...).
//                (O contrato chamava de `tipo`, mas `tipo` já é o nome da mensagem.)
//     mobRemovido { id, morreu }   (Fase 7)
//                O mob saiu do jogo. `morreu` = true: toca a animação de morte
//                (tomba e fica vermelho); false: some na hora (ficou longe).
//     dano       { qtd, de: [x, y, z], efeito?, segundos? }   (Fase 7; efeito na Fase 8)
//                Só para o jogador atingido: um mob em `de` bateu em você.
//                `qtd` vem SEM o desconto da armadura (quem recebe aplica).
//                `efeito` = 'veneno' | 'lento' | 'fogo' (texto) e `segundos` a
//                duração (sem ela, vale o padrão do config). O Mobs entrega ao
//                jogo como efeito: 'veneno' ou { tipo: 'veneno', segundos: 2 }.
//     xp         { qtd }   (Fase 7) só para quem matou o mob (chefão: todos perto)
//     projetilMob { id, proj, origem: [x, y, z], dir: [x, y, z], alvo?, alvoMob? }   (Fase 8)
//                Um mob atirou. `proj` é o tipo do projétil ('flecha', 'orbe',
//                'bola_fogo', 'gelo', 'veneno', 'cura' ou 'sopro'; o `tipo`
//                de fora é o nome da mensagem). `dir` é a velocidade em blocos/s
//                (no 'sopro', a direção do cone de fogo). `alvo` = id do jogador
//                que o orbe persegue; `alvoMob` = id do orc que a cura procura.
//                Os clientes só DESENHAM: quem acerta e quanto dói é o anfitrião.
//     projetilFim { id, ponto: [x, y, z] }   (Fase 8)
//                O projétil acabou em `ponto` (bateu, acertou ou o tempo
//                acabou). Na nuvem de veneno, `ponto` é o chão onde a nuvem
//                fica por 4 s. O sopro de fogo termina com esta mensagem.
//     luaVermelha { ativa }   (Fase 8)
//                A Lua Vermelha nasceu (true) ou se pôs (false). O anfitrião
//                sorteia 1 em 8 a cada anoitecer; termina ao amanhecer.
//   O `bemvindo` (Fase 7) leva também `mobs: [[id, mob, x, y, z, yaw, vida], ...]`
//   com os mobs que já estão no mundo, e (Fase 8) `luaVermelha` (true/false).
//   O `meuEstado` dentro do bemvindo traz o `xp` guardado (e `xpTotal`, igual,
//   para o jogador.carregar).
//
// PROTOCOLO VERSÃO 4 (Fase 5): acrescentou `efeito` e `poderes`.
// PROTOCOLO VERSÃO 5 (Fase 6): `bloco` com `e`, `blocos` (lote), `bauAbrir`,
//   `bauConteudo`, `bauEspaco`, e o `mods` com 5 números por bloco.
// PROTOCOLO VERSÃO 6 (Fase 7): `mobs`, `mobNovo`, `mobRemovido`, `atacarMob`,
//   `dano`, `xp` e a lista `mobs` no `bemvindo`.
// PROTOCOLO VERSÃO 7 (Fase 8): `projetilMob`, `projetilFim`, `luaVermelha`,
//   `luaVermelha` no `bemvindo`, `xp` no `meuEstado`, `morto` no `pos`,
//   `efeito`/`segundos` (texto) no `dano`, `veneno` no efeito do `atacarMob`
//   e os itens com melhoria (+1 a +5, ex.: 'espada_ferro+2') aceitos em tudo:
//   quem confere os itens agora é o obterItem (items.js), e não o ITENS.has.
//
// PROTOCOLO VERSÃO 8 (Fase 11, montarias e pet):
//   Cliente → anfitrião
//     domar           { id, item }   botão direito com o item de domar (o item já saiu
//                     do inventário; se o anfitrião recusar, ele volta com `ganhou`)
//     montar          { id }         montei na minha montaria (o anfitrião confirma ou
//                     desfaz pelo `donoMob`). Montado, a minha `pos` é a da montaria.
//     desmontar       { }
//     equiparMontaria { id, item }   'sela' ou 'armadura_montaria_*' (o que já estava
//                     volta com `ganhou`)
//     apito           { }            chama as minhas montarias e o pet
//     sentar          { id }         Shift + botão direito no meu cachorro
//     (no máximo 8 pedidos destes por segundo por jogador)
//   Anfitrião → clientes
//     donoMob     { id, dono, sela, arm, mont, sent, novo }   (para todos)
//                 dono = apelido (ou null), arm = 'ferro' | 'ouro' | 'diamante' | null,
//                 mont = id de quem está montado (ou null), sent = o pet está sentado,
//                 novo = acabou de ser domado (corações)
//     domarEstado { id, estado, conf, motivo, mob }   (só para quem está domando)
//                 estado = 'comecou' | 'progresso' | 'domado' | 'falhou' | 'recusado'
//     avisoMob    { texto }   (só para um jogador: "Seu cavalo desmaiou!")
//   O `mobNovo` ganhou `extra` = { v (pelagem), dono, sela, arm, mont, sent } (ou
//   null) e cada mob do `bemvindo` ganhou esse mesmo `extra` no 8º lugar.
//   Os flags do `mobs` ganharam: 17 domado, 18 montado, 19 sentado, 20 desmaiado.
//
// PROTOCOLO VERSÃO 9 (tipo de mundo e Hardcore):
//   O `bemvindo` leva `modoMundo`: 'sobrevivencia' | 'criativo' | 'hardcore'
//   (a escolha do anfitrião, que também vai no save). Quem entra usa o do
//   anfitrião. `rede.modoMundo` guarda o valor (o main define no anfitrião).
//   Hardcore: quem morre fica CAÍDO (o `pos` leva `morto: true`; o corpo
//   aparece deitado para todos) e só volta se outro jogador reanimar.
//   Cliente → anfitrião
//     reanimar   { apelido }
//                "Segurei o botão direito 4 s ao lado do corpo de `apelido`".
//                O anfitrião confere: quem reanima está vivo, o alvo está
//                mesmo caído e a distância entre os dois é de até
//                REANIMAR_DIST (+ REANIMAR_TOLERANCIA de folga da rede).
//                Se valer, manda `reanimado` só para o alvo.
//   Anfitrião → cliente
//     reanimado  { por }
//                "`por` te reanimou": o jogador volta com metade da vida.
//     fimDeJogo  { }
//                Todos os jogadores da sala estão caídos (só o anfitrião decide,
//                em `todosCaidos()`). O mundo Hardcore foi apagado do save.
//   API: rede.reanimar(apelido) (devolve true se o pedido saiu/valeu),
//   rede.aoReanimado(fn(por)), rede.aoFimDeJogo(fn), rede.todosCaidos()
//   e rede.enviarFimDeJogo() (anfitrião).
//
// LUA VERMELHA (Fase 8): o anfitrião (ou quem joga sozinho) sorteia ao
//   anoitecer (1 em 8, CHANCE_LUA_VERMELHA) e manda `luaVermelha`. Todos
//   chamam ceu.definirLuaVermelha e mostram o aviso no chat. Para forçar
//   (testes, comandos): rede.definirLuaVermelha(true) no anfitrião.
//
// MOBS (Fase 7): quem simula é o Mobs (mobs.js) do anfitrião. A Rede só
//   transporta. O Mobs se registra com `rede.registrarMobs(mobs)` (no
//   construtor dele) e usa: enviarEstadoMobs, enviarMobNovo,
//   enviarMobRemovido, enviarDanoJogador, enviarXp, soltarDrop (anfitrião) e
//   enviarAtacarMob (cliente). A Rede chama no Mobs: exportarParaRede,
//   posicaoMob, aplicarAtaqueRemoto (anfitrião) e receberNovo, receberEstado,
//   receberRemovido, receberDanoDaRede, receberXp (cliente).
//   Fase 8: enviarProjetilMob / enviarProjetilFim (anfitrião) → no cliente,
//   mobs.receberProjetil / receberProjetilFim. avisoLocal(texto) mostra um
//   aviso só neste computador (tela + chat). estaMorto(id) diz se o jogador
//   remoto está na tela de morte.
//
// BAÚS (Fase 6): o conteúdo mora no anfitrião (classe Baus, baus.js). A Rede só
//   transporta: `rede.aoBau(fn)` registra o ouvinte do Baus, que recebe
//     { tipo: 'abrir', x, y, z }                → devolve os 27 espaços (ou null)
//     { tipo: 'conteudo', x, y, z, espacos }    (cliente)
//     { tipo: 'espaco', x, y, z, i, valor, antes?, comparar? }
//                → devolve true se aceitou, ou { recusado: true, atual } se
//                  `comparar` e o espaço não era igual a `antes`
//     { tipo: 'recusado', x, y, z, i, antes, valor, atual }   (cliente)
//   e `rede.enviarBauAbrir(x, y, z)` / `rede.enviarBauEspaco(x, y, z, i, valor, antes)`.
//
// ITENS NO CHÃO: o anfitrião é a autoridade
//   Só o anfitrião cria e remove itens no chão (no modo sozinho, é o
//   próprio jogador). Assim dois jogadores nunca pegam o mesmo item: o
//   anfitrião atende os pedidos na ordem em que chegam, e o segundo pedido
//   encontra o item já removido.
//
// CASA (Fase 4)
//   Cada jogador tem uma `casa: [x, y, z]` (comando /setcasa). O cliente a
//   manda no `meuEstado`; o anfitrião guarda em dadosJogadores[apelido].casa
//   (vai no save) e a devolve no `bemvindo`, dentro de `meuEstado`. A casa
//   do próprio anfitrião fica em `rede.casa` (o main grava no save dele).
//
// AVISOS DE SISTEMA (Fase 4)
//   "X entrou no mundo!", "X saiu.", "X mudou para noite" aparecem na tela
//   (ui.mostrarMensagem) E vão para quem se registrar com `rede.aoAviso(fn)`
//   (o main manda para o chat). `fn(texto)`.
//
// SEGURANÇA
//   Tudo o que chega pela rede é conferido (tipos, números finitos, id de
//   bloco existente, y dentro da altura do mundo...). Mensagem estranha é
//   ignorada, sem quebrar o jogo.
//
// Exporta: Rede (contrato do CLAUDE.md), normalizarCodigo
// =====================================================================

import { CONFIG, CICLO_SEGUNDOS } from './config.js';
import { BLOCOS } from './blocks.js';
import { ITENS, obterItem } from './items.js';
import { Equipamento } from './equipamento.js';
import { quantoCabe } from './itens_chao.js';

const PREFIXO_ID = 'hackraft-';
const VERSAO_PROTOCOLO = 9;          // mude quando o formato das mensagens mudar (2 = Fase 3, 3 = Fase 4, 4 = Fase 5, 5 = Fase 6, 6 = Fase 7, 7 = Fase 8, 8 = Fase 11, 9 = tipo de mundo/Hardcore)
const MAX_QTD_ITEM = 64;             // maior pilha aceita numa mensagem de item
const VEL_MAX_ITEM = 20;             // maior velocidade aceita para um item solto
const DIST_SOLTAR = 8;               // o cliente só solta itens até 8 blocos de onde está
const DIST_PEGAR = 6;                // e só pega itens até 6 blocos (folga para o atraso da rede)
const LETRAS_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I/L
const CODIGO_VALIDO = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/;
const TAMANHO_APELIDO = 16;
const LIMITE_COORD = 10000000;       // |x| e |z| aceitos (bem longe!)
const CHAVES_CORES = ['pele', 'cabelo', 'olhos', 'camisa', 'calca', 'sapato'];
const OPCOES_PEER = { debug: 1 };    // 1 = o PeerJS só escreve erros no console

// Erros do PeerJS que impedem de continuar (o resto é só aviso)
const ERROS_FATAIS = new Set([
  'browser-incompatible', 'invalid-id', 'invalid-key', 'network', 'server-error',
  'socket-error', 'socket-closed', 'ssl-unavailable', 'unavailable-id', 'webrtc',
]);

// ---------------------------------------------------------------------
// Funções pequenas de ajuda (conferir o que chega pela rede)
// ---------------------------------------------------------------------

const ehNumero = (v) => typeof v === 'number' && Number.isFinite(v);

function posicaoValida(x, y, z) {
  return ehNumero(x) && ehNumero(y) && ehNumero(z) &&
    Math.abs(x) <= LIMITE_COORD && Math.abs(z) <= LIMITE_COORD && y >= -1000 && y <= 1000;
}

function idDeBlocoValido(id) {
  return Number.isInteger(id) && id >= 0 && id < BLOCOS.length && !!BLOCOS[id];
}

function blocoValido(x, y, z, id) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
    y >= 0 && y < CONFIG.ALTURA_MUNDO &&
    Math.abs(x) <= LIMITE_COORD && Math.abs(z) <= LIMITE_COORD &&
    idDeBlocoValido(id);
}

/** Estado de bloco: inteiro de 0 a 255 (ausente vale 0). Devolve o número ou -1 se inválido. */
function lerEstadoBloco(e) {
  if (e === undefined || e === null) return 0;
  return Number.isInteger(e) && e >= 0 && e <= 255 ? e : -1;
}

/**
 * Lote de blocos vindo da rede, conferido. Devolve [[x, y, z, id, e], ...]
 * ou null se vier algo estranho (lista vazia, grande demais ou entrada inválida).
 */
function lerListaBlocos(lista) {
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > CONFIG.BLOCOS_POR_LOTE_MAX) return null;
  const r = [];
  for (const b of lista) {
    if (!Array.isArray(b) || b.length < 4 || b.length > 5) return null;
    const e = lerEstadoBloco(b[4]);
    if (e < 0 || !blocoValido(b[0], b[1], b[2], b[3])) return null;
    r.push([b[0], b[1], b[2], b[3], e]);
  }
  return r;
}

// ----- Baús (Fase 6) -----
const ESPACOS_BAU = CONFIG.ESPACOS_BAU;

/** Coordenadas inteiras de um baú (mesmas regras de um bloco) */
function posBauValida(x, y, z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
    y >= 0 && y < CONFIG.ALTURA_MUNDO && Math.abs(x) <= LIMITE_COORD && Math.abs(z) <= LIMITE_COORD;
}

/**
 * Um espaço de baú vindo da rede: `{ item, qtd }` ou null (vazio).
 * Devolve undefined se for inválido (nome desconhecido, qtd fora de 1 a 64...).
 */
function lerValorEspaco(item, qtd) {
  if ((item === undefined || item === null) && (qtd === undefined || qtd === null || qtd === 0)) return null;
  if (!itemValido(item) || !qtdValida(qtd)) return undefined;
  if (qtd > obterItem(item).pilha) return undefined;   // maior que a pilha do item
  return { item, qtd };
}

/** Conteúdo completo de um baú (27 posições) conferido, ou null */
function lerEspacosBau(lista) {
  if (!Array.isArray(lista) || lista.length !== ESPACOS_BAU) return null;
  const r = [];
  for (const s of lista) {
    if (s === null) { r.push(null); continue; }
    if (!s || typeof s !== 'object') return null;
    const v = lerValorEspaco(s.item, s.qtd);
    if (v === undefined) return null;
    r.push(v);
  }
  return r;
}

/** Apelido limpo: texto sem caracteres de controle, até 16 letras. Vazio vira "Jogador". */
function limparApelido(v) {
  const t = (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, TAMANHO_APELIDO);
  return t || 'Jogador';
}

/** Só as cores conhecidas, e só se forem textos curtos */
function limparCores(c) {
  const r = {};
  if (!c || typeof c !== 'object') return r;
  for (const k of CHAVES_CORES) {
    if (typeof c[k] === 'string' && c[k].length <= 32) r[k] = c[k];
  }
  return r;
}

/** Texto de chat: só texto, sem caracteres de controle, até CHAT_MAX_CARACTERES. Vazio = '' */
function limparChat(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').trim().slice(0, CONFIG.CHAT_MAX_CARACTERES);
}

/** Casa [x, y, z] conferida, ou null */
function limparCasa(c) {
  if (!Array.isArray(c) || c.length !== 3 || !posicaoValida(c[0], c[1], c[2])) return null;
  return [c[0], c[1], c[2]];
}

/** Texto curto e seguro (para mensagens de erro vindas do anfitrião) */
function textoCurto(v, max = 200) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
}

/** Inventário vindo da rede: mesma forma de Inventario.serializar(), conferida */
function limparInventario(inv) {
  if (!inv || typeof inv !== 'object' || !Array.isArray(inv.espacos)) return null;
  const espacos = [];
  const n = Math.min(inv.espacos.length, CONFIG.ESPACOS_INVENTARIO);
  for (let i = 0; i < n; i++) {
    const s = inv.espacos[i];
    if (s && typeof s === 'object' && itemValido(s.item) &&
        Number.isInteger(s.qtd) && s.qtd > 0 && s.qtd <= 9999) {
      espacos.push({ item: s.item, qtd: s.qtd });
    } else {
      espacos.push(null);
    }
  }
  const sel = inv.selecionado;
  const selecionado = Number.isInteger(sel) && sel >= 0 && sel < CONFIG.ESPACOS_HOTBAR ? sel : 0;
  return { espacos, selecionado };
}

/**
 * Equipamento vindo da rede ou do save, conferido.
 * Em vez de repetir aqui as regras do equipamento (que item vai em que
 * espaço), deixamos a própria classe Equipamento conferir: carregamos os
 * dados num Equipamento novo (ele ignora o que for inválido) e pegamos o
 * resultado limpo com serializar().
 */
function limparEquipamento(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  try {
    const eq = new Equipamento();
    eq.carregar(d);
    return eq.serializar();
  } catch (e) {
    console.warn('Hackraft: equipamento inválido ignorado', e);
    return null;
  }
}

const XP_TOTAL_MAX = 1e9;            // XP total aceito no meuEstado / save

/** XP total conferido: inteiro de 0 a XP_TOTAL_MAX (aceita `xp` ou o `xpTotal` do jogador.serializar) */
function lerXpTotal(e) {
  const v = ehNumero(e.xp) ? e.xp : (ehNumero(e.xpTotal) ? e.xpTotal : 0);
  return v > 0 ? Math.min(XP_TOTAL_MAX, Math.floor(v)) : 0;
}

/**
 * Nível a partir do XP total (mesma conta do player.js: para sair do nível
 * n são precisos floor(XP_BASE × n^XP_EXPOENTE) pontos). Usado só para o
 * teto do dano dos golpes.
 */
function nivelPorXp(xp) {
  const base = CONFIG.XP_BASE ?? 40, exp = CONFIG.XP_EXPOENTE ?? 1.4;
  let n = 1, resto = xp;
  while (n < 999) {
    const precisa = Math.floor(base * Math.pow(n, exp));
    if (!(precisa > 0) || resto < precisa) break;
    resto -= precisa;
    n++;
  }
  return n;
}

/** { pos, yaw, pitch, inventario, equipamento, casa, xp, xpTotal } conferido, ou null */
function limparEstadoJogador(e) {
  if (!e || typeof e !== 'object') return null;
  const p = e.pos;
  if (!Array.isArray(p) || p.length !== 3 || !posicaoValida(p[0], p[1], p[2])) return null;
  const xp = lerXpTotal(e);
  return {
    pos: [p[0], p[1], p[2]],
    yaw: ehNumero(e.yaw) ? e.yaw : 0,
    pitch: ehNumero(e.pitch) ? e.pitch : 0,
    inventario: limparInventario(e.inventario),
    equipamento: limparEquipamento(e.equipamento),
    casa: limparCasa(e.casa),
    // Fase 8: o XP vai junto. `xpTotal` (igual) é o nome que o jogador.carregar lê.
    xp,
    xpTotal: xp,
  };
}

// ----- Itens (Fase 3) -----

/**
 * O nome é de um item que existe? Usa o obterItem, que também entende os
 * itens melhorados da Fase 9 ('espada_ferro+2'), que não estão na lista ITENS.
 */
function itemValido(nome) {
  return typeof nome === 'string' && nome.length <= 40 && !!obterItem(nome);
}

/** Quantidade inteira de 1 a 64 */
function qtdValida(q) {
  return Number.isInteger(q) && q >= 1 && q <= MAX_QTD_ITEM;
}

/** Id de item no chão: inteiro positivo (quem cria é o anfitrião) */
function idItemValido(id) {
  return Number.isInteger(id) && id >= 0 && id <= 0x7fffffff;
}

/** Velocidade conferida: número finito e não muito grande (senão 0) */
function velocidadeItem(v) {
  if (!ehNumero(v)) return 0;
  return v > VEL_MAX_ITEM ? VEL_MAX_ITEM : (v < -VEL_MAX_ITEM ? -VEL_MAX_ITEM : v);
}

/** Item no chão vindo da rede (mensagem itemNovo), conferido, ou null */
function lerItemNovo(m) {
  if (!m || typeof m !== 'object') return null;
  if (!idItemValido(m.id) || !itemValido(m.item) || !qtdValida(m.qtd) || !posicaoValida(m.x, m.y, m.z)) return null;
  return {
    id: m.id, item: m.item, qtd: m.qtd,
    x: m.x, y: m.y, z: m.z,
    vx: velocidadeItem(m.vx), vy: velocidadeItem(m.vy), vz: velocidadeItem(m.vz),
    de: typeof m.de === 'string' && m.de.length <= 100 ? m.de : '',
  };
}

// ----- Aparência (Fase 3) -----

// Os nomes de visual e de material que existem, tirados da lista de itens.
// Calculado só quando a lista de itens muda de tamanho.
let visuais = null;
let tamanhoItensVisto = -1;
function visuaisConhecidos() {
  if (visuais && tamanhoItensVisto === ITENS.size) return visuais;
  visuais = { roupa: new Set(), mao: new Set(), acessorio: new Set(), material: new Set() };
  for (const def of ITENS.values()) {
    if (!def) continue;
    if (typeof def.visual === 'string') {
      visuais.mao.add(def.visual); // na mão pode ir qualquer coisa que tenha visual
      if (def.tipo === 'roupa') visuais.roupa.add(def.visual);
      if (def.tipo === 'acessorio') visuais.acessorio.add(def.visual);
    }
    if (def.tipo === 'armadura' && typeof def.material === 'string') visuais.material.add(def.material);
  }
  tamanhoItensVisto = ITENS.size;
  return visuais;
}

/**
 * Aparência completa conferida: { cores, roupa, armadura: { capacete,
 * peitoral, calca, botas }, mao, acessorio }. Nome desconhecido vira null.
 */
function limparAparencia(ap) {
  if (!ap || typeof ap !== 'object') return null;
  const v = visuaisConhecidos();
  const nome = (x, conjunto) => (typeof x === 'string' && x.length <= 40 && conjunto.has(x) ? x : null);
  // Armadura melhorada (Fase 9) vem como 'ferro+2': confere o material sem o sufixo
  const material = (x) => (typeof x === 'string' && x.length <= 40 &&
    v.material.has(x.replace(/\+[1-5]$/, '')) ? x : null);
  // Na mão vem o NOME do item (com sufixo, ex.: 'espada_ferro+2'): vale se o item tiver visual
  const mao = (x) => {
    if (nome(x, v.mao)) return x;
    const def = typeof x === 'string' && x.length <= 40 ? obterItem(x) : null;
    return def && typeof def.visual === 'string' ? x : null;
  };
  const a = ap.armadura && typeof ap.armadura === 'object' ? ap.armadura : {};
  return {
    cores: limparCores(ap.cores),
    roupa: nome(ap.roupa, v.roupa),
    armadura: {
      capacete: material(a.capacete),
      peitoral: material(a.peitoral),
      calca: material(a.calca),
      botas: material(a.botas),
    },
    mao: mao(ap.mao),
    acessorio: nome(ap.acessorio, v.acessorio),
  };
}

// ----- Efeitos e poderes (Fase 5) -----
const PODERES_POR_SEGUNDO_MAX = 4;   // mensagens "poderes" aceitas por jogador, por segundo

const TIPOS_EFEITO = new Set(['fogo', 'raio', 'gelo', 'poder', 'meteoro']);
const MAX_CADEIA = 3;                // pontos de salto do raio
const LIMITE_VETOR = 1000;           // direção/componentes aceitos em módulo (a direção é ~1)

/** Vetor { x, y, z } ou [x, y, z] com números finitos (limite de módulo `max`). Devolve cópia no mesmo formato, ou null. */
function limparVetor(v, max) {
  let x, y, z, lista = false;
  if (Array.isArray(v) && v.length === 3) { x = v[0]; y = v[1]; z = v[2]; lista = true; }
  else if (v && typeof v === 'object') { x = v.x; y = v.y; z = v.z; }
  else return null;
  if (!ehNumero(x) || !ehNumero(y) || !ehNumero(z)) return null;
  if (Math.abs(x) > max || Math.abs(y) > max || Math.abs(z) > max) return null;
  return lista ? [x, y, z] : { x, y, z };
}

/** Posição no mundo { x, y, z } (ou lista) conferida, ou null */
function limparPontoMundo(v) {
  const r = limparVetor(v, LIMITE_COORD);
  if (!r) return null;
  const x = Array.isArray(r) ? r[0] : r.x;
  const y = Array.isArray(r) ? r[1] : r.y;
  const z = Array.isArray(r) ? r[2] : r.z;
  return posicaoValida(x, y, z) ? r : null;
}

/** Cor de efeito: só texto "#rrggbb"; qualquer outra coisa é descartada (undefined) */
function limparCorEfeito(c) {
  if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return undefined;
}

/** Efeito vindo da rede (ou do jogo local) conferido, ou null */
function limparEfeito(m) {
  if (!m || typeof m !== 'object' || !TIPOS_EFEITO.has(m.tipo)) return null;
  const origem = limparPontoMundo(m.origem);
  const direcao = limparVetor(m.direcao, LIMITE_VETOR);
  if (!origem || !direcao) return null;
  const e = { tipo: m.tipo, origem, direcao };
  if (m.fim !== undefined && m.fim !== null) {
    const fim = limparPontoMundo(m.fim);
    if (!fim) return null;
    e.fim = fim;
  }
  if (m.cadeia !== undefined && m.cadeia !== null) {
    if (!Array.isArray(m.cadeia) || m.cadeia.length > MAX_CADEIA) return null;
    const cadeia = [];
    for (const pt of m.cadeia) {
      const c = limparPontoMundo(pt);
      if (!c) return null;
      cadeia.push(c);
    }
    e.cadeia = cadeia;
  }
  const cor = limparCorEfeito(m.cor);
  if (cor !== undefined) e.cor = cor;
  if (typeof m.poder === 'string' && m.poder.length <= 32) e.poder = m.poder;
  return e;
}

// Nomes de poderes que existem (tirados dos itens de tipo 'poder'); recalculado se a lista de itens mudar
let nomesPoderes = null;
let tamanhoItensPoderes = -1;
function poderesConhecidos() {
  if (nomesPoderes && tamanhoItensPoderes === ITENS.size) return nomesPoderes;
  nomesPoderes = new Set();
  for (const def of ITENS.values()) {
    if (def && def.tipo === 'poder' && typeof def.poder === 'string') nomesPoderes.add(def.poder);
  }
  tamanhoItensPoderes = ITENS.size;
  return nomesPoderes;
}

/** Lista de poderes ativos conferida: só nomes que existem, sem repetir, no máximo MAX_PODERES_REDE */
function limparListaPoderes(lista) {
  const r = [];
  if (!Array.isArray(lista)) return r;
  const conhecidos = poderesConhecidos();
  const max = CONFIG.MAX_PODERES_REDE;
  for (const nome of lista.slice(0, 64)) {
    if (typeof nome !== 'string' || nome.length > 32 || r.includes(nome)) continue;
    // Sem itens de poder registrados (não deveria acontecer): aceita nome em formato seguro
    const ok = conhecidos.size > 0 ? conhecidos.has(nome) : /^[a-z_]+$/.test(nome);
    if (ok) r.push(nome);
    if (r.length >= max) break;
  }
  return r;
}

// ----- Mobs (Fase 7) -----
const CAMPOS_MOB = 8;                // números por mob na mensagem `mobs`
const MAX_MOBS_REDE = 64;            // máximo de mobs aceitos numa mensagem `mobs` / no bemvindo
const ID_MOB_MAX = 16777216;         // 2^24: o maior inteiro que o Float32 guarda sem erro
const DIST_GOLPE_MOB = 6;            // golpe (mão/espada): o alcance é 4; 6 dá folga para o atraso da rede
const DIST_PODER_MOB = 32;           // poderes voam até 30 blocos
const GOLPES_MOB_POR_SEGUNDO = 3;    // a espada bate a cada 0,5 s (2 por segundo): 3 dá folga
const PODERES_MOB_POR_SEGUNDO = 12;  // o raio acerta até 3 mobs de uma vez
const TIPOS_ATAQUE_MOB = new Set(['golpe', 'fogo', 'raio', 'gelo']);
// Teto do dano (Fase 8). Golpe: a maior espada (+5) dá 14 + 5 = 19, mais a
// força do nível (nível − 1). Por isso 20 + nível; sem saber o nível, 40.
// Poderes: o dano de cada um no powers.js (fogo 6, raio 8, gelo 3) com folga.
const TETO_GOLPE_BASE = 20;
const TETO_GOLPE_SEM_NIVEL = 40;
const TETO_PODER = { fogo: 9, raio: 12, gelo: 5 };
const DANO_MAX_JOGADOR = 100;        // `dano` aceito pelo cliente
const XP_MAX = 10000;
const EFEITOS_JOGADOR = new Set(['veneno', 'lento', 'fogo']); // efeitos do `dano` (Fase 8)
const SEGUNDOS_MAX_EFEITO = 30;

// ----- Projéteis de mob e Lua Vermelha (Fase 8) -----
const VEL_MAX_PROJETIL = 100;        // componentes de `dir` aceitos (blocos/s)
const CHANCE_LUA_VERMELHA = CONFIG.CHANCE_LUA_VERMELHA ?? 1 / 8; // a cada anoitecer
const TEXTO_LUA_VERMELHA = '🌕 A Lua Vermelha nasceu... cuidado!';
const TEXTO_LUA_SE_POS = 'A Lua Vermelha se pôs. Ufa!';

/** Id de mob: inteiro de 1 a 2^24 */
function idMobValido(id) {
  return Number.isInteger(id) && id >= 1 && id < ID_MOB_MAX;
}

/** Nome do tipo de mob: só letras minúsculas e _ (quem confere se existe é o mobs.js) */
function nomeMobValido(n) {
  return typeof n === 'string' && n.length >= 1 && n.length <= 32 && /^[a-z_0-9]+$/.test(n);
}

/**
 * Efeito de ataque num mob: { queimar?, lento?, veneno? } com segundos de 0 a
 * 10, ou null. Aceita também o texto da arma ('fogo' = queimar 3 s, 'veneno' = 3 s).
 */
function lerEfeitoMob(e) {
  if (e === 'fogo') return { queimar: 3 };
  if (e === 'veneno') return { veneno: 3 };
  if (!e || typeof e !== 'object') return null;
  const r = {};
  let tem = false;
  if (ehNumero(e.queimar) && e.queimar > 0) { r.queimar = Math.min(10, e.queimar); tem = true; }
  if (ehNumero(e.lento) && e.lento > 0) { r.lento = Math.min(10, e.lento); tem = true; }
  if (ehNumero(e.veneno) && e.veneno > 0) { r.veneno = Math.min(10, e.veneno); tem = true; }
  return tem ? r : null;
}

/** Efeito no jogador ('veneno' | 'lento' | 'fogo') ou null. Aceita o texto ou { tipo }. */
function lerEfeitoJogador(e) {
  const t = e && typeof e === 'object' ? e.tipo : e;
  return typeof t === 'string' && EFEITOS_JOGADOR.has(t) ? t : null;
}

/** Duração de um efeito: número de 0 a 30 s, ou 0 (= "use o padrão") */
function lerSegundosEfeito(s) {
  return ehNumero(s) && s > 0 ? Math.min(SEGUNDOS_MAX_EFEITO, s) : 0;
}

/** Float32Array vindo da rede (ArrayBuffer ou view) com múltiplo de 8 números, ou null */
function lerEstadoMobs(dados) {
  let f = null;
  if (dados instanceof ArrayBuffer) {
    if (dados.byteLength % 4 !== 0) return null;
    f = new Float32Array(dados);
  } else if (ArrayBuffer.isView(dados)) {
    if (dados.byteLength % 4 !== 0) return null;
    // copia: o Float32Array precisa começar num múltiplo de 4 bytes
    f = new Float32Array(dados.buffer.slice(dados.byteOffset, dados.byteOffset + dados.byteLength));
  } else if (Array.isArray(dados)) {
    f = Float32Array.from(dados);
  } else {
    return null;
  }
  if (f.length % CAMPOS_MOB !== 0 || f.length > MAX_MOBS_REDE * CAMPOS_MOB) return null;
  return f;
}

/** Mob novo (mensagem mobNovo ou item da lista do bemvindo) conferido, ou null */
function lerMobNovo(id, mob, x, y, z, yaw, vida, extra = null) {
  if (!idMobValido(id) || !nomeMobValido(mob) || !posicaoValida(x, y, z)) return null;
  return {
    id, mob, x, y, z,
    yaw: ehNumero(yaw) ? yaw : 0,
    vida: ehNumero(vida) ? Math.min(1, Math.max(0, vida)) : 1,
    extra: lerExtraMob(extra),
  };
}

const MATERIAIS_MONTARIA = new Set(['ferro', 'ouro', 'diamante']);
const PEDIDOS_MONTARIA_POR_SEGUNDO = 8;

/**
 * (Fase 11) Dono, sela, armadura, cavaleiro e pelagem de um mob, conferidos:
 * { v, dono, sela, arm, mont, sent, novo } ou null.
 */
function lerExtraMob(e) {
  if (!e || typeof e !== 'object') return null;
  return {
    v: Number.isInteger(e.v) && e.v >= 0 && e.v < 16 ? e.v : 0,
    dono: typeof e.dono === 'string' && e.dono.length >= 1 && e.dono.length <= 40 ? e.dono : null,
    sela: e.sela === true,
    arm: typeof e.arm === 'string' && MATERIAIS_MONTARIA.has(e.arm) ? e.arm : null,
    mont: typeof e.mont === 'string' && e.mont.length >= 1 && e.mont.length <= 100 ? e.mont : null,
    sent: e.sent === true,
    novo: e.novo === true,
  };
}

/** Objeto de estado (posição) reaproveitado para cada jogador */
function novoEstado() {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, noAr: false, quebrando: false, morto: false, planando: false, nadando: false };
}

/**
 * Copia uma posição recebida (m) para `destino`, se for válida.
 * Não cria objetos novos: é chamada muitas vezes por segundo.
 */
function lerEstado(m, destino) {
  if (!m || typeof m !== 'object') return false;
  const x = m.x, y = m.y, z = m.z, yaw = m.yaw, pitch = m.pitch;
  if (!posicaoValida(x, y, z) || !ehNumero(yaw) || !ehNumero(pitch)) return false;
  destino.x = x; destino.y = y; destino.z = z;
  destino.yaw = yaw; destino.pitch = pitch;
  destino.noAr = m.noAr === true;
  destino.quebrando = m.quebrando === true;
  destino.morto = m.morto === true;
  destino.planando = m.planando === true;
  destino.nadando = m.nadando === true;
  return true;
}

/** Código novo de 5 letras/números (sorteio comum: não é geração do mundo) */
function gerarCodigo() {
  const n = LETRAS_CODIGO.length;
  const bytes = new Uint8Array(5);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 5; i++) bytes[i] = Math.floor(Math.random() * 256);
  let c = '';
  for (let i = 0; i < 5; i++) c += LETRAS_CODIGO[bytes[i] % n];
  return c;
}

/** Aceita "abc de", " ABCDE " etc.: maiúsculas e só letras/números */
export function normalizarCodigo(texto) {
  return String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Erro com uma mensagem em português (a tela inicial mostra `message`) */
function erroRede(mensagem, tipo = 'rede') {
  const e = new Error(mensagem);
  e.tipo = tipo;
  return e;
}

/** Traduz um erro do PeerJS para uma mensagem simples */
function traduzirErro(err) {
  const tipo = err && err.type;
  switch (tipo) {
    case 'peer-unavailable':
      return erroRede('Sala não encontrada. Confira o código.', tipo);
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return erroRede('Sem conexão com a internet.', tipo);
    case 'browser-incompatible':
      return erroRede('Este navegador não tem multiplayer. Use o Chrome, o Edge ou o Firefox atualizado.', tipo);
    case 'unavailable-id':
      return erroRede('Esse código de sala já está em uso.', tipo);
    case 'webrtc':
    case 'negotiation-failed':
      return erroRede('Não deu para ligar os dois computadores. Tente de novo.', tipo);
    default:
      return erroRede('Não foi possível conectar. Tente de novo.', tipo || 'rede');
  }
}

// Quantos números cada bloco ocupa no lote `mods`: x, y, z, id, estado
const NUMEROS_POR_BLOCO = 5;

/**
 * Transforma a lista de modificações do mundo ([[x, y, z, id, estado], ...])
 * num Int32Array [x, y, z, id, estado, x, y, z, id, estado, ...]. É bem menor
 * e mais rápido de mandar do que uma lista de listas.
 */
function modificacoesEmInt32(lista) {
  const plano = new Int32Array(lista.length * NUMEROS_POR_BLOCO);
  let i = 0;
  for (const m of lista) {
    plano[i] = m[0];
    plano[i + 1] = m[1];
    plano[i + 2] = m[2];
    plano[i + 3] = m[3];
    plano[i + 4] = m[4] | 0; // lista antiga de 4 posições: estado 0
    i += NUMEROS_POR_BLOCO;
  }
  return plano;
}

/** Lê um lote recebido (ArrayBuffer, Int32Array ou lista comum) como lista de números */
function lerLote(dados) {
  if (dados instanceof ArrayBuffer) {
    return dados.byteLength % 4 === 0 ? new Int32Array(dados) : null;
  }
  if (ArrayBuffer.isView(dados)) {
    if (dados.byteLength % 4 !== 0) return null;
    // copia para um buffer novo (o Int32Array precisa começar num múltiplo de 4)
    return new Int32Array(dados.buffer.slice(dados.byteOffset, dados.byteOffset + dados.byteLength));
  }
  if (Array.isArray(dados)) return dados;
  return null;
}

// =====================================================================
// REDE
// =====================================================================

export class Rede {
  /**
   * @param opcoes { apelido, cores }
   *   `cores` (opcional) são as cores do boneco deste jogador, mandadas no
   *   `ola` (o cliente precisa delas antes de o mundo existir).
   */
  constructor({ apelido, cores } = {}) {
    this.apelido = limparApelido(apelido);
    this._apelidoPedido = this.apelido; // o anfitrião pode trocar ("Pai" → "Pai 2")
    this.cores = limparCores(cores);
    this.modo = 'sozinho';   // 'sozinho' | 'anfitriao' | 'cliente'
    this.codigo = null;
    this.meuId = null;

    this.peer = null;
    this.ligado = false;     // ligar() já foi chamado?
    this.encerrado = false;

    // Peças do jogo (chegam em ligar)
    this.mundo = null;
    this.ceu = null;
    this.jogador = null;
    this.inventario = null;
    this.remotos = null;
    this.ui = null;
    this.equipamento = null;
    this.itensChao = null;
    this.poderes = null;              // Poderes (Fase 5)
    this._meusPoderes = [];           // lista de poderes ativos em mim (a última enviada)
    this._efIni = 0;                  // limite de efeitos que EU mando (início da janela de 1 s)
    this._efN = 0;
    this._aoPegarItem = null;         // fn(item, qtd): o jogador local ganhou um item do chão

    // Minha aparência completa (Fase 3). Vai no bemvindo (anfitrião) ou na
    // mensagem `aparencia` (todos), sempre que mudar.
    this.aparencia = null;
    this.casa = null;                 // [x, y, z] da minha casa (/setcasa), ou null
    this._ouvintesChat = [];          // fn({ de, apelido, texto })
    this._ouvintesAviso = [];         // fn(texto)
    this._aparenciaPendente = false;  // mudou e ainda não foi mandada
    this._tempoAparencia = 0;

    // --- Anfitrião ---
    this.clientes = new Map();        // id do PeerJS → dados do cliente
    this.dadosJogadores = new Map();  // apelido → { pos, yaw, pitch, inventario }
    this._tentativasReconexao = 0;
    this._timerReconexao = null;
    this._avisouServidor = false;

    // --- Cliente ---
    this.conexaoAnfitriao = null;
    this.jogadores = new Map();       // id → { id, apelido, cores, anfitriao, estado, temEstado } (inclui você)
    this._entrada = null;             // promessa de entrarNaSala em andamento
    this._recebendo = null;           // bemvindo + lotes chegando
    this._blocosAntesDeLigar = [];    // blocos que chegaram enquanto o mundo era montado ([x, y, z, id, e, de])
    this._ouvintesBau = [];           // fn(ev) do Baus (Fase 6)
    this._horaPendente = null;
    this._pendentes = new Map();      // "x,y,z" → quantas mudanças minhas o anfitrião ainda não confirmou
    this._itensPendentes = new Map(); // itens no chão que chegaram enquanto o mundo era montado (id → dados)
    this._estadoLogo = false;         // pegou/soltou item: manda o meuEstado em ~1 s
    this._ultimaMsgAnfitriao = 0;
    this._caiu = false;
    this._ouvintesDesconectar = [];
    this.modoMundo = 'sobrevivencia'; // 'sobrevivencia' | 'criativo' | 'hardcore' (o main define no anfitrião)
    this._ouvintesReanimado = [];     // fn(por): fui reanimado
    this._ouvintesFimDeJogo = [];     // fn(): fim de jogo (Hardcore)

    // --- Envio periódico (quando foi o último envio, em performance.now) ---
    this._tempoPos = 0;
    this._tempoHora = 0;
    this._tempoEstado = 0;
    this._ultimoEnvioPos = -Infinity;
    // Mensagens reaproveitadas (o loop do jogo não cria objetos novos)
    this._msgPos = { tipo: 'pos', id: '', x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, noAr: false, quebrando: false, morto: false, planando: false, nadando: false };
    this._msgHora = { tipo: 'hora', hora: 0 };
    this._relogio = null;

    // --- Mobs (Fase 7) ---
    this.mobs = null;                 // Mobs (mobs.js): se registra com registrarMobs()
    this._mobsPendentes = new Map();  // (cliente) mobs que chegaram antes de o Mobs existir: id → dados
    this._msgMobs = { tipo: 'mobs', t: 0, dados: null }; // mensagem reaproveitada (anfitrião)

    // --- Lua Vermelha (Fase 8) ---
    this.luaVermelha = false;         // está acontecendo agora?
    this._eraNoite = null;            // (anfitrião/sozinho) noite no quadro anterior: para perceber o anoitecer
    this._luaPendente = null;         // (cliente) chegou antes de o céu existir

    // --- Montarias (Fase 11) ---
    this.autorBloco = null;           // (anfitrião) apelido de quem mandou o bloco que está sendo aplicado agora

    this._cancelarOuvinteBloco = null;
    this._aoFecharPagina = null;
    this._aoMudarVisibilidade = null;
    this._disseTchau = false;
  }

  // ------------------------------------------------------------------
  // Informações
  // ------------------------------------------------------------------

  /** Quantos jogadores estão na sala (contando você) */
  get quantidadeJogadores() {
    if (this.modo === 'anfitriao') {
      let n = 1;
      for (const c of this.clientes.values()) if (c.pronto) n++;
      return n;
    }
    if (this.modo === 'cliente') return this.jogadores.size;
    return 1;
  }

  /** [{ id, apelido, anfitriao }] de todos na sala, incluindo você */
  listaJogadores() {
    if (this.modo === 'anfitriao') {
      const lista = [{ id: this.meuId, apelido: this.apelido, anfitriao: true }];
      for (const c of this.clientes.values()) {
        if (c.pronto) lista.push({ id: c.id, apelido: c.apelido, anfitriao: false });
      }
      return lista;
    }
    if (this.modo === 'cliente') {
      const lista = [];
      for (const j of this.jogadores.values()) lista.push({ id: j.id, apelido: j.apelido, anfitriao: j.anfitriao });
      return lista;
    }
    return [{ id: this.meuId || 'local', apelido: this.apelido, anfitriao: true }];
  }

  // ------------------------------------------------------------------
  // Abrir o PeerJS
  // ------------------------------------------------------------------

  _verificarDisponivel() {
    if (typeof window.Peer !== 'function') {
      throw erroRede('Não foi possível carregar o multiplayer (PeerJS). Confira a internet.', 'sem-peerjs');
    }
    if (navigator.onLine === false) throw erroRede('Sem conexão com a internet.', 'offline');
  }

  /**
   * Cria um Peer e espera ele se registrar no servidor.
   * `id` = nome desejado (anfitrião) ou null (cliente: o servidor sorteia um).
   * Resolve com o Peer; rejeita com um erro em português.
   */
  _abrirPeer(id) {
    return new Promise((resolve, reject) => {
      let peer;
      try {
        peer = new window.Peer(id || undefined, OPCOES_PEER);
      } catch (e) {
        reject(erroRede('Não foi possível iniciar o multiplayer.', 'peer'));
        return;
      }
      let terminou = false;
      const terminar = (erro) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(timer);
        peer.off('open', aoAbrir);
        peer.off('error', aoErro);
        if (erro) {
          try { peer.destroy(); } catch (e) { /* já estava fechado */ }
          reject(erro);
        } else {
          resolve(peer);
        }
      };
      const aoAbrir = () => terminar(null);
      const aoErro = (err) => terminar(traduzirErro(err));
      const timer = setTimeout(() => terminar(erroRede(
        'O servidor do multiplayer não respondeu. Confira a internet.', 'tempo')),
      CONFIG.TEMPO_LIMITE_CONEXAO_S * 1000);
      peer.on('open', aoAbrir);
      peer.on('error', aoErro);
    });
  }

  // ------------------------------------------------------------------
  // ANFITRIÃO: criar a sala
  // ------------------------------------------------------------------

  /** Registra a sala no servidor e devolve o código. Rejeita se não houver internet. */
  async criarSala() {
    this._verificarDisponivel();
    let ultimoErro = null;
    // Último código usado por este navegador (para a sala manter o código ao recarregar)
    let codigoSalvo = null;
    try {
      const c = normalizarCodigo(localStorage.getItem('hackraft-ultimo-codigo') || '');
      if (c.length === 5) codigoSalvo = c;
    } catch (e) { /* sem localStorage: sorteia um código */ }
    // Tempo total que a reutilização do código antigo pode levar
    const prazoCodigoSalvo = Date.now() + CONFIG.TEMPO_LIMITE_CONEXAO_S * 1000;
    let repeticoesSalvo = 0; // quantas vezes já repetimos o código salvo
    // Se o código sorteado já estiver em uso (raríssimo), sorteia outro
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const usandoSalvo = codigoSalvo !== null;
      const codigo = usandoSalvo ? codigoSalvo : gerarCodigo();
      try {
        const peer = await this._abrirPeer(PREFIXO_ID + codigo);
        if (this.encerrado) {
          peer.destroy();
          throw erroRede('A sala foi fechada.', 'encerrado');
        }
        this.peer = peer;
        this.codigo = codigo;
        this.meuId = peer.id;
        this.modo = 'anfitriao';
        this._msgPos.id = this.meuId;
        peer.on('connection', (conn) => this._novaConexao(conn));
        peer.on('disconnected', () => this._servidorCaiu());
        peer.on('open', () => this._servidorVoltou()); // só dispara de novo após reconectar
        peer.on('error', (err) => this._erroDoPeer(err));
        try { localStorage.setItem('hackraft-ultimo-codigo', codigo); } catch (e) { /* ignora */ }
        return codigo;
      } catch (erro) {
        ultimoErro = erro;
        if (erro.tipo !== 'unavailable-id') break;
        if (usandoSalvo) {
          // O servidor ainda não liberou o id antigo: espera um pouco e repete (até 2 vezes)
          if (repeticoesSalvo < 2 && Date.now() + 1500 < prazoCodigoSalvo) {
            repeticoesSalvo++;
            tentativa--; // não gasta uma das 5 tentativas de sorteio
            await new Promise((ok) => setTimeout(ok, 1500));
            if (this.encerrado) throw erroRede('A sala foi fechada.', 'encerrado');
          } else {
            codigoSalvo = null; // desiste e sorteia um código novo
          }
        }
      }
    }
    throw ultimoErro || erroRede('Não foi possível criar a sala.');
  }

  /**
   * O anfitrião perdeu o servidor do PeerJS (internet piscou, servidor
   * reiniciou...). As conexões já abertas CONTINUAM funcionando (são
   * diretas), mas ninguém novo consegue entrar. Tentamos reconectar com
   * esperas cada vez maiores (2 s, 4 s, 8 s... até 30 s).
   */
  _servidorCaiu() {
    if (this.encerrado || !this.peer || this.peer.destroyed) return;
    if (!this._avisouServidor) {
      this._avisouServidor = true;
      console.warn('Hackraft: conexão com o servidor do PeerJS caiu; tentando reconectar.');
      if (this.ui) this.ui.mostrarMensagem('Sem servidor: ninguém novo consegue entrar agora. Tentando de novo...');
    }
    if (this._timerReconexao) return;
    const espera = Math.min(30000, 2000 * 2 ** this._tentativasReconexao);
    this._tentativasReconexao++;
    this._timerReconexao = setTimeout(() => {
      this._timerReconexao = null;
      const peer = this.peer;
      if (this.encerrado || !peer || peer.destroyed || !peer.disconnected) return;
      try {
        peer.reconnect();
      } catch (e) {
        console.warn('Hackraft: falha ao reconectar', e);
        this._servidorCaiu();
      }
    }, espera);
  }

  _servidorVoltou() {
    this._tentativasReconexao = 0;
    if (this._avisouServidor) {
      this._avisouServidor = false;
      console.info('Hackraft: reconectado ao servidor do PeerJS.');
      if (this.ui) this.ui.mostrarMensagem('Servidor de volta: novos jogadores já podem entrar.');
    }
  }

  _erroDoPeer(err) {
    // Os erros que importam já são tratados em outros lugares (disconnected,
    // close da conexão). Aqui só deixamos registrado no console.
    console.warn('Hackraft (rede):', err && err.type, err && err.message);
  }

  // ------------------------------------------------------------------
  // ANFITRIÃO: chegada e saída de clientes
  // ------------------------------------------------------------------

  _novaConexao(conn) {
    if (this.encerrado || this.modo !== 'anfitriao') {
      try { conn.close(); } catch (e) { /* ignora */ }
      return;
    }
    // Mesmo id de novo (muito raro): a conexão velha sai
    const velho = this.clientes.get(conn.peer);
    if (velho) {
      this._clienteSaiu(velho);
      try { velho.conn.close(); } catch (e) { /* ignora */ }
    }
    const agora = performance.now();
    const cli = {
      id: conn.peer,
      conn,
      apelido: '',
      cores: {},
      aparencia: null,        // aparência completa (chega na mensagem `aparencia`)
      pronto: false,          // já mandou o `ola` e recebeu o `bemvindo`
      recusado: false,
      olaPendente: null,      // `ola` que chegou antes de o mundo existir
      estado: novoEstado(),   // última posição recebida
      temEstado: false,
      // mensagem de repasse da posição (reaproveitada)
      msgPos: { tipo: 'pos', id: conn.peer, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, noAr: false, quebrando: false, morto: false, planando: false, nadando: false },
      criadoEm: agora,
      ultimaMsg: agora,
      poderes: [],            // poderes ativos dele (Fase 5)
      efIni: 0,               // limite de efeitos: início da janela de 1 s
      pdIni: 0,               // limite de mensagens "poderes": início da janela de 1 s
      pdN: 0,
      efN: 0,                 // e quantos já passaram nela
      amIni: 0,               // limite de golpes `atacarMob` (Fase 7): início da janela de 1 s
      amN: 0,
      apIni: 0,               // limite de acertos de poder `atacarMob` (Fase 8)
      apN: 0,
      mtIni: 0,               // limite de pedidos de montaria (Fase 11)
      mtN: 0,
    };
    this.clientes.set(cli.id, cli);
    conn.on('data', (msg) => this._dadosDoCliente(cli, msg));
    conn.on('close', () => this._clienteSaiu(cli));
    conn.on('error', (err) => {
      console.warn('Hackraft: erro na conexão com', cli.apelido || cli.id, err && err.type);
      if (!conn.open) this._clienteSaiu(cli);
    });
  }

  /** Mensagem de um cliente. Cada tipo é conferido antes de usar. */
  _dadosDoCliente(cli, msg) {
    if (this.clientes.get(cli.id) !== cli || cli.recusado) return; // já saiu
    if (!msg || typeof msg !== 'object') return;
    cli.ultimaMsg = performance.now();
    try {
      switch (msg.tipo) {
        case 'ola':
          if (cli.pronto || cli.olaPendente) return;
          // O mundo ainda está sendo montado: responde depois, em ligar()
          if (!this.ligado) cli.olaPendente = msg;
          else this._receberOla(cli, msg);
          return;
        case 'pos':
          if (cli.pronto) this._posDoCliente(cli, msg);
          return;
        case 'bloco':
          if (cli.pronto) this._blocoDoCliente(cli, msg);
          return;
        case 'blocos':
          if (cli.pronto) this._blocosDoCliente(cli, msg);
          return;
        case 'bauAbrir':
          if (cli.pronto) this._bauAbrirDoCliente(cli, msg);
          return;
        case 'bauEspaco':
          if (cli.pronto) this._bauEspacoDoCliente(cli, msg);
          return;
        case 'meuEstado':
          if (cli.pronto) {
            const est = limparEstadoJogador(msg);
            if (est) {
              this.dadosJogadores.set(cli.apelido, est);
              // a posição daqui é a mais nova (ex.: mandada ao fechar a página)
              const e = cli.estado;
              e.x = est.pos[0]; e.y = est.pos[1]; e.z = est.pos[2];
              e.yaw = est.yaw; e.pitch = est.pitch;
              cli.temEstado = true;
            }
          }
          return;
        case 'soltar':
          if (cli.pronto) this._soltarDoCliente(cli, msg);
          return;
        case 'pegar':
          if (cli.pronto) this._pegarDoCliente(cli, msg);
          return;
        case 'aparencia':
          if (cli.pronto) this._aparenciaDoCliente(cli, msg);
          return;
        case 'chat':
          if (cli.pronto) this._chatDoCliente(cli, msg);
          return;
        case 'pedirHora':
          if (cli.pronto) this._pedirHoraDoCliente(cli, msg);
          return;
        case 'efeito':
          if (cli.pronto) this._efeitoDoCliente(cli, msg);
          return;
        case 'poderes':
          if (cli.pronto) this._poderesDoCliente(cli, msg);
          return;
        case 'atacarMob':
          if (cli.pronto) this._atacarMobDoCliente(cli, msg);
          return;
        case 'domar':
        case 'montar':
        case 'desmontar':
        case 'equiparMontaria':
        case 'apito':
        case 'sentar':
          if (cli.pronto) this._montariaDoCliente(cli, msg);
          return;
        case 'reanimar':
          if (cli.pronto) this._reanimarDoCliente(cli, msg);
          return;
        case 'tchau':
          this._clienteSaiu(cli);
          try { cli.conn.close(); } catch (e) { /* ignora */ }
          return;
        default:
          return; // tipo desconhecido: ignora
      }
    } catch (e) {
      console.warn('Hackraft: mensagem do cliente ignorada', e);
    }
  }

  /** Manda uma mensagem para todos os clientes que já estão na sala (anfitrião) */
  _avisarTodos(msg, exceto = null) {
    if (this.modo !== 'anfitriao') return;
    for (const c of this.clientes.values()) {
      if (c.pronto && c !== exceto) this._enviar(c.conn, msg);
    }
  }

  /** Um cliente soltou um item: o anfitrião cria e avisa todos (inclusive ele) */
  _soltarDoCliente(cli, m) {
    if (!itemValido(m.item) || !qtdValida(m.qtd) || !posicaoValida(m.x, m.y, m.z)) return;
    let x = m.x, y = m.y, z = m.z;
    // Longe demais de onde o cliente está? Põe o item nos pés dele.
    if (cli.temEstado) {
      const e = cli.estado;
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      if (dx * dx + dy * dy + dz * dz > DIST_SOLTAR * DIST_SOLTAR) {
        x = e.x; y = e.y + 1; z = e.z;
      }
    }
    this._criarItem(m.item, m.qtd, x, y, z,
      velocidadeItem(m.vx), velocidadeItem(m.vy), velocidadeItem(m.vz), cli.id);
  }

  /** Um cliente encostou num item e pediu para pegar */
  _pegarDoCliente(cli, m) {
    if (!this.itensChao || !idItemValido(m.id) || !qtdValida(m.qtd)) return;
    const e = this.itensChao.obter(m.id);
    if (!e) return; // alguém pegou antes (ou o tempo acabou): nada a fazer
    // Ele está mesmo perto? Só dá para conferir se o chunk do item está
    // carregado aqui (senão o item está parado no ar, onde foi solto).
    if (cli.temEstado && this.mundo.estaPronto(e.x, e.z)) {
      const p = cli.estado;
      const dx = e.x - p.x, dy = e.y - (p.y + 0.9), dz = e.z - p.z;
      if (dx * dx + dy * dy + dz * dz > DIST_PEGAR * DIST_PEGAR) return;
    }
    const r = this._entregarItem(m.id, m.qtd);
    if (r) this._enviar(cli.conn, { tipo: 'ganhou', item: r.item, qtd: r.qtd });
  }

  /** Um cliente mudou de roupa/cores: guarda, mostra e repassa para os outros */
  _aparenciaDoCliente(cli, m) {
    const ap = limparAparencia(m.ap);
    if (!ap) return;
    cli.aparencia = ap;
    this._aplicarAparenciaRemota(cli.id, ap);
    this._avisarTodos({ tipo: 'aparencia', id: cli.id, ap }, cli);
  }

  /** Um cliente escreveu no chat: confere e manda para todos (inclusive ele e o anfitrião) */
  _chatDoCliente(cli, msg) {
    const texto = limparChat(msg.texto);
    if (!texto) return;
    // Anti-spam simples: mensagens muito coladas são ignoradas
    const agora = performance.now();
    if (agora - (cli.ultimoChat || 0) < CONFIG.CHAT_INTERVALO_MIN_MS) return;
    cli.ultimoChat = agora;
    this._distribuirChat(cli.id, cli.apelido, texto);
  }

  /** (Anfitrião) Entrega o chat aos ouvintes daqui e manda para todos os clientes */
  _distribuirChat(de, apelido, texto) {
    this._entregarChat({ de, apelido, texto });
    this._avisarTodos({ tipo: 'chat', de, apelido, texto });
  }

  /** Chama os ouvintes de chat (o erro de um ouvinte não atrapalha os outros) */
  _entregarChat(m) {
    for (const fn of this._ouvintesChat) {
      try { fn(m); } catch (e) { console.error(e); }
    }
  }

  /** Um cliente pediu para mudar a hora */
  _pedirHoraDoCliente(cli, msg) {
    if (!ehNumero(msg.hora) || !this.ceu) return;
    this._aplicarHoraDeAlguem(msg.hora, cli.apelido);
  }

  /**
   * (Anfitrião ou sozinho) Muda a hora do céu, avisa na tela/chat e manda
   * `hora` (com `por`) para todos os clientes na hora.
   */
  _aplicarHoraDeAlguem(hora, apelido) {
    const C = CICLO_SEGUNDOS;
    const h = ((hora % C) + C) % C;
    this.ceu.definirHora(h);
    this._aviso(apelido + ' mudou para ' + (h < CONFIG.DIA_SEGUNDOS ? 'dia' : 'noite'));
    this._avisarTodos({ tipo: 'hora', hora: this.ceu.hora, por: apelido });
    this._tempoHora = performance.now(); // a próxima hora automática só daqui a 5 s
  }

  /**
   * Deixa passar no máximo EFEITOS_POR_SEGUNDO_MAX efeitos por segundo.
   * `dono` é o cliente (campos efIni/efN) ou a própria rede (_efIni/_efN).
   */
  _efeitoPermitido(dono, chaveIni, chaveN, limite = CONFIG.EFEITOS_POR_SEGUNDO_MAX) {
    const agora = performance.now();
    if (agora - dono[chaveIni] >= 1000) {
      dono[chaveIni] = agora;
      dono[chaveN] = 0;
    }
    if (dono[chaveN] >= limite) return false;
    dono[chaveN]++;
    return true;
  }

  /** Um cliente atirou um poder: confere, mostra aqui e repassa para os outros */
  _efeitoDoCliente(cli, msg) {
    const e = limparEfeito(msg.efeito);
    if (!e || !this._efeitoPermitido(cli, 'efIni', 'efN')) return;
    this._mostrarEfeito(e);
    this._avisarTodos({ tipo: 'efeito', de: cli.id, efeito: e }, cli);
  }

  /** Um cliente mudou os poderes ativos: guarda, mostra a aura aqui e repassa */
  _poderesDoCliente(cli, msg) {
    if (!this._efeitoPermitido(cli, 'pdIni', 'pdN', PODERES_POR_SEGUNDO_MAX)) return;
    const lista = limparListaPoderes(msg.lista);
    cli.poderes = lista;
    this._definirPoderesRemotos(cli.id, lista);
    this._avisarTodos({ tipo: 'poderes', id: cli.id, lista }, cli);
  }

  /**
   * Um cliente bateu num mob (Fase 7). Tudo é conferido aqui antes de o
   * Mobs aplicar: o mob existe e está vivo, o dano é razoável, o jogador
   * está perto o bastante e não está mandando ataques demais.
   */
  _atacarMobDoCliente(cli, m) {
    const mobs = this.mobs;
    if (!mobs || !idMobValido(m.id) || !ehNumero(m.dano) || m.dano <= 0) return;
    const ataque = TIPOS_ATAQUE_MOB.has(m.ataque) ? m.ataque : 'golpe';
    if (!cli.temEstado) return; // ainda não sabemos onde ele está
    // Quantos por segundo: golpes e poderes têm limites separados
    if (ataque === 'golpe') {
      if (!this._efeitoPermitido(cli, 'amIni', 'amN', GOLPES_MOB_POR_SEGUNDO)) return;
    } else if (!this._efeitoPermitido(cli, 'apIni', 'apN', PODERES_MOB_POR_SEGUNDO)) {
      return;
    }
    // Dano acima do teto é cortado (e não recusado): o XP que guardamos do
    // jogador pode estar uns segundos atrasado depois de subir de nível
    const dano = Math.min(m.dano, this._tetoDanoMob(cli, ataque));
    const p = typeof mobs.posicaoMob === 'function' ? mobs.posicaoMob(m.id) : null; // centro do corpo
    if (!p) return; // não existe (ou já está morrendo)
    // Distância dos olhos do jogador até o centro do mob (mobs grandes, como o
    // dragão, ganham a folga do próprio raio: dá para bater na asa)
    const e = cli.estado;
    const dx = p.x - e.x, dy = p.y - (e.y + CONFIG.ALTURA_OLHOS), dz = p.z - e.z;
    const max = (ataque === 'golpe' ? DIST_GOLPE_MOB : DIST_PODER_MOB) + (ehNumero(p.raio) ? Math.min(4, p.raio) : 0);
    if (dx * dx + dy * dy + dz * dz > max * max) return;
    const dir = limparVetor(m.dir, LIMITE_VETOR); // { x, y, z } ou [x, y, z] (ou null)
    const d = Array.isArray(dir) ? { x: dir[0], y: dir[1], z: dir[2] } : dir;
    mobs.aplicarAtaqueRemoto(cli.id, m.id, dano, d, ataque, lerEfeitoMob(m.efeito));
  }

  /** Maior dano aceito de um ataque do cliente (veja TETO_GOLPE_BASE e TETO_PODER) */
  _tetoDanoMob(cli, ataque) {
    if (ataque !== 'golpe') return TETO_PODER[ataque] ?? 8;
    const d = this.dadosJogadores.get(cli.apelido);
    if (d && ehNumero(d.xp)) return TETO_GOLPE_BASE + nivelPorXp(d.xp);
    return TETO_GOLPE_SEM_NIVEL;
  }

  /** Desenha o efeito de outro jogador (se o módulo de poderes existir) */
  _mostrarEfeito(e) {
    const p = this.poderes;
    if (!p || typeof p.receberEfeitoRemoto !== 'function') return;
    try { p.receberEfeitoRemoto(e); } catch (err) { console.warn('Hackraft: efeito remoto falhou', err); }
  }

  /** Mostra a aura de poderes de outro jogador */
  _definirPoderesRemotos(id, lista) {
    const p = this.poderes;
    if (!p || typeof p.definirPoderesRemotos !== 'function') return;
    try { p.definirPoderesRemotos(id, lista); } catch (err) { console.warn('Hackraft: aura remota falhou', err); }
  }

  _recusar(cli, motivo) {
    cli.recusado = true;
    this._enviar(cli.conn, { tipo: 'recusado', motivo });
    // Dá um tempinho para a mensagem chegar antes de fechar
    setTimeout(() => {
      try { cli.conn.close(); } catch (e) { /* ignora */ }
      if (this.clientes.get(cli.id) === cli) this.clientes.delete(cli.id);
    }, 1500);
  }

  /** Apelido sem repetir: "Pai" já existe → "Pai 2", "Pai 3"... */
  _apelidoUnico(base) {
    const usados = new Set([this.apelido.toLowerCase()]);
    for (const c of this.clientes.values()) if (c.pronto) usados.add(c.apelido.toLowerCase());
    if (!usados.has(base.toLowerCase())) return base;
    for (let n = 2; n < 1000; n++) {
      const sufixo = ' ' + n;
      const nome = base.slice(0, TAMANHO_APELIDO - sufixo.length).trimEnd() + sufixo;
      if (!usados.has(nome.toLowerCase())) return nome;
    }
    return base;
  }

  /** Um cliente pediu para entrar: manda o mundo e avisa os outros */
  _receberOla(cli, msg) {
    if (msg.versao !== VERSAO_PROTOCOLO) {
      this._recusar(cli, 'Vocês estão com versões diferentes do jogo. Recarreguem a página nos dois computadores (Ctrl+F5).');
      return;
    }
    const pedido = limparApelido(msg.apelido);
    // "Fantasma": alguém com o mesmo nome que não manda nada há 3 s
    // provavelmente fechou a aba sem conseguir avisar. Quem chega agora
    // (quase sempre a mesma pessoa voltando) fica com o nome e com o
    // inventário guardado dele.
    const agora = performance.now();
    for (const outro of [...this.clientes.values()]) {
      if (outro.pronto && outro.apelido.toLowerCase() === pedido.toLowerCase() && agora - outro.ultimaMsg > 3000) {
        this._clienteSaiu(outro);
        this._enviar(outro.conn, { tipo: 'tchau' }); // se ainda estiver vivo, fica sabendo
        try { outro.conn.close(); } catch (e) { /* ignora */ }
      }
    }
    if (this.quantidadeJogadores >= CONFIG.MAX_JOGADORES) {
      this._recusar(cli, 'A sala está cheia.');
      return;
    }
    cli.apelido = this._apelidoUnico(pedido);
    cli.cores = limparCores(msg.cores);

    // 1) bemvindo: tudo o que o cliente precisa para montar o mundo
    const modificacoes = this.mundo.exportarModificacoes(); // [[x, y, z, id, estado], ...]
    const total = modificacoes.length;
    const porLote = Math.max(1, CONFIG.MODS_POR_LOTE | 0);
    const lotes = Math.ceil(total / porLote);
    const p = this.jogador.posicao;
    this._enviar(cli.conn, {
      tipo: 'bemvindo',
      versao: VERSAO_PROTOCOLO,
      meuId: cli.id,
      apelido: cli.apelido,
      semente: this.mundo.semente,
      hora: this.ceu.hora,
      meuEstado: this.dadosJogadores.get(cli.apelido) || null,
      posAnfitriao: [p.x, p.y, p.z],
      jogadores: this._listaParaBemvindo(),
      itensChao: this.itensChao ? this.itensChao.exportar() : [],
      mobs: this.mobs && typeof this.mobs.exportarParaRede === 'function' ? this.mobs.exportarParaRede() : [],
      luaVermelha: this.luaVermelha,
      modoMundo: this.modoMundo,
      totalMods: total,
      lotes,
    });

    // 2) os blocos mudados, em lotes. Como a conexão entrega em ordem, tudo
    //    o que o anfitrião mandar depois (outros blocos, posições) chega
    //    DEPOIS destes lotes: o cliente nunca perde uma mudança.
    if (lotes > 0) {
      const plano = modificacoesEmInt32(modificacoes);
      for (let n = 0; n < lotes; n++) {
        const ini = n * porLote * NUMEROS_POR_BLOCO;
        const fim = Math.min(total, (n + 1) * porLote) * NUMEROS_POR_BLOCO;
        this._enviar(cli.conn, { tipo: 'mods', n, dados: plano.subarray(ini, fim) });
      }
    }

    // 3) agora ele faz parte da sala: avisa os outros e cria o boneco dele.
    //    (A aparência completa dele chega logo depois, na mensagem `aparencia`.)
    const aviso = { tipo: 'entrou', id: cli.id, apelido: cli.apelido, cores: cli.cores };
    for (const outro of this.clientes.values()) {
      if (outro.pronto) this._enviar(outro.conn, aviso);
    }
    cli.pronto = true;
    // Poderes que já estão ativos nos outros (para ele ver as auras)
    if (this._meusPoderes.length > 0) {
      this._enviar(cli.conn, { tipo: 'poderes', id: this.meuId, lista: this._meusPoderes });
    }
    for (const outro of this.clientes.values()) {
      if (outro !== cli && outro.pronto && outro.poderes.length > 0) {
        this._enviar(cli.conn, { tipo: 'poderes', id: outro.id, lista: outro.poderes });
      }
    }
    this.remotos.adicionar(cli.id, cli.apelido, cli.cores);
    this._aviso(cli.apelido + ' entrou no mundo!');
    this._avisarListaMudou();
  }

  /** Lista dos jogadores já na sala (o anfitrião primeiro), com a posição de cada um */
  _listaParaBemvindo() {
    const j = this.jogador;
    const lista = [{
      id: this.meuId,
      apelido: this.apelido,
      cores: this.cores,
      anfitriao: true,
      estado: { x: j.posicao.x, y: j.posicao.y, z: j.posicao.z, yaw: j.yaw, pitch: j.pitch, noAr: !j.noChao, quebrando: false, planando: !!j.planando, nadando: !!j.nadando },
      aparencia: this.aparencia,
    }];
    for (const c of this.clientes.values()) {
      if (!c.pronto) continue;
      lista.push({
        id: c.id, apelido: c.apelido, cores: c.cores, anfitriao: false,
        estado: c.temEstado ? { ...c.estado } : null,
        aparencia: c.aparencia,
      });
    }
    return lista;
  }

  _posDoCliente(cli, msg) {
    if (!lerEstado(msg, cli.estado)) return;
    cli.temEstado = true;
    this.remotos.receberEstado(cli.id, cli.estado);
    // Repassa para os outros clientes, com o id de quem andou
    const m = cli.msgPos;
    const e = cli.estado;
    m.x = e.x; m.y = e.y; m.z = e.z; m.yaw = e.yaw; m.pitch = e.pitch;
    m.noAr = e.noAr; m.quebrando = e.quebrando; m.morto = e.morto;
    m.planando = e.planando; m.nadando = e.nadando;
    for (const outro of this.clientes.values()) {
      if (outro !== cli && outro.pronto) this._enviar(outro.conn, m);
    }
  }

  _blocoDoCliente(cli, msg) {
    const x = msg.x, y = msg.y, z = msg.z, id = msg.id;
    const e = lerEstadoBloco(msg.e);
    if (e < 0 || !blocoValido(x, y, z, id)) return;
    // (Fase 11) o Mobs lê `autorBloco` para saber de quem é um ovo de dragão colocado
    this.autorBloco = cli.apelido;
    let atual; // [id, estado] que ficou
    try { atual = this._aplicarBlocoDaRede(x, y, z, id, e); } finally { this.autorBloco = null; }
    // Manda para TODOS, inclusive para quem mudou (é a confirmação dele)
    this._avisarTodos({ tipo: 'bloco', x, y, z, id: atual[0], e: atual[1], de: cli.id });
  }

  /** Lote de blocos de um cliente (Fase 6): aplica tudo de uma vez e confirma para todos */
  _blocosDoCliente(cli, msg) {
    const lista = lerListaBlocos(msg.lista);
    if (!lista) return;
    this.autorBloco = cli.apelido;
    let final;
    try { final = this._aplicarBlocosDaRede(lista); } finally { this.autorBloco = null; }
    this._avisarTodos({ tipo: 'blocos', lista: final, de: cli.id });
  }

  /** O cliente está perto o bastante do baú (x, y, z)? Sem posição conhecida, não. */
  _clientePertoDoBau(cli, x, y, z) {
    if (!cli.temEstado) return false;   // ainda não mandou posição
    const e = cli.estado;
    const dx = x + 0.5 - e.x, dy = y + 0.5 - (e.y + 0.9), dz = z + 0.5 - e.z;
    const d = CONFIG.BAU_DIST_MAX;
    return dx * dx + dy * dy + dz * dz <= d * d;
  }

  /** Um cliente quer abrir um baú: confere e responde com o conteúdo */
  _bauAbrirDoCliente(cli, msg) {
    const x = msg.x, y = msg.y, z = msg.z;
    if (!posBauValida(x, y, z) || !this._clientePertoDoBau(cli, x, y, z)) return;
    const espacos = this._perguntarBaus({ tipo: 'abrir', x, y, z });
    if (!Array.isArray(espacos)) return; // não é um baú (ou não existe)
    this._enviar(cli.conn, { tipo: 'bauConteudo', x, y, z, espacos });
  }

  /** Um cliente mexeu num espaço do baú: o Baus aplica e a gente repassa para os outros */
  _bauEspacoDoCliente(cli, msg) {
    const x = msg.x, y = msg.y, z = msg.z, i = msg.i;
    if (!posBauValida(x, y, z) || !Number.isInteger(i) || i < 0 || i >= ESPACOS_BAU) return;
    if (!this._clientePertoDoBau(cli, x, y, z)) return;
    const valor = lerValorEspaco(msg.item, msg.qtd);
    if (valor === undefined) return;
    const antes = msg.antes == null ? null : lerValorEspaco(msg.antes.item, msg.antes.qtd);
    if (antes === undefined) return;
    const aceitou = this._perguntarBaus({ tipo: 'espaco', x, y, z, i, valor, antes, comparar: true });
    if (aceitou && aceitou.recusado) {
      // Alguém mexeu antes: não repassa, avisa só quem pediu
      const atual = aceitou.atual;
      this._enviar(cli.conn, {
        tipo: 'bauRecusado', x, y, z, i,
        antes: antes ? { item: antes.item, qtd: antes.qtd } : null,
        valor: valor ? { item: valor.item, qtd: valor.qtd } : null,
        atual: atual ? { item: atual.item, qtd: atual.qtd } : null,
      });
      return;
    }
    if (aceitou !== true) return;
    this._avisarTodos({
      tipo: 'bauEspaco', x, y, z, i, item: valor ? valor.item : null, qtd: valor ? valor.qtd : 0,
    }, cli);
  }

  /** Guarda a última posição conhecida do cliente em dadosJogadores */
  _guardarPosicao(cli) {
    if (!cli.temEstado || !cli.apelido) return;
    const e = cli.estado;
    const d = this.dadosJogadores.get(cli.apelido);
    if (d) {
      d.pos = [e.x, e.y, e.z];
      d.yaw = e.yaw;
      d.pitch = e.pitch;
    } else {
      this.dadosJogadores.set(cli.apelido, {
        pos: [e.x, e.y, e.z], yaw: e.yaw, pitch: e.pitch, inventario: null, equipamento: null, casa: null, xp: 0, xpTotal: 0,
      });
    }
  }

  _clienteSaiu(cli) {
    if (this.clientes.get(cli.id) !== cli) return; // já tratado
    this.clientes.delete(cli.id);
    if (!cli.pronto) return;
    if (this.mobs && typeof this.mobs.jogadorSaiu === 'function') {
      try { this.mobs.jogadorSaiu(cli.id); } catch (e) { console.warn('Hackraft: montarias de quem saiu', e); }
    }
    this._guardarPosicao(cli);
    const aviso = { tipo: 'saiu', id: cli.id };
    for (const c of this.clientes.values()) {
      if (c.pronto) this._enviar(c.conn, aviso);
    }
    this._definirPoderesRemotos(cli.id, []);
    if (this.remotos) this.remotos.remover(cli.id);
    this._aviso(cli.apelido + ' saiu.');
    this._avisarListaMudou();
  }

  /** Anfitrião: guarda os dados dos visitantes que vieram do save */
  carregarDadosJogadores(obj) {
    this.dadosJogadores.clear();
    if (!obj || typeof obj !== 'object') return;
    for (const apelido of Object.keys(obj)) {
      if (typeof apelido !== 'string' || apelido.length > 40) continue;
      const est = limparEstadoJogador(obj[apelido]);
      if (est) this.dadosJogadores.set(apelido, est);
    }
  }

  /** Anfitrião: dados dos visitantes para o save ({ [apelido]: { pos, yaw, pitch, inventario, equipamento, casa } }) */
  exportarDadosJogadores() {
    // Quem está online agora: atualiza a posição antes de salvar
    for (const c of this.clientes.values()) if (c.pronto) this._guardarPosicao(c);
    // Objeto sem "protótipo": um apelido como "__proto__" vira só mais uma chave
    const obj = Object.create(null);
    for (const [apelido, d] of this.dadosJogadores) {
      obj[apelido] = {
        pos: d.pos.slice(), yaw: d.yaw, pitch: d.pitch,
        inventario: d.inventario, equipamento: d.equipamento ?? null, casa: d.casa ?? null,
        xp: ehNumero(d.xp) ? d.xp : 0, // Fase 8
      };
    }
    return obj;
  }

  // ------------------------------------------------------------------
  // CLIENTE: entrar numa sala
  // ------------------------------------------------------------------

  /**
   * Procura a sala, manda o `ola` e espera o mundo chegar.
   * Resolve com { semente, modificacoes, hora, meuEstado, posAnfitriao,
   * jogadores, apelido }. Rejeita com uma mensagem em português.
   */
  async entrarNaSala(codigoDigitado) {
    const codigo = normalizarCodigo(codigoDigitado);
    if (codigo.length !== 5) throw erroRede('O código da sala tem 5 letras ou números.', 'codigo');
    if (!CODIGO_VALIDO.test(codigo)) throw erroRede('Sala não encontrada. Confira o código.', 'codigo');
    this._verificarDisponivel();
    this._fecharConexoes();
    const peer = await this._abrirPeer(null);
    if (this.encerrado) {
      peer.destroy();
      throw erroRede('A conexão foi cancelada.', 'encerrado');
    }
    this.peer = peer;
    peer.on('error', (err) => this._erroDoPeer(err));
    try {
      const dados = await this._conectarAoAnfitriao(peer, codigo);
      this.codigo = codigo;
      return dados;
    } catch (erro) {
      this._fecharConexoes();
      throw erro;
    }
  }

  _conectarAoAnfitriao(peer, codigo) {
    return new Promise((resolve, reject) => {
      const ms = CONFIG.TEMPO_LIMITE_CONEXAO_S * 1000;
      // reliable: true = canal "em ordem e sem perdas" (veja o cabeçalho)
      const conn = peer.connect(PREFIXO_ID + codigo, { reliable: true });
      if (!conn) {
        reject(erroRede('Sem conexão com a internet.', 'network'));
        return;
      }
      this.conexaoAnfitriao = conn;
      let terminou = false;
      let timer = null;

      // Tempo limite que é "rearmado" a cada passo (a cada lote recebido, por
      // exemplo): um mundo grande demora, mas está chegando.
      const armar = (mensagem) => {
        clearTimeout(timer);
        timer = setTimeout(() => falhar(erroRede(mensagem, 'tempo')), ms);
      };
      const encerrarEspera = () => {
        terminou = true;
        clearTimeout(timer);
        peer.off('error', aoErroPeer);
        this._entrada = null;
      };
      const falhar = (erro) => {
        if (terminou) return;
        encerrarEspera();
        reject(erro);
      };
      // Quando a sala não existe, o servidor avisa com 'peer-unavailable'
      const aoErroPeer = (err) => {
        const tipo = err && err.type;
        if (tipo === 'peer-unavailable' || ERROS_FATAIS.has(tipo)) falhar(traduzirErro(err));
      };
      peer.on('error', aoErroPeer);

      this._entrada = {
        progresso: () => armar('O anfitrião parou de responder. Tente de novo.'),
        concluir: (dados) => {
          if (terminou) return;
          encerrarEspera();
          resolve(dados);
        },
        falhar,
      };
      armar('Não deu para conectar na sala. Confira o código e tente de novo.');

      conn.on('open', () => {
        armar('O anfitrião não respondeu. Tente de novo.');
        this._ultimaMsgAnfitriao = performance.now();
        this._enviar(conn, { tipo: 'ola', versao: VERSAO_PROTOCOLO, apelido: this.apelido, cores: this.cores });
      });
      conn.on('data', (msg) => {
        if (this.conexaoAnfitriao === conn) this._dadosDoAnfitriao(msg);
      });
      conn.on('close', () => {
        if (this.conexaoAnfitriao !== conn) return;
        if (!terminou) falhar(erroRede('A conexão com a sala caiu. Tente de novo.', 'fechou'));
        else this._perdeuAnfitriao();
      });
      conn.on('error', (err) => {
        if (this.conexaoAnfitriao !== conn) return;
        console.warn('Hackraft: erro na conexão com o anfitrião', err && err.type);
        if (!terminou) falhar(traduzirErro(err));
        else this._perdeuAnfitriao();
      });
    });
  }

  /** Mensagem do anfitrião. Cada tipo é conferido antes de usar. */
  _dadosDoAnfitriao(msg) {
    if (!msg || typeof msg !== 'object' || this.encerrado) return;
    this._ultimaMsgAnfitriao = performance.now();
    try {
      switch (msg.tipo) {
        case 'bemvindo': this._receberBemvindo(msg); return;
        case 'mods': this._receberLote(msg); return;
        case 'recusado':
          if (this._entrada) {
            this._entrada.falhar(erroRede(textoCurto(msg.motivo) || 'O anfitrião não deixou entrar.', 'recusado'));
          }
          return;
        case 'pos': this._posDoAnfitriao(msg); return;
        case 'bloco': this._blocoDoAnfitriao(msg); return;
        case 'blocos': this._blocosDoAnfitriao(msg); return;
        case 'bauConteudo': this._bauConteudoDoAnfitriao(msg); return;
        case 'bauEspaco': this._bauEspacoDoAnfitriao(msg); return;
        case 'bauRecusado': this._bauRecusadoDoAnfitriao(msg); return;
        case 'entrou': this._alguemEntrou(msg); return;
        case 'saiu': this._alguemSaiu(msg); return;
        case 'hora':
          if (!ehNumero(msg.hora)) return;
          if (typeof msg.por === 'string') this._horaMudadaPorAlguem(msg.hora, limparApelido(msg.por));
          else this._sincronizarHora(msg.hora);
          return;
        case 'chat': this._chatDoAnfitriao(msg); return;
        case 'itemNovo': this._itemNovoDoAnfitriao(msg); return;
        case 'itemRemovido': this._itemRemovidoDoAnfitriao(msg); return;
        case 'ganhou':
          if (this.ligado && itemValido(msg.item) && qtdValida(msg.qtd)) this._receberItem(msg.item, msg.qtd);
          return;
        case 'aparencia': this._aparenciaDoAnfitriao(msg); return;
        case 'efeito': this._efeitoDoAnfitriao(msg); return;
        case 'poderes': this._poderesDoAnfitriao(msg); return;
        case 'mobs': this._mobsDoAnfitriao(msg); return;
        case 'mobNovo': this._mobNovoDoAnfitriao(msg); return;
        case 'mobRemovido': this._mobRemovidoDoAnfitriao(msg); return;
        case 'dano': this._danoDoAnfitriao(msg); return;
        case 'projetilMob': this._projetilDoAnfitriao(msg); return;
        case 'projetilFim': this._projetilFimDoAnfitriao(msg); return;
        case 'luaVermelha': this._luaDoAnfitriao(msg); return;
        case 'donoMob': this._donoMobDoAnfitriao(msg); return;
        case 'domarEstado': this._domarEstadoDoAnfitriao(msg); return;
        case 'avisoMob':
          if (this.ligado && this.mobs && typeof this.mobs.receberAvisoMob === 'function') {
            const t = textoCurto(msg.texto, 160);
            if (t) this.mobs.receberAvisoMob(t);
          }
          return;
        case 'xp':
          if (this.ligado && this.mobs && Number.isInteger(msg.qtd) && msg.qtd > 0 && msg.qtd <= XP_MAX) {
            this.mobs.receberXp(msg.qtd);
          }
          return;
        case 'reanimado':
          if (this.ligado) this._receberReanimado(limparApelido(msg.por));
          return;
        case 'fimDeJogo':
          if (this.ligado) this._receberFimDeJogo();
          return;
        case 'tchau':
          if (this._entrada) this._entrada.falhar(erroRede('O anfitrião fechou a sala.', 'tchau'));
          else this._perdeuAnfitriao();
          return;
        default:
          return; // tipo desconhecido: ignora
      }
    } catch (e) {
      console.warn('Hackraft: mensagem do anfitrião ignorada', e);
    }
  }

  _receberBemvindo(msg) {
    if (!this._entrada || this._recebendo) return;
    const semente = msg.semente;
    const sementeOk = ehNumero(semente) || (typeof semente === 'string' && semente.length <= 200);
    const lotes = msg.lotes;
    const totalMods = msg.totalMods;
    if (msg.versao !== VERSAO_PROTOCOLO || !sementeOk ||
        !Number.isInteger(lotes) || lotes < 0 || lotes > 1000000 ||
        !Number.isInteger(totalMods) || totalMods < 0) {
      this._entrada.falhar(erroRede('O anfitrião mandou dados estranhos. Recarreguem a página e tentem de novo.', 'dados'));
      return;
    }
    const pa = msg.posAnfitriao;
    const posAnfitriao = Array.isArray(pa) && pa.length === 3 && posicaoValida(pa[0], pa[1], pa[2])
      ? [pa[0], pa[1], pa[2]] : null;

    // Jogadores que já estão na sala (o anfitrião vem primeiro)
    const jogadores = [];
    if (Array.isArray(msg.jogadores)) {
      for (const j of msg.jogadores.slice(0, 64)) {
        if (!j || typeof j !== 'object' || typeof j.id !== 'string' || j.id.length > 100) continue;
        const estado = novoEstado();
        jogadores.push({
          id: j.id,
          apelido: limparApelido(j.apelido),
          cores: limparCores(j.cores),
          anfitriao: j.anfitriao === true,
          estado,
          temEstado: lerEstado(j.estado, estado),
          aparencia: limparAparencia(j.aparencia),
        });
      }
    }

    // Itens que já estão no chão (criados de verdade em ligar, quando o mundo existir)
    this._itensPendentes.clear();
    if (Array.isArray(msg.itensChao)) {
      for (const d of msg.itensChao.slice(0, (CONFIG.MAX_ITENS_CHAO ?? 256) * 2)) {
        if (!d || typeof d !== 'object' || !Array.isArray(d.pos) || d.pos.length !== 3) continue;
        const it = lerItemNovo({ id: d.id, item: d.item, qtd: d.qtd, x: d.pos[0], y: d.pos[1], z: d.pos[2] });
        if (it) this._itensPendentes.set(it.id, it);
      }
    }

    // Mobs que já estão no mundo (Fase 7): criados quando o Mobs se registrar
    this._mobsPendentes.clear();
    if (Array.isArray(msg.mobs)) {
      for (const d of msg.mobs.slice(0, MAX_MOBS_REDE)) {
        if (!Array.isArray(d) || d.length < 5) continue;
        const mob = lerMobNovo(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
        if (mob) this._mobsPendentes.set(mob.id, mob);
      }
    }

    // Lua Vermelha (Fase 8): aplicada no céu em ligar(), quando ele existir
    this.luaVermelha = msg.luaVermelha === true;
    this._luaPendente = this.luaVermelha;

    this._recebendo = {
      semente,
      modoMundo: ['sobrevivencia', 'criativo', 'hardcore'].includes(msg.modoMundo) ? msg.modoMundo : 'sobrevivencia',
      hora: ehNumero(msg.hora) ? msg.hora : CONFIG.HORA_INICIAL,
      apelido: limparApelido(msg.apelido || this.apelido),
      meuEstado: limparEstadoJogador(msg.meuEstado),
      posAnfitriao,
      jogadores,
      lotesFaltando: lotes,
      totalLotes: lotes,
      lotesVistos: new Set(),
      modificacoes: [],
    };
    this._entrada.progresso();
    if (lotes === 0) this._finalizarEntrada();
  }

  _receberLote(msg) {
    const r = this._recebendo;
    if (!r || !this._entrada) return;
    // Ignora lote fora da faixa esperada ou repetido
    if (!Number.isInteger(msg.n) || msg.n < 0 || msg.n >= r.totalLotes || r.lotesVistos.has(msg.n)) return;
    r.lotesVistos.add(msg.n);
    const dados = lerLote(msg.dados);
    if (dados) {
      const lista = r.modificacoes;
      for (let i = 0; i + NUMEROS_POR_BLOCO - 1 < dados.length; i += NUMEROS_POR_BLOCO) {
        const x = dados[i], y = dados[i + 1], z = dados[i + 2], id = dados[i + 3];
        const e = dados[i + 4];
        if (blocoValido(x, y, z, id) && e >= 0 && e <= 255) lista.push([x, y, z, id, e]);
      }
    }
    r.lotesFaltando--;
    this._entrada.progresso();
    if (r.lotesFaltando <= 0) this._finalizarEntrada();
  }

  /** O mundo chegou inteiro: monta a lista de jogadores e resolve entrarNaSala */
  _finalizarEntrada() {
    const r = this._recebendo;
    this._recebendo = null;
    if (!this.peer || !this._entrada) return;
    this.modo = 'cliente';
    this.meuId = this.peer.id;
    this.apelido = r.apelido;
    this._msgPos.id = this.meuId;
    this.casa = r.meuEstado ? r.meuEstado.casa : null; // a casa que o anfitrião guardou para mim
    this.modoMundo = r.modoMundo;                      // o tipo de mundo é o do anfitrião

    this.jogadores.clear();
    for (const j of r.jogadores) {
      if (j.id !== this.meuId) this.jogadores.set(j.id, j);
    }
    this.jogadores.set(this.meuId, {
      id: this.meuId, apelido: this.apelido, cores: this.cores, anfitriao: false,
      estado: novoEstado(), temEstado: false, aparencia: null,
    });

    this._entrada.concluir({
      semente: r.semente,
      modificacoes: r.modificacoes,
      hora: r.hora,
      meuEstado: r.meuEstado,
      posAnfitriao: r.posAnfitriao,
      jogadores: this.listaJogadores(),
      apelido: this.apelido,
      modoMundo: r.modoMundo,
    });
  }

  _posDoAnfitriao(msg) {
    const id = msg.id;
    if (typeof id !== 'string' || id === this.meuId) return;
    const j = this.jogadores.get(id);
    if (!j || !lerEstado(msg, j.estado)) return;
    j.temEstado = true;
    if (this.ligado) this.remotos.receberEstado(id, j.estado);
  }

  /**
   * Bloco vindo do anfitrião.
   * O cliente muda os próprios blocos na hora ("otimista") e manda para o
   * anfitrião. O anfitrião aplica as mudanças NA ORDEM em que chegam e
   * manda cada uma para todos (com `de` = quem mudou). Para todo mundo
   * terminar igual ao anfitrião:
   *   - se ainda tenho mudança minha não confirmada neste bloco, ignoro a
   *     dos outros (a minha chegou depois no anfitrião, então é ela que vale);
   *   - quando chega a confirmação da minha última mudança, aplico o valor
   *     do anfitrião (quase sempre é igual ao que já está na tela).
   */
  _blocoDoAnfitriao(msg) {
    const x = msg.x, y = msg.y, z = msg.z, id = msg.id;
    const e = lerEstadoBloco(msg.e);
    if (e < 0 || !blocoValido(x, y, z, id)) return;
    const de = typeof msg.de === 'string' ? msg.de : '';
    if (!this.ligado) {
      // O mundo ainda está sendo montado: aplica depois, em ligar()
      if (this._blocosAntesDeLigar.length < 100000) this._blocosAntesDeLigar.push([x, y, z, id, e, de]);
      return;
    }
    if (this._vaiAplicarBloco(x, y, z, de)) this._aplicarBlocoDaRede(x, y, z, id, e);
  }

  /** Lote de blocos vindo do anfitrião (Fase 6) */
  _blocosDoAnfitriao(msg) {
    const lista = lerListaBlocos(msg.lista);
    if (!lista) return;
    const de = typeof msg.de === 'string' ? msg.de : '';
    if (!this.ligado) {
      for (const b of lista) {
        if (this._blocosAntesDeLigar.length < 100000) this._blocosAntesDeLigar.push([b[0], b[1], b[2], b[3], b[4], de]);
      }
      return;
    }
    const aplicar = [];
    for (const b of lista) {
      if (this._vaiAplicarBloco(b[0], b[1], b[2], de)) aplicar.push(b);
    }
    if (aplicar.length > 0) this._aplicarBlocosDaRede(aplicar);
  }

  /**
   * (Cliente) Decide se uma mudança vinda do anfitrião deve ser aplicada,
   * seguindo a regra do comentário de _blocoDoAnfitriao (mudanças minhas
   * ainda não confirmadas têm prioridade).
   */
  _vaiAplicarBloco(x, y, z, de) {
    const chave = x + ',' + y + ',' + z;
    const pendentes = this._pendentes.get(chave);
    if (pendentes !== undefined) {
      if (de !== this.meuId) return false;
      if (pendentes > 1) {
        this._pendentes.set(chave, pendentes - 1);
        return false;
      }
      this._pendentes.delete(chave);
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Baús (Fase 6): o conteúdo mora no Baus; aqui só transportamos
  // ------------------------------------------------------------------

  /** Registra o ouvinte do Baus (veja o cabeçalho). Devolve uma função que remove o ouvinte. */
  aoBau(fn) {
    if (typeof fn !== 'function') return () => {};
    this._ouvintesBau.push(fn);
    return () => {
      const i = this._ouvintesBau.indexOf(fn);
      if (i >= 0) this._ouvintesBau.splice(i, 1);
    };
  }

  /** Chama os ouvintes do Baus e devolve a primeira resposta que não for undefined */
  _perguntarBaus(ev) {
    for (const fn of this._ouvintesBau) {
      try {
        const r = fn(ev);
        if (r !== undefined) return r;
      } catch (e) {
        console.error(e);
      }
    }
    return undefined;
  }

  /** (Cliente) Pede ao anfitrião o conteúdo do baú. Devolve false se não deu para mandar. */
  enviarBauAbrir(x, y, z) {
    if (this.modo !== 'cliente' || this._caiu || this.encerrado) return false;
    this._enviar(this.conexaoAnfitriao, { tipo: 'bauAbrir', x, y, z });
    return true;
  }

  /** Avisa que um espaço do baú mudou (`valor` = { item, qtd } ou null). Sozinho: não faz nada. */
  enviarBauEspaco(x, y, z, i, valor, antes = null) {
    if (this.modo === 'sozinho' || !this.ligado || this.encerrado || this._caiu) return false;
    const msg = {
      tipo: 'bauEspaco', x, y, z, i, item: valor ? valor.item : null, qtd: valor ? valor.qtd : 0,
    };
    if (this.modo === 'anfitriao') {
      this._avisarTodos(msg);   // o anfitrião é a autoridade: sem comparar
    } else {
      msg.antes = antes ? { item: antes.item, qtd: antes.qtd } : null;
      this._enviar(this.conexaoAnfitriao, msg);
    }
    return true;
  }

  /** O anfitrião recusou uma mudança minha no baú (alguém mexeu ao mesmo tempo) */
  _bauRecusadoDoAnfitriao(msg) {
    const x = msg.x, y = msg.y, z = msg.z, i = msg.i;
    if (!this.ligado || !posBauValida(x, y, z) || !Number.isInteger(i) || i < 0 || i >= ESPACOS_BAU) return;
    const ler = (v) => (v == null ? null : lerValorEspaco(v.item, v.qtd));
    const antes = ler(msg.antes), valor = ler(msg.valor), atual = ler(msg.atual);
    if (antes === undefined || valor === undefined || atual === undefined) return;
    this._perguntarBaus({ tipo: 'recusado', x, y, z, i, antes, valor, atual });
  }

  /** O anfitrião mandou o conteúdo do baú que pedi */
  _bauConteudoDoAnfitriao(msg) {
    if (!this.ligado || !posBauValida(msg.x, msg.y, msg.z)) return;
    const espacos = lerEspacosBau(msg.espacos);
    if (!espacos) return;
    this._perguntarBaus({ tipo: 'conteudo', x: msg.x, y: msg.y, z: msg.z, espacos });
  }

  /** O anfitrião repassou a mudança de um espaço feita por outro jogador */
  _bauEspacoDoAnfitriao(msg) {
    const x = msg.x, y = msg.y, z = msg.z, i = msg.i;
    if (!this.ligado || !posBauValida(x, y, z) || !Number.isInteger(i) || i < 0 || i >= ESPACOS_BAU) return;
    const valor = lerValorEspaco(msg.item, msg.qtd);
    if (valor === undefined) return;
    this._perguntarBaus({ tipo: 'espaco', x, y, z, i, valor });
  }

  /** Alguém mudou a hora de propósito: aplica já e avisa */
  _horaMudadaPorAlguem(hora, apelido) {
    if (!this.ligado || !this.ceu) {
      this._horaPendente = hora;
      return;
    }
    this.ceu.definirHora(hora);
    this._aviso(apelido + ' mudou para ' + (this.ceu.hora < CONFIG.DIA_SEGUNDOS ? 'dia' : 'noite'));
  }

  /** Mensagem de chat vinda do anfitrião */
  _chatDoAnfitriao(msg) {
    const texto = limparChat(msg.texto);
    if (!texto || typeof msg.de !== 'string' || msg.de.length > 100) return;
    this._entregarChat({ de: msg.de, apelido: limparApelido(msg.apelido), texto });
  }

  _alguemEntrou(msg) {
    const id = msg.id;
    if (typeof id !== 'string' || id.length > 100 || id === this.meuId) return;
    const apelido = limparApelido(msg.apelido);
    const cores = limparCores(msg.cores);
    this.jogadores.set(id, {
      id, apelido, cores, anfitriao: false, estado: novoEstado(), temEstado: false, aparencia: null,
    });
    if (!this.ligado) return;
    this.remotos.adicionar(id, apelido, cores);
    this._aviso(apelido + ' entrou no mundo!');
    this._avisarListaMudou();
  }

  /** A aparência de outro jogador mudou (o anfitrião repassou) */
  _aparenciaDoAnfitriao(msg) {
    const id = msg.id;
    if (typeof id !== 'string' || id === this.meuId) return;
    const j = this.jogadores.get(id);
    const ap = limparAparencia(msg.ap);
    if (!j || !ap) return;
    j.aparencia = ap;
    if (this.ligado) this._aplicarAparenciaRemota(id, ap);
  }

  /** Mostra a aparência no boneco de outro jogador (se o boneco souber fazer isso) */
  _aplicarAparenciaRemota(id, ap) {
    const r = this.remotos;
    if (!r || typeof r.definirAparencia !== 'function') return;
    try {
      r.definirAparencia(id, ap);
    } catch (e) {
      console.warn('Hackraft: não deu para mostrar a aparência de', id, e);
    }
  }

  /** O anfitrião repassou o efeito de alguém */
  _efeitoDoAnfitriao(msg) {
    if (!this.ligado) return;
    if (typeof msg.de === 'string' && msg.de === this.meuId) return; // o meu eu já desenhei
    const e = limparEfeito(msg.efeito);
    if (e) this._mostrarEfeito(e);
  }

  /** Poderes ativos de outro jogador (aura) */
  _poderesDoAnfitriao(msg) {
    const id = msg.id;
    if (typeof id !== 'string' || id === this.meuId) return;
    const j = this.jogadores.get(id);
    if (!j) return;
    j.poderes = limparListaPoderes(msg.lista);
    if (this.ligado) this._definirPoderesRemotos(id, j.poderes);
  }

  /** O anfitrião pôs um item no chão */
  _itemNovoDoAnfitriao(msg) {
    const d = lerItemNovo(msg);
    if (!d) return;
    if (!this.ligado || !this.itensChao) {
      // O mundo ainda está sendo montado: cria depois, em ligar()
      if (this._itensPendentes.size < 2000) this._itensPendentes.set(d.id, d);
      return;
    }
    this.itensChao.criar(d.id, d.item, d.qtd, d.x, d.y, d.z, d.vx, d.vy, d.vz, d.de === this.meuId);
  }

  /** O anfitrião tirou um item do chão (alguém pegou ou o tempo acabou) */
  _itemRemovidoDoAnfitriao(msg) {
    if (!idItemValido(msg.id)) return;
    if (!this.ligado || !this.itensChao) this._itensPendentes.delete(msg.id);
    else this.itensChao.remover(msg.id);
  }

  _alguemSaiu(msg) {
    const id = msg.id;
    if (typeof id !== 'string' || id === this.meuId) return;
    const j = this.jogadores.get(id);
    if (!j) return;
    this.jogadores.delete(id);
    if (!this.ligado) return;
    this._definirPoderesRemotos(id, []);
    this.remotos.remover(id);
    this._aviso(j.apelido + ' saiu.');
    this._avisarListaMudou();
  }

  /**
   * A hora vem do anfitrião. Só corrige se a diferença passar de
   * TOLERANCIA_HORA_S, senão o sol ficaria dando "pulinhos".
   * A hora dá a volta (depois do fim da noite vem o 0 de novo), então a
   * diferença é medida pelo caminho mais curto: 299 s e 1 s estão a 2 s
   * de distância, não a 298 s.
   */
  _sincronizarHora(hora) {
    if (!this.ligado || !this.ceu) {
      this._horaPendente = hora;
      return;
    }
    const C = CICLO_SEGUNDOS;
    let dif = (hora - this.ceu.hora) % C;
    if (dif > C / 2) dif -= C;
    else if (dif < -C / 2) dif += C;
    if (Math.abs(dif) > CONFIG.TOLERANCIA_HORA_S) this.ceu.definirHora(hora);
  }

  /** O cliente perdeu o anfitrião: avisa quem se registrou em aoDesconectar */
  _perdeuAnfitriao() {
    if (this.modo !== 'cliente' || this._caiu || this.encerrado) return;
    this._caiu = true;
    clearInterval(this._relogio);
    this._relogio = null;
    console.warn('Hackraft: a conexão com o anfitrião caiu.');
    for (const fn of this._ouvintesDesconectar) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  /** Registra uma função chamada quando o cliente perde o anfitrião */
  aoDesconectar(fn) {
    this._ouvintesDesconectar.push(fn);
    if (this._caiu) fn(); // caiu antes de alguém escutar
  }

  _enviarMeuEstado() {
    if (this.modo !== 'cliente' || !this.jogador || !this.inventario || this._disseTchau) return;
    const s = this.jogador.serializar();
    const xp = ehNumero(s.xpTotal) ? s.xpTotal : (ehNumero(this.jogador.xpTotal) ? this.jogador.xpTotal : 0);
    this._enviar(this.conexaoAnfitriao, {
      tipo: 'meuEstado',
      pos: s.pos,
      yaw: s.yaw,
      pitch: s.pitch,
      inventario: this.inventario.serializar(),
      equipamento: this.equipamento ? this.equipamento.serializar() : null,
      casa: this.casa,
      xp, // Fase 8: o anfitrião guarda junto com o inventário
    });
  }

  // ------------------------------------------------------------------
  // Começar a sincronizar (depois que o mundo existe)
  // ------------------------------------------------------------------

  /**
   * @param pecas { mundo, ceu, jogador, inventario, remotos, ui,
   *                equipamento, itensChao, aoPegarItem, poderes }
   *   `poderes` (Fase 5): recebe os efeitos e as auras dos outros jogadores.
   *   `aoPegarItem(item, qtd)` (opcional) é chamada quando o jogador local
   *   ganha um item do chão (o main toca um som).
   */
  ligar({ mundo, ceu, jogador, inventario, remotos, ui, equipamento = null, itensChao = null, aoPegarItem = null, poderes = null }) {
    this.mundo = mundo;
    this.ceu = ceu;
    this.jogador = jogador;
    this.inventario = inventario;
    this.remotos = remotos;
    this.ui = ui;
    this.equipamento = equipamento;
    this.itensChao = itensChao;
    this._aoPegarItem = aoPegarItem;
    this.poderes = poderes;
    this.ligado = true;

    // Itens no chão: quem manda é o anfitrião (ou quem joga sozinho).
    // O cliente só mostra; os itens somem quando o anfitrião avisa.
    if (itensChao) {
      itensChao.autoridade = this.modo !== 'cliente';
      itensChao.aoSumir = this.modo === 'anfitriao'
        ? (id) => this._avisarTodos({ tipo: 'itemRemovido', id })
        : null;
    }
    if (this.modo === 'sozinho' || this.encerrado) return;

    // Toda mudança de bloco feita AQUI (origem 'local') vai para a rede.
    // As que vieram da rede (origem 'rede') não voltam, senão ficariam
    // indo e voltando para sempre.
    this._cancelarOuvinteBloco = mundo.aoAlterarBloco((ev) => this._blocoLocal(ev));

    if (this.modo === 'anfitriao') {
      // Alguém mandou `ola` enquanto o mundo era montado
      for (const cli of [...this.clientes.values()]) {
        if (cli.olaPendente && !cli.pronto) {
          const m = cli.olaPendente;
          cli.olaPendente = null;
          this._receberOla(cli, m);
        }
      }
    } else {
      // Cliente: cria os bonecos de quem já está na sala (com a roupa de cada um)
      for (const j of this.jogadores.values()) {
        if (j.id === this.meuId) continue;
        remotos.adicionar(j.id, j.apelido, j.cores);
        if (j.aparencia) this._aplicarAparenciaRemota(j.id, j.aparencia);
        if (j.temEstado) remotos.receberEstado(j.id, j.estado);
        if (j.poderes && j.poderes.length > 0) this._definirPoderesRemotos(j.id, j.poderes);
      }
      // Blocos, itens e hora que chegaram durante a montagem do mundo
      for (const b of this._blocosAntesDeLigar) this._blocoDoAnfitriao({ x: b[0], y: b[1], z: b[2], id: b[3], e: b[4], de: b[5] });
      this._blocosAntesDeLigar.length = 0;
      if (itensChao) {
        for (const d of this._itensPendentes.values()) {
          itensChao.criar(d.id, d.item, d.qtd, d.x, d.y, d.z, d.vx, d.vy, d.vz, d.de === this.meuId);
        }
      }
      this._itensPendentes.clear();
      if (this._horaPendente !== null) {
        this._sincronizarHora(this._horaPendente);
        this._horaPendente = null;
      }
      // Lua Vermelha que já estava acontecendo quando entrei (Fase 8)
      if (this._luaPendente !== null) {
        if (typeof ceu.definirLuaVermelha === 'function') ceu.definirLuaVermelha(this._luaPendente, true);
        if (this._luaPendente) this._aviso(TEXTO_LUA_VERMELHA);
        this._luaPendente = null;
      }
      // A minha aparência vai para os outros no primeiro atualizar()
      if (this.aparencia) this._aparenciaPendente = true;

      // Aba escondida: manda o estado (no celular a aba pode ser fechada depois sem aviso)
      this._aoMudarVisibilidade = () => {
        if (document.hidden) this._enviarMeuEstado();
      };
      document.addEventListener('visibilitychange', this._aoMudarVisibilidade);

      this._ultimaMsgAnfitriao = performance.now();
      const anfitriao = [...this.jogadores.values()].find((j) => j.anfitriao);
      if (this.apelido !== this._apelidoPedido) {
        this._aviso('O nome já estava em uso: você é "' + this.apelido + '".');
      } else if (anfitriao) {
        this._aviso('Você entrou no mundo de ' + anfitriao.apelido + '!');
      }
    }

    // Ao fechar a página: o cliente devolve o item da mão ao inventário e
    // manda o estado; depois todos mandam `tchau`. É "melhor esforço": a
    // página pode sumir antes de a mensagem sair. Por isso escutamos o
    // beforeunload (vem primeiro e dá mais tempo para a mensagem sair) e
    // também o pagehide (alguns navegadores, como os de celular, só
    // avisam por ele). O segundo não faz nada, porque o `tchau` só vai uma vez.
    this._aoFecharPagina = () => {
      if (this._caiu || this.encerrado || this._disseTchau) return;
      if (this.modo === 'cliente') {
        try { if (this.ui && this.ui.devolverMao) this.ui.devolverMao(); } catch (e) { /* ignora */ }
        this._enviarMeuEstado();
      }
      this._dizerTchau();
    };
    window.addEventListener('beforeunload', this._aoFecharPagina);
    window.addEventListener('pagehide', this._aoFecharPagina);

    // Relógio de 1 s: confere quem sumiu e manda "ainda estou aqui".
    // Usa setInterval (e não o loop do jogo) porque, com a aba escondida,
    // o navegador para o requestAnimationFrame, mas continua rodando isto.
    this._relogio = setInterval(() => this._aCadaSegundo(), 1000);
    this._avisarListaMudou();
  }

  /** Avisa os outros que estamos saindo (anfitrião → todos; cliente → anfitrião) */
  _dizerTchau() {
    if (this.encerrado || this._caiu || this._disseTchau) return;
    this._disseTchau = true;
    const tchau = { tipo: 'tchau' };
    if (this.modo === 'anfitriao') {
      for (const c of this.clientes.values()) this._enviar(c.conn, tchau);
    } else if (this.modo === 'cliente') {
      this._enviar(this.conexaoAnfitriao, tchau);
    }
  }

  _avisarListaMudou() {
    if (this.ui && typeof this.ui.atualizarJogadores === 'function') {
      this.ui.atualizarJogadores(this.listaJogadores());
    }
  }

  // ------------------------------------------------------------------
  // Aparência (Fase 3)
  // ------------------------------------------------------------------

  /**
   * Guarda a minha aparência completa ({ cores, ...equipamento.aparencia() })
   * e manda para os outros. O envio sai no próximo atualizar(), no máximo
   * ~4 vezes por segundo (se mudar várias vezes seguidas, vai só a última).
   */
  enviarAparencia(ap) {
    const limpa = limparAparencia(ap);
    if (!limpa) return;
    this.aparencia = limpa;
    this._aparenciaPendente = true;
    // Cliente: o equipamento novo vai logo para o anfitrião guardar
    if (this.modo === 'cliente' && this.ligado) this._estadoLogo = true;
  }

  _mandarAparencia() {
    if (!this.aparencia) return;
    if (this.modo === 'anfitriao') {
      this._avisarTodos({ tipo: 'aparencia', id: this.meuId, ap: this.aparencia });
    } else if (this.modo === 'cliente') {
      this._enviar(this.conexaoAnfitriao, { tipo: 'aparencia', ap: this.aparencia });
    }
  }

  // ------------------------------------------------------------------
  // Chat, hora e casa (Fase 4)
  // ------------------------------------------------------------------

  /** Registra uma função chamada a cada mensagem de chat: fn({ de, apelido, texto }) */
  aoChat(fn) {
    if (typeof fn === 'function') this._ouvintesChat.push(fn);
  }

  /** Registra uma função chamada a cada aviso de sistema da rede: fn(texto) */
  aoAviso(fn) {
    if (typeof fn === 'function') this._ouvintesAviso.push(fn);
  }

  /** Mostra um aviso na tela e manda para os ouvintes (o chat) */
  _aviso(texto) {
    if (this.ui) this.ui.mostrarMensagem(texto);
    for (const fn of this._ouvintesAviso) {
      try { fn(texto); } catch (e) { console.error(e); }
    }
  }

  /**
   * Envia uma mensagem de chat. Sozinho: só entrega aqui. Anfitrião: entrega
   * aqui e manda para todos. Cliente: pede ao anfitrião, que manda para todos
   * (inclusive de volta para quem escreveu).
   */
  enviarChat(texto) {
    const t = limparChat(texto);
    if (!t || this.encerrado) return;
    if (this.modo === 'cliente') {
      if (!this._caiu) this._enviar(this.conexaoAnfitriao, { tipo: 'chat', texto: t });
    } else if (this.modo === 'anfitriao') {
      this._distribuirChat(this._idLocal(), this.apelido, t);
    } else {
      this._entregarChat({ de: this._idLocal(), apelido: this.apelido, texto: t });
    }
  }

  /**
   * Muda a hora do dia (segundos desde o nascer do sol). Cliente: pede ao
   * anfitrião. Anfitrião ou sozinho: aplica na hora, avisa e (anfitrião)
   * manda para todos. Devolve false se o número for inválido.
   */
  pedirHora(segundos) {
    if (!ehNumero(segundos) || this.encerrado) return false;
    if (this.modo === 'cliente') {
      if (this._caiu) return false;
      this._enviar(this.conexaoAnfitriao, { tipo: 'pedirHora', hora: segundos });
      return true;
    }
    if (!this.ceu) return false;
    this._aplicarHoraDeAlguem(segundos, this.apelido);
    return true;
  }

  /**
   * Guarda a minha casa [x, y, z] (ou null). O cliente manda o `meuEstado`
   * logo, para o anfitrião guardar. O anfitrião grava a dele no save (main).
   */
  definirCasa(pos) {
    this.casa = limparCasa(pos);
    if (this.modo === 'cliente' && this.ligado && !this._caiu) this._enviarMeuEstado();
  }

  // ------------------------------------------------------------------
  // Efeitos e poderes (Fase 5)
  // ------------------------------------------------------------------

  /**
   * Avisa os outros jogadores que atirei um poder, para eles desenharem.
   * `efeito` = { tipo: 'fogo' | 'raio' | 'gelo' | 'poder', origem, direcao,
   * fim?, cor?, cadeia?, poder? }. Sozinho: não faz nada. Devolve true se mandou.
   */
  enviarEfeito(efeito) {
    if (this.modo === 'sozinho' || !this.ligado || this.encerrado || this._caiu) return false;
    const e = limparEfeito(efeito);
    if (!e || !this._efeitoPermitido(this, '_efIni', '_efN')) return false;
    if (this.modo === 'anfitriao') {
      this._avisarTodos({ tipo: 'efeito', de: this.meuId, efeito: e });
    } else {
      this._enviar(this.conexaoAnfitriao, { tipo: 'efeito', efeito: e });
    }
    return true;
  }

  /**
   * Avisa quais poderes estão ativos em mim (a lista de nomes, ex.: ['velocidade']).
   * Aceita lista, Set ou Map (usa as chaves). Chame quando a lista mudar.
   */
  enviarPoderes(lista) {
    let nomes = [];
    if (Array.isArray(lista)) nomes = lista;
    else if (lista && typeof lista.keys === 'function') nomes = [...lista.keys()];
    this._meusPoderes = limparListaPoderes(nomes);
    if (this.modo === 'sozinho' || !this.ligado || this.encerrado || this._caiu) return;
    if (this.modo === 'anfitriao') {
      this._avisarTodos({ tipo: 'poderes', id: this.meuId, lista: this._meusPoderes });
    } else {
      this._enviar(this.conexaoAnfitriao, { tipo: 'poderes', lista: this._meusPoderes });
    }
  }

  // ------------------------------------------------------------------
  // Mobs (Fase 7): quem simula é o Mobs do anfitrião; a Rede só transporta
  // ------------------------------------------------------------------

  /**
   * O Mobs (mobs.js) se registra aqui no construtor dele. No cliente, os
   * mobs que chegaram antes (no bemvindo ou em mobNovo, enquanto o mundo
   * era montado) são entregues agora.
   */
  registrarMobs(mobs) {
    this.mobs = mobs || null;
    if (this.mobs && this.modo === 'cliente') {
      for (const d of this._mobsPendentes.values()) this._entregarMobNovo(d);
    }
    this._mobsPendentes.clear();
  }

  /** (Anfitrião) true se há pelo menos um cliente na sala */
  get temClientes() {
    if (this.modo !== 'anfitriao') return false;
    for (const c of this.clientes.values()) if (c.pronto) return true;
    return false;
  }

  /**
   * (Anfitrião) Manda o estado de todos os mobs: `t` = performance.now() e
   * `dados` = Float32Array com 8 números por mob (veja o cabeçalho). A
   * mensagem é reaproveitada: o PeerJS copia os dados na hora do envio.
   */
  enviarEstadoMobs(t, dados) {
    if (this.modo !== 'anfitriao' || this.encerrado) return;
    const msg = this._msgMobs;
    msg.t = t;
    msg.dados = dados;
    this._avisarTodos(msg);
    msg.dados = null;
  }

  /** (Anfitrião) Nasceu um mob. `extra` (Fase 11): { v, dono, sela, arm, mont, sent } ou null */
  enviarMobNovo(id, mob, x, y, z, yaw, vida = 1, extra = null) {
    if (this.modo !== 'anfitriao' || this.encerrado) return;
    const msg = { tipo: 'mobNovo', id, mob, x, y, z, yaw, vida };
    if (extra) msg.extra = extra;
    this._avisarTodos(msg);
  }

  /** (Anfitrião) O mob saiu do jogo (morreu = toca a animação de morte) */
  enviarMobRemovido(id, morreu) {
    if (this.modo !== 'anfitriao' || this.encerrado) return;
    this._avisarTodos({ tipo: 'mobRemovido', id, morreu: !!morreu });
  }

  /**
   * (Anfitrião) Um mob bateu no jogador `idJogador` (um cliente). `de` =
   * [x, y, z] do mob (o empurrão é para longe dele). A armadura é descontada
   * por quem recebe. `efeito` (Fase 8) = 'veneno' | 'lento' | 'fogo' (ou null)
   * e `segundos` a duração (0 = o padrão). Devolve true se mandou.
   */
  enviarDanoJogador(idJogador, qtd, de, efeito = null, segundos = 0) {
    if (this.modo !== 'anfitriao' || this.encerrado) return false;
    const c = this.clientes.get(idJogador);
    if (!c || !c.pronto) return false;
    const msg = { tipo: 'dano', qtd, de };
    const ef = lerEfeitoJogador(efeito);
    if (ef) {
      msg.efeito = ef;
      const s = lerSegundosEfeito(segundos || (efeito && efeito.segundos));
      if (s > 0) msg.segundos = s;
    }
    this._enviar(c.conn, msg);
    return true;
  }

  /**
   * (Anfitrião) Um mob atirou um projétil (veja `projetilMob` no cabeçalho).
   * origem e dir são [x, y, z]. `extra` (opcional) = { alvo, alvoMob }.
   */
  enviarProjetilMob(id, proj, origem, dir, extra = null) {
    if (this.modo !== 'anfitriao' || this.encerrado || !this.temClientes) return;
    const msg = { tipo: 'projetilMob', id, proj, origem, dir };
    if (extra && typeof extra.alvo === 'string') msg.alvo = extra.alvo;
    if (extra && Number.isInteger(extra.alvoMob)) msg.alvoMob = extra.alvoMob;
    this._avisarTodos(msg);
  }

  /** (Anfitrião) O projétil `id` acabou em `ponto` ([x, y, z]) */
  enviarProjetilFim(id, ponto) {
    if (this.modo !== 'anfitriao' || this.encerrado || !this.temClientes) return;
    this._avisarTodos({ tipo: 'projetilFim', id, ponto });
  }

  /** Aviso só neste computador: na tela e no chat (ex.: "O Dragão Ancestral apareceu!") */
  avisoLocal(texto) {
    if (typeof texto === 'string' && texto) this._aviso(texto);
  }

  // ------------------------------------------------------------------
  // Hardcore: reanimar quem caiu e fim de jogo
  // ------------------------------------------------------------------

  /** Registra uma função chamada quando EU sou reanimado: fn(apelidoDeQuemReanimou) */
  aoReanimado(fn) {
    if (typeof fn === 'function') this._ouvintesReanimado.push(fn);
  }

  /** Registra uma função chamada no fim de jogo do Hardcore (todos caídos) */
  aoFimDeJogo(fn) {
    if (typeof fn === 'function') this._ouvintesFimDeJogo.push(fn);
  }

  /**
   * Quero reanimar o jogador `apelido` (já segurei o botão pelo tempo todo).
   * Cliente: pede ao anfitrião. Anfitrião: confere e manda direto ao alvo.
   * Sozinho: não há ninguém. Devolve true se o pedido foi enviado/aceito.
   */
  reanimar(apelido) {
    const nome = limparApelido(apelido);
    if (!nome || this.encerrado || !this.jogador) return false;
    if (this.modo === 'cliente') {
      if (this._caiu) return false;
      this._enviar(this.conexaoAnfitriao, { tipo: 'reanimar', apelido: nome });
      return true;
    }
    if (this.modo === 'anfitriao') {
      return this._executarReanimar(this.apelido, this.jogador.posicao, !!this.jogador.morto, nome);
    }
    return false;
  }

  /** Um cliente pediu para reanimar alguém */
  _reanimarDoCliente(cli, msg) {
    if (!cli.temEstado || typeof msg.apelido !== 'string') return;
    this._executarReanimar(cli.apelido, cli.estado, !!cli.estado.morto, limparApelido(msg.apelido));
  }

  /**
   * (Anfitrião) Confere e reanima. `pos` = { x, y, z } de quem reanima.
   * O alvo tem de estar caído, a poucos blocos, e não pode ser quem reanima.
   */
  _executarReanimar(porApelido, pos, porMorto, alvoApelido) {
    if (porMorto || !pos || !alvoApelido) return false;
    const minusculo = alvoApelido.toLowerCase();
    if (minusculo === String(porApelido).toLowerCase()) return false; // ninguém reanima a si mesmo
    let alvoCli = null;
    let alvoPos = null;
    if (minusculo === this.apelido.toLowerCase()) {
      // O alvo sou eu (anfitrião)
      if (!this.jogador || !this.jogador.morto) return false;
      alvoPos = this.jogador.posicao;
    } else {
      for (const c of this.clientes.values()) {
        if (c.pronto && c.apelido.toLowerCase() === minusculo) { alvoCli = c; break; }
      }
      if (!alvoCli || !alvoCli.temEstado || !alvoCli.estado.morto) return false;
      alvoPos = alvoCli.estado;
    }
    const max = (CONFIG.REANIMAR_DIST ?? 2) + (CONFIG.REANIMAR_TOLERANCIA ?? 1.5);
    const dx = alvoPos.x - pos.x, dy = alvoPos.y - pos.y, dz = alvoPos.z - pos.z;
    if (!(dx * dx + dy * dy + dz * dz <= max * max)) return false;
    if (alvoCli) {
      alvoCli.estado.morto = false; // já conta como vivo (o próximo `pos` dele confirma)
      this._enviar(alvoCli.conn, { tipo: 'reanimado', por: porApelido });
    } else {
      this._receberReanimado(porApelido);
    }
    return true;
  }

  /** Fui reanimado: avisa os ouvintes (o main tira o jogador do chão) */
  _receberReanimado(por) {
    for (const fn of this._ouvintesReanimado) {
      try { fn(por); } catch (e) { console.error(e); }
    }
  }

  /**
   * (Anfitrião ou sozinho) true se TODOS os jogadores da sala estão caídos agora
   * (eu e todos os clientes prontos). Sozinho: true se eu caí.
   */
  todosCaidos() {
    if (this.modo === 'cliente' || !this.jogador || !this.jogador.morto) return false;
    for (const c of this.clientes.values()) {
      if (c.pronto && !c.estado.morto) return false;
    }
    return true;
  }

  /** (Anfitrião) Manda o fim de jogo para todos os clientes */
  enviarFimDeJogo() {
    this._avisarTodos({ tipo: 'fimDeJogo' });
  }

  _receberFimDeJogo() {
    for (const fn of this._ouvintesFimDeJogo) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  /** O jogador `id` (outro jogador da sala) está na tela de morte? */
  estaMorto(id) {
    if (this.modo === 'anfitriao') {
      const c = this.clientes.get(id);
      return !!(c && c.estado.morto);
    }
    const j = this.jogadores.get(id);
    return !!(j && j.estado && j.estado.morto);
  }

  // ------------------------------------------------------------------
  // Montarias e pet (Fase 11)
  // ------------------------------------------------------------------

  /**
   * (Anfitrião) A última posição que o jogador `id` mandou, do jeito que chegou
   * ({ x, y, z, yaw, pitch, noAr, ... }), ou null. A montaria de quem está
   * montado segue esta posição (o boneco na tela é suavizado e sobe para o assento).
   */
  estadoJogador(id) {
    if (this.modo === 'anfitriao') {
      const c = this.clientes.get(id);
      return c && c.pronto && c.temEstado ? c.estado : null;
    }
    const j = this.jogadores.get(id);
    return j && j.temEstado ? j.estado : null;
  }

  /** (Anfitrião) Casa de um jogador pelo apelido ([x, y, z]) ou null (para onde volta a montaria desmaiada) */
  casaDe(apelido) {
    if (apelido === this.apelido) return this.casa ? this.casa.slice() : null;
    const d = this.dadosJogadores.get(apelido);
    return d && d.casa ? d.casa.slice() : null;
  }

  /** (Anfitrião ou sozinho) Dá um item a um jogador: eu mesmo, ou um cliente (mensagem `ganhou`) */
  darItem(idJogador, item, qtd) {
    if (!itemValido(item) || !Number.isInteger(qtd) || qtd < 1 || this.modo === 'cliente') return false;
    if (idJogador === this._idLocal()) { this._receberItem(item, qtd); return true; }
    const c = this.clientes.get(idJogador);
    if (!c || !c.pronto) return false;
    for (let resto = qtd; resto > 0; resto -= MAX_QTD_ITEM) {
      this._enviar(c.conn, { tipo: 'ganhou', item, qtd: Math.min(resto, MAX_QTD_ITEM) });
    }
    return true;
  }

  /** (Anfitrião) Dono, sela, armadura, cavaleiro e "sentado" de um mob mudaram: avisa todos */
  enviarDonoMob(id, d) {
    if (this.modo !== 'anfitriao' || this.encerrado || !this.temClientes) return;
    this._avisarTodos({
      tipo: 'donoMob', id, dono: d.dono || null, sela: !!d.sela, arm: d.arm || null,
      mont: d.mont || null, sent: !!d.sent, novo: !!d.novo,
    });
  }

  /** (Anfitrião) Como vai a doma: só para quem está domando */
  enviarDomarEstado(idJogador, d) {
    if (this.modo !== 'anfitriao' || this.encerrado) return;
    const c = this.clientes.get(idJogador);
    if (!c || !c.pronto) return;
    this._enviar(c.conn, { tipo: 'domarEstado', id: d.id, estado: d.estado, conf: d.conf, motivo: d.motivo || '', mob: d.mob || '' });
  }

  /** (Anfitrião) Aviso só para um jogador ("Seu cavalo desmaiou!") */
  enviarAvisoMob(idJogador, texto) {
    if (this.modo !== 'anfitriao' || this.encerrado) return;
    const c = this.clientes.get(idJogador);
    if (c && c.pronto) this._enviar(c.conn, { tipo: 'avisoMob', texto: String(texto).slice(0, 160) });
  }

  // (Cliente) pedidos ao anfitrião
  enviarDomar(id, item) { return this._pedidoMontaria({ tipo: 'domar', id, item }); }
  enviarMontar(id) { return this._pedidoMontaria({ tipo: 'montar', id }); }
  enviarDesmontar() { return this._pedidoMontaria({ tipo: 'desmontar' }); }
  enviarEquiparMontaria(id, item) { return this._pedidoMontaria({ tipo: 'equiparMontaria', id, item }); }
  enviarApito() { return this._pedidoMontaria({ tipo: 'apito' }); }
  enviarSentar(id) { return this._pedidoMontaria({ tipo: 'sentar', id }); }

  _pedidoMontaria(msg) {
    if (this.modo !== 'cliente' || this._caiu || this.encerrado) return false;
    this._enviar(this.conexaoAnfitriao, msg);
    if (msg.tipo === 'domar' || msg.tipo === 'equiparMontaria') this._estadoLogo = true; // o inventário mudou
    return true;
  }

  /** (Anfitrião) Pedido de montaria de um cliente: confere e entrega ao Mobs */
  _montariaDoCliente(cli, m) {
    const mobs = this.mobs;
    if (!mobs || !this._efeitoPermitido(cli, 'mtIni', 'mtN', PEDIDOS_MONTARIA_POR_SEGUNDO)) {
      // ignorado: se era um item, ele volta (o cliente já tinha tirado do inventário)
      if ((m.tipo === 'domar' || m.tipo === 'equiparMontaria') && itemValido(m.item)) this.darItem(cli.id, m.item, 1);
      return;
    }
    try {
      switch (m.tipo) {
        case 'domar':
          if (!idMobValido(m.id) || !itemValido(m.item)) return;
          mobs.pedidoDomar(cli.id, cli.apelido, m.id, m.item);
          return;
        case 'montar':
          if (idMobValido(m.id)) mobs.pedidoMontar(cli.id, cli.apelido, m.id);
          return;
        case 'desmontar':
          mobs.pedidoDesmontar(cli.id);
          return;
        case 'equiparMontaria':
          if (!idMobValido(m.id) || !itemValido(m.item)) return;
          if (m.item !== 'sela' && !/^armadura_montaria_(ferro|ouro|diamante)$/.test(m.item)) { this.darItem(cli.id, m.item, 1); return; }
          mobs.pedidoEquipar(cli.id, cli.apelido, m.id, m.item);
          return;
        case 'apito':
          mobs.pedidoApito(cli.id, cli.apelido);
          return;
        case 'sentar':
          if (idMobValido(m.id)) mobs.pedidoSentar(cli.id, cli.apelido, m.id);
          return;
        default:
      }
    } catch (e) {
      console.warn('Hackraft: pedido de montaria ignorado', e);
    }
  }

  /** (Cliente) Dono/sela/armadura/cavaleiro de um mob */
  _donoMobDoAnfitriao(msg) {
    if (!this.ligado || !this.mobs || typeof this.mobs.receberDono !== 'function' || !idMobValido(msg.id)) return;
    const d = lerExtraMob(msg);
    if (!d) return;
    try { this.mobs.receberDono(msg.id, d); } catch (e) { console.warn('Hackraft: donoMob ignorado', e); }
  }

  /** (Cliente) Como vai a minha doma */
  _domarEstadoDoAnfitriao(msg) {
    if (!this.ligado || !this.mobs || typeof this.mobs.receberEstadoDoma !== 'function') return;
    const estados = ['comecou', 'progresso', 'domado', 'falhou', 'recusado'];
    if (!estados.includes(msg.estado)) return;
    this.mobs.receberEstadoDoma({
      id: idMobValido(msg.id) ? msg.id : 0,
      estado: msg.estado,
      conf: ehNumero(msg.conf) ? Math.max(0, Math.min(1, msg.conf)) : 0,
      motivo: textoCurto(msg.motivo, 160),
      mob: nomeMobValido(msg.mob) ? msg.mob : '',
    });
  }

  // ------------------------------------------------------------------
  // Lua Vermelha (Fase 8)
  // ------------------------------------------------------------------

  /**
   * (Anfitrião/sozinho, a cada quadro) Percebe o anoitecer e o amanhecer:
   * ao anoitecer sorteia a Lua Vermelha (1 em 8); ao amanhecer ela acaba.
   */
  _atualizarLua() {
    const ceu = this.ceu;
    if (!ceu) return;
    const noite = !!ceu.ehNoite;
    if (this._eraNoite === null) { this._eraNoite = noite; return; } // 1º quadro: só anota
    if (noite === this._eraNoite) return;
    this._eraNoite = noite;
    if (noite) {
      if (Math.random() < CHANCE_LUA_VERMELHA) this.definirLuaVermelha(true);
    } else if (this.luaVermelha) {
      this.definirLuaVermelha(false);
    }
  }

  /**
   * (Anfitrião/sozinho) Liga ou desliga a Lua Vermelha agora: muda o céu,
   * avisa no chat e manda `luaVermelha` para todos. No cliente não faz nada
   * (quem decide é o anfitrião). Devolve true se aplicou.
   */
  definirLuaVermelha(ativa) {
    if (this.modo === 'cliente' || this.encerrado) return false;
    ativa = !!ativa;
    const mudou = ativa !== this.luaVermelha;
    this.luaVermelha = ativa;
    if (this.ceu && typeof this.ceu.definirLuaVermelha === 'function') this.ceu.definirLuaVermelha(ativa);
    if (mudou) this._aviso(ativa ? TEXTO_LUA_VERMELHA : TEXTO_LUA_SE_POS);
    this._avisarTodos({ tipo: 'luaVermelha', ativa });
    return true;
  }

  /** (Cliente) O anfitrião avisou que a Lua Vermelha nasceu ou se pôs */
  _luaDoAnfitriao(msg) {
    if (typeof msg.ativa !== 'boolean') return;
    const mudou = msg.ativa !== this.luaVermelha;
    this.luaVermelha = msg.ativa;
    if (!this.ligado || !this.ceu) {
      this._luaPendente = msg.ativa;
      return;
    }
    if (typeof this.ceu.definirLuaVermelha === 'function') this.ceu.definirLuaVermelha(msg.ativa);
    if (mudou) this._aviso(msg.ativa ? TEXTO_LUA_VERMELHA : TEXTO_LUA_SE_POS);
  }

  /** (Anfitrião) O cliente `idJogador` matou um mob e ganhou XP */
  enviarXp(idJogador, qtd) {
    if (this.modo !== 'anfitriao' || this.encerrado) return false;
    const c = this.clientes.get(idJogador);
    if (!c || !c.pronto) return false;
    this._enviar(c.conn, { tipo: 'xp', qtd });
    return true;
  }

  /**
   * (Cliente) Bati no mob `id`. `dir` = direção do golpe ({ x, y, z }, pode ser
   * um Vector3 reaproveitado: os números são copiados aqui). `ataque` =
   * 'golpe' | 'fogo' | 'raio' | 'gelo'; `efeito` = { queimar } ou { lento }.
   */
  enviarAtacarMob(id, dano, dir, ataque = 'golpe', efeito = null) {
    if (this.modo !== 'cliente' || this._caiu || this.encerrado) return false;
    const msg = { tipo: 'atacarMob', id, dano, ataque, dir: dir ? [dir.x, dir.y, dir.z] : null };
    const ef = lerEfeitoMob(efeito);
    if (ef) msg.efeito = ef;
    this._enviar(this.conexaoAnfitriao, msg);
    return true;
  }

  /**
   * (Anfitrião ou sozinho) Põe no chão o drop de um mob. Igual ao soltarItem,
   * mas sem dono: qualquer um pega na hora e o item é puxado para quem passa.
   */
  soltarDrop(item, qtd, x, y, z, vx = 0, vy = 0, vz = 0) {
    if (this.modo === 'cliente' || !this.itensChao || !itemValido(item) ||
        !Number.isInteger(qtd) || qtd < 1 || !posicaoValida(x, y, z)) return false;
    for (let resto = qtd; resto > 0; resto -= MAX_QTD_ITEM) {
      this._criarItem(item, Math.min(resto, MAX_QTD_ITEM), x, y, z,
        velocidadeItem(vx), velocidadeItem(vy), velocidadeItem(vz), '');
    }
    return true;
  }

  /** (Cliente) Entrega um mob novo ao Mobs (erros do Mobs não derrubam a rede) */
  _entregarMobNovo(d) {
    try {
      this.mobs.receberNovo(d.id, d.mob, d.x, d.y, d.z, d.yaw, d.vida, d.extra);
    } catch (e) {
      console.warn('Hackraft: mob novo ignorado', e);
    }
  }

  /** Estado dos mobs (~10 vezes por segundo) */
  _mobsDoAnfitriao(msg) {
    if (!this.mobs || !ehNumero(msg.t)) return; // sem Mobs ainda: o próximo estado vem logo
    const dados = lerEstadoMobs(msg.dados);
    if (dados) this.mobs.receberEstado(msg.t, dados);
  }

  _mobNovoDoAnfitriao(msg) {
    const d = lerMobNovo(msg.id, msg.mob, msg.x, msg.y, msg.z, msg.yaw, msg.vida, msg.extra);
    if (!d) return;
    if (!this.mobs) {
      if (this._mobsPendentes.size < MAX_MOBS_REDE * 4) this._mobsPendentes.set(d.id, d);
      return;
    }
    this._entregarMobNovo(d);
  }

  _mobRemovidoDoAnfitriao(msg) {
    if (!idMobValido(msg.id)) return;
    if (!this.mobs) {
      this._mobsPendentes.delete(msg.id);
      return;
    }
    this.mobs.receberRemovido(msg.id, msg.morreu === true);
  }

  /** Um mob me bateu (o anfitrião manda só para mim) */
  _danoDoAnfitriao(msg) {
    if (!this.ligado || !this.mobs) return;
    if (!ehNumero(msg.qtd) || msg.qtd <= 0 || msg.qtd > DANO_MAX_JOGADOR) return;
    const de = limparPontoMundo(msg.de);
    if (!de) return;
    // Efeito: 'veneno' (duração padrão) ou { tipo: 'veneno', segundos: 2 }
    const tipoEf = lerEfeitoJogador(msg.efeito);
    const seg = lerSegundosEfeito(msg.segundos);
    const efeito = tipoEf ? (seg > 0 ? { tipo: tipoEf, segundos: seg } : tipoEf) : null;
    this.mobs.receberDanoDaRede({ qtd: msg.qtd, de, efeito });
  }

  /** Um mob atirou (o cliente só desenha) */
  _projetilDoAnfitriao(msg) {
    if (!this.ligado || !this.mobs || typeof this.mobs.receberProjetil !== 'function') return;
    if (!idMobValido(msg.id) || !nomeMobValido(msg.proj)) return;
    const origem = limparPontoMundo(msg.origem);
    const dir = limparVetor(msg.dir, VEL_MAX_PROJETIL);
    if (!origem || !dir) return;
    const o = Array.isArray(origem) ? origem : [origem.x, origem.y, origem.z];
    const d = Array.isArray(dir) ? dir : [dir.x, dir.y, dir.z];
    const alvo = typeof msg.alvo === 'string' && msg.alvo.length <= 100 ? msg.alvo : null;
    const alvoMob = idMobValido(msg.alvoMob) ? msg.alvoMob : 0;
    try {
      this.mobs.receberProjetil(msg.id, msg.proj, o, d, alvo, alvoMob);
    } catch (e) {
      console.warn('Hackraft: projétil ignorado', e);
    }
  }

  /** O projétil acabou (bateu, acertou ou o tempo acabou) */
  _projetilFimDoAnfitriao(msg) {
    if (!this.ligado || !this.mobs || typeof this.mobs.receberProjetilFim !== 'function') return;
    if (!idMobValido(msg.id)) return;
    const p = limparPontoMundo(msg.ponto);
    const ponto = p ? (Array.isArray(p) ? p : [p.x, p.y, p.z]) : null;
    try {
      this.mobs.receberProjetilFim(msg.id, ponto);
    } catch (e) {
      console.warn('Hackraft: fim de projétil ignorado', e);
    }
  }

  // ------------------------------------------------------------------
  // Itens no chão (Fase 3)
  // ------------------------------------------------------------------

  /** Meu id para marcar "fui eu que soltei" (no modo sozinho não há id do PeerJS) */
  _idLocal() {
    return this.meuId || 'local';
  }

  /**
   * Solta um item no mundo (ele já deve ter saído do inventário).
   * Sozinho/anfitrião: cria na hora. Cliente: pede ao anfitrião, que cria
   * e avisa todos. Pilhas maiores que 64 vão em pedaços.
   * Devolve false se não deu para soltar (dados inválidos ou sem conexão):
   * nesse caso quem chamou deve devolver o item ao inventário.
   */
  soltarItem(item, qtd, x, y, z, vx = 0, vy = 0, vz = 0) {
    if (!this.itensChao || !itemValido(item) || !Number.isInteger(qtd) || qtd < 1 || !posicaoValida(x, y, z)) {
      return false;
    }
    vx = velocidadeItem(vx);
    vy = velocidadeItem(vy);
    vz = velocidadeItem(vz);
    if (this.modo === 'cliente') {
      const conn = this.conexaoAnfitriao;
      if (this._caiu || this.encerrado || !conn || !conn.open) return false;
      for (let resto = qtd; resto > 0; resto -= MAX_QTD_ITEM) {
        this._enviar(conn, { tipo: 'soltar', item, qtd: Math.min(resto, MAX_QTD_ITEM), x, y, z, vx, vy, vz });
      }
      this._estadoLogo = true; // o anfitrião guarda o inventário novo logo
      return true;
    }
    for (let resto = qtd; resto > 0; resto -= MAX_QTD_ITEM) {
      this._criarItem(item, Math.min(resto, MAX_QTD_ITEM), x, y, z, vx, vy, vz, this._idLocal());
    }
    return true;
  }

  /**
   * O jogador local encostou num item (chamado pelo ItensNoChao).
   * Sozinho/anfitrião: pega na hora. Cliente: pede ao anfitrião.
   */
  pegarItem(entrada) {
    if (!this.itensChao || !entrada || !this.inventario) return;
    const cabe = Math.min(entrada.qtd, quantoCabe(this.inventario, entrada.item), MAX_QTD_ITEM);
    if (cabe < 1) return;
    if (this.modo === 'cliente') {
      if (!this._caiu && !this.encerrado) {
        this._enviar(this.conexaoAnfitriao, { tipo: 'pegar', id: entrada.id, qtd: cabe });
      }
      return;
    }
    const r = this._entregarItem(entrada.id, cabe);
    if (r) this._receberItem(r.item, r.qtd);
  }

  /**
   * (Só quem manda) Cria um item no chão e avisa os clientes.
   * `de` = id de quem soltou ('' = ninguém em especial).
   */
  _criarItem(item, qtd, x, y, z, vx, vy, vz, de) {
    const itens = this.itensChao;
    if (!itens) return null;
    const id = itens.novoId();
    const e = itens.criar(id, item, qtd, x, y, z, vx, vy, vz, de === this._idLocal());
    if (!e) return null;
    this._avisarTodos({ tipo: 'itemNovo', id, item, qtd, x, y, z, vx: e.vx, vy: e.vy, vz: e.vz, de });
    return e;
  }

  /**
   * (Só quem manda) Tira até `maximo` unidades do item do chão. Se sobrar
   * (o inventário de quem pegou encheu), o resto continua no chão, no
   * mesmo lugar, como um item novo. Devolve { item, qtd } ou null.
   */
  _entregarItem(id, maximo) {
    const itens = this.itensChao;
    const e = itens && itens.obter(id);
    if (!e) return null;
    const dar = Math.min(e.qtd, maximo);
    if (!(dar >= 1)) return null;
    const { item, qtd, x, y, z } = e;
    itens.remover(id);
    this._avisarTodos({ tipo: 'itemRemovido', id });
    if (qtd > dar) this._criarItem(item, qtd - dar, x, y, z, 0, 0, 0, '');
    return { item, qtd: dar };
  }

  /** O jogador local ganhou um item do chão. O que não couber volta para o chão. */
  _receberItem(item, qtd) {
    if (!this.inventario) return;
    const sobra = this.inventario.adicionar(item, qtd);
    if (sobra > 0 && this.jogador) {
      const p = this.jogador.posicao;
      this.soltarItem(item, sobra, p.x, p.y + 0.5, p.z, 0, 1, 0);
    }
    if (this.modo === 'cliente') this._estadoLogo = true;
    if (qtd > sobra && this._aoPegarItem) {
      try { this._aoPegarItem(item, qtd - sobra); } catch (e) { console.error(e); }
    }
  }

  // ------------------------------------------------------------------
  // Blocos
  // ------------------------------------------------------------------

  /** Ouvinte de mundo.aoAlterarBloco: manda as mudanças locais */
  _blocoLocal(ev) {
    if (ev.origem !== 'local') return;
    if (ev.lote && Array.isArray(ev.lista)) {
      this._blocosLocais(ev.lista);
      return;
    }
    const e = this._estadoNoMundo(ev.x, ev.y, ev.z, ev.estado);
    if (this.modo === 'anfitriao') {
      this._avisarTodos({ tipo: 'bloco', x: ev.x, y: ev.y, z: ev.z, id: ev.id, e, de: this.meuId });
    } else if (this.modo === 'cliente' && !this._caiu) {
      const chave = ev.x + ',' + ev.y + ',' + ev.z;
      this._pendentes.set(chave, (this._pendentes.get(chave) || 0) + 1);
      this._enviar(this.conexaoAnfitriao, { tipo: 'bloco', x: ev.x, y: ev.y, z: ev.z, id: ev.id, e });
    }
  }

  /** Lote local (mundo.definirBlocos com origem 'local'): sai como `blocos`, em pedaços de até 512 */
  _blocosLocais(lista) {
    const max = CONFIG.BLOCOS_POR_LOTE_MAX;
    for (let ini = 0; ini < lista.length; ini += max) {
      const parte = [];
      for (let k = ini; k < Math.min(lista.length, ini + max); k++) {
        const b = lista[k];
        parte.push([b[0], b[1], b[2], b[3], this._estadoNoMundo(b[0], b[1], b[2], b[4])]);
      }
      if (this.modo === 'anfitriao') {
        this._avisarTodos({ tipo: 'blocos', lista: parte, de: this.meuId });
      } else if (this.modo === 'cliente' && !this._caiu) {
        for (const b of parte) {
          const chave = b[0] + ',' + b[1] + ',' + b[2];
          this._pendentes.set(chave, (this._pendentes.get(chave) || 0) + 1);
        }
        this._enviar(this.conexaoAnfitriao, { tipo: 'blocos', lista: parte });
      }
    }
  }

  /** Estado que o bloco tem agora no mundo (ou `reserva`, se o mundo ainda não sabe responder) */
  _estadoNoMundo(x, y, z, reserva) {
    const m = this.mundo;
    if (m && typeof m.obterEstado === 'function') return m.obterEstado(x, y, z) & 255;
    return Number.isInteger(reserva) ? reserva & 255 : 0;
  }

  /**
   * Aplica um bloco que veio da rede e devolve [id, estado] que ficou.
   * (Se o chunk não estiver carregado aqui, o definirBloco gera os dados
   * dele antes, então o obterBloco logo depois já sabe o valor certo.)
   */
  _aplicarBlocoDaRede(x, y, z, id, e = 0) {
    const m = this.mundo;
    m.definirBloco(x, y, z, id, 'rede', e);
    return [m.obterBloco(x, y, z), this._estadoNoMundo(x, y, z, e)];
  }

  /** Aplica um lote da rede de uma vez e devolve a lista final [[x, y, z, id, e], ...] */
  _aplicarBlocosDaRede(lista) {
    const m = this.mundo;
    if (typeof m.definirBlocos === 'function') {
      m.definirBlocos(lista, 'rede');
    } else {
      for (const b of lista) m.definirBloco(b[0], b[1], b[2], b[3], 'rede', b[4]);
    }
    const final = [];
    for (const b of lista) {
      final.push([b[0], b[1], b[2], m.obterBloco(b[0], b[1], b[2]), this._estadoNoMundo(b[0], b[1], b[2], b[4])]);
    }
    return final;
  }

  // ------------------------------------------------------------------
  // A cada quadro e a cada segundo
  // ------------------------------------------------------------------

  /**
   * Chamar a cada quadro: posição ~15×/s, hora (anfitrião) e estado (cliente).
   * Os intervalos são contados no relógio de verdade (performance.now), e
   * não pelo `dt` do jogo: o `dt` é limitado a 0.05 s, então num computador
   * lento o tempo do jogo anda mais devagar que o relógio.
   */
  atualizar(dt) { // eslint-disable-line no-unused-vars
    if (!this.ligado || this.encerrado) return;
    // Lua Vermelha: quem decide é o anfitrião (ou quem joga sozinho)
    if (this.modo !== 'cliente') this._atualizarLua();
    if (this.modo === 'sozinho' || this._caiu) return;
    const agora = performance.now();

    if (agora - this._tempoPos >= 1000 / CONFIG.ENVIOS_POSICAO_POR_SEGUNDO) {
      this._tempoPos = agora;
      this._enviarPosicao(false);
    }

    // Aparência mudou: manda (no máximo ~4 vezes por segundo)
    if (this._aparenciaPendente && agora - this._tempoAparencia >= 250) {
      this._aparenciaPendente = false;
      this._tempoAparencia = agora;
      this._mandarAparencia();
    }

    if (this.modo === 'anfitriao') {
      if (agora - this._tempoHora >= CONFIG.INTERVALO_HORA_S * 1000) {
        this._tempoHora = agora;
        this._msgHora.hora = this.ceu.hora;
        for (const c of this.clientes.values()) {
          if (c.pronto) this._enviar(c.conn, this._msgHora);
        }
      }
    } else {
      // Normalmente a cada 10 s; depois de pegar/soltar um item, em ~1 s
      // (para o anfitrião não ficar com um inventário velho guardado).
      const intervalo = this._estadoLogo ? 1000 : CONFIG.INTERVALO_ESTADO_S * 1000;
      if (agora - this._tempoEstado >= intervalo) {
        this._tempoEstado = agora;
        this._estadoLogo = false;
        this._enviarMeuEstado();
      }
    }
  }

  /** Manda a minha posição (se mudou, ou se `forcar`, ou se faz 1 s que não manda) */
  _enviarPosicao(forcar) {
    const j = this.jogador;
    const p = j.posicao;
    const m = this._msgPos;
    const noAr = !j.noChao && !j.naAgua;
    const quebrando = !!j.quebrando;
    const morto = !!j.morto;
    const planando = !!j.planando;
    const nadando = !!j.nadando;
    const agora = performance.now();
    const mudou = Math.abs(p.x - m.x) > 0.001 || Math.abs(p.y - m.y) > 0.001 || Math.abs(p.z - m.z) > 0.001 ||
      Math.abs(j.yaw - m.yaw) > 0.001 || Math.abs(j.pitch - m.pitch) > 0.001 ||
      noAr !== m.noAr || quebrando !== m.quebrando || morto !== m.morto ||
      planando !== m.planando || nadando !== m.nadando;
    if (!mudou && !forcar && agora - this._ultimoEnvioPos < 1000) return;
    if (!posicaoValida(p.x, p.y, p.z) || !ehNumero(j.yaw) || !ehNumero(j.pitch)) return;
    m.x = p.x; m.y = p.y; m.z = p.z;
    m.yaw = j.yaw; m.pitch = j.pitch;
    m.noAr = noAr; m.quebrando = quebrando; m.morto = morto;
    m.planando = planando; m.nadando = nadando;
    this._ultimoEnvioPos = agora;
    if (this.modo === 'anfitriao') {
      for (const c of this.clientes.values()) {
        if (c.pronto) this._enviar(c.conn, m);
      }
    } else {
      this._enviar(this.conexaoAnfitriao, m);
    }
  }

  _aCadaSegundo() {
    if (this.encerrado || this._caiu) return;
    const agora = performance.now();
    const limite = CONFIG.TEMPO_SEM_RESPOSTA_S * 1000;
    if (this.modo === 'anfitriao') {
      for (const cli of [...this.clientes.values()]) {
        const semOla = !cli.pronto && agora - cli.criadoEm > CONFIG.TEMPO_LIMITE_CONEXAO_S * 1000 * 2;
        if (agora - cli.ultimaMsg > limite || semOla) {
          console.warn('Hackraft: sem resposta de', cli.apelido || cli.id, '- desconectando.');
          this._clienteSaiu(cli);
          this._enviar(cli.conn, { tipo: 'tchau' }); // se ainda estiver vivo, fica sabendo
          try { cli.conn.close(); } catch (e) { /* ignora */ }
        }
      }
    } else if (this.modo === 'cliente') {
      if (agora - this._ultimaMsgAnfitriao > limite) {
        this._perdeuAnfitriao();
        return;
      }
    }
    // "Ainda estou aqui": com a aba escondida o loop do jogo para, então
    // a posição é mandada daqui (mesmo parada) para ninguém achar que caiu.
    if (agora - this._ultimoEnvioPos > 1500) this._enviarPosicao(true);
  }

  // ------------------------------------------------------------------
  // Envio e encerramento
  // ------------------------------------------------------------------

  /** Envia sem nunca quebrar o jogo (conexão fechada = não manda) */
  _enviar(conn, msg) {
    if (!conn || !conn.open) return;
    try {
      conn.send(msg);
    } catch (e) {
      console.warn('Hackraft: falha ao enviar', msg && msg.tipo, e);
    }
  }

  /** Fecha conexões e o Peer, sem avisar ninguém (usado ao falhar e ao encerrar) */
  _fecharConexoes() {
    const conn = this.conexaoAnfitriao;
    this.conexaoAnfitriao = null;
    if (conn) {
      try { conn.close(); } catch (e) { /* ignora */ }
    }
    const lista = [...this.clientes.values()];
    this.clientes.clear(); // antes de fechar: assim ninguém é anunciado como "saiu"
    for (const c of lista) {
      try { c.conn.close(); } catch (e) { /* ignora */ }
    }
    const peer = this.peer;
    this.peer = null;
    if (peer) {
      try { peer.destroy(); } catch (e) { /* ignora */ }
    }
  }

  /** Desliga tudo (ex.: "Novo mundo"). Depois disso este objeto não é mais usado. */
  encerrar() {
    if (this.ligado) this._dizerTchau(); // os outros ficam sabendo na hora
    this.encerrado = true;
    this.ligado = false;
    clearInterval(this._relogio);
    this._relogio = null;
    clearTimeout(this._timerReconexao);
    this._timerReconexao = null;
    if (this._cancelarOuvinteBloco) {
      this._cancelarOuvinteBloco();
      this._cancelarOuvinteBloco = null;
    }
    if (this._aoFecharPagina) {
      window.removeEventListener('beforeunload', this._aoFecharPagina);
      window.removeEventListener('pagehide', this._aoFecharPagina);
      this._aoFecharPagina = null;
    }
    if (this._aoMudarVisibilidade) {
      document.removeEventListener('visibilitychange', this._aoMudarVisibilidade);
      this._aoMudarVisibilidade = null;
    }
    if (this._entrada) this._entrada.falhar(erroRede('A conexão foi cancelada.', 'encerrado'));
    this._fecharConexoes();
  }
}
