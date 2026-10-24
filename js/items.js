// =====================================================================
// Hackraft - Lista de itens
// ---------------------------------------------------------------------
// Um item é qualquer coisa que pode ficar no inventário. Ele é
// identificado por um nome em texto (ex.: 'grama').
// Tipos: 'bloco' | 'material' | 'roupa' | 'armadura' | 'arma' | 'acessorio' | 'poder'
// Este arquivo não usa three nem o DOM (dá para testar no Node).
// =====================================================================

import { CONFIG } from './config.js';
import { BLOCOS } from './blocks.js';

// ITENS.get('grama') → { nome, rotulo, tipo, descricao, bloco, pilha, visual, bonus, parte, material, defesa, dano }
export const ITENS = new Map();

/**
 * Cadastra um item.
 *  - tipo: 'bloco', 'roupa', 'armadura', 'arma' ou 'acessorio'
 *  - bloco: id do bloco que ele coloca no mundo (só para tipo 'bloco')
 *  - pilha: quantos cabem num mesmo espaço do inventário
 *  - descricao: texto curto mostrado na dica
 *  - roupa: visual e bonus { velocidade?, defesa?, silencioso? }
 *  - armadura: parte, material e defesa
 *  - arma: visual e dano
 *  - acessorio: visual
 *  - poder (tipo 'poder'): poder, duracao (segundos), cor (CSS) e ataque (true = atira)
 */
export function registrarItem(def) {
  ITENS.set(def.nome, {
    nome: def.nome,
    rotulo: def.rotulo,
    tipo: def.tipo,
    descricao: def.descricao ?? '',
    bloco: def.bloco ?? null,
    pilha: def.pilha ?? CONFIG.TAMANHO_PILHA,
    visual: def.visual ?? null,
    bonus: def.bonus ?? null,
    parte: def.parte ?? null,
    material: def.material ?? null,
    defesa: def.defesa ?? 0,
    dano: def.dano ?? 0,
    poder: def.poder ?? null,
    duracao: def.duracao ?? 0,
    cor: def.cor ?? null,
    ataque: def.ataque ?? false,
  });
}

// Descrições dos itens de bloco da Fase 6
const DESCRICOES_BLOCOS = {
  tabuas: 'Madeira polida para construir casas.',
  vidro: 'Transparente: deixa a luz e a vista passarem.',
  tijolos: 'Parede forte e bonita, de cor vermelha.',
  porta: 'Ocupa 2 blocos de altura. Botão direito para abrir e fechar.',
  tocha: 'Ilumina o escuro. Pode ficar no chão ou na parede.',
  bau: 'Guarde até 27 pilhas de itens. Botão direito para abrir.',
};

// Todo bloco que solta item vira automaticamente um item do tipo 'bloco'
for (const b of BLOCOS) {
  if (b && b.item === b.nome) {
    registrarItem({ nome: b.nome, rotulo: b.rotulo, tipo: 'bloco', bloco: b.id, descricao: DESCRICOES_BLOCOS[b.nome] });
  }
}

// ---------------------------------------------------------------------
// Materiais (Fase 6): servem para fazer outras coisas
// ---------------------------------------------------------------------
registrarItem({
  nome: 'graveto', rotulo: 'Graveto', tipo: 'material', pilha: 64,
  descricao: 'Feito de tábuas. Use para fazer tochas.',
});
registrarItem({
  nome: 'carvao', rotulo: 'Carvão', tipo: 'material', pilha: 64,
  descricao: 'Pedra preta que queima. Use para fazer tochas.',
});

// ---------------------------------------------------------------------
// Roupas
// ---------------------------------------------------------------------
const ROUPAS = [
  ['ninja', 'Roupa de ninja', 'Silêncio total. Ninguém ouve seus passos!', { velocidade: 0.1, silencioso: true }],
  ['cavaleiro', 'Roupa de cavaleiro', 'Para quem defende o reino com honra.', { defesa: 2 }],
  ['mago', 'Roupa de mago', 'Estrelas, mistério e um toque de magia.', {}],
  ['astronauta', 'Roupa de astronauta', 'Pronta para passear na Lua.', {}],
  ['pirata', 'Roupa de pirata', 'Yo-ho-ho! Cadê o tesouro?', {}],
  ['hacker', 'Roupa de hacker', 'Verde neon e muito código.', {}],
];
for (const [visual, rotulo, descricao, bonus] of ROUPAS) {
  registrarItem({ nome: 'roupa_' + visual, rotulo, tipo: 'roupa', descricao, pilha: 1, visual, bonus });
}

