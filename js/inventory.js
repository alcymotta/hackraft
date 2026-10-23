// =====================================================================
// Hackraft - Inventário
// ---------------------------------------------------------------------
// 36 espaços. Os de 0 a 8 são a hotbar (a fileira de baixo da tela).
// Cada espaço é null (vazio) ou { item: 'grama', qtd: 12 }.
// =====================================================================

import { CONFIG } from './config.js';
import { obterItem } from './items.js';

export class Inventario {
  constructor() {
    this.espacos = new Array(CONFIG.ESPACOS_INVENTARIO).fill(null);
    this.selecionado = 0;
    this.ouvintes = [];
  }

  // Quantos itens cabem numa pilha deste item
  limiteDaPilha(nome) {
    const def = obterItem(nome);
    return def ? def.pilha : CONFIG.TAMANHO_PILHA;
  }

  /** Escolhe o espaço da hotbar (0 a 8) */
  selecionar(i) {
    const n = CONFIG.ESPACOS_HOTBAR;
    i = ((Math.floor(i) % n) + n) % n; // garante 0..8
    if (i === this.selecionado) return;
    this.selecionado = i;
    this.notificar();
  }

  /** Guarda itens. Devolve quanto sobrou (0 = coube tudo). */
  adicionar(item, qtd = 1) {
    if (!obterItem(item)) return qtd;
    const limite = this.limiteDaPilha(item);
    let resto = qtd;
    // 1) completa as pilhas iguais
    for (let i = 0; i < this.espacos.length && resto > 0; i++) {
      const e = this.espacos[i];
      if (e && e.item === item && e.qtd < limite) {
        const cabe = Math.min(limite - e.qtd, resto);
        e.qtd += cabe;
        resto -= cabe;
      }
    }
    // 2) ocupa espaços vazios (a hotbar vem primeiro, pois são os índices 0 a 8)
    for (let i = 0; i < this.espacos.length && resto > 0; i++) {
      if (!this.espacos[i]) {
        const poe = Math.min(limite, resto);
        this.espacos[i] = { item, qtd: poe };
        resto -= poe;
      }
    }
    if (resto !== qtd) this.notificar();
    return resto;
  }

  /** Tira itens de um espaço. Devolve quanto foi removido. */
  remover(indice, qtd = 1) {
    const e = this.espacos[indice];
    if (!e) return 0;
    const tirou = Math.min(qtd, e.qtd);
    e.qtd -= tirou;
    if (e.qtd <= 0) this.espacos[indice] = null;
    if (tirou > 0) this.notificar();
    return tirou;
  }

  /** O que está no espaço escolhido da hotbar (ou null) */
  itemSelecionado() {
    const e = this.espacos[this.selecionado];
    return e ? { item: e.item, qtd: e.qtd } : null;
  }

  /** Registra uma função chamada sempre que o inventário mudar */
  aoMudar(fn) {
    this.ouvintes.push(fn);
  }

  /** Avisa os ouvintes (chame depois de mexer em `espacos` diretamente) */
  notificar() {
    for (const fn of this.ouvintes) fn(this);
  }

  serializar() {
    return {
      espacos: this.espacos.map((e) => (e ? { item: e.item, qtd: e.qtd } : null)),
      selecionado: this.selecionado,
    };
  }

  /** Carrega dados salvos, ignorando o que for inválido */
  carregar(dados) {
    this.espacos.fill(null);
    this.selecionado = 0;
    if (dados && Array.isArray(dados.espacos)) {
      for (let i = 0; i < this.espacos.length && i < dados.espacos.length; i++) {
        const e = dados.espacos[i];
        if (!e || typeof e.item !== 'string' || !obterItem(e.item)) continue;
        const qtd = Math.floor(Number(e.qtd));
        if (!(qtd > 0)) continue;
        this.espacos[i] = { item: e.item, qtd: Math.min(qtd, this.limiteDaPilha(e.item)) };
      }
      const s = Number(dados.selecionado);
      if (Number.isInteger(s) && s >= 0 && s < CONFIG.ESPACOS_HOTBAR) this.selecionado = s;
    }
    this.notificar();
  }
}
