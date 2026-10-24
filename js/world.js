// =====================================================================
// Hackraft - Mundo
// ---------------------------------------------------------------------
// Cuida de tudo que é "terreno":
//   - GeradorMundo: cria os blocos de cada chunk a partir da semente
//     (morros, montanhas, biomas, água, areia, cavernas, minérios de
//     cristal, árvores e os presentes misteriosos espalhados pelo chão)
//   - Mundo: carrega os chunks em volta do jogador aos poucos, monta as
//     malhas, descarrega os que ficaram longe, guarda as modificações
//     do jogador, faz o raycast (qual bloco a mira está olhando), acha
//     blocos perto do jogador (blocosProximos) e cria o shader (material)
//     que desenha os blocos (com o brilho pulsante dos cristais e a luz
//     quente das tochas).
//
// Fase 6 (baús, construção e tochas):
//   - Estado do bloco: 1 byte a mais por posição (porta aberta, tocha na
//     parede, frente do baú). definirBloco(x, y, z, id, origem, estado),
//     obterEstado(x, y, z) e definirBlocos(lista) para mudar vários de uma vez.
//   - Luz das tochas: a classe Iluminacao (chunk.js) espalha a luz de bloco
//     em bloco, inclusive para os chunks vizinhos. luzEm(x, y, z) diz quanta
//     luz tem num lugar (para personagens e itens).
//   - Colisão e mira: caixaColisao / caixaSelecao (porta fina, tocha
//     pequena), e o raycast acerta essas caixas de verdade.
//
// FORMATOS (o que a rede e o save usam):
//   modificação:   [x, y, z, id, estado]  (listas antigas com 4 números valem estado 0)
//   lote:          definirBlocos([[x, y, z, id, estado?], ...], origem)
//   evento simples (aoAlterarBloco): { x, y, z, id, estado, anterior, estadoAnterior, origem }
//   evento de lote (aoAlterarBloco): { lote: true, lista, origem }, com
//                  lista[i] = [x, y, z, id, estado, anterior, estadoAnterior]
//                  (os 5 primeiros números são o formato da rede; só vêm os
//                  blocos que mudaram de verdade, na ordem em que foram aplicados)
//
// Exporta: Mundo (contrato do CLAUDE.md), GeradorMundo, BIOMA, TABELA_MINERIOS,
//          direcaoDoYaw(yaw), estadoTochaPelaNormal(normal)
// =====================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { B, BLOCOS, OPACO, SOLIDO, LIQUIDO } from './blocks.js';
import { criarRuido, hash2D, hash3D, sementeParaNumero } from './noise.js';
import {
  Chunk, MontadorMalha, Iluminacao, TAM, ALTURA, AREA,
  MODELO, MODELO_CUBO, caixaColisaoDe, caixaSelecaoDe,
  SUJO_OESTE, SUJO_LESTE, SUJO_NORTE, SUJO_SUL, SUJO_NO, SUJO_NE, SUJO_SO, SUJO_SE,
} from './chunk.js';

// TAM precisa ser potência de 2 (16) para as contas rápidas com bits:
//   chunk = x >> BITS      (o mesmo que Math.floor(x / 16), inclusive para negativos)
//   local = x & MASCARA    (o mesmo que x - chunk * 16)
const BITS = Math.log2(TAM);
if (!Number.isInteger(BITS)) throw new Error('CONFIG.TAMANHO_CHUNK precisa ser potência de 2');
const MASCARA = TAM - 1;

const NIVEL_MAR = CONFIG.NIVEL_MAR;

// =====================================================================
// GERAÇÃO DO TERRENO
// =====================================================================

export const BIOMA = { PLANICIE: 0, FLORESTA: 1, DESERTO: 2 };

// Tipo de superfície de uma coluna
const SUP_GRAMA = 0;
const SUP_AREIA = 1;
const SUP_PEDRA = 2;

// --- Números da geração (mexa aqui para mudar o formato do mundo) ---
const ESCALA_COLINAS = 1 / 150;       // tamanho dos morros (menor = morros mais largos)
const ALTURA_BASE = NIVEL_MAR + 4;    // altura média do chão
const FORCA_COLINAS = 18;             // quanto os morros sobem e descem
const ESCALA_REGIAO_MONTANHA = 1 / 520; // tamanho das regiões montanhosas
const ESCALA_CRISTA = 1 / 120;        // tamanho de cada montanha
const TOPO_MONTANHA = ALTURA - 20;    // altura dos picos mais altos
const LINHA_PEDRA = ALTURA - 30;      // acima disso a montanha é de pedra pura (sem grama)
const ESCALA_BIOMA = 1 / 360;         // tamanho dos biomas
const CAVERNA_ESCALA_XZ = 1 / 38;     // tamanho das cavernas na horizontal
const CAVERNA_ESCALA_Y = 1 / 24;      // e na vertical
const CAVERNA_LIMIAR = 0.022;         // grossura dos túneis (maior = mais grossos; ~4% do subsolo vira caverna)
const CAVERNA_PROF_MIN = 4;           // a caverna fica pelo menos 4 blocos abaixo do chão
const CAVERNA_Y_MIN = 2;              // e nunca abaixo de y = 2 (perto da rocha-matriz)
const CELULA_ARVORE = 5;              // no máximo 1 árvore a cada 5x5 blocos (espaçamento)
const DENSIDADE_ARVORES = [0.06, 0.7, 0]; // chance de árvore por célula: planície, floresta, deserto
const CHANCE_PRESENTE = CONFIG.CHANCE_PRESENTE ?? 0.32; // chance de um chunk ter um presente (~1 a cada 3,5)
const TENTATIVAS_PRESENTE = 6;        // lugares sorteados no chunk até achar um bom para o presente

// --- Minérios (Fase 5; a Fase 9 acrescenta os metais) ---
// Cada linha é um tipo de minério. Para criar um minério novo, basta pôr
// uma linha aqui (e o bloco em blocks.js). Os campos:
//   bloco     id do bloco (B.MINERIO_AZUL, ...)
//   yMin/yMax faixa de altura em que os veios aparecem (inclusive)
//   veios     quantos veios por chunk, em média (0.1 = 1 veio a cada 10 chunks;
//             2.5 = 2 ou 3 veios em todo chunk)
//   tamanho   [mínimo, máximo] de blocos por veio
//   fundo     preferência pelo fundo: 1 = igual na faixa toda; 1.5 = bem mais
//             comum embaixo do que em cima (a altura é sorteada como sorteio^fundo)
//   dentro    bloco que pode virar minério (os veios só trocam ESTE bloco)
// Os veios nunca saem do chunk em que nasceram (são pequenos), então cada
// chunk decide os seus sozinho, sem depender da ordem em que foi gerado.
// Mudar um número aqui muda os minérios dos mundos novos e das partes
// ainda não visitadas (o que o jogador já cavou continua igual no save).
//
// Fase 9 (exemplo do formato, os números são só ideia):
//   { bloco: B.MINERIO_COBRE,   yMin: 10, yMax: 60, veios: 3,    tamanho: [3, 8], fundo: 1   },
//   { bloco: B.MINERIO_DIAMANTE, yMin: 3, yMax: 14, veios: 0.15, tamanho: [1, 3], fundo: 1.3 },
const TABELA_MINERIOS_BASE = [
  // Cristais de poder: ~1,5 bloco por chunk somando todas as cores.
  // Dourado (voar) e roxo (soco forte) são os mais fortes: um pouco mais raros.
  { bloco: B.MINERIO_AZUL,     yMin: 4, yMax: 28, veios: 0.09,  tamanho: [1, 4], fundo: 1.5 },
  { bloco: B.MINERIO_VERMELHO, yMin: 4, yMax: 28, veios: 0.09,  tamanho: [1, 4], fundo: 1.5 },
  { bloco: B.MINERIO_DOURADO,  yMin: 4, yMax: 28, veios: 0.06,  tamanho: [1, 4], fundo: 1.5 },
  { bloco: B.MINERIO_VERDE,    yMin: 4, yMax: 28, veios: 0.09,  tamanho: [1, 4], fundo: 1.5 },
  { bloco: B.MINERIO_ROXO,     yMin: 4, yMax: 28, veios: 0.06,  tamanho: [1, 4], fundo: 1.5 },
  { bloco: B.MINERIO_FOGO,     yMin: 4, yMax: 28, veios: 0.09,  tamanho: [1, 4], fundo: 1.5 },
  { bloco: B.MINERIO_RAIO,     yMin: 4, yMax: 28, veios: 0.09,  tamanho: [1, 4], fundo: 1.5 },
  { bloco: B.MINERIO_GELO,     yMin: 4, yMax: 28, veios: 0.09,  tamanho: [1, 4], fundo: 1.5 },
  // Carvão (Fase 6): comum, para fazer tochas. Muitos veios por chunk, mas
  // só os que caem dentro da pedra viram carvão (acima do chão não nasce nada),
  // então nas planícies sobram uns 4 ou 5 veios. Vem DEPOIS dos cristais e
  // só troca pedra: os cristais dos mundos que já existem continuam iguais.
  { bloco: B.MINERIO_CARVAO,   yMin: 5, yMax: 70, veios: 7,     tamanho: [3, 8], fundo: 1   },
  // Metais (Fase 9): só trocam pedra e vêm DEPOIS das linhas acima.
  { bloco: B.MINERIO_COBRE,    yMin: 10, yMax: 70, veios: 3.3,   tamanho: [3, 6], fundo: 1   },
  { bloco: B.MINERIO_FERRO,    yMin: 5,  yMax: 60, veios: 2.5,   tamanho: [3, 6], fundo: 1.2 },
  { bloco: B.MINERIO_PRATA,    yMin: 5,  yMax: 35, veios: 1,     tamanho: [2, 5], fundo: 1.3 },
  { bloco: B.MINERIO_OURO,     yMin: 4,  yMax: 28, veios: 0.5,   tamanho: [1, 3], fundo: 1.4 },
  { bloco: B.MINERIO_DIAMANTE, yMin: 4,  yMax: 14, veios: 0.2,   tamanho: [1, 2], fundo: 1.3 },
  { bloco: B.MINERIO_DRACONIO, yMin: 4,  yMax: 20, veios: 0.08,  tamanho: [1, 2], fundo: 1.5 },
];

// A tabela de verdade: ignora as linhas cujo bloco ainda não existe em
// blocks.js (assim o jogo não quebra se um bloco for removido ou renomeado)
// e preenche o "dentro" com PEDRA quando não foi dito.
export const TABELA_MINERIOS = TABELA_MINERIOS_BASE
  .filter((m) => Number.isInteger(m.bloco) && m.bloco > 0)
  .map((m) => ({ ...m, dentro: m.dentro ?? B.PEDRA }));

// As 6 direções em que um veio pode crescer (+X, -X, +Y, -Y, +Z, -Z)
const DIR_X = new Int8Array([1, -1, 0, 0, 0, 0]);
const DIR_Y = new Int8Array([0, 0, 1, -1, 0, 0]);
const DIR_Z = new Int8Array([0, 0, 0, 0, 1, -1]);

// Os ruídos são lidos numa área um pouco MAIOR que o chunk (MARGEM blocos
// para cada lado). Isso deixa as árvores atravessarem a borda sem cortes
// e permite saber se tem água perto (para as cavernas e a areia da praia).
const MARGEM = 3;
const LM = TAM + 2 * MARGEM; // largura da área com margem (22)

