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
// =====================================================================

import { CONFIG } from './config.js';
import { B } from './blocks.js';
import { obterItem } from './items.js';

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
    return Promise.resolve(this._obterOuCriar(chave));
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
      if (!this.ehCliente) lista = this._obterOuCriar(chave);
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

  _obterOuCriar(chave) {
    let lista = this.dados.get(chave);
    if (!lista) {
      lista = espacosVazios();
      this.dados.set(chave, lista);
    }
    return lista;
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
      return this._obterOuCriar(chave);
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
        const lista = this._obterOuCriar(chave);
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
