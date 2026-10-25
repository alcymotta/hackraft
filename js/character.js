// =====================================================================
// Hackraft - Personagem de blocos (estilo Minecraft)
// ---------------------------------------------------------------------
// Partes: cabeça 8x8x8, corpo 8x12x4, braços e pernas 4x12x4 (em "pixels
// de skin"). 1 pixel = 1.8/32 bloco, então o boneco tem 1.8 de altura.
// A skin é um canvas 64x64 no layout de skin do Minecraft (formato novo).
// A frente do personagem olha para -Z quando rotation.y = 0.
// =====================================================================

import * as THREE from 'three';
import { texturaDaFace } from './blocks.js';

const ESCALA = 1.8 / 32; // tamanho de 1 pixel de skin, em blocos
const DURACAO_GOLPE = 0.25; // segundos do balanço do braço ao golpear
const POSE_NADO_ANGULO = 1.4;     // inclinação do corpo ao nadar (~80 graus)
const POSE_PLANAR_ANGULO = 1.15;  // inclinação do corpo ao planar (~66 graus)
const CENTRO_CORPO = 0.9;         // altura do centro do boneco (o corpo gira em volta dele)
const DOIS_PI = Math.PI * 2;

// Cores padrão (strings CSS)
const CORES_PADRAO = {
  pele: '#e0ac84',
  cabelo: '#4a2f1b',
  olhos: '#3a6fb0',
  camisa: '#2f8fd8',
  calca: '#3b4a9c',
  sapato: '#4a4a4f',
};

// ---------------------------------------------------------------------
// Gerador pseudoaleatório de semente fixa (a skin sai sempre igual)
// ---------------------------------------------------------------------
function mulberry32(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Converte uma cor CSS em [r, g, b] usando um canvas de 1 pixel
let canvasCor = null;
function paraRGB(css) {
  if (!canvasCor) {
    canvasCor = document.createElement('canvas');
    canvasCor.width = canvasCor.height = 1;
  }
  const c = canvasCor.getContext('2d', { willReadFrequently: true });
  c.clearRect(0, 0, 1, 1);
  c.fillStyle = '#000';
  c.fillStyle = css; // se a cor for inválida, fica preto
  c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const lim = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clarear = (c, d) => [lim(c[0] + d), lim(c[1] + d), lim(c[2] + d)];

/**
 * Regiões de uma caixa no layout de skin do Minecraft.
 * (x, y) = canto da caixa no canvas; w, h, d = largura, altura, profundidade.
 * Cada região é [x, y, largura, altura] em pixels.
 */
function regioes(x, y, w, h, d) {
  return {
    topo: [x + d, y, w, d],
    baixo: [x + d + w, y, w, d],
    direita: [x, y + d, d, h],
    frente: [x + d, y + d, w, h],
    esquerda: [x + d + w, y + d, d, h],
    tras: [x + d + w + d, y + d, w, h],
  };
}

// Posições de cada parte no canvas 64x64
const CAIXAS = {
  cabeca: { x: 0, y: 0, w: 8, h: 8, d: 8 },
  corpo: { x: 16, y: 16, w: 8, h: 12, d: 4 },
  bracoD: { x: 40, y: 16, w: 4, h: 12, d: 4 },
  pernaD: { x: 0, y: 16, w: 4, h: 12, d: 4 },
  bracoE: { x: 32, y: 48, w: 4, h: 12, d: 4 },
  pernaE: { x: 16, y: 48, w: 4, h: 12, d: 4 },
};

/**
 * Ajusta as UVs de uma BoxGeometry para as regiões da skin.
 * Ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z.
 * Com a frente em -Z: +x = direita, -x = esquerda, +z = trás, -z = frente.
 */
function mapearUV(geo, caixa, opc = {}) {
  // opc.tw/th = tamanho do canvas (64x64 por padrão; a armadura usa 64x32)
  // opc.deLinha/nLinhas = usa só uma faixa de linhas das laterais (botas, cintura)
  const tw = opc.tw || 64;
  const th = opc.th || 64;
  const r = regioes(caixa.x, caixa.y, caixa.w, caixa.h, caixa.d);
  if (opc.nLinhas) {
    for (const k of ['direita', 'frente', 'esquerda', 'tras']) {
      r[k] = [r[k][0], r[k][1] + opc.deLinha, r[k][2], opc.nLinhas];
    }
  }
  // [região, girar180]: topo e baixo precisam girar 180° no layout do Minecraft
  const faces = [
    [r.direita, false], [r.esquerda, false],
    [r.topo, true], [r.baixo, true],
    [r.tras, false], [r.frente, false],
  ];
  const uv = geo.attributes.uv;
  faces.forEach(([reg, girar], i) => {
    const u0 = reg[0] / tw;
    const u1 = (reg[0] + reg[2]) / tw;
    const vCima = 1 - reg[1] / th;
    const vBaixo = 1 - (reg[1] + reg[3]) / th;
    // ordem dos vértices do BoxGeometry: (0,1) (1,1) (0,0) (1,0)
    const pts = girar
      ? [[u1, vBaixo], [u0, vBaixo], [u1, vCima], [u0, vCima]]
      : [[u0, vCima], [u1, vCima], [u0, vBaixo], [u1, vBaixo]];
    for (let k = 0; k < 4; k++) uv.setXY(i * 4 + k, pts[k][0], pts[k][1]);
  });
  uv.needsUpdate = true;
}

// ---------------------------------------------------------------------
// Desenho da skin padrão
// ---------------------------------------------------------------------
function desenharSkin(canvas, cores) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 64, 64);
  const rnd = mulberry32(20240607); // semente fixa

  const cPele = paraRGB(cores.pele);
  const cCabelo = paraRGB(cores.cabelo);
  const cOlhos = paraRGB(cores.olhos);
  const cCamisa = paraRGB(cores.camisa);
  const cCalca = paraRGB(cores.calca);
  const cSapato = paraRGB(cores.sapato);

  const cor = (c) => `rgb(${Math.round(lim(c[0]))},${Math.round(lim(c[1]))},${Math.round(lim(c[2]))})`;
  // Pixel (i, j) dentro de uma região
  const pix = (reg, i, j, c) => {
    ctx.fillStyle = cor(c);
    ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1);
  };
  // Preenche a região com a cor, variando o tom de cada pixel
  const encher = (reg, c, variacao = 8, deLinha = 0, ateLinha = reg[3] - 1) => {
    for (let j = deLinha; j <= ateLinha; j++) {
      for (let i = 0; i < reg[2]; i++) {
        pix(reg, i, j, clarear(c, (rnd() - 0.5) * 2 * variacao));
      }
    }
  };
  // Pinta uma linha inteira de uma região com um tom mais claro/escuro
  const sombra = (reg, j, delta) => {
    for (let i = 0; i < reg[2]; i++) {
      ctx.fillStyle = `rgba(${delta < 0 ? '0,0,0' : '255,255,255'},${Math.abs(delta) / 100})`;
      ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1);
    }
  };
  const todas = (r) => [r.topo, r.baixo, r.direita, r.frente, r.esquerda, r.tras];

  // ---------- CABEÇA ----------
  const cab = regioes(0, 0, 8, 8, 8);
  todas(cab).forEach((reg) => encher(reg, cPele, 6));
  // cabelo no topo e na nuca
  encher(cab.topo, cCabelo, 10);
  encher(cab.tras, cCabelo, 10);
  sombra(cab.tras, 7, -18);
  // laterais: cabelo em cima (3 linhas) e na parte de trás (4 colunas)
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const naTrasDireita = i < 4;   // na região direita, a nuca fica à esquerda
      const naTrasEsquerda = i >= 4; // na região esquerda, a nuca fica à direita
      if (j < 3) {
        pix(cab.direita, i, j, clarear(cCabelo, (rnd() - 0.5) * 20));
        pix(cab.esquerda, i, j, clarear(cCabelo, (rnd() - 0.5) * 20));
      } else {
        if (naTrasDireita && (j < 6 || i < 3)) pix(cab.direita, i, j, clarear(cCabelo, (rnd() - 0.5) * 20));
        if (naTrasEsquerda && (j < 6 || i > 4)) pix(cab.esquerda, i, j, clarear(cCabelo, (rnd() - 0.5) * 20));
      }
    }
  }
  // franja na testa (frente)
  for (let i = 0; i < 8; i++) {
    pix(cab.frente, i, 0, clarear(cCabelo, (rnd() - 0.5) * 20));
    if (i !== 3 && i !== 4) pix(cab.frente, i, 1, clarear(cCabelo, (rnd() - 0.5) * 20));
  }
  pix(cab.frente, 0, 2, clarear(cCabelo, -6));
  pix(cab.frente, 7, 2, clarear(cCabelo, -6));
  // sobrancelhas
  const sobr = clarear(cCabelo, -10);
  [1, 2, 5, 6].forEach((i) => pix(cab.frente, i, 3, sobr));
  // olhos: branco por fora, íris por dentro, pupila embaixo
  const branco = [238, 238, 244];
  pix(cab.frente, 1, 4, branco); pix(cab.frente, 2, 4, cOlhos);
  pix(cab.frente, 5, 4, cOlhos); pix(cab.frente, 6, 4, branco);
  pix(cab.frente, 2, 5, clarear(cOlhos, -60)); pix(cab.frente, 5, 5, clarear(cOlhos, -60));
  pix(cab.frente, 1, 5, clarear(cPele, -14)); pix(cab.frente, 6, 5, clarear(cPele, -14)); // olheiras leves
  // nariz e boca
  pix(cab.frente, 3, 5, clarear(cPele, -16)); pix(cab.frente, 4, 5, clarear(cPele, -16));
  const boca = [176, 84, 84];
  pix(cab.frente, 3, 6, boca); pix(cab.frente, 4, 6, boca);
  pix(cab.frente, 2, 6, clarear(cPele, -10)); pix(cab.frente, 5, 6, clarear(cPele, -10));
  // sombreado do rosto: queixo e laterais um pouco mais escuros
  sombra(cab.frente, 7, -14);
  sombra(cab.direita, 7, -14);
  sombra(cab.esquerda, 7, -14);

  // ---------- CORPO (camiseta + cós da calça) ----------
  const corpo = regioes(16, 16, 8, 12, 4);
  [corpo.direita, corpo.frente, corpo.esquerda, corpo.tras, corpo.topo].forEach((reg) => encher(reg, cCamisa, 7, 0, 9));
  [corpo.direita, corpo.frente, corpo.esquerda, corpo.tras].forEach((reg) => encher(reg, cCalca, 6, 10, 11));
  encher(corpo.baixo, cCalca, 6);
  // dobra e sombra da camiseta
  [corpo.frente, corpo.tras].forEach((reg) => {
    sombra(reg, 9, -22);   // barra da camiseta
    sombra(reg, 8, -8);
    sombra(reg, 10, -20);  // cós da calça
  });
  [corpo.direita, corpo.esquerda].forEach((reg) => { sombra(reg, 9, -22); sombra(reg, 10, -20); });
  // gola: pescoço aparece em V na frente
  pix(corpo.frente, 3, 0, cPele); pix(corpo.frente, 4, 0, cPele);
  pix(corpo.frente, 3, 1, clarear(cPele, -12)); pix(corpo.frente, 4, 1, clarear(cPele, -12));
  pix(corpo.frente, 2, 0, clarear(cCamisa, -28)); pix(corpo.frente, 5, 0, clarear(cCamisa, -28));
  // sombreado vertical: um pouco mais escuro nas laterais do corpo
  for (let j = 0; j < 10; j++) { sombra(corpo.frente, j, 0); }
  for (let j = 1; j < 9; j++) { pix(corpo.frente, 0, j, clarear(cCamisa, -14)); pix(corpo.frente, 7, j, clarear(cCamisa, -14)); }
  // botão do cós
  pix(corpo.frente, 3, 10, clarear(cCalca, 28)); pix(corpo.frente, 4, 10, clarear(cCalca, 28));

  // ---------- BRAÇOS (manga curta + pele) ----------
  const bracoD = regioes(40, 16, 4, 12, 4);
  const bracoE = regioes(32, 48, 4, 12, 4);
  [bracoD, bracoE].forEach((b) => {
    [b.direita, b.frente, b.esquerda, b.tras].forEach((reg) => {
      encher(reg, cPele, 6);                // pele no braço todo
      encher(reg, cCamisa, 7, 0, 3);        // manga curta (4 linhas)
      sombra(reg, 3, -22);                  // barra da manga
      sombra(reg, 4, -10);                  // sombra da manga na pele
      sombra(reg, 11, -10);                 // mão um pouco mais escura embaixo
    });
    encher(b.topo, cCamisa, 7);
    encher(b.baixo, cPele, 6);
  });

  // ---------- PERNAS (calça + sapato) ----------
  const pernaD = regioes(0, 16, 4, 12, 4);
  const pernaE = regioes(16, 48, 4, 12, 4);
  [pernaD, pernaE].forEach((p) => {
    [p.direita, p.frente, p.esquerda, p.tras].forEach((reg) => {
      encher(reg, cCalca, 7, 0, 8);
      encher(reg, cSapato, 8, 9, 11);
      sombra(reg, 8, -12);                  // dobra da barra da calça
      sombra(reg, 9, -18);
      sombra(reg, 11, -28);                 // sola do sapato
      // costura lateral mais escura
      if (reg !== p.frente && reg !== p.tras) for (let j = 1; j < 8; j++) pix(reg, 2, j, clarear(cCalca, -10));
    });
    encher(p.topo, cCalca, 6);
    encher(p.baixo, cSapato, 8);
    // bico do sapato mais claro
    pix(p.frente, 1, 10, clarear(cSapato, 22)); pix(p.frente, 2, 10, clarear(cSapato, 22));
  });
}

