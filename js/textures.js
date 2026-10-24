// =====================================================================
// Hackraft - Texturas 16x16 geradas por código
// ---------------------------------------------------------------------
// Cada textura é desenhada num canvas 16x16 por uma "receita" (uma função).
// O gerador de números usa uma SEMENTE FIXA por textura, então o jogo
// sempre abre com as mesmas texturas.
// Para criar uma textura nova: acrescente uma receita em RECEITAS.
// Para trocar uma textura por um PNG: veja assets/textures/texturas.json.
// =====================================================================

import * as THREE from 'three';
import { BLOCOS, NOMES_TEXTURAS, texturaDaFace } from './blocks.js';
import { obterItem } from './items.js';

const T = 16; // tamanho de cada textura, em pixels

// ---------------------------------------------------------------------
// Gerador pseudoaleatório com semente (mulberry32) e hash de texto
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

function hashTexto(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Gerador da textura que está sendo desenhada agora (as funções auxiliares usam este)
let rnd = mulberry32(1);
const inteiro = (n) => Math.floor(rnd() * n);

// ---------------------------------------------------------------------
// Funções auxiliares de cor e desenho (reutilizáveis nas próximas fases)
// ---------------------------------------------------------------------
const lim = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Texto CSS a partir de [r, g, b] */
function rgb(c) {
  return `rgb(${Math.round(lim(c[0]))},${Math.round(lim(c[1]))},${Math.round(lim(c[2]))})`;
}

/** Clareia (d > 0) ou escurece (d < 0) uma cor [r, g, b] */
export function tom(c, d) {
  return [lim(c[0] + d), lim(c[1] + d), lim(c[2] + d)];
}

/** Pinta um pixel (ignora o que cair fora da textura) */
export function pixel(ctx, x, y, c) {
  if (x < 0 || y < 0 || x >= T || y >= T) return;
  ctx.fillStyle = rgb(c);
  ctx.fillRect(x, y, 1, 1);
}

/** Preenche tudo com uma cor base, variando o tom de cada pixel (nada de cor lisa) */
export function ruidoBase(ctx, corBase, variacao) {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = (rnd() - 0.5) * 2 * variacao;
      const j = (rnd() - 0.5) * variacao * 0.4; // pequena variação de matiz
      pixel(ctx, x, y, [corBase[0] + d + j, corBase[1] + d, corBase[2] + d - j]);
    }
  }
}

/** Espalha `qtd` pixels soltos, mais claros ou escuros que a cor base */
export function salpicar(ctx, corBase, qtd, delta) {
  for (let i = 0; i < qtd; i++) {
    const sinal = rnd() < 0.5 ? -1 : 1;
    pixel(ctx, inteiro(T), inteiro(T), tom(corBase, sinal * delta * (0.6 + rnd() * 0.6)));
  }
}

/** Mancha pequena (bloquinho w x h) com um tom diferente */
function mancha(ctx, x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pixel(ctx, x + i, y + j, c);
}

/** Pedra base (usada pelos minérios) */
function pedraBase(ctx) {
  ruidoBase(ctx, [125, 125, 125], 14);
  salpicar(ctx, [125, 125, 125], 18, 22);
}

/**
 * Pedra com pontinhos coloridos: base para minérios e cristais (Fases 5 e 9).
 * corPontos: [r, g, b]
 */
export function minerio(ctx, corPontos) {
  pedraBase(ctx);
  const grupos = 5 + inteiro(3);
  for (let g = 0; g < grupos; g++) {
    const cx = 1 + inteiro(T - 3);
    const cy = 1 + inteiro(T - 3);
    const tamanho = 2 + inteiro(3);
    for (let k = 0; k < tamanho; k++) {
      const x = cx + inteiro(2);
      const y = cy + inteiro(2);
      pixel(ctx, x, y, tom(corPontos, (rnd() - 0.5) * 30));
    }
    // brilhinho no canto do grupo
    pixel(ctx, cx, cy, tom(corPontos, 45));
  }
}

/** Converte "#rrggbb" em [r, g, b] */
function corHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Formas dos cristais (X = cristal): uma pequena (3x3) e duas grandes (4x4)
const FORMAS_CRISTAL = [
  ['.X.', 'XXX', 'XXX'],
  ['.XX.', 'XXXX', 'XXXX', '.XX.'],
  ['XXX.', 'XXXX', '.XXX', '..X.'],
];

/**
 * Pedra com 3 a 5 cristais facetados (pixel claro no topo, cor média, borda escura).
 * Reutilizável pelos minérios da Fase 9. corCristal: [r, g, b]
 * A posição dos cristais vem do gerador `rnd` (semente do nome da textura).
 */
export function minerioCristal(ctx, corCristal) {
  pedraBase(ctx);
  const ocupado = new Uint8Array(T * T); // evita cristais colados um no outro
  const total = 3 + inteiro(3);
  let feitos = 0;
  for (let tentativa = 0; tentativa < 60 && feitos < total; tentativa++) {
    const forma = FORMAS_CRISTAL[inteiro(FORMAS_CRISTAL.length)];
    const h = forma.length;
    const w = forma[0].length;
    const ox = 1 + inteiro(T - w - 1);
    const oy = 1 + inteiro(T - h - 1);
    // confere se a área (com 1 pixel de folga) está livre
    let livre = true;
    for (let y = oy - 1; y <= oy + h && livre; y++) {
      for (let x = ox - 1; x <= ox + w; x++) {
        if (x >= 0 && y >= 0 && x < T && y < T && ocupado[y * T + x]) { livre = false; break; }
      }
    }
    if (!livre) continue;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (forma[y][x] !== 'X') continue;
        ocupado[(oy + y) * T + ox + x] = 1;
        const dentro = (cx, cy) => cy >= 0 && cy < h && cx >= 0 && cx < w && forma[cy][cx] === 'X';
        // borda escura: lado de baixo e da direita; o resto é a cor média
        const bordaBaixo = !dentro(x, y + 1);
        const bordaDir = !dentro(x + 1, y);
        const topoEsq = !dentro(x, y - 1) && !dentro(x - 1, y);
        let c = corCristal;
        if (topoEsq) c = tom(corCristal, 85);
        else if (bordaBaixo || bordaDir) c = tom(corCristal, -75);
        pixel(ctx, ox + x, oy + y, c);
      }
    }
    // reflexo branco no pixel do topo
    pixel(ctx, ox + forma[0].indexOf('X'), oy, tom(corCristal, 140));
    feitos++;
  }
}

