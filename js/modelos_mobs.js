// =====================================================================
// Hackraft - Modelos dos mobs (bonecos de caixas com skin pixelada)
// ---------------------------------------------------------------------
// Cada mob é montado com caixas (BoxGeometry) e uma textura desenhada por
// código num canvas pequeno (cada pixel do canvas = 1 "pixel" do modelo),
// no mesmo estilo do personagem. A frente do mob olha para -Z.
//
// Uso (veja o contrato no CONTRATOS.md):
//   const m = criarModeloMob('porco');
//   scene.add(m.grupo);
//   m.animar(dt, velocidadeHorizontal, { atacando, voando, nadando });
//   m.piscarDano();  m.morrer(0..1);  m.definirLuz(0..1);  m.definirVida(0..1);
//   m.dispose();
//
// REGISTRO: MODELOS[tipo] = definição do mob. Para a Fase 8 acrescentar
// esqueleto, orcs, dragão e hidra, basta chamar registrarModelo('dragao', {...}).
// Uma definição tem: esc, altura, raio, meiaLargura, partes, pintar, construir.
// =====================================================================

import * as THREE from 'three';

// Quanto tempo o modelo fica vermelho depois de apanhar (segundos)
const TEMPO_PISCAR = 0.3;
// Quanto tempo a barra de vida fica visível depois de cada chamada (segundos)
const TEMPO_BARRA = 3;

// ---------------------------------------------------------------------
// Utilidades de desenho
// ---------------------------------------------------------------------
// Gerador pseudoaleatório de semente fixa (a skin sai sempre igual)
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

const lim = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
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
const limitar = (v, a, b) => (v < a ? a : v > b ? b : v);

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

/**
 * Ajusta as UVs de uma BoxGeometry para as regiões da skin.
 * Ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z.
 * Com a frente em -Z: +x = direita, -x = esquerda, +z = trás, -z = frente.
 */
function mapearUV(geo, caixa, tw, th) {
  const r = regioes(caixa.x, caixa.y, caixa.w, caixa.h, caixa.d);
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
    const pts = girar
      ? [[u1, vBaixo], [u0, vBaixo], [u1, vCima], [u0, vCima]]
      : [[u0, vCima], [u1, vCima], [u0, vBaixo], [u1, vBaixo]];
    for (let k = 0; k < 4; k++) uv.setXY(i * 4 + k, pts[k][0], pts[k][1]);
  });
  uv.needsUpdate = true;
}

/**
 * Arruma as caixas de um mob dentro de um canvas (prateleiras, da esquerda
 * para a direita). Cada parte é [w, h, d] ou [w, h, d, x, y] (posição fixa).
 * Devolve { tw, th, caixas, regs }.
 */
function empacotar(partes, largura = 64) {
  const caixas = {};
  let x = 0, y = 0, alturaLinha = 0, altTotal = 0;
  for (const nome of Object.keys(partes)) {
    const [w, h, d, fx, fy] = partes[nome];
    const cw = 2 * d + 2 * w; // largura que a caixa ocupa no layout
    const ch = d + h;
    if (fx !== undefined) {
      caixas[nome] = { x: fx, y: fy, w, h, d };
      altTotal = Math.max(altTotal, fy + ch);
      continue;
    }
    if (x + cw > largura) { x = 0; y += alturaLinha; alturaLinha = 0; }
    caixas[nome] = { x, y, w, h, d };
    x += cw;
    alturaLinha = Math.max(alturaLinha, ch);
    altTotal = Math.max(altTotal, y + alturaLinha);
  }
  const regs = {};
  for (const nome of Object.keys(caixas)) {
    const c = caixas[nome];
    regs[nome] = regioes(c.x, c.y, c.w, c.h, c.d);
  }
  return { tw: largura, th: Math.max(8, altTotal), caixas, regs };
}