// ---------------------------------------------------------------------
// Cores por apelido: cada jogador ganha uma camisa diferente
// ---------------------------------------------------------------------
const PALETA = [
  { camisa: '#2f8fd8', calca: '#2b3a6e' }, // azul
  { camisa: '#d83a3a', calca: '#3a3a44' }, // vermelho
  { camisa: '#3fae44', calca: '#3b3326' }, // verde
  { camisa: '#e8d238', calca: '#3d3a5c' }, // amarelo
  { camisa: '#8a46c8', calca: '#2e2e3a' }, // roxo
  { camisa: '#f08a24', calca: '#33383f' }, // laranja
  { camisa: '#30d0d0', calca: '#2a3b50' }, // ciano
  { camisa: '#f06aa8', calca: '#3a3340' }, // rosa
];

/** Escolhe a cor da camisa (e da calça) a partir de um hash simples do apelido */
export function coresPorApelido(apelido) {
  const texto = String(apelido || '');
  // Hash FNV-1a + mistura final dos bits (sem a mistura, nomes parecidos
  // como "Pai" e "Filho" caíam na mesma cor)
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  const p = PALETA[(h >>> 0) % PALETA.length];
  return { ...CORES_PADRAO, camisa: p.camisa, calca: p.calca };
}

// ---------------------------------------------------------------------
// CAMADAS DE VISUAL (Fase 3)
//   1. skin base        -> skinCanvas (acima)
//   2. roupa            -> pintada na skin + 2ª camada do layout 64x64
//                          (caixas 0.5 px maiores) + peças 3D extras
//   3. armadura         -> caixas 1 px maiores, textura própria por material
// Mais: capa (acessório) e item na mão.
// ---------------------------------------------------------------------

// Quais roupas existem (o desenho de cada uma está em DESENHOS_ROUPA)
export const VISUAIS_ROUPA = {
  ninja: { rotulo: 'Ninja', cor: '#1b2033' },
  cavaleiro: { rotulo: 'Cavaleiro', cor: '#2a4fa8' },
  mago: { rotulo: 'Mago', cor: '#5a2e91' },
  astronauta: { rotulo: 'Astronauta', cor: '#e9edf2' },
  pirata: { rotulo: 'Pirata', cor: '#c0282d' },
  hacker: { rotulo: 'Hacker', cor: '#121212' },
};

const NEON = '#39ff6a'; // verde-neon da roupa hacker (brilha por emissive)

// Posição das caixas da 2ª camada no canvas 64x64 (layout de skin novo)
const CAIXAS_2 = {
  cabeca: { x: 32, y: 0, w: 8, h: 8, d: 8 },
  corpo: { x: 16, y: 32, w: 8, h: 12, d: 4 },
  bracoD: { x: 40, y: 32, w: 4, h: 12, d: 4 },
  bracoE: { x: 48, y: 48, w: 4, h: 12, d: 4 },
  pernaD: { x: 0, y: 32, w: 4, h: 12, d: 4 },
  pernaE: { x: 0, y: 48, w: 4, h: 12, d: 4 },
};

// Posição das caixas no canvas de armadura 64x32 (estilo Minecraft)
const CAIXAS_ARM = {
  cabeca: { x: 0, y: 0, w: 8, h: 8, d: 8 },
  corpo: { x: 16, y: 16, w: 8, h: 12, d: 4 },
  braco: { x: 40, y: 16, w: 4, h: 12, d: 4 },
  perna: { x: 0, y: 16, w: 4, h: 12, d: 4 },
};

const criarCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// "#rrggbb" -> [r, g, b]
function hexRGB(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbCss = (c) => `rgb(${Math.round(lim(c[0]))},${Math.round(lim(c[1]))},${Math.round(lim(c[2]))})`;

// ---------------------------------------------------------------------
// Pincel para desenhar as roupas. Cada região é [x, y, largura, altura].
// B = regiões da skin base, O = regiões da 2ª camada (overlay).
// ---------------------------------------------------------------------
function criarPincel() {
  const canvas = criarCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  const neonCanvas = criarCanvas(64, 64);
  const nctx = neonCanvas.getContext('2d');
  const rnd = mulberry32(9137);
  const f = { canvas, neonCanvas, usouNeon: false, rnd };

  f.B = {
    cabeca: regioes(0, 0, 8, 8, 8), corpo: regioes(16, 16, 8, 12, 4),
    bracoD: regioes(40, 16, 4, 12, 4), bracoE: regioes(32, 48, 4, 12, 4),
    pernaD: regioes(0, 16, 4, 12, 4), pernaE: regioes(16, 48, 4, 12, 4),
  };
  f.O = {};
  for (const k of Object.keys(CAIXAS_2)) {
    const c = CAIXAS_2[k];
    f.O[k] = regioes(c.x, c.y, c.w, c.h, c.d);
  }
  f.lados = (r) => [r.direita, r.frente, r.esquerda, r.tras];
  f.todas = (r) => [r.direita, r.frente, r.esquerda, r.tras, r.topo, r.baixo];
  // 1 pixel
  f.pix = (reg, i, j, cor) => { ctx.fillStyle = cor; ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1); };
  // retângulo
  f.ret = (reg, i, j, w, h, cor) => { ctx.fillStyle = cor; ctx.fillRect(reg[0] + i, reg[1] + j, w, h); };
  // preenche com leve variação de tom (cor "#rrggbb")
  f.enche = (reg, cor, v = 6, j0 = 0, j1 = reg[3] - 1, i0 = 0, i1 = reg[2] - 1) => {
    const c = hexRGB(cor);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = (rnd() - 0.5) * 2 * v;
        ctx.fillStyle = rgbCss([c[0] + k, c[1] + k, c[2] + k]);
        ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1);
      }
    }
  };
  // pixel verde-neon: pinta na skin e no mapa de brilho
  f.neon = (reg, i, j) => {
    f.usouNeon = true;
    ctx.fillStyle = NEON; ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1);
    nctx.fillStyle = NEON; nctx.fillRect(reg[0] + i, reg[1] + j, 1, 1);
  };
  f.neonRet = (reg, i, j, w, h) => {
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) f.neon(reg, i + a, j + b);
  };
  // algumas estrelinhas em posições sorteadas (determinísticas)
  f.estrelas = (reg, n, cor) => {
    for (let k = 0; k < n; k++) f.pix(reg, Math.floor(rnd() * reg[2]), Math.floor(rnd() * reg[3]), cor);
  };
  return f;
}

