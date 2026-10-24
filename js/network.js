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
//     pos        { x, y, z, yaw, pitch, noAr, quebrando }
//                Posição, ~15 vezes por segundo (só se mudou; no mínimo
//                1 vez por segundo, que serve de "ainda estou aqui").
//     bloco      { x, y, z, id }
//                O cliente mudou um bloco (ele já mudou na tela dele).
//     meuEstado  { pos: [x, y, z], yaw, pitch, inventario, equipamento }
//                A cada 10 s (ou ~1 s depois de pegar/soltar um item) e
//                ao fechar a página. O anfitrião guarda pelo apelido em
//                `dadosJogadores`, que vai no save dele.
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
//                [x, y, z, id, x, y, z, id, ...] com até MODS_POR_LOTE
//                blocos (1000 blocos = 16 KB, cabe numa mensagem só do
//                WebRTC, sem precisar o PeerJS picar em pedaços).
//     recusado   { motivo }    não deu para entrar (sala cheia, versão diferente)
//     entrou     { id, apelido, cores }   alguém novo chegou
//     saiu       { id }                   alguém foi embora
//     pos        { id, x, y, z, yaw, pitch, noAr, quebrando }
//                Posição de outro jogador (o anfitrião ou um repasse).
//     bloco      { x, y, z, id, de }
//                Um bloco mudou. `de` = id de quem mudou. O anfitrião manda
//                para TODOS, inclusive para quem mudou: para esse, a
//                mensagem é a "confirmação" (veja _blocoDoAnfitriao).
//     hora       { hora }   a cada 5 s (segundos desde o nascer do sol)
//     itemNovo   { id, item, qtd, x, y, z, vx, vy, vz, de }
//                Um item apareceu no chão (`de` = id de quem soltou, ou '').
//     itemRemovido { id }   o item sumiu (alguém pegou, ou o tempo acabou)
//     ganhou     { item, qtd }
//                Só para quem pediu `pegar`: o item é seu. Se não couber
//                tudo no inventário, o resto volta para o chão (`soltar`).
//     aparencia  { id, ap }  a aparência de outro jogador mudou
//
// ITENS NO CHÃO: o anfitrião é a autoridade
//   Só o anfitrião cria e remove itens no chão (no modo sozinho, é o
//   próprio jogador). Assim dois jogadores nunca pegam o mesmo item: o
//   anfitrião atende os pedidos na ordem em que chegam, e o segundo pedido
//   encontra o item já removido.
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
import { ITENS } from './items.js';
import { Equipamento } from './equipamento.js';
import { quantoCabe } from './itens_chao.js';

