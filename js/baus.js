// =====================================================================
// Hackraft - Baús (Fase 6)
// ---------------------------------------------------------------------
// O CONTEÚDO de cada baú mora no ANFITRIÃO (ou em quem joga sozinho):
// um Map "x,y,z" → lista de 27 espaços, cada um `{ item, qtd }` ou null.
//
//   - Anfitrião/sozinho: abrir() responde na hora, direto do Map.
//   - Cliente: abrir() pergunta ao anfitrião (`bauAbrir`) e espera o
//     `bauConteudo` (no máximo CONFIG.BAU_TEMPO_LIMITE_S segundos).
//   - Mexer num espaço (definirEspaco): muda aqui na hora e manda
//     `bauEspaco` pela rede. O anfitrião repassa para os outros jogadores.
//     Quando OUTRO jogador mexe, os ouvintes de aoMudar são avisados (o main
//     atualiza a tela do baú, se estiver aberta).
//   - Quebrou o baú (por qualquer jogador): o anfitrião solta tudo que
//     estava dentro como itens no chão e apaga o registro.
//
// A Rede só transporta as mensagens: ela chama o ouvinte registrado aqui
// com `rede.aoBau(...)` (veja o cabeçalho do network.js).
//
// BAÚS DE TESOURO (Fase 8)
//   Os Ninhos do Dragão e os Covis da Hidra (world.js) já nascem com um baú.
//   Ele começa "sem registro" (vazio de verdade) e ganha o conteúdo na
//   PRIMEIRA vez que alguém abre (sempre no anfitrião). O conteúdo é sorteado
//   pela semente do mundo + a posição do baú, então é o mesmo para todos.
//   Para não dar para "reabrir" o tesouro (quebrar e pôr de novo, ou esvaziar
//   e salvar), o baú ganha o bit 4 no estado (a frente do baú usa só os bits
//   0 e 1). Isso vira uma modificação do mundo: vai no save e para os outros
//   jogadores. Baú com modificação nunca mais vira tesouro.
// =====================================================================

import { CONFIG } from './config.js';
import { B } from './blocks.js';
import { ITENS, CRISTAIS, obterItem } from './items.js';
import { hash3D, sementeParaNumero } from './noise.js';

// Tesouro: o que pode sair (só entra o que existir em items.js)
const BARRAS_TESOURO = ['barra_cobre', 'barra_ferro', 'barra_prata', 'barra_ouro'];
const MELHORADOS_TESOURO = [
  'espada_cobre', 'espada_ferro', 'espada_prata', 'espada_ouro',
  'capacete_ferro', 'peitoral_ferro', 'calca_ferro', 'botas_ferro',
  'capacete_prata', 'peitoral_prata', 'calca_prata', 'botas_prata',
];
const BIT_TESOURO_ABERTO = 4; // no estado do baú

const N = CONFIG.ESPACOS_BAU;

/** "x,y,z" a partir de números inteiros */
function chaveDe(x, y, z) {
  return (x | 0) + ',' + (y | 0) + ',' + (z | 0);
}

/** Lista de 27 espaços vazios */
function espacosVazios() {
  return new Array(N).fill(null);
}

/** Um espaço conferido: `{ item, qtd }` (copiado) ou null */
function limparEspaco(v) {
  if (!v || typeof v !== 'object' || typeof v.item !== 'string' || v.item.length > 40) return null;
  const def = obterItem(v.item);
  if (!def) return null;                       // item que não existe
  if (!Number.isInteger(v.qtd) || v.qtd < 1) return null;
  return { item: v.item, qtd: Math.min(v.qtd, def.pilha) };   // limita ao tamanho da pilha
}

/** Dois espaços são iguais? (os dois vazios, ou mesmo item e mesma quantidade) */
function iguais(a, b) {
  if (!a || !b) return !a && !b;
  return a.item === b.item && a.qtd === b.qtd;
}