// ---------------------------------------------------------------------
// Desenho de cada roupa
// ---------------------------------------------------------------------
const DESENHOS_ROUPA = {
  // ----- NINJA: preto-azulado, máscara, faixa vermelha, cinto -----
  ninja(f) {
    const { B, O, pix, ret, enche, lados, todas } = f;
    const ESC = '#1b2033', PANO = '#454c6b', FAIXA = '#c8202a', NEGRO = '#10131c';
    todas(B.corpo).forEach((r) => enche(r, ESC, 5));
    // gola cruzada (kimono)
    for (let k = 0; k < 4; k++) { pix(B.corpo.frente, 1 + k, k, PANO); pix(B.corpo.frente, 6 - k, k, PANO); }
    lados(B.corpo).forEach((r) => {
      ret(r, 0, 8, r[2], 2, '#3a3f5c');            // cinto
      enche(r, NEGRO, 4, 10, 11);                   // parte de baixo
    });
    pix(B.corpo.frente, 3, 9, '#8c1a22'); pix(B.corpo.frente, 4, 9, '#8c1a22');
    pix(B.corpo.frente, 4, 10, '#8c1a22'); pix(B.corpo.frente, 3, 10, '#6a1219');
    // braços com ataduras nos punhos
    [B.bracoD, B.bracoE].forEach((b) => {
      todas(b).forEach((r) => enche(r, ESC, 5));
      lados(b).forEach((r) => { for (let j = 8; j <= 11; j++) ret(r, 0, j, r[2], 1, j % 2 === 0 ? PANO : ESC); });
    });
    // pernas: ataduras e sapato (tabi) preto
    [B.pernaD, B.pernaE].forEach((p) => {
      todas(p).forEach((r) => enche(r, ESC, 5));
      lados(p).forEach((r) => {
        for (let j = 6; j <= 9; j++) ret(r, 0, j, r[2], 1, j % 2 === 0 ? PANO : ESC);
        enche(r, '#0b0c12', 3, 10, 11);
      });
    });
    // 2ª camada da cabeça: capuz de pano, faixa vermelha e máscara
    const c = O.cabeca;
    enche(c.topo, ESC, 4);
    [c.direita, c.esquerda, c.tras].forEach((r) => { enche(r, ESC, 4); ret(r, 0, 1, 8, 2, FAIXA); ret(r, 0, 2, 8, 1, '#9a1820'); });
    enche(c.frente, ESC, 4, 0, 0);
    ret(c.frente, 0, 1, 8, 2, FAIXA); ret(c.frente, 0, 2, 8, 1, '#9a1820');
    enche(c.frente, ESC, 4, 3, 4, 0, 0); enche(c.frente, ESC, 4, 3, 4, 7, 7); // só os olhos aparecem
    enche(c.frente, ESC, 4, 5, 7);                                            // máscara até o nariz
    ret(c.frente, 1, 5, 6, 1, '#2a3050');
    pix(c.frente, 3, 6, '#262c44'); pix(c.frente, 4, 6, '#262c44');
    // cinto em relevo (2ª camada)
    lados(O.corpo).forEach((r) => ret(r, 0, 8, r[2], 2, '#3a3f5c'));
    ret(O.corpo.frente, 3, 9, 2, 1, '#8c1a22');
  },

  // ----- CAVALEIRO: túnica azul, brasão dourado, cinto marrom, botas -----
  cavaleiro(f) {
    const { B, O, pix, ret, enche, lados, todas } = f;
    const AZ = '#2a4fa8', AZ2 = '#1f3b80', OURO = '#e6c13a', OURO2 = '#a8841f', MARROM = '#6b4423';
    todas(B.corpo).forEach((r) => enche(r, AZ, 6));
    lados(B.corpo).forEach((r) => {
      ret(r, 0, 11, r[2], 1, AZ2);
      ret(r, 0, 8, r[2], 2, MARROM);                // cinto
    });
    ret(B.corpo.frente, 3, 8, 2, 2, OURO); pix(B.corpo.frente, 3, 8, '#fff2a0'); pix(B.corpo.frente, 4, 9, OURO2);
    // cruz do brasão
    ret(B.corpo.frente, 3, 1, 2, 6, OURO);
    ret(B.corpo.frente, 2, 2, 4, 2, OURO);
    pix(B.corpo.frente, 3, 6, OURO2); pix(B.corpo.frente, 4, 6, OURO2);
    pix(B.corpo.frente, 2, 3, OURO2); pix(B.corpo.frente, 5, 3, OURO2);
    // braços: manga azul + luva de ferro
    [B.bracoD, B.bracoE].forEach((b) => {
      todas(b).forEach((r) => enche(r, AZ, 6));
      lados(b).forEach((r) => { enche(r, '#8a909c', 5, 9, 11); ret(r, 0, 9, r[2], 1, '#aab0bc'); ret(r, 0, 8, r[2], 1, OURO2); });
      enche(b.baixo, '#8a909c', 5);
    });
    // pernas: meia cinza-azulada + botas marrons
    [B.pernaD, B.pernaE].forEach((p) => {
      todas(p).forEach((r) => enche(r, '#3a3f55', 5));
      lados(p).forEach((r) => {
        enche(r, '#5a3a1e', 6, 8, 11);
        ret(r, 0, 8, r[2], 1, '#7a5230');
        ret(r, 0, 11, r[2], 1, '#2a1a0c');
      });
      enche(p.baixo, '#2a1a0c', 3);
    });
    // 2ª camada: gola dourada, barra da túnica e ombros
    ret(O.corpo.frente, 2, 0, 4, 1, OURO);
    lados(O.corpo).forEach((r) => { enche(r, AZ, 5, 10, 11); ret(r, 0, 11, r[2], 1, OURO2); });
    [O.bracoD, O.bracoE].forEach((b) => lados(b).forEach((r) => { enche(r, AZ2, 5, 0, 1); ret(r, 0, 1, r[2], 1, OURO2); }));
  },

  // ----- MAGO: manto roxo com estrelas amarelas -----
  mago(f) {
    const { B, O, pix, ret, enche, lados, todas, estrelas } = f;
    const ROXO = '#5a2e91', ROXO2 = '#44226e', OURO = '#e0b43a', ESTR = '#ffe45a';
    const manto = (r, ate) => {
      enche(r, ROXO, 8, 0, ate);
      for (let i = 0; i < r[2]; i += 2) ret(r, i, 0, 1, ate + 1, 'rgba(0,0,0,0.13)'); // dobras
    };
    todas(B.corpo).forEach((r) => enche(r, ROXO, 8));
    lados(B.corpo).forEach((r) => { manto(r, 11); ret(r, 0, 11, r[2], 1, OURO); ret(r, 0, 8, r[2], 1, OURO); });
    pix(B.corpo.frente, 3, 8, '#ffffff'); pix(B.corpo.frente, 4, 8, '#ffffff');
    // estrela grande no peito
    pix(B.corpo.frente, 5, 3, ESTR); pix(B.corpo.frente, 4, 3, '#d9b640'); pix(B.corpo.frente, 6, 3, '#d9b640');
    pix(B.corpo.frente, 5, 2, '#d9b640'); pix(B.corpo.frente, 5, 4, '#d9b640');
    lados(B.corpo).forEach((r) => estrelas(r, 3, ESTR));
    [B.bracoD, B.bracoE].forEach((b) => {
      todas(b).forEach((r) => enche(r, ROXO, 8));
      lados(b).forEach((r) => { manto(r, 11); ret(r, 0, 11, r[2], 1, OURO); estrelas(r, 2, ESTR); });
    });
    [B.pernaD, B.pernaE].forEach((p) => {
      todas(p).forEach((r) => enche(r, ROXO, 8));
      lados(p).forEach((r) => { manto(r, 9); estrelas(r, 2, ESTR); enche(r, '#3a2410', 5, 10, 11); });
    });
    // 2ª camada: barra do manto e mangas largas
    lados(O.corpo).forEach((r) => { enche(r, ROXO2, 5, 10, 11); ret(r, 0, 11, r[2], 1, OURO); });
    ret(O.corpo.frente, 2, 0, 4, 1, OURO);
    [O.bracoD, O.bracoE].forEach((b) => lados(b).forEach((r) => { enche(r, ROXO2, 5, 7, 11); ret(r, 0, 11, r[2], 1, OURO); }));
  },

  // ----- ASTRONAUTA: macacão branco, laranja e bandeira -----
  astronauta(f) {
    const { B, O, pix, ret, enche, lados, todas } = f;
    const BR = '#e9edf2', CINZA = '#9aa3ad', LAR = '#f08a24', PAINEL = '#5b6470';
    todas(B.corpo).forEach((r) => enche(r, BR, 5));
    lados(B.corpo).forEach((r) => { ret(r, 0, 8, r[2], 2, LAR); ret(r, 0, 10, r[2], 2, BR); });
    pix(B.corpo.frente, 3, 8, '#ffd24a'); pix(B.corpo.frente, 4, 8, '#ffd24a');
    // painel de controle no peito
    ret(B.corpo.frente, 2, 1, 4, 4, PAINEL);
    pix(B.corpo.frente, 2, 1, '#3d444d');
    pix(B.corpo.frente, 3, 2, '#e04040'); pix(B.corpo.frente, 4, 2, '#40d060');
    pix(B.corpo.frente, 3, 3, '#4090e0'); pix(B.corpo.frente, 4, 3, '#ffd24a');
    ret(B.corpo.frente, 2, 4, 4, 1, '#3d444d');
    [B.bracoD, B.bracoE].forEach((b) => {
      todas(b).forEach((r) => enche(r, BR, 5));
      lados(b).forEach((r) => { ret(r, 0, 5, r[2], 1, LAR); enche(r, CINZA, 4, 9, 11); ret(r, 0, 9, r[2], 1, '#c8cfd8'); });
    });
    // bandeira do Brasil no braço esquerdo (lado de fora)
    const fl = B.bracoE.esquerda;
    ret(fl, 0, 1, 4, 3, '#1f9a3c'); ret(fl, 1, 2, 2, 1, '#ffdf00'); pix(fl, 1, 2, '#ffdf00'); pix(fl, 2, 2, '#1d4fb0');
    [B.pernaD, B.pernaE].forEach((p) => {
      todas(p).forEach((r) => enche(r, BR, 5));
      lados(p).forEach((r) => { ret(r, 0, 6, r[2], 1, LAR); enche(r, CINZA, 4, 9, 11); ret(r, 0, 9, r[2], 1, '#c8cfd8'); ret(r, 0, 11, r[2], 1, '#5b6470'); });
    });
    // 2ª camada: anel do pescoço
    lados(O.corpo).forEach((r) => ret(r, 0, 0, r[2], 1, '#c8cfd8'));
  },

  // ----- PIRATA: camisa listrada, colete preto, faixa, tapa-olho -----
  pirata(f) {
    const { B, O, pix, ret, enche, lados, todas } = f;
    const BRANCO = '#ecebe6', VERM = '#c0282d', PRETO = '#15151a';
    const listras = (r, j0, j1) => {
      for (let j = j0; j <= j1; j++) enche(r, Math.floor(j / 2) % 2 === 0 ? BRANCO : VERM, 5, j, j);
    };
    todas(B.corpo).forEach((r) => enche(r, BRANCO, 5));
    lados(B.corpo).forEach((r) => { listras(r, 0, 9); enche(r, '#3b2a1c', 5, 10, 11); });
    // braços: manga listrada até o cotovelo, resto fica com a pele da base
    [B.bracoD, B.bracoE].forEach((b) => {
      lados(b).forEach((r) => { listras(r, 0, 7); ret(r, 0, 7, r[2], 1, BRANCO); });
      enche(b.topo, BRANCO, 5);
    });
    // calça marrom e botas pretas com cano dobrado
    [B.pernaD, B.pernaE].forEach((p) => {
      todas(p).forEach((r) => enche(r, '#4a3524', 5));
      lados(p).forEach((r) => {
        enche(r, PRETO, 4, 6, 11);
        ret(r, 0, 6, r[2], 1, '#3a3028');
        ret(r, 0, 7, r[2], 1, '#2a2420');
      });
      enche(p.baixo, PRETO, 3);
    });
    // 2ª camada: colete preto aberto, faixa vermelha, tapa-olho
    const c = O.corpo;
    lados(c).forEach((r) => { if (r !== c.frente) enche(r, PRETO, 4, 0, 8); });
    enche(c.frente, PRETO, 4, 0, 8, 0, 1); enche(c.frente, PRETO, 4, 0, 8, 6, 7);
    pix(c.frente, 1, 3, '#d8b030'); pix(c.frente, 6, 3, '#d8b030'); pix(c.frente, 1, 6, '#d8b030'); pix(c.frente, 6, 6, '#d8b030');
    lados(c).forEach((r) => { ret(r, 0, 9, r[2], 2, '#b3202a'); ret(r, 0, 9, r[2], 1, '#d03a42'); });
    pix(c.frente, 5, 10, '#7a1219'); pix(c.frente, 6, 10, '#7a1219'); pix(c.frente, 6, 11, '#7a1219');
    const h = O.cabeca;
    ret(h.frente, 0, 3, 8, 1, PRETO);                 // tira do tapa-olho cruzando o rosto
    ret(h.frente, 5, 4, 2, 2, PRETO);                 // o tapa-olho (olho direito do personagem)
    ret(h.direita, 0, 3, 8, 1, PRETO); ret(h.esquerda, 0, 3, 8, 1, PRETO); ret(h.tras, 0, 3, 8, 1, PRETO);
  },

  // ----- HACKER: moletom preto com capuz, óculos escuros, verde-neon -----
  hacker(f) {
    const { B, O, pix, ret, enche, lados, todas, neon, neonRet } = f;
    const PRETO = '#121214', CALCA = '#1c1c21', CAPUZ = '#16161a';
    todas(B.corpo).forEach((r) => enche(r, PRETO, 4));
    // bolso canguru e símbolo ">_" no peito
    const cf = B.corpo.frente;
    ret(cf, 1, 8, 6, 3, '#0c0c0e');
    for (let i = 1; i <= 6; i++) neon(cf, i, 8);
    neon(cf, 1, 9); neon(cf, 6, 9);
    neon(cf, 2, 3); neon(cf, 3, 4); neon(cf, 2, 5);   // ">"
    neon(cf, 4, 5); neon(cf, 5, 5);                   // "_"
    neon(cf, 2, 1); neon(cf, 2, 2); neon(cf, 5, 1); neon(cf, 5, 2); // cordões do capuz
    // linhas neon nas costas e nas laterais
    for (let j = 1; j <= 7; j++) neon(B.corpo.tras, 3, j);
    neon(B.corpo.tras, 4, 7);
    for (let j = 0; j <= 7; j += 1) { neon(B.corpo.direita, 1, j); neon(B.corpo.esquerda, 2, j); }
    [B.bracoD, B.bracoE].forEach((b) => {
      todas(b).forEach((r) => enche(r, PRETO, 4));
      lados(b).forEach((r) => enche(r, '#0c0c0e', 3, 10, 11));
      lados(b).forEach((r) => { for (let i = 0; i < r[2]; i++) neon(r, i, 9); });
    });
    for (let j = 0; j <= 7; j++) { neon(B.bracoD.direita, 2, j); neon(B.bracoE.esquerda, 1, j); }
    [B.pernaD, B.pernaE].forEach((p) => {
      todas(p).forEach((r) => enche(r, CALCA, 4));
      lados(p).forEach((r) => { enche(r, '#08080a', 3, 9, 10); for (let i = 0; i < r[2]; i++) neon(r, i, 11); });
      enche(p.baixo, '#08080a', 3);
    });
    for (let j = 0; j <= 7; j++) { neon(B.pernaD.direita, 1, j); neon(B.pernaE.esquerda, 2, j); }
    // 2ª camada: capuz (rosto livre), óculos escuros
    const c = O.cabeca;
    enche(c.topo, CAPUZ, 4); enche(c.tras, CAPUZ, 4); enche(c.direita, CAPUZ, 4); enche(c.esquerda, CAPUZ, 4);
    enche(c.frente, CAPUZ, 4, 0, 1);
    enche(c.frente, CAPUZ, 4, 2, 7, 0, 0); enche(c.frente, CAPUZ, 4, 2, 7, 7, 7);
    for (let i = 2; i <= 5; i++) neon(c.topo, i, 1);       // circuito no topo do capuz
    for (let i = 1; i <= 6; i++) { if (i !== 3 && i !== 4) neon(c.frente, i, 0); }
    neon(c.tras, 3, 4); neon(c.tras, 4, 4); neon(c.tras, 3, 5); neon(c.tras, 4, 5);
    // óculos
    ret(c.frente, 1, 3, 6, 1, '#050507');
    ret(c.frente, 1, 4, 2, 1, '#050507'); ret(c.frente, 5, 4, 2, 1, '#050507');
    neon(c.frente, 1, 3); neon(c.frente, 5, 3);
    ret(c.direita, 0, 3, 8, 1, '#050507'); ret(c.esquerda, 0, 3, 8, 1, '#050507');
    // moletom em relevo
    lados(O.corpo).forEach((r) => enche(r, CAPUZ, 4, 10, 11));
    ret(O.corpo.frente, 0, 10, 8, 2, '#0c0c0e');
  },
};

