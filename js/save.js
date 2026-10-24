// =====================================================================
// Hackraft - Salvar e carregar o jogo (localStorage do navegador)
// ---------------------------------------------------------------------
// O estado é um objeto simples:
//   { versao: 3, semente, modificacoes, jogador, inventario, hora,
//     jogadores, equipamento, itensChao }
//
// Versões:
//   1 (Fase 1): sem `jogadores`
//   2 (Fase 2): + `jogadores: { [apelido]: { pos, yaw, pitch, inventario } }`,
//               a posição e o inventário de quem visitou o mundo pela rede
//   3 (Fase 3): + `equipamento` (do anfitrião), `itensChao` (itens largados
//               no mundo) e `jogadores[apelido].equipamento`
//
// Um save antigo continua funcionando: o que não existia naquela versão
// vem "vazio" (sem visitantes, sem equipamento, sem itens no chão).
//
// Só o anfitrião (ou quem joga sozinho) salva. O cliente NUNCA chama
// salvarJogo, senão o mundo de outra pessoa apagaria o dele.
// =====================================================================

import { CONFIG } from './config.js';

const VERSOES_ACEITAS = [1, 2, 3];

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
 * Aceita as versões 1 a 3. O que faltar das versões antigas é preenchido:
 * `jogadores` = {}, `equipamento` = null, `itensChao` = [].
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
    if (!estado.equipamento || typeof estado.equipamento !== 'object' || Array.isArray(estado.equipamento)) {
      estado.equipamento = null;
    }
    if (!Array.isArray(estado.itensChao)) estado.itensChao = [];
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
