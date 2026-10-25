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
  // Minérios de cristal (Fase 5)
  MINERIO_AZUL: 10,
  MINERIO_VERMELHO: 11,
  MINERIO_DOURADO: 12,
  MINERIO_VERDE: 13,
  MINERIO_ROXO: 14,
  MINERIO_FOGO: 15,
  MINERIO_RAIO: 16,
  MINERIO_GELO: 17,
  GELO: 18,
  // Construção (Fase 6)
  TABUAS: 19,
  VIDRO: 20,
  TIJOLOS: 21,
  PORTA: 22,
  TOCHA: 23,
  BAU: 24,
  MINERIO_CARVAO: 25,
  // Metais e forja (Fase 9)
  MINERIO_COBRE: 26,
  MINERIO_FERRO: 27,
  MINERIO_PRATA: 28,
  MINERIO_OURO: 29,
  MINERIO_DIAMANTE: 30,
  MINERIO_DRACONIO: 31,
  FORJA: 32,
  // Alfaiate, fogueira e ovo de dragão (Fases 10 e 11)
  MESA_ALFAIATE: 33,
  FOGUEIRA: 34,
  OVO_DRAGAO: 35,
  // Dragões elementais: um ovo para cada elemento (o de fogo é o OVO_DRAGAO)
  // e os enfeites dos ninhos de gelo e de veneno
  OVO_DRAGAO_GELO: 36,
  OVO_DRAGAO_VENENO: 37,
  OVO_DRAGAO_RAIO: 38,
  NEVE: 39,
  MUSGO_TOXICO: 40,
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
 *  - brilho: o bloco brilha pulsando, visível até no escuro (padrão false).
 *    A malha passa este valor para o shader (minérios de cristal).
 *  - modelo: forma do bloco: 'cubo' (padrão), 'porta' ou 'tocha'
 *  - luz: luz própria de 0 a 15 (padrão 0; tocha 14, minérios de cristal 5)
 *  - juntarIguais: não desenha a face entre dois blocos iguais (vidro). Padrão false.
 *  - interativo: o botão direito usa o bloco em vez de colocar outro (baú, porta). Padrão false.
 *  - texturaFrente: nome da textura da face da frente (baú). null = sem frente própria.
 *  - dropExtra: lista de drops sorteados ao quebrar, além do `item`:
 *    [{ item: 'maca', chance: 0.08 }] (chance de 0 a 1, 1 item por acerto). Padrão [].
 *  - ovoDragao: elemento do filhote que nasce deste ovo ('fogo' | 'gelo' |
 *    'veneno' | 'raio'); null nos blocos que não são ovo. Padrão null.
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
    brilho: def.brilho ?? false,
    modelo: def.modelo ?? 'cubo',
    luz: def.luz ?? 0,
    juntarIguais: def.juntarIguais ?? false,
    interativo: def.interativo ?? false,
    texturaFrente: def.texturaFrente ?? null,
    dropExtra: def.dropExtra ?? [],
    ovoDragao: def.ovoDragao ?? null,
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
  dropExtra: [{ item: 'maca', chance: 0.08 }],
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

// Minérios de cristal: [chave em B, sufixo do nome, texto do rótulo, cor]
const CRISTAIS_BLOCOS = [
  ['MINERIO_AZUL', 'azul', 'azul', '#3fa9ff'],
  ['MINERIO_VERMELHO', 'vermelho', 'vermelho', '#ff3f4f'],
  ['MINERIO_DOURADO', 'dourado', 'dourado', '#ffcf3f'],
  ['MINERIO_VERDE', 'verde', 'verde', '#3fff7a'],
  ['MINERIO_ROXO', 'roxo', 'roxo', '#b44fff'],
  ['MINERIO_FOGO', 'fogo', 'de fogo', '#ff8a2a'],
  ['MINERIO_RAIO', 'raio', 'de raio', '#eef6ff'],
  ['MINERIO_GELO', 'gelo', 'de gelo', '#a8f0ff'],
];
for (const [chave, sufixo, texto, cor] of CRISTAIS_BLOCOS) {
  registrar(B[chave], {
    nome: 'minerio_' + sufixo,
    rotulo: 'Minério de cristal ' + texto,
    texturas: igual('minerio_' + sufixo),
    dureza: 2, som: 'pedra',
    item: 'cristal_' + sufixo,
    xray: true, corXray: cor,
    brilho: true, luz: 5,
  });
}
registrar(B.GELO, {
  nome: 'gelo', rotulo: 'Gelo', texturas: igual('gelo'),
  dureza: 0.5, som: 'pedra',
});

registrar(B.TABUAS, {
  nome: 'tabuas', rotulo: 'Tábuas', texturas: igual('tabuas'),
  dureza: 0.8, som: 'madeira',
});
registrar(B.VIDRO, {
  nome: 'vidro', rotulo: 'Vidro', texturas: igual('vidro'),
  opaco: false, recorte: true, juntarIguais: true,
  dureza: 0.3, som: 'pedra', // som próprio do vidro fica para depois
});
registrar(B.TIJOLOS, {
  nome: 'tijolos', rotulo: 'Tijolos', texturas: igual('tijolos'),
  dureza: 1.5, som: 'pedra',
});
registrar(B.PORTA, {
  nome: 'porta', rotulo: 'Porta',
  // o mundo escolhe cima/baixo pelo estado (topo = metade de cima, lado = metade de baixo)
  texturas: { topo: 'porta_cima', lado: 'porta_baixo', baixo: 'porta_baixo' },
  modelo: 'porta', opaco: false, interativo: true,
  dureza: 1, som: 'madeira', item: 'porta',
});
registrar(B.TOCHA, {
  nome: 'tocha', rotulo: 'Tocha', texturas: igual('tocha'),
  modelo: 'tocha', solido: false, opaco: false, luz: 14,
  dureza: 0, som: 'madeira', item: 'tocha',
});
registrar(B.BAU, {
  nome: 'bau', rotulo: 'Baú',
  texturas: { topo: 'bau_topo', lado: 'bau_lado', baixo: 'bau_topo' },
  texturaFrente: 'bau_frente',
  interativo: true, dureza: 1, som: 'madeira', item: 'bau',
});
registrar(B.MINERIO_CARVAO, {
  nome: 'minerio_carvao', rotulo: 'Minério de carvão', texturas: igual('minerio_carvao'),
  dureza: 1.5, som: 'pedra', item: 'carvao',
});