/** Pincel para desenhar a skin (cores em "#rrggbb"; regiões [x, y, w, h]) */
function criarPincel(canvas, semente) {
  const ctx = canvas.getContext('2d');
  const rnd = mulberry32(semente);
  const p = { rnd };
  p.pix = (reg, i, j, cor) => { ctx.fillStyle = cor; ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1); };
  p.ret = (reg, i, j, w, h, cor) => { ctx.fillStyle = cor; ctx.fillRect(reg[0] + i, reg[1] + j, w, h); };
  // Preenche com variação de tom em cada pixel (parece "pelo" ou textura)
  p.enche = (reg, cor, v = 8, j0 = 0, j1 = reg[3] - 1, i0 = 0, i1 = reg[2] - 1) => {
    const c = hexRGB(cor);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = (rnd() - 0.5) * 2 * v;
        ctx.fillStyle = `rgb(${lim(c[0] + k)},${lim(c[1] + k)},${lim(c[2] + k)})`;
        ctx.fillRect(reg[0] + i, reg[1] + j, 1, 1);
      }
    }
  };
  // Linha inteira mais clara (delta > 0) ou mais escura (delta < 0)
  p.sombra = (reg, j, delta) => {
    ctx.fillStyle = `rgba(${delta < 0 ? '0,0,0' : '255,255,255'},${Math.abs(delta) / 100})`;
    ctx.fillRect(reg[0], reg[1] + j, reg[2], 1);
  };
  // Pontinhos soltos em posições sorteadas (determinísticas)
  p.pontos = (reg, n, cor) => {
    for (let k = 0; k < n; k++) p.pix(reg, Math.floor(rnd() * reg[2]), Math.floor(rnd() * reg[3]), cor);
  };
  p.todas = (r) => [r.topo, r.baixo, r.direita, r.frente, r.esquerda, r.tras];
  p.lados = (r) => [r.direita, r.frente, r.esquerda, r.tras];
  return p;
}

// ---------------------------------------------------------------------
// Recursos compartilhados por tipo (textura e geometrias, criados 1 vez)
// ---------------------------------------------------------------------
const recursos = new Map();

function recursosDe(tipo) {
  let r = recursos.get(tipo);
  if (r) return r;
  const def = MODELOS[tipo];
  const emp = empacotar(def.partes);
  const canvas = criarCanvas(emp.tw, emp.th);
  def.pintar(criarPincel(canvas, def.semente || 1234), emp.regs);
  const textura = new THREE.CanvasTexture(canvas);
  textura.magFilter = THREE.NearestFilter;
  textura.minFilter = THREE.NearestFilter;
  textura.generateMipmaps = false;
  textura.colorSpace = THREE.SRGBColorSpace;
  r = { def, canvas, textura, tw: emp.tw, th: emp.th, caixas: emp.caixas, geos: {} };
  recursos.set(tipo, r);
  return r;
}

// Caixa unitária para peças só de cor (olhos brilhantes etc.)
const GEO_CUBO = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------------
// Barra de vida (sprite com canvas)
// ---------------------------------------------------------------------
const BARRA_W = 34, BARRA_H = 6;

// ---------------------------------------------------------------------
// ModeloMob: o objeto devolvido por criarModeloMob
// ---------------------------------------------------------------------
class ModeloMob {
  constructor(tipo, def, rec) {
    this.tipo = tipo;
    this._def = def;
    this._rec = rec;
    this._esc = def.esc;
    this.altura = def.altura;
    this.raio = def.raio;

    // grupo = o que o mobs.js move e gira; raiz = o corpo (é ela que tomba)
    this.grupo = new THREE.Group();
    this.raiz = new THREE.Group();
    this.grupo.add(this.raiz);

    // Materiais da instância (a textura é compartilhada)
    this.material = new THREE.MeshLambertMaterial({ map: rec.textura, emissive: 0x000000 });
    this._materiais = [this.material]; // recebem luz, vermelho e transparência
    this._basicos = [];                // brilham sempre (olhos); só ganham transparência

    // Estado da animação
    this.fase = 0;      // fase do passo (radianos)
    this.tempo = 0;     // relógio geral do modelo
    this.amp = 0;       // amplitude do passo (0 parado .. 1 andando)
    this._flash = 0;    // tempo restante do vermelho de dano
    this._vermMorte = 0;
    this._morte = 0;
    this._luz = 1;
    this._tBarra = 0;
    this._barra = null;

    this._anima = def.construir(this);
  }