/** Sorteador de números em [0, 1) (mulberry32): a mesma semente dá sempre a mesma sequência */
function sorteador(estado) {
  let a = estado | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roupas que podem sair do tesouro e dos chefões (a hacker fica de fora) */
export function roupasSorteaveis() {
  const lista = [];
  for (const def of ITENS.values()) {
    if (def && def.tipo === 'roupa' && def.nome !== 'roupa_hacker') lista.push(def.nome);
  }
  return lista;
}

/**
 * Conteúdo de um baú de tesouro (27 espaços), sorteado pela semente e pela
 * posição: sempre igual para o mesmo baú do mesmo mundo.
 *   moedas 10 a 30, 2 ou 3 tipos de barra, 2 a 4 cristais de um tipo,
 *   30% de chance de uma roupa e 15% de um equipamento +1 ou +2.
 *   O ninho às vezes tem barras de dracônio; o covil, cristais verdes.
 */
export function sortearTesouro(semente, x, y, z, tipoArea) {
  const r = sorteador(Math.floor(hash3D(sementeParaNumero(semente) ^ 0x7e50a0, x, y, z) * 4294967296));
  const entre = (a, b) => a + Math.floor(r() * (b - a + 1));
  const itens = [];
  const por = (item, qtd) => {
    const def = obterItem(item);
    if (def && qtd > 0) itens.push({ item, qtd: Math.min(qtd, def.pilha) });
  };
  por('moeda', entre(10, 30));
  // barras: 2 ou 3 tipos diferentes
  const barras = BARRAS_TESOURO.slice();
  const nBarras = entre(2, 3);
  for (let k = 0; k < nBarras && barras.length > 0; k++) {
    const i = Math.floor(r() * barras.length);
    por(barras.splice(i, 1)[0], entre(2, 6));
  }
  if (tipoArea === 'ninho' && r() < 0.5) por('barra_draconio', entre(1, 2));
  // cristais: um tipo só (no covil, quase sempre o verde)
  const cristal = tipoArea === 'covil' && r() < 0.6 ? 'cristal_verde' : CRISTAIS[Math.floor(r() * CRISTAIS.length)];
  if (cristal) por(cristal, entre(2, 4));
  // roupa (30%)
  if (r() < 0.3) {
    const roupas = roupasSorteaveis();
    if (roupas.length > 0) por(roupas[Math.floor(r() * roupas.length)], 1);
  }
  // equipamento melhorado +1 ou +2 (15%)
  if (r() < 0.15) {
    const base = MELHORADOS_TESOURO[Math.floor(r() * MELHORADOS_TESOURO.length)];
    por(base + '+' + (r() < 0.7 ? 1 : 2), 1);
  }
  // Espalha pelos 27 espaços (posições sorteadas, sem repetir)
  const espacos = espacosVazios();
  const livres = [];
  for (let i = 0; i < N; i++) livres.push(i);
  for (const it of itens) {
    if (livres.length === 0) break;
    const k = Math.floor(r() * livres.length);
    espacos[livres.splice(k, 1)[0]] = it;
  }
  return espacos;
}

export class Baus {
  /**
   * @param opcoes { mundo, rede, itensChao }
   *   rede:      Rede (opcional: sem ela o jogo é local, como "sozinho")
   *   itensChao: ItensNoChao (usado se a rede não puder soltar os itens)
   */
  constructor({ mundo, rede = null, itensChao = null }) {
    this.mundo = mundo;
    this.rede = rede;
    this.itensChao = itensChao;
    this.dados = new Map();      // "x,y,z" → 27 espaços (anfitrião/sozinho: tudo; cliente: só o baú aberto)
    this._ouvintesRecusa = [];   // fn({ x, y, z, i, antes, valor, atual }): o anfitrião recusou minha mudança
    this._ouvintes = [];         // fn(x, y, z, i, valor): outro jogador mexeu num espaço
    this._pedidos = new Map();   // (cliente) "x,y,z" → [{ resolve, reject, timer }]

    // A rede entrega aqui os pedidos e as mudanças que chegam de outros jogadores
    if (rede && typeof rede.aoBau === 'function') rede.aoBau((ev) => this._aoReceber(ev));

    // Baú quebrado (por mim ou por outro jogador): quem manda solta o conteúdo no chão.
    if (typeof mundo.aoAlterarBloco === 'function') {
      mundo.aoAlterarBloco((ev) => this._aoAlterarBloco(ev));
    }
  }

  /** Sou o cliente de uma sala (o conteúdo mora no anfitrião)? */
  get ehCliente() {
    return !!this.rede && this.rede.modo === 'cliente';
  }

  // ------------------------------------------------------------------
  // Uso pelo jogador
  // ------------------------------------------------------------------

  /** Os 27 espaços do baú (cópia viva guardada aqui) ou null se não conheço */
  obter(x, y, z) {
    return this.dados.get(chaveDe(x, y, z)) || null;
  }

  /**
   * Abre o baú: devolve uma Promise com a lista de 27 espaços (a MESMA lista
   * que guardamos aqui; a UI pode ler dela). Rejeita se não for um baú ou se o
   * anfitrião não responder a tempo.
   */
  abrir(x, y, z) {
    const chave = chaveDe(x, y, z);
    // Se o bloco aqui (no meu mundo) não é baú, rejeita já, sem esperar o tempo limite
    if (this.mundo.obterBloco(x, y, z) !== B.BAU) {
      return Promise.reject(new Error('Isto não é um baú.'));
    }
    if (this.ehCliente) return this._abrirComoCliente(x, y, z, chave);
    return Promise.resolve(this._obterOuCriar(chave, x, y, z));
  }

  /**
   * O jogador mudou o espaço `i` (valor = { item, qtd } ou null): guarda e avisa os outros.
   * `antes` é o que o espaço tinha antes da mudança (o cliente manda junto, e o
   * anfitrião só aceita se o espaço dele ainda for igual: "comparar e trocar").
   */
  definirEspaco(x, y, z, i, valor, antes = null) {
    if (!Number.isInteger(i) || i < 0 || i >= N) return;
    const chave = chaveDe(x, y, z);
    const v = limparEspaco(valor);
    let lista = this.dados.get(chave);
    if (!lista) {
      // Cliente com o baú já fechado (ou sem conteúdo): ainda manda a mudança
      if (!this.ehCliente) lista = this._obterOuCriar(chave, x, y, z);
    }
    if (lista) lista[i] = v;
    if (this.rede && typeof this.rede.enviarBauEspaco === 'function') {
      this.rede.enviarBauEspaco(x | 0, y | 0, z | 0, i, v, limparEspaco(antes));
    }
  }

  /**
   * Registra fn({ x, y, z, i, antes, valor, atual }), chamada no CLIENTE quando o
   * anfitrião recusou uma mudança minha (alguém mexeu no espaço ao mesmo tempo).
   * O espaço guardado aqui já foi corrigido para `atual` quando fn é chamada.
   */
  aoRecusar(fn) {
    if (typeof fn === 'function') this._ouvintesRecusa.push(fn);
  }

  /** Registra fn(x, y, z, i, valor), chamada quando OUTRO jogador mexe num espaço */
  aoMudar(fn) {
    if (typeof fn === 'function') this._ouvintes.push(fn);
  }

  /** O jogador fechou a tela do baú. O cliente esquece a cópia (o anfitrião guarda a verdadeira). */
  fechar(x, y, z) {
    if (this.ehCliente) this.dados.delete(chaveDe(x, y, z));
  }

  // ------------------------------------------------------------------
  // Salvar e carregar (só anfitrião/sozinho)
  // ------------------------------------------------------------------

  /** `{ "x,y,z": [27 espaços] }` (só baús com algo dentro) */
  exportar() {
    const obj = {};
    for (const [chave, lista] of this.dados) {
      if (lista.some((s) => s !== null)) obj[chave] = lista.map((s) => (s ? { item: s.item, qtd: s.qtd } : null));
    }
    return obj;
  }

  /** Lê o que `exportar` gerou (ignora o que estiver estranho) */
  carregar(obj) {
    this.dados.clear();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const chave of Object.keys(obj)) {
      if (!/^-?\d+,-?\d+,-?\d+$/.test(chave)) continue;
      const lista = obj[chave];
      if (!Array.isArray(lista)) continue;
      const novo = espacosVazios();
      for (let i = 0; i < N && i < lista.length; i++) novo[i] = limparEspaco(lista[i]); // confere item e pilha
      this.dados.set(chave, novo);
    }
  }

  // ------------------------------------------------------------------
  // Internos
  // ------------------------------------------------------------------

  /**
   * Os espaços do baú (cria vazio se não tiver registro). Com a posição, um
   * baú de tesouro intocado ganha o conteúdo sorteado aqui (só no anfitrião).
   */
  _obterOuCriar(chave, x, y, z) {
    let lista = this.dados.get(chave);
    if (!lista) {
      lista = (x !== undefined && this._tesouroIntocado(x, y, z, chave)) || espacosVazios();
      this.dados.set(chave, lista);
    }
    return lista;
  }

  /**
   * (Anfitrião/sozinho) Se (x, y, z) é o baú de tesouro de uma área especial
   * e ninguém mexeu nele (sem modificação no mundo), sorteia o conteúdo e
   * marca o baú como aberto. Devolve os 27 espaços ou null.
   */
  _tesouroIntocado(x, y, z, chave) {
    const m = this.mundo;
    if (this.ehCliente || typeof m.bauDeTesouro !== 'function') return null;
    x |= 0; y |= 0; z |= 0;
    if (m.obterBloco(x, y, z) !== B.BAU) return null;
    if (m.modificacoes && m.modificacoes.has(chave)) return null; // já aberto, quebrado ou trocado
    const area = m.bauDeTesouro(x, y, z);
    if (!area) return null;
    let espacos;
    try {
      espacos = sortearTesouro(m.semente, x, y, z, area.tipo);
    } catch (e) {
      console.warn('Hackraft: não deu para sortear o tesouro', e);
      return null;
    }
    // Marca o baú (bit 4 do estado). Origem 'local': a rede manda para os outros.
    const estado = typeof m.obterEstado === 'function' ? m.obterEstado(x, y, z) : 0;
    m.definirBloco(x, y, z, B.BAU, 'local', (estado | BIT_TESOURO_ABERTO) & 255);
    return espacos;
  }

  /** Cliente: pede o conteúdo ao anfitrião e espera a resposta (com tempo limite) */
  _abrirComoCliente(x, y, z, chave) {
    return new Promise((resolve, reject) => {
      if (!this.rede.enviarBauAbrir(x | 0, y | 0, z | 0)) {
        reject(new Error('Sem conexão com o anfitrião.'));
        return;
      }
      const pedido = { resolve, reject, timer: null };
      pedido.timer = setTimeout(() => {
        const fila = this._pedidos.get(chave);
        if (fila) {
          const i = fila.indexOf(pedido);
          if (i >= 0) fila.splice(i, 1);
          if (fila.length === 0) this._pedidos.delete(chave);
        }
        reject(new Error('O anfitrião não respondeu.'));
      }, CONFIG.BAU_TEMPO_LIMITE_S * 1000);
      let fila = this._pedidos.get(chave);
      if (!fila) {
        fila = [];
        this._pedidos.set(chave, fila);
      }
      fila.push(pedido);
    });
  }

  /** Eventos que a Rede entrega (veja o cabeçalho do network.js) */
  _aoReceber(ev) {
    const chave = chaveDe(ev.x, ev.y, ev.z);
    if (ev.tipo === 'abrir') {
      // Anfitrião: um cliente quer ver o baú. Só se for mesmo um baú.
      if (this.ehCliente || this.mundo.obterBloco(ev.x, ev.y, ev.z) !== B.BAU) return null;
      return this._obterOuCriar(chave, ev.x, ev.y, ev.z);
    }
    if (ev.tipo === 'conteudo') {
      // Cliente: chegou o conteúdo que pedi
      if (!this.ehCliente) return undefined;
      const lista = ev.espacos.map(limparEspaco);
      this.dados.set(chave, lista);
      const fila = this._pedidos.get(chave);
      if (fila) {
        this._pedidos.delete(chave);
        for (const p of fila) {
          clearTimeout(p.timer);
          p.resolve(lista);
        }
      }
      return true;
    }
    if (ev.tipo === 'espaco') {
      const v = limparEspaco(ev.valor);
      if (this.ehCliente) {
        // Só importa se estou com esse baú aberto
        const lista = this.dados.get(chave);
        if (!lista) return false;
        lista[ev.i] = v;
      } else {
        // Anfitrião: só aceita se ainda for um baú
        if (this.mundo.obterBloco(ev.x, ev.y, ev.z) !== B.BAU) return false;
        const lista = this._obterOuCriar(chave, ev.x, ev.y, ev.z);
        // Comparar e trocar: se o cliente viu outra coisa neste espaço, recusa
        if (ev.comparar && !iguais(limparEspaco(ev.antes), lista[ev.i])) {
          return { recusado: true, atual: lista[ev.i] ? { item: lista[ev.i].item, qtd: lista[ev.i].qtd } : null };
        }
        lista[ev.i] = v;
      }
      for (const fn of this._ouvintes) {
        try { fn(ev.x, ev.y, ev.z, ev.i, v); } catch (e) { console.error(e); }
      }
      return true;
    }
    if (ev.tipo === 'recusado') {
      // Cliente: o anfitrião não aceitou minha mudança. Corrige a cópia e avisa quem desfaz.
      if (!this.ehCliente) return undefined;
      const atual = limparEspaco(ev.atual);
      const lista = this.dados.get(chave);
      if (lista) lista[ev.i] = atual;
      const info = { x: ev.x, y: ev.y, z: ev.z, i: ev.i, antes: limparEspaco(ev.antes), valor: limparEspaco(ev.valor), atual };
      for (const fn of this._ouvintesRecusa) {
        try { fn(info); } catch (e) { console.error(e); }
      }
      return true;
    }
    return undefined;
  }

  /** Ouvinte do mundo: algum bloco virou outra coisa? Se era um baú com registro, solta o conteúdo. */
  _aoAlterarBloco(ev) {
    if (this.ehCliente || this.dados.size === 0) return;
    if (ev.lote && Array.isArray(ev.lista)) {
      for (const b of ev.lista) this._verificarBau(b[0], b[1], b[2], b[3]);
    } else {
      this._verificarBau(ev.x, ev.y, ev.z, ev.id);
    }
  }

  _verificarBau(x, y, z, id) {
    if (id === B.BAU) return; // continua baú (ou virou baú)
    const chave = chaveDe(x, y, z);
    const lista = this.dados.get(chave);
    if (!lista) return;
    // Cada pilha cai um pouquinho para o lado (valores fixos, sem sorteio no meio do loop)
    let k = 0;
    for (const s of lista) {
      if (!s) continue;
      const ang = k * 2.4;
      k++;
      this._soltar(s.item, s.qtd, x + 0.5, y + 0.4, z + 0.5, Math.cos(ang) * 1.5, 3, Math.sin(ang) * 1.5);
    }
    // Só depois de soltar tudo apaga o registro (se algo falhar acima, o conteúdo não some)
    this.dados.delete(chave);
  }

  /** Solta um item no chão pelo mesmo caminho do "soltar" do jogador (a rede cria e avisa todos) */
  _soltar(item, qtd, x, y, z, vx, vy, vz) {
    if (this.rede && typeof this.rede.soltarItem === 'function') {
      if (this.rede.soltarItem(item, qtd, x, y, z, vx, vy, vz)) return;
    }
    if (this.itensChao) this.itensChao.criar(this.itensChao.novoId(), item, qtd, x, y, z, vx, vy, vz);
  }
}