// Camadas de roupa já desenhadas (uma por visual, criadas só na primeira vez)
const camadasRoupa = new Map();
function camadaDaRoupa(nome) {
  let c = camadasRoupa.get(nome);
  if (!c) {
    const f = criarPincel();
    DESENHOS_ROUPA[nome](f);
    c = { canvas: f.canvas, neonCanvas: f.neonCanvas, temNeon: f.usouNeon };
    camadasRoupa.set(nome, c);
  }
  return c;
}

// ---------------------------------------------------------------------
// ARMADURA: registro de materiais (fácil de estender na Fase 9)
// ---------------------------------------------------------------------
// cor = cor base; estilo = 'couro' (costuras) ou 'metal' (rebites e brilho)
export const MATERIAIS_ARMADURA = {
  couro: { rotulo: 'Couro', cor: '#8b5a2b', estilo: 'couro' },
  ferro: { rotulo: 'Ferro', cor: '#c4c8cf', estilo: 'metal' },
  // Fase 9 (registrados mais abaixo, depois do cache de materiais)
};

/** Cria (ou troca) um material de armadura. Ex.: registrarMaterialArmadura('ouro', { rotulo:'Ouro', cor:'#f0c030', estilo:'metal' }) */
export function registrarMaterialArmadura(nome, def) {
  MATERIAIS_ARMADURA[nome] = def;
  // joga fora o material em cache e as variantes com melhoria ('nome+2'...)
  for (const [k, m] of [...materiaisArmadura]) {
    if (k !== nome && !k.startsWith(nome + '+')) continue;
    if (k === nome) m.map.dispose();
    m.dispose();
    materiaisArmadura.delete(k);
  }
}

/** Separa 'ferro+2' em { base: 'ferro', n: 2 }. Sem sufixo, n = 0. */
export function separarMelhoria(nome) {
  const m = /^(.*)\+([1-5])$/.exec(String(nome ?? ''));
  return m ? { base: m[1], n: Number(m[2]) } : { base: String(nome ?? ''), n: 0 };
}

/**
 * Gera a textura de armadura (canvas 64x32, layout do Minecraft: cabeça,
 * corpo, braço e perna) a partir de uma cor base e de um estilo.
 */
export function gerarTexturaArmadura(corBase, estilo = 'metal', corVeio = '#ff4a6a') {
  const canvas = criarCanvas(64, 32);
  const ctx = canvas.getContext('2d');
  const rnd = mulberry32(4242);
  const base = hexRGB(corBase);
  const veio = hexRGB(corVeio);
  // estilos: 'couro', 'metal', 'brilhante' (prata), 'faceta' (diamante), 'veios' (dracônio), 'escamas'
  const metal = estilo !== 'couro';
  const escamas = estilo === 'escamas';
  const px = (reg, i, j, c) => { ctx.fillStyle = rgbCss(c); ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1); };
  const limpar = (reg, i, j, w, h) => ctx.clearRect(reg[0] + i, reg[1] + j, w, h);

  // Uma "placa" (face): ruído, bordas em relevo, rebites ou costuras
  const placa = (reg, frente) => {
    const w = reg[2], h = reg[3];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let d = (rnd() - 0.5) * (metal ? 10 : 24);
        const borda = i === 0 || j === 0 || i === w - 1 || j === h - 1;
        if (escamas) {
          // escamas: fileiras de "meias-luas"; a borda de baixo de cada escama é escura
          const col = (i + ((j >> 1) & 1) * 2) % 4;
          d = (rnd() - 0.5) * 14;
          if (j % 2 === 1) d -= 34;            // linha de baixo da escama (sombra)
          else if (col === 0) d -= 20;          // junta entre escamas
          else if (col === 1) d += 22;          // brilho no alto da escama
        } else if (metal) {
          if (j === 0) d += 24; else if (i === 0) d += 14;
          if (j === h - 1) d -= 30; else if (i === w - 1) d -= 20;
          if (frente && i - j === 1) d += 12;           // brilho em diagonal
        } else if (borda) {
          d -= 34;                                       // contorno escuro do couro
        } else if (w >= 6 && h >= 6 && (i === 1 || j === 1 || i === w - 2 || j === h - 2) && (i + j) % 2 === 0) {
          d += 40;                                       // costura tracejada
        }
        let cor = clarear(base, d);
        if (estilo === 'brilhante') {
          cor = clarear(cor, 14);
          if ((i - j + 24) % 6 === 0) cor = clarear(cor, 40);      // listras de reflexo
        } else if (estilo === 'faceta') {
          cor = clarear(cor, [18, -4, -22][((i >> 1) + (j >> 1)) % 3]); // facetas de gema
          if ((i * 7 + j * 3) % 11 === 0) cor = [235, 255, 255];        // brilhinhos
        } else if (estilo === 'veios') {
          if ((i * 3 + j * 5 + (j >> 1) * 2) % 13 === 0 && !borda) cor = clarear(veio, (rnd() - 0.5) * 30); // veios brilhantes
        }
        px(reg, i, j, cor);
      }
    }
    if (metal && !escamas && w >= 4 && h >= 4) {                     // rebites nos cantos
      [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]].forEach(([i, j]) => px(reg, i, j, clarear(base, 52)));
    }
  };
  const zona = (r) => [r.direita, r.frente, r.esquerda, r.tras, r.topo, r.baixo].forEach((reg) => placa(reg, reg === r.frente));

  // CABEÇA: capacete com abertura no rosto
  const cab = regioes(0, 0, 8, 8, 8);
  zona(cab);
  limpar(cab.frente, 1, 3, 6, 5);                         // o rosto aparece
  if (metal) for (let j = 3; j <= 5; j++) { px(cab.frente, 3, j, clarear(base, -8)); px(cab.frente, 4, j, clarear(base, -18)); } // protetor de nariz
  limpar(cab.direita, 0, 5, 8, 3); limpar(cab.esquerda, 0, 5, 8, 3);
  limpar(cab.tras, 0, metal ? 6 : 5, 8, metal ? 2 : 3);
  limpar(cab.baixo, 0, 0, 8, 8);
  // faixa mais escura na testa
  for (let i = 0; i < 8; i++) px(cab.frente, i, 2, clarear(base, -22));

  // CORPO (peitoral e cintura)
  const corpo = regioes(16, 16, 8, 12, 4);
  zona(corpo);
  for (let j = 1; j < 9; j++) {
    if (metal) { px(corpo.frente, 3, j, clarear(base, -26)); px(corpo.frente, 4, j, clarear(base, 20)); }
    else if (j % 2 === 0) { px(corpo.frente, 3, j, clarear(base, 46)); px(corpo.frente, 4, j, clarear(base, 46)); } // laço
  }
  for (let i = 0; i < 8; i++) px(corpo.frente, i, 0, clarear(base, -24));          // gola
  for (let i = 0; i < 8; i++) { px(corpo.frente, i, 8, clarear(base, -30)); px(corpo.tras, i, 8, clarear(base, -30)); } // cinto
  px(corpo.frente, 3, 8, clarear(base, 60)); px(corpo.frente, 4, 8, clarear(base, 60));

  // BRAÇO
  const braco = regioes(40, 16, 4, 12, 4);
  zona(braco);
  [braco.direita, braco.frente, braco.esquerda, braco.tras].forEach((reg) => {
    for (let i = 0; i < 4; i++) {
      px(reg, i, 2, clarear(base, -22));                  // ombreira
      px(reg, i, 9, clarear(base, -26));                  // punho
    }
  });

  // PERNA
  const perna = regioes(0, 16, 4, 12, 4);
  zona(perna);
  [perna.direita, perna.frente, perna.esquerda, perna.tras].forEach((reg) => {
    for (let i = 0; i < 4; i++) {
      px(reg, i, 0, clarear(base, -24));                  // cós
      px(reg, i, 8, clarear(base, 26));                   // borda da bota
      px(reg, i, 11, clarear(base, -46));                 // sola
    }
    if (metal) { px(reg, 1, 5, clarear(base, 40)); px(reg, 2, 5, clarear(base, 40)); } // joelho
  });
  return canvas;
}

// ---------------------------------------------------------------------
// Brilho pulsante (melhorias +N): materiais registrados aqui têm o brilho
// (emissiveIntensity) ou a opacidade recalculados algumas vezes por segundo.
// ---------------------------------------------------------------------
const pulsos = [];            // { mat, prop, base, vel, amp }
let ultimoPulso = 0;
function registrarPulso(mat, prop, base, vel = 2.5, amp = 0.25) {
  pulsos.push({ mat, prop, base, vel, amp });
}
function atualizarPulsos() {
  const agora = performance.now();
  if (agora - ultimoPulso < 16) return; // uma vez por quadro, mesmo com vários bonecos
  ultimoPulso = agora;
  const t = agora / 1000;
  for (let i = 0; i < pulsos.length; i++) {
    const p = pulsos[i];
    p.mat[p.prop] = p.base * (1 - p.amp + p.amp * (0.5 + 0.5 * Math.sin(t * p.vel + i)));
  }
}

// Material "aura" do +5: contorno brilhante (faces de trás de uma caixa maior)
const cacheAura = new Map();
function materialAura(cor) {
  let m = cacheAura.get(cor);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: cor, side: THREE.BackSide, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    registrarPulso(m, 'opacity', 0.55, 3, 0.4);
    cacheAura.set(cor, m);
  }
  return m;
}

