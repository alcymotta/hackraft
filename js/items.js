// =====================================================================
// Hackraft - Lista de itens
// ---------------------------------------------------------------------
// Um item é qualquer coisa que pode ficar no inventário. Ele é
// identificado por um nome em texto (ex.: 'grama').
// Tipos: 'bloco' | 'material' | 'comida' (cura, enjoo) | 'roupa' | 'armadura' | 'arma' | 'acessorio' | 'poder'
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
    cura: def.cura ?? 0,
    enjoo: def.enjoo ?? 0,
    // Fase 9: efeito ao acertar ('fogo' | 'veneno'), resistência da armadura e melhoria
    efeitoArma: def.efeitoArma ?? null,
    resistencia: def.resistencia ?? null,
    base: def.nome,   // nome sem o sufixo +N (nos itens normais é o próprio nome)
    melhoria: 0,      // nível de melhoria (0 a 5)
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
  forja: 'Funde metais, forja espadas e armaduras e melhora equipamentos. Botão direito para usar.',
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
// Materiais dos mobs (Fase 7)
// ---------------------------------------------------------------------
registrarItem({
  nome: 'pena', rotulo: 'Pena', tipo: 'material', pilha: 64,
  descricao: 'Leve como o ar. Solta pela galinha.',
});
registrarItem({
  nome: 'fio_seda', rotulo: 'Fio de seda', tipo: 'material', pilha: 64,
  descricao: 'Fino e muito forte. Vem das aranhas.',
});

// ---------------------------------------------------------------------
// Comidas (Fase 7): segure o botão direito para comer. Campo `cura` = vida
// recuperada; `enjoo` = chance (0 a 1) de tirar 1 de vida ao comer.
// ---------------------------------------------------------------------
/** Nomes de todas as comidas */
export const COMIDAS = [];
const LISTA_COMIDAS = [
  // [nome, rótulo, cura, descrição, enjoo]
  ['costeleta', 'Costeleta de porco', 6, 'Suculenta! Segure o botão direito para comer.', 0],
  ['coxinha', 'Coxinha de galinha', 4, 'Crocante e dourada. Segure o botão direito para comer.', 0],
  ['maca', 'Maçã', 3, 'Uma por dia... Segure o botão direito para comer.', 0],
  ['carne_podre', 'Carne podre', 1, 'Eca! Pode dar enjoo. Segure o botão direito para comer.', 0.5],
];
for (const [nome, rotulo, cura, descricao, enjoo] of LISTA_COMIDAS) {
  COMIDAS.push(nome);
  registrarItem({ nome, rotulo, tipo: 'comida', pilha: 64, descricao, cura, enjoo });
}

// ---------------------------------------------------------------------
// Metais, barras e gemas (Fase 9)
// ---------------------------------------------------------------------
// Brutos saem dos minérios; as barras são fundidas na forja (1 bruto + 1 carvão).
const LISTA_METAIS = [
  // [nome, rótulo, descrição]
  ['cobre_bruto', 'Cobre bruto', 'Pedaços de cobre. Derreta na forja para fazer barras.'],
  ['ferro_bruto', 'Ferro bruto', 'Pedaços de ferro. Derreta na forja para fazer barras.'],
  ['prata_bruta', 'Prata bruta', 'Pedaços de prata. Derreta na forja para fazer barras.'],
  ['ouro_bruto', 'Ouro bruto', 'Pedaços de ouro. Derreta na forja para fazer barras.'],
  ['draconio_bruto', 'Dracônio bruto', 'Metal raro dos dragões. Derreta na forja para fazer barras.'],
  ['barra_cobre', 'Barra de cobre', 'Barra de cobre. Use na forja para fazer equipamentos.'],
  ['barra_ferro', 'Barra de ferro', 'Barra de ferro. Use na forja para fazer equipamentos.'],
  ['barra_prata', 'Barra de prata', 'Barra de prata. Use na forja para fazer equipamentos.'],
  ['barra_ouro', 'Barra de ouro', 'Barra de ouro. Use na forja para fazer equipamentos.'],
  ['barra_draconio', 'Barra de dracônio', 'Barra do metal dos dragões. Use na forja para fazer equipamentos.'],
  ['diamante', 'Diamante', 'A gema mais dura. Use na forja para fazer equipamentos.'],
  // Chefões da Fase 8 (já registrados aqui para a forja funcionar)
  ['escama_dragao', 'Escama de dragão', 'Escama quente e vermelha. Vale uma armadura!'],
  ['escama_hidra', 'Escama de hidra', 'Escama verde-azulada e viscosa. Vale uma armadura!'],
];
for (const [nome, rotulo, descricao] of LISTA_METAIS) {
  registrarItem({ nome, rotulo, tipo: 'material', pilha: 64, descricao });
}