// ---------------------------------------------------------------------
// Armaduras (couro e ferro)
// ---------------------------------------------------------------------
const PARTES = [
  ['capacete', 'Capacete', 'capacete'],
  ['peitoral', 'Peitoral', 'peitoral'],
  ['calca', 'Calça', 'calca'],
  ['botas', 'Botas', 'botas'],
];
const MATERIAIS = [
  // [id, texto do rótulo, defesa por parte (capacete, peitoral, calca, botas), descrição]
  ['couro', 'de couro', [1, 3, 2, 1], 'Leve e macio, protege um pouquinho.'],
  ['ferro', 'de ferro', [2, 6, 5, 2], 'Pesado e resistente: aguenta muita pancada!'],
];
for (const [material, texto, defesas, descricao] of MATERIAIS) {
  PARTES.forEach(([parte, nomeParte, prefixo], i) => {
    registrarItem({
      nome: `${prefixo}_${material}`,
      rotulo: `${nomeParte} ${texto}`,
      tipo: 'armadura',
      descricao,
      pilha: 1,
      parte,
      material,
      defesa: defesas[i],
    });
  });
}

// ---------------------------------------------------------------------
// Arma e acessórios
// ---------------------------------------------------------------------
registrarItem({
  nome: 'espada_madeira', rotulo: 'Espada de madeira', tipo: 'arma', pilha: 1,
  descricao: 'Boa para treinar e brincar de duelo.', visual: 'espada_madeira', dano: 4,
});
registrarItem({
  nome: 'capa_vermelha', rotulo: 'Capa vermelha', tipo: 'acessorio', pilha: 1,
  descricao: 'Balança ao vento como a de um herói.', visual: 'capa_vermelha',
});
registrarItem({
  nome: 'capa_azul', rotulo: 'Capa azul', tipo: 'acessorio', pilha: 1,
  descricao: 'Elegante como um príncipe do reino.', visual: 'capa_azul',
});

// ---------------------------------------------------------------------
// Cristais de poder (Fase 5): soltos pelos minérios, usados com a tecla Q
// ---------------------------------------------------------------------
const PODERES = [
  // [sufixo, rótulo, poder, cor, ataque, descrição]
  ['azul', 'Cristal azul', 'velocidade', '#3fa9ff', false, 'Supervelocidade por 30 s.'],
  ['vermelho', 'Cristal vermelho', 'pulo', '#ff3f4f', false, 'Superpulo por 30 s, sem dano de queda.'],
  ['dourado', 'Cristal dourado', 'voar', '#ffcf3f', false, 'Você voa por 30 s.'],
  ['verde', 'Cristal verde', 'regeneracao', '#3fff7a', false, 'Recupera vida aos poucos por 30 s.'],
  ['roxo', 'Cristal roxo', 'soco', '#b44fff', false, 'Quebra qualquer bloco na hora por 30 s.'],
  ['fogo', 'Cristal de fogo', 'fogo', '#ff8a2a', true, 'Atira bolas de fogo por 30 s. Queima madeira e folhas.'],
  ['raio', 'Cristal de raio', 'raio', '#eef6ff', true, 'Solta raios na mira por 30 s.'],
  ['gelo', 'Cristal de gelo', 'gelo', '#a8f0ff', true, 'Atira gelo por 30 s. Congela a água.'],
];

/** Nomes de todos os cristais de poder */
export const CRISTAIS = [];

for (const [sufixo, rotulo, poder, cor, ataque, texto] of PODERES) {
  const nome = 'cristal_' + sufixo;
  CRISTAIS.push(nome);
  registrarItem({
    nome, rotulo, tipo: 'poder', pilha: 16,
    descricao: `${texto} Aperte Q para usar.`,
    poder, duracao: 30, cor, ataque,
  });
}

// ---------------------------------------------------------------------
// Slots de equipamento
// ---------------------------------------------------------------------
export const SLOTS_EQUIPAMENTO = ['roupa', 'capacete', 'peitoral', 'calca', 'botas', 'mao', 'acessorio'];

/** Em qual slot o item vai (ou null se não for equipável) */
export function slotDoItem(nome) {
  const item = ITENS.get(nome);
  if (!item) return null;
  switch (item.tipo) {
    case 'roupa': return 'roupa';
    case 'armadura': return item.parte;
    case 'arma': return 'mao';
    case 'acessorio': return 'acessorio';
    default: return null;
  }
}

/** Itens que podem sair de um presente misterioso (a roupa hacker fica de fora) */
export const TABELA_PRESENTE = [
  'roupa_ninja', 'roupa_cavaleiro', 'roupa_mago', 'roupa_astronauta', 'roupa_pirata',
  'capacete_couro', 'peitoral_couro', 'calca_couro', 'botas_couro',
  'capacete_ferro', 'peitoral_ferro', 'calca_ferro', 'botas_ferro',
  'espada_madeira', 'capa_vermelha', 'capa_azul',
];

/** Descrição do item (ou undefined se não existir) */
export function obterItem(nome) {
  return ITENS.get(nome);
}