  // --- construção -----------------------------------------------------
  /** Grupo vazio usado como pivô (articulação). Posição em pixels do modelo. */
  pivo(pai, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x * this._esc, y * this._esc, z * this._esc);
    pai.add(g);
    return g;
  }

  /** Caixa texturizada da parte `nome` (posição do centro em pixels, relativa ao pai) */
  parte(nome, pai, x, y, z) {
    const rec = this._rec;
    let geo = rec.geos[nome];
    if (!geo) {
      const c = rec.caixas[nome];
      geo = new THREE.BoxGeometry(c.w * this._esc, c.h * this._esc, c.d * this._esc);
      mapearUV(geo, c, rec.tw, rec.th);
      rec.geos[nome] = geo;
    }
    const m = new THREE.Mesh(geo, this.material);
    m.position.set(x * this._esc, y * this._esc, z * this._esc);
    pai.add(m);
    return m;
  }

  /** Caixa só de cor que não depende da luz (olhos brilhantes). Medidas em pixels. */
  caixaBrilho(pai, cor, w, h, d, x, y, z) {
    const mat = new THREE.MeshBasicMaterial({ color: cor });
    this._basicos.push(mat);
    const m = new THREE.Mesh(GEO_CUBO, mat);
    m.scale.set(w * this._esc, h * this._esc, d * this._esc);
    m.position.set(x * this._esc, y * this._esc, z * this._esc);
    pai.add(m);
    return m;
  }

  // --- animação -------------------------------------------------------
  /** Avança a animação. vel = velocidade horizontal (blocos/s). */
  animar(dt, vel = 0, estado = null) {
    this.tempo += dt;
    // Se está morto, só o pisca/barra continuam (o corpo fica como está)
    if (this._morte <= 0) {
      const alvo = limitar(vel / 1.2, 0, 1);
      this.amp += (alvo - this.amp) * Math.min(1, dt * 10);
      this.fase += dt * vel * this._def.passo;
      this._anima(dt, vel, estado || ESTADO_VAZIO);
    }
    // Vermelho de dano
    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt);
      this._aplicarVermelho();
    }
    // Barra de vida: some depois de alguns segundos
    if (this._barra && this._tBarra > 0) {
      this._tBarra -= dt;
      if (this._tBarra <= 0) this._barra.visible = false;
    }
  }

  _aplicarVermelho() {
    const f = Math.max(this._flash > 0 ? 0.85 * (this._flash / TEMPO_PISCAR) : 0, this._vermMorte);
    this.material.emissive.setRGB(f, 0, 0);
  }

  /** Deixa o modelo avermelhado por 0.3 s */
  piscarDano() {
    this._flash = TEMPO_PISCAR;
    this._aplicarVermelho();
  }

  /** t de 0 a 1: tomba de lado, fica vermelho e no fim fica transparente. t = 0 desfaz. */
  morrer(t) {
    t = limitar(t, 0, 1);
    this._morte = t;
    const tomba = Math.min(1, t / 0.5);          // tomba na primeira metade
    const ang = (Math.PI / 2) * (1 - (1 - tomba) * (1 - tomba)); // começa rápido, termina devagar
    this.raiz.rotation.z = ang;
    // Ao tombar sobre o lado, sobe um pouco para não afundar no chão
    this.raiz.position.y = Math.sin(ang) * this._def.meiaLargura;
    this._vermMorte = Math.min(0.7, t * 3);
    this._flash = 0;
    this._aplicarVermelho();
    // Transparente no final (últimos 30%)
    const op = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    const transp = op < 1;
    for (const m of this._materiais) { m.transparent = transp; m.opacity = op; }
    for (const m of this._basicos) { m.transparent = transp; m.opacity = op; }
    if (this._barra) this._barra.material.opacity = op;
  }

  /** Escurece o modelo conforme a luz do lugar (0 = escuro, 1 = claro) */
  definirLuz(v) {
    this._luz = limitar(v, 0, 1);
    const k = 0.35 + 0.65 * this._luz;
    for (const m of this._materiais) m.color.setScalar(k);
  }

  /** Barra de vida acima do modelo: aparece por 3 s e some quando a vida está cheia */
  definirVida(frac) {
    frac = limitar(frac, 0, 1);
    if (frac >= 1) {
      if (this._barra) this._barra.visible = false;
      this._tBarra = 0;
      return;
    }
    if (!this._barra) this._criarBarra();
    const ctx = this._barraCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, BARRA_W, BARRA_H);
    ctx.fillStyle = '#3a1010';
    ctx.fillRect(1, 1, BARRA_W - 2, BARRA_H - 2);
    // verde -> amarelo -> vermelho conforme a vida
    ctx.fillStyle = frac > 0.6 ? '#3fd04a' : frac > 0.3 ? '#e8d030' : '#e03030';
    ctx.fillRect(1, 1, Math.max(0, Math.round((BARRA_W - 2) * frac)), BARRA_H - 2);
    this._barraTex.needsUpdate = true;
    this._barra.visible = true;
    this._tBarra = TEMPO_BARRA;
  }

  _criarBarra() {
    const canvas = criarCanvas(BARRA_W, BARRA_H);
    this._barraCtx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._barraTex = tex;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false });
    this._barra = new THREE.Sprite(mat);
    const larg = Math.max(0.6, this.altura * 0.8);
    this._barra.scale.set(larg, larg * BARRA_H / BARRA_W, 1);
    this._barra.position.y = this.altura + 0.3;
    this._barra.visible = false;
    this.grupo.add(this._barra);
  }

  /** Libera o que é só desta instância (a textura e as geometrias ficam no cache) */
  dispose() {
    for (const m of this._materiais) m.dispose();
    for (const m of this._basicos) m.dispose();
    if (this._barra) {
      this._barra.material.dispose();
      this._barraTex.dispose();
      this.grupo.remove(this._barra);
      this._barra = null;
    }
    if (this.grupo.parent) this.grupo.parent.remove(this.grupo);
  }
}

