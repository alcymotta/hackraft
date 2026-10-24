// =====================================================================
// Hackraft - Chunk (um pedaço do mundo), luz das tochas e montagem da malha
// ---------------------------------------------------------------------
// O mundo é dividido em colunas de 16 x 16 blocos de largura e
// ALTURA_MUNDO de altura, chamadas "chunks". Cada chunk guarda:
//   - dados:     o id de cada bloco (1 byte por bloco)
//   - estados:   o "estado" de cada bloco (1 byte: porta aberta, tocha na
//                parede, para onde o baú olha...). Quase sempre 0.
//   - luzBloco:  a luz das tochas (e dos cristais) em cada posição, de 0 a 15
//
// A "malha" é o desenho 3D do chunk: uma lista de quadradinhos (faces)
// que a placa de vídeo desenha. Para ficar rápido, só criamos as faces
// que podem ser vistas (as que encostam no ar, na água, nas folhas...).
// Desde a Fase 6 também há "modelos": a porta (uma tábua fina) e a tocha
// (um palito), que não ocupam o bloco inteiro.
//
// Este arquivo NÃO usa o three.js: só números e typed arrays. Assim dá
// para testar no Node. Quem transforma os arrays em BufferGeometry é o
// world.js.
//
// Cada vértice leva: posição, uv, camada da textura, sombra (face × AO),
// luz do céu, luz das tochas (Fase 6) e o "brilho" (Fase 5: 0 = normal;
// 1..255 = bloco que brilha pulsando, e o valor é a fase da pulsação).
//
// Exporta:
//   TAM, ALTURA, AREA, VOLUME     tamanhos do chunk
//   indiceLocal(x, y, z)          posição no array de dados
//   Chunk                         dados de um chunk
//   MontadorMalha                 monta os arrays da malha de um chunk
//   Iluminacao                    espalha a luz das tochas (entre chunks também)
//   MODELO, MODELO_CUBO, MODELO_PORTA, MODELO_TOCHA, TAPA, LUZ_PROPRIA
//   caixaColisaoDe(id, estado), caixaSelecaoDe(id, estado)
//   ESTADO_DIRECAO, ESTADO_ABERTA, ESTADO_CIMA
// =====================================================================

import { CONFIG } from './config.js';
import { B, BLOCOS, OPACO, SOLIDO, LIQUIDO, texturaDaFace } from './blocks.js';

export const TAM = CONFIG.TAMANHO_CHUNK;   // largura (x) e profundidade (z): 16
export const ALTURA = CONFIG.ALTURA_MUNDO; // altura (y)
export const AREA = TAM * TAM;             // blocos numa camada horizontal (256)
export const VOLUME = AREA * ALTURA;       // blocos no chunk inteiro

// TAM é potência de 2 (16): dá para usar contas com bits (x & 15, i >> 4)
const BITS = Math.log2(TAM);
const MASCARA = TAM - 1;
const BITS_Y = 2 * BITS; // y = índice >> BITS_Y

/**
 * Fórmula do índice no array de dados:
 *     indice = x + z * TAM + y * TAM * TAM
 * (x anda de 1 em 1, z de 16 em 16, y de 256 em 256).
 * x e z são LOCAIS (0..15) e y vai de 0 a ALTURA-1.
 * Assim cada camada horizontal (mesmo y) fica inteira em sequência na memória.
 */
export function indiceLocal(x, y, z) {
  return x + z * TAM + y * AREA;
}

// =====================================================================
// Tabelas por tipo de bloco (consultadas milhares de vezes por quadro)
// =====================================================================

// Forma do bloco
export const MODELO_CUBO = 0;
export const MODELO_PORTA = 1;
export const MODELO_TOCHA = 2;
const NOMES_MODELO = { cubo: MODELO_CUBO, porta: MODELO_PORTA, tocha: MODELO_TOCHA };

// Os bits do estado (contrato da Fase 6)
//   porta: bits 0-1 = direção do OLHAR de quem colocou (0 = -Z, 1 = +X, 2 = +Z, 3 = -X),
//          bit 2 (valor 4) = aberta, bit 3 (valor 8) = metade de cima
//   tocha: 0 = no chão; 1 a 4 = na parede, encostada no bloco que está em -Z, +X, +Z ou -X
//   baú:   bits 0-1 = para onde a FRENTE aponta (0 = -Z, 1 = +X, 2 = +Z, 3 = -X)
export const ESTADO_DIRECAO = 3;
export const ESTADO_ABERTA = 4;
export const ESTADO_CIMA = 8;

export const MODELO = new Uint8Array(256);      // MODELO_CUBO / MODELO_PORTA / MODELO_TOCHA
// TAPA = cubo opaco: esconde a face do vizinho, faz sombra de canto (AO) e
// segura a luz. Porta e tocha nunca tapam, mesmo que alguém as marque como
// opacas: elas são finas, a luz e a vista passam do lado delas.
export const TAPA = new Uint8Array(256);
export const LUZ_PROPRIA = new Uint8Array(256); // luz que o bloco solta (0..15): tocha 14, cristal 5
const RECORTE = new Uint8Array(256);  // tem furos (folhas, vidro)
const BRILHA = new Uint8Array(256);   // brilha pulsando (cristais)
// JUNTA = não desenha a face entre dois blocos iguais. Vale para os blocos
// "cheios" (água com água) e para quem pediu juntarIguais (vidro). As folhas
// (recorte sem juntarIguais) desenham, para a copa ficar com o visual cheio.
const JUNTA = new Uint8Array(256);
const TEM_FRENTE = new Uint8Array(256); // tem textura própria na frente (baú)

for (const b of BLOCOS) {
  if (!b) continue;
  const id = b.id;
  const m = NOMES_MODELO[b.modelo] ?? MODELO_CUBO;
  MODELO[id] = m;
  TAPA[id] = OPACO[id] && m === MODELO_CUBO ? 1 : 0;
  LUZ_PROPRIA[id] = Math.max(0, Math.min(15, (b.luz | 0)));
  RECORTE[id] = b.recorte ? 1 : 0;
  BRILHA[id] = b.brilho ? 1 : 0;
  JUNTA[id] = !b.recorte || b.juntarIguais ? 1 : 0;
  TEM_FRENTE[id] = b.texturaFrente ? 1 : 0;
}

/**
 * Valor do atributo aBrilho de um bloco que brilha: de 1 a 255, sorteado
 * pela POSIÇÃO do bloco (sempre o mesmo para o mesmo lugar).
 * O shader usa esse número como "fase" da pulsação: cada bloco pulsa num
 * momento diferente, e os cristais não piscam todos juntos.
 * (0 fica reservado para "não brilha".)
 */