// Materiais claros (prata, diamante, ferro) já são quase brancos: o brilho da
// melhoria os estourava. Este fator reduz a intensidade conforme a luminância
// da cor (1 = cor escura, sem mudança; até 0.4 para o branco).
const cacheFatorBrilho = new Map();
function fatorBrilho(cor) {
  let f = cacheFatorBrilho.get(cor);
  if (f === undefined) {
    const c = new THREE.Color(cor).getHex();
    const lum = (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
    f = 1 - 0.6 * lum;
    cacheFatorBrilho.set(cor, f);
  }
  return f;
}

// Materiais Three.js por material de armadura (compartilhados entre os bonecos).
// O nome pode ter sufixo: 'ferro+2' = ferro com melhoria 2 (brilho 0.15 x N).
const materiaisArmadura = new Map();
function materialDaArmadura(nome) {
  let m = materiaisArmadura.get(nome);
  if (!m) {
    const { base, n } = separarMelhoria(nome);
    const def = MATERIAIS_ARMADURA[base];
    if (n === 0) {
      const tex = new THREE.CanvasTexture(gerarTexturaArmadura(def.cor, def.estilo, def.veio));
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    } else {
      m = materialDaArmadura(base).clone(); // mesma textura, com brilho próprio
      const intensidade = 0.15 * n * fatorBrilho(def.cor); // menos brilho em metais claros
      m.emissive = new THREE.Color(def.brilho ?? def.cor);
      m.emissiveIntensity = intensidade;
      registrarPulso(m, 'emissiveIntensity', intensidade);
    }
    materiaisArmadura.set(nome, m);
  }
  return m;
}

// Materiais da Fase 9
registrarMaterialArmadura('cobre', { rotulo: 'Cobre', cor: '#c8693a', estilo: 'metal' });
registrarMaterialArmadura('prata', { rotulo: 'Prata', cor: '#b9c6da', estilo: 'brilhante' });
registrarMaterialArmadura('ouro', { rotulo: 'Ouro', cor: '#f0c430', estilo: 'metal' });
registrarMaterialArmadura('diamante', { rotulo: 'Diamante', cor: '#4fe3e6', estilo: 'faceta' });
registrarMaterialArmadura('draconio', { rotulo: 'Dracônio', cor: '#4a1a3a', estilo: 'veios', veio: '#ff4a6a', brilho: '#ff3a6a' });
registrarMaterialArmadura('escama_dragao', { rotulo: 'Escama de dragão', cor: '#8c1a1a', estilo: 'escamas', brilho: '#ff4a2a' });
registrarMaterialArmadura('escama_hidra', { rotulo: 'Escama de hidra', cor: '#2a8f86', estilo: 'escamas', brilho: '#40ffe0' });
// Dragões elementais
registrarMaterialArmadura('escama_dragao_gelo', { rotulo: 'Escama de dragão de gelo', cor: '#7fc4e4', estilo: 'escamas', brilho: '#c8f6ff' });
registrarMaterialArmadura('escama_dragao_veneno', { rotulo: 'Escama de dragão venenoso', cor: '#3f8a26', estilo: 'escamas', brilho: '#8aff3a' });
registrarMaterialArmadura('escama_dragao_raio', { rotulo: 'Escama de dragão de raio', cor: '#d8b42a', estilo: 'escamas', brilho: '#fff6a0' });

// ---------------------------------------------------------------------
// Geometrias e materiais compartilhados (cache)
// ---------------------------------------------------------------------
const cacheGeo = new Map();
/** Caixa de w x h x d PIXELS com UVs de uma caixa do layout (cacheada pela chave) */
function geoCaixa(chave, w, h, d, caixaUV, opc) {
  let g = cacheGeo.get(chave);
  if (!g) {
    g = new THREE.BoxGeometry(w * ESCALA, h * ESCALA, d * ESCALA);
    mapearUV(g, caixaUV, opc);
    cacheGeo.set(chave, g);
  }
  return g;
}

const GEO_CUBO = new THREE.BoxGeometry(1, 1, 1);
const cacheMat = new Map();
function materialCor(cor, extra) {
  const chave = cor + (extra ? JSON.stringify(extra) : '');
  let m = cacheMat.get(chave);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: cor, ...(extra || {}) });
    cacheMat.set(chave, m);
  }
  return m;
}

/** Caixa colorida (medidas e posição em pixels de skin) presa a um grupo */
function caixa(pai, cor, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, extra) {
  const m = new THREE.Mesh(GEO_CUBO, materialCor(cor, extra));
  m.scale.set(w * ESCALA, h * ESCALA, d * ESCALA);
  m.position.set(x * ESCALA, y * ESCALA, z * ESCALA);
  m.rotation.set(rx, ry, rz);
  pai.add(m);
  return m;
}

function limparGrupo(g) {
  while (g.children.length) g.remove(g.children[g.children.length - 1]);
}

// Textura da capa (8x16 px) por cor, compartilhada
const cacheCapa = new Map();
const CORES_CAPA = {
  capa_vermelha: { cor: '#c4262e', borda: '#e6c13a' },
  capa_azul: { cor: '#2457c4', borda: '#e6c13a' },
};
function materialDaCapa(visual) {
  let m = cacheCapa.get(visual);
  if (!m) {
    const def = CORES_CAPA[visual];
    const c = criarCanvas(8, 16);
    const ctx = c.getContext('2d');
    const base = hexRGB(def.cor);
    const rnd = mulberry32(555);
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 8; i++) {
        let d = (rnd() - 0.5) * 12 + (i % 2 === 0 ? 6 : -6) - j * 1.2; // dobras verticais e escurece embaixo
        if (i === 0 || i === 7 || j === 15) d = 0;
        ctx.fillStyle = (i === 0 || i === 7 || j === 15) ? def.borda : rgbCss(clarear(base, d));
        ctx.fillRect(i, j, 1, 1);
      }
    }
    ctx.fillStyle = '#fff2a0'; ctx.fillRect(0, 0, 1, 1); ctx.fillRect(7, 0, 1, 1); // fechos nos ombros
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    cacheCapa.set(visual, m);
  }
  return m;
}
// Metade de cima / de baixo da capa (cada uma usa metade da textura)
const geosCapa = [];
function geoCapa(metade) {
  if (!geosCapa[metade]) {
    const g = new THREE.BoxGeometry(8 * ESCALA, 7 * ESCALA, 0.6 * ESCALA);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * 0.5 + (metade === 0 ? 0.5 : 0));
    geosCapa[metade] = g;
  }
  return geosCapa[metade];
}

// ---------------------------------------------------------------------
// ESPADAS (Fase 9): uma por material. O modelo é o da espada de madeira, só
// muda a cor. lamina/fio/sombra = tons da lâmina; emissive = brilho próprio.
// ---------------------------------------------------------------------
const CABO = { pomo: '#2a1c10', cabo: '#3a2a1c' };
export const VISUAIS_ARMA = {
  espada_madeira: { rotulo: 'Espada de madeira', pomo: '#4a2e16', cabo: '#5a3a1e', guarda: '#7a5230', lamina: '#c8a064', fio: '#e6cc94', sombra: '#a07a46' },
  espada_cobre: { rotulo: 'Espada de cobre', ...CABO, guarda: '#8a4a26', lamina: '#d27a45', fio: '#f0a070', sombra: '#a85a30' },
  espada_ferro: { rotulo: 'Espada de ferro', ...CABO, guarda: '#5a5e66', lamina: '#cfd3da', fio: '#f2f4f8', sombra: '#9ea3ad' },
  espada_prata: { rotulo: 'Espada de prata', ...CABO, guarda: '#7a8498', lamina: '#cfdcf0', fio: '#ffffff', sombra: '#a4b2cc', reflexo: '#e8f2ff' },
  espada_ouro: { rotulo: 'Espada de ouro', ...CABO, guarda: '#b8901e', lamina: '#f4cc3a', fio: '#fff0a0', sombra: '#c49a20' },
  espada_diamante: { rotulo: 'Espada de diamante', ...CABO, guarda: '#2a9ea0', lamina: '#58e8ea', fio: '#c8ffff', sombra: '#2fb8bc' },
  espada_draconio: { rotulo: 'Espada de dracônio', ...CABO, guarda: '#2a1030', lamina: '#6a2a9a', fio: '#ff3040', sombra: '#b01828' },
  espada_dragao: { rotulo: 'Espada de dragão', ...CABO, guarda: '#5a1010', lamina: '#c42020', fio: '#ff7a1a', sombra: '#8a1010', emissive: { cor: '#ff7a1a', int: 0.55, vel: 5, amp: 0.4 } },
  espada_hidra: { rotulo: 'Espada de hidra', ...CABO, guarda: '#14504a', lamina: '#2fa59a', fio: '#7af0e0', sombra: '#1f7a72', reflexo: '#c8fff4' },
  // Espadas dos dragões elementais
  espada_gelo: { rotulo: 'Espada de gelo', ...CABO, guarda: '#3a6a8a', lamina: '#9fe0fa', fio: '#effcff', sombra: '#5fa8d0', reflexo: '#ffffff', emissive: { cor: '#8fe8ff', int: 0.35, vel: 2, amp: 0.3 } },
  espada_veneno: { rotulo: 'Espada venenosa', ...CABO, guarda: '#2a5a1a', lamina: '#5fc83a', fio: '#c8ff7a', sombra: '#3a8a22', emissive: { cor: '#7aff3a', int: 0.3, vel: 3, amp: 0.3 } },
  espada_raio: { rotulo: 'Espada de raio', ...CABO, guarda: '#3a3f6a', lamina: '#f0d440', fio: '#ffffff', sombra: '#c09c20', emissive: { cor: '#fff27a', int: 0.5, vel: 9, amp: 0.5 } },
};

// Material de uma peça da lâmina: Lambert na cor, com brilho pulsante se a
// espada tem brilho próprio (dragão) e/ou melhoria (0.15 x N). Em cache.
const cacheLamina = new Map();
function materialLamina(cor, v, n) {
  const baseBrilho = (v.emissive ? v.emissive.int : 0) + 0.15 * n * fatorBrilho(cor);
  if (baseBrilho <= 0) return materialCor(cor);
  const corBrilho = v.emissive?.cor ?? cor;
  const chave = cor + '|' + corBrilho + '|' + baseBrilho;
  let m = cacheLamina.get(chave);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: cor, emissive: corBrilho, emissiveIntensity: baseBrilho });
    registrarPulso(m, 'emissiveIntensity', baseBrilho, v.emissive?.vel ?? 2.5, v.emissive?.amp ?? 0.25);
    cacheLamina.set(chave, m);
  }
  return m;
}

// ---------------------------------------------------------------------
// Classe Personagem
// ---------------------------------------------------------------------
const PARTES_ARMADURA = ['capacete', 'peitoral', 'calca', 'botas'];