const ESTADO_VAZIO = { atacando: false, voando: false, nadando: false };

// =====================================================================
// MODELOS: um registro, um mob por entrada
// =====================================================================
export const MODELOS = {};

/** Registra um tipo novo (a Fase 8 usa isto para esqueleto, orcs, dragão, hidra...) */
export function registrarModelo(tipo, def) {
  MODELOS[tipo] = def;
  const antigo = recursos.get(tipo);
  if (antigo) { antigo.textura.dispose(); for (const g of Object.values(antigo.geos)) g.dispose(); recursos.delete(tipo); }
}

// ---------------------------------------------------------------------
// PORCO (1 pixel = 1/16 de bloco)
// ---------------------------------------------------------------------
registrarModelo('porco', {
  esc: 1 / 16, altura: 0.9, raio: 0.4, meiaLargura: 0.31, passo: 3.4, semente: 71,
  partes: {
    corpo: [10, 8, 14], cabeca: [8, 8, 8], focinho: [4, 3, 2], pata: [4, 6, 4],
    orelha: [2, 2, 1], rabo1: [1, 1, 2], rabo2: [1, 2, 1],
  },
  pintar(p, r) {
    const ROSA = '#f0a4ac', ROSA2 = '#e68e9a', CASCO = '#b86c7a';
    // corpo: rosa com barriga mais escura e algumas manchas
    p.todas(r.corpo).forEach((g) => p.enche(g, ROSA, 7));
    p.enche(r.corpo.baixo, '#d88a94', 5);
    p.lados(r.corpo).forEach((g) => { p.sombra(g, g[3] - 1, -12); p.sombra(g, g[3] - 2, -6); p.pontos(g, 3, '#e2909a'); });
    // cabeça
    p.todas(r.cabeca).forEach((g) => p.enche(g, ROSA, 6));
    const f = r.cabeca.frente;
    p.pix(f, 2, 3, '#ffffff'); p.pix(f, 5, 3, '#ffffff');       // brancos dos olhos
    p.pix(f, 1, 3, '#2a1a22'); p.pix(f, 6, 3, '#2a1a22');       // pupilas
    p.sombra(f, 7, -10);
    // focinho (mais escuro, com duas narinas na frente)
    p.todas(r.focinho).forEach((g) => p.enche(g, ROSA2, 5));
    p.pix(r.focinho.frente, 1, 1, '#8a3a48'); p.pix(r.focinho.frente, 2, 1, '#8a3a48');
    p.sombra(r.focinho.frente, 2, -8);
    // patas com casco escuro embaixo
    p.todas(r.pata).forEach((g) => p.enche(g, ROSA, 6));
    p.lados(r.pata).forEach((g) => { p.ret(g, 0, 5, g[2], 1, CASCO); p.sombra(g, 4, -8); });
    p.enche(r.pata.baixo, CASCO, 4);
    p.todas(r.orelha).forEach((g) => p.enche(g, ROSA2, 5));
    p.todas(r.rabo1).forEach((g) => p.enche(g, ROSA2, 4));
    p.todas(r.rabo2).forEach((g) => p.enche(g, ROSA2, 4));
  },
  construir(m) {
    const raiz = m.raiz;
    m.parte('corpo', raiz, 0, 10, 0);
    // cabeça (grupo para dar uma leve balançada ao andar)
    const cab = m.pivo(raiz, 0, 0, 0);
    m.parte('cabeca', cab, 0, 10.5, -10);
    m.parte('focinho', cab, 0, 9, -15);
    const oE = m.parte('orelha', cab, -3, 15.2, -8.5); oE.rotation.z = 0.35;
    const oD = m.parte('orelha', cab, 3, 15.2, -8.5); oD.rotation.z = -0.35;
    // rabinho enrolado (duas peças)
    const rabo = m.pivo(raiz, 0, 12, 7);
    m.parte('rabo1', rabo, 0, 0, 1);
    m.parte('rabo2', rabo, 0, 1, 2.5);
    // 4 patas com pivô no alto (andam em diagonal)
    const patas = [];
    for (const [x, z] of [[-3, -4.5], [3, -4.5], [-3, 4.5], [3, 4.5]]) {
      const pv = m.pivo(raiz, x, 6, z);
      m.parte('pata', pv, 0, -3, 0);
      patas.push(pv);
    }
    return (dt, vel, est) => {
      const s = Math.sin(m.fase) * 0.75 * m.amp;
      patas[0].rotation.x = s; patas[3].rotation.x = s;
      patas[1].rotation.x = -s; patas[2].rotation.x = -s;
      cab.position.z = Math.sin(m.fase * 2) * 0.01 * m.amp;
      cab.rotation.x = Math.sin(m.fase * 2) * 0.04 * m.amp;
      rabo.rotation.z = Math.sin(m.tempo * 6) * (0.15 + 0.25 * m.amp);
      if (est.nadando) { // patinhas remam mais rápido
        const r = Math.sin(m.tempo * 10) * 0.6;
        patas[0].rotation.x = r; patas[3].rotation.x = r; patas[1].rotation.x = -r; patas[2].rotation.x = -r;
      }
    };
  },
});