function faseDoBrilho(wx, y, wz) {
  let h = Math.imul(wx | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(wz | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return 1 + ((h >>> 0) % 255);
}

// =====================================================================
// Caixas de colisão e de seleção (porta fina, tocha pequena)
// =====================================================================
// Cada caixa é [x0, y0, z0, x1, y1, z1] dentro do bloco (de 0 a 1).
// Os modelos são pensados numa posição "padrão" (direção 0, olhando para
// -Z) e depois girados de 90 em 90 graus em volta do centro do bloco.

const PX16 = 1 / 16;              // 1 pixel da textura
const ESP_PORTA = 3 * PX16;       // grossura da porta (3/16)

/**
 * Gira o ponto (x, z) do bloco r × 90° em volta do centro (0.5, 0.5).
 * r = 0 não muda; r = 1 leva o lado -Z para +X; r = 2 para +Z; r = 3 para -X.
 * Escreve o resultado em GIRO_X / GIRO_Z (sem criar objetos).
 */
let GIRO_X = 0;
let GIRO_Z = 0;
function girar(r, x, z) {
  const cx = x - 0.5;
  const cz = z - 0.5;
  switch (r & 3) {
    case 0: GIRO_X = cx; GIRO_Z = cz; break;
    case 1: GIRO_X = -cz; GIRO_Z = cx; break;
    case 2: GIRO_X = -cx; GIRO_Z = -cz; break;
    default: GIRO_X = cz; GIRO_Z = -cx; break;
  }
  GIRO_X += 0.5;
  GIRO_Z += 0.5;
}

/** Caixa padrão girada r × 90° (continua alinhada aos eixos). */
function caixaGirada(c, r) {
  girar(r, c[0], c[2]);
  const ax = GIRO_X, az = GIRO_Z;
  girar(r, c[3], c[5]);
  const bx = GIRO_X, bz = GIRO_Z;
  return Object.freeze([
    Math.min(ax, bx), c[1], Math.min(az, bz),
    Math.max(ax, bx), c[4], Math.max(az, bz),
  ]);
}

// Qual face vira qual depois de girar r × 90°
// (faces: 0 = +X, 1 = -X, 2 = +Y, 3 = -Y, 4 = +Z, 5 = -Z)
const GIRO_FACE = new Uint8Array([
  0, 1, 2, 3, 4, 5,
  4, 5, 2, 3, 1, 0,
  1, 0, 2, 3, 5, 4,
  5, 4, 2, 3, 0, 1,
]);

const CAIXA_CUBO = Object.freeze([0, 0, 0, 1, 1, 1]);

// Porta na posição padrão (direção 0: quem colocou olhava para -Z, então
// está do lado +Z). O painel fica do lado MAIS LONGE de quem colocou
// (z de 0 a 3/16) e a dobradiça fica à esquerda dele (o canto x = 0, z = 0).
// Aberta, ela gira 90° na dobradiça e fica encostada no lado x = 0.
const PORTA_FECHADA = [0, 0, 0, 1, 1, ESP_PORTA];
const PORTA_ABERTA = [0, 0, 0, ESP_PORTA, 1, 1];
// Índice = estado & 7 (direção + aberta). A metade de cima usa a mesma caixa.
const CAIXAS_PORTA = [];
for (let e = 0; e < 8; e++) CAIXAS_PORTA[e] = caixaGirada(e & ESTADO_ABERTA ? PORTA_ABERTA : PORTA_FECHADA, e & 3);

// Tocha: no chão, um pouco maior que o palito (para ser fácil de mirar);
// na parede (estado 1, encostada em -Z), perto da parede e mais alta.
const TOCHA_CHAO = Object.freeze([6 * PX16, 0, 6 * PX16, 10 * PX16, 10 * PX16, 10 * PX16]);
const TOCHA_PAREDE = [5.5 * PX16, 3 * PX16, 0, 10.5 * PX16, 13 * PX16, 5 * PX16];
const CAIXAS_TOCHA = [TOCHA_CHAO];
for (let e = 1; e <= 4; e++) CAIXAS_TOCHA[e] = caixaGirada(TOCHA_PAREDE, e - 1);

/**
 * Caixa de colisão de um bloco (dentro do bloco, de 0 a 1), ou null se o
 * jogador atravessa. O array devolvido é compartilhado: não mude os valores.
 *   cubo sólido = [0, 0, 0, 1, 1, 1]; porta = tábua fina; tocha = null
 */
export function caixaColisaoDe(id, estado) {
  if (!SOLIDO[id]) return null;
  const m = MODELO[id];
  if (m === MODELO_CUBO) return CAIXA_CUBO;
  if (m === MODELO_PORTA) return CAIXAS_PORTA[estado & 7];
  return null; // a tocha não segura ninguém
}

/**
 * Caixa de seleção (contorno e raycast) de um bloco, ou null para ar e
 * água. Mesmo formato e mesmo cuidado da caixaColisaoDe.
 */
export function caixaSelecaoDe(id, estado) {
  if (id === B.AR || LIQUIDO[id]) return null;
  const m = MODELO[id];
  if (m === MODELO_PORTA) return CAIXAS_PORTA[estado & 7];
  if (m === MODELO_TOCHA) return CAIXAS_TOCHA[estado >= 1 && estado <= 4 ? estado : 0];
  return CAIXA_CUBO;
}

// =====================================================================
// Dados de um chunk
// =====================================================================
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;               // coordenada do chunk (bloco x = cx * 16 + x local)
    this.cz = cz;
    this.chave = cx + ',' + cz;
    this.dados = new Uint8Array(VOLUME);
    // Estado de cada bloco (porta aberta, tocha na parede, frente do baú).
    // Fica "à parte" dos ids para não mudar nada nos blocos comuns.
    this.estados = new Uint8Array(VOLUME);
    // Luz das tochas e dos cristais em cada posição (0..15). Quem calcula
    // é a Iluminacao (ela também espalha a luz para os chunks vizinhos).
    this.luzBloco = new Uint8Array(VOLUME);
    this.slotLuz = -1;          // número deste chunk dentro da Iluminacao (-1 = fora)

    // Mapa de altura: para cada coluna (x + z*16), o y do bloco que TAPA
    // mais alto MAIS 1 (0 = coluna sem nenhum). Serve para a luz do céu:
    // tudo que está acima disso recebe sol; abaixo, fica escuro (cavernas).
    this.alturas = new Uint8Array(AREA);

    // y do bloco (não-ar) mais alto do chunk + 1. A montagem não precisa
    // olhar as camadas acima disso (só tem ar).
    this.yMaximo = 0;

    // Campos usados pelo world.js (ficam aqui para todos saberem que existem)
    this.malhaSolida = null;   // THREE.Mesh dos blocos sólidos
    this.malhaAgua = null;     // THREE.Mesh da água
    this.temMalha = false;     // true depois da 1ª montagem
    this.faces = 0;            // quantas faces a malha tem (para o debug)
  }

  /** Reaproveita este objeto para outro lugar do mundo (zera tudo). */
  reiniciar(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.chave = cx + ',' + cz;
    this.dados.fill(0);
    this.estados.fill(0);
    this.luzBloco.fill(0);
    this.slotLuz = -1;
    this.alturas.fill(0);
    this.yMaximo = 0;
    this.malhaSolida = null;
    this.malhaAgua = null;
    this.temMalha = false;
    this.faces = 0;
  }

  /** Bloco em coordenadas LOCAIS (x, z de 0 a 15). Fora da altura devolve ar. */
  obter(x, y, z) {
    if (y < 0 || y >= ALTURA) return B.AR;
    return this.dados[x + z * TAM + y * AREA];
  }

  /** Estado do bloco em coordenadas LOCAIS (0 fora da altura). */
  obterEstado(x, y, z) {
    if (y < 0 || y >= ALTURA) return 0;
    return this.estados[x + z * TAM + y * AREA];
  }

  /**
   * Muda um bloco (coordenadas locais) e mantém o mapa de altura correto.
   * NÃO mexe na luz: quem chama avisa a Iluminacao (o world.js faz isso).
   */
  definir(x, y, z, id, estado = 0) {
    if (y < 0 || y >= ALTURA) return;
    const i = x + z * TAM + y * AREA;
    this.dados[i] = id;
    this.estados[i] = estado;
    this.atualizarColuna(x, z, y, id);
    if (id !== B.AR && y + 1 > this.yMaximo) this.yMaximo = y + 1;
  }

  /** Ajusta o mapa de altura da coluna (x, z) depois de mudar o bloco em y. */
  atualizarColuna(x, z, y, id) {
    const col = x + z * TAM;
    const alt = this.alturas[col];
    if (TAPA[id]) {
      if (y + 1 > alt) this.alturas[col] = y + 1;
    } else if (y + 1 === alt) {
      // Tiramos o bloco do topo: procura o próximo que tapa, para baixo
      let yy = y - 1;
      while (yy >= 0 && !TAPA[this.dados[col + yy * AREA]]) yy--;
      this.alturas[col] = yy + 1;
    }
  }

  /** Recalcula o mapa de altura e o yMaximo do zero (usado depois de gerar). */
  calcularAlturas() {
    const d = this.dados;
    for (let col = 0; col < AREA; col++) {
      let y = ALTURA - 1;
      while (y >= 0 && !TAPA[d[col + y * AREA]]) y--;
      this.alturas[col] = y + 1;
    }
    // Procura de cima para baixo a primeira camada que tem algum bloco
    let yMax = 0;
    for (let y = ALTURA - 1; y >= 0 && yMax === 0; y--) {
      const base = y * AREA;
      for (let i = 0; i < AREA; i++) {
        if (d[base + i] !== B.AR) { yMax = y + 1; break; }
      }
    }
    this.yMaximo = yMax;
  }
}

// =====================================================================
// Luz das tochas (luz de bloco)
// =====================================================================
// Cada fonte (tocha = 14, cristal = 5) acende o próprio bloco e a luz se
// espalha "em ondas" (busca em largura, BFS): cada vizinho que não tapa
// recebe 1 a menos. Com 14, ela chega a 13 blocos de distância.
// A onda atravessa a borda do chunk e entra nos chunks vizinhos carregados.
//
// Para ser rápido:
//  - cada chunk carregado ganha um número ("slot"), e a tabela `viz` diz
//    o slot do vizinho de cada lado (sem procurar texto "cx,cz");
//  - a fila guarda um número só por posição: (slot << BITS_INDICE) | índice;
//  - nada de objetos novos durante a busca (as filas são Int32Array).
//
// Tirar uma fonte (ou pôr uma parede na frente) usa o algoritmo clássico de
// DUAS filas: a primeira "apaga" tudo o que dependia da luz que sumiu, e
// guarda as bordas que continuam acesas por outras fontes; a segunda
// "reacende" a partir dessas bordas. Assim só mexemos perto da mudança.
//
// Cada chunk que teve a luz mudada fica marcado (e também os lados da
// borda que mudaram, porque a malha do vizinho lê 1 bloco da nossa borda).
// O world.js pega essa lista e remonta as malhas.

let BITS_INDICE = 1;
while ((1 << BITS_INDICE) < VOLUME) BITS_INDICE++;
const MASCARA_INDICE = (1 << BITS_INDICE) - 1;
const MAX_SLOTS = 1 << (31 - BITS_INDICE); // o número inteiro precisa caber em 31 bits

// Lados (para a tabela de vizinhos): 0 = -X, 1 = +X, 2 = -Z, 3 = +Z
const LADO_OESTE = 0, LADO_LESTE = 1, LADO_NORTE = 2, LADO_SUL = 3;