/** Curva em "S" de 0 a 1 entre a e b (suaviza as transições). */
function suavizar(a, b, v) {
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/**
 * Gera os blocos de um chunk. Não usa o three.js (dá para testar no Node).
 * Uso: const g = new GeradorMundo(semente); g.gerar(chunk);
 * O chunk precisa estar zerado (ar). As etapas ficam em funções separadas
 * para ser fácil inserir coisas novas (os minérios da Fase 9 entram só na
 * TABELA_MINERIOS, sem mexer nas etapas).
 */
export class GeradorMundo {
  constructor(semente) {
    const s = sementeParaNumero(semente);
    this.sementeNum = s;
    // Um ruído diferente para cada coisa (sementes derivadas da principal)
    this.ruidoColinas = criarRuido(s);
    this.ruidoRegiaoMontanha = criarRuido(s ^ 0x51ed270b);
    this.ruidoCrista = criarRuido(s ^ 0x2d358dcc);
    this.ruidoBioma = criarRuido(s ^ 0x6a09e667);
    this.ruidoDetalhe = criarRuido(s ^ 0x3c6ef372);
    this.ruidoCaverna1 = criarRuido(s ^ 0x1f83d9ab);
    this.ruidoCaverna2 = criarRuido(s ^ 0x5be0cd19);
    this.sementeArvore = s ^ 0x71374491;
    this.sementeRocha = s ^ 0x0b5c0fbc;
    this.sementeTerra = s ^ 0x3956c25b;
    this.sementeTesouro = s ^ 0x59f111f1;
    this.sementeMinerio = s ^ 0x923f82a4;
    this._estadoSorteio = 0; // estado do sorteador dos minérios (ver _sortear)

    // Rascunhos reaproveitados a cada chunk (nada de criar arrays no meio)
    this.altM = new Int16Array(LM * LM);   // altura do chão (com margem)
    this.biomaM = new Uint8Array(LM * LM); // bioma (com margem)
    this.minTmp = new Int16Array(LM * LM); // rascunho do "mínimo da vizinhança"
    this.minViz = new Int16Array(AREA);    // menor altura num raio de 3 blocos (só o chunk)
    this.sup = new Uint8Array(AREA);       // tipo de superfície (só o chunk)
    // Ruído das cavernas numa grade grossa (de 4 em 4 blocos), depois interpolado
    this.gy = (ALTURA >> 2) + 2;
    this.grade1 = new Float32Array(5 * 5 * this.gy);
    this.grade2 = new Float32Array(5 * 5 * this.gy);
    this.col1 = new Float32Array(this.gy);
    this.col2 = new Float32Array(this.gy);
  }

  /**
   * Altura do chão (y do bloco sólido mais alto, sem contar árvores) na coluna (wx, wz).
   * Função "pura": depende só da semente e da posição.
   */
  alturaEm(wx, wz) {
    // 1) Colinas suaves: fBm em escala grande
    const base = this.ruidoColinas.fbm2D(wx * ESCALA_COLINAS, wz * ESCALA_COLINAS, 5, 0.5, 2);
    let h = ALTURA_BASE + base * FORCA_COLINAS;

    // 2) Montanhas: um ruído bem largo diz ONDE é região montanhosa (máscara 0..1)
    //    e um ruído "de crista" (1 - |ruído|) faz picos e serras pontudas.
    const regiao = this.ruidoRegiaoMontanha.fbm2D(wx * ESCALA_REGIAO_MONTANHA, wz * ESCALA_REGIAO_MONTANHA, 3, 0.5, 2);
    const mascara = suavizar(0.12, 0.5, regiao);
    if (mascara > 0 && h < TOPO_MONTANHA) {
      const c = 1 - Math.abs(this.ruidoCrista.fbm2D(wx * ESCALA_CRISTA, wz * ESCALA_CRISTA, 4, 0.5, 2.1));
      h += mascara * c * c * (TOPO_MONTANHA - h);
    }

    h = Math.floor(h);
    if (h < 4) return 4;
    if (h > ALTURA - 12) return ALTURA - 12;
    return h;
  }

  /** Bioma da coluna: BIOMA.PLANICIE, BIOMA.FLORESTA ou BIOMA.DESERTO */
  biomaEm(wx, wz) {
    // Um ruído bem largo + um pouco de detalhe para a borda não ficar lisa
    const b = this.ruidoBioma.fbm2D(wx * ESCALA_BIOMA, wz * ESCALA_BIOMA, 3, 0.5, 2) +
      this.ruidoDetalhe.ruido2D(wx / 18, wz / 18) * 0.04;
    if (b < -0.22) return BIOMA.DESERTO;
    if (b > 0.12) return BIOMA.FLORESTA;
    return BIOMA.PLANICIE;
  }

  /** Altura a partir da qual a montanha vira pedra pura (varia um pouco) */
  linhaPedraEm(wx, wz) {
    return LINHA_PEDRA + Math.floor(this.ruidoDetalhe.ruido2D(wx / 11, wz / 11) * 3);
  }

  /** Pode nascer árvore nessa coluna? (só sobre grama, longe da praia e das pedras) */
  arvorePodeEm(wx, wz, h, bioma) {
    return bioma !== BIOMA.DESERTO && h > NIVEL_MAR + 1 && h < this.linhaPedraEm(wx, wz) && h + 9 < ALTURA;
  }

  /** Gera o chunk inteiro. As etapas rodam nesta ordem. */
  gerar(chunk) {
    const x0 = chunk.cx * TAM;
    const z0 = chunk.cz * TAM;
    this.prepararColunas(x0, z0);
    this.gerarTerreno(chunk, x0, z0);
    this.gerarAguaEAreia(chunk, x0, z0);
    this.escavarCavernas(chunk, x0, z0);
    // Depois das cavernas: assim alguns cristais ficam à mostra nas paredes delas
    this.colocarMinerios(chunk);
    this.plantarArvores(chunk, x0, z0);
    this.colocarTesouros(chunk); // depois das árvores, para não cair dentro de uma
    chunk.calcularAlturas();
  }

  /** Etapa 0: lê os ruídos 2D de todas as colunas (com margem). */
  prepararColunas(x0, z0) {
    const altM = this.altM;
    const biomaM = this.biomaM;
    for (let mz = 0; mz < LM; mz++) {
      for (let mx = 0; mx < LM; mx++) {
        const wx = x0 + mx - MARGEM;
        const wz = z0 + mz - MARGEM;
        const m = mx + mz * LM;
        altM[m] = this.alturaEm(wx, wz);
        biomaM[m] = this.biomaEm(wx, wz);
      }
    }

    // Menor altura num quadrado 7x7 em volta de cada coluna do chunk.
    // Se ela está abaixo do mar, tem água perto. Feito em 2 passadas
    // (linhas e depois colunas), que é bem mais rápido que olhar os 49.
    const tmp = this.minTmp;
    for (let mz = 0; mz < LM; mz++) {
      for (let mx = MARGEM; mx < MARGEM + TAM; mx++) {
        let menor = 9999;
        const base = mz * LM;
        for (let d = -MARGEM; d <= MARGEM; d++) {
          const v = altM[base + mx + d];
          if (v < menor) menor = v;
        }
        tmp[base + mx] = menor;
      }
    }
    const minViz = this.minViz;
    for (let lz = 0; lz < TAM; lz++) {
      for (let lx = 0; lx < TAM; lx++) {
        let menor = 9999;
        const mx = lx + MARGEM;
        for (let d = -MARGEM; d <= MARGEM; d++) {
          const v = tmp[mx + (lz + MARGEM + d) * LM];
          if (v < menor) menor = v;
        }
        minViz[lx + lz * TAM] = menor;
      }
    }

    // Tipo de superfície de cada coluna do chunk
    const sup = this.sup;
    for (let lz = 0; lz < TAM; lz++) {
      for (let lx = 0; lx < TAM; lx++) {
        const m = (lx + MARGEM) + (lz + MARGEM) * LM;
        const wx = x0 + lx;
        const wz = z0 + lz;
        const h = altM[m];
        const col = lx + lz * TAM;
        let tipo;
        if (h < NIVEL_MAR) tipo = SUP_AREIA;                                // fundo do mar/lago
        else if (h <= NIVEL_MAR + 1 && minViz[col] < NIVEL_MAR) tipo = SUP_AREIA; // praia
        else if (h >= this.linhaPedraEm(wx, wz)) tipo = SUP_PEDRA;          // pico de montanha
        else if (biomaM[m] === BIOMA.DESERTO) tipo = SUP_AREIA;             // deserto
        else tipo = SUP_GRAMA;
        sup[col] = tipo;
      }
    }
  }

  /** Etapa 1: rocha-matriz, pedra, terra e grama. */
  gerarTerreno(chunk, x0, z0) {
    const d = chunk.dados;
    for (let lz = 0; lz < TAM; lz++) {
      for (let lx = 0; lx < TAM; lx++) {
        const col = lx + lz * TAM;
        const wx = x0 + lx;
        const wz = z0 + lz;
        const h = this.altM[(lx + MARGEM) + (lz + MARGEM) * LM];

        // Rocha-matriz em y = 0 e em alguns pontos de y = 1
        d[col] = B.ROCHA_MATRIZ;
        d[col + AREA] = hash2D(this.sementeRocha, wx, wz) < 0.5 ? B.ROCHA_MATRIZ : B.PEDRA;
        // Pedra até o topo
        for (let y = 2; y <= h; y++) d[col + y * AREA] = B.PEDRA;

        // Grama no topo e 3 ou 4 camadas de terra embaixo
        if (this.sup[col] === SUP_GRAMA) {
          const prof = 3 + (hash2D(this.sementeTerra, wx, wz) < 0.5 ? 1 : 0);
          for (let y = Math.max(2, h - prof); y < h; y++) d[col + y * AREA] = B.TERRA;
          d[col + h * AREA] = B.GRAMA;
        }
      }
    }
  }

  /** Etapa 2: areia (deserto, praia, fundo) e água até o nível do mar. */
  gerarAguaEAreia(chunk, x0, z0) {
    const d = chunk.dados;
    for (let lz = 0; lz < TAM; lz++) {
      for (let lx = 0; lx < TAM; lx++) {
        const col = lx + lz * TAM;
        const h = this.altM[(lx + MARGEM) + (lz + MARGEM) * LM];
        if (this.sup[col] === SUP_AREIA) {
          // A superfície + 3 camadas embaixo
          for (let y = Math.max(2, h - 3); y <= h; y++) d[col + y * AREA] = B.AREIA;
        }
        for (let y = h + 1; y <= NIVEL_MAR; y++) d[col + y * AREA] = B.AGUA;
      }
    }
  }

  /**
   * Etapa 3: cavernas em forma de túnel ("minhocas").
   * Usamos 2 ruídos 3D. Cada um vale 0 numa "superfície" curva; onde as
   * duas superfícies se cruzam forma-se uma LINHA, e em volta dela abrimos
   * o túnel (ruido1² + ruido2² pequeno).
   * Para ficar rápido, o ruído é calculado só de 4 em 4 blocos e o
   * meio é interpolado (as cavernas são grandes, não dá diferença).
   */
  escavarCavernas(chunk, x0, z0) {
    const d = chunk.dados;
    const minViz = this.minViz;

    // Até onde cada coluna pode ter caverna:
    //  - sem caverna se tiver água num raio de 3 blocos (a água não vaza)
    //  - pelo menos 4 blocos abaixo do chão mais baixo em volta
    let limiteMax = -1;
    for (let col = 0; col < AREA; col++) {
      const m = minViz[col];
      const lim = m < NIVEL_MAR ? -1 : m - CAVERNA_PROF_MIN;
      if (lim > limiteMax) limiteMax = lim;
    }
    if (limiteMax < CAVERNA_Y_MIN) return;

    // Grade grossa: pontos em x, z = 0, 4, 8, 12, 16 e y = 0, 4, 8, ...
    const gy = this.gy;
    const gyMax = Math.min(gy - 1, (limiteMax >> 2) + 1);
    const g1 = this.grade1;
    const g2 = this.grade2;
    const r1 = this.ruidoCaverna1;
    const r2 = this.ruidoCaverna2;
    for (let gz = 0; gz < 5; gz++) {
      for (let gx = 0; gx < 5; gx++) {
        const nx = (x0 + gx * 4) * CAVERNA_ESCALA_XZ;
        const nz = (z0 + gz * 4) * CAVERNA_ESCALA_XZ;
        const base = (gx + gz * 5) * gy;
        for (let j = 0; j <= gyMax; j++) {
          const ny = j * 4 * CAVERNA_ESCALA_Y;
          g1[base + j] = r1.ruido3D(nx, ny, nz);
          g2[base + j] = r2.ruido3D(nx + 71.3, ny, nz - 33.7);
        }
      }
    }

    const c1 = this.col1;
    const c2 = this.col2;
    for (let lz = 0; lz < TAM; lz++) {
      for (let lx = 0; lx < TAM; lx++) {
        const col = lx + lz * TAM;
        const m = minViz[col];
        if (m < NIVEL_MAR) continue;
        const limite = m - CAVERNA_PROF_MIN;
        if (limite < CAVERNA_Y_MIN) continue;

        // Interpola os 4 cantos da célula da grade para esta coluna
        const gx = lx >> 2, gz = lz >> 2;
        const fx = (lx & 3) / 4, fz = (lz & 3) / 4;
        const i00 = (gx + gz * 5) * gy;
        const i10 = (gx + 1 + gz * 5) * gy;
        const i01 = (gx + (gz + 1) * 5) * gy;
        const i11 = (gx + 1 + (gz + 1) * 5) * gy;
        const jMax = Math.min(gyMax, (limite >> 2) + 1);
        for (let j = 0; j <= jMax; j++) {
          const a1 = g1[i00 + j] + (g1[i10 + j] - g1[i00 + j]) * fx;
          const b1 = g1[i01 + j] + (g1[i11 + j] - g1[i01 + j]) * fx;
          c1[j] = a1 + (b1 - a1) * fz;
          const a2 = g2[i00 + j] + (g2[i10 + j] - g2[i00 + j]) * fx;
          const b2 = g2[i01 + j] + (g2[i11 + j] - g2[i01 + j]) * fx;
          c2[j] = a2 + (b2 - a2) * fz;
        }

        for (let y = CAVERNA_Y_MIN; y <= limite; y++) {
          const j = y >> 2;
          const fy = (y & 3) / 4;
          const v1 = c1[j] + (c1[j + 1] - c1[j]) * fy;
          const v2 = c2[j] + (c2[j + 1] - c2[j]) * fy;
          if (v1 * v1 + v2 * v2 < CAVERNA_LIMIAR) {
            const i = col + y * AREA;
            if (d[i] !== B.ROCHA_MATRIZ && d[i] !== B.AGUA) d[i] = B.AR;
          }
        }
      }
    }
  }

  /**
   * Etapa 4: minérios (Fase 5: cristais de poder; Fase 9: metais).
   * Para cada linha da TABELA_MINERIOS:
   *  1. sorteia quantos veios este chunk tem (a média é `veios`);
   *  2. para cada veio, sorteia o lugar (x e z dentro do chunk, e a altura
   *     "puxada" para o fundo) e o tamanho;
   *  3. o veio cresce como uma minhoquinha: a partir do último bloco
   *     colocado, tenta um vizinho sorteado (e, se não der, os outros 5).
   * Só troca o bloco `dentro` (a pedra): nada de cristal flutuando no ar da
   * caverna, dentro da água ou no meio da terra.
   *
   * Cada linha tem o seu próprio sorteador, que começa pela semente + o id
   * do bloco + a posição do chunk. Por isso acrescentar uma linha nova na
   * Fase 9 não muda onde os cristais que já existem nascem.
   */
  colocarMinerios(chunk) {
    const tabela = TABELA_MINERIOS;
    const d = chunk.dados;
    const cx = chunk.cx, cz = chunk.cz;
    for (let t = 0; t < tabela.length; t++) {
      const m = tabela[t];
      this._iniciarSorteio(Math.imul(m.bloco + 1, 0x9e3779b1), cx, cz);

      // Quantos veios: a parte inteira de `veios` sempre; a parte quebrada vira
      // uma chance (veios = 0.09 → 9% dos chunks têm 1 veio desta cor)
      const inteiros = Math.floor(m.veios);
      const qtd = inteiros + (this._sortear() < m.veios - inteiros ? 1 : 0);
      if (qtd === 0) continue;

      const faixa = m.yMax - m.yMin + 1;
      const tMin = m.tamanho[0];
      const tVariacao = m.tamanho[1] - m.tamanho[0] + 1;
      const dentro = m.dentro;
      const bloco = m.bloco;
      for (let v = 0; v < qtd; v++) {
        let x = Math.floor(this._sortear() * TAM);
        let z = Math.floor(this._sortear() * TAM);
        // sorteio^fundo fica mais perto de 0 (o fundo da faixa) quando fundo > 1
        let y = m.yMin + Math.floor(Math.pow(this._sortear(), m.fundo) * faixa);
        const tamanho = tMin + Math.floor(this._sortear() * tVariacao);
        if (y >= ALTURA) continue;
        const i = x + z * TAM + y * AREA;
        if (d[i] !== dentro) continue; // caiu fora da pedra (caverna, terra...): sem veio
        d[i] = bloco;

        for (let k = 1; k < tamanho; k++) {
          const dir0 = Math.floor(this._sortear() * 6);
          let cresceu = false;
          for (let j = 0; j < 6 && !cresceu; j++) {
            const dir = (dir0 + j) % 6;
            const nx = x + DIR_X[dir];
            const ny = y + DIR_Y[dir];
            const nz = z + DIR_Z[dir];
            if (nx < 0 || nx >= TAM || nz < 0 || nz >= TAM) continue; // não sai do chunk
            if (ny < m.yMin || ny > m.yMax || ny >= ALTURA) continue;  // nem da faixa
            const ni = nx + nz * TAM + ny * AREA;
            if (d[ni] !== dentro) continue;
            d[ni] = bloco;
            x = nx; y = ny; z = nz;
            cresceu = true;
          }
          if (!cresceu) break; // ficou preso (em volta só tem ar, outro minério ou a borda)
        }
      }
    }
  }

  /** Começa o sorteador dos minérios para (sal, chunk). Sempre igual para os mesmos dados. */
  _iniciarSorteio(sal, cx, cz) {
    this._estadoSorteio = (hash2D(this.sementeMinerio ^ sal, cx, cz) * 4294967296) | 0;
  }

  /**
   * Próximo número "aleatório" em [0, 1) do sorteador (algoritmo mulberry32).
   * Não é Math.random: a sequência depende só de onde começou (_iniciarSorteio),
   * então todo computador com a mesma semente sorteia os mesmos números.
   */
  _sortear() {
    let t = (this._estadoSorteio = (this._estadoSorteio + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Etapa 5: árvores.
   * O mundo é dividido em células de 5x5 blocos; cada célula pode ter no
   * máximo 1 árvore, numa posição sorteada pelo hash (sempre a mesma para
   * a mesma semente). Isso garante o espaçamento mínimo.
   * Uma árvore perto da borda tem folhas nos DOIS chunks. Então cada chunk
   * olha também as árvores da margem (3 blocos em volta) e escreve só os
   * blocos que caem dentro dele. Os dois chunks calculam a mesma árvore,
   * então as metades se encaixam.
   */
  plantarArvores(chunk, x0, z0) {
    const d = chunk.dados;
    const s = this.sementeArvore;
    const gx0 = Math.floor((x0 - MARGEM) / CELULA_ARVORE);
    const gx1 = Math.floor((x0 + TAM - 1 + MARGEM) / CELULA_ARVORE);
    const gz0 = Math.floor((z0 - MARGEM) / CELULA_ARVORE);
    const gz1 = Math.floor((z0 + TAM - 1 + MARGEM) / CELULA_ARVORE);

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        // Posição do tronco dentro da célula (longe da borda da célula)
        const tx = gx * CELULA_ARVORE + 1 + Math.floor(hash2D(s ^ 0x1234567, gx, gz) * (CELULA_ARVORE - 2));
        const tz = gz * CELULA_ARVORE + 1 + Math.floor(hash2D(s ^ 0x7654321, gx, gz) * (CELULA_ARVORE - 2));
        const mx = tx - x0 + MARGEM;
        const mz = tz - z0 + MARGEM;
        if (mx < 0 || mx >= LM || mz < 0 || mz >= LM) continue;
        const m = mx + mz * LM;
        const bioma = this.biomaM[m];
        if (hash2D(s, gx, gz) >= DENSIDADE_ARVORES[bioma]) continue;
        const h = this.altM[m];
        if (!this.arvorePodeEm(tx, tz, h, bioma)) continue;
        const altura = 4 + Math.floor(hash2D(s ^ 0x2468ace, gx, gz) * 3); // tronco de 4 a 6
        this.desenharArvore(d, tx - x0, h + 1, tz - z0, altura, tx, tz);
      }
    }
  }

  /** Escreve uma árvore (só os blocos que caem dentro deste chunk). */
  desenharArvore(d, lx, yBase, lz, altura, wx, wz) {
    const yTopo = yBase + altura - 1; // último bloco do tronco
    const s = this.sementeArvore;

    // Copa: 2 camadas largas (raio 2, sem as quinas), 1 menor (3x3 com
    // algumas quinas faltando) e um "+" em cima, que dá o formato redondo.
    for (let dy = -2; dy <= 1; dy++) {
      const y = yTopo + dy;
      if (y < 0 || y >= ALTURA) continue;
      const r = dy < 0 ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) {
        const z = lz + dz;
        if (z < 0 || z >= TAM) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = lx + dx;
          if (x < 0 || x >= TAM) continue;
          const ax = dx < 0 ? -dx : dx;
          const az = dz < 0 ? -dz : dz;
          if (dy < 0) {
            if (ax === 2 && az === 2) continue;
          } else if (dy === 0) {
            if (ax === 1 && az === 1 && hash3D(s, wx + dx, y, wz + dz) < 0.5) continue;
          } else if (ax + az > 1) continue;
          const i = x + z * TAM + y * AREA;
          if (d[i] === B.AR) d[i] = B.FOLHAS; // folha não apaga nada
        }
      }
    }

    // Tronco (pode passar por cima das folhas de outra árvore)
    if (lx >= 0 && lx < TAM && lz >= 0 && lz < TAM) {
      for (let y = yBase; y <= yTopo; y++) {
        const i = lx + lz * TAM + y * AREA;
        if (d[i] === B.AR || d[i] === B.FOLHAS) d[i] = B.TRONCO;
      }
    }
  }

  /**
   * Etapa 6: tesouros (Fase 3).
   * Alguns chunks ganham um "Presente misterioso" em cima da grama ou da
   * areia. Quem decide é o hash da semente com a posição do chunk: todo
   * computador com a mesma semente coloca os presentes nos mesmos lugares
   * (sem isso, cada jogador veria presentes diferentes no multiplayer).
   *
   * Sorteamos alguns lugares dentro do chunk e usamos o primeiro que for
   * bom: chão de grama ou areia, ar em cima (nada de água), e sem árvore
   * em volta (nem tronco, nem folha por cima).
   */
  colocarTesouros(chunk) {
    const s = this.sementeTesouro;
    const cx = chunk.cx, cz = chunk.cz;
    if (hash2D(s, cx, cz) >= CHANCE_PRESENTE) return;
    const d = chunk.dados;
    for (let t = 0; t < TENTATIVAS_PRESENTE; t++) {
      // Cada tentativa usa um "sorteio" diferente (a semente muda com t).
      // Fica longe da borda (1 bloco) para o presente não grudar no vizinho.
      const lx = 1 + Math.floor(hash2D(s ^ Math.imul(t + 1, 0x1b873593), cx, cz) * (TAM - 2));
      const lz = 1 + Math.floor(hash2D(s ^ Math.imul(t + 1, 0x0cc9e2d5), cx, cz) * (TAM - 2));
      const col = lx + lz * TAM;
      const h = this.altM[(lx + MARGEM) + (lz + MARGEM) * LM]; // altura do chão nesta coluna
      if (h < NIVEL_MAR || h + 12 >= ALTURA) continue; // fundo do mar ou alto demais
      const chao = d[col + h * AREA];
      if (chao !== B.GRAMA && chao !== B.AREIA) continue;
      // Ar em cima e nada de árvore até 10 blocos acima (nem do vizinho)
      let livre = true;
      for (let y = h + 1; y <= h + 10 && livre; y++) {
        const id = d[col + y * AREA];
        if (id !== B.AR) livre = false;
      }
      if (!livre) continue;
      d[col + (h + 1) * AREA] = B.PRESENTE;
      return;
    }
  }
}

