// =====================================================================
// Hackraft - Equipamento do jogador (Fase 3)
// ---------------------------------------------------------------------
// Guarda o que o jogador está vestindo: roupa, 4 peças de armadura,
// item da mão e acessório (capa). Cada espaço tem o NOME do item ou null.
// Este arquivo não usa three nem o DOM.
// =====================================================================

import { SLOTS_EQUIPAMENTO, slotDoItem, obterItem } from './items.js';

// Nomes com melhoria: 'peitoral_ferro+2' (a melhoria vai de +1 a +5)
const sufixo = (nome) => /^(.*)\+([1-5])$/.exec(String(nome ?? ''));
const nomeBaseLocal = (nome) => { const m = sufixo(nome); return m ? m[1] : nome; };
const melhoriaLocal = (nome) => { const m = sufixo(nome); return m ? Number(m[2]) : 0; };

/**
 * Definição do item, entendendo o sufixo +N. Se o items.js já entende o sufixo,
 * ele devolve a definição pronta (com defesa/dano somados). Se não, usa a do item
 * base e soma a melhoria aqui (defesa + ceil(N/2)).
 */
function defDoItem(nome) {
  if (!nome) return null;
  const direto = obterItem(nome);
  if (direto) return direto;
  const n = melhoriaLocal(nome);
  const base = n ? obterItem(nomeBaseLocal(nome)) : null;
  if (!base) return null;
  return { ...base, melhoria: n, defesa: base.defesa != null ? base.defesa + Math.ceil(n / 2) : base.defesa };
}

/** Espaço do item (com ou sem sufixo) */
function slotDe(nome) {
  return slotDoItem(nome) ?? slotDoItem(nomeBaseLocal(nome));
}

export class Equipamento {
  constructor() {
    this.espacos = {};
    for (const s of SLOTS_EQUIPAMENTO) this.espacos[s] = null;
    this.esconderArmadura = false; // esconde a armadura no boneco (a defesa continua)
    this.esconderCapacete = false; // esconde só o capacete
    this.roupaForcada = null; // visual forçado pelo modo hacker (não é salvo)
    this._ouvintes = [];
  }

  /** O item existe e é do tipo certo para esse espaço? */
  podeEquipar(slot, item) {
    return slot in this.espacos && !!defDoItem(item) && slotDe(item) === slot;
  }

  /** Coloca o item no espaço. Devolve o item que estava lá (ou null). Item inválido: não faz nada e devolve o próprio item. */
  equipar(slot, item) {
    if (!this.podeEquipar(slot, item)) return item;
    const anterior = this.espacos[slot];
    this.espacos[slot] = item;
    this.notificar();
    return anterior;
  }

  /** Tira o item do espaço e devolve (ou null se estava vazio) */
  desequipar(slot) {
    if (!(slot in this.espacos)) return null;
    const anterior = this.espacos[slot];
    if (anterior === null) return null;
    this.espacos[slot] = null;
    this.notificar();
    return anterior;
  }

  /** Soma os bônus da roupa e das armaduras (mesmo escondidas) */
  bonus() {
    const total = { velocidade: 0, defesa: 0, silencioso: false };
    const roupa = defDoItem(this.espacos.roupa);
    if (roupa && roupa.bonus) {
      total.defesa += roupa.bonus.defesa ?? 0;
      total.velocidade += roupa.bonus.velocidade ?? 0;
      if (roupa.bonus.silencioso) total.silencioso = true;
    }
    for (const parte of ['capacete', 'peitoral', 'calca', 'botas']) {
      const peca = defDoItem(this.espacos[parte]); // já com a melhoria
      if (peca) total.defesa += peca.defesa ?? 0;
    }
    return total;
  }

  /** O que o personagem deve mostrar (formato do Personagem.definirAparencia, sem as cores) */
  aparencia() {
    const material = (slot) => {
      if (this.esconderArmadura) return null;
      if (slot === 'capacete' && this.esconderCapacete) return null;
      const nome = this.espacos[slot];
      const mat = defDoItem(nome)?.material ?? null;
      if (!mat) return null;
      const n = melhoriaLocal(nome);
      return n ? `${mat}+${n}` : mat; // 'ferro' ou 'ferro+2'
    };
    return {
      roupa: this.roupaForcada ?? defDoItem(this.espacos.roupa)?.visual ?? null,
      armadura: {
        capacete: material('capacete'),
        peitoral: material('peitoral'),
        calca: material('calca'),
        botas: material('botas'),
      },
      mao: this.espacos.mao ? (defDoItem(this.espacos.mao) ? this.espacos.mao : null) : null, // nome da espada, com sufixo
      acessorio: defDoItem(this.espacos.acessorio)?.visual ?? null,
    };
  }

  /**
   * Força um visual de roupa (ex.: 'hacker') sem mexer na roupa equipada.
   * Passe null para voltar ao normal. Não vai para o save nem para o serializar.
   */
  definirRoupaForcada(visual) {
    this.roupaForcada = visual ?? null;
    this.notificar();
  }

  /** Registra uma função chamada sempre que o equipamento muda */
  aoMudar(fn) {
    this._ouvintes.push(fn);
  }

  /** Avisa os ouvintes (chame depois de mexer em `espacos` diretamente) */
  notificar() {
    for (const fn of this._ouvintes) fn(this);
  }

  /** Objeto simples para salvar / enviar pela rede */
  serializar() {
    return {
      espacos: { ...this.espacos },
      esconderArmadura: this.esconderArmadura,
      esconderCapacete: this.esconderCapacete,
    };
  }

  /** Restaura de um objeto salvo, ignorando itens inexistentes ou no espaço errado */
  carregar(dados) {
    for (const s of SLOTS_EQUIPAMENTO) this.espacos[s] = null;
    this.esconderArmadura = false;
    this.esconderCapacete = false;
    if (dados && typeof dados === 'object') {
      const origem = dados.espacos ?? {};
      for (const s of SLOTS_EQUIPAMENTO) {
        if (this.podeEquipar(s, origem[s])) this.espacos[s] = origem[s];
      }
      this.esconderArmadura = !!dados.esconderArmadura;
      this.esconderCapacete = !!dados.esconderCapacete;
    }
    this.notificar();
  }
}
