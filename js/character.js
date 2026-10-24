// =====================================================================
// Hackraft - Personagem de blocos (estilo Minecraft)
// ---------------------------------------------------------------------
// Partes: cabeça 8x8x8, corpo 8x12x4, braços e pernas 4x12x4 (em "pixels
// de skin"). 1 pixel = 1.8/32 bloco, então o boneco tem 1.8 de altura.
// A skin é um canvas 64x64 no layout de skin do Minecraft (formato novo).
// A frente do personagem olha para -Z quando rotation.y = 0.
// =====================================================================

import * as THREE from 'three';

const ESCALA = 1.8 / 32; // tamanho de 1 pixel de skin, em blocos
const DURACAO_GOLPE = 0.25; // segundos do balanço do braço ao golpear

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
function mapearUV(geo, caixa) {
  const r = regioes(caixa.x, caixa.y, caixa.w, caixa.h, caixa.d);
  // [região, girar180]: topo e baixo precisam girar 180° no layout do Minecraft
  const faces = [
    [r.direita, false], [r.esquerda, false],
    [r.topo, true], [r.baixo, true],
    [r.tras, false], [r.frente, false],
  ];
  const uv = geo.attributes.uv;
  faces.forEach(([reg, girar], i) => {
    const u0 = reg[0] / 64;
    const u1 = (reg[0] + reg[2]) / 64;
    const vCima = 1 - reg[1] / 64;
    const vBaixo = 1 - (reg[1] + reg[3]) / 64;
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
// Classe Personagem
// ---------------------------------------------------------------------
export class Personagem {
  constructor(cores = {}) {
    this.cores = { ...CORES_PADRAO, ...cores };

    // Skin 64x64
    this.skinCanvas = document.createElement('canvas');
    this.skinCanvas.width = 64;
    this.skinCanvas.height = 64;
    desenharSkin(this.skinCanvas, this.cores);

    this.textura = new THREE.CanvasTexture(this.skinCanvas);
    this.textura.magFilter = THREE.NearestFilter;
    this.textura.minFilter = THREE.NearestFilter;
    this.textura.generateMipmaps = false;
    this.textura.colorSpace = THREE.SRGBColorSpace;

    // Um só material, compartilhado por todas as partes
    this.material = new THREE.MeshLambertMaterial({ map: this.textura, transparent: false });

    this.geometrias = [];
    this.grupo = new THREE.Group();

    // Cria uma parte (caixa) com as UVs da skin; o centro fica em (0, -altura/2) do pivô
    const criarParte = (caixa, deslocY) => {
      const geo = new THREE.BoxGeometry(caixa.w * ESCALA, caixa.h * ESCALA, caixa.d * ESCALA);
      mapearUV(geo, caixa);
      this.geometrias.push(geo);
      const malha = new THREE.Mesh(geo, this.material);
      malha.position.y = deslocY * ESCALA;
      return malha;
    };

    // Corpo (fixo): de 12 a 24 px de altura
    this.corpo = criarParte(CAIXAS.corpo, 18);
    this.grupo.add(this.corpo);

    // Cabeça: pivô no pescoço (24 px)
    this.pivoCabeca = new THREE.Group();
    this.pivoCabeca.position.set(0, 24 * ESCALA, 0);
    this.pivoCabeca.add(criarParte(CAIXAS.cabeca, 4));
    this.grupo.add(this.pivoCabeca);

    // Braços: pivôs nos ombros (24 px). O braço direito fica em +X.
    this.pivoBracoD = new THREE.Group();
    this.pivoBracoD.position.set(6 * ESCALA, 24 * ESCALA, 0);
    this.pivoBracoD.add(criarParte(CAIXAS.bracoD, -6));
    this.pivoBracoE = new THREE.Group();
    this.pivoBracoE.position.set(-6 * ESCALA, 24 * ESCALA, 0);
    this.pivoBracoE.add(criarParte(CAIXAS.bracoE, -6));
    this.grupo.add(this.pivoBracoD, this.pivoBracoE);

    // Pernas: pivôs no quadril (12 px)
    this.pivoPernaD = new THREE.Group();
    this.pivoPernaD.position.set(2 * ESCALA, 12 * ESCALA, 0);
    this.pivoPernaD.add(criarParte(CAIXAS.pernaD, -6));
    this.pivoPernaE = new THREE.Group();
    this.pivoPernaE.position.set(-2 * ESCALA, 12 * ESCALA, 0);
    this.pivoPernaE.add(criarParte(CAIXAS.pernaE, -6));
    this.grupo.add(this.pivoPernaD, this.pivoPernaE);

    // Estado da animação
    this._fase = 0;       // avança com a distância percorrida
    this._amplitude = 0;  // amplitude atual do balanço (suavizada)
    this._tempo = 0;      // para a respiração
    this._abertura = 0;   // quanto as pernas estão abertas (no ar)
    this._golpe = -1;     // tempo do golpe em andamento (-1 = sem golpe)
  }

  /** Balanço rápido do braço direito para a frente e de volta (~0.25 s) */
  animarGolpe() {
    this._golpe = 0;
  }

  /**
   * Anima braços e pernas.
   * velHorizontal: velocidade horizontal em blocos/s; noAr: true se estiver pulando/caindo.
   */
  animar(dt, velHorizontal, noAr) {
    this._tempo += dt;
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
  }

  /** Inclina a cabeça: pitch positivo = olhar para cima (limite de ±1.2 rad) */
  definirOlhar(pitch) {
    this.pivoCabeca.rotation.x = Math.max(-1.2, Math.min(1.2, pitch));
  }

  /** Muda as cores e redesenha a skin */
  definirCores(cores) {
    this.cores = { ...this.cores, ...cores };
    desenharSkin(this.skinCanvas, this.cores);
    this.textura.needsUpdate = true;
  }

  /** Libera a memória da GPU */
  dispose() {
    this.geometrias.forEach((g) => g.dispose());
    this.material.dispose();
    this.textura.dispose();
  }
}
