// =====================================================================
// Hackraft - Lista de itens
// ---------------------------------------------------------------------
// Um item é qualquer coisa que pode ficar no inventário. Ele é
// identificado por um nome em texto (ex.: 'grama').
// Na Fase 1 todo item é um bloco. Nas próximas fases entram aqui as
// roupas, os poderes, as armas e as armaduras.
// =====================================================================

import { CONFIG } from './config.js';
import { BLOCOS } from './blocks.js';

// ITENS.get('grama') → { nome, rotulo, tipo, bloco, pilha }
export const ITENS = new Map();

/**
 * Cadastra um item.
 *  - tipo: 'bloco' (por enquanto o único)
 *  - bloco: id do bloco que ele coloca no mundo (só para tipo 'bloco')
 *  - pilha: quantos cabem num mesmo espaço do inventário
 */
export function registrarItem(def) {
  ITENS.set(def.nome, {
    nome: def.nome,
    rotulo: def.rotulo,
    tipo: def.tipo,
    bloco: def.bloco ?? null,
    pilha: def.pilha ?? CONFIG.TAMANHO_PILHA,
  });
}

// Todo bloco que solta item vira automaticamente um item do tipo 'bloco'
for (const b of BLOCOS) {
  if (b && b.item === b.nome) {
    registrarItem({ nome: b.nome, rotulo: b.rotulo, tipo: 'bloco', bloco: b.id });
  }
}

/** Descrição do item (ou undefined se não existir) */
export function obterItem(nome) {
  return ITENS.get(nome);
}