// =====================================================================
// SHADER DOS BLOCOS
// =====================================================================
// Um material só (ShaderMaterial) para todos os chunks. Cada vértice
// traz: uv (0..1 na face), aCamada (qual textura do DataArrayTexture),
// aSombra (sombra da face × AO), aLuzCeu (quanto de céu enxerga),
// aLuzBloco (Fase 6: quanta luz de tocha chega ali) e aBrilho (Fase 5:
// 0 = normal; maior que 0 = bloco que brilha, e o valor é a "fase" da
// pulsação dele).
// Todos esses atributos são bytes "normalizados" (0..255 vira 0..1).
//
// Luz das tochas (Fase 6): luz final = o maior entre (céu × luz do dia) e
// (tocha × cor quente). O "maior" é feito em cada cor (vermelho, verde,
// azul) separada: de dia o sol branco ganha; à noite e nas cavernas, perto
// da tocha, ganha a luz alaranjada.
//
// Brilho dos cristais (Fase 5): o bloco tem luz própria, então aparece
// mesmo no escuro (de noite e nas cavernas). Os pixels de CRISTAL (os
// coloridos ou bem claros da textura) recebem a luz
//     luz × (1 + 0.35 + 0.25 · seno(tempo · 2.5 + fase))
// que sobe e desce devagar (uma "respiração" a cada 2,5 s). A pedra em
// volta deles fica só um pouco iluminada (PULSO_LUZ_PEDRA), senão o bloco
// inteiro viraria uma lâmpada cinza. Durante o dia, se o sol já ilumina
// mais que o brilho, vale a luz do sol (é o max() das contas).