/** Rachadura: caminhada aleatória a partir de um ponto, desenhada com a cor dada */
function rachadura(ctx, x, y, passos, c) {
  for (let i = 0; i < passos; i++) {
    pixel(ctx, x, y, c);
    const r = rnd();
    if (r < 0.4) x += rnd() < 0.5 ? -1 : 1;
    else if (r < 0.8) y += rnd() < 0.5 ? -1 : 1;
    else { x += rnd() < 0.5 ? -1 : 1; y += rnd() < 0.5 ? -1 : 1; }
  }
}

// ---------------------------------------------------------------------
// Receitas: nome da textura -> função que desenha no ctx 16x16
// ---------------------------------------------------------------------
export const RECEITAS = {
  grama_topo(ctx) {
    const base = [88, 158, 54];
    ruidoBase(ctx, base, 16);
    salpicar(ctx, base, 26, 34);
    for (let i = 0; i < 6; i++) pixel(ctx, inteiro(T), inteiro(T), [112, 184, 70]); // pontinhos claros
    for (let i = 0; i < 6; i++) pixel(ctx, inteiro(T), inteiro(T), [60, 118, 38]);  // e escuros
  },

  grama_lado(ctx) {
    const terra = [134, 96, 67];
    ruidoBase(ctx, terra, 14);
    for (let i = 0; i < 4; i++) mancha(ctx, inteiro(T - 1), 4 + inteiro(T - 5), 2, 1 + inteiro(2), tom(terra, -22));
    salpicar(ctx, terra, 10, 26);
    // franja verde irregular "pingando" (3 a 4 px)
    const verde = [88, 158, 54];
    for (let x = 0; x < T; x++) {
      const altura = 3 + (rnd() < 0.5 ? 1 : 0);
      for (let y = 0; y < altura; y++) {
        const d = (rnd() - 0.5) * 30;
        pixel(ctx, x, y, y === altura - 1 ? tom([70, 130, 44], d * 0.6) : tom(verde, d));
      }
    }
  },

  terra(ctx) {
    const base = [134, 96, 67];
    ruidoBase(ctx, base, 14);
    for (let i = 0; i < 6; i++) {
      mancha(ctx, inteiro(T - 2), inteiro(T - 2), 2, 2, tom(base, rnd() < 0.5 ? -20 : 14));
    }
    salpicar(ctx, base, 14, 28);
    // pedrinhas cinzentas
    for (let i = 0; i < 5; i++) {
      const g = 110 + inteiro(40);
      pixel(ctx, inteiro(T), inteiro(T), [g, g - 2, g - 6]);
    }
  },

  pedra(ctx) {
    const base = [125, 125, 125];
    ruidoBase(ctx, base, 13);
    for (let i = 0; i < 5; i++) mancha(ctx, inteiro(T - 3), inteiro(T - 3), 3, 2, tom(base, rnd() < 0.5 ? -12 : 10));
    salpicar(ctx, base, 16, 24);
    // algumas rachaduras escuras
    for (let i = 0; i < 3; i++) rachadura(ctx, inteiro(T), inteiro(T), 4 + inteiro(4), [78, 78, 80]);
  },

  areia(ctx) {
    const base = [219, 207, 160];
    ruidoBase(ctx, base, 9);
    salpicar(ctx, base, 40, 20); // granulado fino
    for (let i = 0; i < 4; i++) pixel(ctx, inteiro(T), inteiro(T), [190, 176, 130]);
  },

  agua(ctx) {
    const base = [44, 92, 205];
    ruidoBase(ctx, base, 8);
    // ondinhas mais claras
    for (let i = 0; i < 7; i++) {
      const y = inteiro(T);
      const x = inteiro(T - 3);
      const tam = 2 + inteiro(3);
      for (let k = 0; k < tam; k++) pixel(ctx, x + k, y, [96, 150, 235]);
      pixel(ctx, x + 1, y + 1, [30, 70, 175]);
    }
  },

  tronco_lado(ctx) {
    const base = [102, 80, 50];
    // cada coluna tem um tom próprio: listras verticais de casca
    const colunas = [];
    for (let x = 0; x < T; x++) colunas.push((rnd() - 0.5) * 36);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const d = colunas[x] + (rnd() - 0.5) * 12;
        pixel(ctx, x, y, tom(base, d));
      }
    }
    // pedaços de casca mais escuros (traços verticais curtos)
    for (let i = 0; i < 10; i++) {
      const x = inteiro(T);
      const y = inteiro(T - 3);
      const h = 2 + inteiro(3);
      for (let k = 0; k < h; k++) pixel(ctx, x, y + k, tom(base, -40));
    }
  },

  tronco_topo(ctx) {
    const claro = [186, 150, 94];
    const escuro = [160, 124, 72];
    const casca = [100, 78, 48];
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const dist = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45;
        const d = (rnd() - 0.5) * 12;
        if (dist > 6.6) pixel(ctx, x, y, tom(casca, d * 1.4));
        else {
          const anel = Math.floor(dist / 1.5) % 2 === 0;
          pixel(ctx, x, y, tom(anel ? claro : escuro, d));
        }
      }
    }
  },

  folhas(ctx) {
    const base = [58, 130, 40];
    // decide primeiro quais pixels viram buraco (~22%)
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (rnd() < 0.22) {
          ctx.clearRect(x, y, 1, 1); // transparente
          continue;
        }
        const d = (rnd() - 0.5) * 50;
        pixel(ctx, x, y, tom(base, d));
      }
    }
  },

  rocha_matriz(ctx) {
    // mistura caótica de cinza-escuro e preto
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const v = rnd();
        const g = v < 0.3 ? 8 + inteiro(14) : 28 + inteiro(40);
        pixel(ctx, x, y, [g, g, g + 2]);
      }
    }
    for (let i = 0; i < 3; i++) rachadura(ctx, inteiro(T), inteiro(T), 5, [4, 4, 6]);
  },

  // Topo do presente: caixa dourada com o laço vermelho em cruz e um nó no centro
  presente_topo(ctx) {
    const ouro = [236, 190, 52];
    const fita = [206, 38, 46];
    ruidoBase(ctx, ouro, 8);
    // borda mais escura (a tampa da caixa)
    for (let i = 0; i < T; i++) {
      for (const k of [0, T - 1]) {
        pixel(ctx, i, k, tom(ouro, -34));
        pixel(ctx, k, i, tom(ouro, -34));
      }
    }
    // brilhinhos
    for (let i = 0; i < 5; i++) pixel(ctx, 2 + inteiro(T - 4), 2 + inteiro(T - 4), tom(ouro, 30));
    // fitas em cruz (2 pixels de largura)
    for (let i = 0; i < T; i++) {
      for (let k = 7; k <= 8; k++) {
        pixel(ctx, k, i, tom(fita, k === 7 ? 14 : -14));
        pixel(ctx, i, k, tom(fita, k === 7 ? 14 : -14));
      }
    }
    // nó no centro (4x4) com brilho e sombra
    mancha(ctx, 6, 6, 4, 4, tom(fita, 22));
    mancha(ctx, 7, 7, 2, 2, tom(fita, -30));
    pixel(ctx, 6, 6, tom(fita, 70));
    pixel(ctx, 9, 9, tom(fita, -50));
    // pontinhas do laço saindo do nó
    pixel(ctx, 5, 5, tom(fita, 8)); pixel(ctx, 10, 5, tom(fita, -8));
    pixel(ctx, 5, 10, tom(fita, -8)); pixel(ctx, 10, 10, tom(fita, -20));
  },

  // Lado do presente: caixa dourada com a fita vertical vermelha
  presente_lado(ctx) {
    const ouro = [226, 180, 46];
    const fita = [206, 38, 46];
    ruidoBase(ctx, ouro, 8);
    // tampa (faixa mais escura no alto) e base
    for (let x = 0; x < T; x++) {
      pixel(ctx, x, 0, tom(ouro, 22));
      pixel(ctx, x, 1, tom(ouro, 8));
      pixel(ctx, x, 3, tom(ouro, -38));
      pixel(ctx, x, T - 1, tom(ouro, -34));
    }
    // cantos da caixa
    for (let y = 0; y < T; y++) {
      pixel(ctx, 0, y, tom(ouro, -26));
      pixel(ctx, T - 1, y, tom(ouro, -26));
    }
    for (let i = 0; i < 4; i++) pixel(ctx, 2 + inteiro(T - 4), 4 + inteiro(T - 6), tom(ouro, 26));
    // fita vertical
    for (let y = 0; y < T; y++) {
      pixel(ctx, 7, y, tom(fita, 14));
      pixel(ctx, 8, y, tom(fita, -14));
    }
    // a fita fica mais clara sobre a tampa
    mancha(ctx, 6, 0, 4, 3, tom(fita, 24));
    pixel(ctx, 7, 1, tom(fita, 60));
    pixel(ctx, 8, 2, tom(fita, -40));
  },

  // Gelo: azul-claro com linhas brancas de rachadura e reflexos
  gelo(ctx) {
    const base = [150, 215, 245];
    ruidoBase(ctx, base, 10);
    for (let i = 0; i < 3; i++) mancha(ctx, inteiro(T - 3), inteiro(T - 3), 3, 2, tom(base, rnd() < 0.5 ? -14 : 12));
    for (let i = 0; i < 3; i++) rachadura(ctx, inteiro(T), inteiro(T), 5 + inteiro(4), [235, 250, 255]);
    // reflexos diagonais
    for (let i = 0; i < 2; i++) {
      const x = 1 + inteiro(T - 6);
      const y = 1 + inteiro(T - 6);
      for (let k = 0; k < 3; k++) pixel(ctx, x + k, y + k, [255, 255, 255]);
    }
    salpicar(ctx, base, 12, 20);
  },

  // ---------------- Fase 6: construção ----------------

  // Tábuas: 4 tábuas horizontais com veios, frestas e pregos
  tabuas(ctx) {
    const base = [184, 148, 92];
    for (let fila = 0; fila < 4; fila++) {
      const tomFila = (rnd() - 0.5) * 26;
      const y0 = fila * 4;
      for (let y = y0; y < y0 + 4; y++) {
        for (let x = 0; x < T; x++) {
          pixel(ctx, x, y, tom(base, tomFila + (rnd() - 0.5) * 10));
        }
      }
      // veios (traços horizontais mais escuros)
      for (let i = 0; i < 3; i++) {
        const x = inteiro(T - 4);
        const y = y0 + inteiro(3);
        const c = tom(base, tomFila - 24);
        for (let k = 0; k < 3 + inteiro(3); k++) pixel(ctx, x + k, y, c);
      }
      // fresta escura embaixo de cada tábua
      for (let x = 0; x < T; x++) pixel(ctx, x, y0 + 3, tom(base, -62 + (rnd() - 0.5) * 10));
      // fresta vertical (emenda), em posição diferente por fila
      const emenda = (fila * 7 + 3) % T;
      for (let y = y0; y < y0 + 3; y++) pixel(ctx, emenda, y, tom(base, -48));
      // pregos nas pontas
      pixel(ctx, 1, y0 + 1, tom(base, -70));
      pixel(ctx, T - 2, y0 + 1, tom(base, -70));
    }
  },

  // Vidro: moldura clara de 1 px, centro transparente e reflexos diagonais
  vidro(ctx) {
    ctx.clearRect(0, 0, T, T);
    const moldura = [206, 224, 230];
    for (let i = 0; i < T; i++) {
      pixel(ctx, i, 0, tom(moldura, 12));
      pixel(ctx, 0, i, tom(moldura, 12));
      pixel(ctx, i, T - 1, tom(moldura, -22 + (rnd() - 0.5) * 8));
      pixel(ctx, T - 1, i, tom(moldura, -22));
    }
    // reflexos: traços diagonais brancos semitransparentes
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let k = 0; k < 4; k++) ctx.fillRect(3 + k, 8 - k, 1, 1);
    ctx.fillRect(3, 11, 1, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let k = 0; k < 3; k++) ctx.fillRect(8 + k, 12 - k, 1, 1);
    ctx.fillRect(11, 4, 1, 1);
  },

  // Tijolos: fileiras alternadas com rejunte cinza
  tijolos(ctx) {
    const tijolo = [168, 74, 58];
    const rejunte = [168, 166, 158];
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) pixel(ctx, x, y, tom(rejunte, (rnd() - 0.5) * 14));
    }
    for (let fila = 0; fila < 4; fila++) {
      const desloc = (fila % 2) * 4;
      for (let bloco = -1; bloco < 3; bloco++) {
        const x0 = bloco * 8 + desloc;
        const tomBloco = (rnd() - 0.5) * 36;
        for (let y = fila * 4; y < fila * 4 + 3; y++) {
          for (let x = x0; x < x0 + 7; x++) {
            // luz em cima e sombra embaixo
            const borda = y === fila * 4 ? 10 : y === fila * 4 + 2 ? -14 : 0;
            pixel(ctx, x, y, tom(tijolo, tomBloco + borda + (rnd() - 0.5) * 14));
          }
        }
      }
    }
  },

  // Porta (metade de baixo): madeira com moldura e maçaneta escura
  porta_baixo(ctx) {
    portaBase(ctx);
    pixel(ctx, 12, 7, [58, 58, 64]);
    pixel(ctx, 12, 8, [38, 38, 44]);
    pixel(ctx, 11, 7, [96, 96, 104]);
    pixel(ctx, 1, 2, [70, 70, 76]); pixel(ctx, 1, 13, [70, 70, 76]); // dobradiças
  },

  // Porta (metade de cima): madeira com moldura e 2 janelinhas transparentes
  porta_cima(ctx) {
    portaBase(ctx);
    for (const x0 of [3, 9]) {
      // moldura escura em volta das janelas
      for (let x = x0 - 1; x <= x0 + 4; x++) { pixel(ctx, x, 2, [92, 62, 30]); pixel(ctx, x, 8, [92, 62, 30]); }
      for (let y = 2; y <= 8; y++) { pixel(ctx, x0 - 1, y, [92, 62, 30]); pixel(ctx, x0 + 4, y, [92, 62, 30]); }
      // vidro: transparente
      for (let y = 3; y <= 7; y++) {
        for (let x = x0; x < x0 + 4; x++) ctx.clearRect(x, y, 1, 1);
      }
    }
    pixel(ctx, 1, 2, [70, 70, 76]); pixel(ctx, 1, 13, [70, 70, 76]);
  },

  // Tocha: palito de madeira com o topo aceso (fundo transparente)
  tocha(ctx) {
    ctx.clearRect(0, 0, T, T);
    const madeira = [120, 84, 44];
    for (let y = 6; y < T; y++) {
      pixel(ctx, 7, y, tom(madeira, 14 + (rnd() - 0.5) * 16));
      pixel(ctx, 8, y, tom(madeira, -18 + (rnd() - 0.5) * 16));
    }
    // topo: brasa, chama laranja e ponta amarela
    pixel(ctx, 7, 5, [190, 90, 20]); pixel(ctx, 8, 5, [160, 70, 16]);
    pixel(ctx, 7, 4, [255, 170, 40]); pixel(ctx, 8, 4, [240, 130, 28]);
    pixel(ctx, 7, 3, [255, 226, 90]); pixel(ctx, 8, 3, [255, 190, 50]);
    pixel(ctx, 7, 2, [255, 244, 170]);
  },

  // Baú: topo, lado e frente (com a fechadura metálica)
  bau_topo(ctx) {
    bauBase(ctx);
  },
  bau_lado(ctx) {
    bauBase(ctx);
    for (let x = 1; x < T - 1; x++) pixel(ctx, x, 5, [70, 44, 18]); // linha da tampa
  },
  bau_frente(ctx) {
    bauBase(ctx);
    for (let x = 1; x < T - 1; x++) pixel(ctx, x, 5, [70, 44, 18]);
    mancha(ctx, 6, 4, 4, 5, [176, 178, 186]);
    mancha(ctx, 7, 6, 2, 3, [58, 58, 66]);
    for (let x = 6; x < 10; x++) pixel(ctx, x, 4, [220, 222, 230]);
    pixel(ctx, 9, 8, [120, 122, 130]);
  },

  // Minério de carvão: pedra com pontos pretos foscos (sem brilho)
  minerio_carvao(ctx) {
    pedraBase(ctx);
    const grupos = 6 + inteiro(3);
    for (let g = 0; g < grupos; g++) {
      const cx = 1 + inteiro(T - 3);
      const cy = 1 + inteiro(T - 3);
      const n = 3 + inteiro(3);
      for (let k = 0; k < n; k++) {
        const v = 18 + inteiro(14);
        pixel(ctx, cx + inteiro(3), cy + inteiro(2), [v, v, v + 2]);
      }
    }
  },
};

