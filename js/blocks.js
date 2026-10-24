// =====================================================================
// Hackraft - Lista de blocos
// ---------------------------------------------------------------------
// Cada tipo de bloco tem um número (id), usado para guardar o mundo de
// forma compacta, e um nome (texto), usado no inventário.
// Para criar um bloco novo: acrescente o id em B e chame registrar().
// =====================================================================

// Números de cada bloco. O 0 é sempre "ar" (vazio).
export const B = {
  AR: 0,
  GRAMA: 1,
  TERRA: 2,
  PEDRA: 3,
  AREIA: 4,
  AGUA: 5,
  TRONCO: 6,
  FOLHAS: 7,
  ROCHA_MATRIZ: 8,
  PRESENTE: 9,
};

// BLOCOS[id] devolve a descrição completa do bloco
export const BLOCOS = [];

// Tabelas rápidas (consultadas milhares de vezes por quadro)
export const SOLIDO = new Uint8Array(256);  // 1 = o jogador colide
export const OPACO = new Uint8Array(256);   // 1 = esconde a face do vizinho
export const LIQUIDO = new Uint8Array(256); // 1 = dá para nadar

const porNome = new Map();

/**
 * Cadastra um bloco.
 * Campos:
 *  - nome: identificador em texto (também é o nome do item que ele vira)
 *  - rotulo: nome bonito mostrado na tela
 *  - texturas: { topo, lado, baixo } com nomes de texturas (ver textures.js)
 *  - solido: o jogador colide com ele
 *  - opaco: não dá para ver através dele
 *  - liquido: dá para nadar dentro
 *  - recorte: tem partes transparentes "furadas" (ex.: folhas)
 *  - dureza: segundos segurando o botão para quebrar (Infinity = inquebrável)
 *  - som: tipo de som de passo/quebra ('grama', 'terra', 'pedra', 'areia', 'madeira', 'folhas', 'agua')
 *  - item: nome do item que cai ao quebrar (null = não cai nada)
 *  - sorteio: nome de uma tabela de sorteio (ex.: 'presente'). Ao quebrar, o jogador
 *    ganha 1 item aleatório dessa tabela (null = sem sorteio)
 *  - xray: aparece com contorno brilhante no raio-X do modo hacker (padrão false).
 *    Os minérios de poder da Fase 5 vão usar este campo.
 *  - corXray: cor CSS do contorno do raio-X (null = verde padrão)
 */
function registrar(id, def) {
  const bloco = {
    id,
    nome: def.nome,
    rotulo: def.rotulo,
    texturas: def.texturas ?? null,
    solido: def.solido ?? true,
    opaco: def.opaco ?? true,
    liquido: def.liquido ?? false,
    recorte: def.recorte ?? false,
    dureza: def.dureza ?? 1,
    som: def.som ?? 'pedra',
    item: def.item === undefined ? def.nome : def.item,
    sorteio: def.sorteio ?? null,
    xray: def.xray ?? false,
    corXray: def.corXray ?? null,
  };
  BLOCOS[id] = bloco;
  SOLIDO[id] = bloco.solido ? 1 : 0;
  OPACO[id] = bloco.opaco ? 1 : 0;
  LIQUIDO[id] = bloco.liquido ? 1 : 0;
  porNome.set(bloco.nome, id);
}

// Atalho para blocos com a mesma textura em todas as faces
const igual = (t) => ({ topo: t, lado: t, baixo: t });

registrar(B.AR, {
  nome: 'ar', rotulo: 'Ar', texturas: null,
  solido: false, opaco: false, dureza: 0, som: null, item: null,
});
registrar(B.GRAMA, {
  nome: 'grama', rotulo: 'Grama',
  texturas: { topo: 'grama_topo', lado: 'grama_lado', baixo: 'terra' },
  dureza: 0.6, som: 'grama',
});
registrar(B.TERRA, {
  nome: 'terra', rotulo: 'Terra', texturas: igual('terra'),
  dureza: 0.5, som: 'terra',
});
registrar(B.PEDRA, {
  nome: 'pedra', rotulo: 'Pedra', texturas: igual('pedra'),
  dureza: 1.5, som: 'pedra',
});
registrar(B.AREIA, {
  nome: 'areia', rotulo: 'Areia', texturas: igual('areia'),
  dureza: 0.5, som: 'areia',
});
registrar(B.AGUA, {
  nome: 'agua', rotulo: 'Água', texturas: igual('agua'),
  solido: false, opaco: false, liquido: true,
  dureza: Infinity, som: 'agua', item: null,
});
registrar(B.TRONCO, {
  nome: 'tronco', rotulo: 'Tronco',
  texturas: { topo: 'tronco_topo', lado: 'tronco_lado', baixo: 'tronco_topo' },
  dureza: 1.0, som: 'madeira',
});
registrar(B.FOLHAS, {
  nome: 'folhas', rotulo: 'Folhas', texturas: igual('folhas'),
  opaco: false, recorte: true, dureza: 0.2, som: 'folhas',
});
registrar(B.ROCHA_MATRIZ, {
  nome: 'rocha_matriz', rotulo: 'Rocha-matriz', texturas: igual('rocha_matriz'),
  dureza: Infinity, som: 'pedra', item: null,
});
registrar(B.PRESENTE, {
  nome: 'presente', rotulo: 'Presente misterioso',
  texturas: { topo: 'presente_topo', lado: 'presente_lado', baixo: 'presente_lado' },
  dureza: 0.3, som: 'madeira', item: null, sorteio: 'presente',
  xray: true, corXray: '#ffd23f',
});

/** Devolve o id do bloco a partir do nome (ou undefined se não existir) */
export function blocoPorNome(nome) {
  return porNome.get(nome);
}

/**
 * Nome da textura de uma face do bloco.
 * face: 'topo', 'lado' ou 'baixo'
 */
export function texturaDaFace(id, face) {
  const t = BLOCOS[id]?.texturas;
  return t ? t[face] : null;
}

/** Lista (sem repetição) de todas as texturas que os blocos usam */
export const NOMES_TEXTURAS = [...new Set(
  BLOCOS.filter((b) => b && b.texturas)
    .flatMap((b) => [b.texturas.topo, b.texturas.lado, b.texturas.baixo])
)];