/** As 4 partes de uma armadura, na ordem das defesas */
export const PARTES_ARMADURA = ['capacete', 'peitoral', 'calca', 'botas'];

/**
 * Materiais de equipamento (Fase 9). Para cada um:
 *  - rotulo: "de cobre" (vai depois do nome da peça)
 *  - dano: dano da espada (null = não tem espada deste material)
 *  - defesa: [capacete, peitoral, calça, botas] (null = não tem armadura)
 *  - item: o que se gasta para forjar e melhorar (barra, gema ou escama)
 *  - cor: [r, g, b] do material (ícones e brilho da melhoria)
 *  - descricao: frase curta
 *  - resistencia: (opcional) resistência extra da armadura
 *  - existente: true = já existia antes da Fase 9 (não é gerado de novo)
 * Nomes dos itens: espada_<material>, capacete_<material>, peitoral_..., calca_..., botas_...
 */
export const MATERIAIS_EQUIP = {
  madeira: { rotulo: 'de madeira', dano: 4, defesa: null, item: 'tabuas', cor: [196, 154, 92], descricao: 'Boa para treinar e brincar de duelo.', existente: true },
  couro: { rotulo: 'de couro', dano: null, defesa: [1, 3, 2, 1], item: 'couro_orc', cor: [150, 98, 58], descricao: 'Leve e macio, protege um pouquinho.', existente: true },
  cobre: { rotulo: 'de cobre', dano: 5, defesa: [1, 3, 2, 1], item: 'barra_cobre', cor: [204, 112, 62], descricao: 'forjada com cobre alaranjado.' },
  ferro: { rotulo: 'de ferro', dano: 6, defesa: [2, 6, 5, 2], item: 'barra_ferro', cor: [206, 210, 218], descricao: 'Pesado e resistente: aguenta muita pancada!', existente: true },
  prata: { rotulo: 'de prata', dano: 7, defesa: [2, 7, 5, 2], item: 'barra_prata', cor: [220, 228, 240], descricao: 'forjada com prata brilhante.' },
  ouro: { rotulo: 'de ouro', dano: 6, defesa: [1, 4, 3, 1], item: 'barra_ouro', cor: [250, 206, 62], descricao: 'forjada com ouro: bonita e valiosa.' },
  diamante: { rotulo: 'de diamante', dano: 9, defesa: [3, 8, 6, 3], item: 'diamante', cor: [84, 226, 236], descricao: 'forjada com diamantes: dura como nada neste mundo.' },
  draconio: { rotulo: 'de dracônio', dano: 12, defesa: [4, 9, 7, 4], item: 'barra_draconio', cor: [192, 44, 104], descricao: 'forjada com o metal dos dragões.' },
  escama_dragao: { rotulo: 'de escamas de dragão', dano: null, defesa: [4, 10, 8, 4], item: 'escama_dragao', cor: [214, 58, 40], descricao: 'feita com escamas de dragão.' },
  escama_hidra: { rotulo: 'de escamas de hidra', dano: null, defesa: [4, 9, 8, 4], item: 'escama_hidra', cor: [40, 176, 156], descricao: 'feita com escamas de hidra. Protege do veneno.', resistencia: 'veneno' },
};

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
// Espadas e armaduras novas, geradas a partir da MATERIAIS_EQUIP
// (madeira, couro e as armaduras de ferro já foram registradas acima)
const NOMES_PARTES = { capacete: 'Capacete', peitoral: 'Peitoral', calca: 'Calça', botas: 'Botas' };
for (const [material, m] of Object.entries(MATERIAIS_EQUIP)) {
  if (m.dano != null && !ITENS.has('espada_' + material)) {
    registrarItem({
      nome: 'espada_' + material, rotulo: 'Espada ' + m.rotulo, tipo: 'arma', pilha: 1,
      descricao: 'Espada ' + m.rotulo + ': ' + m.descricao, visual: 'espada_' + material, dano: m.dano,
    });
  }
  if (m.defesa) {
    PARTES_ARMADURA.forEach((parte, i) => {
      const nome = `${parte}_${material}`;
      if (ITENS.has(nome)) return;
      registrarItem({
        nome, rotulo: `${NOMES_PARTES[parte]} ${m.rotulo}`, tipo: 'armadura', pilha: 1,
        descricao: `${NOMES_PARTES[parte]} ${m.rotulo}: ${m.descricao}`,
        parte, material, defesa: m.defesa[i], resistencia: m.resistencia ?? null,
      });
    });
  }
}