/** Madeira da porta: tom base, veios, moldura escura de 2 px */
function portaBase(ctx) {
  const base = [150, 106, 56];
  ruidoBase(ctx, base, 10);
  for (let i = 0; i < 6; i++) {
    const x = 2 + inteiro(T - 4);
    const y = inteiro(T - 5);
    for (let k = 0; k < 4; k++) pixel(ctx, x, y + k, tom(base, -22));
  }
  const moldura = [100, 66, 32];
  for (let i = 0; i < T; i++) {
    for (const k of [0, 1, T - 2, T - 1]) {
      pixel(ctx, i, k, tom(moldura, (rnd() - 0.5) * 12));
      pixel(ctx, k, i, tom(moldura, (rnd() - 0.5) * 12));
    }
  }
  for (let i = 2; i < T - 2; i++) { pixel(ctx, i, 2, tom(base, 18)); pixel(ctx, 2, i, tom(base, 18)); }
}

/** Madeira escura do baú, com borda mais escura e pregos nos cantos */
function bauBase(ctx) {
  const base = [146, 98, 42];
  ruidoBase(ctx, base, 10);
  for (let x = 3; x < T; x += 4) for (let y = 1; y < T - 1; y++) pixel(ctx, x, y, tom(base, -20));
  const borda = [78, 48, 20];
  for (let i = 0; i < T; i++) {
    pixel(ctx, i, 0, borda); pixel(ctx, i, T - 1, borda);
    pixel(ctx, 0, i, borda); pixel(ctx, T - 1, i, borda);
  }
  for (const [x, y] of [[1, 1], [T - 2, 1], [1, T - 2], [T - 2, T - 2]]) pixel(ctx, x, y, [60, 60, 66]);
}