const PREFIXO_ID = 'hackraft-';
const VERSAO_PROTOCOLO = 2;          // mude quando o formato das mensagens mudar (2 = Fase 3)
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
    if (s && typeof s === 'object' && typeof s.item === 'string' && s.item.length <= 40 &&
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

/** { pos, yaw, pitch, inventario, equipamento } conferido, ou null */
function limparEstadoJogador(e) {
  if (!e || typeof e !== 'object') return null;
  const p = e.pos;
  if (!Array.isArray(p) || p.length !== 3 || !posicaoValida(p[0], p[1], p[2])) return null;
  return {
    pos: [p[0], p[1], p[2]],
    yaw: ehNumero(e.yaw) ? e.yaw : 0,
    pitch: ehNumero(e.pitch) ? e.pitch : 0,
    inventario: limparInventario(e.inventario),
    equipamento: limparEquipamento(e.equipamento),
  };
}

// ----- Itens (Fase 3) -----

/** O nome é de um item que existe? */
function itemValido(nome) {
  return typeof nome === 'string' && nome.length <= 40 && ITENS.has(nome);
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
  const a = ap.armadura && typeof ap.armadura === 'object' ? ap.armadura : {};
  return {
    cores: limparCores(ap.cores),
    roupa: nome(ap.roupa, v.roupa),
    armadura: {
      capacete: nome(a.capacete, v.material),
      peitoral: nome(a.peitoral, v.material),
      calca: nome(a.calca, v.material),
      botas: nome(a.botas, v.material),
    },
    mao: nome(ap.mao, v.mao),
    acessorio: nome(ap.acessorio, v.acessorio),
  };
}

/** Objeto de estado (posição) reaproveitado para cada jogador */
function novoEstado() {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, noAr: false, quebrando: false };
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

/**
 * Transforma o Map de modificações do mundo ("x,y,z" → id) num Int32Array
 * [x, y, z, id, x, y, z, id, ...]. É bem menor e mais rápido de mandar do
 * que uma lista de listas.
 */
function modificacoesEmInt32(mapa) {
  const plano = new Int32Array(mapa.size * 4);
  let i = 0;
  for (const [chave, id] of mapa) {
    const a = chave.indexOf(',');
    const b = chave.indexOf(',', a + 1);
    plano[i] = +chave.slice(0, a);
    plano[i + 1] = +chave.slice(a + 1, b);
    plano[i + 2] = +chave.slice(b + 1);
    plano[i + 3] = id;
    i += 4;
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
    this._aoPegarItem = null;         // fn(item, qtd): o jogador local ganhou um item do chão

    // Minha aparência completa (Fase 3). Vai no bemvindo (anfitrião) ou na
    // mensagem `aparencia` (todos), sempre que mudar.
    this.aparencia = null;
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
    this._blocosAntesDeLigar = [];    // blocos que chegaram enquanto o mundo era montado
    this._horaPendente = null;
    this._pendentes = new Map();      // "x,y,z" → quantas mudanças minhas o anfitrião ainda não confirmou
    this._itensPendentes = new Map(); // itens no chão que chegaram enquanto o mundo era montado (id → dados)
    this._estadoLogo = false;         // pegou/soltou item: manda o meuEstado em ~1 s
    this._ultimaMsgAnfitriao = 0;
    this._caiu = false;
    this._ouvintesDesconectar = [];

    // --- Envio periódico (quando foi o último envio, em performance.now) ---
    this._tempoPos = 0;
    this._tempoHora = 0;
    this._tempoEstado = 0;
    this._ultimoEnvioPos = -Infinity;
    // Mensagens reaproveitadas (o loop do jogo não cria objetos novos)
    this._msgPos = { tipo: 'pos', id: '', x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, noAr: false, quebrando: false };
    this._msgHora = { tipo: 'hora', hora: 0 };
    this._relogio = null;

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
      msgPos: { tipo: 'pos', id: conn.peer, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, noAr: false, quebrando: false },
      criadoEm: agora,
      ultimaMsg: agora,
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
    const mapa = this.mundo.modificacoes;
    const total = mapa.size;
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
      totalMods: total,
      lotes,
    });

    // 2) os blocos mudados, em lotes. Como a conexão entrega em ordem, tudo
    //    o que o anfitrião mandar depois (outros blocos, posições) chega
    //    DEPOIS destes lotes: o cliente nunca perde uma mudança.
    if (lotes > 0) {
      const plano = modificacoesEmInt32(mapa);
      for (let n = 0; n < lotes; n++) {
        const ini = n * porLote * 4;
        const fim = Math.min(total, (n + 1) * porLote) * 4;
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
    this.remotos.adicionar(cli.id, cli.apelido, cli.cores);
    this.ui.mostrarMensagem(cli.apelido + ' entrou no mundo!');
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
      estado: { x: j.posicao.x, y: j.posicao.y, z: j.posicao.z, yaw: j.yaw, pitch: j.pitch, noAr: !j.noChao, quebrando: false },
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
    m.noAr = e.noAr; m.quebrando = e.quebrando;
    for (const outro of this.clientes.values()) {
      if (outro !== cli && outro.pronto) this._enviar(outro.conn, m);
    }
  }

  _blocoDoCliente(cli, msg) {
    const x = msg.x, y = msg.y, z = msg.z, id = msg.id;
    if (!blocoValido(x, y, z, id)) return;
    const atual = this._aplicarBlocoDaRede(x, y, z, id);
    // Manda para TODOS, inclusive para quem mudou (é a confirmação dele)
    const aviso = { tipo: 'bloco', x, y, z, id: atual, de: cli.id };
    for (const c of this.clientes.values()) {
      if (c.pronto) this._enviar(c.conn, aviso);
    }
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
        pos: [e.x, e.y, e.z], yaw: e.yaw, pitch: e.pitch, inventario: null, equipamento: null,
      });
    }
  }

  _clienteSaiu(cli) {
    if (this.clientes.get(cli.id) !== cli) return; // já tratado
    this.clientes.delete(cli.id);
    if (!cli.pronto) return;
    this._guardarPosicao(cli);
    const aviso = { tipo: 'saiu', id: cli.id };
    for (const c of this.clientes.values()) {
      if (c.pronto) this._enviar(c.conn, aviso);
    }
    if (this.remotos) this.remotos.remover(cli.id);
    if (this.ui) this.ui.mostrarMensagem(cli.apelido + ' saiu.');
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

  /** Anfitrião: dados dos visitantes para o save ({ [apelido]: { pos, yaw, pitch, inventario, equipamento } }) */
  exportarDadosJogadores() {
    // Quem está online agora: atualiza a posição antes de salvar
    for (const c of this.clientes.values()) if (c.pronto) this._guardarPosicao(c);
    // Objeto sem "protótipo": um apelido como "__proto__" vira só mais uma chave
    const obj = Object.create(null);
    for (const [apelido, d] of this.dadosJogadores) {
      obj[apelido] = {
        pos: d.pos.slice(), yaw: d.yaw, pitch: d.pitch,
        inventario: d.inventario, equipamento: d.equipamento ?? null,
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
        case 'entrou': this._alguemEntrou(msg); return;
        case 'saiu': this._alguemSaiu(msg); return;
        case 'hora':
          if (ehNumero(msg.hora)) this._sincronizarHora(msg.hora);
          return;
        case 'itemNovo': this._itemNovoDoAnfitriao(msg); return;
        case 'itemRemovido': this._itemRemovidoDoAnfitriao(msg); return;
        case 'ganhou':
          if (this.ligado && itemValido(msg.item) && qtdValida(msg.qtd)) this._receberItem(msg.item, msg.qtd);
          return;
        case 'aparencia': this._aparenciaDoAnfitriao(msg); return;
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

    this._recebendo = {
      semente,
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
      for (let i = 0; i + 3 < dados.length; i += 4) {
        const x = dados[i], y = dados[i + 1], z = dados[i + 2], id = dados[i + 3];
        if (blocoValido(x, y, z, id)) lista.push([x, y, z, id]);
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
    if (!blocoValido(x, y, z, id)) return;
    const de = typeof msg.de === 'string' ? msg.de : '';
    if (!this.ligado) {
      // O mundo ainda está sendo montado: aplica depois, em ligar()
      if (this._blocosAntesDeLigar.length < 100000) this._blocosAntesDeLigar.push([x, y, z, id, de]);
      return;
    }
    const chave = x + ',' + y + ',' + z;
    const pendentes = this._pendentes.get(chave);
    if (pendentes !== undefined) {
      if (de !== this.meuId) return;
      if (pendentes > 1) {
        this._pendentes.set(chave, pendentes - 1);
        return;
      }
      this._pendentes.delete(chave);
    }
    this._aplicarBlocoDaRede(x, y, z, id);
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
    this.ui.mostrarMensagem(apelido + ' entrou no mundo!');
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
    this.remotos.remover(id);
    this.ui.mostrarMensagem(j.apelido + ' saiu.');
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
    this._enviar(this.conexaoAnfitriao, {
      tipo: 'meuEstado',
      pos: s.pos,
      yaw: s.yaw,
      pitch: s.pitch,
      inventario: this.inventario.serializar(),
      equipamento: this.equipamento ? this.equipamento.serializar() : null,
    });
  }

  // ------------------------------------------------------------------
  // Começar a sincronizar (depois que o mundo existe)
  // ------------------------------------------------------------------

  /**
   * @param pecas { mundo, ceu, jogador, inventario, remotos, ui,
   *                equipamento, itensChao, aoPegarItem }
   *   `aoPegarItem(item, qtd)` (opcional) é chamada quando o jogador local
   *   ganha um item do chão (o main toca um som).
   */
  ligar({ mundo, ceu, jogador, inventario, remotos, ui, equipamento = null, itensChao = null, aoPegarItem = null }) {
    this.mundo = mundo;
    this.ceu = ceu;
    this.jogador = jogador;
    this.inventario = inventario;
    this.remotos = remotos;
    this.ui = ui;
    this.equipamento = equipamento;
    this.itensChao = itensChao;
    this._aoPegarItem = aoPegarItem;
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
      }
      // Blocos, itens e hora que chegaram durante a montagem do mundo
      for (const b of this._blocosAntesDeLigar) this._blocoDoAnfitriao({ x: b[0], y: b[1], z: b[2], id: b[3], de: b[4] });
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
        ui.mostrarMensagem('O nome já estava em uso: você é "' + this.apelido + '".');
      } else if (anfitriao) {
        ui.mostrarMensagem('Você entrou no mundo de ' + anfitriao.apelido + '!');
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
    if (this.modo === 'anfitriao') {
      const aviso = { tipo: 'bloco', x: ev.x, y: ev.y, z: ev.z, id: ev.id, de: this.meuId };
      for (const c of this.clientes.values()) {
        if (c.pronto) this._enviar(c.conn, aviso);
      }
    } else if (this.modo === 'cliente' && !this._caiu) {
      const chave = ev.x + ',' + ev.y + ',' + ev.z;
      this._pendentes.set(chave, (this._pendentes.get(chave) || 0) + 1);
      this._enviar(this.conexaoAnfitriao, { tipo: 'bloco', x: ev.x, y: ev.y, z: ev.z, id: ev.id });
    }
  }

  /**
   * Aplica um bloco que veio da rede e devolve o valor que ficou.
   * (Se o chunk não estiver carregado aqui, o definirBloco gera os dados
   * dele antes, então o obterBloco logo depois já sabe o valor certo.)
   */
  _aplicarBlocoDaRede(x, y, z, id) {
    const m = this.mundo;
    m.definirBloco(x, y, z, id, 'rede');
    return m.obterBloco(x, y, z);
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
    if (!this.ligado || this.modo === 'sozinho' || this.encerrado || this._caiu) return;
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
    const agora = performance.now();
    const mudou = Math.abs(p.x - m.x) > 0.001 || Math.abs(p.y - m.y) > 0.001 || Math.abs(p.z - m.z) > 0.001 ||
      Math.abs(j.yaw - m.yaw) > 0.001 || Math.abs(j.pitch - m.pitch) > 0.001 ||
      noAr !== m.noAr || quebrando !== m.quebrando;
    if (!mudou && !forcar && agora - this._ultimoEnvioPos < 1000) return;
    if (!posicaoValida(p.x, p.y, p.z) || !ehNumero(j.yaw) || !ehNumero(j.pitch)) return;
    m.x = p.x; m.y = p.y; m.z = p.z;
    m.yaw = j.yaw; m.pitch = j.pitch;
    m.noAr = noAr; m.quebrando = quebrando;
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