export class Personagem {
  constructor(cores = {}) {
    this.cores = { ...CORES_PADRAO, ...cores };
    this._roupa = null;
    this._armadura = { capacete: null, peitoral: null, calca: null, botas: null };
    this._mao = null;
    this._acessorio = null;
    this._armaduraMalhas = { capacete: [], peitoral: [], calca: [], botas: [] };
    this._capa = null;
    this._caudas = null;
    this._velCapa = 0;

    // Skin 64x64 (base + roupa) e mapa de brilho (só os pixels neon)
    this.skinCanvas = criarCanvas(64, 64);
    this.neonCanvas = criarCanvas(64, 64);
    desenharSkin(this.skinCanvas, this.cores);

    const novaTextura = (canvas) => {
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    this.textura = novaTextura(this.skinCanvas);
    this.neonTextura = novaTextura(this.neonCanvas);

    // Material da skin base (o brilho só liga na roupa hacker)
    this.material = new THREE.MeshLambertMaterial({
      map: this.textura, transparent: false,
      emissive: 0x000000, emissiveMap: this.neonTextura,
    });
    // Material da 2ª camada: recorta os pixels transparentes
    this.materialCamada2 = new THREE.MeshLambertMaterial({
      map: this.textura, alphaTest: 0.5,
      emissive: 0x000000, emissiveMap: this.neonTextura,
    });

    this.geometrias = [];
    this.grupo = new THREE.Group();   // grupo de fora (posição e giro): quem usa o boneco mexe nele
    this.raiz = new THREE.Group();    // grupo de dentro (corpo todo): inclina ao nadar e planar
    this.grupo.add(this.raiz);

    // Cria uma parte (caixa) com as UVs da skin; o centro fica em (0, -altura/2) do pivô
    const criarParte = (caixa, deslocY) => {
      const geo = new THREE.BoxGeometry(caixa.w * ESCALA, caixa.h * ESCALA, caixa.d * ESCALA);
      mapearUV(geo, caixa);
      this.geometrias.push(geo);
      const malha = new THREE.Mesh(geo, this.material);
      malha.position.y = deslocY * ESCALA;
      return malha;
    };
    // Parte da 2ª camada (um pouco maior que a base). w,h,d e cy em pixels.
    const criarCamada2 = (chave, caixaUV, w, h, d, cy) => {
      const malha = new THREE.Mesh(geoCaixa('c2_' + chave, w, h, d, caixaUV), this.materialCamada2);
      malha.position.y = cy * ESCALA;
      malha.visible = false;
      this.camada2.push(malha);
      return malha;
    };
    this.camada2 = [];

    // Corpo (fixo): de 12 a 24 px de altura
    this.corpo = criarParte(CAIXAS.corpo, 18);
    this.raiz.add(this.corpo);
    this.raiz.add(criarCamada2('corpo', CAIXAS_2.corpo, 9, 13, 5, 18));

    // Cabeça: pivô no pescoço (24 px)
    this.pivoCabeca = new THREE.Group();
    this.pivoCabeca.position.set(0, 24 * ESCALA, 0);
    this.pivoCabeca.add(criarParte(CAIXAS.cabeca, 4));
    this.pivoCabeca.add(criarCamada2('cabeca', CAIXAS_2.cabeca, 9, 9, 9, 4));
    this.raiz.add(this.pivoCabeca);

    // Braços: pivôs nos ombros (24 px). O braço direito fica em +X.
    this.pivoBracoD = new THREE.Group();
    this.pivoBracoD.position.set(6 * ESCALA, 24 * ESCALA, 0);
    this.pivoBracoD.add(criarParte(CAIXAS.bracoD, -6));
    this.pivoBracoD.add(criarCamada2('bracoD', CAIXAS_2.bracoD, 5, 13, 5, -5.7));
    this.pivoBracoE = new THREE.Group();
    this.pivoBracoE.position.set(-6 * ESCALA, 24 * ESCALA, 0);
    this.pivoBracoE.add(criarParte(CAIXAS.bracoE, -6));
    this.pivoBracoE.add(criarCamada2('bracoE', CAIXAS_2.bracoE, 5, 13, 5, -5.7));
    this.raiz.add(this.pivoBracoD, this.pivoBracoE);

    // Pernas: pivôs no quadril (12 px)
    this.pivoPernaD = new THREE.Group();
    this.pivoPernaD.position.set(2 * ESCALA, 12 * ESCALA, 0);
    this.pivoPernaD.add(criarParte(CAIXAS.pernaD, -6));
    this.pivoPernaD.add(criarCamada2('pernaD', CAIXAS_2.pernaD, 5, 12.7, 5, -5.85));
    this.pivoPernaE = new THREE.Group();
    this.pivoPernaE.position.set(-2 * ESCALA, 12 * ESCALA, 0);
    this.pivoPernaE.add(criarParte(CAIXAS.pernaE, -6));
    this.pivoPernaE.add(criarCamada2('pernaE', CAIXAS_2.pernaE, 5, 12.7, 5, -5.85));
    this.raiz.add(this.pivoPernaD, this.pivoPernaE);

    // Grupos fixos onde ficam as peças extras (esvaziados e refeitos quando muda)
    this.grupoChapeu = new THREE.Group();   // em cima da cabeça (gira com ela)
    this.pivoCabeca.add(this.grupoChapeu);
    this.grupoCostas = new THREE.Group();   // nas costas (mochila), coordenadas a partir dos pés
    this.raiz.add(this.grupoCostas);
    this.grupoMao = new THREE.Group();      // na mão direita
    this.grupoMao.position.set(0, -10.5 * ESCALA, 0);
    this.pivoBracoD.add(this.grupoMao);

    // Estado da animação
    this._fase = 0;       // avança com a distância percorrida
    this._amplitude = 0;  // amplitude atual do balanço (suavizada)
    this._tempo = 0;      // para a respiração
    this._abertura = 0;   // quanto as pernas estão abertas (no ar)
    this._golpe = -1;     // tempo do golpe em andamento (-1 = sem golpe)
    this.contGolpes = 0;  // conta os golpes (a mãozinha da 1ª pessoa usa para saber quando bater)

    // Poses especiais: quem usa o boneco liga estas duas chaves antes de chamar animar()
    this.planando = false;  // capa aberta, planando
    this.nadando = false;   // deitado na água
    this._pPlan = 0;        // 0..1 suavizado (quanto já está na pose de planar)
    this._pNado = 0;        // 0..1 suavizado (quanto já está deitado nadando)
    this._faseNado = 0;     // avança batendo os braços (crawl)
    this._inclina = 0;      // inclinação do corpo para frente (radianos, positivo = deitado)
  }

  // ------------------------------------------------------------------
  // Aparência
  // ------------------------------------------------------------------

  /**
   * Muda o visual. Tudo é opcional: o que não vier fica como está.
   * { cores, roupa: 'ninja'|...|null, armadura: { capacete, peitoral, calca, botas } (materiais ou null),
   *   mao: 'espada_madeira'|null, acessorio: 'capa_vermelha'|'capa_azul'|null }
   */
  definirAparencia(ap = {}) {
    let refazerSkin = false;

    if (ap.cores !== undefined && ap.cores !== null) {
      const novas = { ...this.cores, ...ap.cores };
      if (JSON.stringify(novas) !== JSON.stringify(this.cores)) { this.cores = novas; refazerSkin = true; }
    }
    if (ap.roupa !== undefined) {
      const r = ap.roupa && VISUAIS_ROUPA[ap.roupa] ? ap.roupa : null;
      if (r !== this._roupa) { this._roupa = r; refazerSkin = true; this._montarExtrasRoupa(); }
    }
    if (ap.armadura !== undefined) {
      for (const parte of PARTES_ARMADURA) {
        // aceita 'ferro' ou 'ferro+2' (material + melhoria)
        const nome = ap.armadura && MATERIAIS_ARMADURA[separarMelhoria(ap.armadura[parte]).base] ? ap.armadura[parte] : null;
        if (nome !== this._armadura[parte]) { this._armadura[parte] = nome; this._montarArmadura(parte); }
      }
    }
    if (ap.mao !== undefined) {
      // aceita 'espada_ferro+2' (espada + melhoria)
      const m = ap.mao && VISUAIS_ARMA[separarMelhoria(ap.mao).base] ? ap.mao : null;
      if (m !== this._mao) { this._mao = m; this._montarMao(); }
    }
    if (ap.acessorio !== undefined) {
      const a = ap.acessorio && CORES_CAPA[ap.acessorio] ? ap.acessorio : null;
      if (a !== this._acessorio) { this._acessorio = a; this._montarCapa(); }
    }
    if (refazerSkin) this._redesenharSkin();
    this._ajustarEncaixes();
  }

  /** Cópia da aparência atual (mesmo formato aceito por definirAparencia) */
  get aparenciaAtual() {
    return {
      cores: { ...this.cores },
      roupa: this._roupa,
      armadura: { ...this._armadura },
      mao: this._mao,
      acessorio: this._acessorio,
    };
  }

  // Redesenha a skin base e cola a roupa por cima
  _redesenharSkin() {
    desenharSkin(this.skinCanvas, this.cores);
    const nctx = this.neonCanvas.getContext('2d');
    nctx.clearRect(0, 0, 64, 64);
    let brilha = false;
    if (this._roupa) {
      const camada = camadaDaRoupa(this._roupa);
      this.skinCanvas.getContext('2d').drawImage(camada.canvas, 0, 0);
      if (camada.temNeon) { nctx.drawImage(camada.neonCanvas, 0, 0); brilha = true; }
    }
    const cor = brilha ? 0xffffff : 0x000000;
    this.material.emissive.setHex(cor);
    this.materialCamada2.emissive.setHex(cor);
    this.camada2.forEach((m) => { m.visible = !!this._roupa; });
    this.textura.needsUpdate = true;
    this.neonTextura.needsUpdate = true;
  }

  // Peças 3D da roupa (chapéus, faixa, mochila, capacete de vidro)
  _montarExtrasRoupa() {
    limparGrupo(this.grupoChapeu);
    limparGrupo(this.grupoCostas);
    this._caudas = null;
    const ch = this.grupoChapeu;
    const co = this.grupoCostas;
    // Na cabeça: pivô no pescoço, y de 0 a 8, frente em -Z, trás em +Z
    switch (this._roupa) {
      case 'ninja': {
        caixa(ch, '#c8202a', 2.2, 2.2, 1.2, 0, 6, 4.9);                                // nó da faixa
        const a = caixa(ch, '#c8202a', 1.4, 1.4, 4.5, -0.9, 6, 7, 0.25, 0.25, 0);       // pontas soltas
        const b = caixa(ch, '#a31a22', 1.4, 1.4, 4, 0.9, 5.8, 6.7, 0.55, -0.3, 0);
        a.userData.base = 0.25; b.userData.base = 0.55;
        this._caudas = [a, b];
        break;
      }
      case 'mago': {
        caixa(ch, '#4a2580', 12, 1, 12, 0, 8.5, 0);                                   // aba
        caixa(ch, '#e0b43a', 8.4, 1, 8.4, 0, 9.5, 0);                                 // fita dourada
        caixa(ch, '#5a2e91', 8, 3, 8, 0, 11, 0);                                      // cone em degraus
        caixa(ch, '#5a2e91', 6, 3, 6, 0, 14, 0);
        caixa(ch, '#4a2580', 4, 3, 4, 0, 17, 0.2, 0.12);
        caixa(ch, '#5a2e91', 2.2, 3, 2.2, 0.2, 20, 0.6, 0.25, 0, -0.25);              // ponta torta
        caixa(ch, '#ffe45a', 2.6, 0.8, 0.4, 0, 11.2, -4.2);                           // estrela na frente
        caixa(ch, '#ffe45a', 0.8, 2.6, 0.4, 0, 11.2, -4.2);
        break;
      }
      case 'pirata': {
        caixa(ch, '#0e0e12', 10, 1, 9, 0, 8.5, 0);                                    // base do chapéu
        caixa(ch, '#1c1c24', 9, 3.5, 8, 0, 10.5, 0);                                  // copa
        caixa(ch, '#14141a', 1.6, 4, 9.5, -5, 10.6, 0, 0, 0, 0.35);                   // abas viradas
        caixa(ch, '#14141a', 1.6, 4, 9.5, 5, 10.6, 0, 0, 0, -0.35);
        caixa(ch, '#d8d8d8', 4.6, 0.6, 0.3, 0, 9.2, -4.3, 0, 0, 0.5);                 // ossos cruzados
        caixa(ch, '#d8d8d8', 4.6, 0.6, 0.3, 0, 9.2, -4.3, 0, 0, -0.5);
        caixa(ch, '#f0f0ee', 3.2, 2.6, 0.4, 0, 10.8, -4.25);                          // caveira
        caixa(ch, '#101014', 0.8, 0.9, 0.2, -0.8, 11.1, -4.5);
        caixa(ch, '#101014', 0.8, 0.9, 0.2, 0.8, 11.1, -4.5);
        caixa(ch, '#101014', 0.4, 0.5, 0.2, 0, 10.2, -4.5);
        break;
      }
      case 'astronauta': {
        caixa(ch, '#dfe4ea', 9.6, 1.4, 9.6, 0, -0.4, 0);                              // anel no pescoço
        caixa(ch, '#9fd8ff', 10.8, 10.8, 10.8, 0, 4, 0, 0, 0, 0, { transparent: true, opacity: 0.27, depthWrite: false });
        caixa(ch, '#ffffff', 0.6, 3, 0.1, -3.2, 6.6, -5.45, 0, 0, 0, { transparent: true, opacity: 0.5, depthWrite: false });
        // mochila nas costas (coordenadas a partir dos pés)
        caixa(co, '#d0d6de', 7, 9, 3.5, 0, 18.5, 3.75);
        caixa(co, '#9aa3ad', 7.4, 1, 3.9, 0, 23, 3.75);
        caixa(co, '#f08a24', 1.6, 5, 1.6, -2, 13.5, 3.75);
        caixa(co, '#f08a24', 1.6, 5, 1.6, 2, 13.5, 3.75);
        caixa(co, '#40d060', 1, 1, 0.3, -1.5, 20, 5.65);
        caixa(co, '#7a828c', 0.5, 2.5, 0.5, 3, 25.5, 3.6);
        break;
      }
      default: break;
    }
  }

  // Armadura: remove as malhas antigas da parte e cria as novas
  _montarArmadura(parte) {
    this._armaduraMalhas[parte].forEach((m) => m.parent && m.parent.remove(m));
    this._armaduraMalhas[parte] = [];
    const nome = this._armadura[parte];
    if (!nome) return;
    const mat = materialDaArmadura(nome);
    const { base: matBase, n } = separarMelhoria(nome);
    const def = MATERIAIS_ARMADURA[matBase];
    const lista = this._armaduraMalhas[parte];
    const novaMalha = (chave, w, h, d, caixaUV, opc, pai, y) => {
      const m = new THREE.Mesh(geoCaixa('arm_' + chave, w, h, d, caixaUV, { tw: 64, th: 32, ...opc }), mat);
      m.position.y = y * ESCALA;
      pai.add(m);
      lista.push(m);
      if (n >= 5) { // +5: contorno brilhante um pouco maior
        const aura = new THREE.Mesh(m.geometry, materialAura(def.brilho ?? def.cor));
        aura.position.copy(m.position);
        aura.scale.setScalar(1.14);
        pai.add(aura);
        lista.push(aura);
      }
    };
    switch (parte) {
      case 'capacete':
        novaMalha('capacete', 10, 10, 10, CAIXAS_ARM.cabeca, {}, this.pivoCabeca, 4);
        break;
      case 'peitoral':
        novaMalha('peito', 10, 14, 6, CAIXAS_ARM.corpo, {}, this.raiz, 18);
        novaMalha('braco', 6, 13.5, 6, CAIXAS_ARM.braco, {}, this.pivoBracoD, -5.65);
        novaMalha('braco', 6, 13.5, 6, CAIXAS_ARM.braco, {}, this.pivoBracoE, -5.65);
        break;
      case 'calca':
        novaMalha('cintura', 9.5, 5.5, 5.5, CAIXAS_ARM.corpo, { deLinha: 8, nLinhas: 4 }, this.raiz, 14);
        novaMalha('perna', 5.5, 13, 5.5, CAIXAS_ARM.perna, {}, this.pivoPernaD, -5.75);
        novaMalha('perna', 5.5, 13, 5.5, CAIXAS_ARM.perna, {}, this.pivoPernaE, -5.75);
        break;
      case 'botas':
        novaMalha('bota', 6, 5.4, 6, CAIXAS_ARM.perna, { deLinha: 8, nLinhas: 4 }, this.pivoPernaD, -9.7);
        novaMalha('bota', 6, 5.4, 6, CAIXAS_ARM.perna, { deLinha: 8, nLinhas: 4 }, this.pivoPernaE, -9.7);
        break;
      default: break;
    }
  }

  // Item da mão direita: espada pixelada, na cor do material (+ brilho da melhoria)
  _montarMao() {
    limparGrupo(this.grupoMao);
    if (!this._mao) return;
    this.grupoMao.add(this.criarEspada(this._mao));
  }

  /** Monta uma espada nova (grupo) para o item `mao`. Também usada pela mãozinha da 1ª pessoa. */
  criarEspada(mao) {
    const { base, n } = separarMelhoria(mao);
    const v = VISUAIS_ARMA[base];
    // A espada é feita apontando para +Y e depois deitada para a frente (-Z)
    const e = new THREE.Group();
    const peca = (mat, w, h, d, x, y, z) => {
      const m = new THREE.Mesh(GEO_CUBO, mat);
      m.scale.set(w * ESCALA, h * ESCALA, d * ESCALA);
      m.position.set(x * ESCALA, y * ESCALA, z * ESCALA);
      e.add(m);
      if (n >= 5) { // +5: contorno brilhante (caixa 1.2 px maior)
        const a = new THREE.Mesh(GEO_CUBO, materialAura(v.emissive?.cor ?? v.lamina));
        a.scale.set((w + 1.2) * ESCALA, (h + 1.2) * ESCALA, (d + 1.2) * ESCALA);
        a.position.copy(m.position);
        e.add(a);
      }
    };
    const fixo = (cor) => materialCor(cor);
    const lam = (cor) => materialLamina(cor, v, n);
    peca(fixo(v.pomo), 1.8, 1.2, 1.8, 0, -1.2, 0);       // pomo
    peca(fixo(v.cabo), 1.2, 3.6, 1.2, 0, 0.8, 0);        // cabo
    peca(fixo(v.guarda), 1.8, 1, 5, 0, 3, 0);            // guarda
    peca(lam(v.lamina), 1, 9.5, 2.4, 0, 8.3, 0);         // lâmina (chata: de lado aparece larga)
    peca(lam(v.fio), 1.1, 9, 0.8, 0, 8.3, 0.8);          // brilho do fio
    peca(lam(v.sombra), 1.1, 9, 0.8, 0, 8.3, -0.8);      // sombra do outro fio
    peca(lam(v.lamina), 1, 1.2, 1.4, 0, 13.6, 0);        // ponta
    if (v.reflexo) peca(lam(v.reflexo), 1.15, 5, 0.5, 0, 9, 0.2); // reflexo (hidra)
    e.rotation.x = -Math.PI / 2 + 0.3;
    return e;
  }

  // Capa: duas metades articuladas que balançam
  _montarCapa() {
    if (this._capa) {
      this.raiz.remove(this._capa.pivo);
      this._capa = null;
    }
    if (!this._acessorio) return;
    const mat = materialDaCapa(this._acessorio);
    const pivo = new THREE.Group();
    pivo.position.y = 24 * ESCALA;
    const sup = new THREE.Mesh(geoCapa(0), mat);
    sup.position.y = -3.5 * ESCALA;
    const pivoInf = new THREE.Group();
    pivoInf.position.y = -7 * ESCALA;
    const inf = new THREE.Mesh(geoCapa(1), mat);
    inf.position.y = -3.5 * ESCALA;
    pivoInf.add(inf);
    pivo.add(sup, pivoInf);
    this.raiz.add(pivo);
    this._capa = { pivo, pivoInf, inf, sup };
  }

  // Afasta chapéu, mochila e capa quando há armadura por baixo
  _ajustarEncaixes() {
    const cap = !!this._armadura.capacete;
    const pei = !!this._armadura.peitoral;
    const cal = !!this._armadura.calca;
    this.grupoChapeu.position.y = cap ? ESCALA : 0;
    this.grupoChapeu.scale.set(cap ? 1.12 : 1, 1, cap ? 1.12 : 1);
    this.grupoCostas.position.z = pei ? ESCALA : 0;
    if (this._capa) {
      const costas = pei ? 3 : cal ? 2.75 : this._roupa ? 2.5 : 2;
      const mochila = this._roupa === 'astronauta' ? 3.8 : 0;
      this._capa.pivo.position.z = (costas + 0.7 + mochila) * ESCALA;
    }
  }

  /** Muda as cores da skin base (mantém roupa, armadura e o resto) */
  definirCores(cores) {
    this.definirAparencia({ cores });
  }

  // ------------------------------------------------------------------
  // Animação
  // ------------------------------------------------------------------

  /** Balanço rápido do braço direito para a frente e de volta (~0.25 s) */
  animarGolpe() {
    this._golpe = 0;
    this.contGolpes++;
  }

  /**
   * Anima braços e pernas.
   * velHorizontal: velocidade horizontal em blocos/s; noAr: true se estiver pulando/caindo.
   */
  animar(dt, velHorizontal, noAr) {
    this._tempo += dt;
    atualizarPulsos(); // brilho das melhorias +N
    const vel = Math.max(0, velHorizontal);

    // O balanço acompanha a distância percorrida (vel * dt)
    this._fase += vel * dt * 2.4;
    const alvo = Math.min(0.9, vel * 0.14); // amplitude proporcional à velocidade (máx. ~0.9 rad)
    this._amplitude += (alvo - this._amplitude) * Math.min(1, dt * 10);
    if (this._amplitude < 0.002 && alvo === 0) this._amplitude = 0;

    const balanco = Math.sin(this._fase) * this._amplitude;
    // Golpe: um arco (seno) que vai à frente e volta, somado ao balanço de andar
    let golpe = 0;
    if (this._golpe >= 0) {
      this._golpe += dt;
      if (this._golpe >= DURACAO_GOLPE) this._golpe = -1;
      else golpe = Math.sin((this._golpe / DURACAO_GOLPE) * Math.PI) * 1.6;
    }
    this.pivoBracoD.rotation.x = balanco + golpe;
    this.pivoBracoE.rotation.x = -balanco;
    this.pivoPernaD.rotation.x = -balanco;
    this.pivoPernaE.rotation.x = balanco;

    // Respiração leve nos braços (some quando está andando)
    const parado = 1 - Math.min(1, this._amplitude / 0.3);
    const resp = (0.05 + Math.sin(this._tempo * 1.8) * 0.03) * parado;
    this.pivoBracoD.rotation.z = resp;
    this.pivoBracoE.rotation.z = -resp;

    // No ar, as pernas ficam um pouco abertas
    const alvoAbertura = noAr ? 0.22 : 0;
    this._abertura += (alvoAbertura - this._abertura) * Math.min(1, dt * 12);
    this.pivoPernaD.rotation.z = this._abertura;
    this.pivoPernaE.rotation.z = -this._abertura;

    // Capa e pontas da faixa do ninja: balançam mais com a velocidade
    this._velCapa += (vel - this._velCapa) * Math.min(1, dt * 6);
    const v = Math.min(this._velCapa, 7);
    const agita = 0.4 + v * 0.3;
    if (this._capa) {
      const ar = this._abertura / 0.22; // 0 no chão, 1 no ar
      const ang = 0.06 + v * 0.07 + ar * 0.25;
      this._capa.pivo.rotation.x = -(ang + Math.sin(this._tempo * 3.2) * 0.03 * agita);
      this._capa.pivo.rotation.z = Math.sin(this._fase) * 0.03 * Math.min(1, v);
      this._capa.pivoInf.rotation.x = -(ang * 0.5 + 0.04 + Math.sin(this._tempo * 4.3 - 1) * 0.05 * agita);
      this._capa.inf.scale.x = 1 + Math.min(1, v / 5) * 0.2 + ar * 0.25; // abre ao correr/pular
    }
    if (this._caudas) {
      for (let k = 0; k < this._caudas.length; k++) {
        const c = this._caudas[k];
        c.rotation.x = c.userData.base * (1 - Math.min(0.6, v * 0.12)) + Math.sin(this._tempo * 5 + k * 2) * 0.1 * agita;
      }
    }

    this._aplicarPoses(dt, vel);
  }

  /**
   * Poses especiais por cima da animação normal: nadar deitado (crawl) e planar com a capa.
   * `this.nadando` e `this.planando` dizem qual pose é a desejada; aqui ela entra aos poucos.
   */
  _aplicarPoses(dt, vel) {
    const suave = Math.min(1, dt * 8);
    this._pNado += ((this.nadando ? 1 : 0) - this._pNado) * suave;
    this._pPlan += ((this.planando ? 1 : 0) - this._pPlan) * suave;
    if (this._pNado < 0.002) this._pNado = 0;
    if (this._pPlan < 0.002) this._pPlan = 0;
    const kN = this._pNado, kP = this._pPlan;

    // Inclinação do corpo todo para frente (em volta do centro do corpo, 0.9 de altura)
    const inclina = kN * POSE_NADO_ANGULO + kP * POSE_PLANAR_ANGULO;
    this._inclina = inclina;
    const raiz = this.raiz;
    if (inclina > 0) {
      raiz.rotation.x = -inclina;
      raiz.position.y = CENTRO_CORPO * (1 - Math.cos(inclina));
      raiz.position.z = CENTRO_CORPO * Math.sin(inclina);
    } else if (raiz.rotation.x !== 0) {
      raiz.rotation.x = 0; raiz.position.y = 0; raiz.position.z = 0;
    }

    // Nadar: braços giram alternados (crawl) e as pernas batem
    if (kN > 0) {
      this._faseNado += dt * (4 + Math.min(vel, 3) * 1.6);
      const fase = this._faseNado;
      const giro = (a) => { const m = a % DOIS_PI; return m > Math.PI ? m - DOIS_PI : m; };
      const bD = this.pivoBracoD.rotation.x, bE = this.pivoBracoE.rotation.x;
      this.pivoBracoD.rotation.x = bD + (giro(fase) - bD) * kN;
      this.pivoBracoE.rotation.x = bE + (giro(fase + Math.PI) - bE) * kN;
      const batida = Math.sin(fase * 3) * 0.45;
      const pD = this.pivoPernaD.rotation.x, pE = this.pivoPernaE.rotation.x;
      this.pivoPernaD.rotation.x = pD + (batida - pD) * kN;
      this.pivoPernaE.rotation.x = pE + (-batida - pE) * kN;
    }

    // Planar: braços abertos para os lados e capa bem aberta (estilo asa)
    if (kP > 0) {
      const abre = 1.25 * kP;
      this.pivoBracoD.rotation.x *= 1 - kP; this.pivoBracoE.rotation.x *= 1 - kP;
      this.pivoPernaD.rotation.x *= 1 - kP; this.pivoPernaE.rotation.x *= 1 - kP;
      this.pivoBracoD.rotation.z += abre;
      this.pivoBracoE.rotation.z -= abre;
      this.pivoPernaD.rotation.z = 0.08 * kP;
      this.pivoPernaE.rotation.z = -0.08 * kP;
    }
    if (this._capa) {
      const c = this._capa;
      if (kP > 0) {
        const tremor = Math.sin(this._tempo * 9) * 0.04 * kP;
        c.pivo.rotation.x = c.pivo.rotation.x * (1 - kP) + (-0.1 + tremor) * kP;
        c.pivoInf.rotation.x = c.pivoInf.rotation.x * (1 - kP) + (-0.05 - tremor) * kP;
        c.sup.scale.set(1 + 1.6 * kP, 1, 1);
        c.inf.scale.x = c.inf.scale.x * (1 - kP) + 3.6 * kP;
        c.inf.scale.y = 1 + 0.35 * kP;
        c.pivoInf.position.y = -7 * ESCALA;
      } else if (c.sup.scale.x !== 1 || c.inf.scale.y !== 1) {
        c.sup.scale.set(1, 1, 1);
        c.inf.scale.y = 1;
      }
    }
  }

  /** Inclina a cabeça: pitch positivo = olhar para cima (limite de ±1.2 rad) */
  definirOlhar(pitch) {
    // Com o corpo deitado, a cabeça compensa a inclinação para continuar olhando para frente
    this.pivoCabeca.rotation.x = Math.max(-1.2, Math.min(1.2, pitch + this._inclina * 0.85));
  }

  /** Libera a memória da GPU (geometrias e materiais de cache são compartilhados e ficam) */
  dispose() {
    this.geometrias.forEach((g) => g.dispose());
    this.material.dispose();
    this.materialCamada2.dispose();
    this.textura.dispose();
    this.neonTextura.dispose();
  }
}

// =====================================================================
// MÃOZINHA DA 1ª PESSOA
// ---------------------------------------------------------------------
// O braço direito aparece no canto de baixo da tela (como no Minecraft).
// Ele é desenhado numa SEGUNDA PASSADA: depois de desenhar o mundo, limpamos
// só a profundidade e desenhamos a mão numa cena própria (com luzes próprias).
// Assim a mão nunca entra dentro de paredes e não é escurecida pela noite.
// Usa a pele e a roupa do `Personagem` (mesmos materiais e texturas).
// =====================================================================
const MAO = {
  // Posição do ombro do braço, em relação à câmera (x direita, y cima, -z frente)
  posicao: [0.38, -0.55, -0.48],
  rotX: 1.95,        // quanto o braço aponta para frente/cima
  rotY: 0.32,        // gira um pouco para dentro (para o centro da tela)
  rotZ: -0.12,
  duracaoGolpe: 0.28,
  tamanhoBloco: 0.27, // lado do cubo do bloco segurado (em blocos)
};
const texturasCubo = new Map(); // nome da textura → CanvasTexture (compartilhado)

export class MaoPrimeiraPessoa {
  /**
   * @param opcoes { scene, camera, personagem, texturas }
   *   scene: a cena principal (ganha um gancho de pós-desenho)
   *   personagem: o Personagem do jogador (pele, roupa e espada)
   *   texturas: o objeto de criarTexturas() (para o cubinho do bloco)
   */
  constructor({ scene, camera, personagem, texturas }) {
    this.camera = camera;
    this.personagem = personagem;
    this.texturas = texturas;
    this.visivel = false;

    // Cena própria da mão, com luz fixa
    this.cena = new THREE.Scene();
    this.cena.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sol = new THREE.DirectionalLight(0xffffff, 1.4);
    sol.position.set(-0.5, 1, 0.8);
    this.cena.add(sol);

    this.ancora = new THREE.Group();   // acompanha a câmera
    this.cena.add(this.ancora);
    this.pivo = new THREE.Group();     // ombro: gira para balançar e golpear
    this.pivo.position.set(...MAO.posicao);
    this.ancora.add(this.pivo);

    // Braço (mesmas geometrias e materiais do boneco)
    const base = personagem.pivoBracoD.children[0];
    const manga = personagem.pivoBracoD.children[1];
    this.malhaBraco = new THREE.Mesh(base.geometry, personagem.material);
    this.malhaBraco.position.copy(base.position);
    this.malhaManga = new THREE.Mesh(manga.geometry, personagem.materialCamada2);
    this.malhaManga.position.copy(manga.position);
    this.grupoItem = new THREE.Group();   // na ponta da mão
    this.grupoItem.position.set(0, -10.5 * ESCALA, 0);
    this.pivo.add(this.malhaBraco, this.malhaManga, this.grupoItem);

    this._itemAtual = null;   // chave do que está na mão (para só remontar quando mudar)
    this._geoCubo = new THREE.BoxGeometry(1, 1, 1);
    this._fase = 0;
    this._amp = 0;
    this._golpe = -1;
    this._golpesVistos = personagem.contGolpes;
    this._entrada = 0;        // 0..1: a mão sobe suavemente quando aparece

    // Gancho: depois que o mundo foi desenhado, desenha a mão por cima
    scene.onAfterRender = (renderer, _cena, cam) => this._desenhar(renderer, cam);
  }