// ---------------------------------------------------------------------
// GALINHA (1 pixel = 1/20 de bloco)
// ---------------------------------------------------------------------
registrarModelo('galinha', {
  esc: 1 / 20, altura: 0.72, raio: 0.22, meiaLargura: 0.2, passo: 4.5, semente: 33,
  partes: {
    corpo: [6, 6, 8], cabeca: [4, 4, 3], bico: [2, 1, 2], barbela: [1, 2, 1],
    crista: [1, 2, 2], asa: [1, 4, 6], perna: [1, 4, 1], pe: [3, 1, 3], rabo: [2, 3, 2],
  },
  pintar(p, r) {
    const BRANCO = '#f4f3ee', VERM = '#d02a2a', AMAR = '#e8b830', PATA = '#d9a528';
    p.todas(r.corpo).forEach((g) => p.enche(g, BRANCO, 6));
    p.lados(r.corpo).forEach((g) => { p.sombra(g, g[3] - 1, -10); p.pontos(g, 4, '#dcdad2'); });
    p.todas(r.cabeca).forEach((g) => p.enche(g, BRANCO, 5));
    p.pix(r.cabeca.frente, 0, 1, '#1a1a1a'); p.pix(r.cabeca.frente, 3, 1, '#1a1a1a');   // olhos
    p.todas(r.bico).forEach((g) => p.enche(g, AMAR, 6));
    p.sombra(r.bico.frente, 0, -14);
    p.todas(r.barbela).forEach((g) => p.enche(g, VERM, 8));
    p.todas(r.crista).forEach((g) => p.enche(g, VERM, 10));
    p.todas(r.asa).forEach((g) => p.enche(g, '#eceae2', 6));
    p.lados(r.asa).forEach((g) => { p.sombra(g, g[3] - 1, -22); p.sombra(g, g[3] - 2, -10); });
    p.todas(r.perna).forEach((g) => p.enche(g, PATA, 8));
    p.todas(r.pe).forEach((g) => p.enche(g, PATA, 8));
    p.todas(r.rabo).forEach((g) => p.enche(g, '#e8e6de', 6));
  },
  construir(m) {
    const raiz = m.raiz;
    m.parte('corpo', raiz, 0, 7, 0);
    m.parte('rabo', raiz, 0, 8.5, 4.5).rotation.x = -0.35;
    const cab = m.pivo(raiz, 0, 0, 0);
    m.parte('cabeca', cab, 0, 10.5, -5);
    m.parte('bico', cab, 0, 10, -7.5);
    m.parte('barbela', cab, 0, 8.8, -6.6);
    m.parte('crista', cab, 0, 13.4, -5);
    // pernas finas: pivô no alto, pé achatado embaixo
    const pernas = [];
    for (const x of [-1.5, 1.5]) {
      const pv = m.pivo(raiz, x, 4, 0);
      m.parte('perna', pv, 0, -2, 0);
      m.parte('pe', pv, 0, -3.5, -1);
      pernas.push(pv);
    }
    // asas: pivô no ombro, abrem para os lados quando batem
    const asas = [];
    for (const s of [-1, 1]) {
      const pv = m.pivo(raiz, s * 3.8, 9.5, 0);
      m.parte('asa', pv, s * 0.2, -2, 0);
      asas.push(pv);
    }
    return (dt, vel, est) => {
      const s = Math.sin(m.fase) * 0.9 * m.amp;
      pernas[0].rotation.x = s; pernas[1].rotation.x = -s;
      // bicadinha da cabeça ao andar
      cab.position.z = Math.sin(m.fase * 2) * 0.015 * m.amp;
      let abertura;
      if (est.voando) abertura = 0.7 + 0.6 * Math.sin(m.tempo * 28);          // caindo/voando: bate forte
      else abertura = 0.06 + m.amp * (0.25 + 0.2 * Math.sin(m.tempo * 16));    // andando: balança
      asas[0].rotation.z = -abertura; asas[1].rotation.z = abertura;
    };
  },
});

