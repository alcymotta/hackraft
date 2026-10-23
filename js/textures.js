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
};

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

  return {
    array,
    indice,
    atlasCanvas,
    canvasDaTextura,
    iconeBloco,
    rachaduras: criarRachaduras(),
  };
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