// Bits de "sujeira" de um chunk: 1 = mudou; os outros = mudou na borda de
// um lado (-X, +X, -Z, +Z) ou numa quina (a coluna do canto, que a malha do
// vizinho da diagonal também lê)
export const SUJO_MUDOU = 1;
export const SUJO_OESTE = 2;    // x = 0
export const SUJO_LESTE = 4;    // x = 15
export const SUJO_NORTE = 8;    // z = 0
export const SUJO_SUL = 16;     // z = 15
export const SUJO_NO = 32;      // quina x = 0, z = 0
export const SUJO_NE = 64;      // quina x = 15, z = 0
export const SUJO_SO = 128;     // quina x = 0, z = 15
export const SUJO_SE = 256;     // quina x = 15, z = 15
export const SUJO_TUDO = 511;
// Para cada coluna (x + z*16), os bits de borda dela (já com o "mudou")
const BORDA = new Uint16Array(AREA);
for (let z = 0; z < TAM; z++) {
  for (let x = 0; x < TAM; x++) {
    let b = SUJO_MUDOU;
    if (x === 0) b |= SUJO_OESTE;
    if (x === MASCARA) b |= SUJO_LESTE;
    if (z === 0) b |= SUJO_NORTE;
    if (z === MASCARA) b |= SUJO_SUL;
    if (x === 0 && z === 0) b |= SUJO_NO;
    if (x === MASCARA && z === 0) b |= SUJO_NE;
    if (x === 0 && z === MASCARA) b |= SUJO_SO;
    if (x === MASCARA && z === MASCARA) b |= SUJO_SE;
    BORDA[x + z * TAM] = b;
  }
}

export class Iluminacao {
  constructor() {
    this.chunks = [];          // slot → Chunk (ou null)
    this.luz = [];             // slot → luzBloco do chunk
    this.dados = [];           // slot → dados do chunk
    this.viz = new Int32Array(0); // slot * 4 + lado → slot do vizinho (-1 = não carregado)
    this.sujo = new Uint16Array(0); // slot → bits SUJO_* (o que mudou desde a última coleta)
    // slot → 1 se o chunk já teve alguma luz (0 = tudo escuro: dá para pular a borda dele)
    this.aceso = new Uint8Array(0);
    this.livres = [];          // slots vagos
    this.totalSlots = 0;
    this._crescerSlots(256);

    // Chunks marcados (com luz mudada) desde a última coleta
    this.tocados = new Int32Array(64);
    this.nTocados = 0;

    // Fila de "acender" (simples: só cresce durante uma busca e volta a 0 no fim)
    this.fila = new Int32Array(1 << 15);
    this.ini = 0;
    this.fim = 0;
    // Fila de "apagar": posição + o nível que ela tinha
    this.filaApagar = new Int32Array(1 << 13);
    this.nivelApagar = new Uint8Array(1 << 13);
    this.iniA = 0;
    this.fimA = 0;
    // Fontes transparentes (tochas) apagadas sem querer, para reacender depois
    this.fontes = new Int32Array(256);
    this.nFontes = 0;

    // Números para o debug e os testes
    this.contagem = { buscas: 0, passos: 0 };
  }

  _crescerSlots(n) {
    const viz = new Int32Array(n * 4).fill(-1);
    viz.set(this.viz);
    this.viz = viz;
    const sujo = new Uint16Array(n);
    sujo.set(this.sujo);
    this.sujo = sujo;
    const aceso = new Uint8Array(n);
    aceso.set(this.aceso);
    this.aceso = aceso;
    for (let s = this.totalSlots; s < n; s++) {
      this.chunks[s] = null;
      this.luz[s] = null;
      this.dados[s] = null;
    }
    // os vagos novos vão para o fim da lista, e o pop() pega os menores primeiro
    for (let s = n - 1; s >= this.totalSlots; s--) this.livres.push(s);
    this.totalSlots = n;
  }

  /**
   * Põe um chunk recém-carregado na iluminação e liga com os 4 vizinhos
   * (Chunk ou null). Depois chame calcularChunk(ch).
   */
  registrar(ch, oeste, leste, norte, sul) {
    if (ch.slotLuz >= 0) return;
    if (this.livres.length === 0) {
      if (this.totalSlots >= MAX_SLOTS) throw new Error('Iluminacao: chunks demais carregados');
      this._crescerSlots(Math.min(MAX_SLOTS, this.totalSlots * 2));
    }
    const s = this.livres.pop();
    ch.slotLuz = s;
    this.chunks[s] = ch;
    this.luz[s] = ch.luzBloco;
    this.dados[s] = ch.dados;
    this.sujo[s] = 0;
    this.aceso[s] = 0; // chunk novo: a luz dele começa zerada
    const viz = this.viz;
    const ligar = (lado, outro, ladoDele) => {
      if (outro && outro.slotLuz >= 0) {
        viz[s * 4 + lado] = outro.slotLuz;
        viz[outro.slotLuz * 4 + ladoDele] = s;
      } else {
        viz[s * 4 + lado] = -1;
      }
    };
    ligar(LADO_OESTE, oeste, LADO_LESTE);
    ligar(LADO_LESTE, leste, LADO_OESTE);
    ligar(LADO_NORTE, norte, LADO_SUL);
    ligar(LADO_SUL, sul, LADO_NORTE);
  }

  /** Tira o chunk (descarregado) da iluminação. A luz que ele deu aos vizinhos fica. */
  remover(ch) {
    const s = ch.slotLuz;
    if (s < 0) return;
    const viz = this.viz;
    for (let lado = 0; lado < 4; lado++) {
      const o = viz[s * 4 + lado];
      if (o >= 0) viz[o * 4 + (lado ^ 1)] = -1; // o lado oposto: 0↔1 e 2↔3
      viz[s * 4 + lado] = -1;
    }
    if (this.sujo[s] !== 0) {
      // estava na lista de tocados: tira de lá
      for (let k = 0; k < this.nTocados; k++) {
        if (this.tocados[k] === s) { this.tocados[k] = this.tocados[--this.nTocados]; break; }
      }
      this.sujo[s] = 0;
    }
    this.chunks[s] = null;
    this.luz[s] = null;
    this.dados[s] = null;
    ch.slotLuz = -1;
    this.livres.push(s);
  }

  /** Esquece tudo (Novo mundo). */
  limpar() {
    for (let s = 0; s < this.totalSlots; s++) {
      if (this.chunks[s]) this.chunks[s].slotLuz = -1;
    }
    this.chunks.length = 0;
    this.luz.length = 0;
    this.dados.length = 0;
    this.viz = new Int32Array(0);
    this.sujo = new Uint16Array(0);
    this.aceso = new Uint8Array(0);
    this.livres.length = 0;
    this.totalSlots = 0;
    this.nTocados = 0;
    this._crescerSlots(256);
  }

  // ----------------------------------------------------------------
  // Marcação dos chunks mexidos
  // ----------------------------------------------------------------

  /** Marca que a luz da posição i do slot s mudou (e de que borda). */
  _marcar(s, i) {
    if (this.sujo[s] === 0) {
      this.aceso[s] = 1; // toda mudança de luz passa por aqui pelo menos uma vez
      if (this.nTocados >= this.tocados.length) {
        const t = new Int32Array(this.tocados.length * 2);
        t.set(this.tocados);
        this.tocados = t;
      }
      this.tocados[this.nTocados++] = s;
    }
    this.sujo[s] |= BORDA[i & (AREA - 1)];
  }

  /** Marca um chunk inteiro como mexido (com todas as bordas). */
  _marcarTudo(s) {
    if (this.sujo[s] === 0) this._marcar(s, 0);
    this.sujo[s] = SUJO_TUDO;
  }

  /**
   * Chama fn(chunk, bits) para cada chunk cuja luz mudou desde a última
   * coleta e limpa a lista. bits: SUJO_MUDOU | SUJO_OESTE | ... | SUJO_NO ...
   * (as bordas e quinas que mudaram, para remontar também a malha do
   * vizinho daquele lado ou daquela diagonal).
   */
  coletarSujos(fn) {
    for (let k = 0; k < this.nTocados; k++) {
      const s = this.tocados[k];
      const bits = this.sujo[s];
      this.sujo[s] = 0;
      const ch = this.chunks[s];
      if (ch && bits) fn(ch, bits);
    }
    this.nTocados = 0;
  }

  // ----------------------------------------------------------------
  // Filas
  // ----------------------------------------------------------------

  _empurrar(s, i) {
    if (this.fim >= this.fila.length) {
      const f = new Int32Array(this.fila.length * 2);
      f.set(this.fila.subarray(0, this.fim));
      this.fila = f;
    }
    this.fila[this.fim++] = (s << BITS_INDICE) | i;
  }

  _empurrarApagar(s, i, nivel) {
    if (this.fimA >= this.filaApagar.length) {
      const f = new Int32Array(this.filaApagar.length * 2);
      f.set(this.filaApagar.subarray(0, this.fimA));
      this.filaApagar = f;
      const n = new Uint8Array(this.nivelApagar.length * 2);
      n.set(this.nivelApagar.subarray(0, this.fimA));
      this.nivelApagar = n;
    }
    this.filaApagar[this.fimA] = (s << BITS_INDICE) | i;
    this.nivelApagar[this.fimA++] = nivel;
  }

  /** Vizinho (s2, j) recebe o nível n, se for mais forte que o atual e não tapar. */
  _acender(s2, j, n) {
    const luz = this.luz[s2];
    if (luz[j] >= n) return;
    if (TAPA[this.dados[s2][j]]) return;
    luz[j] = n;
    this._marcar(s2, j);
    this._empurrar(s2, j);
  }

