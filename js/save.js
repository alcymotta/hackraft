// =====================================================================
// Hackraft - Salvar e carregar o jogo (localStorage do navegador)
// ---------------------------------------------------------------------
// O estado é um objeto simples:
//   { versao: 2, semente, modificacoes, jogador, inventario, hora, jogadores }
//
// Versões:
//   1 (Fase 1): sem `jogadores`
//   2 (Fase 2): + `jogadores: { [apelido]: { pos, yaw, pitch, inventario } }`,
//               a posição e o inventário de quem visitou o mundo pela rede
//
// Só o anfitrião (ou quem joga sozinho) salva. O cliente NUNCA chama
// salvarJogo, senão o mundo de outra pessoa apagaria o dele.
// =====================================================================

import { CONFIG } from './config.js';

const VERSOES_ACEITAS = [1, 2];

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

/**
 * Lê o jogo salvo. Devolve o estado, ou null se não existir ou for inválido.
 * Aceita as versões 1 e 2. Na versão 1, `jogadores` vem como objeto vazio.
 */
export function carregarJogo() {
  try {
    const texto = localStorage.getItem(CONFIG.CHAVE_SAVE);
    if (!texto) return null;
    const estado = JSON.parse(texto);
    if (!estado || typeof estado !== 'object' || !VERSOES_ACEITAS.includes(estado.versao)) return null;
    if (!estado.jogadores || typeof estado.jogadores !== 'object' || Array.isArray(estado.jogadores)) {
      estado.jogadores = {};
    }
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