// ---------------------------------------------------------------------
// ZUMBI (formato do personagem: skin 64x64; 1 pixel = 1.8/32 bloco)
// ---------------------------------------------------------------------
registrarModelo('zumbi', {
  esc: 1.8 / 32, altura: 1.8, raio: 0.3, meiaLargura: 0.45, passo: 2.6, semente: 913,
  partes: {
    cabeca: [8, 8, 8, 0, 0], corpo: [8, 12, 4, 16, 16],
    bracoD: [4, 12, 4, 40, 16], pernaD: [4, 12, 4, 0, 16],
    bracoE: [4, 12, 4, 32, 48], pernaE: [4, 12, 4, 16, 48],
  },
  pintar(p, r) {
    const PELE = '#5b9348', PELE2 = '#4a7a3a', CAMISA = '#79b8dc', CALCA = '#26357a';
    // cabeça: pele verde, olhos escuros e boca torta
    p.todas(r.cabeca).forEach((g) => p.enche(g, PELE, 9));
    p.pontos(r.cabeca.topo, 8, PELE2);
    const f = r.cabeca.frente;
    p.ret(f, 1, 4, 2, 1, '#14210f'); p.ret(f, 5, 4, 2, 1, '#14210f');   // olhos escuros
    p.pix(f, 1, 5, '#0a1008'); p.pix(f, 6, 5, '#0a1008');
    p.pix(f, 3, 5, PELE2); p.pix(f, 4, 5, PELE2);                        // nariz
    p.ret(f, 2, 6, 4, 1, '#2b4524'); p.pix(f, 5, 7, '#2b4524');          // boca
    p.sombra(f, 7, -14); p.pontos(f, 4, PELE2);
    // cabelo rasgado/escuro no topo
    p.ret(r.cabeca.topo, 0, 0, 8, 2, '#3a5a2e');
    // corpo: camisa azul-clara rasgada, cós da calça
    const c = r.corpo;
    p.todas(c).forEach((g) => p.enche(g, CAMISA, 7));
    p.lados(c).forEach((g) => {
      p.enche(g, CALCA, 6, 10, 11);
      p.sombra(g, 9, -22); p.sombra(g, 10, -18);
      // rasgos: pontinhos de pele verde aparecendo na barra da camisa
      for (let i = 0; i < g[2]; i++) {
        const h = Math.floor(p.rnd() * 4);
        if (p.rnd() < 0.6) p.ret(g, i, 9 - h, 1, h + 1, i % 2 ? PELE : PELE2);
      }
    });
    p.pix(c.frente, 3, 0, PELE); p.pix(c.frente, 4, 0, PELE);             // gola
    p.ret(c.frente, 5, 3, 2, 3, PELE2); p.pix(c.frente, 6, 4, '#3a6a2a'); // rasgão no peito
    p.pontos(c.frente, 5, '#5a98bc');
    p.enche(c.baixo, CALCA, 5);
    // braços: pele verde com manga azul rasgada na parte de cima
    for (const b of [r.bracoD, r.bracoE]) {
      p.lados(b).forEach((g) => {
        p.enche(g, PELE, 8);
        p.enche(g, CAMISA, 7, 0, 3);
        for (let i = 0; i < g[2]; i++) if (p.rnd() < 0.55) p.ret(g, i, 3, 1, 1 + Math.floor(p.rnd() * 2), PELE);
        p.sombra(g, 11, -12); p.pontos(g, 3, PELE2);
      });
      p.enche(b.topo, CAMISA, 7); p.enche(b.baixo, PELE, 8);
    }
    // pernas: calça azul-escura rasgada, pés de pele verde
    for (const pe of [r.pernaD, r.pernaE]) {
      p.lados(pe).forEach((g) => {
        p.enche(g, CALCA, 6, 0, 8);
        p.enche(g, PELE, 8, 9, 11);
        for (let i = 0; i < g[2]; i++) if (p.rnd() < 0.6) p.ret(g, i, 7 + Math.floor(p.rnd() * 2), 1, 2, PELE2);
        p.sombra(g, 8, -14); p.sombra(g, 11, -22);
      });
      p.enche(pe.topo, CALCA, 5); p.enche(pe.baixo, PELE2, 6);
    }
  },
  construir(m) {
    const raiz = m.raiz;
    m.parte('corpo', raiz, 0, 18, 0);
    const cab = m.pivo(raiz, 0, 24, 0);
    m.parte('cabeca', cab, 0, 4, 0);
    // pernas (pivô no quadril) e braços (pivô no ombro, esticados para frente)
    const pernaD = m.pivo(raiz, 2, 12, 0); m.parte('pernaD', pernaD, 0, -6, 0);
    const pernaE = m.pivo(raiz, -2, 12, 0); m.parte('pernaE', pernaE, 0, -6, 0);
    const bracoD = m.pivo(raiz, 6, 22, 0); m.parte('bracoD', bracoD, 0, -4, 0);
    const bracoE = m.pivo(raiz, -6, 22, 0); m.parte('bracoE', bracoE, 0, -4, 0);
    const FRENTE = Math.PI / 2; // rotação em X que aponta o braço para -Z
    let tAtaque = 0;
    return (dt, vel, est) => {
      const s = Math.sin(m.fase) * 0.8 * m.amp;
      pernaD.rotation.x = s; pernaE.rotation.x = -s;
      if (est.atacando) {
        // "tapa": os braços sobem e descem rápido, um pouco defasados
        tAtaque += dt * 13;
        bracoD.rotation.x = FRENTE + 0.2 + 0.7 * Math.sin(tAtaque);
        bracoE.rotation.x = FRENTE + 0.2 + 0.7 * Math.sin(tAtaque + 1.3);
      } else {
        tAtaque = 0;
        // braços esticados balançando de leve
        bracoD.rotation.x = FRENTE + Math.sin(m.tempo * 2.2) * 0.07 + s * 0.12;
        bracoE.rotation.x = FRENTE + Math.sin(m.tempo * 2.2 + 1.7) * 0.07 - s * 0.12;
      }
      bracoD.rotation.z = -0.04 + Math.sin(m.tempo * 1.7) * 0.03;
      bracoE.rotation.z = 0.04 - Math.sin(m.tempo * 1.7) * 0.03;
      cab.rotation.y = Math.sin(m.tempo * 0.9) * 0.12;
      cab.rotation.x = est.atacando ? 0.2 : 0.05;
    };
  },
});

