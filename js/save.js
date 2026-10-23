// =====================================================================
// Hackraft - Salvar e carregar o jogo (localStorage do navegador)
// ---------------------------------------------------------------------
// O estado é um objeto simples:
//   { versao: 1, semente, modificacoes, jogador, inventario, hora }
// =====================================================================

import { CONFIG } from './config.js';

/** Guarda o estado. Devolve true se deu certo, false se falhou (ex.: sem espaço). */
export function salvarJogo(estado) {
  try {
    localStorage.setItem(CONFIG.CHAVE_SAVE, JSON.stringify(estado));
    return true;
  } catch (erro) {
    console.warn('Hackraft: não foi possível salvar o jogo', erro);
    return false;
  }
}

/** Lê o jogo salvo. Devolve o estado, ou null se não existir ou for inválido. */
export function carregarJogo() {
  try {
    const texto = localStorage.getItem(CONFIG.CHAVE_SAVE);
    if (!texto) return null;
    const estado = JSON.parse(texto);
    if (!estado || estado.versao !== 1) return null;
    return estado;
  } catch (erro) {
    console.warn('Hackraft: save ilegível, ignorando', erro);
    return null;
  }
}

/** Apaga o jogo salvo. */
export function apagarJogo() {
  try {
    localStorage.removeItem(CONFIG.CHAVE_SAVE);
  } catch (erro) {
    console.warn('Hackraft: não foi possível apagar o save', erro);
  }
}