// Números do brilho (dá para ajustar no config.js, se quiser)
const PULSO_BASE = CONFIG.PULSO_BASE ?? 1.35;     // força média do brilho (1 = luz normal)
const PULSO_ONDA = CONFIG.PULSO_ONDA ?? 0.25;     // quanto ele sobe e desce
const PULSO_VELOCIDADE = CONFIG.PULSO_VELOCIDADE ?? 2.5; // rapidez da pulsação
const PULSO_LUZ_PEDRA = CONFIG.PULSO_LUZ_PEDRA ?? 0.3;    // luz da parte de pedra do bloco que brilha

// O uTempo (segundos) dá a volta de tempos em tempos para o número não ficar
// enorme (a placa de vídeo perde precisão com números grandes). A volta é
// um número inteiro de pulsações (~1 hora), então ninguém percebe o "pulo".
const PERIODO_PULSO = (2 * Math.PI) / PULSO_VELOCIDADE;
const VOLTA_TEMPO = PERIODO_PULSO * Math.max(1, Math.round(3600 / PERIODO_PULSO));

// Luz das tochas (dá para ajustar no config.js, se quiser)
const COR_LUZ_BLOCO = CONFIG.COR_LUZ_TOCHA ?? '#ffcf8a'; // cor da luz das tochas
const FORCA_LUZ_BLOCO = CONFIG.FORCA_LUZ_TOCHA ?? 1.0;   // 1 = normal; maior = tochas mais fortes
// Curva da queda: brilho = (nível / 15) ^ CURVA. 2 = igual à luz do céu;
// maior (ex.: 2.6) = a luz cai mais rápido longe da tocha (mais "clima" à noite)
const CURVA_LUZ_BLOCO = CONFIG.CURVA_LUZ_TOCHA ?? 2.0;

/** Número JS → texto de número com vírgula no GLSL (o GLSL exige o ".0") */
function glslNum(v) {
  const t = String(Number(v));
  return t.includes('.') || t.includes('e') ? t : t + '.0';
}

