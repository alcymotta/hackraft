// =====================================================================
// Hackraft - Ruído com semente
// ---------------------------------------------------------------------
// "Ruído" aqui é uma função que devolve números aleatórios, mas SUAVES:
// pontos vizinhos dão valores parecidos. É isso que cria morros, vales
// e cavernas com formato natural.
//
// Tudo depende só da SEMENTE: a mesma semente dá sempre o mesmo mundo.
// Isso é essencial para o multiplayer (cada computador gera o mesmo
// terreno sozinho, sem precisar mandar o mapa pela rede).
// Por isso NUNCA usamos Math.random neste arquivo.
//
// Exporta:
//   sementeParaNumero(semente)  → inteiro de 32 bits (aceita número ou texto)
//   criarRuido(semente)         → { ruido2D, ruido3D, fbm2D }
//   hash2D(semente, x, z)       → número em [0, 1), sempre igual para os mesmos dados
//   hash3D(semente, x, y, z)    → idem, com 3 coordenadas
// =====================================================================

/**
 * Transforma a semente (número ou texto) num inteiro de 32 bits.
 * Um texto só com dígitos ("12345") vale o mesmo que o número 12345.
 */
export function sementeParaNumero(semente) {
  if (typeof semente === 'number' && Number.isFinite(semente)) {
    if (Number.isInteger(semente)) return semente | 0;
    // Número com vírgula: mistura a parte inteira com a fracionária
    return misturar32((semente | 0) ^ Math.imul(Math.floor((semente % 1) * 1e9), 0x9e3779b1));
  }
  const texto = String(semente ?? '');
  if (/^-?\d+$/.test(texto)) return Number(texto) | 0;
  // FNV-1a: um jeito clássico de transformar texto em número
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return misturar32(h);
}

/** "Bagunça" bem os bits de um inteiro (finalizador do MurmurHash3). */
function misturar32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

/**
 * Número "aleatório" em [0, 1) que depende só de (semente, x, z).
 * x e z devem ser inteiros (coordenadas de bloco). Usado para decidir,
 * por exemplo, onde nasce cada árvore.
 */
export function hash2D(semente, x, z) {
  let h = (semente | 0) ^ Math.imul(x | 0, 0x27d4eb2d);
  h = misturar32(h);
  h ^= Math.imul(z | 0, 0x165667b1);
  h = misturar32(h);
  return (h >>> 0) / 4294967296;
}

/** Igual ao hash2D, mas com 3 coordenadas inteiras. */
export function hash3D(semente, x, y, z) {
  let h = (semente | 0) ^ Math.imul(x | 0, 0x27d4eb2d);
  h = misturar32(h);
  h ^= Math.imul(y | 0, 0x9e3779b1);
  h = misturar32(h);
  h ^= Math.imul(z | 0, 0x165667b1);
  h = misturar32(h);
  return (h >>> 0) / 4294967296;
}

/** Gerador de números pseudoaleatórios simples (mulberry32), só para embaralhar a tabela. */
function criarSorteador(semente) {
  let a = semente | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Constantes do ruído Simplex (algoritmo de Ken Perlin, versão de Stefan Gustavson) ---
// O simplex divide o espaço em triângulos (2D) ou tetraedros (3D) e soma a
// contribuição de cada canto. Cada canto recebe uma "direção" (gradiente)
// sorteada pela tabela de permutação, que depende da semente.
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// 12 direções (as arestas de um cubo)
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

/**
 * Cria um gerador de ruído com a semente dada.
 * Devolve funções com valores aproximadamente entre -1 e 1.
 */
export function criarRuido(semente) {
  const sorteia = criarSorteador(sementeParaNumero(semente));

  // Tabela de permutação: os números 0..255 embaralhados (de acordo com a semente),
  // repetidos duas vezes para não precisar fazer "& 255" em todo lugar.
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(sorteia() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const perm12 = new Uint8Array(512); // perm % 12, já multiplicado por 3 (índice em GRAD3)
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    perm12[i] = (perm[i] % 12) * 3;
  }

  /** Ruído simplex 2D: valor ~[-1, 1] */
  function ruido2D(xin, yin) {
    // Descobre em qual triângulo o ponto está (inclinando a grade)
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    // Soma a contribuição dos 3 cantos (cada uma some com a distância)
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = perm12[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = perm12[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = perm12[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2);
    }
    return 70 * n; // fator que leva o resultado para ~[-1, 1]
  }

  /** Ruído simplex 3D: valor ~[-1, 1] */
  function ruido3D(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    // Descobre em qual dos 6 tetraedros do cubo o ponto está
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;

    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = perm12[ii + perm[jj + perm[kk]]];
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = perm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = perm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = perm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      t3 *= t3;
      n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
    }
    return 32 * n;
  }

  /**
   * fBm ("movimento browniano fracionário"): soma várias camadas de ruído.
   * A 1ª camada faz as formas grandes; cada camada seguinte tem detalhes
   * menores (frequência × lacunaridade) e mais fracos (força × persistência).
   * O resultado é dividido pela soma das forças, então continua ~[-1, 1].
   */
  function fbm2D(x, y, oitavas = 4, persistencia = 0.5, lacunaridade = 2) {
    let soma = 0;
    let forca = 1;
    let freq = 1;
    let total = 0;
    for (let o = 0; o < oitavas; o++) {
      // O deslocamento (o * 31.7) evita que todas as camadas tenham um "0" no mesmo ponto
      soma += forca * ruido2D(x * freq + o * 31.7, y * freq - o * 17.3);
      total += forca;
      forca *= persistencia;
      freq *= lacunaridade;
    }
    return soma / total;
  }

  return { ruido2D, ruido3D, fbm2D };
}