// Receitas dos minérios de cristal (uma por cor), todas com o helper minerioCristal
const COR_MINERIOS = {
  minerio_azul: '#3fa9ff',
  minerio_vermelho: '#ff3f4f',
  minerio_dourado: '#ffcf3f',
  minerio_verde: '#3fff7a',
  minerio_roxo: '#b44fff',
  minerio_fogo: '#ff8a2a',
  minerio_raio: '#eef6ff',
  minerio_gelo: '#a8f0ff',
};
for (const [nome, hex] of Object.entries(COR_MINERIOS)) {
  RECEITAS[nome] = (ctx) => minerioCristal(ctx, corHex(hex));
}

// ---------------------------------------------------------------------
// Geração de uma textura (canvas 16x16)
// ---------------------------------------------------------------------
function novoCanvas(tam = T) {
  const c = document.createElement('canvas');
  c.width = tam;
  c.height = tam;
  return c;
}

/** Gera o canvas de uma textura pelo nome. Sem receita: xadrez magenta/preto. */
export function gerarTextura(nome) {
  const canvas = novoCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  rnd = mulberry32(hashTexto(nome)); // semente fixa por textura
  const receita = RECEITAS[nome];
  if (receita) {
    receita(ctx);
  } else {
    console.warn(`[texturas] Sem receita para "${nome}": usando xadrez magenta.`);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        ctx.fillStyle = ((x >> 2) + (y >> 2)) % 2 === 0 ? '#ff00ff' : '#000000';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------
// Substituição opcional por PNGs (assets/textures/texturas.json)
// ---------------------------------------------------------------------
function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('não foi possível carregar ' + url));
    img.src = url;
  });
}