// Minérios de metal (Fase 9): [chave em B, nome, rótulo, dureza, item que cai, raio-X?, cor do raio-X, brilha?]
// Só o diamante e o dracônio aparecem no raio-X; só o dracônio brilha e dá luz.
const METAIS_BLOCOS = [
  ['MINERIO_COBRE', 'minerio_cobre', 'Minério de cobre', 2, 'cobre_bruto', false, null, false],
  ['MINERIO_FERRO', 'minerio_ferro', 'Minério de ferro', 2.5, 'ferro_bruto', false, null, false],
  ['MINERIO_PRATA', 'minerio_prata', 'Minério de prata', 3, 'prata_bruta', false, null, false],
  ['MINERIO_OURO', 'minerio_ouro', 'Minério de ouro', 3, 'ouro_bruto', false, null, false],
  ['MINERIO_DIAMANTE', 'minerio_diamante', 'Minério de diamante', 4, 'diamante', true, '#4fe8ff', false],
  ['MINERIO_DRACONIO', 'minerio_draconio', 'Minério de dracônio', 5, 'draconio_bruto', true, '#e0306e', true],
];
for (const [chave, nome, rotulo, dureza, item, xray, corXray, brilha] of METAIS_BLOCOS) {
  registrar(B[chave], {
    nome, rotulo, texturas: igual(nome),
    dureza, som: 'pedra', item,
    xray, corXray,
    brilho: brilha, luz: brilha ? 3 : 0,
  });
}
// Forja: fornalha com bigorna em cima, boca acesa na frente
registrar(B.FORJA, {
  nome: 'forja', rotulo: 'Forja',
  texturas: { topo: 'forja_topo', lado: 'forja_lado', baixo: 'forja_lado' },
  texturaFrente: 'forja_frente',
  interativo: true, dureza: 2, som: 'pedra', item: 'forja',
});

// Mesa do alfaiate (Fase 10): topo com tecido, tesoura e fita; lados de madeira com carretéis
registrar(B.MESA_ALFAIATE, {
  nome: 'mesa_alfaiate', rotulo: 'Mesa do alfaiate',
  texturas: { topo: 'alfaiate_topo', lado: 'alfaiate_lado', baixo: 'alfaiate_lado' },
  texturaFrente: 'alfaiate_frente',
  interativo: true, dureza: 1, som: 'madeira', item: 'mesa_alfaiate',
});
// Fogueira: por enquanto um cubo opaco simples (o mundo só desenha cubo, porta e tocha)
registrar(B.FOGUEIRA, {
  nome: 'fogueira', rotulo: 'Fogueira',
  texturas: { topo: 'fogueira_topo', lado: 'fogueira_lado', baixo: 'fogueira_lado' },
  luz: 13, brilho: true, dureza: 0.5, som: 'madeira', item: 'fogueira',
});
// Ovo de dragão (Fase 11): choca perto de uma fogueira
registrar(B.OVO_DRAGAO, {
  nome: 'ovo_dragao', rotulo: 'Ovo de dragão', texturas: igual('ovo_dragao'),
  luz: 4, brilho: true, dureza: 1, som: 'pedra', item: 'ovo_dragao', ovoDragao: 'fogo',
});
// Ovos dos dragões elementais: iguais ao de fogo, mas cada um com a sua cor.
// O bloco diz qual filhote nasce (por isso são blocos separados: o player
// coloca o bloco do item, e o mobs.js lê o elemento no BLOCOS[id].ovoDragao).
const OVOS_ELEMENTAIS = [
  ['OVO_DRAGAO_GELO', 'ovo_dragao_gelo', 'Ovo de dragão de gelo', 'gelo'],
  ['OVO_DRAGAO_VENENO', 'ovo_dragao_veneno', 'Ovo de dragão venenoso', 'veneno'],
  ['OVO_DRAGAO_RAIO', 'ovo_dragao_raio', 'Ovo de dragão de raio', 'raio'],
];
for (const [chave, nome, rotulo, elemento] of OVOS_ELEMENTAIS) {
  registrar(B[chave], {
    nome, rotulo, texturas: igual(nome),
    luz: 4, brilho: true, dureza: 1, som: 'pedra', item: nome, ovoDragao: elemento,
  });
}
// Enfeites dos ninhos elementais (também dá para quebrar e construir com eles)
registrar(B.NEVE, {
  nome: 'neve', rotulo: 'Neve', texturas: igual('neve'),
  dureza: 0.4, som: 'areia',
});
registrar(B.MUSGO_TOXICO, {
  nome: 'musgo_toxico', rotulo: 'Musgo tóxico', texturas: igual('musgo_toxico'),
  brilho: true, luz: 3, dureza: 0.4, som: 'folhas',
});

/** Elemento do filhote que nasce do ovo `id` ('fogo', 'gelo'...) ou null se não for ovo */
export function elementoDoOvo(id) {
  const b = BLOCOS[id];
  return b ? b.ovoDragao : null;
}

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
    .flatMap((b) => [b.texturas.topo, b.texturas.lado, b.texturas.baixo, b.texturaFrente])
    .filter(Boolean)
)];