  /**
   * Fila de "acender": cada posição passa a luz dela (menos 1) para os 6
   * vizinhos. Atravessa as bordas pela tabela `viz`.
   */
  _propagar() {
    const viz = this.viz;
    const luzes = this.luz;
    const todosDados = this.dados;
    const sujo = this.sujo;
    let passos = 0;
    while (this.ini < this.fim) {
      const no = this.fila[this.ini++];
      const s = no >>> BITS_INDICE;
      const i = no & MASCARA_INDICE;
      const luz = luzes[s];
      const L = luz[i];
      if (L <= 1) continue;
      const n = L - 1;
      passos++;
      const dados = todosDados[s];
      const lx = i & MASCARA;
      const lz = (i >> BITS) & MASCARA;
      const y = i >> BITS_Y;
      // Os vizinhos dentro do mesmo chunk são o caso comum: a conta fica
      // escrita aqui mesmo (mais rápido). Quem está do outro lado da borda
      // passa pelo _acender, que olha o chunk vizinho.
      // Marcação: se o chunk ainda não está na lista dos mexidos, o _marcar
      // põe; se já está, basta juntar os bits da borda (BORDA já inclui o "mudou").
      let j, v;
      // -X / +X
      if (lx > 0) {
        j = i - 1;
        if (luz[j] < n && !TAPA[dados[j]]) { luz[j] = n; if (sujo[s] === 0) this._marcar(s, j); else sujo[s] |= BORDA[j & (AREA - 1)]; this._empurrar(s, j); }
      } else if ((v = viz[s * 4 + LADO_OESTE]) >= 0) this._acender(v, i + MASCARA, n);
      if (lx < MASCARA) {
        j = i + 1;
        if (luz[j] < n && !TAPA[dados[j]]) { luz[j] = n; if (sujo[s] === 0) this._marcar(s, j); else sujo[s] |= BORDA[j & (AREA - 1)]; this._empurrar(s, j); }
      } else if ((v = viz[s * 4 + LADO_LESTE]) >= 0) this._acender(v, i - MASCARA, n);
      // -Z / +Z
      if (lz > 0) {
        j = i - TAM;
        if (luz[j] < n && !TAPA[dados[j]]) { luz[j] = n; if (sujo[s] === 0) this._marcar(s, j); else sujo[s] |= BORDA[j & (AREA - 1)]; this._empurrar(s, j); }
      } else if ((v = viz[s * 4 + LADO_NORTE]) >= 0) this._acender(v, i + MASCARA * TAM, n);
      if (lz < MASCARA) {
        j = i + TAM;
        if (luz[j] < n && !TAPA[dados[j]]) { luz[j] = n; if (sujo[s] === 0) this._marcar(s, j); else sujo[s] |= BORDA[j & (AREA - 1)]; this._empurrar(s, j); }
      } else if ((v = viz[s * 4 + LADO_SUL]) >= 0) this._acender(v, i - MASCARA * TAM, n);
      // -Y / +Y (sempre no mesmo chunk)
      if (y > 0) {
        j = i - AREA;
        if (luz[j] < n && !TAPA[dados[j]]) { luz[j] = n; if (sujo[s] === 0) this._marcar(s, j); else sujo[s] |= BORDA[j & (AREA - 1)]; this._empurrar(s, j); }
      }
      if (y < ALTURA - 1) {
        j = i + AREA;
        if (luz[j] < n && !TAPA[dados[j]]) { luz[j] = n; if (sujo[s] === 0) this._marcar(s, j); else sujo[s] |= BORDA[j & (AREA - 1)]; this._empurrar(s, j); }
      }
    }
    this.ini = 0;
    this.fim = 0;
    this.contagem.passos += passos;
  }

  /** Um vizinho visitado pela fila de apagar (ver _apagarTudo). */
  _apagarVizinho(s2, j, L) {
    const luz = this.luz[s2];
    const Ln = luz[j];
    if (Ln === 0) return;
    const idn = this.dados[s2][j];
    if (TAPA[idn]) {
      // Bloco que tapa só tem luz se for fonte (cristal): ele continua aceso
      // e volta a espalhar a luz dele no buraco que vai ficar escuro.
      if (LUZ_PROPRIA[idn] > 0) this._empurrar(s2, j);
      return;
    }
    if (Ln < L) {
      // Essa luz pode ter vindo da que sumiu: apaga e continua daqui
      luz[j] = 0;
      this._marcar(s2, j);
      this._empurrarApagar(s2, j, Ln);
      if (LUZ_PROPRIA[idn] > 0) {
        // Era uma tocha: ela continua existindo, reacende no fim
        if (this.nFontes >= this.fontes.length) {
          const f = new Int32Array(this.fontes.length * 2);
          f.set(this.fontes);
          this.fontes = f;
        }
        this.fontes[this.nFontes++] = (s2 << BITS_INDICE) | j;
      }
    } else {
      // Luz igual ou mais forte vem de outra fonte: ela vai reacender o buraco
      this._empurrar(s2, j);
    }
  }

  /** Fila de "apagar" inteira (a fila de acender recebe as bordas que continuam acesas). */
  _apagarTudo() {
    const viz = this.viz;
    while (this.iniA < this.fimA) {
      const no = this.filaApagar[this.iniA];
      const L = this.nivelApagar[this.iniA++];
      const s = no >>> BITS_INDICE;
      const i = no & MASCARA_INDICE;
      const lx = i & MASCARA;
      const lz = (i >> BITS) & MASCARA;
      const y = i >> BITS_Y;
      let v;
      if (lx > 0) this._apagarVizinho(s, i - 1, L);
      else if ((v = viz[s * 4 + LADO_OESTE]) >= 0) this._apagarVizinho(v, i + MASCARA, L);
      if (lx < MASCARA) this._apagarVizinho(s, i + 1, L);
      else if ((v = viz[s * 4 + LADO_LESTE]) >= 0) this._apagarVizinho(v, i - MASCARA, L);
      if (lz > 0) this._apagarVizinho(s, i - TAM, L);
      else if ((v = viz[s * 4 + LADO_NORTE]) >= 0) this._apagarVizinho(v, i + MASCARA * TAM, L);
      if (lz < MASCARA) this._apagarVizinho(s, i + TAM, L);
      else if ((v = viz[s * 4 + LADO_SUL]) >= 0) this._apagarVizinho(v, i - MASCARA * TAM, L);
      if (y > 0) this._apagarVizinho(s, i - AREA, L);
      if (y < ALTURA - 1) this._apagarVizinho(s, i + AREA, L);
    }
    this.iniA = 0;
    this.fimA = 0;
    // Tochas apagadas no caminho: voltam a ter a própria luz
    for (let k = 0; k < this.nFontes; k++) {
      const no = this.fontes[k];
      const s = no >>> BITS_INDICE;
      const i = no & MASCARA_INDICE;
      const e = LUZ_PROPRIA[this.dados[s][i]];
      if (e > this.luz[s][i]) {
        this.luz[s][i] = e;
        this._marcar(s, i);
        this._empurrar(s, i);
      }
    }
    this.nFontes = 0;
  }

  /** Empurra os 6 vizinhos acesos de (s, i) na fila de acender. */
  _empurrarVizinhos(s, i) {
    const viz = this.viz;
    const lx = i & MASCARA;
    const lz = (i >> BITS) & MASCARA;
    const y = i >> BITS_Y;
    let v;
    if (lx > 0) this._seAceso(s, i - 1);
    else if ((v = viz[s * 4 + LADO_OESTE]) >= 0) this._seAceso(v, i + MASCARA);
    if (lx < MASCARA) this._seAceso(s, i + 1);
    else if ((v = viz[s * 4 + LADO_LESTE]) >= 0) this._seAceso(v, i - MASCARA);
    if (lz > 0) this._seAceso(s, i - TAM);
    else if ((v = viz[s * 4 + LADO_NORTE]) >= 0) this._seAceso(v, i + MASCARA * TAM);
    if (lz < MASCARA) this._seAceso(s, i + TAM);
    else if ((v = viz[s * 4 + LADO_SUL]) >= 0) this._seAceso(v, i - MASCARA * TAM);
    if (y > 0) this._seAceso(s, i - AREA);
    if (y < ALTURA - 1) this._seAceso(s, i + AREA);
  }

  _seAceso(s, i) {
    if (this.luz[s][i] > 1) this._empurrar(s, i);
  }

  // ----------------------------------------------------------------
  // O que o world.js chama
  // ----------------------------------------------------------------

  /**
   * Luz de um chunk recém-gerado: acende as fontes dele e puxa a luz que
   * chega pelas bordas dos vizinhos já carregados. A luz das fontes dele
   * também entra nos vizinhos (e eles ficam marcados para remontar).
   */
  calcularChunk(ch) {
    const s = ch.slotLuz;
    if (s < 0) return;
    this.contagem.buscas++;
    const d = ch.dados;
    const luz = ch.luzBloco;
    const fimFontes = ch.yMaximo * AREA;
    for (let i = 0; i < fimFontes; i++) {
      const e = LUZ_PROPRIA[d[i]];
      if (e > luz[i]) {
        luz[i] = e;
        this._marcar(s, i);
        this._empurrar(s, i);
      }
    }
    this._puxarBordas(s);
    this._propagar();
  }