  /**
   * Chamada uma vez por quadro.
   * mostrar: true só em 1ª pessoa, sem menu, sem montaria
   * vel: velocidade horizontal; noChao: está pisando no chão
   * itemSel: item da hotbar selecionado (texto) ou null; blocoSel: id do bloco dele ou null
   */
  atualizar(dt, mostrar, vel, noChao, blocoSel) {
    this.visivel = mostrar;
    if (!mostrar) { this._entrada = 0; return; }
    this._entrada += (1 - this._entrada) * Math.min(1, dt * 8);

    // O que está na mão: espada da mão principal, senão o bloco selecionado
    const mao = this.personagem._mao;
    const chave = mao ? 'mao:' + mao : (blocoSel ? 'bloco:' + blocoSel : '');
    if (chave !== this._itemAtual) { this._itemAtual = chave; this._montarItem(mao, blocoSel); }

    // Espelha a manga da roupa (ela só aparece se a roupa tem manga)
    this.malhaManga.visible = this.personagem.pivoBracoD.children[1].visible;

    // Golpe novo? (o Personagem conta cada animarGolpe)
    if (this.personagem.contGolpes !== this._golpesVistos) {
      this._golpesVistos = this.personagem.contGolpes;
      this._golpe = 0;
    }
    let golpe = 0;
    if (this._golpe >= 0) {
      this._golpe += dt;
      if (this._golpe >= MAO.duracaoGolpe) this._golpe = -1;
      else golpe = Math.sin((this._golpe / MAO.duracaoGolpe) * Math.PI);
    }

    // Balanço ao andar
    this._fase += (noChao ? vel : 0) * dt * 2.4;
    const alvoAmp = noChao ? Math.min(1, vel / 4.3) : 0;
    this._amp += (alvoAmp - this._amp) * Math.min(1, dt * 8);
    const bx = Math.cos(this._fase) * 0.018 * this._amp;
    const by = Math.abs(Math.sin(this._fase)) * -0.022 * this._amp;
    const respira = Math.sin(this.personagem._tempo * 1.8) * 0.004;

    const p = this.pivo;
    const sobe = (1 - this._entrada) * -0.35;
    p.position.set(
      MAO.posicao[0] + bx - golpe * 0.10,
      MAO.posicao[1] + by + respira + sobe + golpe * 0.02,
      MAO.posicao[2] - golpe * 0.18);
    p.rotation.set(MAO.rotX - golpe * 0.5, MAO.rotY + golpe * 0.45, MAO.rotZ);

    // Acompanha a câmera
    this.ancora.position.copy(this.camera.position);
    this.ancora.quaternion.copy(this.camera.quaternion);
  }