// Espadas dos chefões (Fase 8). O efeito é aplicado a quem leva o golpe.
registrarItem({
  nome: 'espada_dragao', rotulo: 'Espada do dragão', tipo: 'arma', pilha: 1,
  descricao: 'Lâmina em chamas: o golpe põe fogo no inimigo.', visual: 'espada_dragao', dano: 14, efeitoArma: 'fogo',
});
registrarItem({
  nome: 'espada_hidra', rotulo: 'Espada da hidra', tipo: 'arma', pilha: 1,
  descricao: 'Lâmina venenosa: o golpe envenena o inimigo.', visual: 'espada_hidra', dano: 12, efeitoArma: 'veneno',
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
  const item = obterItem(nome); // entende o sufixo +N
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

// ---------------------------------------------------------------------
// Melhorias (+1 a +5): o nível vai no nome, ex.: 'espada_ferro+2'
// ---------------------------------------------------------------------
const NIVEL_MAX_MELHORIA = 5;
const cacheMelhorias = new Map();

/** Nome sem o sufixo +N ('espada_ferro+2' vira 'espada_ferro') */
export function nomeBase(nome) {
  return String(nome).replace(/\+\d+$/, '');
}

/** Nível de melhoria do nome ('espada_ferro+2' vira 2; sem sufixo vira 0) */
export function melhoriaDe(nome) {
  const m = /\+(\d+)$/.exec(String(nome));
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Definição do item (ou undefined se não existir). Entende o sufixo +N em
 * armas e armaduras (de +1 a +5): devolve uma cópia com dano/defesa maiores,
 * guardada em cache (é sempre o mesmo objeto para o mesmo nome).
 */
export function obterItem(nome) {
  const direto = ITENS.get(nome);
  if (direto) return direto;
  if (typeof nome !== 'string') return undefined;
  const pronto = cacheMelhorias.get(nome);
  if (pronto) return pronto;
  const m = /^(.+)\+(\d+)$/.exec(nome);
  if (!m) return undefined;
  const n = parseInt(m[2], 10);
  if (String(n) !== m[2] || n < 1 || n > NIVEL_MAX_MELHORIA) return undefined;
  const base = ITENS.get(m[1]);
  if (!base || (base.tipo !== 'arma' && base.tipo !== 'armadura')) return undefined;
  const derivado = {
    ...base,
    nome,
    rotulo: `${base.rotulo} +${n}`,
    base: base.nome,
    melhoria: n,
    dano: base.tipo === 'arma' ? base.dano + n : base.dano,
    defesa: base.tipo === 'armadura' ? base.defesa + Math.ceil(n / 2) : base.defesa,
  };
  cacheMelhorias.set(nome, derivado);
  return derivado;
}