  /** Empurra na fila as posições acesas dos vizinhos que encostam no chunk s. */
  _puxarBordas(s) {
    const viz = this.viz;
    // Oeste: a coluna x = 15 dele encosta no nosso x = 0 (e assim por diante)
    for (let k = 0; k < 4; k++) {
      const v = viz[s * 4 + k]; // k = LADO_OESTE, LADO_LESTE, LADO_NORTE, LADO_SUL
      if (v < 0 || this.aceso[v] === 0) continue; // vizinho todo escuro: nada para puxar
      const luzV = this.luz[v];
      for (let y = 0; y < ALTURA; y++) {
        const base = y * AREA;
        for (let t = 0; t < TAM; t++) {
          let j;
          if (k === 0) j = base + MASCARA + t * TAM;       // x = 15 do vizinho de -X
          else if (k === 1) j = base + t * TAM;            // x = 0 do vizinho de +X
          else if (k === 2) j = base + t + MASCARA * TAM;  // z = 15 do vizinho de -Z
          else j = base + t;                               // z = 0 do vizinho de +Z
          if (luzV[j] > 1) this._empurrar(v, j);
        }
      }
    }
  }

  /**
   * Um bloco do chunk mudou de `antes` para `depois` (o dado já está gravado).
   * Atualiza a luz só em volta da mudança.
   */
  alterarBloco(ch, i, antes, depois) {
    const s = ch.slotLuz;
    if (s < 0) return;
    const tapaAntes = TAPA[antes], tapaDepois = TAPA[depois];
    const eAntes = LUZ_PROPRIA[antes], eDepois = LUZ_PROPRIA[depois];
    if (tapaAntes === tapaDepois && eAntes === eDepois) return; // nada muda na luz
    this.contagem.buscas++;
    const luz = ch.luzBloco;
    const Lc = luz[i];

    if (!tapaAntes && !tapaDepois && eDepois >= eAntes) {
      // Só ficou mais claro (ex.: tocha no ar): basta acender
      if (eDepois > Lc) {
        luz[i] = eDepois;
        this._marcar(s, i);
        this._empurrar(s, i);
        this._propagar();
      }
      return;
    }

    // Caso geral: apaga a luz que passava por aqui e reacende o que der
    if (Lc > 0) {
      luz[i] = 0;
      this._marcar(s, i);
      this._empurrarApagar(s, i, Lc);
    }
    this._apagarTudo();
    // Se agora a luz passa por aqui, os vizinhos acesos entram de novo
    if (!tapaDepois) this._empurrarVizinhos(s, i);
    if (eDepois > luz[i]) {
      luz[i] = eDepois;
      this._marcar(s, i);
      this._empurrar(s, i);
    }
    this._propagar();
  }

  /**
   * Refaz do zero a luz de um grupo de chunks (ex.: depois de carregar um
   * save por cima de chunks já carregados). Inclua no grupo os vizinhos dos
   * chunks mudados, para não sobrar luz de uma tocha que não existe mais.
   */
  recalcular(listaChunks) {
    const marca = new Set();
    for (const ch of listaChunks) {
      if (ch && ch.slotLuz >= 0) marca.add(ch.slotLuz);
    }
    for (const s of marca) {
      this.luz[s].fill(0);
      this._marcarTudo(s);
    }
    for (const s of marca) {
      const ch = this.chunks[s];
      const d = ch.dados;
      const luz = ch.luzBloco;
      const fimFontes = ch.yMaximo * AREA;
      for (let i = 0; i < fimFontes; i++) {
        const e = LUZ_PROPRIA[d[i]];
        if (e > luz[i]) {
          luz[i] = e;
          this._empurrar(s, i);
        }
      }
      // Bordas: só as que vêm de chunks de fora do grupo (os de dentro estão zerados)
      for (let lado = 0; lado < 4; lado++) {
        const v = this.viz[s * 4 + lado];
        if (v >= 0 && !marca.has(v)) { this._puxarBordas(s); break; }
      }
    }
    this.contagem.buscas++;
    this._propagar();
  }
}

// =====================================================================
// Montagem da malha
// =====================================================================

// Para não precisar perguntar "esse vizinho está em outro chunk?" a cada
// bloco, copiamos o chunk para uma caixa com 1 bloco de borda em volta
// (18 x 18 de largura e ALTURA+2 de altura). A borda vem dos 8 chunks
// vizinhos. Depois disso, o vizinho de qualquer bloco é só "índice + passo".
const PX = TAM + 2;          // largura da caixa com borda
const PAREA = PX * PX;       // uma camada da caixa
const PY = ALTURA + 2;       // altura da caixa (1 camada embaixo e 1 em cima)
const PVOLUME = PAREA * PY;
// índice na caixa: (x + 1) + (z + 1) * PX + (y + 1) * PAREA

// As 6 faces: 0 = +X (leste), 1 = -X (oeste), 2 = +Y (topo), 3 = -Y (baixo),
//             4 = +Z (sul),   5 = -Z (norte)
const PASSO_FACE = new Int32Array([1, -1, PAREA, -PAREA, PX, -PX]);

// Qual textura cada face usa: 0 = 'topo', 1 = 'lado', 2 = 'baixo' (3 = 'frente', do baú)
const TEX_FACE = new Uint8Array([1, 1, 0, 2, 1, 1]);
const NOMES_TEX_FACE = ['topo', 'lado', 'baixo', 'frente'];
const TEX_TOPO = 0, TEX_LADO = 1, TEX_FRENTE = 3;
// Face que é a "frente" para cada direção (0 = -Z, 1 = +X, 2 = +Z, 3 = -X)
const FACE_DA_DIRECAO = new Uint8Array([5, 0, 4, 1]);

// Sombra fixa de cada face (dá a sensação de volume, como no Minecraft)
const SOMBRA_FACE = new Float32Array([0.8, 0.8, 1.0, 0.5, 0.65, 0.65]);

// Quanto cada nível de oclusão de ambiente (AO) escurece.
// ao = 3: canto livre; ao = 0: canto bem apertado entre dois blocos.
const FATOR_AO = new Float32Array([0.45, 0.65, 0.82, 1.0]);

// Luz do céu em níveis de 0 a 15 (como no Minecraft). 15 = sol direto.
// Abaixo do bloco que tapa mais alto da coluna (cavernas, buracos cobertos)
// a luz cai para LUZ_CAVERNA. A luz das tochas é o 2º canal (luzBloco),
// que já vem calculada pela Iluminacao.
const NIVEL_MAX = 15;
const NIVEL_CAVERNA = Math.round((CONFIG.LUZ_CAVERNA ?? 0.3) * NIVEL_MAX);
const PARA_BYTE = 255 / NIVEL_MAX; // nível 0..15 → byte 0..255 (atributo normalizado)

// A superfície da água fica um pouco abaixo do topo do bloco
const ALTURA_AGUA = 1 - (CONFIG.AFUNDAR_AGUA ?? 0.1);
const V_AGUA = Math.round(ALTURA_AGUA * 255); // coordenada v (textura) do topo da água nas laterais

// Os 4 cantos de cada face, na ordem anti-horária vista de FORA do bloco
// (é a ordem que o three.js considera "frente"). O canto k tem a coordenada
// de textura UV_CANTO[k]: (0,0) (1,0) (1,1) (0,1). Para as laterais, v = 0 é
// a base do bloco e v = 1 é o topo (a borda verde da grama fica em cima), e u
// cresce para a direita de quem olha de fora (a textura não fica espelhada).
const CANTOS = new Uint8Array([
  // +X: olhando de +X, a direita é -Z
  1, 0, 1,  1, 0, 0,  1, 1, 0,  1, 1, 1,
  // -X: olhando de -X, a direita é +Z
  0, 0, 0,  0, 0, 1,  0, 1, 1,  0, 1, 0,
  // +Y (topo): visto de cima, u = x e v cresce para -Z
  0, 1, 1,  1, 1, 1,  1, 1, 0,  0, 1, 0,
  // -Y (baixo): visto de baixo, u = x e v = z
  0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1,
  // +Z: olhando de +Z, a direita é +X
  0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  // -Z: olhando de -Z, a direita é -X
  1, 0, 0,  0, 0, 0,  0, 1, 0,  1, 1, 0,
]);
const UV_CANTO = new Uint8Array([0, 0, 255, 0, 255, 255, 0, 255]);

// Para o AO e a luz suave, cada canto de face olha 3 células da camada que
// fica na frente da face: lado1, lado2 e a diagonal (canto).
// Calculamos aqui, uma vez só, o "passo" de índice até cada uma delas.
const VIZ_AO = new Int32Array(6 * 4 * 3);
(function calcularVizinhosAO() {
  const passoEixo = [1, PAREA, PX]; // passo para andar +1 em x, y, z na caixa
  const eixoNormal = [0, 0, 1, 1, 2, 2]; // eixo da normal de cada face
  for (let f = 0; f < 6; f++) {
    const n = eixoNormal[f];
    const t1 = (n + 1) % 3; // os 2 eixos "deitados" na face
    const t2 = (n + 2) % 3;
    for (let k = 0; k < 4; k++) {
      const c = (f * 4 + k) * 3;
      // canto com coordenada 0 → vizinho do lado de menos; 1 → lado de mais
      const s1 = CANTOS[c + t1] ? 1 : -1;
      const s2 = CANTOS[c + t2] ? 1 : -1;
      const lado1 = s1 * passoEixo[t1];
      const lado2 = s2 * passoEixo[t2];
      VIZ_AO[c] = lado1;
      VIZ_AO[c + 1] = lado2;
      VIZ_AO[c + 2] = lado1 + lado2;
    }
  }
})();