async function aplicarSubstituicoes(canvases) {
  try {
    const resp = await fetch('assets/textures/texturas.json');
    if (!resp.ok) return; // sem arquivo: tudo bem
    const config = await resp.json();
    const lista = Array.isArray(config.substituir) ? config.substituir : [];
    for (const nome of lista) {
      if (typeof nome !== 'string' || nome.startsWith('_')) continue;
      try {
        const img = await carregarImagem(`assets/textures/${nome}.png`);
        const canvas = novoCanvas();
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, T, T);
        canvases.set(nome, canvas);
      } catch (e) {
        console.warn(`[texturas] Não substituí "${nome}":`, e.message);
      }
    }
  } catch (e) {
    console.warn('[texturas] texturas.json ignorado:', e.message);
  }
}

// ---------------------------------------------------------------------
// Rachaduras de quebra (10 fases, cada uma contém a anterior)
// ---------------------------------------------------------------------
function criarRachaduras() {
  rnd = mulberry32(hashTexto('rachaduras'));
  // Várias caminhadas saindo do centro; a ordem dos pixels segue o passo
  const caminhos = [];
  const direcoes = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (const [dx, dy] of direcoes) {
    let x = 7 + inteiro(2);
    let y = 7 + inteiro(2);
    const passos = [];
    for (let i = 0; i < 9; i++) {
      passos.push([x, y]);
      const r = rnd();
      if (r < 0.55) { x += dx; y += dy; }
      else if (r < 0.8) x += dx || (rnd() < 0.5 ? -1 : 1);
      else y += dy || (rnd() < 0.5 ? -1 : 1);
    }
    caminhos.push(passos);
  }
  // Ordena os pixels por passo (todos os caminhos crescem juntos)
  const ordem = [];
  const vistos = new Set();
  for (let i = 0; i < 9; i++) {
    for (const caminho of caminhos) {
      const [x, y] = caminho[i];
      const chave = x + ',' + y;
      if (x < 0 || y < 0 || x >= T || y >= T || vistos.has(chave)) continue;
      vistos.add(chave);
      ordem.push([x, y]);
    }
  }

  const lista = [];
  for (let estagio = 0; estagio < 10; estagio++) {
    const canvas = novoCanvas();
    const ctx = canvas.getContext('2d');
    const total = Math.round((ordem.length * (estagio + 1)) / 10);
    for (let i = 0; i < total; i++) {
      const [x, y] = ordem[i];
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y, 1, 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    lista.push(tex);
  }
  return lista;
}

// ---------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------
export async function criarTexturas() {
  const nomes = [...NOMES_TEXTURAS];

  // 1) Gera todas as texturas
  const canvases = new Map();
  for (const nome of nomes) canvases.set(nome, gerarTextura(nome));

  // 2) Troca por PNGs, se houver
  await aplicarSubstituicoes(canvases);

  // 3) Monta a textura em array (uma camada por textura)
  const indices = new Map();
  nomes.forEach((nome, i) => indices.set(nome, i));
  const N = nomes.length;
  const dados = new Uint8Array(T * T * 4 * N);
  nomes.forEach((nome, camada) => {
    const ctx = canvases.get(nome).getContext('2d', { willReadFrequently: true });
    const px = ctx.getImageData(0, 0, T, T).data;
    // copia as linhas DE BAIXO PARA CIMA: a linha 15 do canvas vira a primeira
    // linha dos dados, assim v = 0 é a base da textura
    for (let y = 0; y < T; y++) {
      const origem = (T - 1 - y) * T * 4;
      const destino = (camada * T * T + y * T) * 4;
      dados.set(px.subarray(origem, origem + T * 4), destino);
    }
  });
  const array = new THREE.DataArrayTexture(dados, T, T, N);
  array.format = THREE.RGBAFormat;
  array.type = THREE.UnsignedByteType;
  array.magFilter = THREE.NearestFilter;
  array.minFilter = THREE.NearestMipmapLinearFilter;
  array.generateMipmaps = true;
  array.colorSpace = THREE.SRGBColorSpace;
  array.needsUpdate = true;

  // 4) Atlas: todas as texturas lado a lado numa grade
  const colunasAtlas = Math.ceil(Math.sqrt(N));
  const linhasAtlas = Math.ceil(N / colunasAtlas);
  const atlasCanvas = novoCanvas(1);
  atlasCanvas.width = colunasAtlas * T;
  atlasCanvas.height = linhasAtlas * T;
  const atlasCtx = atlasCanvas.getContext('2d');
  atlasCtx.imageSmoothingEnabled = false;
  nomes.forEach((nome, i) => {
    atlasCtx.drawImage(canvases.get(nome), (i % colunasAtlas) * T, Math.floor(i / colunasAtlas) * T);
  });

  // 5) Funções de consulta
  const indice = (nome) => {
    const i = indices.get(nome);
    if (i === undefined) {
      console.warn(`[texturas] Textura desconhecida: "${nome}"`);
      return 0;
    }
    return i;
  };
  const canvasDaTextura = (nome) => canvases.get(nome) ?? null;

  // Ícones 3D (cubinho isométrico), guardados em cache
  const cacheIcones = new Map();
  function iconeBloco(id) {
    if (cacheIcones.has(id)) return cacheIcones.get(id);
    const bloco = BLOCOS[id];
    let url = null;
    if (bloco && bloco.texturas) {
      url = desenharIcone(
        canvasDaTextura(texturaDaFace(id, 'topo')),
        canvasDaTextura(texturaDaFace(id, 'lado')),
      );
    }
    cacheIcones.set(id, url);
    return url;
  }

  // Ícone de QUALQUER item (48x48, em cache)
  const cacheItens = new Map();
  function iconeItem(nome) {
    if (cacheItens.has(nome)) return cacheItens.get(nome);
    let url;
    const item = obterItem(nome);
    if (item && item.tipo === 'bloco' && !ICONES_ESPECIAIS.has(nome)) url = iconeBloco(item.bloco);
    else url = desenharIconeItem(item);
    cacheItens.set(nome, url);
    return url;
  }

  return {
    array,
    indice,
    atlasCanvas,
    canvasDaTextura,
    iconeBloco,
    iconeItem,
    rachaduras: criarRachaduras(),
  };
}

// ---------------------------------------------------------------------
// Ícones de itens (roupa, armadura, espada, capa) desenhados pixel a pixel
// ---------------------------------------------------------------------
// Cada ícone é uma "grade" 16x16 de cores. Depois de desenhar a forma,
// colocamos um contorno escuro em volta e ampliamos para 48x48.

/** Grade vazia 16x16 (cada posição é null ou [r, g, b]) */
function novaGrade() {
  return new Array(T * T).fill(null);
}

function ponto(g, x, y, c) {
  if (x < 0 || y < 0 || x >= T || y >= T) return;
  g[y * T + x] = c;
}

function retangulo(g, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ponto(g, x, y, c);
}

/** Preenche com `cor` todos os pixels onde mascara(x, y) é verdadeira, com um degradê suave de luz */
function preencher(g, mascara, cor) {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!mascara(x, y)) continue;
      let d = ((7.5 - x) + (7.5 - y) * 0.6) * 1.5;
      d = d < -20 ? -20 : d > 20 ? 20 : d;
      ponto(g, x, y, tom(cor, d));
    }
  }
}

