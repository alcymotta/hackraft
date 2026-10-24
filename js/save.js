// =====================================================================
// Hackraft - Salvar e carregar o jogo (localStorage do navegador)
// ---------------------------------------------------------------------
// O estado é um objeto simples:
//   { versao: 6, semente, modificacoes, jogador, inventario, hora,
//     jogadores, equipamento, itensChao, casa, baus }
//
// Versões:
//   1 (Fase 1): sem `jogadores`
//   2 (Fase 2): + `jogadores: { [apelido]: { pos, yaw, pitch, inventario } }`,
//               a posição e o inventário de quem visitou o mundo pela rede
//   3 (Fase 3): + `equipamento` (do anfitrião), `itensChao` (itens largados
//               no mundo) e `jogadores[apelido].equipamento`
//   4 (Fase 4): + `casa: [x, y, z]` (do anfitrião, comando /setcasa) e
//               `jogadores[apelido].casa`
//
//   5 (Fase 5): `jogador.vida` (a vida do anfitrião vem do jogador.serializar)
//   7 (Fase 7): `jogador.xpTotal` (dentro de `jogador`; a versão continua 6, mobs não são salvos)
//   8 (Fases 8 a 10): nada novo no save (XP já vai em `jogador.xpTotal`); a versão 8 é aceita por segurança
//   6 (Fase 6): + `baus` ("x,y,z" → 27 espaços) e as `modificacoes` passam a ter
//               o estado do bloco: [x, y, z, id, estado]
//
// Um save antigo continua funcionando: o que não existia naquela versão
// vem "vazio" (sem visitantes, sem equipamento, sem itens no chão).
//
// Só o anfitrião (ou quem joga sozinho) salva. O cliente NUNCA chama
// salvarJogo, senão o mundo de outra pessoa apagaria o dele.
// =====================================================================

import { CONFIG } from './config.js';

const VERSOES_ACEITAS = [1, 2, 3, 4, 5, 6, 7, 8];

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
 * Aceita as versões 1 a 8. O que faltar das versões antigas é preenchido:
 * `jogadores` = {}, `equipamento` = null, `itensChao` = [], `casa` = null, `baus` = {}.
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
    if (!estado.baus || typeof estado.baus !== 'object' || Array.isArray(estado.baus)) estado.baus = {};
    const c = estado.casa;
    if (!Array.isArray(c) || c.length !== 3 || !c.every(Number.isFinite)) estado.casa = null;
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