// --- Modelos (porta e tocha) ---
// Eixo da normal de cada face (0 = x, 1 = y, 2 = z) e se ela fica do lado "1" da caixa
const EIXO_FACE = new Uint8Array([0, 0, 1, 1, 2, 2]);
const LADO_MAIOR = new Uint8Array([1, 0, 1, 0, 1, 0]);

// Tocha: palito de 2 x 10 pixels no meio do bloco. A textura 'tocha' tem o
// palito nas colunas 7 e 8 e a chama no alto (linhas 2 a 5, contando de
// cima). Os 10 pixels do modelo mostram as linhas 2 a 11 da textura: por
// isso o v da textura é o y do modelo + 4/16.
const TOCHA_ALTURA = 10 * PX16;
const TOCHA_PONTA = 6 * PX16;   // a partir daqui (4 pixels de cima) é a ponta acesa
const TOCHA_V_LADO = 4 * PX16;  // deslocamento do v nas laterais
const TOCHA_V_TOPO = 5 * PX16;  // topo: mostra a brasa (linhas 2 e 3)
const TOCHA_V_BAIXO = -7 * PX16; // baixo: mostra a madeira (linhas 14 e 15)
const PALITO = [7 * PX16, 0, 7 * PX16, 9 * PX16, TOCHA_PONTA, 9 * PX16];
const PONTA = [7 * PX16, TOCHA_PONTA, 7 * PX16, 9 * PX16, TOCHA_ALTURA, 9 * PX16];
// Tocha na parede: a base fica no plano da parede, 3,5 pixels acima do chão
// do bloco, e o palito inclina 22,5° para longe da parede (como no Minecraft)
const TOCHA_INCLINACAO = 22.5 * Math.PI / 180;
const SEN_INCL = Math.sin(TOCHA_INCLINACAO);
const COS_INCL = Math.cos(TOCHA_INCLINACAO);
const TOCHA_BASE_PAREDE = 3.5 * PX16;

/**
 * Arrays de uma malha que vão crescendo conforme a necessidade.
 * São reaproveitados de um chunk para o outro (sem criar lixo para o
 * coletor de memória). No fim, extrair() copia só a parte usada.
 */
class BufferMalha {
  /**
   * @param capacidade quantos vértices cabem no começo (cresce sozinho)
   * @param comBrilho  true = guarda também o atributo aBrilho (a água não usa)
   */
  constructor(capacidade = 8192, comBrilho = true) {
    this.capacidade = 0;
    this.nVert = 0;
    this.nInd = 0;
    this.yMin = 0;
    this.yMax = 0;
    this.comBrilho = comBrilho;
    this.brilho = null;
    this.crescer(capacidade);
  }

  crescer(capacidade) {
    const ant = this.capacidade > 0 ? this : null;
    const pos = new Float32Array(capacidade * 3);
    const uv = new Uint8Array(capacidade * 2);
    const camada = new Uint8Array(capacidade);
    const sombra = new Uint8Array(capacidade);
    const luzCeu = new Uint8Array(capacidade);
    const luzBloco = new Uint8Array(capacidade);
    const brilho = this.comBrilho ? new Uint8Array(capacidade) : null;
    const ind = new Uint32Array((capacidade / 4) * 6);
    if (ant) {
      pos.set(ant.pos.subarray(0, ant.nVert * 3));
      uv.set(ant.uv.subarray(0, ant.nVert * 2));
      camada.set(ant.camada.subarray(0, ant.nVert));
      sombra.set(ant.sombra.subarray(0, ant.nVert));
      luzCeu.set(ant.luzCeu.subarray(0, ant.nVert));
      luzBloco.set(ant.luzBloco.subarray(0, ant.nVert));
      if (brilho) brilho.set(ant.brilho.subarray(0, ant.nVert));
      ind.set(ant.ind.subarray(0, ant.nInd));
    }
    this.pos = pos;
    this.uv = uv;
    this.camada = camada;
    this.sombra = sombra;
    this.luzCeu = luzCeu;
    this.luzBloco = luzBloco;
    this.brilho = brilho;
    this.ind = ind;
    this.capacidade = capacidade;
  }

  limpar() {
    this.nVert = 0;
    this.nInd = 0;
    this.yMin = ALTURA;
    this.yMax = 0;
  }

  /** Cópia exata da parte usada (o three.js guarda estes arrays). null se vazio. */
  extrair() {
    if (this.nVert === 0) return null;
    return {
      posicoes: this.pos.slice(0, this.nVert * 3), // Float32Array, 3 por vértice (coordenadas locais do chunk)
      uvs: this.uv.slice(0, this.nVert * 2),       // Uint8Array normalizado (0..255 = 0..1)
      camadas: this.camada.slice(0, this.nVert),   // Uint8Array normalizado: camada = valor * 255
      sombras: this.sombra.slice(0, this.nVert),   // Uint8Array normalizado (face × AO)
      luzCeu: this.luzCeu.slice(0, this.nVert),    // Uint8Array normalizado (luz do céu 0..1)
      luzBloco: this.luzBloco.slice(0, this.nVert), // Uint8Array normalizado (luz das tochas 0..1)
      // Uint8Array normalizado: 0 = não brilha; 1..255 = brilha, e o valor é a fase
      // da pulsação (null na água, que nunca brilha)
      brilhos: this.brilho ? this.brilho.slice(0, this.nVert) : null,
      indices: this.ind.slice(0, this.nInd),       // Uint32Array
      yMin: this.yMin,
      yMax: this.yMax,
    };
  }
}

/**
 * Monta as malhas de um chunk.
 *   const montador = new MontadorMalha(texturas.indice);
 *   const r = montador.montar(vizinhos);
 * `vizinhos` é um array de 9 chunks (ou null) em volta, nesta ordem:
 *   índice = (dz + 1) * 3 + (dx + 1)     (o do meio, índice 4, é o próprio chunk)
 * Devolve { solido, agua, faces }, onde solido/agua são os arrays prontos
 * para BufferGeometry (ver BufferMalha.extrair) ou null se não tiver nada.
 * Precisa dos vizinhos porque as faces da borda, o AO e a luz suave dos
 * cantos olham blocos que moram no chunk do lado.
 */
export class MontadorMalha {
  constructor(indiceTextura) {
    // indiceTextura(nome) → camada da textura (texturas.indice)
    this.indiceTextura = indiceTextura;
    // Cache id + face → camada da textura (-1 = ainda não perguntado)
    this.cacheCamadas = new Int16Array(256 * 4).fill(-1);

    this.blocos = new Uint8Array(PVOLUME);   // caixa com borda: ids
    this.luzCeu = new Uint8Array(PVOLUME);   // caixa com borda: luz do céu (0..15)
    this.luzBloco = new Uint8Array(PVOLUME); // caixa com borda: luz das tochas (0..15)

    // Camada de baixo da caixa (y = -1): finge que é rocha, para não desenhar
    // a face de baixo do mundo. Camada de cima (y = ALTURA): ar com sol.
    // Essas duas camadas nunca são sobrescritas.
    this.blocos.fill(B.ROCHA_MATRIZ, 0, PAREA);
    this.blocos.fill(B.AR, (PY - 1) * PAREA, PVOLUME);
    this.luzCeu.fill(NIVEL_MAX, (PY - 1) * PAREA, PVOLUME);

    this.solido = new BufferMalha(16384, true);
    this.agua = new BufferMalha(4096, false); // a água nunca brilha

    // Rascunhos para os 4 cantos de uma face (sem alocar no laço)
    this._sombra = new Float32Array(4);
    this._luz = new Float32Array(4);
    this._luzB = new Float32Array(4);
    this._estadosCentro = null; // estados do chunk do meio (durante a montagem)

    // Canto do chunk que está sendo montado, em coordenadas do mundo
    // (para sortear a fase do brilho pela posição de verdade do bloco)
    this._x0 = 0;
    this._z0 = 0;
  }

  /** Camada da textura de uma face do bloco (com cache). texFace: 0 topo, 1 lado, 2 baixo, 3 frente */
  camadaDe(id, texFace) {
    const k = id * 4 + texFace;
    let c = this.cacheCamadas[k];
    if (c < 0) {
      const nome = texFace === TEX_FRENTE
        ? (BLOCOS[id]?.texturaFrente ?? texturaDaFace(id, 'lado'))
        : texturaDaFace(id, NOMES_TEX_FACE[texFace]);
      c = nome ? this.indiceTextura(nome) : 0;
      if (!(c >= 0 && c <= 255)) c = 0;
      this.cacheCamadas[k] = c;
    }
    return c;
  }

  /** Esquece o cache (use se as texturas forem recriadas). */
  limparCache() {
    this.cacheCamadas.fill(-1);
  }