/** Contorno: todo pixel vazio ao lado de um pixel pintado vira uma versão bem escura dele */
function contornar(g) {
  const original = g.slice();
  const viz = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (original[y * T + x]) continue;
      for (const [dx, dy] of viz) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= T || ny >= T) continue;
        const c = original[ny * T + nx];
        if (c) { g[y * T + x] = tom(c, -105); break; }
      }
    }
  }
}

/** Converte a grade em dataURL 48x48, sem suavizar */
function grade48(g) {
  const pequeno = novoCanvas();
  const pctx = pequeno.getContext('2d');
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const c = g[y * T + x];
      if (c) { pctx.fillStyle = rgb(c); pctx.fillRect(x, y, 1, 1); }
    }
  }
  const grande = novoCanvas(48);
  const ctx = grande.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pequeno, 0, 0, 48, 48);
  return grande.toDataURL('image/png');
}

// --- Camiseta (roupas) ---
function mascaraCamiseta(x, y) {
  if (y === 3) return (x >= 1 && x <= 5) || (x >= 10 && x <= 14);
  if (y >= 4 && y <= 7) return x >= 1 && x <= 14;
  if (y >= 8 && y <= 13) return x >= 4 && x <= 11;
  return false;
}

// Cores e enfeites de cada visual de roupa
const ROUPA_ICONE = {
  ninja(g) {
    const preto = [38, 38, 48];
    const vermelho = [214, 40, 44];
    preencher(g, mascaraCamiseta, preto);
    retangulo(g, 6, 4, 9, 4, tom(preto, 30));       // gola
    retangulo(g, 4, 11, 11, 12, vermelho);           // faixa na cintura
    ponto(g, 12, 12, vermelho); ponto(g, 13, 13, tom(vermelho, -20)); // ponta da faixa
    ponto(g, 11, 13, tom(vermelho, -30));
    retangulo(g, 1, 7, 3, 7, tom(preto, 24));        // punho
    retangulo(g, 12, 7, 14, 7, tom(preto, 24));
  },
  cavaleiro(g) {
    const azul = [48, 88, 190];
    const ouro = [240, 200, 60];
    preencher(g, mascaraCamiseta, azul);
    retangulo(g, 6, 4, 9, 4, ouro);                  // gola dourada
    retangulo(g, 4, 12, 11, 12, ouro);               // cinto
    retangulo(g, 4, 13, 11, 13, tom(azul, -22));
    retangulo(g, 7, 6, 8, 10, ouro);                 // cruz no peito
    retangulo(g, 6, 7, 9, 7, ouro);
    retangulo(g, 1, 7, 3, 7, ouro); retangulo(g, 12, 7, 14, 7, ouro); // punhos
  },
  mago(g) {
    const roxo = [112, 62, 176];
    const amarelo = [255, 226, 80];
    preencher(g, mascaraCamiseta, roxo);
    retangulo(g, 6, 4, 9, 4, tom(roxo, 40));
    retangulo(g, 4, 13, 11, 13, amarelo);            // barra dourada
    // estrela no peito (sinal de mais com brilho)
    retangulo(g, 7, 6, 8, 10, amarelo);
    retangulo(g, 6, 8, 9, 8, amarelo);
    ponto(g, 7, 8, [255, 255, 215]);
    ponto(g, 5, 6, amarelo); ponto(g, 10, 10, amarelo);
    retangulo(g, 1, 7, 3, 7, tom(roxo, 36)); retangulo(g, 12, 7, 14, 7, tom(roxo, 36));
  },
  astronauta(g) {
    const branco = [232, 234, 240];
    const laranja = [250, 130, 30];
    preencher(g, mascaraCamiseta, branco);
    retangulo(g, 6, 4, 9, 4, laranja);               // gola
    retangulo(g, 1, 6, 3, 6, laranja); retangulo(g, 12, 6, 14, 6, laranja); // faixas nas mangas
    retangulo(g, 4, 12, 11, 12, laranja);            // cinto
    retangulo(g, 6, 7, 9, 9, tom(branco, -40));      // painel de controle
    ponto(g, 6, 7, [80, 200, 255]); ponto(g, 8, 8, laranja); ponto(g, 9, 9, [120, 235, 120]);
  },
  pirata(g) {
    const vermelho = [196, 40, 48];
    const branco = [240, 236, 226];
    preencher(g, mascaraCamiseta, branco);
    // listras horizontais, uma linha sim e outra não
    for (let y = 3; y <= 13; y++) {
      if ((y & 1) === 0) continue;
      for (let x = 0; x < T; x++) {
        if (mascaraCamiseta(x, y)) ponto(g, x, y, tom(vermelho, ((7.5 - x) + (7.5 - y) * 0.6) * 1.5 > 0 ? 8 : -8));
      }
    }
    retangulo(g, 6, 4, 9, 4, [60, 40, 30]);          // gola escura
  },
  hacker(g) {
    const preto = [18, 22, 20];
    const verde = [40, 255, 110];
    preencher(g, mascaraCamiseta, preto);
    retangulo(g, 6, 4, 9, 4, verde);                 // gola neon
    // "código" em pontinhos verdes
    const codigo = [[5, 6], [7, 6], [8, 6], [10, 6], [6, 8], [9, 8], [10, 8], [5, 10], [7, 10], [8, 10], [6, 12], [9, 12]];
    for (const [x, y] of codigo) ponto(g, x, y, tom(verde, -30));
    ponto(g, 2, 5, verde); ponto(g, 13, 6, verde);
    retangulo(g, 1, 7, 3, 7, tom(verde, -60)); retangulo(g, 12, 7, 14, 7, tom(verde, -60));
  },
};

// --- Armaduras ---
const COR_MATERIAL = {
  couro: [150, 98, 58],
  ferro: [206, 210, 218],
};