const SHADER_VERTICE = /* glsl */ `
  attribute float aCamada;
  attribute float aSombra;
  attribute float aLuzCeu;
  attribute float aLuzBloco;
  #ifndef AGUA
    attribute float aBrilho;
  #endif

  uniform float uLuzDoDia;
  uniform float uLuzMinima;
  uniform float uTempo;
  uniform vec3 uCorLuzBloco;

  varying vec2 vUv;
  varying float vCamada;
  varying vec3 vLuz;
  #ifndef AGUA
    varying float vBrilho;     // 1 = bloco que brilha, 0 = normal
    varying vec3 vLuzCristal;  // luz dos pixels de cristal (só vale com vBrilho = 1)
  #endif

  #include <fog_pars_vertex>

  void main() {
    vUv = uv;
    // A camada vem como byte normalizado (0..1): volta para 0..255.
    // (Não usamos "flat" de propósito: em algumas placas no Windows ele é lento.
    //  Como os 4 cantos têm a mesma camada, a interpolação não muda o valor.)
    vCamada = aCamada * 255.0;

    // Os números de sombra e de luz do céu foram pensados "como o olho vê"
    // (igual ao Minecraft). As contas de cor aqui são em espaço linear,
    // então elevamos ao quadrado (aproximação da curva de gama) para o
    // contraste ficar parecido. A luz do dia já vem linear do sky.js.
    float sombra = aSombra * aSombra;
    float ceu = aLuzCeu * aLuzCeu;
    // A luz das tochas usa uma curva parecida (nível 0..15 "como o olho vê" → linear)
    float tocha = pow(aLuzBloco, ${glslNum(CURVA_LUZ_BLOCO)}) * ${glslNum(FORCA_LUZ_BLOCO)};
    // O maior entre o céu (branco) e a tocha (cor quente), em cada canal de cor
    vec3 luz = max(vec3(max(ceu * uLuzDoDia, uLuzMinima)), uCorLuzBloco * tocha);
    vLuz = sombra * luz;

    #ifndef AGUA
      vBrilho = 0.0;
      vLuzCristal = vLuz;
      if (aBrilho > 0.0) {
        // Os 4 cantos da face (e as 6 faces do bloco) têm o mesmo aBrilho,
        // então a pulsação é a mesma no bloco inteiro.
        float fase = aBrilho * 6.2831853;
        float pulso = ${glslNum(PULSO_BASE)} + ${glslNum(PULSO_ONDA)} * sin(uTempo * ${glslNum(PULSO_VELOCIDADE)} + fase);
        // Luz própria: quase não depende do céu nem do AO. Ainda guarda um
        // pouco da sombra da face (0.55 a 1) para o bloco não ficar "chapado".
        float propria = 0.55 + 0.45 * aSombra;
        vLuzCristal = max(vLuz, vec3(propria * pulso));
        vLuz = max(vLuz, vec3(propria * ${glslNum(PULSO_LUZ_PEDRA)} * pulso));
        vBrilho = 1.0;
      }
    #endif

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SHADER_FRAGMENTO = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray uTexturas;
  uniform float uAlfaAgua;

  varying vec2 vUv;
  varying float vCamada;
  varying vec3 vLuz;
  #ifndef AGUA
    varying float vBrilho;
    varying vec3 vLuzCristal;
  #endif

  #include <fog_pars_fragment>

  void main() {
    // A textura está em sRGB, então o valor lido já sai em espaço linear
    vec4 texel = texture(uTexturas, vec3(vUv, vCamada));
    #ifdef AGUA
      gl_FragColor = vec4(texel.rgb * vLuz, uAlfaAgua);
    #else
      // Folhas, vidro e tocha: os furos (alfa baixo) são recortados
      if (texel.a < 0.5) discard;
      vec3 luz = vLuz;
      if (vBrilho > 0.5) {
        // Este pixel é cristal ou pedra? A pedra é cinza e meio escura; o
        // cristal é colorido (saturado) ou bem claro (o reflexo branco).
        // A conta é feita "como o olho vê" (raiz quadrada ≈ volta para sRGB).
        vec3 olho = sqrt(texel.rgb);
        float maior = max(olho.r, max(olho.g, olho.b));
        float menor = min(olho.r, min(olho.g, olho.b));
        float saturacao = (maior - menor) / max(maior, 0.001);
        float cristal = max(smoothstep(0.12, 0.3, saturacao), smoothstep(0.72, 0.9, maior));
        luz = mix(vLuz, vLuzCristal, cristal);
      }
      gl_FragColor = vec4(texel.rgb * luz, 1.0);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function criarMateriais(texturas) {
  // Uniforms compartilhados pelos dois materiais (mudar 1 vez muda nos 2)
  const uTexturas = { value: texturas?.array ?? null };
  const uLuzDoDia = { value: 1 };
  const uLuzMinima = { value: CONFIG.LUZ_MINIMA_BLOCOS ?? 0.04 };
  const uTempo = { value: 0 };
  // new THREE.Color('#...') já converte do sRGB para o espaço linear das contas
  const uCorLuzBloco = { value: new THREE.Color(COR_LUZ_BLOCO) };

  function uniforms() {
    // Os da névoa vêm do three (ele atualiza sozinho a partir de scene.fog).
    // As texturas ficam fora do merge porque o merge copiaria a textura.
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    u.uTexturas = uTexturas;
    u.uLuzDoDia = uLuzDoDia;
    u.uLuzMinima = uLuzMinima;
    u.uTempo = uTempo;
    u.uCorLuzBloco = uCorLuzBloco;
    u.uAlfaAgua = { value: CONFIG.ALFA_AGUA ?? 0.7 };
    return u;
  }

  const solido = new THREE.ShaderMaterial({
    name: 'blocos',
    uniforms: uniforms(),
    vertexShader: SHADER_VERTICE,
    fragmentShader: SHADER_FRAGMENTO,
    fog: true,
  });

  const agua = new THREE.ShaderMaterial({
    name: 'agua',
    uniforms: uniforms(),
    vertexShader: SHADER_VERTICE,
    fragmentShader: SHADER_FRAGMENTO,
    defines: { AGUA: 1 },
    fog: true,
    transparent: true,
    depthWrite: false,       // a água não esconde o que está atrás dela
    side: THREE.DoubleSide,  // para ver a superfície por baixo (mergulhando)
  });

  return { solido, agua, uLuzDoDia, uLuzMinima, uTempo, uCorLuzBloco };
}

/** Transforma os arrays do MontadorMalha numa BufferGeometry. */
function criarGeometria(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.posicoes, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2, true));         // true = normalizado
  g.setAttribute('aCamada', new THREE.BufferAttribute(m.camadas, 1, true));
  g.setAttribute('aSombra', new THREE.BufferAttribute(m.sombras, 1, true));
  g.setAttribute('aLuzCeu', new THREE.BufferAttribute(m.luzCeu, 1, true));
  g.setAttribute('aLuzBloco', new THREE.BufferAttribute(m.luzBloco, 1, true));
  // Só a malha sólida tem aBrilho (o shader da água nem declara esse atributo)
  if (m.brilhos) g.setAttribute('aBrilho', new THREE.BufferAttribute(m.brilhos, 1, true));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  // Já sabemos o tamanho do chunk: definimos a esfera envolvente na mão
  // (o three usa para não desenhar o que está fora da tela).
  const meio = (m.yMin + m.yMax) / 2;
  const meiaAltura = (m.yMax - m.yMin) / 2;
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(TAM / 2, meio, TAM / 2),
    Math.sqrt(TAM * TAM / 2 + meiaAltura * meiaAltura),
  );
  g.boundingBox = new THREE.Box3(new THREE.Vector3(0, m.yMin, 0), new THREE.Vector3(TAM, m.yMax, TAM));
  return g;
}

// =====================================================================
// AJUDANTES DE ESTADO (para quem coloca blocos: player.js, comandos)
// =====================================================================
// Direções: 0 = -Z, 1 = +X, 2 = +Z, 3 = -X (as mesmas dos estados).

/**
 * Para onde o jogador olha (só na horizontal), com yaw = 0 olhando para -Z.
 * Devolve 0 (-Z), 1 (+X), 2 (+Z) ou 3 (-X). É o estado da porta; o baú usa
 * (direção + 2) % 4 para a frente ficar virada para o jogador.
 */
export function direcaoDoYaw(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
  return fz < 0 ? 0 : 2;
}

/**
 * Estado da tocha colocada na face de normal `normal` ({ x, y, z }) de um bloco:
 * em cima (normal +Y) = 0 (no chão); numa lateral = 1 a 4 (encostada no bloco
 * que fica em -Z, +X, +Z ou -X dela). Embaixo (normal -Y) = -1 (não pode).
 */
export function estadoTochaPelaNormal(normal) {
  if (normal.y > 0) return 0;
  if (normal.y < 0) return -1;
  if (normal.z > 0) return 1; // a tocha está em +Z do bloco: a parede fica em -Z dela
  if (normal.x < 0) return 2; // parede em +X
  if (normal.z < 0) return 3; // parede em +Z
  if (normal.x > 0) return 4; // parede em -X
  return -1;
}

// =====================================================================
// MUNDO
// =====================================================================

const ORCAMENTO_MS = CONFIG.ORCAMENTO_CHUNKS_MS ?? 8; // tempo máximo por quadro carregando chunks
// Luz do céu dentro das cavernas (a mesma conta do chunk.js: nível 0..15 → 0..1)
const LUZ_CAVERNA_CEU = Math.round((CONFIG.LUZ_CAVERNA ?? 0.3) * 15) / 15;
const MAX_RESERVA = 48; // chunks descarregados guardados para reaproveitar a memória
// Maior raio aceito pelo blocosProximos: a área que fica carregada em volta do jogador
const RAIO_MAX_PROXIMOS = (CONFIG.DISTANCIA_RENDER + 3) * TAM;

/** Está dentro do círculo de raio r (em chunks)? */
function dentroDoRaio(dx, dz, r) {
  return dx * dx + dz * dz <= (r + 0.5) * (r + 0.5);
}

export class Mundo {
  /**
   * @param scene    THREE.Scene onde os chunks são colocados
   * @param texturas objeto de criarTexturas() (usa .array e .indice(nome))
   * @param semente  número ou texto
   */
  constructor(scene, texturas, semente) {
    this.scene = scene;
    this.texturas = texturas;
    this.semente = semente;
    this.gerador = new GeradorMundo(semente);

    this.chunks = new Map();        // "cx,cz" → Chunk
    this.modificacoes = new Map();  // "x,y,z" → id (o que o jogador mudou)
    // "x,y,z" → estado, só dos blocos mudados com estado diferente de 0
    // (porta, tocha na parede, baú). Fica separado para o `modificacoes`
    // continuar sendo "posição → id", como antes.
    this.estadosModificados = new Map();
    // "cx,cz" → Map(índice local → id + estado × 256), para aplicar rápido
    this.modsPorChunk = new Map();
    this.ouvintes = [];

    // Luz das tochas (chunk.js). Cada chunk carregado entra nela.
    this.luz = new Iluminacao();
    // Chunks com malha que precisam ser remontados (a luz mudou, um bloco
    // mudou...). Juntamos todos e remontamos cada um UMA vez só.
    this._pendentes = new Set();
    this._lote = 0; // > 0 = no meio de uma mudança grande: remonta só no fim
    // Função chamada pela Iluminacao para cada chunk cuja luz mudou (criada
    // uma vez só, para não gerar lixo a cada mudança)
    this._aoSujar = (ch, bits) => this._sujoDeLuz(ch, bits);

    this.montador = new MontadorMalha((nome) => (texturas ? texturas.indice(nome) : 0));
    const mats = criarMateriais(texturas);
    this.materialSolido = mats.solido;
    this.materialAgua = mats.agua;
    this._uLuzDoDia = mats.uLuzDoDia;
    this._uLuzMinima = mats.uLuzMinima;
    /** Cor da luz das tochas (THREE.Color, já em espaço linear), para tingir personagens e itens */
    this.corLuzBloco = mats.uCorLuzBloco.value;
    // Relógio do brilho dos cristais: o atualizar() copia o tempo para o shader.
    // Se alguém chamar definirTempo(t), o relógio próprio é desligado.
    this._uTempo = mats.uTempo;
    this._inicioTempo = performance.now();
    this._tempoManual = false;

    // Rascunhos do blocosProximos (reaproveitados a cada chamada)
    this._listaProximos = [];
    this._poolsProximos = new WeakMap(); // lista de saída → [x, y, z, id] já criados
    this._filtroProximos = new Uint8Array(256);
    this._ordemCx = new Int32Array(64);
    this._ordemCz = new Int32Array(64);
    this._ordemDist = new Float64Array(64);

    // Todos os chunks ficam dentro deste grupo
    this.grupo = new THREE.Group();
    this.grupo.name = 'mundo';
    if (scene) scene.add(this.grupo);

    // Lista dos deslocamentos (dx, dz) dentro do raio, do mais perto para o mais longe.
    // A fila de carregamento segue esta ordem.
    const R = CONFIG.DISTANCIA_RENDER;
    const lista = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dentroDoRaio(dx, dz, R)) lista.push([dx, dz, dx * dx + dz * dz]);
      }
    }
    lista.sort((a, b) => a[2] - b[2]);
    this._offX = Int32Array.from(lista, (o) => o[0]);
    this._offZ = Int32Array.from(lista, (o) => o[1]);

    // Fila (cx, cz) dos chunks que ainda precisam de malha
    this._filaX = new Int32Array(lista.length);
    this._filaZ = new Int32Array(lista.length);
    this._filaTam = 0;
    this._filaPos = 0;
    this._cxJogador = NaN;
    this._czJogador = NaN;

    // Cache pequeno para achar o chunk de uma posição sem montar o texto
    // "cx,cz" toda hora (obterBloco é chamado milhares de vezes por quadro).
    // A posição no cache depende só dos 3 bits mais baixos de cx e cz: uma
    // área de 8x8 chunks cabe inteira sem um chunk empurrar o outro.
    this._cacheCx = new Int32Array(64);
    this._cacheCz = new Int32Array(64);
    this._cacheCh = new Array(64).fill(null);

    this._vizinhos = new Array(9).fill(null);
    this._acerto = { nx: 0, ny: 0, nz: 0, t: 0 }; // rascunho do raycast nos modelos
    this._reserva = [];
    this._totalFaces = 0;
  }

  // ----------------------------------------------------------------
  // Acesso aos chunks
  // ----------------------------------------------------------------

  /** Chunk (cx, cz) se estiver carregado, senão undefined. */
  _chunkEm(cx, cz) {
    const s = ((cx & 7) << 3) | (cz & 7);
    const c = this._cacheCh[s];
    if (c !== null && this._cacheCx[s] === cx && this._cacheCz[s] === cz) return c;
    const ch = this.chunks.get(cx + ',' + cz);
    if (ch) {
      this._cacheCx[s] = cx;
      this._cacheCz[s] = cz;
      this._cacheCh[s] = ch;
    }
    return ch;
  }

  /** Devolve o chunk, gerando os dados se ainda não existir (sem malha). */
  _garantirDados(cx, cz) {
    let ch = this._chunkEm(cx, cz);
    if (ch) return ch;
    ch = this._reserva.pop();
    if (ch) ch.reiniciar(cx, cz);
    else ch = new Chunk(cx, cz);
    this.gerador.gerar(ch);

    // Aplica o que o jogador já tinha mudado neste chunk (id e estado:
    // o valor guardado é id + estado × 256)
    const mods = this.modsPorChunk.get(ch.chave);
    if (mods) {
      for (const [i, v] of mods) {
        ch.definir(i & MASCARA, i >> (2 * BITS), (i >> BITS) & MASCARA, v & 255, v >> 8);
      }
    }
    this.chunks.set(ch.chave, ch);

    // Luz das tochas: liga o chunk aos 4 vizinhos carregados, acende as
    // fontes dele e puxa a luz que vem dos vizinhos (e empurra a dele para eles)
    this.luz.registrar(ch,
      this._chunkEm(cx - 1, cz), this._chunkEm(cx + 1, cz),
      this._chunkEm(cx, cz - 1), this._chunkEm(cx, cz + 1));
    this.luz.calcularChunk(ch);
    this.luz.coletarSujos(this._aoSujar);
    if (this._lote === 0) this._remontarPendentes();
    return ch;
  }

  // ----------------------------------------------------------------
  // Remontagem das malhas
  // ----------------------------------------------------------------

  /** Marca o chunk (cx, cz) para remontar, se ele já tiver malha. */
  _pendenteSeTiver(cx, cz) {
    const ch = this._chunkEm(cx, cz);
    if (ch && ch.temMalha) this._pendentes.add(ch);
  }

  /**
   * A luz do chunk mudou (aviso da Iluminacao). A malha dele precisa ser
   * remontada e, se mudou na borda, a do vizinho daquele lado também,
   * porque a malha do vizinho lê 1 bloco da nossa borda (luz suave).
   */
  _sujoDeLuz(ch, bits) {
    if (ch.temMalha) this._pendentes.add(ch);
    const cx = ch.cx, cz = ch.cz;
    if (bits & SUJO_OESTE) this._pendenteSeTiver(cx - 1, cz);
    if (bits & SUJO_LESTE) this._pendenteSeTiver(cx + 1, cz);
    if (bits & SUJO_NORTE) this._pendenteSeTiver(cx, cz - 1);
    if (bits & SUJO_SUL) this._pendenteSeTiver(cx, cz + 1);
    if (bits & SUJO_NO) this._pendenteSeTiver(cx - 1, cz - 1);
    if (bits & SUJO_NE) this._pendenteSeTiver(cx + 1, cz - 1);
    if (bits & SUJO_SO) this._pendenteSeTiver(cx - 1, cz + 1);
    if (bits & SUJO_SE) this._pendenteSeTiver(cx + 1, cz + 1);
  }

  /** Remonta (uma vez cada) os chunks marcados. */
  _remontarPendentes() {
    if (this._pendentes.size === 0) return;
    for (const ch of this._pendentes) {
      // Pode ter sido descarregado no meio do caminho
      if (ch.temMalha && this.chunks.get(ch.chave) === ch) this._montarMalha(ch);
    }
    this._pendentes.clear();
  }

  /** (Re)monta as malhas de um chunk. Os 8 vizinhos já devem ter dados. */
  _montarMalha(ch) {
    const viz = this._vizinhos;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        viz[(dz + 1) * 3 + (dx + 1)] = this._chunkEm(ch.cx + dx, ch.cz + dz) || null;
      }
    }
    const r = this.montador.montar(viz);
    viz.fill(null);
    this._totalFaces += r.faces - ch.faces;
    ch.faces = r.faces;
    ch.malhaSolida = this._trocarGeometria(ch, ch.malhaSolida, r.solido, this.materialSolido);
    ch.malhaAgua = this._trocarGeometria(ch, ch.malhaAgua, r.agua, this.materialAgua);
    ch.temMalha = true;
  }

  _trocarGeometria(ch, malha, dados, material) {
    if (!dados) {
      if (malha) {
        this.grupo.remove(malha);
        malha.geometry.dispose();
      }
      return null;
    }
    const geo = criarGeometria(dados);
    if (malha) {
      malha.geometry.dispose();
      malha.geometry = geo;
      return malha;
    }
    malha = new THREE.Mesh(geo, material);
    malha.name = 'chunk ' + ch.chave;
    malha.position.set(ch.cx * TAM, 0, ch.cz * TAM);
    malha.matrixAutoUpdate = false; // o chunk nunca se mexe
    malha.updateMatrix();
    this.grupo.add(malha);
    return malha;
  }

  /** Tira o chunk da memória (as modificações continuam guardadas). */
  _descarregar(ch) {
    for (const malha of [ch.malhaSolida, ch.malhaAgua]) {
      if (malha) {
        this.grupo.remove(malha);
        malha.geometry.dispose();
      }
    }
    ch.malhaSolida = null;
    ch.malhaAgua = null;
    ch.temMalha = false;
    this._totalFaces -= ch.faces;
    ch.faces = 0;
    this.luz.remover(ch);
    this._pendentes.delete(ch);
    this.chunks.delete(ch.chave);
    const s = ((ch.cx & 7) << 3) | (ch.cz & 7);
    if (this._cacheCh[s] === ch) this._cacheCh[s] = null;
    if (this._reserva.length < MAX_RESERVA) this._reserva.push(ch);
  }

  // ----------------------------------------------------------------
  // Carregamento em volta do jogador
  // ----------------------------------------------------------------

  /**
   * Chamar todo quadro. Põe na fila os chunks em volta do jogador (do mais
   * perto para o mais longe), gera/monta alguns por quadro (até
   * CONFIG.CHUNKS_POR_QUADRO malhas e ~8 ms) e descarrega os que ficaram longe.
   * Também avança o relógio do brilho dos cristais (uTempo do shader), a
   * não ser que o tempo esteja sendo controlado por definirTempo().
   */
  atualizar(posJogador) {
    if (!this._tempoManual) {
      this._uTempo.value = ((performance.now() - this._inicioTempo) / 1000) % VOLTA_TEMPO;
    }

    const pcx = Math.floor(posJogador.x / TAM);
    const pcz = Math.floor(posJogador.z / TAM);
    if (pcx !== this._cxJogador || pcz !== this._czJogador) {
      this._cxJogador = pcx;
      this._czJogador = pcz;
      this._reconstruirFila(pcx, pcz);
      this._descarregarLonge(pcx, pcz);
    }
    if (this._filaPos >= this._filaTam) return;

    // Gerar um chunk pode mudar a luz de um vizinho que já tem malha (raro):
    // essas remontagens ficam para o fim do quadro, uma vez cada.
    this._lote++;
    try {
      this._carregarDaFila();
    } finally {
      this._lote--;
    }
    if (this._lote === 0) this._remontarPendentes();
  }

  /** Gera/monta alguns chunks da fila (até CHUNKS_POR_QUADRO malhas e ~8 ms). */
  _carregarDaFila() {
    const inicio = performance.now();
    const maxMalhas = CONFIG.CHUNKS_POR_QUADRO;
    let montados = 0;
    while (this._filaPos < this._filaTam && montados < maxMalhas) {
      const cx = this._filaX[this._filaPos];
      const cz = this._filaZ[this._filaPos];

      // A malha precisa dos dados do chunk e dos 8 vizinhos
      let faltou = false;
      for (let dz = -1; dz <= 1 && !faltou; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (this._chunkEm(cx + dx, cz + dz)) continue;
          if (performance.now() - inicio > ORCAMENTO_MS) { faltou = true; break; }
          this._garantirDados(cx + dx, cz + dz);
        }
      }
      if (faltou) break; // acabou o tempo deste quadro: continua no próximo

      const ch = this._chunkEm(cx, cz);
      if (!ch.temMalha) {
        if (montados > 0 && performance.now() - inicio > ORCAMENTO_MS) break;
        this._montarMalha(ch);
        montados++;
      }
      this._filaPos++;
    }
  }

  _reconstruirFila(pcx, pcz) {
    let n = 0;
    for (let k = 0; k < this._offX.length; k++) {
      const cx = pcx + this._offX[k];
      const cz = pcz + this._offZ[k];
      const ch = this._chunkEm(cx, cz);
      if (ch && ch.temMalha) continue;
      this._filaX[n] = cx;
      this._filaZ[n] = cz;
      n++;
    }
    this._filaTam = n;
    this._filaPos = 0;
  }

  _descarregarLonge(pcx, pcz) {
    const limite = CONFIG.DISTANCIA_RENDER + 2;
    for (const ch of this.chunks.values()) {
      if (!dentroDoRaio(ch.cx - pcx, ch.cz - pcz, limite)) this._descarregar(ch);
    }
  }

  /**
   * Gera e monta NA HORA os chunks num raio (em chunks) em volta de pos.
   * Usado ao iniciar, para o jogador não cair no vazio.
   */
  prepararArea(pos, raio = 2) {
    const pcx = Math.floor(pos.x / TAM);
    const pcz = Math.floor(pos.z / TAM);
    const r = Math.min(raio, CONFIG.DISTANCIA_RENDER);
    this._lote++;
    try {
      for (let dz = -r - 1; dz <= r + 1; dz++) {
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          if (dentroDoRaio(dx, dz, r + 1)) this._garantirDados(pcx + dx, pcz + dz);
        }
      }
    } finally {
      this._lote--;
    }
    if (this._lote === 0) this._remontarPendentes();
    for (let k = 0; k < this._offX.length; k++) {
      const dx = this._offX[k];
      const dz = this._offZ[k];
      if (!dentroDoRaio(dx, dz, r)) continue;
      const ch = this._chunkEm(pcx + dx, pcz + dz);
      if (ch && !ch.temMalha) this._montarMalha(ch);
    }
  }

  /** true se o chunk da posição (x, z) já tem dados e malha. */
  estaPronto(x, z) {
    const ch = this._chunkEm(Math.floor(x) >> BITS, Math.floor(z) >> BITS);
    return !!(ch && ch.temMalha);
  }

  // ----------------------------------------------------------------
  // Blocos
  // ----------------------------------------------------------------

  /** Id do bloco em (x, y, z). Fora da altura ou chunk não carregado = ar. */
  obterBloco(x, y, z) {
    if (y < 0 || y >= ALTURA) return B.AR;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const ch = this._chunkEm(x >> BITS, z >> BITS);
    if (!ch) return B.AR;
    return ch.dados[(x & MASCARA) + (z & MASCARA) * TAM + y * AREA];
  }

  /** Estado do bloco em (x, y, z): 0 a 255 (0 fora da altura ou em chunk não carregado). */
  obterEstado(x, y, z) {
    if (y < 0 || y >= ALTURA) return 0;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const ch = this._chunkEm(x >> BITS, z >> BITS);
    if (!ch) return 0;
    return ch.estados[(x & MASCARA) + (z & MASCARA) * TAM + y * AREA];
  }

  /**
   * Muda um bloco (e o estado dele). Registra em `modificacoes`, atualiza a
   * luz, remonta o chunk na hora (e os vizinhos, se o bloco estiver na
   * borda ou se a luz deles mudou) e avisa os ouvintes com
   *   { x, y, z, id, estado, anterior, estadoAnterior, origem }.
   * Devolve true se algo mudou (o id ou o estado).
   *
   * Se o chunk não estiver carregado (ex.: o outro jogador está longe), os
   * dados dele são gerados antes (sem malha, é rápido). Sem isso não
   * daria para saber qual era o bloco original: quebrar uma pedra (= pôr
   * ar) seria ignorado, porque "ar" é o que um chunk não carregado parece
   * ter. O chunk gerado assim é descartado sozinho quando ficar longe.
   */
  definirBloco(x, y, z, id, origem = 'local', estado = 0) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (!(y >= 0 && y < ALTURA) || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    id |= 0;
    if (BLOCOS[id] === undefined) return false;
    estado = (estado | 0) & 255;

    this._lote++;
    let mudou;
    let anterior = 0, estadoAnterior = 0;
    try {
      const ch = this._garantirDados(x >> BITS, z >> BITS);
      const iLocal = (x & MASCARA) + (z & MASCARA) * TAM + y * AREA;
      anterior = ch.dados[iLocal];
      estadoAnterior = ch.estados[iLocal];
      mudou = anterior !== id || estadoAnterior !== estado;
      if (mudou) this._aplicarMudanca(ch, x, y, z, iLocal, id, estado, anterior);
    } finally {
      this._lote--;
    }
    if (!mudou) return false;
    this.luz.coletarSujos(this._aoSujar);
    if (this._lote === 0) this._remontarPendentes();

    const evento = { x, y, z, id, estado, anterior, estadoAnterior, origem };
    for (let i = 0; i < this.ouvintes.length; i++) {
      try { this.ouvintes[i](evento); } catch (e) { console.error('Erro num ouvinte de bloco:', e); }
    }
    return true;
  }

  /**
   * Muda vários blocos de uma vez (porta com as 2 metades, fogo, gelo,
   * comandos, lotes da rede). Bem mais rápido que chamar definirBloco
   * várias vezes: cada chunk afetado é remontado UMA vez só, no fim.
   *   lista:  [[x, y, z, id, estado?], ...] (sem estado = 0; entradas
   *           inválidas ou fora da altura são puladas)
   *   origem: 'local' (o jogador daqui) ou 'rede'
   * Os ouvintes são chamados uma vez, com
   *   { lote: true, lista, origem }
   * onde lista[i] = [x, y, z, id, estado, anterior, estadoAnterior], só com
   * os blocos que mudaram de verdade. Os 5 primeiros números são o mesmo
   * formato da entrada (é o que a rede manda).
   * Devolve quantos blocos mudaram.
   */
  definirBlocos(lista, origem = 'local') {
    if (!lista || typeof lista.length !== 'number') return 0;
    const mudancas = [];
    this._lote++;
    try {
      for (let k = 0; k < lista.length; k++) {
        const b = lista[k];
        if (!b || b.length < 4) continue;
        const x = Math.floor(b[0]);
        const y = Math.floor(b[1]);
        const z = Math.floor(b[2]);
        if (!(y >= 0 && y < ALTURA) || !Number.isFinite(x) || !Number.isFinite(z)) continue;
        const id = b[3] | 0;
        if (BLOCOS[id] === undefined) continue;
        const estado = (b[4] | 0) & 255;
        const ch = this._garantirDados(x >> BITS, z >> BITS);
        const iLocal = (x & MASCARA) + (z & MASCARA) * TAM + y * AREA;
        const anterior = ch.dados[iLocal];
        const estadoAnterior = ch.estados[iLocal];
        if (anterior === id && estadoAnterior === estado) continue;
        this._aplicarMudanca(ch, x, y, z, iLocal, id, estado, anterior);
        mudancas.push([x, y, z, id, estado, anterior, estadoAnterior]);
      }
    } finally {
      this._lote--;
    }
    this.luz.coletarSujos(this._aoSujar);
    if (this._lote === 0) this._remontarPendentes();
    if (mudancas.length === 0) return 0;

    const evento = { lote: true, lista: mudancas, origem };
    for (let i = 0; i < this.ouvintes.length; i++) {
      try { this.ouvintes[i](evento); } catch (e) { console.error('Erro num ouvinte de bloco:', e); }
    }
    return mudancas.length;
  }

  /**
   * Parte comum do definirBloco e do definirBlocos: guarda a modificação,
   * grava no chunk, atualiza a luz e marca as malhas para remontar.
   */
  _aplicarMudanca(ch, x, y, z, iLocal, id, estado, anterior) {
    const chaveBloco = x + ',' + y + ',' + z;
    this.modificacoes.set(chaveBloco, id);
    if (estado !== 0) this.estadosModificados.set(chaveBloco, estado);
    else this.estadosModificados.delete(chaveBloco);
    let mapa = this.modsPorChunk.get(ch.chave);
    if (!mapa) {
      mapa = new Map();
      this.modsPorChunk.set(ch.chave, mapa);
    }
    mapa.set(iLocal, id | (estado << 8));

    const lx = x & MASCARA;
    const lz = z & MASCARA;
    ch.definir(lx, y, lz, id, estado); // também atualiza o mapa de altura da coluna
    if (ch.temMalha) this._pendentes.add(ch);
    // Só o estado mudou (porta abrindo, baú virando): os vizinhos não
    // mudam (porta e tocha não tapam nada, e o baú continua um cubo)
    if (anterior === id) return;

    this.luz.alterarBloco(ch, iLocal, anterior, id);
    // Na borda, o vizinho também muda (a face dele e o AO dos cantos).
    // Num canto do chunk, até o vizinho da diagonal.
    const ddx = lx === 0 ? -1 : (lx === MASCARA ? 1 : 0);
    const ddz = lz === 0 ? -1 : (lz === MASCARA ? 1 : 0);
    if (ddx !== 0) this._pendenteSeTiver(ch.cx + ddx, ch.cz);
    if (ddz !== 0) this._pendenteSeTiver(ch.cx, ch.cz + ddz);
    if (ddx !== 0 && ddz !== 0) this._pendenteSeTiver(ch.cx + ddx, ch.cz + ddz);
  }

  /** Registra uma função chamada a cada bloco alterado (ou lote). Devolve uma função que cancela. */
  aoAlterarBloco(fn) {
    this.ouvintes.push(fn);
    return () => {
      const i = this.ouvintes.indexOf(fn);
      if (i >= 0) this.ouvintes.splice(i, 1);
    };
  }

  // ----------------------------------------------------------------
  // Colisão, seleção e luz num ponto
  // ----------------------------------------------------------------

  /**
   * Caixa de colisão do bloco (x, y, z): null (não colide) ou
   * [x0, y0, z0, x1, y1, z1] DENTRO do bloco (de 0 a 1). Cubo sólido =
   * [0, 0, 0, 1, 1, 1]; porta fechada = tábua fina no lado de longe de quem
   * a colocou; aberta = tábua fina no lado da dobradiça; tocha = null.
   * O array é compartilhado (não mude os números).
   */
  caixaColisao(x, y, z) {
    if (y < 0 || y >= ALTURA) return null;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const ch = this._chunkEm(x >> BITS, z >> BITS);
    if (!ch) return null;
    const i = (x & MASCARA) + (z & MASCARA) * TAM + y * AREA;
    return caixaColisaoDe(ch.dados[i], ch.estados[i]);
  }

  /**
   * Caixa de seleção (o contorno da mira e o que o raycast acerta), no mesmo
   * formato da caixaColisao. null para ar e água. A tocha tem uma caixa
   * pequena (mesmo sem colidir) e a porta, a tábua fina.
   */
  caixaSelecao(x, y, z) {
    if (y < 0 || y >= ALTURA) return null;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const ch = this._chunkEm(x >> BITS, z >> BITS);
    if (!ch) return null;
    const i = (x & MASCARA) + (z & MASCARA) * TAM + y * AREA;
    return caixaSelecaoDe(ch.dados[i], ch.estados[i]);
  }

  /**
   * Quanta luz chega no bloco (x, y, z), de 0 a 1, para personagens e itens:
   * o maior entre o céu × luz do dia e a luz das tochas. É a mesma conta do
   * shader (em espaço linear, sem a sombra das faces): dá para multiplicar
   * direto numa cor. Fora do mundo carregado vale a luz do dia.
   */
  luzEm(x, y, z) {
    const dia = this._uLuzDoDia.value;
    const minimo = this._uLuzMinima.value;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y >= ALTURA) return Math.max(dia, minimo);
    if (!(y >= 0)) return minimo;
    const ch = this._chunkEm(x >> BITS, z >> BITS);
    if (!ch) return Math.max(dia, minimo);
    const col = (x & MASCARA) + (z & MASCARA) * TAM;
    const ceu = y >= ch.alturas[col] ? 1 : LUZ_CAVERNA_CEU;
    const b = ch.luzBloco[col + y * AREA] / 15;
    const v = Math.max(ceu * ceu * dia, Math.pow(b, CURVA_LUZ_BLOCO) * FORCA_LUZ_BLOCO, minimo);
    return v > 1 ? 1 : v;
  }

  /** Só a luz das tochas no bloco (x, y, z), de 0 a 1 (linear). Junto com corLuzBloco, serve para tingir. */
  luzBlocoEm(x, y, z) {
    if (y < 0 || y >= ALTURA) return 0;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const ch = this._chunkEm(x >> BITS, z >> BITS);
    if (!ch) return 0;
    const b = ch.luzBloco[(x & MASCARA) + (z & MASCARA) * TAM + y * AREA] / 15;
    return Math.min(1, Math.pow(b, CURVA_LUZ_BLOCO) * FORCA_LUZ_BLOCO);
  }

  /**
   * Anda pela linha de visão bloco por bloco (algoritmo DDA de
   * Amanatides & Woo) e devolve o primeiro bloco atingido:
   * { x, y, z, normal: { x, y, z }, id, estado, t } ou null.
   * A normal aponta para fora da face atingida (bloco novo vai em posição + normal)
   * e t é a distância até o ponto atingido.
   * Ignora ar e água. Os modelos (porta, tocha) só contam se o raio passar
   * pela caixa de seleção deles: mirando no vão ao lado da porta aberta, o
   * raio segue em frente. Se a origem já estiver dentro do bloco (ou da
   * caixa), a normal é (0, 0, 0).
   */
  raycast(origem, direcao, alcance = CONFIG.ALCANCE) {
    let dx = direcao.x, dy = direcao.y, dz = direcao.z;
    const comp = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (comp === 0) return null;
    dx /= comp; dy /= comp; dz /= comp;

    let x = Math.floor(origem.x);
    let y = Math.floor(origem.y);
    let z = Math.floor(origem.z);
    const passoX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const passoY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    const passoZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    // Quanto "t" (distância) custa atravessar 1 bloco inteiro em cada eixo
    const deltaX = passoX !== 0 ? Math.abs(1 / dx) : Infinity;
    const deltaY = passoY !== 0 ? Math.abs(1 / dy) : Infinity;
    const deltaZ = passoZ !== 0 ? Math.abs(1 / dz) : Infinity;
    // Distância até a primeira parede de bloco em cada eixo
    let proxX = passoX > 0 ? (x + 1 - origem.x) * deltaX : (passoX < 0 ? (origem.x - x) * deltaX : Infinity);
    let proxY = passoY > 0 ? (y + 1 - origem.y) * deltaY : (passoY < 0 ? (origem.y - y) * deltaY : Infinity);
    let proxZ = passoZ > 0 ? (z + 1 - origem.z) * deltaZ : (passoZ < 0 ? (origem.z - z) * deltaZ : Infinity);
    let nx = 0, ny = 0, nz = 0;
    let t = 0;

    for (;;) {
      if (y >= 0 && y < ALTURA) {
        const ch = this._chunkEm(x >> BITS, z >> BITS);
        if (ch) {
          const i = (x & MASCARA) + (z & MASCARA) * TAM + y * AREA;
          const id = ch.dados[i];
          if (id !== B.AR && !LIQUIDO[id]) {
            const estado = ch.estados[i];
            if (MODELO[id] === MODELO_CUBO) {
              return { x, y, z, normal: { x: nx, y: ny, z: nz }, id, estado, t };
            }
            // Modelo: confere se o raio passa pela caixa de verdade
            const c = caixaSelecaoDe(id, estado);
            if (c && this._raioNaCaixa(origem, dx, dy, dz, x, y, z, c, alcance)) {
              const a = this._acerto;
              return { x, y, z, normal: { x: a.nx, y: a.ny, z: a.nz }, id, estado, t: a.t };
            }
          }
        }
      }
      // Atravessa a parede mais próxima
      if (proxX < proxY && proxX < proxZ) {
        x += passoX; t = proxX; proxX += deltaX;
        nx = -passoX; ny = 0; nz = 0;
      } else if (proxY < proxZ) {
        y += passoY; t = proxY; proxY += deltaY;
        nx = 0; ny = -passoY; nz = 0;
      } else {
        z += passoZ; t = proxZ; proxZ += deltaZ;
        nx = 0; ny = 0; nz = -passoZ;
      }
      if (t > alcance) return null;
    }
  }

  /**
   * O raio (origem + t × direção, direção com tamanho 1) passa pela caixa c
   * do bloco (bx, by, bz)? Método das "fatias": para cada eixo, calcula o t
   * de entrada e de saída entre os dois planos da caixa; o raio acerta se o
   * maior t de entrada for menor que o menor t de saída. A face atingida é
   * a do eixo que deu o maior t de entrada. Resultado em this._acerto.
   */
  _raioNaCaixa(o, dx, dy, dz, bx, by, bz, c, alcance) {
    let tEntra = -Infinity, tSai = Infinity, eixo = -1;
    // eixo X
    if (dx === 0) {
      if (o.x < bx + c[0] || o.x > bx + c[3]) return false;
    } else {
      let t1 = (bx + c[0] - o.x) / dx, t2 = (bx + c[3] - o.x) / dx;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tEntra) { tEntra = t1; eixo = 0; }
      if (t2 < tSai) tSai = t2;
    }
    // eixo Y
    if (dy === 0) {
      if (o.y < by + c[1] || o.y > by + c[4]) return false;
    } else {
      let t1 = (by + c[1] - o.y) / dy, t2 = (by + c[4] - o.y) / dy;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tEntra) { tEntra = t1; eixo = 1; }
      if (t2 < tSai) tSai = t2;
    }
    // eixo Z
    if (dz === 0) {
      if (o.z < bz + c[2] || o.z > bz + c[5]) return false;
    } else {
      let t1 = (bz + c[2] - o.z) / dz, t2 = (bz + c[5] - o.z) / dz;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tEntra) { tEntra = t1; eixo = 2; }
      if (t2 < tSai) tSai = t2;
    }
    if (tEntra > tSai || tSai < 0 || tEntra > alcance) return false;
    const a = this._acerto;
    a.nx = 0; a.ny = 0; a.nz = 0;
    if (tEntra < 0 || eixo < 0) {
      a.t = 0; // a origem está dentro da caixa
    } else {
      a.t = tEntra;
      if (eixo === 0) a.nx = dx > 0 ? -1 : 1;
      else if (eixo === 1) a.ny = dy > 0 ? -1 : 1;
      else a.nz = dz > 0 ? -1 : 1;
    }
    return true;
  }

  /**
   * Blocos carregados perto de `pos` que passam no filtro (Fase 5: os
   * brilhinhos dos cristais perto do jogador e o raio-X do modo hacker).
   *   pos      { x, y, z } (ex.: jogador.posicao)
   *   raio     distância máxima, em blocos (medida até o centro de cada bloco;
   *            no máximo (DISTANCIA_RENDER + 3) × 16, a área carregada)
   *   filtroFn (id) → true/false. Só pode depender do id: ele é perguntado
   *            UMA vez para cada tipo de bloco, e a resposta vai para uma tabela
   *            (bem mais rápido que perguntar para cada um dos milhares de blocos).
   *   max      no máximo quantos blocos devolver (padrão 256)
   *   saida    (opcional) array que recebe o resultado
   * Devolve uma lista de [x, y, z, id] (x, y, z inteiros: o canto do bloco),
   * começando pelos chunks mais perto de `pos`. Se passar de `max`, os mais
   * longe ficam de fora. Chunks que não estão carregados são pulados.
   *   Ex.: mundo.blocosProximos(jogador.posicao, 12, (id) => BLOCOS[id].brilho, 64)
   *
   * Para não criar lixo a cada chamada, a lista e os [x, y, z, id] são
   * REAPROVEITADOS: a próxima chamada (com a mesma `saida`) escreve por cima.
   * Use a lista na hora (ou copie o que precisar guardar). Quem precisa de
   * duas listas ao mesmo tempo passa um array próprio em `saida`.
   */
  blocosProximos(pos, raio, filtroFn, max = 256, saida = this._listaProximos) {
    let pool = this._poolsProximos.get(saida);
    if (!pool) {
      pool = [];
      this._poolsProximos.set(saida, pool);
    }
    saida.length = 0;
    if (!(raio > 0) || !(max > 0) || typeof filtroFn !== 'function') return saida;
    // Mais longe que isso não tem chunk carregado mesmo (e um raio enorme
    // deixaria a ordenação dos chunks lenta)
    if (raio > RAIO_MAX_PROXIMOS) raio = RAIO_MAX_PROXIMOS;

    // 1) Tabela "este id passa no filtro?" (só os ids que existem em BLOCOS)
    const filtro = this._filtroProximos;
    let algum = false;
    for (let id = 0; id < 256; id++) {
      const passa = BLOCOS[id] !== undefined && !!filtroFn(id);
      filtro[id] = passa ? 1 : 0;
      if (passa) algum = true;
    }
    if (!algum) return saida;

    // Caixa em volta da esfera
    const px = pos.x, py = pos.y, pz = pos.z;
    const r2 = raio * raio;
    const x0 = Math.floor(px - raio), x1 = Math.floor(px + raio);
    const z0 = Math.floor(pz - raio), z1 = Math.floor(pz + raio);
    const y0 = Math.max(0, Math.floor(py - raio));
    const y1 = Math.min(ALTURA - 1, Math.floor(py + raio));
    if (y0 > y1) return saida;

    // 2) Chunks que a caixa encosta, do mais perto para o mais longe
    //    (ordenação por inserção: são poucos, uns 9 a 16)
    const cx0 = x0 >> BITS, cx1 = x1 >> BITS;
    const cz0 = z0 >> BITS, cz1 = z1 >> BITS;
    const total = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
    if (total > this._ordemCx.length) {
      this._ordemCx = new Int32Array(total);
      this._ordemCz = new Int32Array(total);
      this._ordemDist = new Float64Array(total);
    }
    const oCx = this._ordemCx, oCz = this._ordemCz, oDist = this._ordemDist;
    let nc = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ddx = cx * TAM + TAM / 2 - px;
        const ddz = cz * TAM + TAM / 2 - pz;
        const dist = ddx * ddx + ddz * ddz;
        let k = nc++;
        while (k > 0 && oDist[k - 1] > dist) {
          oCx[k] = oCx[k - 1];
          oCz[k] = oCz[k - 1];
          oDist[k] = oDist[k - 1];
          k--;
        }
        oCx[k] = cx;
        oCz[k] = cz;
        oDist[k] = dist;
      }
    }

    // 3) Varre os blocos de cada chunk que ficam dentro da esfera
    let n = 0;
    for (let c = 0; c < nc && n < max; c++) {
      const ch = this._chunkEm(oCx[c], oCz[c]);
      if (!ch) continue;
      const bx = oCx[c] * TAM;
      const bz = oCz[c] * TAM;
      const lx0 = Math.max(0, x0 - bx), lx1 = Math.min(MASCARA, x1 - bx);
      const lz0 = Math.max(0, z0 - bz), lz1 = Math.min(MASCARA, z1 - bz);
      const yTopo = Math.min(y1, ch.yMaximo - 1); // acima disso o chunk só tem ar
      const dados = ch.dados;
      for (let y = y0; y <= yTopo && n < max; y++) {
        const dy = y + 0.5 - py;
        const dy2 = dy * dy;
        if (dy2 > r2) continue;
        for (let lz = lz0; lz <= lz1 && n < max; lz++) {
          const dz = bz + lz + 0.5 - pz;
          const dyz = dy2 + dz * dz;
          if (dyz > r2) continue;
          const base = lz * TAM + y * AREA;
          for (let lx = lx0; lx <= lx1; lx++) {
            const id = dados[base + lx];
            if (filtro[id] === 0) continue;
            const dx = bx + lx + 0.5 - px;
            if (dx * dx + dyz > r2) continue;
            let item = pool[n];
            if (item === undefined) {
              item = [0, 0, 0, 0];
              pool[n] = item;
            }
            item[0] = bx + lx;
            item[1] = y;
            item[2] = bz + lz;
            item[3] = id;
            saida[n++] = item;
            if (n >= max) break;
          }
        }
      }
    }
    return saida;
  }

  /**
   * Ponto de nascimento (os pés) em terra firme perto de (0, 0).
   * Procura em espiral, usando a altura do gerador (rápido), e confere a
   * coluna de verdade no chunk (para não nascer em cima de uma árvore).
   */
  pontoDeNascimento() {
    const ger = this.gerador;
    const testar = (x, z) => {
      if (ger.alturaEm(x, z) <= NIVEL_MAR) return null;
      const ch = this._garantirDados(x >> BITS, z >> BITS);
      const lx = x & MASCARA;
      const lz = z & MASCARA;
      let y = ALTURA - 1;
      while (y > 0 && ch.obter(lx, y, lz) === B.AR) y--;
      const id = ch.obter(lx, y, lz);
      // Terra firme: sólido, opaco, não é tronco (nem folha), acima do mar
      if (y <= NIVEL_MAR || !SOLIDO[id] || !OPACO[id] || id === B.TRONCO) return null;
      if (y + 3 >= ALTURA) return null;
      return new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
    };

    let p = testar(0, 0);
    if (p) return p;
    // Anéis quadrados cada vez maiores em volta de (0, 0)
    for (let r = 1; r <= 512; r++) {
      for (let i = -r; i <= r; i++) {
        if ((p = testar(i, -r)) || (p = testar(i, r))) return p;
      }
      for (let i = -r + 1; i <= r - 1; i++) {
        if ((p = testar(-r, i)) || (p = testar(r, i))) return p;
      }
    }
    // Não achou terra (muito improvável): nasce em cima da coluna (0, 0)
    const ch = this._garantirDados(0, 0);
    let y = ALTURA - 1;
    while (y > 0 && ch.obter(0, y, 0) === B.AR) y--;
    return new THREE.Vector3(0.5, y + 1, 0.5);
  }

  // ----------------------------------------------------------------
  // Modificações (salvar / carregar / rede)
  // ----------------------------------------------------------------

  /**
   * [[x, y, z, id, estado], ...] com tudo que o jogador mudou (o save e a
   * rede usam este formato; o estado é 0 nos blocos comuns).
   */
  exportarModificacoes() {
    const lista = [];
    for (const [chaveChunk, mapa] of this.modsPorChunk) {
      const virgula = chaveChunk.indexOf(',');
      const bx = +chaveChunk.slice(0, virgula) * TAM;
      const bz = +chaveChunk.slice(virgula + 1) * TAM;
      for (const [i, v] of mapa) {
        lista.push([bx + (i & MASCARA), i >> (2 * BITS), bz + ((i >> BITS) & MASCARA), v & 255, v >> 8]);
      }
    }
    return lista;
  }

  /**
   * Troca as modificações pelas da lista (de um save ou da rede). Aceita
   * [x, y, z, id, estado] e também as listas antigas [x, y, z, id] (estado 0).
   * O ideal é chamar antes de prepararArea; se já houver chunks carregados,
   * eles são atualizados (blocos e luz) e remontados. Não chama os ouvintes.
   */
  carregarModificacoes(lista) {
    this.modificacoes.clear();
    this.estadosModificados.clear();
    this.modsPorChunk.clear();
    const afetados = new Set();
    for (const item of lista || []) {
      if (!item || item.length < 4) continue;
      const x = Math.floor(item[0]);
      const y = Math.floor(item[1]);
      const z = Math.floor(item[2]);
      const id = item[3] | 0;
      const estado = (item[4] | 0) & 255;
      if (!(y >= 0 && y < ALTURA) || !Number.isFinite(x) || !Number.isFinite(z)) continue;
      if (BLOCOS[id] === undefined) continue;
      const cx = x >> BITS;
      const cz = z >> BITS;
      const lx = x & MASCARA;
      const lz = z & MASCARA;
      const iLocal = lx + lz * TAM + y * AREA;
      const chaveBloco = x + ',' + y + ',' + z;
      this.modificacoes.set(chaveBloco, id);
      if (estado !== 0) this.estadosModificados.set(chaveBloco, estado);
      else this.estadosModificados.delete(chaveBloco);
      const chaveChunk = cx + ',' + cz;
      let mapa = this.modsPorChunk.get(chaveChunk);
      if (!mapa) {
        mapa = new Map();
        this.modsPorChunk.set(chaveChunk, mapa);
      }
      mapa.set(iLocal, id | (estado << 8));
      const ch = this._chunkEm(cx, cz);
      if (ch) {
        ch.definir(lx, y, lz, id, estado);
        afetados.add(ch);
      }
    }
    if (afetados.size === 0) return;
    // Luz: refaz do zero nos chunks mexidos E nos vizinhos deles (a luz de
    // uma tocha que sumiu pode ter entrado até 13 blocos no vizinho)
    const grupo = new Set();
    for (const ch of afetados) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = this._chunkEm(ch.cx + dx, ch.cz + dz);
          if (v) grupo.add(v);
        }
      }
    }
    this.luz.recalcular(grupo);
    // Remonta os chunks mexidos, os vizinhos e quem teve a luz mudada (uma vez cada)
    for (const ch of grupo) if (ch.temMalha) this._pendentes.add(ch);
    this.luz.coletarSujos(this._aoSujar);
    if (this._lote === 0) this._remontarPendentes();
  }

  // ----------------------------------------------------------------
  // Outros
  // ----------------------------------------------------------------

  /** Luz do dia (0 a 1), vinda do Ceu. Escurece os blocos à noite. */
  definirLuzDoDia(v) {
    this._uLuzDoDia.value = v;
  }

  /**
   * Relógio do brilho dos cristais (uTempo do shader), em segundos.
   * NÃO precisa chamar: o atualizar() já avança o tempo sozinho a cada quadro.
   * Serve para quem quiser controlar na mão (testes, fotos, pausa). Depois da
   * 1ª chamada, o relógio próprio desliga e vale só o que for passado aqui.
   */
  definirTempo(t) {
    this._tempoManual = true;
    this._uTempo.value = ((t % VOLTA_TEMPO) + VOLTA_TEMPO) % VOLTA_TEMPO;
  }

  /** Números para a tela de debug (F3) */
  estatisticas() {
    return {
      chunks: this.chunks.size,
      fila: this._filaTam - this._filaPos,
      faces: this._totalFaces,
    };
  }

  /** Remove tudo da cena e libera a memória da placa de vídeo (ex.: "Novo mundo"). */
  destruir() {
    for (const ch of [...this.chunks.values()]) this._descarregar(ch);
    this._reserva.length = 0;
    this._pendentes.clear();
    this.luz.limpar();
    if (this.grupo.parent) this.grupo.parent.remove(this.grupo);
    this.materialSolido.dispose();
    this.materialAgua.dispose();
    this.ouvintes.length = 0;
  }
}