  /** Copia o chunk do meio + 1 bloco de borda dos vizinhos para a caixa. */
  copiarComBorda(vizinhos) {
    const blocos = this.blocos;
    const luz = this.luzCeu;
    const luzB = this.luzBloco;
    const centro = vizinhos[4];
    // Só precisamos até a camada logo acima do bloco mais alto do chunk do meio
    const yCopia = Math.min(centro.yMaximo + 1, ALTURA);

    for (let pz = 0; pz < PX; pz++) {
      const z = pz - 1;
      const dz = z < 0 ? -1 : (z >= TAM ? 1 : 0);
      const lz = z - dz * TAM;
      for (let px = 0; px < PX; px++) {
        const x = px - 1;
        const dx = x < 0 ? -1 : (x >= TAM ? 1 : 0);
        const lx = x - dx * TAM;
        const ch = vizinhos[(dz + 1) * 3 + (dx + 1)];
        let iDest = px + pz * PX + PAREA; // começa em y = 0
        if (ch) {
          const dados = ch.dados;
          const lb = ch.luzBloco;
          const col = lx + lz * TAM;
          const alt = ch.alturas[col];
          let iSrc = col;
          for (let y = 0; y < yCopia; y++, iSrc += AREA, iDest += PAREA) {
            blocos[iDest] = dados[iSrc];
            // Luz do céu simples: acima do bloco que tapa mais alto da coluna = sol
            luz[iDest] = y >= alt ? NIVEL_MAX : NIVEL_CAVERNA;
            luzB[iDest] = lb[iSrc];
          }
        } else {
          // Vizinho não carregado: trata como ar iluminado
          for (let y = 0; y < yCopia; y++, iDest += PAREA) {
            blocos[iDest] = B.AR;
            luz[iDest] = NIVEL_MAX;
            luzB[iDest] = 0;
          }
        }
      }
    }
  }

  montar(vizinhos) {
    const centro = vizinhos[4];
    const solido = this.solido;
    const agua = this.agua;
    solido.limpar();
    agua.limpar();
    if (centro.yMaximo === 0) return { solido: null, agua: null, faces: 0 };

    this._x0 = centro.cx * TAM;
    this._z0 = centro.cz * TAM;
    this.copiarComBorda(vizinhos);
    const blocos = this.blocos;
    const estados = centro.estados;
    this._estadosCentro = estados;
    const yMax = centro.yMaximo;
    let faces = 0;

    for (let y = 0; y < yMax; y++) {
      for (let z = 0; z < TAM; z++) {
        let i = 1 + (z + 1) * PX + (y + 1) * PAREA; // índice na caixa do bloco (0, y, z)
        for (let x = 0; x < TAM; x++, i++) {
          const id = blocos[i];
          if (id === B.AR) continue;
          if (MODELO[id] !== MODELO_CUBO) {
            // Porta e tocha: desenho próprio (caixas menores que o bloco)
            faces += this.modelo(solido, i, x, y, z, id, estados[x + z * TAM + y * AREA]);
            continue;
          }
          const junta = JUNTA[id];
          // Baú: qual face é a frente (-1 = nenhuma)
          const faceFrente = TEM_FRENTE[id] ? FACE_DA_DIRECAO[estados[x + z * TAM + y * AREA] & 3] : -1;
          for (let f = 0; f < 6; f++) {
            const n = blocos[i + PASSO_FACE[f]];
            // Regra da face visível:
            //  - vizinho é ar → desenha
            //  - vizinho é cubo opaco → não desenha (ninguém vê)
            //  - vizinho transparente (água, folhas, vidro, porta, tocha) → desenha,
            //    menos quando é igual a mim e eu "junto" (água com água, vidro com
            //    vidro). Folha com folha desenha (fica com o visual "cheio" das copas)
            if (n !== B.AR && (TAPA[n] || (n === id && junta))) continue;
            if (LIQUIDO[id]) this.faceAgua(agua, i, x, y, z, f, id);
            else this.faceSolida(solido, i, x, y, z, f, id, f === faceFrente);
            faces++;
          }
        }
      }
    }
    return { solido: solido.extrair(), agua: agua.extrair(), faces };
  }

  /** Face de bloco sólido: com AO e luz suave (céu e tochas) por canto. */
  faceSolida(buf, i, x, y, z, f, id, frente) {
    const blocos = this.blocos;
    const luz = this.luzCeu;
    const luzB = this.luzBloco;
    const iN = i + PASSO_FACE[f]; // a célula para onde a face olha
    const sombraFace = SOMBRA_FACE[f];
    const tmpS = this._sombra;
    const tmpL = this._luz;
    const tmpB = this._luzB;

    // Para cada canto: AO (quantos dos 3 vizinhos tapam) e a média da luz
    // das células transparentes em volta do canto (luz suave).
    for (let k = 0; k < 4; k++) {
      const o = (f * 4 + k) * 3;
      const i1 = iN + VIZ_AO[o];
      const i2 = iN + VIZ_AO[o + 1];
      const ic = iN + VIZ_AO[o + 2];
      const s1 = TAPA[blocos[i1]];
      const s2 = TAPA[blocos[i2]];
      const sc = TAPA[blocos[ic]];
      // Se os dois lados estão tampados, o canto fica no escuro máximo
      // (mesmo que a diagonal esteja livre, a luz não "passa" pela quina)
      const ambos = s1 & s2;
      const ao = ambos ? 0 : 3 - s1 - s2 - sc;

      let soma = luz[iN];
      let somaB = luzB[iN];
      let qtd = 1;
      if (!s1) { soma += luz[i1]; somaB += luzB[i1]; qtd++; }
      if (!s2) { soma += luz[i2]; somaB += luzB[i2]; qtd++; }
      if (!sc && !ambos) { soma += luz[ic]; somaB += luzB[ic]; qtd++; }

      tmpS[k] = sombraFace * FATOR_AO[ao];
      tmpL[k] = soma / qtd;  // nível 0..15
      tmpB[k] = somaB / qtd; // nível 0..15
    }

    // Truque contra o serrilhado: um quadrado vira 2 triângulos, e a cor é
    // interpolada em cada triângulo separado. Se um canto é escuro e os
    // outros claros, a escolha da diagonal muda o desenho. Cortamos pela
    // diagonal mais CLARA, assim a sombra de um canto fica presa no seu triângulo.
    const b0 = tmpS[0] * (tmpL[0] > tmpB[0] ? tmpL[0] : tmpB[0]);
    const b1 = tmpS[1] * (tmpL[1] > tmpB[1] ? tmpL[1] : tmpB[1]);
    const b2 = tmpS[2] * (tmpL[2] > tmpB[2] ? tmpL[2] : tmpB[2]);
    const b3 = tmpS[3] * (tmpL[3] > tmpB[3] ? tmpL[3] : tmpB[3]);
    const virar = b0 + b2 < b1 + b3;

    // Bloco que brilha (cristal): a fase depende da posição no mundo, então
    // as 6 faces do mesmo bloco pulsam juntas, e os vizinhos pulsam em outro momento
    const brilho = BRILHA[id] ? faseDoBrilho(this._x0 + x, y, this._z0 + z) : 0;
    const camada = this.camadaDe(id, frente ? TEX_FRENTE : TEX_FACE[f]);

    this.escreverQuad(buf, x, y, z, f, camada, 1, virar, brilho);
  }

  /** Face de água: sem AO, superfície um pouco abaixada. */
  faceAgua(buf, i, x, y, z, f, id) {
    const acima = this.blocos[i + PAREA];
    // Abaixa o topo se em cima não tem água (nem bloco opaco tampando)
    const topo = (LIQUIDO[acima] || TAPA[acima]) ? 1 : ALTURA_AGUA;
    const iN = i + PASSO_FACE[f];
    const l = this.luzCeu[iN];
    // A água deixa a luz passar: usa a mais forte entre a da frente e a de dentro
    const lb = Math.max(this.luzBloco[iN], this.luzBloco[i]);
    const s = SOMBRA_FACE[f];
    const tmpS = this._sombra;
    const tmpL = this._luz;
    const tmpB = this._luzB;
    for (let k = 0; k < 4; k++) { tmpS[k] = s; tmpL[k] = l; tmpB[k] = lb; }
    this.escreverQuad(buf, x, y, z, f, this.camadaDe(id, TEX_FACE[f]), topo, false, 0);
  }

  /**
   * Escreve os 4 vértices e os 6 índices de uma face.
   * brilho: 0 = normal; 1..255 = bloco que brilha (o valor é a fase da pulsação)
   */
  escreverQuad(buf, x, y, z, f, camada, topo, virar, brilho) {
    if (buf.nVert + 4 > buf.capacidade) buf.crescer(buf.capacidade * 2);
    const v = buf.nVert;
    const pos = buf.pos;
    const uv = buf.uv;
    const tmpS = this._sombra;
    const tmpL = this._luz;
    const tmpB = this._luzB;
    const rebaixado = topo !== 1;
    const arrBrilho = buf.brilho; // null na água
    if (arrBrilho) {
      arrBrilho[v] = brilho;
      arrBrilho[v + 1] = brilho;
      arrBrilho[v + 2] = brilho;
      arrBrilho[v + 3] = brilho;
    }

    for (let k = 0; k < 4; k++) {
      const c = (f * 4 + k) * 3;
      const cy = CANTOS[c + 1];
      const vi = v + k;
      pos[vi * 3] = x + CANTOS[c];
      pos[vi * 3 + 1] = y + (cy ? topo : 0);
      pos[vi * 3 + 2] = z + CANTOS[c + 2];
      uv[vi * 2] = UV_CANTO[k * 2];
      // Nas laterais da água rebaixada, a textura também é cortada no topo
      uv[vi * 2 + 1] = (rebaixado && cy && f !== 2 && f !== 3) ? V_AGUA : UV_CANTO[k * 2 + 1];
      buf.camada[vi] = camada;
      buf.sombra[vi] = (tmpS[k] * 255 + 0.5) | 0;
      buf.luzCeu[vi] = (tmpL[k] * PARA_BYTE + 0.5) | 0;
      buf.luzBloco[vi] = (tmpB[k] * PARA_BYTE + 0.5) | 0;
    }

    const ind = buf.ind;
    let n = buf.nInd;
    if (virar) {
      // diagonal 1-3
      ind[n++] = v + 1; ind[n++] = v + 2; ind[n++] = v + 3;
      ind[n++] = v + 1; ind[n++] = v + 3; ind[n++] = v;
    } else {
      // diagonal 0-2
      ind[n++] = v; ind[n++] = v + 1; ind[n++] = v + 2;
      ind[n++] = v; ind[n++] = v + 2; ind[n++] = v + 3;
    }
    buf.nInd = n;
    buf.nVert = v + 4;
    if (y < buf.yMin) buf.yMin = y;
    if (y + 1 > buf.yMax) buf.yMax = y + 1;
  }