// ---------------------------------------------------------------------
// ARANHA (1 pixel = 1/16 de bloco; envergadura das pernas ~1.4)
// ---------------------------------------------------------------------
registrarModelo('aranha', {
  esc: 1 / 16, altura: 0.9, raio: 0.7, meiaLargura: 0.31, passo: 5, semente: 555,
  partes: {
    abdomen: [10, 10, 12], cabeca: [8, 7, 8], perna_sup: [8, 2, 2], perna_inf: [2, 11, 2],
  },
  pintar(p, r) {
    const ESC = '#2b2325', PELO = '#4d3f3b';
    // abdômen: escuro e peludo, com uma marca avermelhada no dorso
    p.todas(r.abdomen).forEach((g) => { p.enche(g, ESC, 11); p.pontos(g, 22, PELO); });
    const t = r.abdomen.topo;
    for (let j = 1; j < t[3] - 1; j += 2) p.ret(t, 3, j, t[2] - 6, 1, '#7a2a22');
    p.ret(t, 4, 0, 2, t[3], '#5a2420');
    p.lados(r.abdomen).forEach((g) => p.sombra(g, g[3] - 1, -14));
    // cabeça
    p.todas(r.cabeca).forEach((g) => { p.enche(g, '#352b2c', 9); p.pontos(g, 10, PELO); });
    const f = r.cabeca.frente;
    p.ret(f, 2, 5, 4, 2, '#1a1213');                                      // boca
    p.pix(f, 2, 6, '#cfc7b4'); p.pix(f, 5, 6, '#cfc7b4');                 // presas
    // pernas: escuras com faixas mais claras
    p.todas(r.perna_sup).forEach((g) => { p.enche(g, '#241c1e', 8); p.pontos(g, 3, PELO); });
    p.todas(r.perna_inf).forEach((g) => { p.enche(g, '#2a2123', 8); p.pontos(g, 4, PELO); });
    p.lados(r.perna_inf).forEach((g) => { p.ret(g, 0, 3, g[2], 1, '#5a4a46'); p.ret(g, 0, 7, g[2], 1, '#5a4a46'); });
    p.lados(r.perna_sup).forEach((g) => p.ret(g, 3, 0, 1, g[3], '#5a4a46'));
  },
  construir(m) {
    const raiz = m.raiz;
    m.parte('abdomen', raiz, 0, 9, 6);
    m.parte('cabeca', raiz, 0, 8.5, -4);
    // 8 olhos que brilham: 2 grandes e 6 pequenos (na frente da cabeça, z = -8)
    for (const s of [-1, 1]) {
      m.caixaBrilho(raiz, 0xff1a1a, 2, 2, 0.8, s * 1.6, 10.2, -8.3);   // grandes
      m.caixaBrilho(raiz, 0xc01010, 1, 1, 0.8, s * 3.3, 10.4, -8.3);
      m.caixaBrilho(raiz, 0xc01010, 1, 1, 0.8, s * 1.0, 8.2, -8.3);
      m.caixaBrilho(raiz, 0xc01010, 1, 1, 0.8, s * 2.7, 8.2, -8.3);
    }
    // 8 pernas articuladas (4 por lado): a parte de cima sobe, a de baixo desce
    const SOBE = 0.45;
    const BASE = [0.75, 0.3, -0.25, -0.7]; // abertura para frente/trás de cada perna
    const pernas = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const pv = m.pivo(raiz, s * 4.5, 7, [-5, -2, 1, 4][i]);
        const sup = m.parte('perna_sup', pv, s * 4, 0, 0);
        sup.rotation.z = 0;
        const junta = m.pivo(pv, s * 8, 0, 0);
        m.parte('perna_inf', junta, 0, -5.2, 0);
        junta.rotation.z = -s * SOBE; // cancela a subida: a parte de baixo fica reta
        pv.rotation.z = s * SOBE;
        pernas.push({ pv, s, i });
      }
    }
    return (dt, vel, est) => {
      for (const { pv, s, i } of pernas) {
        // ondas: pernas alternadas (esquerda x direita e pares x ímpares)
        const fase = m.fase + i * 0.9 + (s > 0 ? Math.PI : 0) + (i % 2) * Math.PI;
        const varre = Math.sin(fase) * 0.4 * m.amp;
        const levanta = Math.max(0, Math.cos(fase)) * 0.3 * m.amp;
        let extra = 0;
        if (est.atacando && i < 2) extra = 0.5 + 0.3 * Math.sin(m.tempo * 18); // pernas da frente erguidas
        pv.rotation.y = s * (BASE[i] + varre);
        pv.rotation.z = s * (SOBE + levanta + extra);
      }
    };
  },
});

// ---------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------
/**
 * Cria o modelo de um mob.
 * Devolve { grupo, altura, raio, animar(dt, vel, estado), piscarDano(),
 *           morrer(t0a1), definirLuz(v), definirVida(frac), dispose() }.
 */
export function criarModeloMob(tipo) {
  const def = MODELOS[tipo];
  if (!def) throw new Error('Modelo de mob desconhecido: ' + tipo);
  return new ModeloMob(tipo, def, recursosDe(tipo));
}