  // Monta a espada ou o cubinho do bloco na ponta da mão
  _montarItem(mao, blocoSel) {
    limparGrupo(this.grupoItem);
    if (mao) {
      const espada = this.personagem.criarEspada(mao);
      espada.scale.setScalar(0.85);
      this.grupoItem.add(espada);
    } else if (blocoSel) {
      const mats = this._materiaisDoBloco(blocoSel);
      if (!mats) return;
      const cubo = new THREE.Mesh(this._geoCubo, mats);
      const t = MAO.tamanhoBloco;
      cubo.scale.setScalar(t);
      cubo.position.set(0, -0.05, -0.12);
      cubo.rotation.set(0.15, 0.7, 0);
      this.grupoItem.add(cubo);
    }
  }

  // 6 materiais do cubo (direita, esquerda, topo, baixo, frente, trás) com as texturas do bloco
  _materiaisDoBloco(id) {
    if (!this.texturas || !this.texturas.canvasDaTextura) return null;
    const def = { topo: texturaDaFace(id, 'topo'), lado: texturaDaFace(id, 'lado'), baixo: texturaDaFace(id, 'baixo') };
    const mat = (nome) => {
      let tex = texturasCubo.get(nome);
      if (!tex) {
        const canvas = this.texturas.canvasDaTextura(nome);
        if (!canvas) return null;
        tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        texturasCubo.set(nome, tex);
      }
      return new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4 });
    };
    const lado = mat(def.lado), topo = mat(def.topo), baixo = mat(def.baixo);
    if (!lado || !topo || !baixo) return null;
    return [lado, lado, topo, baixo, lado, lado];
  }

  _desenhar(renderer, cam) {
    if (!this.visivel) return;
    // Segunda passada: limpa só a profundidade e desenha a mão por cima de tudo
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false; // (não zera as contagens do F3)
    renderer.clearDepth();
    renderer.render(this.cena, cam);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
  }
}