  // ----------------------------------------------------------------
  // Modelos: porta e tocha
  // ----------------------------------------------------------------
  // Cada modelo é feito de caixas pensadas na posição padrão (direção 0).
  // Para cada face da caixa calculamos os 4 cantos e o uv "automático"
  // (o pedaço da textura que fica naquela posição do bloco, como no
  // Minecraft), e só DEPOIS giramos os cantos para a direção certa. Assim
  // a textura gira junto com a porta. Os modelos não têm AO: usam a luz do
  // próprio bloco (porta e tocha não tapam, então o bloco delas tem luz).

  /** Desenha porta ou tocha. Devolve quantas faces escreveu. */
  modelo(buf, i, x, y, z, id, estado) {
    const m = MODELO[id];
    const ceu = this.luzCeu[i];
    const bloco = this.luzBloco[i];
    let faces = 0;

    if (m === MODELO_PORTA) {
      const r = estado & ESTADO_DIRECAO;
      const aberta = (estado & ESTADO_ABERTA) !== 0;
      const cima = (estado & ESTADO_CIMA) !== 0;
      const caixa = aberta ? PORTA_ABERTA : PORTA_FECHADA;
      // metade de cima usa a textura de 'topo' (porta_cima); a de baixo, a de 'lado'
      const camada = this.camadaDe(id, cima ? TEX_TOPO : TEX_LADO);
      for (let f = 0; f < 6; f++) {
        // Espelhar o u (trocar esquerda e direita da textura):
        //  - nas 2 faces grandes, para a dobradiça da textura (u = 0) ficar
        //    sempre no lado da dobradiça e a maçaneta do lado livre, olhando
        //    de qualquer lado da porta (fechada: a face -Z; aberta: a +X);
        //  - nas 2 bordas finas da porta aberta, para a borda livre mostrar a
        //    moldura do lado da maçaneta (e não as dobradiças da textura).
        const espelhar = aberta ? (f === 0 || f === 4 || f === 5) : f === 5;
        const fg = GIRO_FACE[r * 6 + f]; // a face depois de girar
        const naBorda = caixa[EIXO_FACE[f] + (LADO_MAIOR[f] ? 3 : 0)] === LADO_MAIOR[f];
        let luzC = ceu, luzBl = bloco;
        if (naBorda) {
          const n = this.blocos[i + PASSO_FACE[fg]];
          if (TAPA[n]) continue; // encostada num bloco cheio: ninguém vê
          // Entre as duas metades da mesma porta: face escondida
          if (n === id && (f === 2 || f === 3)) {
            const iVizinho = (x + z * TAM) + (y + (f === 2 ? 1 : -1)) * AREA;
            const eViz = (f === 2 ? y + 1 < ALTURA : y > 0) ? this._estadosCentro[iVizinho] : -1;
            if (eViz >= 0 && (eViz & 7) === (estado & 7) && ((eViz & ESTADO_CIMA) !== 0) === (f === 2)) continue;
          }
          // Face na borda do bloco: usa a luz mais forte (a de dentro ou a da frente)
          const iN = i + PASSO_FACE[fg];
          if (this.luzCeu[iN] > luzC) luzC = this.luzCeu[iN];
          if (this.luzBloco[iN] > luzBl) luzBl = this.luzBloco[iN];
        }
        this.faceCaixa(buf, x, y, z, caixa, f, r, false, camada, espelhar, 0, luzC, luzBl, 0);
        faces++;
      }
      return faces;
    }

    if (m === MODELO_TOCHA) {
      const camada = this.camadaDe(id, TEX_LADO);
      const parede = estado >= 1 && estado <= 4;
      const r = parede ? estado - 1 : 0;
      const brilho = faseDoBrilho(this._x0 + x, y, this._z0 + z);
      // Palito (sem brilho): 4 lados + o fundo (no chão, só se não estiver apoiado num bloco cheio)
      for (let f = 0; f < 6; f++) {
        if (f === 2) continue; // o topo do palito fica dentro da ponta
        if (f === 3 && !parede && TAPA[this.blocos[i - PAREA]]) continue;
        const vOff = f === 3 ? TOCHA_V_BAIXO : TOCHA_V_LADO;
        this.faceCaixa(buf, x, y, z, PALITO, f, r, parede, camada, false, vOff, ceu, bloco, 0);
        faces++;
      }
      // Ponta acesa (com brilho): 4 lados + o topo
      for (let f = 0; f < 6; f++) {
        if (f === 3) continue;
        const vOff = f === 2 ? TOCHA_V_TOPO : TOCHA_V_LADO;
        this.faceCaixa(buf, x, y, z, PONTA, f, r, parede, camada, false, vOff, ceu, bloco, brilho);
        faces++;
      }
      return faces;
    }
    return 0;
  }

  /**
   * Escreve a face f de uma caixa (posição padrão), girada r × 90°.
   *   inclinar: tocha de parede (inclina 22,5° para longe da parede em -Z)
   *   espelhar: troca u por 1 - u
   *   vOff:     soma no v da textura
   *   luzC/luzBl: níveis 0..15 de céu e tocha (iguais nos 4 cantos)
   */
  faceCaixa(buf, x, y, z, c, f, r, inclinar, camada, espelhar, vOff, luzC, luzBl, brilho) {
    if (buf.nVert + 4 > buf.capacidade) buf.crescer(buf.capacidade * 2);
    const v = buf.nVert;
    const pos = buf.pos;
    const uv = buf.uv;
    const sombra = (SOMBRA_FACE[GIRO_FACE[(r & 3) * 6 + f]] * 255 + 0.5) | 0;
    const bCeu = (luzC * PARA_BYTE + 0.5) | 0;
    const bBloco = (luzBl * PARA_BYTE + 0.5) | 0;
    let yMin = y + 1, yMax = y;

    for (let k = 0; k < 4; k++) {
      const o = (f * 4 + k) * 3;
      // Canto da caixa: o CANTOS diz se é o lado menor (0) ou maior (1) em cada eixo
      let px = CANTOS[o] ? c[3] : c[0];
      let py = CANTOS[o + 1] ? c[4] : c[1];
      let pz = CANTOS[o + 2] ? c[5] : c[2];

      // uv automático (o pedaço da textura daquela posição), na posição padrão
      let u, vv;
      switch (f) {
        case 0: u = 1 - pz; vv = py; break;
        case 1: u = pz; vv = py; break;
        case 2: u = px; vv = 1 - pz; break;
        case 3: u = px; vv = pz; break;
        case 4: u = px; vv = py; break;
        default: u = 1 - px; vv = py; break;
      }
      if (espelhar) u = 1 - u;
      vv += vOff;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      vv = vv < 0 ? 0 : vv > 1 ? 1 : vv;

      if (inclinar) {
        // Tocha na parede: centro do palito na origem, inclina em volta do
        // eixo X (o topo vai para +Z) e põe a base no plano da parede (z = 0)
        const qx = px - 0.5;
        const qy = py;
        const qz = pz - 0.5;
        px = qx + 0.5;
        py = qy * COS_INCL - qz * SEN_INCL + TOCHA_BASE_PAREDE;
        pz = qz * COS_INCL + qy * SEN_INCL;
      }
      girar(r, px, pz);
      const vi = v + k;
      pos[vi * 3] = x + GIRO_X;
      pos[vi * 3 + 1] = y + py;
      pos[vi * 3 + 2] = z + GIRO_Z;
      uv[vi * 2] = (u * 255 + 0.5) | 0;
      uv[vi * 2 + 1] = (vv * 255 + 0.5) | 0;
      buf.camada[vi] = camada;
      buf.sombra[vi] = sombra;
      buf.luzCeu[vi] = bCeu;
      buf.luzBloco[vi] = bBloco;
      if (buf.brilho) buf.brilho[vi] = brilho;
      if (y + py < yMin) yMin = y + py;
      if (y + py > yMax) yMax = y + py;
    }

    const ind = buf.ind;
    let n = buf.nInd;
    ind[n++] = v; ind[n++] = v + 1; ind[n++] = v + 2;
    ind[n++] = v; ind[n++] = v + 2; ind[n++] = v + 3;
    buf.nInd = n;
    buf.nVert = v + 4;
    if (yMin < buf.yMin) buf.yMin = Math.floor(yMin);
    if (yMax > buf.yMax) buf.yMax = Math.ceil(yMax);
  }
}