function pecaArmadura(g, parte, material) {
  const cor = COR_MATERIAL[material] ?? [160, 160, 172];
  const realce = tom(cor, 38);
  const sombra = tom(cor, -36);
  if (parte === 'capacete') {
    preencher(g, (x, y) => (y === 3 ? x >= 5 && x <= 10 : y >= 4 && y <= 9 ? x >= 4 && x <= 11 : y >= 10 && y <= 12 ? (x >= 4 && x <= 5) || (x >= 10 && x <= 11) : false), cor);
    retangulo(g, 6, 7, 9, 8, [26, 24, 30]);          // abertura do rosto
    retangulo(g, 5, 4, 7, 4, realce);                // brilho no alto
    retangulo(g, 4, 9, 11, 9, sombra);               // aba
  } else if (parte === 'peitoral') {
    preencher(g, (x, y) => (y === 3 || y === 4 ? ((x >= 2 && x <= 5) || (x >= 10 && x <= 13)) : y === 5 ? x >= 2 && x <= 13 : y >= 6 && y <= 12 ? x >= 4 && x <= 11 : y === 13 ? x >= 5 && x <= 10 : false), cor);
    retangulo(g, 4, 5, 4, 12, realce);
    retangulo(g, 7, 6, 8, 12, tom(cor, -12));        // faixa central do peito
    retangulo(g, 4, 12, 11, 12, sombra);
  } else if (parte === 'calca') {
    preencher(g, (x, y) => (y >= 2 && y <= 5 ? x >= 3 && x <= 12 : y >= 6 && y <= 13 ? (x >= 3 && x <= 6) || (x >= 9 && x <= 12) : false), cor);
    retangulo(g, 3, 2, 12, 2, sombra);               // cós
    retangulo(g, 7, 3, 8, 3, realce);                // fivela
    retangulo(g, 3, 13, 6, 13, sombra); retangulo(g, 9, 13, 12, 13, sombra); // barras
  } else if (parte === 'botas') {
    const bota = (x, y) => (y >= 3 && y <= 9 ? (x >= 2 && x <= 5) || (x >= 10 && x <= 13)
      : y >= 10 && y <= 12 ? (x >= 1 && x <= 6) || (x >= 9 && x <= 14) : false);
    preencher(g, bota, cor);
    retangulo(g, 1, 12, 6, 12, [52, 38, 30]); retangulo(g, 9, 12, 14, 12, [52, 38, 30]); // solas
    retangulo(g, 2, 3, 5, 3, sombra); retangulo(g, 10, 3, 13, 3, sombra);               // cano
    ponto(g, 3, 6, realce); ponto(g, 11, 6, realce);
  }
  // Detalhes do material
  if (material === 'couro') {
    // costuras (pontinhos claros)
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const c = g[y * T + x];
        if (c && (x + y) % 5 === 0 && ((x * 3 + y) % 2 === 0)) g[y * T + x] = tom(c, 28);
      }
    }
  } else if (material === 'ferro') {
    // rebites cinza-escuros
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const c = g[y * T + x];
        if (c && (x * 5 + y * 3) % 11 === 0) g[y * T + x] = tom(c, -45);
      }
    }
  }
}

// --- Espada de madeira (diagonal, cabo embaixo à esquerda) ---
function espadaMadeira(g) {
  const lamina = [196, 154, 92];
  const cabo = [96, 62, 34];
  const guarda = [128, 88, 48];
  for (let i = 0; i < 9; i++) {
    const x = 6 + i;
    const y = 9 - i;
    ponto(g, x, y, tom(lamina, 20));                 // lado de cima (mais claro)
    ponto(g, x - 1, y, tom(lamina, -8));
    ponto(g, x, y + 1, tom(lamina, -30));            // lado de baixo (sombra)
  }
  ponto(g, 14, 1, tom(lamina, 40));                  // ponta
  // guarda (barra atravessada)
  for (let i = -2; i <= 2; i++) ponto(g, 5 + i, 10 + i, guarda);
  ponto(g, 4, 9, tom(guarda, 20)); ponto(g, 6, 11, tom(guarda, -20));
  // cabo
  ponto(g, 4, 11, cabo); ponto(g, 3, 12, tom(cabo, 10)); ponto(g, 3, 13, cabo);
  ponto(g, 2, 13, tom(cabo, -20)); ponto(g, 2, 14, tom(cabo, -30));
}

// --- Capa ---
const COR_CAPA = {
  capa_vermelha: [196, 36, 44],
  capa_azul: [46, 84, 200],
};

function capa(g, cor) {
  // Ombros estreitos em cima, abrindo para baixo (trapézio)
  preencher(g, (x, y) => {
    if (y < 2 || y > 13) return false;
    const meia = 3 + Math.floor((y - 2) / 3);
    return x >= 8 - meia && x <= 7 + meia;
  }, cor);
  // dobras (colunas mais escuras / claras)
  for (let y = 4; y <= 13; y++) {
    ponto(g, 5, y, tom(cor, -26));
    ponto(g, 8, y, tom(cor, 18));
    ponto(g, 11, y, tom(cor, -26));
  }
  // barra de baixo irregular
  retangulo(g, 2, 13, 13, 13, tom(cor, -40));
  // gola e fecho dourado
  retangulo(g, 5, 2, 10, 2, tom(cor, -50));
  ponto(g, 7, 3, [244, 206, 70]); ponto(g, 8, 3, [244, 206, 70]);
}

// --- Interrogação (item desconhecido) ---
function interrogacao(g) {
  retangulo(g, 1, 1, 14, 14, [120, 120, 126]);
  for (let i = 1; i <= 14; i++) {              // moldura
    ponto(g, i, 1, [168, 168, 174]); ponto(g, 1, i, [168, 168, 174]);
    ponto(g, i, 14, [82, 82, 88]); ponto(g, 14, i, [82, 82, 88]);
  }
  const forma = [
    '.XXX.',
    'X...X',
    '....X',
    '...X.',
    '..X..',
    '.....',
    '..X..',
  ];
  forma.forEach((linha, j) => {
    for (let i = 0; i < linha.length; i++) {
      if (linha[i] === 'X') ponto(g, 5 + i, 4 + j, [250, 250, 250]);
    }
  });
}

// --- Gema facetada (cristais de poder) ---
function gema(g, cor) {
  // Formato: coroa larga em cima e ponta embaixo (linhas y = 3 a 13)
  const meia = (y) => (y <= 5 ? 3 + (y - 3) : y === 6 ? 6 : Math.max(0, 6 - (y - 6) * 0.9));
  const dentro = (x, y) => y >= 3 && y <= 13 && Math.abs(x - 7.5) <= meia(y) - 0.5 + (y === 3 ? 0 : 0.5);
  for (let y = 3; y <= 13; y++) {
    for (let x = 0; x < T; x++) {
      if (!dentro(x, y)) continue;
      let c;
      if (y <= 5) c = x < 8 ? tom(cor, 55) : tom(cor, 20);        // coroa: clara
      else if (x <= 5) c = cor;                                    // faceta esquerda: média
      else if (x >= 10) c = tom(cor, -70);                         // faceta direita: escura
      else c = x < 8 ? tom(cor, 12) : tom(cor, -30);               // faceta do meio
      ponto(g, x, y, c);
    }
  }
  // linha que separa a coroa das facetas de baixo
  for (let x = 0; x < T; x++) if (dentro(x, 6)) ponto(g, x, 6, tom(cor, -25));
  // brilhos brancos
  ponto(g, 6, 4, [255, 255, 255]); ponto(g, 5, 5, [255, 255, 255]);
  ponto(g, 4, 7, tom(cor, 110));
  ponto(g, 12, 2, [255, 255, 255]); ponto(g, 11, 1, tom(cor, 120)); ponto(g, 13, 1, tom(cor, 120)); // cintilar
  ponto(g, 12, 0, tom(cor, 120)); ponto(g, 12, 1, tom(cor, 120));
}

// --- Fase 6: graveto, carvão, tocha e porta ---
function graveto(g) {
  const madeira = [136, 96, 52];
  for (let i = 0; i < 11; i++) {
    ponto(g, 2 + i, 13 - i, tom(madeira, 16));
    ponto(g, 3 + i, 13 - i, tom(madeira, -20));
  }
  ponto(g, 8, 6, tom(madeira, 30)); ponto(g, 9, 8, tom(madeira, -30)); // nós da madeira
  ponto(g, 12, 2, tom(madeira, 34)); // ponta clara
}

function carvaoIcone(g) {
  const preto = [34, 34, 38];
  const forma = [
    '....XXXX....',
    '..XXXXXXXX..',
    '.XXXXXXXXXX.',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    '.XXXXXXXXXX.',
    '..XXXXXXXX..',
  ];
  forma.forEach((linha, j) => {
    for (let i = 0; i < linha.length; i++) {
      if (linha[i] !== 'X') continue;
      const d = (i + j) % 3 === 0 ? 8 : 0;
      ponto(g, 2 + i, 4 + j, tom(preto, d - (j > 4 ? 10 : 0)));
    }
  });
  // brilho cinza
  ponto(g, 5, 5, [150, 150, 160]); ponto(g, 6, 5, [112, 112, 122]); ponto(g, 5, 6, [112, 112, 122]);
  ponto(g, 9, 7, [86, 86, 96]);
}

function tochaIcone(g) {
  const madeira = [128, 90, 48];
  for (let y = 7; y <= 14; y++) {
    ponto(g, 7, y, tom(madeira, 14));
    ponto(g, 8, y, tom(madeira, -20));
  }
  retangulo(g, 7, 5, 8, 6, [180, 84, 20]);
  ponto(g, 7, 4, [255, 170, 40]); ponto(g, 8, 4, [240, 130, 28]);
  ponto(g, 6, 5, [255, 150, 36]); ponto(g, 9, 5, [240, 120, 26]);
  ponto(g, 7, 3, [255, 226, 90]); ponto(g, 8, 3, [255, 190, 50]);
  ponto(g, 7, 2, [255, 245, 170]);
}

function portaIcone(g) {
  const madeira = [150, 106, 56];
  const moldura = [100, 66, 32];
  retangulo(g, 4, 1, 11, 14, madeira);
  retangulo(g, 4, 1, 11, 1, moldura); retangulo(g, 4, 14, 11, 14, moldura);
  retangulo(g, 4, 1, 4, 14, moldura); retangulo(g, 11, 1, 11, 14, moldura);
  // janelinhas
  retangulo(g, 5, 3, 6, 5, [150, 210, 240]); retangulo(g, 9, 3, 10, 5, [150, 210, 240]);
  ponto(g, 5, 3, [235, 248, 255]); ponto(g, 9, 3, [235, 248, 255]);
  // painel de baixo e maçaneta
  retangulo(g, 6, 8, 9, 12, tom(madeira, -16));
  retangulo(g, 5, 7, 10, 7, tom(madeira, -30));
  ponto(g, 10, 9, [40, 40, 46]); ponto(g, 10, 10, [60, 60, 66]);
}

// Itens de bloco que usam um ícone próprio em vez do cubinho
const ICONES_ESPECIAIS = new Set(['porta', 'tocha']);

/** Desenha o ícone de um item que não é bloco (item pode ser undefined) */
function desenharIconeItem(item) {
  const g = novaGrade();
  if (item && item.nome === 'graveto') {
    graveto(g);
    contornar(g);
  } else if (item && item.nome === 'carvao') {
    carvaoIcone(g);
    contornar(g);
  } else if (item && item.nome === 'tocha') {
    tochaIcone(g);
    contornar(g);
  } else if (item && item.nome === 'porta') {
    portaIcone(g);
    contornar(g);
  } else if (item && item.tipo === 'poder' && item.cor) {
    gema(g, corHex(item.cor));
    contornar(g);
  } else if (item && item.tipo === 'roupa' && ROUPA_ICONE[item.visual]) {
    ROUPA_ICONE[item.visual](g);
    contornar(g);
  } else if (item && item.tipo === 'armadura') {
    pecaArmadura(g, item.parte, item.material);
    contornar(g);
  } else if (item && item.tipo === 'arma' && item.visual === 'espada_madeira') {
    espadaMadeira(g);
    contornar(g);
  } else if (item && item.tipo === 'acessorio' && COR_CAPA[item.visual]) {
    capa(g, COR_CAPA[item.visual]);
    contornar(g);
  } else {
    interrogacao(g);
  }
  return grade48(g);
}

// ---------------------------------------------------------------------
// Ícone de bloco: topo + face esquerda + face direita (48x48)
// ---------------------------------------------------------------------
function desenharIcone(texTopo, texLado) {
  const tam = 48;
  const canvas = novoCanvas(tam);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (!texTopo || !texLado) return null;

  const a = 22 / T; // deslocamento horizontal por pixel de textura
  const b = 11 / T; // deslocamento vertical por pixel de textura
  const h = 22 / T; // altura por pixel de textura

  // Desenha uma face com a transformação (a, b, c, d, e, f) e escurece por cima
  const face = (tex, m, escuro) => {
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tex, 0, 0);
    if (escuro > 0) {
      ctx.globalCompositeOperation = 'source-atop'; // só escurece o que já foi desenhado
      ctx.fillStyle = `rgba(0,0,0,${escuro})`;
      ctx.fillRect(0, 0, T, T);
    }
    ctx.restore();
  };

  face(texTopo, [a, b, -a, b, 24, 2], 0);        // topo (losango)
  face(texLado, [a, b, 0, h, 2, 13], 0.22);      // lado esquerdo
  face(texLado, [a, -b, 0, h, 24, 24], 0.42);    // lado direito
  return canvas.toDataURL('image/png');
}
