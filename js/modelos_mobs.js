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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
// Clareia (f > 1) ou escurece (f < 1) uma cor "#rrggbb"
function tom(hex, f) {
  const c = hexRGB(hex);
  return '#' + c.map((v) => lim(v * f).toString(16).padStart(2, '0')).join('');
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
  // Escamas: tijolinhos de 'tw' x 'th' pixels com linhas escuras e brilhos
  p.escamas = (reg, cor, v = 6, tw = 4, th = 3) => {
    p.enche(reg, cor, v);
    const escura = tom(cor, 0.6), clara = tom(cor, 1.22);
    for (let j = 0; j < reg[3]; j++) {
      const lin = Math.floor(j / th), off = (lin % 2) * (tw >> 1);
      if (j % th === th - 1) p.ret(reg, 0, j, reg[2], 1, escura);          // base da escama
      else for (let i = off; i < reg[2]; i += tw) p.pix(reg, i, j, escura); // divisória
      if (j % th === 0) for (let i = off + 1; i < reg[2]; i += tw) p.pix(reg, i, j, clara); // brilho
    }
  };
  // Linha reta pixel a pixel entre dois pontos da região
  p.linha = (reg, x0, y0, x1, y1, cor) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) p.pix(reg, Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), cor);
  };
  p.todas = (r) => [r.topo, r.baixo, r.direita, r.frente, r.esquerda, r.tras];
  p.lados = (r) => [r.direita, r.frente, r.esquerda, r.tras];
  return p;
}

// ---------------------------------------------------------------------
// Recursos compartilhados por tipo (textura e geometrias, criados 1 vez)
// ---------------------------------------------------------------------
const recursos = new Map();

// variante = qual pelagem/cor (só para tipos com def.variantes); cada uma tem a sua textura
function recursosDe(tipo, variante = 0) {
  const chave = variante ? tipo + '|' + variante : tipo;
  let r = recursos.get(chave);
  if (r) return r;
  const def = MODELOS[tipo];
  const emp = empacotar(def.partes, def.largura || 64);
  const canvas = criarCanvas(emp.tw, emp.th);
  def.pintar(criarPincel(canvas, (def.semente || 1234) + variante * 101), emp.regs, variante);
  const textura = new THREE.CanvasTexture(canvas);
  textura.magFilter = THREE.NearestFilter;
  textura.minFilter = THREE.NearestFilter;
  textura.generateMipmaps = false;
  textura.colorSpace = THREE.SRGBColorSpace;
  r = { def, canvas, textura, tw: emp.tw, th: emp.th, caixas: emp.caixas, geos: {} };
  recursos.set(chave, r);
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
  constructor(tipo, def, rec, opcoes = {}, variante = 0) {
    this.tipo = tipo;
    this.opcoes = opcoes;
    this.variante = variante;   // pelagem escolhida (0 nos tipos sem variantes)
    this._def = def;
    this._rec = rec;
    this._esc = def.esc;
    this.altura = def.altura;
    this.raio = def.raio;

    // grupo = o que o mobs.js move e gira; raiz = o corpo (é ela que tomba)
    this.grupo = new THREE.Group();
    this.raiz = new THREE.Group();
    this.grupo.add(this.raiz);

    // Onde o jogador senta (só faz sentido nas montarias; as montarias reposicionam)
    this.assento = new THREE.Object3D();
    this.assento.position.set(0, def.altura * 0.7, 0);
    this.raiz.add(this.assento);

    // Materiais da instância (a textura é compartilhada)
    // emissiveMap = a própria skin: o brilho extra da luz (tochas) mantém as cores do mob.
    // O vermelho do dano entra por um uniform somado à emissão (não depende da skin).
    this._uFlash = { value: new THREE.Color(0, 0, 0) };
    this.material = new THREE.MeshLambertMaterial({ map: rec.textura, emissiveMap: rec.textura, emissive: 0x000000 });
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uFlash = this._uFlash;
      sh.fragmentShader = 'uniform vec3 uFlash;\n' + sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uFlash;');
    };
    this._brilhos = {};                // materiais de brilho já criados, por cor
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

  /** Geometria (caixa com UV da skin) da parte `nome`, criada uma vez por tipo */
  _geoDe(nome) {
    const rec = this._rec;
    let geo = rec.geos[nome];
    if (!geo) {
      const c = rec.caixas[nome];
      geo = new THREE.BoxGeometry(c.w * this._esc, c.h * this._esc, c.d * this._esc);
      mapearUV(geo, c, rec.tw, rec.th);
      rec.geos[nome] = geo;
    }
    return geo;
  }

  /** Caixa texturizada da parte `nome` (posição do centro em pixels, relativa ao pai) */
  parte(nome, pai, x, y, z) {
    const m = new THREE.Mesh(this._geoDe(nome), this.material);
    m.position.set(x * this._esc, y * this._esc, z * this._esc);
    pai.add(m);
    return m;
  }

  /**
   * Junta várias caixas que NÃO se mexem entre si numa malha só (menos chamadas
   * de desenho). itens = [[nome, x, y, z, rotX, rotY, rotZ], ...] em pixels.
   * A geometria unida fica no cache do tipo (chave única por grupo de peças).
   */
  mesclar(chave, pai, itens) {
    const rec = this._rec;
    const k = '#' + chave;
    let geo = rec.geos[k];
    if (!geo) {
      const e = new THREE.Euler(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
      const um = new THREE.Vector3(1, 1, 1), mat4 = new THREE.Matrix4();
      const lista = [];
      for (const [nome, x, y, z, rx = 0, ry = 0, rz = 0] of itens) {
        const g = this._geoDe(nome).clone();
        q.setFromEuler(e.set(rx, ry, rz));
        pos.set(x * this._esc, y * this._esc, z * this._esc);
        g.applyMatrix4(mat4.compose(pos, q, um));
        lista.push(g);
      }
      geo = mergeGeometries(lista);
      for (const g of lista) g.dispose();
      rec.geos[k] = geo;
    }
    const m = new THREE.Mesh(geo, this.material);
    pai.add(m);
    return m;
  }

  /** Caixa só de cor que não depende da luz (olhos brilhantes). Medidas em pixels. */
  caixaBrilho(pai, cor, w, h, d, x, y, z) {
    let mat = this._brilhos[cor];     // uma cor = um material por instância
    if (!mat) { mat = new THREE.MeshBasicMaterial({ color: cor }); this._brilhos[cor] = mat; this._basicos.push(mat); }
    const m = new THREE.Mesh(GEO_CUBO, mat);
    m.scale.set(w * this._esc, h * this._esc, d * this._esc);
    m.position.set(x * this._esc, y * this._esc, z * this._esc);
    pai.add(m);
    return m;
  }

  /**
   * Várias caixinhas que brilham (olhos, manchas) numa malha só, cada uma com sua cor.
   * itens = [[cor, w, h, d, x, y, z], ...] em pixels. Não dependem da luz.
   */
  mesclarBrilho(chave, pai, itens) {
    const rec = this._rec;
    const k = '*' + chave;
    let geo = rec.geos[k];
    if (!geo) {
      const cor = new THREE.Color();
      const lista = [];
      for (const [hex, w, h, d, x, y, z] of itens) {
        const g = new THREE.BoxGeometry(w * this._esc, h * this._esc, d * this._esc);
        g.translate(x * this._esc, y * this._esc, z * this._esc);
        cor.set(hex);
        const n = g.attributes.position.count;
        const cores = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { cores[i * 3] = cor.r; cores[i * 3 + 1] = cor.g; cores[i * 3 + 2] = cor.b; }
        g.setAttribute('color', new THREE.BufferAttribute(cores, 3));
        lista.push(g);
      }
      geo = mergeGeometries(lista);
      for (const g of lista) g.dispose();
      rec.geos[k] = geo;
    }
    let mat = this._brilhos['*vert'];
    if (!mat) { mat = new THREE.MeshBasicMaterial({ vertexColors: true }); this._brilhos['*vert'] = mat; this._basicos.push(mat); }
    const m = new THREE.Mesh(geo, mat);
    pai.add(m);
    return m;
  }

  /**
   * Caixas só de cor (cada uma com a sua), unidas numa malha que RECEBE luz.
   * Usado nos equipamentos (sela, armadura). itens = [[hex, w, h, d, x, y, z, rotX, rotY, rotZ], ...]
   * em pixels do modelo. A geometria fica no cache do tipo.
   */
  mesclarCor(chave, pai, itens) {
    const rec = this._rec;
    const k = '$' + chave;
    let geo = rec.geos[k];
    if (!geo) {
      const e = new THREE.Euler(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
      const um = new THREE.Vector3(1, 1, 1), mat4 = new THREE.Matrix4(), cor = new THREE.Color();
      const lista = [];
      for (const [hex, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0] of itens) {
        const g = new THREE.BoxGeometry(w * this._esc, h * this._esc, d * this._esc);
        q.setFromEuler(e.set(rx, ry, rz));
        pos.set(x * this._esc, y * this._esc, z * this._esc);
        g.applyMatrix4(mat4.compose(pos, q, um));
        cor.set(hex);
        const n = g.attributes.position.count;
        const cores = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { cores[i * 3] = cor.r; cores[i * 3 + 1] = cor.g; cores[i * 3 + 2] = cor.b; }
        g.setAttribute('color', new THREE.BufferAttribute(cores, 3));
        lista.push(g);
      }
      geo = mergeGeometries(lista);
      for (const g of lista) g.dispose();
      rec.geos[k] = geo;
    }
    if (!this._matEquip) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uFlash = this._uFlash;
        // a emissão acompanha a cor de cada vértice (como a skin faz nos outros materiais)
        sh.fragmentShader = 'uniform vec3 uFlash;\n' + sh.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= diffuseColor.rgb;\n  totalEmissiveRadiance += uFlash;');
      };
      this._matEquip = mat;
      this._materiais.push(mat);
      this.definirLuz(this._luz);
    }
    const m = new THREE.Mesh(geo, this._matEquip);
    pai.add(m);
    return m;
  }

  /** Sela visível ou não (só as montarias têm; nos outros não faz nada) */
  definirSela(_ligada) {}
  /** Armadura de montaria: 'ferro' | 'ouro' | 'diamante' | null (só as montarias) */
  definirArmaduraMontaria(_material) {}

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
    this._uFlash.value.setRGB(f, 0, 0);
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
    // color escurece a luz recebida; emissive (× skin) garante um mínimo visível
    // perto de tochas à noite, mantendo as cores do mob
    const brilho = 0.55 * this._luz;
    for (const m of this._materiais) { m.color.setScalar(k); m.emissive.setScalar(brilho); }
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
  // Só esquece o cache (todas as variantes): instâncias vivas guardam a referência e
  // continuam com a textura e as geometrias antigas (não descartamos nada em uso).
  for (const k of [...recursos.keys()]) if (k === tipo || k.startsWith(tipo + '|')) recursos.delete(k);
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
    // cabeça + focinho + orelhas não se mexem entre si: uma malha só
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, 10.5, -10], ['focinho', 0, 9, -15],
      ['orelha', -3, 15.2, -8.5, 0, 0, 0.35], ['orelha', 3, 15.2, -8.5, 0, 0, -0.35],
    ]);
    // rabinho enrolado (duas peças, uma malha)
    const rabo = m.pivo(raiz, 0, 12, 7);
    m.mesclar('rabo', rabo, [['rabo1', 0, 0, 1], ['rabo2', 0, 1, 2.5]]);
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
    m.mesclar('corpo', raiz, [['corpo', 0, 7, 0], ['rabo', 0, 8.5, 4.5, -0.35, 0, 0]]);
    const cab = m.pivo(raiz, 0, 0, 0);
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, 10.5, -5], ['bico', 0, 10, -7.5], ['barbela', 0, 8.8, -6.6], ['crista', 0, 13.4, -5],
    ]);
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
function construirAranha(m) {
    const raiz = m.raiz;
    // abdômen + cabeça numa malha só (as pernas continuam separadas)
    m.mesclar('corpo', raiz, [['abdomen', 0, 9, 6], ['cabeca', 0, 8.5, -4]]);
    // 8 olhos que brilham (e, na gigante, manchas no dorso): uma malha só, cada caixa com sua cor
    const luzes = [];
    const [olhoG, olhoP] = m._def.olhos || [0xff1a1a, 0xc01010];   // cores dos olhos (grande, pequeno)
    for (const s of [-1, 1]) {
      luzes.push([olhoG, 2, 2, 0.8, s * 1.6, 10.2, -8.3]);   // grandes
      luzes.push([olhoP, 1, 1, 0.8, s * 3.3, 10.4, -8.3]);
      luzes.push([olhoP, 1, 1, 0.8, s * 1.0, 8.2, -8.3]);
      luzes.push([olhoP, 1, 1, 0.8, s * 2.7, 8.2, -8.3]);
    }
    if (m._def.gigante) {
      luzes.push([0xff2a4a, 3, 0.6, 3, 0, 14.2, 3]);
      luzes.push([0xb040ff, 2, 0.6, 2, 0, 14.2, 7.5]);
      luzes.push([0xff2a4a, 1.4, 0.6, 1.4, 0, 14.2, 11]);
      for (const s of [-1, 1]) luzes.push([0xb040ff, 1.4, 1.4, 0.8, s * 2.1, 9.6, -8.3]);
    }
    m.mesclarBrilho('olhos', raiz, luzes);
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
}

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
  construir: construirAranha,
});

// =====================================================================
// FASE 8: monstros estilo RPG e chefões
// =====================================================================

// Aproxima um valor de um alvo (suaviza movimentos dos braços etc.)
const aproximar = (atual, alvo, k) => atual + (alvo - atual) * (k > 1 ? 1 : k);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------
// ESQUELETO (1 pixel = 1.9/32 de bloco; altura 1.9; segura um arco)
// ---------------------------------------------------------------------
registrarModelo('esqueleto', {
  esc: 1.9 / 32, altura: 1.9, raio: 0.3, meiaLargura: 0.4, passo: 2.8, semente: 4242,
  partes: {
    cabeca: [8, 8, 8], corpo: [6, 12, 3], braco: [2, 12, 2], braco_sup: [2, 6, 2], perna: [2, 12, 2],
    arco: [1, 7, 1], arco_meio: [1, 4, 1], flecha: [1, 1, 12],
  },
  pintar(p, r) {
    const OSSO = '#dcd8c4', OSSO2 = '#b9b5a0', SOMBRA = '#1d1a17', JUNTA = '#4a463c';
    // crânio: dentes, buracos dos olhos e do nariz
    p.todas(r.cabeca).forEach((g) => p.enche(g, OSSO, 7));
    p.pontos(r.cabeca.topo, 8, OSSO2);
    const f = r.cabeca.frente;
    p.ret(f, 1, 3, 2, 2, SOMBRA); p.ret(f, 5, 3, 2, 2, SOMBRA);          // olhos escuros
    p.pix(f, 2, 4, '#4a1a14'); p.pix(f, 5, 4, '#4a1a14');                  // um brilhinho fraco no fundo
    p.ret(f, 3, 5, 2, 1, SOMBRA);                                          // nariz
    p.ret(f, 1, 6, 6, 2, '#2a2622');                                       // boca
    for (let i = 1; i <= 6; i++) { p.pix(f, i, 6, i % 2 ? OSSO : '#2a2622'); p.pix(f, i, 7, i % 2 ? '#2a2622' : OSSO); }
    p.sombra(f, 0, -10);
    for (const g of [r.cabeca.direita, r.cabeca.esquerda]) {
      p.ret(g, 2, 3, 3, 1, SOMBRA); p.ret(g, 1, 6, 6, 1, '#2a2622'); p.sombra(g, 7, -12);
    }
    // tronco: costelas visíveis sobre um fundo escuro
    const c = r.corpo;
    for (const g of [c.frente, c.tras, c.direita, c.esquerda]) p.enche(g, SOMBRA, 3);
    const costelas = [1, 3, 5, 7];
    for (const j of costelas) {
      p.ret(c.frente, 0, j, 6, 1, OSSO); p.ret(c.frente, 0, j + 1, 6, 1, '#6a665a');
      p.ret(c.direita, 0, j, 3, 1, OSSO); p.ret(c.esquerda, 0, j, 3, 1, OSSO);
      p.ret(c.tras, 0, j, 2, 1, OSSO2); p.ret(c.tras, 4, j, 2, 1, OSSO2);
    }
    p.ret(c.frente, 2, 0, 2, 9, OSSO);                                     // esterno
    p.ret(c.tras, 2, 0, 2, 12, OSSO);                                      // coluna
    for (let j = 1; j < 12; j += 2) p.ret(c.tras, 2, j, 2, 1, OSSO2);
    for (const g of [c.frente, c.tras, c.direita, c.esquerda]) { p.enche(g, OSSO, 6, 9, 11); p.sombra(g, 9, -18); }
    p.pix(c.frente, 2, 10, SOMBRA); p.pix(c.frente, 3, 10, SOMBRA);        // bacia
    p.enche(c.topo, OSSO2, 5); p.enche(c.baixo, OSSO2, 5);
    // braços e pernas: ossos finos com a junta mais escura no meio
    for (const b of [r.braco, r.perna, r.braco_sup]) {
      const meio = Math.floor(b.frente[3] / 2);
      p.lados(b).forEach((g) => {
        p.enche(g, OSSO, 7); p.pontos(g, 2, OSSO2);
        if (b !== r.braco_sup) p.ret(g, 0, meio - 1, g[2], 2, JUNTA);
        p.sombra(g, g[3] - 1, -14);
      });
      p.enche(b.topo, OSSO2, 5); p.enche(b.baixo, OSSO2, 5);
    }
    // arco de madeira e flecha
    for (const a of [r.arco, r.arco_meio]) p.todas(a).forEach((g) => { p.enche(g, '#7a5430', 8); p.pontos(g, 2, '#4a301a'); });
    p.ret(r.arco_meio.frente, 0, 1, 1, 2, '#3a2814'); // empunhadura
    for (const g of p.todas(r.flecha)) p.enche(g, '#9a7a4a', 6);
    p.ret(r.flecha.esquerda, 0, 0, 3, 1, '#d8d0b8'); p.ret(r.flecha.direita, 0, 0, 3, 1, '#d8d0b8'); // penas
  },
  construir(m) {
    const raiz = m.raiz;
    m.parte('corpo', raiz, 0, 18, 0);
    const cab = m.pivo(raiz, 0, 24, 0);
    m.parte('cabeca', cab, 0, 4, 0);
    const pernaD = m.pivo(raiz, 1.5, 12, 0); m.parte('perna', pernaD, 0, -6, 0);
    const pernaE = m.pivo(raiz, -1.5, 12, 0); m.parte('perna', pernaE, 0, -6, 0);
    // braço esquerdo: estendido para a frente, segurando o arco
    const bracoE = m.pivo(raiz, -4, 22, 0);
    bracoE.rotation.order = 'YXZ';
    m.parte('braco', bracoE, 0, -6, 0);
    // braço direito em 2 pedaços (ombro e cotovelo), para poder puxar a corda
    const bracoD = m.pivo(raiz, 4, 22, 0);
    bracoD.rotation.order = 'YXZ';
    m.parte('braco_sup', bracoD, 0, -3, 0);
    const cotovelo = m.pivo(bracoD, 0, -6, 0);
    m.parte('braco_sup', cotovelo, 0, -3, 0);
    // arco: empunhadura + 2 hastes curvadas para trás (na mão esquerda, z = -12)
    const arco = m.pivo(raiz, -4, 22, -12);
    m.mesclar('arco', arco, [
      ['arco_meio', 0, 0, 0],
      ['arco', 0, 5.35, 1.03, 0.3, 0, 0], ['arco', 0, -5.35, 1.03, -0.3, 0, 0],
    ]);
    // corda (2 segmentos que vão das pontas até o ponto de encaixe) e flecha
    const corda1 = m.caixaBrilho(arco, 0xd8d0b8, 0.5, 1, 0.5, 0, 0, 0);
    const corda2 = m.caixaBrilho(arco, 0xd8d0b8, 0.5, 1, 0.5, 0, 0, 0);
    const flecha = m.parte('flecha', arco, 0, 0, 0);
    flecha.visible = false;
    const ESC = m._esc;
    const PONTA = 8.7, PONTA_Z = 2.07;      // onde ficam as pontas do arco (em pixels)
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), dir = new THREE.Vector3(), eixoY = new THREE.Vector3(0, 1, 0);
    // posiciona um cubo como um "palito" entre os pontos a e b (em pixels, no espaço do arco)
    const esticar = (malha, ax, ay, az, bx, by, bz) => {
      va.set(ax, ay, az); vb.set(bx, by, bz);
      dir.subVectors(vb, va);
      const comp = dir.length();
      malha.position.set((ax + bx) * 0.5 * ESC, (ay + by) * 0.5 * ESC, (az + bz) * 0.5 * ESC);
      malha.scale.set(0.5 * ESC, comp * ESC, 0.5 * ESC);
      malha.quaternion.setFromUnitVectors(eixoY, dir.normalize());
    };
    let puxa = 0, alz = 0;
    const OMBRO_D = [4, 22, 0];
    return (dt, vel, est) => {
      const s = Math.sin(m.fase) * 0.8 * m.amp;
      pernaD.rotation.x = s; pernaE.rotation.x = -s;
      cab.rotation.y = Math.sin(m.tempo * 0.8) * 0.1 + (est.atacando ? 0.15 : 0);
      // braço do arco: reto para a frente
      bracoE.rotation.set(Math.PI / 2, 0, 0);
      // alvo: ao atacar, a mão direita puxa a corda; senão, o braço fica solto
      alz = aproximar(alz, est.atacando ? 1 : 0, dt * 9);
      puxa = aproximar(puxa, est.atacando ? 1 : 0, dt * (est.atacando ? 2.2 : 14));
      // ponto de encaixe da corda (espaço do arco, em pixels)
      const nz = PONTA_Z + 8 * puxa;
      // posição do encaixe no espaço do esqueleto (o arco está em -4, 22, -12)
      const dx = (-4) - OMBRO_D[0], dz = (-12 + nz) - OMBRO_D[2];
      const d = Math.min(Math.hypot(dx, dz), 11.8);
      const beta = Math.acos(d / 12);
      const psi = Math.atan2(-dx, -dz);
      const repouso = Math.sin(m.tempo * 1.9) * 0.05 - s * 0.12;
      bracoD.rotation.set(lerp(0.12 + repouso, Math.PI / 2, alz), lerp(0, psi - beta, alz), 0);
      cotovelo.rotation.set(lerp(0.25, 0, alz), 0, lerp(0, 2 * beta, alz));
      // corda: reta quando solta, em "V" quando puxada
      esticar(corda1, 0, PONTA, PONTA_Z, 0, 0, nz);
      esticar(corda2, 0, -PONTA, PONTA_Z, 0, 0, nz);
      flecha.visible = puxa > 0.15;
      flecha.position.set(0, 0, (nz - 6) * ESC);
    };
  },
});

// ---------------------------------------------------------------------
// ARANHA GIGANTE (2x a aranha; marcas vermelhas/roxas e olhos que brilham)
// ---------------------------------------------------------------------
registrarModelo('aranha_gigante', {
  esc: 1 / 8, altura: 1.8, raio: 1.4, meiaLargura: 0.62, passo: 4, semente: 777, gigante: true,
  partes: MODELOS.aranha.partes,
  pintar(p, r) {
    const ESC = '#241a2a', PELO = '#46384a';
    // abdômen: roxo-escuro peludo, com uma ampulheta vermelha e faixas roxas
    p.todas(r.abdomen).forEach((g) => { p.enche(g, ESC, 10); p.pontos(g, 26, PELO); });
    const t = r.abdomen.topo;   // 10 de largura x 12 de comprimento
    const larg = [2, 4, 4, 2, 1, 1, 2, 4, 4, 5, 4, 2];
    for (let j = 0; j < t[3]; j++) {
      const w = larg[j % larg.length], x0 = Math.floor((t[2] - w) / 2);
      p.ret(t, x0, j, w, 1, '#a01832');
      if (w > 2) p.ret(t, x0 + 1, j, w - 2, 1, '#d02848');
    }
    p.ret(t, 0, 3, 2, 1, '#6a2a8a'); p.ret(t, 8, 3, 2, 1, '#6a2a8a');
    p.ret(t, 0, 8, 2, 1, '#6a2a8a'); p.ret(t, 8, 8, 2, 1, '#6a2a8a');
    p.lados(r.abdomen).forEach((g) => {
      for (let i = 1; i < g[2]; i += 3) p.ret(g, i, 1, 1, g[3] - 3, '#5a2a78');   // listras roxas
      p.pontos(g, 5, '#a01832'); p.sombra(g, g[3] - 1, -16);
    });
    // cabeça: com presas grandes
    p.todas(r.cabeca).forEach((g) => { p.enche(g, '#2c2230', 9); p.pontos(g, 12, PELO); });
    const f = r.cabeca.frente;
    p.ret(f, 1, 5, 6, 2, '#120c14');
    p.ret(f, 1, 5, 1, 3, '#e8e0cc'); p.ret(f, 6, 5, 1, 3, '#e8e0cc');   // presas
    p.pix(f, 3, 0, '#6a2a8a'); p.pix(f, 4, 0, '#6a2a8a');
    // pernas: escuras, com faixas roxas e roxo-claras
    p.todas(r.perna_sup).forEach((g) => { p.enche(g, '#1c1520', 8); p.pontos(g, 3, PELO); });
    p.todas(r.perna_inf).forEach((g) => { p.enche(g, '#221a28', 8); p.pontos(g, 4, PELO); });
    p.lados(r.perna_inf).forEach((g) => { p.ret(g, 0, 3, g[2], 1, '#6a3a8a'); p.ret(g, 0, 7, g[2], 1, '#6a3a8a'); p.ret(g, 0, 10, g[2], 1, '#cfc7b4'); });
    p.lados(r.perna_sup).forEach((g) => p.ret(g, 3, 0, 1, g[3], '#6a3a8a'));
  },
  construir: construirAranha,
});

// ---------------------------------------------------------------------
// Peças de humanoides (orcs) em comum: pintura da cabeça, orelha e presa
// ---------------------------------------------------------------------
const PELE_ORC = '#6b8262', PELE_ORC2 = '#52664c';

function pintarCabecaOrc(p, r, olhos) {
  p.todas(r.cabeca).forEach((g) => p.enche(g, PELE_ORC, 8));
  p.pontos(r.cabeca.topo, 8, PELE_ORC2);
  const f = r.cabeca.frente;
  p.ret(f, 0, 2, 3, 1, '#26301f'); p.ret(f, 5, 2, 3, 1, '#26301f');        // sobrancelhas pesadas
  p.ret(f, 1, 3, 2, 1, olhos); p.ret(f, 5, 3, 2, 1, olhos);                // olhos
  p.pix(f, 2, 3, '#7a1010'); p.pix(f, 5, 3, '#7a1010');
  p.ret(f, 3, 4, 2, 2, PELE_ORC2); p.pix(f, 3, 5, '#202a1a'); p.pix(f, 4, 5, '#202a1a'); // nariz largo
  p.ret(f, 1, 6, 6, 1, '#22261c'); p.ret(f, 1, 7, 6, 1, PELE_ORC2);        // boca e queixo
  p.sombra(f, 7, -12); p.pontos(f, 4, PELE_ORC2);
  for (const g of [r.cabeca.direita, r.cabeca.esquerda]) { p.ret(g, 1, 3, 2, 1, '#26301f'); p.sombra(g, 7, -10); }
}

function pintarOrelhaPresa(p, r) {
  p.todas(r.orelha).forEach((g) => p.enche(g, PELE_ORC, 6));
  p.todas(r.presa).forEach((g) => p.enche(g, '#e6dfc8', 5));
  p.sombra(r.presa.frente, 2, -14);
}

// ---------------------------------------------------------------------
// ORC GUERREIRO (1 pixel = 2/32 de bloco; altura 2.0; machado grande)
// ---------------------------------------------------------------------
registrarModelo('orc_guerreiro', {
  esc: 2 / 32, altura: 2.0, raio: 0.45, meiaLargura: 0.5, passo: 2.3, semente: 2025,
  partes: {
    cabeca: [8, 8, 8], corpo: [10, 13, 6], braco: [5, 13, 5], perna: [5, 11, 5],
    orelha: [1, 3, 2], presa: [1, 3, 1], crista: [2, 3, 8], ombreira: [7, 2, 7], cinto: [10, 2, 6],
    cabo: [2, 18, 2], lamina: [1, 9, 10],
  },
  pintar(p, r) {
    const COURO = '#5a3e2c', COURO2 = '#3b2a1e', FERRO = '#7a7570', FERRUG = '#8c5a34';
    pintarCabecaOrc(p, r, '#e6c23a');
    pintarOrelhaPresa(p, r);
    p.todas(r.crista).forEach((g) => { p.enche(g, '#1d1a16', 5); p.pontos(g, 3, '#3a362e'); });
    // corpo: colete de couro aberto no peito, tiras cruzadas
    const c = r.corpo;
    p.todas(c).forEach((g) => p.enche(g, COURO, 7));
    p.lados(c).forEach((g) => { p.sombra(g, g[3] - 1, -16); p.pontos(g, 5, COURO2); });
    p.ret(c.frente, 3, 0, 4, 3, PELE_ORC); p.ret(c.frente, 4, 3, 2, 2, PELE_ORC);   // peito de fora
    p.ret(c.frente, 3, 4, 1, 1, PELE_ORC2); p.ret(c.frente, 6, 4, 1, 1, PELE_ORC2);
    p.linha(c.frente, 0, 0, 3, 5, COURO2); p.linha(c.frente, 9, 0, 6, 5, COURO2);
    p.linha(c.tras, 0, 0, 9, 11, COURO2); p.linha(c.tras, 9, 0, 0, 11, COURO2);
    p.ret(c.topo, 3, 0, 4, 6, PELE_ORC);
    // cinto de couro com fivela de bronze
    p.todas(r.cinto).forEach((g) => p.enche(g, COURO2, 5));
    p.ret(r.cinto.frente, 4, 0, 2, 2, '#b08a3c'); p.pix(r.cinto.frente, 5, 1, '#6a4a1a');
    // braços: pele com braçadeira de couro e rebites
    p.lados(r.braco).forEach((g) => {
      p.enche(g, PELE_ORC, 8);
      p.ret(g, 0, 7, g[2], 5, COURO); p.sombra(g, 7, -16);
      p.pix(g, 1, 9, FERRO); p.pix(g, g[2] - 2, 9, FERRO); p.pontos(g, 3, PELE_ORC2);
      p.sombra(g, 12, -14);
    });
    p.enche(r.braco.topo, PELE_ORC, 8); p.enche(r.braco.baixo, PELE_ORC2, 6);
    // pernas: calça escura e botas com borda enferrujada
    p.lados(r.perna).forEach((g) => {
      p.enche(g, '#4a4038', 7, 0, 6);
      p.enche(g, COURO2, 6, 7, 10);
      p.ret(g, 0, 7, g[2], 1, FERRUG); p.sombra(g, 10, -22);
    });
    p.enche(r.perna.topo, '#4a4038', 5); p.enche(r.perna.baixo, '#26201a', 5);
    // ombreiras de metal enferrujado com rebites
    p.todas(r.ombreira).forEach((g) => {
      p.enche(g, '#7d6c5c', 9); p.pontos(g, 14, FERRUG);
      p.pix(g, 1, 0, '#c9c3b8'); p.pix(g, g[2] - 2, 0, '#c9c3b8');
      p.sombra(g, g[3] - 1, -22);
    });
    p.pix(r.ombreira.topo, 1, 1, '#c9c3b8'); p.pix(r.ombreira.topo, 5, 1, '#c9c3b8');
    p.pix(r.ombreira.topo, 1, 5, '#c9c3b8'); p.pix(r.ombreira.topo, 5, 5, '#c9c3b8');
    // machado: cabo de madeira enrolado e lâmina de aço manchada de ferrugem
    p.todas(r.cabo).forEach((g) => { p.enche(g, '#6b4a2a', 7); p.pontos(g, 3, '#3b2a1e'); });
    for (const g of p.lados(r.cabo)) { p.ret(g, 0, 1, g[2], 1, COURO2); p.ret(g, 0, 3, g[2], 1, COURO2); p.ret(g, 0, 16, g[2], 1, COURO2); }
    p.todas(r.lamina).forEach((g) => {
      p.enche(g, '#8d8f94', 8); p.pontos(g, 8, FERRUG);
      p.ret(g, 0, 0, 1, g[3], '#cfd3d6'); p.ret(g, g[2] - 1, 0, 1, g[3], '#cfd3d6');
    });
    p.ret(r.lamina.direita, 2, 3, 3, 3, '#6a6c70'); p.ret(r.lamina.esquerda, 5, 3, 3, 3, '#6a6c70');
    p.ret(r.lamina.frente, 0, 0, 1, 9, '#e8ecee');
  },
  construir(m) {
    const raiz = m.raiz;
    // parte de cima (tronco, cabeça e braços) num pivô no quadril: inclina ao golpear
    const torso = m.pivo(raiz, 0, 11, 0);
    m.mesclar('tronco', torso, [['corpo', 0, 6.5, 0], ['cinto', 0, 1, 0]]);
    const cab = m.pivo(torso, 0, 13, 0);
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, 4, 0], ['orelha', -4.5, 5, 0, 0, 0, 0.5], ['orelha', 4.5, 5, 0, 0, 0, -0.5],
      ['presa', -2.5, 1.5, -4.2], ['presa', 2.5, 1.5, -4.2], ['crista', 0, 8.5, 0],
    ]);
    const pernaD = m.pivo(raiz, 2.7, 11, 0); m.parte('perna', pernaD, 0, -5.5, 0);
    const pernaE = m.pivo(raiz, -2.7, 11, 0); m.parte('perna', pernaE, 0, -5.5, 0);
    // braços (pivô no ombro, com a ombreira junto)
    const bracoD = m.pivo(torso, 7.5, 12, 0);
    m.parte('braco', bracoD, 0, -5.5, 0); m.parte('ombreira', bracoD, 0.5, 1.5, 0);
    const bracoE = m.pivo(torso, -7.5, 12, 0);
    m.parte('braco', bracoE, 0, -5.5, 0); m.parte('ombreira', bracoE, -0.5, 1.5, 0);
    // machado na mão direita: punho (pivô) -> cabo + lâmina
    const punho = m.pivo(bracoD, 0, -12, -1);
    m.parte('cabo', punho, 0, 4, 0);
    m.parte('lamina', punho, 0, 12, -4);
    // poses do braço (ângulo do braço, ângulo do machado no mundo)
    const REP_A = 0.2, REP_F = -0.9, ALTO_A = -2.3, ALTO_F = 0.3, BAIXO_A = 0.7, BAIXO_F = -2.2;
    let t = 0, angA = REP_A, angF = REP_F, angE = 0, incl = 0;
    return (dt, vel, est) => {
      const s = Math.sin(m.fase) * 0.7 * m.amp;
      pernaD.rotation.x = s; pernaE.rotation.x = -s;
      let alvoA = REP_A + s * 0.3, alvoF = REP_F, alvoE = -s * 0.8, alvoI = 0, k = 8;
      if (est.atacando) {
        // ciclo do golpe: levanta (0 a 0.5 s), desce rápido (até 0.65), segura e volta
        t = (t + dt) % 1.2;
        k = 26;
        if (t < 0.5) { const u = t / 0.5; alvoA = lerp(REP_A, ALTO_A, u); alvoF = lerp(REP_F, ALTO_F, u); alvoI = -0.15 * u; alvoE = -0.9 * u; }
        else if (t < 0.65) { const u = (t - 0.5) / 0.15; alvoA = lerp(ALTO_A, BAIXO_A, u); alvoF = lerp(ALTO_F, BAIXO_F, u); alvoI = lerp(-0.15, 0.35, u); alvoE = lerp(-0.9, 0.6, u); }
        else if (t < 1.0) { alvoA = BAIXO_A; alvoF = BAIXO_F; alvoI = 0.35; alvoE = 0.6; }
        else { const u = (t - 1.0) / 0.2; alvoA = lerp(BAIXO_A, REP_A, u); alvoF = lerp(BAIXO_F, REP_F, u); alvoI = lerp(0.35, 0, u); alvoE = lerp(0.6, 0, u); }
      } else t = 0;
      const kk = dt * k;
      angA = aproximar(angA, alvoA, kk); angF = aproximar(angF, alvoF, kk);
      angE = aproximar(angE, alvoE, kk); incl = aproximar(incl, alvoI, kk);
      bracoD.rotation.x = angA;
      punho.rotation.x = angF - angA;          // o machado mantém o ângulo "no mundo"
      bracoE.rotation.x = angE;
      bracoD.rotation.z = -0.08; bracoE.rotation.z = 0.08;
      torso.rotation.x = incl;
      cab.rotation.y = Math.sin(m.tempo * 0.7) * 0.1;
      cab.rotation.x = -incl * 0.6;
    };
  },
});

// ---------------------------------------------------------------------
// ORC XAMA (1 pixel = 1.85/32 de bloco; manto de penas, cajado com orbe roxo)
// ---------------------------------------------------------------------
registrarModelo('orc_xama', {
  esc: 1.85 / 32, altura: 1.85, raio: 0.35, meiaLargura: 0.4, passo: 2.5, semente: 6161,
  partes: {
    cabeca: [8, 8, 8], corpo: [7, 12, 4], braco: [3, 12, 3], perna: [3, 11, 3],
    orelha: [1, 3, 2], presa: [1, 3, 1], manto: [9, 12, 1], ombro_manto: [11, 3, 7], colar: [9, 1, 6],
    pena_a: [1, 5, 1], pena_b: [1, 5, 1], pena_c: [1, 6, 1], cajado: [2, 28, 2], gancho: [4, 2, 2],
  },
  pintar(p, r) {
    const COURO = '#6a4a30', COURO2 = '#3f2c1e', OSSO = '#e6dfc8';
    pintarCabecaOrc(p, r, '#f0d84a');
    pintarOrelhaPresa(p, r);
    // corpo magro com túnica de couro curtida
    const c = r.corpo;
    p.todas(c).forEach((g) => p.enche(g, '#5a4636', 7));
    p.lados(c).forEach((g) => { p.sombra(g, g[3] - 1, -16); p.pontos(g, 4, COURO2); });
    p.ret(c.frente, 2, 0, 3, 4, PELE_ORC); p.linha(c.frente, 0, 4, 6, 9, COURO2);
    p.ret(c.frente, 0, 10, 7, 1, COURO2);
    // braços finos: pele com faixas de couro
    p.lados(r.braco).forEach((g) => { p.enche(g, PELE_ORC, 8); p.ret(g, 0, 8, g[2], 2, COURO); p.sombra(g, 11, -14); p.pontos(g, 2, PELE_ORC2); });
    p.enche(r.braco.topo, PELE_ORC, 8); p.enche(r.braco.baixo, PELE_ORC2, 6);
    // pernas: saiote e botinas
    p.lados(r.perna).forEach((g) => { p.enche(g, '#4a3a2c', 7, 0, 5); p.enche(g, PELE_ORC, 8, 6, 8); p.enche(g, COURO2, 5, 9, 10); p.sombra(g, 10, -20); });
    p.enche(r.perna.topo, '#4a3a2c', 5); p.enche(r.perna.baixo, '#26201a', 5);
    // manto de couro com tiras verticais e penas coloridas no ombro
    p.todas(r.manto).forEach((g) => p.enche(g, COURO, 8));
    for (let i = 1; i < 9; i += 2) p.ret(r.manto.frente, i, 0, 1, 12, '#52381f');
    for (let i = 1; i < 9; i += 2) p.ret(r.manto.tras, i, 0, 1, 12, '#52381f');
    p.pontos(r.manto.tras, 6, '#c8b070');
    p.todas(r.ombro_manto).forEach((g) => { p.enche(g, COURO, 8); p.pontos(g, 8, COURO2); p.sombra(g, g[3] - 1, -18); });
    p.todas(r.pena_a).forEach((g) => p.enche(g, '#c0452a', 7));
    p.todas(r.pena_b).forEach((g) => p.enche(g, '#2f9a8a', 7));
    p.todas(r.pena_c).forEach((g) => p.enche(g, '#e0b030', 7));
    // colar de ossos: cordão escuro com ossinhos claros
    for (const g of p.todas(r.colar)) { p.enche(g, COURO2, 4); }
    for (const g of p.lados(r.colar)) for (let i = 0; i < g[2]; i += 2) p.pix(g, i, 0, OSSO);
    for (let j = 0; j < r.colar.topo[3]; j += 2) for (let i = 0; i < r.colar.topo[2]; i += 2) p.pix(r.colar.topo, i, j, OSSO);
    // cajado de madeira retorcida com o gancho do orbe
    p.todas(r.cajado).forEach((g) => { p.enche(g, '#5a3d24', 8); p.pontos(g, 4, '#2e1e12'); });
    for (const g of p.lados(r.cajado)) for (let j = 3; j < 27; j += 6) p.ret(g, 0, j, g[2], 1, '#2e1e12');
    for (const g of p.todas(r.gancho)) p.enche(g, '#4a3220', 7);
  },
  construir(m) {
    const raiz = m.raiz;
    const torso = m.pivo(raiz, 0, 11, 0);
    m.parte('corpo', torso, 0, 6, 0);
    // colar de ossos e ombros do manto (fixos no tronco)
    m.mesclar('manto_fixo', torso, [
      ['colar', 0, 11.5, -0.2], ['ombro_manto', 0, 11.5, 0.5],
      ['pena_a', -4.5, 8.5, 0.5], ['pena_b', -2.5, 8.5, 2], ['pena_c', 0, 8, 3.2], ['pena_a', 2.5, 8.5, 2], ['pena_b', 4.5, 8.5, 0.5],
      ['pena_c', -5.2, 8.2, -1.5], ['pena_a', 5.2, 8.2, -1.5],
    ]);
    // manto nas costas: balança ao andar
    const manto = m.pivo(torso, 0, 12, 2.7);
    m.parte('manto', manto, 0, -6, 0.5);
    const cab = m.pivo(torso, 0, 12, 0);
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, 4, 0], ['orelha', -4.5, 5, 0, 0, 0, 0.5], ['orelha', 4.5, 5, 0, 0, 0, -0.5],
      ['presa', -2.2, 1.5, -4.2], ['presa', 2.2, 1.5, -4.2],
      ['pena_c', -2, 9.5, 0, -0.2, 0, 0.3], ['pena_a', 0, 10, 0, -0.2, 0, 0], ['pena_b', 2, 9.5, 0, -0.2, 0, -0.3],
    ]);
    const pernaD = m.pivo(raiz, 1.8, 11, 0); m.parte('perna', pernaD, 0, -5.5, 0);
    const pernaE = m.pivo(raiz, -1.8, 11, 0); m.parte('perna', pernaE, 0, -5.5, 0);
    const bracoD = m.pivo(torso, 5, 11, 0); m.parte('braco', bracoD, 0, -5.5, 0);
    const bracoE = m.pivo(torso, -5, 11, 0); m.parte('braco', bracoE, 0, -5.5, 0);
    // cajado na mão direita (o punho mantém o cajado em pé) com orbe roxo que pulsa
    const punho = m.pivo(bracoD, 0, -11, -1);
    m.parte('cajado', punho, 0, 8, 0);
    m.parte('gancho', punho, 0, 22.5, 0);
    const matOrbe = new THREE.MeshBasicMaterial({ color: 0x8a30ff });
    const matNucleo = new THREE.MeshBasicMaterial({ color: 0xf0d8ff });
    m._basicos.push(matOrbe, matNucleo);
    const orbe = new THREE.Mesh(GEO_CUBO, matOrbe);
    const nucleo = new THREE.Mesh(GEO_CUBO, matNucleo);
    const orbeG = m.pivo(punho, 0, 25.5, 0);
    orbeG.add(orbe); orbeG.add(nucleo);
    const corA = new THREE.Color(0x6a20d8), corB = new THREE.Color(0xc884ff);
    const ESC = m._esc;
    let angA = 0.3, angF = 0, angE = 0, alto = 0;
    return (dt, vel, est) => {
      const s = Math.sin(m.fase) * 0.7 * m.amp;
      pernaD.rotation.x = s; pernaE.rotation.x = -s;
      alto = aproximar(alto, est.atacando ? 1 : 0, dt * 7);
      // ao atacar, levanta o cajado bem alto (e o outro braço faz o gesto da magia)
      const alvoA = lerp(0.3 + s * 0.25, -2.7, alto), alvoF = lerp(0, -0.35, alto);
      const alvoE = lerp(-s * 0.7, -2.0 + Math.sin(m.tempo * 14) * 0.15, alto);
      angA = aproximar(angA, alvoA, dt * 14); angF = aproximar(angF, alvoF, dt * 14); angE = aproximar(angE, alvoE, dt * 14);
      bracoD.rotation.x = angA;
      punho.rotation.x = angF - angA;            // cajado sempre em pé no mundo
      bracoE.rotation.x = angE;
      bracoD.rotation.z = -0.06; bracoE.rotation.z = 0.06;
      torso.rotation.x = -0.12 * alto;
      cab.rotation.x = -0.2 * alto; cab.rotation.y = Math.sin(m.tempo * 0.8) * 0.1;
      manto.rotation.x = 0.1 + 0.25 * m.amp + Math.sin(m.tempo * 2.2) * 0.03 + 0.15 * alto;
      // orbe: pulsa na cor e no tamanho, e gira
      const pulso = 0.5 + 0.5 * Math.sin(m.tempo * (4 + 8 * alto));
      matOrbe.color.copy(corA).lerp(corB, pulso);
      const tam = (5 + pulso * (1.2 + 1.5 * alto)) * ESC;
      orbe.scale.set(tam, tam, tam);
      const tn = 3 * ESC * (0.8 + 0.4 * (1 - pulso));
      nucleo.scale.set(tn, tn, tn);
      orbeG.rotation.set(m.tempo * 1.7, m.tempo * 2.3, 0);
    };
  },
});

// ---------------------------------------------------------------------
// DRAGÕES (chefões; 1 pixel = 1/10 de bloco; ~6.5 blocos de comprimento, ~3 de altura)
// estado: { voando, pousado, boca (0..1), atacando }
// Os 4 dragões (fogo, gelo, veneno e raio) usam o MESMO boneco: muda a paleta
// de cores, a cor dos olhos e alguns enfeites de cada elemento (chifres,
// cristais, bolsas de veneno, barbatanas elétricas), montados em construir().
// O de fogo é o original da Fase 8 (paleta sem `elemento`: nada a mais).
// ---------------------------------------------------------------------
const PALETAS_DRAGAO = {
  // fogo: escamas vermelhas, barriga dourada, chifres de marfim, olhos amarelos
  dragao: {
    semente: 8008, elemento: null,
    V: '#7e1c1a', V2: '#5a1212', OURO: '#d9a636', MARFIM: '#d6ccae', chifreRisca: '#a89e80',
    narina: '#1a0606', boca: '#8a2a2a', dente: '#efe8d0',
    osso: '#3d1010', ossoPonto: '#6a2a1a', mem: '#8a2230', memPonto: '#b0384a', nervura: '#4a0e18', memBorda: '#5a1420',
    olho: 0xffd21a, pupila: 0x3a2000,
  },
  // gelo: azul-claro e branco, chifres longos de cristal, olhos ciano
  dragao_gelo: {
    semente: 8118, elemento: 'gelo',
    V: '#8ccbe6', V2: '#4f8db2', OURO: '#eef7fb', MARFIM: '#e8f8ff', chifreRisca: '#a6d8ee',
    narina: '#24506a', boca: '#3a7aa0', dente: '#ffffff',
    osso: '#2f5f80', ossoPonto: '#6aa8cc', mem: '#bfe4f4', memPonto: '#e8f8ff', nervura: '#5f9cc2', memBorda: '#7fbad6',
    olho: 0x7af0ff, pupila: 0x0a3a5a, brilho: 0xbff4ff, brilho2: 0xffffff,
  },
  // veneno: verde-ácido, membranas roxas, bolsas de veneno que brilham
  dragao_veneno: {
    semente: 8228, elemento: 'veneno',
    V: '#3f7a26', V2: '#244a16', OURO: '#b4d84a', MARFIM: '#3a3428', chifreRisca: '#5a5040',
    narina: '#0a1a06', boca: '#6a2a6a', dente: '#e8f0c8',
    osso: '#1e3a12', ossoPonto: '#4a7a2a', mem: '#5a3a6a', memPonto: '#8a5a9a', nervura: '#2a1a3a', memBorda: '#3a2a4a',
    olho: 0xc8ff3a, pupila: 0x1a2a00, brilho: 0x7aff3a, brilho2: 0xd8ff8a,
  },
  // raio: amarelo e branco-azulado, chifres em zigue-zague, barbatanas elétricas
  dragao_raio: {
    semente: 8338, elemento: 'raio',
    V: '#dcb42a', V2: '#8a6a14', OURO: '#f4f0e0', MARFIM: '#2e3a5e', chifreRisca: '#5a6a9a',
    narina: '#2a2000', boca: '#3a5aa0', dente: '#ffffff',
    osso: '#2a2e4a', ossoPonto: '#5a6aa0', mem: '#2c3566', memPonto: '#4a5aa0', nervura: '#f0d440', memBorda: '#8aa0ff',
    olho: 0xcfeeff, pupila: 0x1a3a8a, brilho: 0xbfe6ff, brilho2: 0xfff6a0,
  },
};

/** Definição (registrarModelo) de um dragão com a paleta `pal` */
function criarDefDragao(pal) {
  const partes = {
    tronco: [14, 12, 24], espinho: [2, 3, 2],
    pesc1: [8, 8, 5], pesc2: [7, 7, 5], pesc3: [6, 6, 5],
    cabeca: [8, 6, 8], focinho: [6, 4, 7], mandibula: [5, 2, 11], chifre: [2, 2, 6], dente: [1, 2, 1],
    cauda1: [8, 7, 5], cauda2: [7, 6, 5], cauda3: [5, 5, 5], cauda4: [4, 4, 5],
    coxa: [5, 6, 6], canela: [4, 5, 4], pe: [5, 2, 7], garra: [1, 1, 3],
    osso1: [12, 3, 3], osso2: [12, 2, 2], osso3: [10, 2, 2],
    mem1: [12, 1, 12], mem2: [12, 1, 10], mem3: [10, 1, 8],
  };
  // Peças a mais dos elementais (o de fogo não tem nenhuma: a skin dele fica igual)
  if (pal.elemento) partes.chifreLongo = [2, 2, 10];
  return {
    esc: 0.1, altura: 3.2, raio: 1.1, meiaLargura: 0.75, passo: 1.5, semente: pal.semente, largura: 128,
    partes,
    pintar(p, r) {
      const V = pal.V, V2 = pal.V2, OURO = pal.OURO, MARFIM = pal.MARFIM;
      // segmento de corpo: escamas por cima e dos lados, placas da barriga embaixo
      const segmento = (g) => {
        for (const reg of [g.topo, g.direita, g.esquerda, g.frente, g.tras]) p.escamas(reg, V, 7, 4, 3);
        p.escamas(g.baixo, OURO, 6, 6, 2);
      };
      // tronco: a barriga sobe um pouco pelos lados
      const t = r.tronco;
      p.escamas(t.topo, V, 7, 4, 3);
      for (const g of [t.direita, t.esquerda, t.frente, t.tras]) {
        p.escamas(g, V, 7, 4, 3);
        const j0 = g[3] - 4;
        p.escamas([g[0], g[1] + j0, g[2], g[3] - j0], OURO, 6, 6, 2);
      }
      p.escamas(t.baixo, OURO, 6, 6, 2);
      p.todas(r.espinho).forEach((g) => p.enche(g, V2, 6));
      p.sombra(r.espinho.frente, 0, 15);
      for (const nome of ['pesc1', 'pesc2', 'pesc3', 'cauda1', 'cauda2', 'cauda3', 'cauda4']) segmento(r[nome]);
      for (const nome of ['coxa', 'canela']) segmento(r[nome]);
      p.todas(r.pe).forEach((g) => p.escamas(g, V2, 6, 4, 2));
      p.todas(r.garra).forEach((g) => p.enche(g, MARFIM, 5));
      // cabeça: escamas, sobrancelha escura, narinas; mandíbula com o interior da boca
      for (const g of p.todas(r.cabeca)) p.escamas(g, V, 7, 3, 3);
      for (const g of [r.cabeca.direita, r.cabeca.esquerda, r.cabeca.frente]) p.ret(g, 0, 0, g[2], 1, V2);
      for (const g of p.todas(r.focinho)) p.escamas(g, V, 6, 3, 3);
      p.pix(r.focinho.frente, 1, 1, pal.narina); p.pix(r.focinho.frente, 4, 1, pal.narina);
      for (const g of p.lados(r.mandibula)) p.escamas(g, V, 6, 3, 2);
      p.escamas(r.mandibula.baixo, OURO, 5, 4, 2);
      p.enche(r.mandibula.topo, pal.boca, 6);
      p.todas(r.chifre).forEach((g) => {
        p.enche(g, MARFIM, 6);
        for (let j = 1; j < g[3]; j += 2) p.ret(g, 0, j, g[2], 1, pal.chifreRisca);
      });
      p.todas(r.dente).forEach((g) => p.enche(g, pal.dente, 4));
      // asas: ossos escuros e membranas com nervuras
      for (const nome of ['osso1', 'osso2', 'osso3']) p.todas(r[nome]).forEach((g) => { p.enche(g, pal.osso, 7); p.pontos(g, 3, pal.ossoPonto); p.sombra(g, 0, 12); });
      for (const nome of ['mem1', 'mem2', 'mem3']) {
        const m = r[nome];
        for (const g of p.todas(m)) p.enche(g, pal.mem, 9);
        for (const g of [m.topo, m.baixo]) {
          const w = g[2], d = g[3];
          p.pontos(g, 8, pal.memPonto);
          p.linha(g, 0, 0, w - 1, d - 1, pal.nervura);
          p.linha(g, 0, 0, w - 1, Math.floor(d / 2), pal.nervura);
          p.linha(g, 0, 0, Math.floor(w / 2), d - 1, pal.nervura);
          p.ret(g, 0, d - 1, w, 1, pal.memBorda);                 // bordinha da membrana
        }
      }
      if (!pal.elemento) return; // o de fogo termina aqui (igual ao original)
      // ----- detalhes pintados dos elementais (depois de tudo: não mexem no resto) -----
      p.todas(r.chifreLongo).forEach((g) => {
        p.enche(g, MARFIM, 6);
        for (let j = 1; j < g[3]; j += 3) p.ret(g, 0, j, g[2], 1, pal.chifreRisca);
      });
      if (pal.elemento === 'gelo') {
        // geada: pontinhos brancos nas costas e na cabeça
        p.pontos(t.topo, 26, '#ffffff');
        p.pontos(r.cabeca.topo, 6, '#ffffff');
        for (const g of [t.direita, t.esquerda]) p.pontos(g, 10, '#e8fbff');
      } else if (pal.elemento === 'veneno') {
        // manchas escuras e pintas amarelas (sapo venenoso)
        for (const g of [t.topo, t.direita, t.esquerda]) { p.pontos(g, 14, '#1a3a0e'); p.pontos(g, 8, '#e0f040'); }
        for (const nome of ['cauda1', 'cauda2', 'pesc1']) p.pontos(r[nome].topo, 4, '#e0f040');
      } else if (pal.elemento === 'raio') {
        // raios brancos em zigue-zague pelos lados do corpo
        for (const g of [t.direita, t.esquerda]) {
          const w = g[2];
          for (let x0 = 2; x0 < w - 4; x0 += 7) {
            p.linha(g, x0, 0, x0 + 2, 3, '#fffbe0');
            p.linha(g, x0 + 2, 3, x0 + 1, 4, '#fffbe0');
            p.linha(g, x0 + 1, 4, x0 + 3, 7, '#fffbe0');
          }
        }
        p.pontos(t.topo, 10, '#fffbe0');
      }
    },
    construir(m) {
      return construirDragao(m, pal);
    },
  };
}

/** Monta o boneco do dragão (pal = paleta; pal.elemento escolhe os enfeites) */
function construirDragao(m, pal) {
    const raiz = m.raiz;
    const ESC = m._esc;
    const el = pal.elemento;
    const corpo = m.pivo(raiz, 0, 0, 0);      // balança no voo
    // tronco + espinhos do dorso (nada disso se mexe: uma malha só)
    const itens = [['tronco', 0, 16, 0]];
    for (let k = 0; k < 6; k++) itens.push(['espinho', 0, 23.2 - (k === 0 || k === 5 ? 0.5 : 0), -9 + k * 3.6, -0.35, 0, 0]);
    m.mesclar('tronco', corpo, itens);

    // ----- pescoço (3 segmentos) e cabeça -----
    const pc0 = m.pivo(corpo, 0, 18, -11);
    m.parte('pesc1', pc0, 0, 0, -2.5);
    const pc1 = m.pivo(pc0, 0, 0, -5);
    m.parte('pesc2', pc1, 0, 0, -2.5);
    const pc2 = m.pivo(pc1, 0, 0, -5);
    m.parte('pesc3', pc2, 0, 0, -2.5);
    const cabeca = m.pivo(pc2, 0, 0, -5);
    const itensCabeca = [
      ['cabeca', 0, 0, -4], ['focinho', 0, -1, -11.5],
      ['dente', -2.5, -4, -9], ['dente', 2.5, -4, -9], ['dente', -2.5, -4, -11.5], ['dente', 2.5, -4, -11.5],
      ['dente', -2.5, -4, -14], ['dente', 2.5, -4, -14],
    ];
    if (el === 'gelo') {
      // dois chifres longos e retos para trás + dois chifrinhos em cima do focinho
      itensCabeca.push(['chifreLongo', -2.6, 4, 2, -0.32, -0.12, 0], ['chifreLongo', 2.6, 4, 2, -0.32, 0.12, 0]);
      itensCabeca.push(['chifre', -1.6, 1.8, -8.5, -1.0, 0, 0], ['chifre', 1.6, 1.8, -8.5, -1.0, 0, 0]);
    } else if (el === 'veneno') {
      // chifres curvos para a frente e "babados" espinhudos dos lados da cabeça
      itensCabeca.push(['chifre', -3, 3.5, -1, 0.55, 0, 0.25], ['chifre', 3, 3.5, -1, 0.55, 0, -0.25]);
      for (const s of [-1, 1]) {
        itensCabeca.push(['espinho', s * 4.6, 0.5, -1, 0, 0, s * 1.1], ['espinho', s * 4.6, -1.5, -3, 0, 0, s * 1.2], ['espinho', s * 4.2, 1.8, 1, 0, 0, s * 0.9]);
      }
    } else if (el === 'raio') {
      // chifres em zigue-zague: um pedaço sobe para trás e outro dobra para cima
      for (const s of [-1, 1]) {
        itensCabeca.push(['chifre', s * 3, 3.5, 0.5, -0.9, 0, 0]);
        itensCabeca.push(['chifreLongo', s * 3.4, 7.2, 4.5, 0.55, s * 0.25, 0]);
      }
    } else {
      itensCabeca.push(['chifre', -3, 3.5, 0.5, -0.5, 0, 0], ['chifre', 3, 3.5, 0.5, -0.5, 0, 0]);
    }
    m.mesclar('cabeca', cabeca, itensCabeca);
    m.mesclarBrilho('olhos', cabeca, [
      [pal.olho, 1.8, 1.6, 2.4, -3.3, 1.3, -7.3], [pal.olho, 1.8, 1.6, 2.4, 3.3, 1.3, -7.3],
      [pal.pupila, 0.8, 1.6, 0.6, -3.3, 1.3, -8.5], [pal.pupila, 0.8, 1.6, 0.6, 3.3, 1.3, -8.5],
    ]);
    // Enfeites que brilham (não dependem da luz: aparecem até de noite)
    if (el === 'gelo') {
      // cristais de gelo saindo das costas, entre os espinhos
      const cr = [];
      for (let k = 0; k < 5; k++) {
        const alto = 3.5 + (k % 2) * 2;
        cr.push([k % 2 ? pal.brilho : pal.brilho2, 1.4, alto, 1.4, (k % 2 ? 1.6 : -1.6), 22 + alto / 2, -7.2 + k * 3.6]);
      }
      m.mesclarBrilho('cristais', corpo, cr);
    } else if (el === 'veneno') {
      // bolsas de veneno verdes nas costas e no pescoço
      m.mesclarBrilho('bolsas', corpo, [
        [pal.brilho, 3, 2.2, 3, -3.5, 22.4, -4], [pal.brilho, 3, 2.2, 3, 3.5, 22.4, 1],
        [pal.brilho2, 2.4, 1.8, 2.4, -3.2, 22.3, 6], [pal.brilho, 2.4, 2, 2.4, 3.3, 22.3, -8.5],
      ]);
      m.mesclarBrilho('baba', cabeca, [[pal.brilho, 1, 2.5, 1, -1.5, -5.2, -12], [pal.brilho2, 1, 1.6, 1, 1.8, -4.8, -10]]);
    } else if (el === 'raio') {
      // barbatanas elétricas finas e altas ao longo do dorso
      const fins = [];
      for (let k = 0; k < 6; k++) fins.push([k % 2 ? pal.brilho : pal.brilho2, 0.6, 3 + (k % 3), 2.4, 0, 24 + (k % 3) / 2, -9 + k * 3.6]);
      m.mesclarBrilho('barbatanas', corpo, fins);
    }
    const mandibula = m.pivo(cabeca, 0, -3, -3);
    m.mesclar('mandibula', mandibula, [
      ['mandibula', 0, -1, -5.5],
      ['dente', -2, 0.8, -4], ['dente', 2, 0.8, -4], ['dente', -2, 0.8, -7], ['dente', 2, 0.8, -7], ['dente', -2, 0.8, -10], ['dente', 2, 0.8, -10],
    ]);

    // ----- cauda (4 segmentos) -----
    const cauda = [];
    let pai = corpo, px = 0, py = 15, pz = 11;
    for (let i = 0; i < 4; i++) {
      const pv = m.pivo(pai, px, py, pz);
      const nome = 'cauda' + (i + 1);
      if (i === 3) m.mesclar('cauda4', pv, [['cauda4', 0, 0, 2.5], ['espinho', 0, 0, 6, Math.PI / 2, 0, 0], ['espinho', 0, 1.8, 3.5, -0.35, 0, 0]]);
      else m.parte(nome, pv, 0, 0, 2.5);
      cauda.push(pv);
      pai = pv; px = 0; py = 0; pz = 5;
    }
    // Ponta da cauda dos elementais: cristal de gelo, ferrão de veneno ou bola de energia
    let pontaCauda = null;
    if (el === 'gelo') pontaCauda = m.caixaBrilho(cauda[3], pal.brilho, 2.2, 2.2, 4.5, 0, 0, 7.5);
    else if (el === 'veneno') pontaCauda = m.caixaBrilho(cauda[3], pal.brilho, 2.6, 2.6, 2.6, 0, 1, 7);
    else if (el === 'raio') pontaCauda = m.caixaBrilho(cauda[3], pal.brilho2, 2.4, 2.4, 2.4, 0, 0, 7);

    // ----- pernas: coxa + canela + pé com garras -----
    const pernas = [];
    for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
      const quadril = m.pivo(corpo, x, 12, z);
      m.parte('coxa', quadril, 0, -2.5, 0);
      const joelho = m.pivo(quadril, 0, -5.5, 0);
      m.parte('canela', joelho, 0, -2.5, 0);
      const tornozelo = m.pivo(joelho, 0, -5, 0);
      m.mesclar('pe', tornozelo, [
        ['pe', 0, -0.5, -1.5], ['garra', -1.8, -0.5, -5.5], ['garra', 0, -0.5, -5.5], ['garra', 1.8, -0.5, -5.5],
      ]);
      pernas.push({ quadril, joelho, tornozelo, par: (x < 0) === (z < 0) ? 1 : -1 });
    }

    // ----- asas: 3 segmentos de osso com membrana atrás de cada um -----
    const asas = [];
    for (const s of [-1, 1]) {
      const p1 = m.pivo(corpo, s * 7, 21, -6);
      m.parte('osso1', p1, s * 6, 0, 0); m.parte('mem1', p1, s * 6, -0.3, 7.5);
      const p2 = m.pivo(p1, s * 12, 1.2, 0);
      m.parte('osso2', p2, s * 6, 0, 0); m.parte('mem2', p2, s * 6, -0.3, 6.5);
      m.parte('garra', p2, s * 0.5, 0, -2.5);
      const p3 = m.pivo(p2, s * 12, 1.2, 0);
      m.parte('osso3', p3, s * 5, 0, 0); m.parte('mem3', p3, s * 5, -0.3, 5.5);
      asas.push({ s, p1, p2, p3 });
    }

    let abre = 0, voo = 0, boca = 0;
    return (dt, vel, est) => {
      const voando = !!est.voando && !est.pousado;
      abre = aproximar(abre, voando ? 1 : 0, dt * 2.5);
      voo = aproximar(voo, voando ? 1 : 0, dt * 2.5);
      const alvoBoca = est.boca !== undefined ? limitar(est.boca, 0, 1) : (est.atacando ? 0.7 : 0);
      boca = aproximar(boca, alvoBoca, dt * 12);
      const t = m.tempo;

      // balanço do corpo: sobe e desce com as batidas das asas
      const ph = t * 4.2;
      corpo.position.y = voo * Math.sin(ph - 0.4) * 1.6 * ESC;
      corpo.rotation.x = voo * (-0.05 + Math.cos(ph - 0.4) * 0.03);

      // asas
      for (const { s, p1, p2, p3 } of asas) {
        const lift = Math.sin(ph);
        // aberta (batendo) x fechada (dobrada junto ao corpo, em Z)
        p1.rotation.set(0, -s * lerp(1.35, 0.3, abre), s * lerp(0.15, 0.2 + 0.6 * lift, abre));
        p2.rotation.set(0, s * lerp(2.6, 0.08, abre), s * lerp(0, 0.5 * Math.sin(ph - 0.8) - 0.1, abre));
        p3.rotation.set(0, -s * lerp(2.6, 0.15, abre), s * lerp(0, 0.65 * Math.sin(ph - 1.6), abre));
      }

      // pescoço: curva em "S" no chão, esticado para a frente no voo; a cabeça fica nivelada
      const bal = Math.sin(t * 1.3) * 0.05;
      const a0 = lerp(0.55, 0.3, voo) + bal, a1 = lerp(0.2, 0.1, voo) + bal * 0.8, a2 = lerp(0, -0.1, voo) + bal * 0.6;
      pc0.rotation.x = a0; pc1.rotation.x = a1; pc2.rotation.x = a2;
      pc0.rotation.y = Math.sin(t * 0.8) * 0.08; pc1.rotation.y = Math.sin(t * 0.8 - 0.5) * 0.08;
      cabeca.rotation.x = -(a0 + a1 + a2) + 0.05 + boca * 0.3;
      mandibula.rotation.x = -boca * 0.75;

      // cauda: onda que vai da base até a ponta
      const agit = 0.35 + 0.4 * m.amp + 0.25 * voo;
      for (let i = 0; i < 4; i++) {
        cauda[i].rotation.y = Math.sin(t * 1.9 - i * 0.9) * 0.28 * agit;
        cauda[i].rotation.x = 0.1 + Math.sin(t * 1.5 - i * 0.8) * 0.06 + voo * 0.08;
      }

      // pernas: andam em diagonal; no voo ficam dobradas para trás
      for (const { quadril, joelho, tornozelo, par } of pernas) {
        const anda = Math.sin(m.fase + (par > 0 ? 0 : Math.PI)) * 0.55 * m.amp * (1 - voo);
        const dobra = Math.max(0, Math.cos(m.fase + (par > 0 ? 0 : Math.PI))) * 0.5 * m.amp * (1 - voo);
        quadril.rotation.x = anda - 0.7 * voo;
        joelho.rotation.x = 0.25 + dobra + 1.3 * voo;
        tornozelo.rotation.x = -0.25 - dobra * 0.6 - 0.6 * voo;
      }

      // ponta da cauda pulsando (a de raio pisca rápido, como uma faísca)
      if (pontaCauda) {
        const f = el === 'raio' ? 0.75 + 0.35 * Math.abs(Math.sin(t * 17)) : 0.9 + 0.12 * Math.sin(t * 3.2);
        pontaCauda.scale.set(f * (el === 'gelo' ? 2.2 : 2.5) * ESC, f * (el === 'gelo' ? 2.2 : 2.5) * ESC, f * (el === 'gelo' ? 4.5 : 2.5) * ESC);
      }
    };
}

registrarModelo('dragao', criarDefDragao(PALETAS_DRAGAO.dragao));
registrarModelo('dragao_gelo', criarDefDragao(PALETAS_DRAGAO.dragao_gelo));
registrarModelo('dragao_veneno', criarDefDragao(PALETAS_DRAGAO.dragao_veneno));
registrarModelo('dragao_raio', criarDefDragao(PALETAS_DRAGAO.dragao_raio));

// ---------------------------------------------------------------------
// HIDRA (chefão; 1 pixel = 1/10 de bloco; ~4 blocos de altura)
// estado: { cabecaAtacando: [fogo, gelo, veneno] }  (true/false ou 0..1)
// ---------------------------------------------------------------------
const ELEM = [
  { sufixo: 'f', cor: '#b8302a', escura: '#7a1814', jaw: '#e8b070', olho: 0xff7a1a },   // fogo
  { sufixo: 'g', cor: '#8fd0e6', escura: '#4f90b0', jaw: '#e8f4f8', olho: 0xb8f4ff },   // gelo
  { sufixo: 'v', cor: '#4aa83a', escura: '#2a6a22', jaw: '#c8e08a', olho: 0x7aff3a },   // veneno
];
const partesHidra = {
  tronco: [20, 9, 26], espinho: [2, 3, 2], pesc: [6, 6, 6], pesc2: [5, 5, 6],
  coxa: [6, 5, 6], garra: [1, 1, 3], cauda1: [10, 6, 7], cauda2: [8, 5, 7], cauda3: [6, 4, 7], dente: [1, 2, 1],
};
for (const e of ELEM) {
  partesHidra['cabeca_' + e.sufixo] = [7, 6, 7];
  partesHidra['focinho_' + e.sufixo] = [5, 3, 6];
  partesHidra['mand_' + e.sufixo] = [4, 2, 9];
  partesHidra['crista_' + e.sufixo] = [1, 3, 4];
}

registrarModelo('hidra', {
  esc: 0.1, altura: 4.2, raio: 1.3, meiaLargura: 0.7, passo: 1.6, semente: 9119, largura: 128,
  partes: partesHidra,
  pintar(p, r) {
    const VERDE = '#2f7a6c', CLARO = '#c5c98f';
    const corpoEscamas = (g) => {
      for (const reg of [g.topo, g.direita, g.esquerda, g.frente, g.tras]) p.escamas(reg, VERDE, 7, 4, 3);
      p.escamas(g.baixo, CLARO, 5, 6, 2);
    };
    const t = r.tronco;
    p.escamas(t.topo, VERDE, 7, 4, 3);
    for (const g of [t.direita, t.esquerda, t.frente, t.tras]) {
      p.escamas(g, VERDE, 7, 4, 3);
      const j0 = g[3] - 3;
      p.escamas([g[0], g[1] + j0, g[2], g[3] - j0], CLARO, 5, 6, 2);
    }
    p.escamas(t.baixo, CLARO, 5, 6, 2);
    p.pontos(t.topo, 20, '#1a4a44'); p.pontos(t.topo, 14, '#5fb5a5');
    for (const nome of ['pesc', 'pesc2', 'coxa', 'cauda1', 'cauda2', 'cauda3']) corpoEscamas(r[nome]);
    p.todas(r.espinho).forEach((g) => p.enche(g, '#1a4a44', 6));
    p.todas(r.garra).forEach((g) => p.enche(g, '#e0d8b8', 5));
    p.todas(r.dente).forEach((g) => p.enche(g, '#efe8d0', 4));
    // cabeças coloridas por elemento
    for (const e of ELEM) {
      const c = r['cabeca_' + e.sufixo], f = r['focinho_' + e.sufixo], mand = r['mand_' + e.sufixo], cr = r['crista_' + e.sufixo];
      for (const g of p.todas(c)) p.escamas(g, e.cor, 7, 3, 3);
      for (const g of [c.direita, c.esquerda, c.frente]) p.ret(g, 0, 0, g[2], 1, e.escura);
      for (const g of p.todas(f)) p.escamas(g, e.cor, 6, 3, 3);
      p.pix(f.frente, 1, 0, '#101010'); p.pix(f.frente, 3, 0, '#101010');
      for (const g of p.lados(mand)) p.escamas(g, e.cor, 6, 3, 2);
      p.escamas(mand.baixo, e.jaw, 5, 4, 2);
      p.enche(mand.topo, '#8a2a2a', 6);
      for (const g of p.todas(cr)) p.enche(g, e.escura, 8);
    }
  },
  construir(m) {
    const raiz = m.raiz;
    const itens = [['tronco', 0, 9.5, 0]];
    for (let k = 0; k < 6; k++) itens.push(['espinho', 0, 15.2, -9 + k * 3.6, -0.3, 0, 0]);
    for (const x of [-6.5, 6.5]) for (const z of [-7, -1, 5]) itens.push(['espinho', x, 14.5, z, 0, 0, x < 0 ? 0.35 : -0.35]);
    m.mesclar('tronco', raiz, itens);

    // 4 patas curtas com garras
    const pernas = [];
    for (const [x, z] of [[-7.5, -8], [7.5, -8], [-7.5, 8], [7.5, 8]]) {
      const pv = m.pivo(raiz, x, 5.5, z);
      m.mesclar('pata', pv, [['coxa', 0, -2.5, 0], ['garra', -1.7, -4.8, -4], ['garra', 0, -4.8, -4], ['garra', 1.7, -4.8, -4]]);
      pernas.push({ pv, par: (x < 0) === (z < 0) ? 1 : -1 });
    }
    // cauda curta (3 segmentos)
    const cauda = [];
    let pai = raiz, py = 10, pz = 12.5;
    for (let i = 0; i < 3; i++) {
      const pv = m.pivo(pai, 0, py, pz);
      m.parte('cauda' + (i + 1), pv, 0, 0, 3.5);
      cauda.push(pv); pai = pv; py = 0; pz = 7;
    }

    // 3 pescoços de 6 segmentos, cada um com uma cabeça de um elemento
    const ANG = [1.2, 0.35, 0, -0.45, -0.55, -0.55];       // soma 0: a cabeça termina olhando para a frente
    const SEGS = 6;
    const pescocos = [];
    ELEM.forEach((e, k) => {
      const x = (k - 1) * 6.5;
      const base = m.pivo(raiz, x, 12, -11);
      base.rotation.order = 'YXZ';
      let pv = base;
      const segs = [base];
      for (let i = 0; i < SEGS; i++) {
        m.parte(i < 2 ? 'pesc' : 'pesc2', pv, 0, 0, -3);
        const prox = m.pivo(pv, 0, 0, -6);
        prox.rotation.order = 'YXZ';
        if (i < SEGS - 1) segs.push(prox);
        pv = prox;
      }
      const cabeca = pv;       // pivô depois do último segmento
      cabeca.rotation.order = 'YXZ';
      m.mesclar('cabeca_' + e.sufixo, cabeca, [
        ['cabeca_' + e.sufixo, 0, 0, -3.5], ['focinho_' + e.sufixo, 0, -1.2, -10],
        ['crista_' + e.sufixo, 0, 4.5, -2.5, -0.2, 0, 0],
        ['dente', -1.8, -3.7, -8], ['dente', 1.8, -3.7, -8], ['dente', -1.8, -3.7, -10.5], ['dente', 1.8, -3.7, -10.5], ['dente', -1.8, -3.7, -12.5], ['dente', 1.8, -3.7, -12.5],
      ]);
      m.mesclarBrilho('olhos_' + e.sufixo, cabeca, [
        [e.olho, 1.6, 1.6, 2, -3.1, 1.2, -6.3], [e.olho, 1.6, 1.6, 2, 3.1, 1.2, -6.3],
      ]);
      const mand = m.pivo(cabeca, 0, -2.7, -2);
      m.mesclar('mand_' + e.sufixo, mand, [
        ['mand_' + e.sufixo, 0, -1, -4.5],
        ['dente', -1.5, 1, -3], ['dente', 1.5, 1, -3], ['dente', -1.5, 1, -6], ['dente', 1.5, 1, -6], ['dente', -1.5, 1, -9], ['dente', 1.5, 1, -9],
      ]);
      pescocos.push({ k, base, segs, cabeca, mand, ciclo: 0, ativo: false, aberto: 0 });
    });

    return (dt, vel, est) => {
      const t = m.tempo;
      const atq = est.cabecaAtacando;
      // pernas e cauda
      for (const { pv, par } of pernas) pv.rotation.x = Math.sin(m.fase + (par > 0 ? 0 : Math.PI)) * 0.5 * m.amp;
      for (let i = 0; i < 3; i++) {
        cauda[i].rotation.y = Math.sin(t * 1.5 - i * 0.9) * 0.3 * (0.5 + m.amp);
        cauda[i].rotation.x = 0.12 + Math.sin(t * 1.2 - i * 0.7) * 0.05;
      }
      for (const pc of pescocos) {
        const k = pc.k;
        const quer = !!(atq && atq[k]);
        // ciclo do ataque: recua (0 a 0.45 s), dá o bote (até 0.6), segura e volta (até 1.3)
        if (quer || pc.ciclo > 0) {
          pc.ciclo += dt;
          if (pc.ciclo >= 1.3) pc.ciclo = quer ? 0.01 : 0;
        }
        const c = pc.ciclo;
        let recuo = 0, abre = 0;
        if (c > 0) {
          if (c < 0.45) { const u = c / 0.45; recuo = u; abre = 0.2 * u; }
          else if (c < 0.6) { const u = (c - 0.45) / 0.15; recuo = lerp(1, -1, u); abre = lerp(0.2, 1, u); }
          else if (c < 1.0) { recuo = -1; abre = 1; }
          else { const u = (c - 1.0) / 0.3; recuo = lerp(-1, 0, u); abre = lerp(1, 0, u); }
        }
        // ondulação calma de cada pescoço (cada um com sua fase)
        let soma = 0;
        pc.base.rotation.y = (k - 1) * -0.3 + Math.sin(t * 0.9 + k * 2.1) * 0.1;
        for (let i = 0; i < pc.segs.length; i++) {
          const a = ANG[i] + Math.sin(t * 1.4 + i * 0.7 + k * 2.1) * 0.07 + recuo * 0.15;
          pc.segs[i].rotation.x = a;
          if (i > 0) pc.segs[i].rotation.y = Math.sin(t * 1.1 + i * 0.6 + k * 1.7) * 0.1;
          soma += a;
        }
        // a cabeça compensa a soma dos ângulos (fica nivelada) e baixa no bote
        pc.cabeca.rotation.x = -soma + (recuo < 0 ? 0.5 * recuo : 0);
        pc.aberto = aproximar(pc.aberto, abre, dt * 14);
        pc.mand.rotation.x = -pc.aberto * 0.8;
      }
    };
  },
});

// =====================================================================
// FASE 11: montarias (cavalo, lobo gigante, aranha montaria, filhote de
// dragão) e o cachorro (pet). Todas têm sela e armadura visíveis.
// =====================================================================

// Cores da armadura de montaria por material: base, filete (brilho) e escura (faixas)
const PALETA_ARMADURA = {
  ferro: { base: '#9aa1aa', filete: '#d2d8df', escura: '#5d636b' },
  ouro: { base: '#e6b422', filete: '#fff1a0', escura: '#a8780f' },
  diamante: { base: '#3cd6d0', filete: '#b8fff7', escura: '#1b8c96' },
};

// Sela de couro com manta, encosto, pomo, abas e estribos de metal.
// s = { y: topo do dorso, z: centro da sela, w: largura do corpo, d: comprimento da sela, ey: altura dos estribos }
function itensSela(s) {
  const { y, z, w, d, ey } = s;
  const COURO = '#82522b', COURO2 = '#5a371b', MANTA = '#a33434', METAL = '#bcbcc4';
  const L = [
    [MANTA, w + 0.8, 0.8, d + 2.4, 0, y + 0.4, z],              // manta vermelha por baixo
    [COURO, w * 0.7, 1.0, d, 0, y + 1.0, z],                     // assento
    [COURO2, w * 0.7, 2.0, 1.2, 0, y + 1.6, z + d / 2],          // encosto
    [COURO2, w * 0.28, 1.8, 1.2, 0, y + 1.5, z - d / 2],         // pomo da frente
  ];
  const ex = w / 2 + 0.9;
  for (const sg of [-1, 1]) {
    L.push([COURO2, 0.8, 3.2, d * 0.9, sg * (w / 2 + 0.4), y - 1.2, z]);   // aba lateral
    const topo = y - 1.0, comp = topo - (ey + 0.6);
    L.push([COURO, 0.5, comp, 0.7, sg * ex, topo - comp / 2, z]);          // correia
    L.push([METAL, 1.4, 0.6, 2.4, sg * ex, ey + 0.3, z]);                  // base do estribo
    L.push([METAL, 1.4, 2.0, 0.4, sg * ex, ey + 1.2, z - 1.1]);            // aro da frente
    L.push([METAL, 1.4, 2.0, 0.4, sg * ex, ey + 1.2, z + 1.1]);            // aro de trás
  }
  return L;
}

// Manta de metal sobre o corpo: dorso, laterais com faixa e rebites, peitoral e traseira
function itensArmaduraCorpo(c, pal) {
  const { w, h, d, y, z } = c;
  const xs = w / 2 + 0.4, topo = y + h / 2, cy = topo - h * 0.425;
  const L = [[pal.base, w + 1.2, 0.5, d * 0.8, 0, topo + 0.25, z]];
  for (const sg of [-1, 1]) {
    L.push([pal.base, 0.8, h * 0.85, d * 0.92, sg * xs, cy, z]);                       // painel
    L.push([pal.escura, 0.95, h * 0.18, d * 0.82, sg * (xs + 0.05), cy - h * 0.1, z]); // faixa
    L.push([pal.filete, 1.0, 0.7, d * 0.92, sg * (xs + 0.05), topo - h * 0.85, z]);    // borda de baixo
    L.push([pal.filete, 1.0, 0.6, d * 0.92, sg * (xs + 0.05), topo - 0.3, z]);         // borda de cima
    for (let k = 0; k < 3; k++) L.push([pal.filete, 0.5, 0.5, 0.5, sg * (xs + 0.55), cy + h * 0.12, z + (k - 1) * d * 0.3]); // rebites
  }
  L.push([pal.base, w + 0.8, h * 0.8, 0.9, 0, topo - h * 0.4, z - d / 2 - 0.45]);      // peitoral
  L.push([pal.filete, w * 0.3, h * 0.3, 0.5, 0, y + h * 0.1, z - d / 2 - 1.0]);        // brasão
  L.push([pal.base, w + 0.8, h * 0.8, 0.9, 0, topo - h * 0.4, z + d / 2 + 0.45]);      // traseira
  return L;
}

// Chanfro (proteção da cabeça): c = caixa da cabeça (centro x, y, z relativo ao pai)
function itensArmaduraCabeca(c, pal) {
  const { w, h, d, x, y, z } = c;
  const L = [
    [pal.base, w + 0.8, 0.8, d * 0.7, x, y + h / 2 + 0.4, z - d * 0.05],
    [pal.filete, w * 0.3, 0.6, d * 0.72, x, y + h / 2 + 0.95, z - d * 0.05],
  ];
  for (const sg of [-1, 1]) {
    L.push([pal.base, 0.7, h * 0.7, d * 0.62, x + sg * (w / 2 + 0.35), y + h * 0.1, z]);
    L.push([pal.filete, 0.8, 0.5, d * 0.62, x + sg * (w / 2 + 0.4), y - h * 0.25, z]);
    L.push([pal.filete, 0.5, 0.5, 0.5, x + sg * (w / 2 + 0.8), y + h * 0.15, z]);
  }
  return L;
}

// Bandas de metal empilhadas no pescoço (cavalo)
function itensArmaduraPescoco(c, pal) {
  const { w, h, d, x, y, z } = c;
  const L = [];
  for (let k = 0; k < 3; k++) {
    const yy = y - h / 2 + (k + 0.5) * h / 3;
    L.push([pal.base, w + 0.8, h / 3 - 0.5, d + 0.8, x, yy, z]);
    L.push([pal.filete, w + 1.0, 0.4, d + 1.0, x, yy + h / 6 - 0.1, z]);
  }
  return L;
}

/**
 * Liga a sela, a armadura e o assento ao modelo de uma montaria.
 * cfg = { sela: {pai, y, z, w, d, ey}, corpo: {pai, w, h, d, y, z},
 *         cabeca: {pai, w, h, d, x, y, z}, pescoco?: {pai, w, h, d, x, y, z} }
 * Tudo em pixels do modelo. As peças só são criadas na primeira vez que são pedidas.
 */
function instalarEquipamento(m, cfg) {
  const s = cfg.sela;
  // o assento acompanha o pai da sela (balança junto com o tronco)
  s.pai.add(m.assento);
  m.assento.position.set(0, (s.y + 1.6) * m._esc, s.z * m._esc);
  let sela = null;
  m.definirSela = (ligada) => {
    if (ligada && !sela) sela = m.mesclarCor('sela', s.pai, itensSela(s));
    if (sela) sela.visible = !!ligada;
  };
  const feitas = {};       // material -> lista de malhas
  let atual = null;
  m.definirArmaduraMontaria = (material) => {
    if (atual) for (const x of atual) x.visible = false;
    atual = null;
    const pal = PALETA_ARMADURA[material];
    if (!pal) return;
    if (!feitas[material]) {
      const l = [m.mesclarCor('arm_' + material + '_corpo', cfg.corpo.pai, itensArmaduraCorpo(cfg.corpo, pal)),
        m.mesclarCor('arm_' + material + '_cabeca', cfg.cabeca.pai, itensArmaduraCabeca(cfg.cabeca, pal))];
      if (cfg.pescoco) l.push(m.mesclarCor('arm_' + material + '_pescoco', cfg.pescoco.pai, itensArmaduraPescoco(cfg.pescoco, pal)));
      feitas[material] = l;
    }
    atual = feitas[material];
    for (const x of atual) x.visible = true;
  };
}

// Posição (índice i) na borda da frente de um lado da cabeça: a frente fica na
// borda direita do lado +x e na borda esquerda do lado -x (layout da skin)
const bordaFrente = (reg, direita, k) => (direita ? reg[2] - 1 - k : k);

// ---------------------------------------------------------------------
// CAVALO (1 pixel = 1/16 de bloco; ~1.65 de altura até as orelhas, ~2.1 de comprimento)
// ---------------------------------------------------------------------
const PELAGENS_CAVALO = [
  { pelo: '#8a5630', sombra: '#6b4024', luz: '#a26c40', crina: '#22150d', perna: '#2a1a12', casco: '#1f1816', foc: '#4a3226', estrela: true, meia: false },
  { pelo: '#5a3826', sombra: '#42281a', luz: '#704a34', crina: '#1c120b', perna: '#5a3826', casco: '#1f1816', foc: '#2e1e16', estrela: true, meia: true },
  { pelo: '#eceae4', sombra: '#cac8c2', luz: '#ffffff', crina: '#bdbab3', perna: '#eceae4', casco: '#8a8076', foc: '#d8b0ae', estrela: false, meia: false },
  { pelo: '#28262d', sombra: '#18171c', luz: '#3d3b46', crina: '#0c0c10', perna: '#28262d', casco: '#101012', foc: '#4a4048', estrela: false, meia: false },
];

registrarModelo('cavalo', {
  esc: 1 / 16, altura: 1.65, raio: 0.6, meiaLargura: 0.38, passo: 2.4, semente: 2024,
  variantes: 4, largura: 128, montaria: true,
  partes: {
    corpo: [10, 9, 24], pescoco: [5, 9, 6], cabeca: [5, 5, 10], orelha: [1, 3, 1],
    crina: [1, 9, 2], franja: [1, 3, 2], perna: [4, 11, 4], rabo1: [3, 7, 3], rabo2: [4, 9, 4],
  },
  pintar(p, r, v) {
    const c = PELAGENS_CAVALO[v % PELAGENS_CAVALO.length];
    const BRANCO = '#ece8de';
    // corpo: pelo com sombra na barriga e brilho no dorso
    p.todas(r.corpo).forEach((g) => p.enche(g, c.pelo, 6));
    p.enche(r.corpo.baixo, c.sombra, 4);
    p.lados(r.corpo).forEach((g) => {
      p.sombra(g, 0, 10); p.sombra(g, g[3] - 2, -8); p.sombra(g, g[3] - 1, -16);
      p.pontos(g, 9, c.luz); p.pontos(g, 7, c.sombra);
    });
    // pescoço e cabeça
    p.todas(r.pescoco).forEach((g) => p.enche(g, c.pelo, 6));
    p.lados(r.pescoco).forEach((g) => p.pontos(g, 4, c.luz));
    const h = r.cabeca;
    p.todas(h).forEach((g) => p.enche(g, c.pelo, 5));
    for (const [g, dir] of [[h.direita, true], [h.esquerda, false]]) {
      for (let k = 0; k < 3; k++) for (let j = 1; j < g[3]; j++) p.pix(g, bordaFrente(g, dir, k), j, c.foc);   // focinho
      p.pix(g, bordaFrente(g, dir, 5), 1, '#0b0708');                                                         // olho
      p.pix(g, bordaFrente(g, dir, 5), 0, c.luz);
      p.pix(g, bordaFrente(g, dir, 6), 1, c.sombra);
    }
    p.ret(h.frente, 0, 3, 5, 2, c.foc);
    p.pix(h.frente, 1, 3, '#16100f'); p.pix(h.frente, 3, 3, '#16100f');                                      // narinas
    if (c.estrela) {                                                                                         // listra branca no rosto
      p.ret(h.topo, 2, 0, 1, h.topo[3], BRANCO);
      p.ret(h.frente, 2, 0, 1, 3, BRANCO);
    }
    p.sombra(h.frente, 4, -12);
    p.todas(r.orelha).forEach((g) => p.enche(g, c.pelo, 4));
    p.pix(r.orelha.frente, 0, 1, c.foc);
    // crina, franja e rabo
    for (const nome of ['crina', 'franja', 'rabo1', 'rabo2']) {
      p.todas(r[nome]).forEach((g) => { p.enche(g, c.crina, 7); p.pontos(g, 4, tom(c.crina, 1.5)); });
    }
    // pernas: pelagem, parte de baixo (variante), meia branca e casco escuro
    p.todas(r.perna).forEach((g) => p.enche(g, c.pelo, 5));
    p.lados(r.perna).forEach((g) => {
      p.enche(g, c.perna, 5, 6, 8);
      if (c.meia) p.enche(g, BRANCO, 4, 5, 8);
      p.enche(g, c.casco, 3, 9, 10);
      p.sombra(g, 0, -6); p.sombra(g, 5, -6);
    });
    p.enche(r.perna.baixo, c.casco, 3);
    p.enche(r.perna.topo, c.sombra, 4);
  },
  construir(m) {
    const raiz = m.raiz;
    const tronco = m.pivo(raiz, 0, 0, 0);
    m.parte('corpo', tronco, 0, 15.5, 0);
    // pescoço inclinado para frente, com crina; cabeça presa na ponta
    const pesc = m.pivo(tronco, 0, 18, -11);
    pesc.rotation.x = -0.85;
    m.mesclar('pescoco', pesc, [['pescoco', 0, 4.5, 0], ['crina', 0, 5, 4]]);
    const cab = m.pivo(pesc, 0, 9, -0.5);
    cab.rotation.x = -0.05;
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, -0.5, -4], ['orelha', -1.8, 3.5, -0.5, 0, 0, 0.15], ['orelha', 1.8, 3.5, -0.5, 0, 0, -0.15],
      ['franja', 0, 2.6, -1.8, 0.35, 0, 0],
    ]);
    // rabo (duas peças, balança)
    const rabo = m.pivo(tronco, 0, 19, 12);
    rabo.rotation.x = 0.35;
    m.mesclar('rabo', rabo, [['rabo1', 0, -3, 1.5], ['rabo2', 0, -10, 2]]);
    // 4 pernas: pivô no quadril
    const patas = [];   // frente esq., frente dir., trás esq., trás dir.
    for (const [x, z] of [[-3, -8], [3, -8], [-3, 8], [3, 8]]) {
      const pv = m.pivo(raiz, x, 11, z);
      m.parte('perna', pv, 0, -5.5, 0);
      patas.push(pv);
    }
    instalarEquipamento(m, {
      sela: { pai: tronco, y: 20, z: -1, w: 10, d: 8, ey: 9 },
      corpo: { pai: tronco, w: 10, h: 9, d: 24, y: 15.5, z: 0 },
      cabeca: { pai: cab, w: 5, h: 5, d: 10, x: 0, y: -0.5, z: -4 },
      pescoco: { pai: pesc, w: 5, h: 9, d: 6, x: 0, y: 4.5, z: 0 },
    });
    // fases das pernas: trote (pares em diagonal) e galope (pares da frente e de trás juntos)
    const TROTE = [0, Math.PI, Math.PI, 0], GALOPE = [0, 0.45, 2.7, 3.15];
    return (dt, vel, est) => {
      const gal = limitar((vel - 4.5) / 4, 0, 1);       // 0 = anda/trota, 1 = galope
      const A = (0.5 + 0.45 * gal) * m.amp;
      for (let i = 0; i < 4; i++) patas[i].rotation.x = Math.sin(m.fase + lerp(TROTE[i], GALOPE[i], gal)) * A;
      tronco.position.y = Math.abs(Math.sin(m.fase)) * (0.012 + 0.03 * gal) * m.amp;
      tronco.rotation.x = Math.sin(m.fase + 0.6) * 0.05 * gal;
      pesc.rotation.x = -0.85 + Math.sin(m.fase * 2 + 1) * 0.05 * m.amp * (1 + gal) + Math.sin(m.tempo * 0.9) * 0.025 - (est.atacando ? 0.2 : 0);
      cab.rotation.x = -0.05 + Math.sin(m.fase * 2) * 0.06 * m.amp;
      rabo.rotation.x = 0.35 - gal * 0.7 * m.amp;
      rabo.rotation.z = Math.sin(m.tempo * 2.6) * 0.18 + Math.sin(m.fase) * 0.1 * m.amp;
    };
  },
});

// ---------------------------------------------------------------------
// LOBO GIGANTE (1 pixel = 1/16 de bloco; ~1.3 de altura, ~2.1 de comprimento)
// ---------------------------------------------------------------------
registrarModelo('lobo_gigante', {
  esc: 1 / 16, altura: 1.32, raio: 0.55, meiaLargura: 0.3, passo: 2.2, semente: 8081, montaria: true,
  partes: {
    corpo: [9, 9, 14], pescoco: [8, 8, 5], cabeca: [7, 6, 5], focinho: [4, 3, 4], mandibula: [3, 1, 4],
    orelha: [2, 3, 1], perna: [3, 9, 3], cola1: [3, 3, 6], cola2: [3, 3, 5],
  },
  pintar(p, r) {
    const BASE = '#4b4e57', ESCURO = '#2f3138', CLARO = '#8a8d96', FELPA = '#6a6e78';
    // corpo: cinza-escuro, faixa escura no dorso e barriga clara
    p.todas(r.corpo).forEach((g) => { p.enche(g, BASE, 9); p.pontos(g, 12, FELPA); p.pontos(g, 8, ESCURO); });
    p.ret(r.corpo.topo, 3, 0, 3, r.corpo.topo[3], ESCURO);
    p.enche(r.corpo.baixo, CLARO, 6);
    p.lados(r.corpo).forEach((g) => { p.enche(g, CLARO, 7, g[3] - 3); p.sombra(g, g[3] - 4, 8); p.sombra(g, 0, -8); });
    // peitoral peludo (mais claro)
    p.todas(r.pescoco).forEach((g) => { p.enche(g, FELPA, 9); p.pontos(g, 8, CLARO); });
    p.enche(r.pescoco.frente, CLARO, 8, 3); p.enche(r.pescoco.baixo, CLARO, 6);
    // cabeça: olhos amarelos pintados (e mais brilho por cima, em caixas)
    const h = r.cabeca;
    p.todas(h).forEach((g) => { p.enche(g, BASE, 8); p.pontos(g, 6, FELPA); });
    p.ret(h.frente, 0, 0, 7, 1, ESCURO);
    p.ret(h.frente, 1, 1, 2, 2, '#ffd820'); p.ret(h.frente, 4, 1, 2, 2, '#ffd820');
    p.pix(h.frente, 2, 2, '#1a1408'); p.pix(h.frente, 4, 2, '#1a1408');
    p.pontos(h.topo, 6, ESCURO);
    p.todas(r.focinho).forEach((g) => p.enche(g, '#9a9da6', 6));
    p.enche(r.focinho.topo, BASE, 6);
    p.ret(r.focinho.frente, 1, 0, 2, 1, '#101012');                       // nariz
    p.lados(r.focinho).forEach((g) => { p.pix(g, 0, 2, '#f0eee6'); p.pix(g, g[2] - 1, 2, '#f0eee6'); p.pix(g, 1, 2, '#f0eee6'); });  // dentes
    p.pix(r.focinho.frente, 0, 2, '#f0eee6'); p.pix(r.focinho.frente, 2, 2, '#f0eee6');
    p.todas(r.mandibula).forEach((g) => p.enche(g, '#8a8d96', 5));
    p.enche(r.mandibula.topo, '#6a2a30', 3);                               // boca por dentro
    p.todas(r.orelha).forEach((g) => p.enche(g, BASE, 6));
    p.ret(r.orelha.frente, 0, 1, 2, 2, '#5a4048');                         // dentro da orelha
    // pernas escuras com patinhas mais claras
    p.todas(r.perna).forEach((g) => { p.enche(g, '#3a3c44', 7); });
    p.lados(r.perna).forEach((g) => { p.enche(g, FELPA, 6, 0, 2); p.enche(g, '#2a2b31', 5, 7, 8); p.sombra(g, 6, -8); });
    // cauda peluda, ponta mais escura
    p.todas(r.cola1).forEach((g) => { p.enche(g, FELPA, 9); p.pontos(g, 6, CLARO); });
    p.todas(r.cola2).forEach((g) => { p.enche(g, '#34363e', 8); p.pontos(g, 5, FELPA); });
  },
  construir(m) {
    const raiz = m.raiz;
    const tronco = m.pivo(raiz, 0, 0, 0);
    m.mesclar('corpo', tronco, [['corpo', 0, 13.5, 0], ['pescoco', 0, 14.5, -8.5]]);
    // cabeça: orelhas em pé, focinho e olhos que brilham; a mandíbula abre ao morder
    const cab = m.pivo(tronco, 0, 15.5, -10.5);
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, 1, -3.5], ['focinho', 0, -0.5, -7.5],
      ['orelha', -2.4, 5, -1.8, 0, 0, 0.12], ['orelha', 2.4, 5, -1.8, 0, 0, -0.12],
    ]);
    m.mesclarBrilho('olhos', cab, [
      [0xffd820, 1.8, 1.2, 0.6, -2, 2.6, -6.15], [0xffd820, 1.8, 1.2, 0.6, 2, 2.6, -6.15],
      [0xfff7b0, 0.8, 0.6, 0.7, -2.3, 2.9, -6.2], [0xfff7b0, 0.8, 0.6, 0.7, 1.7, 2.9, -6.2],
    ]);
    const maxilar = m.pivo(cab, 0, -2, -5.5);
    m.parte('mandibula', maxilar, 0, -0.5, -2);
    // cauda: duas partes que balançam
    const cauda = m.pivo(tronco, 0, 16.5, 7);
    cauda.rotation.x = 0.8;
    m.parte('cola1', cauda, 0, 0, 3);
    const cauda2 = m.pivo(cauda, 0, 0, 6);
    cauda2.rotation.x = 0.15;
    m.parte('cola2', cauda2, 0, 0, 2.5);
    const patas = [];
    for (const [x, z] of [[-3, -5], [3, -5], [-3, 5], [3, 5]]) {
      const pv = m.pivo(raiz, x, 9, z);
      m.parte('perna', pv, 0, -4.5, 0);
      patas.push(pv);
    }
    instalarEquipamento(m, {
      sela: { pai: tronco, y: 18, z: -0.5, w: 9, d: 6, ey: 7 },
      corpo: { pai: tronco, w: 9, h: 9, d: 14, y: 13.5, z: 0 },
      cabeca: { pai: cab, w: 7, h: 6, d: 5, x: 0, y: 1, z: -3.5 },
    });
    const TROTE = [0, Math.PI, Math.PI, 0], GALOPE = [0, 0.5, 2.8, 3.3];
    return (dt, vel, est) => {
      const gal = limitar((vel - 4.5) / 4, 0, 1);
      const A = (0.55 + 0.5 * gal) * m.amp;
      for (let i = 0; i < 4; i++) patas[i].rotation.x = Math.sin(m.fase + lerp(TROTE[i], GALOPE[i], gal)) * A;
      tronco.position.y = Math.abs(Math.sin(m.fase)) * (0.012 + 0.035 * gal) * m.amp;
      tronco.rotation.x = Math.sin(m.fase + 0.6) * 0.07 * gal;
      // mordida: a cabeça avança e a boca abre e fecha
      const mordida = est.atacando ? 0.5 + 0.5 * Math.sin(m.tempo * 16) : 0;
      cab.position.z = (-10.5 - 3.5 * mordida) * m._esc;
      cab.rotation.x = Math.sin(m.fase * 2) * 0.05 * m.amp - 0.15 * mordida + Math.sin(m.tempo * 1.1) * 0.02;
      maxilar.rotation.x = -0.75 * mordida - 0.04;
      // cauda: pendurada parado, esticada para trás correndo
      cauda.rotation.x = lerp(0.8, 0.25, gal * m.amp) + Math.sin(m.tempo * 3) * 0.05;
      cauda.rotation.y = Math.sin(m.tempo * 2.4) * 0.15 + Math.sin(m.fase) * 0.2 * m.amp;
      cauda2.rotation.y = Math.sin(m.tempo * 2.4 - 0.8) * 0.2;
    };
  },
});

// ---------------------------------------------------------------------
// ARANHA MONTARIA (a aranha gigante domada: tom mais claro, sem manchas vermelhas,
// olhos âmbar). Mesmo esqueleto e animação da aranha gigante.
// ---------------------------------------------------------------------
registrarModelo('aranha_montaria', {
  esc: 1 / 8, altura: 1.8, raio: 1.4, meiaLargura: 0.62, passo: 4, semente: 779, montaria: true,
  olhos: [0xffc030, 0xd88a10],
  partes: MODELOS.aranha.partes,
  pintar(p, r) {
    const ESC = '#5c4b52', PELO = '#7e6c6a', FAIXA = '#c9a566';
    // abdômen: marrom-acinzentado com listras de areia e pintinhas claras
    p.todas(r.abdomen).forEach((g) => { p.enche(g, ESC, 9); p.pontos(g, 28, PELO); });
    const t = r.abdomen.topo;
    for (let j = 1; j < t[3]; j += 3) p.ret(t, 2, j, t[2] - 4, 1, FAIXA);
    p.ret(t, 4, 0, 2, t[3], '#8a6c48');
    p.enche(r.abdomen.baixo, '#8a7a76', 6);
    p.lados(r.abdomen).forEach((g) => {
      for (let i = 1; i < g[2]; i += 3) p.ret(g, i, 1, 1, g[3] - 3, '#6e5a56');
      p.pontos(g, 6, FAIXA); p.sombra(g, g[3] - 1, -14);
    });
    // cabeça com presas
    p.todas(r.cabeca).forEach((g) => { p.enche(g, '#6a585e', 8); p.pontos(g, 12, PELO); });
    const f = r.cabeca.frente;
    p.ret(f, 1, 5, 6, 2, '#2a1c20');
    p.ret(f, 1, 5, 1, 3, '#efe6cf'); p.ret(f, 6, 5, 1, 3, '#efe6cf');
    p.pix(f, 3, 0, FAIXA); p.pix(f, 4, 0, FAIXA);
    // pernas com faixas de areia
    p.todas(r.perna_sup).forEach((g) => { p.enche(g, '#51424a', 7); p.pontos(g, 3, PELO); });
    p.todas(r.perna_inf).forEach((g) => { p.enche(g, '#5a4a52', 7); p.pontos(g, 4, PELO); });
    p.lados(r.perna_inf).forEach((g) => { p.ret(g, 0, 3, g[2], 1, FAIXA); p.ret(g, 0, 7, g[2], 1, FAIXA); p.ret(g, 0, 10, g[2], 1, '#efe6cf'); });
    p.lados(r.perna_sup).forEach((g) => p.ret(g, 3, 0, 1, g[3], FAIXA));
  },
  construir(m) {
    const anim = construirAranha(m);
    // cabeça e abdômen ficam fixos na raiz: a armadura vai direto nela
    instalarEquipamento(m, {
      sela: { pai: m.raiz, y: 14, z: 6, w: 10, d: 8, ey: 8 },
      corpo: { pai: m.raiz, w: 10, h: 10, d: 12, y: 9, z: 6 },
      cabeca: { pai: m.raiz, w: 8, h: 7, d: 8, x: 0, y: 8.5, z: -4 },
    });
    return anim;
  },
});

// ---------------------------------------------------------------------
// FILHOTE DE DRAGÃO (1 pixel = 1/16 de bloco; ~1.45 de altura, ~2.5 de comprimento)
// Cabeça grande, olhos grandes, asinhas que batem quando está voando.
// ---------------------------------------------------------------------
// Escamas "macias" (para o filhote): o desenho é mais suave que o de p.escamas
function suave(p, reg, cor, v = 6) {
  p.enche(reg, cor, v);
  const escura = tom(cor, 0.88), clara = tom(cor, 1.1);
  for (let j = 0; j < reg[3]; j++) {
    const lin = Math.floor(j / 3), off = (lin % 2) * 2;
    if (j % 3 === 2) for (let i = 0; i < reg[2]; i++) p.pix(reg, i, j, escura);
    else for (let i = off; i < reg[2]; i += 4) p.pix(reg, i, j, escura);
    if (j % 3 === 0) for (let i = off + 1; i < reg[2]; i += 4) p.pix(reg, i, j, clara);
  }
}
// Cores do filhote por elemento (variante 0 = fogo, 1 = gelo, 2 = veneno, 3 = raio,
// na ordem de ELEMENTOS_DRAGAO do world.js). O ovo de cada dragão choca o filhote da cor dele.
const PALETAS_FILHOTE = [
  { VERM: '#d8532a', VERM2: '#b8401f', OURO: '#f0c040', OURO2: '#d29a20', MEMB: '#f08a3a', focinho: '#e0643a',
    dedo: '#b04a20', borda: '#f5b04a', asaLado: '#c8602a', chifre: '#f4e6b0', espinho: '#f4d070',
    olho: '#f2b81c', olhoEscuro: '#c27a10', bochecha: '#ee7a74', narina: '#7a2a18', sorriso: '#8a2a1a', chama: 0xffa820 },
  { VERM: '#8ccbe6', VERM2: '#5a9cc4', OURO: '#f2fbff', OURO2: '#c8e6f4', MEMB: '#c4ecfa', focinho: '#a6dcf0',
    dedo: '#6aaed2', borda: '#ffffff', asaLado: '#8ac4e0', chifre: '#ffffff', espinho: '#e8fbff',
    olho: '#5ad8ff', olhoEscuro: '#2a88b8', bochecha: '#f0b8d8', narina: '#2a5a7a', sorriso: '#3a6a8a', chama: 0xbff4ff },
  { VERM: '#4f9a2e', VERM2: '#356e1e', OURO: '#c8e050', OURO2: '#9ab830', MEMB: '#8a5aa8', focinho: '#5eaa38',
    dedo: '#5a3a72', borda: '#b88ad0', asaLado: '#6a4a86', chifre: '#3a3428', espinho: '#d8f070',
    olho: '#d8ff3a', olhoEscuro: '#8aa810', bochecha: '#e89ab8', narina: '#1a3a0e', sorriso: '#24481a', chama: 0x7aff3a },
  { VERM: '#e6c030', VERM2: '#b8941e', OURO: '#fffbe8', OURO2: '#e8dcb0', MEMB: '#3c4888', focinho: '#f0cc40',
    dedo: '#26306a', borda: '#9ab0ff', asaLado: '#323c78', chifre: '#2e3a5e', espinho: '#ffffff',
    olho: '#8ad8ff', olhoEscuro: '#2a6ab8', bochecha: '#f0a0a0', narina: '#5a4210', sorriso: '#6a4e14', chama: 0xfff27a },
];
registrarModelo('filhote_dragao', {
  esc: 1 / 16, altura: 1.45, raio: 0.65, meiaLargura: 0.4, passo: 2.8, semente: 5150, montaria: true,
  largura: 128, variantes: 4,
  partes: {
    corpo: [9, 9, 16], pescoco: [6, 6, 5], cabeca: [10, 9, 9], focinho: [6, 4, 3], chifre: [2, 4, 2],
    pata: [4, 6, 4], rabo1: [5, 5, 8], rabo2: [3, 3, 8], asa: [10, 1, 9], osso: [10, 2, 2], espinho: [1, 2, 2],
  },
  pintar(p, r, variante = 0) {
    const C = PALETAS_FILHOTE[variante] || PALETAS_FILHOTE[0];
    const VERM = C.VERM, VERM2 = C.VERM2, OURO = C.OURO, OURO2 = C.OURO2, MEMB = C.MEMB;
    // corpo: escamas vermelho-alaranjadas, barriga dourada com faixas
    p.todas(r.corpo).forEach((g) => suave(p, g, VERM, 7, 4, 3));
    p.enche(r.corpo.baixo, OURO, 6);
    p.lados(r.corpo).forEach((g) => {
      p.enche(g, OURO, 6, g[3] - 4);
      for (let j = g[3] - 4; j < g[3]; j += 2) p.ret(g, 0, j, g[2], 1, OURO2);
      p.sombra(g, g[3] - 5, -14);
    });
    p.ret(r.corpo.frente, 0, 4, r.corpo.frente[2], 5, OURO);
    // pescoço: dourado na frente
    p.todas(r.pescoco).forEach((g) => suave(p, g, VERM, 6, 3, 3));
    p.enche(r.pescoco.frente, OURO, 5); p.enche(r.pescoco.baixo, OURO, 5);
    for (let j = 1; j < 6; j += 2) p.ret(r.pescoco.frente, 0, j, 6, 1, OURO2);
    // cabeça grande e fofa
    const h = r.cabeca;
    p.todas(h).forEach((g) => suave(p, g, VERM, 6, 4, 3));
    const f = h.frente;
    // olhos grandes: com pupila e brilhinho (âmbar no de fogo)
    for (const x0 of [1, 6]) {
      p.ret(f, x0, 2, 3, 3, C.olho);
      p.ret(f, x0 + 1, 2, 1, 3, '#1a0a10');
      p.pix(f, x0, 2, '#ffffff');
      p.pix(f, x0 + 2, 4, C.olhoEscuro);
    }
    p.pix(f, 0, 6, C.bochecha); p.pix(f, 9, 6, C.bochecha);                   // bochechas coradas
    p.ret(f, 1, 1, 3, 1, VERM2); p.ret(f, 6, 1, 3, 1, VERM2);                 // sobrancelhas
    for (const [g, dir] of [[h.direita, true], [h.esquerda, false]]) {
      p.ret(g, bordaFrente(g, dir, 4), 2, 1, 3, C.olho);                      // olho de lado
      p.pix(g, bordaFrente(g, dir, 4), 3, '#1a0a10');
    }
    p.enche(h.baixo, OURO, 5);
    p.todas(r.focinho).forEach((g) => suave(p, g, C.focinho, 5, 3, 2));
    const fo = r.focinho.frente;
    p.pix(fo, 1, 1, C.narina); p.pix(fo, 4, 1, C.narina);                     // narinas
    p.ret(fo, 1, 3, 4, 1, C.sorriso); p.pix(fo, 0, 2, C.sorriso); p.pix(fo, 5, 2, C.sorriso); // sorriso
    p.pix(fo, 1, 3, '#fff6dc'); p.pix(fo, 4, 3, '#fff6dc');                   // dentinhos
    p.enche(r.focinho.baixo, OURO, 5);
    p.todas(r.chifre).forEach((g) => p.enche(g, C.chifre, 6));
    p.lados(r.chifre).forEach((g) => p.sombra(g, 0, -12));
    // patas com garrinhas claras
    p.todas(r.pata).forEach((g) => suave(p, g, VERM, 6, 3, 3));
    p.lados(r.pata).forEach((g) => p.ret(g, 0, g[3] - 1, g[2], 1, '#f4e6b0'));
    p.enche(r.pata.baixo, OURO2, 5);
    // cauda: cor do corpo em cima e da barriga embaixo
    p.todas(r.rabo1).forEach((g) => suave(p, g, VERM, 6, 4, 3));
    p.enche(r.rabo1.baixo, OURO, 5);
    p.todas(r.rabo2).forEach((g) => suave(p, g, C.focinho, 6, 3, 3));
    p.enche(r.rabo2.baixo, OURO, 5);
    // asas: membrana com "dedos" mais escuros
    const t = r.asa.topo, b = r.asa.baixo;
    for (const reg of [t, b]) {
      p.enche(reg, MEMB, 8);
      for (const x of [2, 5, 8]) p.linha(reg, 0, 0, x, reg[3] - 1, C.dedo);
      p.ret(reg, 0, reg[3] - 1, reg[2], 1, C.borda);
    }
    p.lados(r.asa).forEach((g) => p.enche(g, C.asaLado, 6));
    p.todas(r.osso).forEach((g) => p.enche(g, VERM2, 6));
    p.todas(r.espinho).forEach((g) => p.enche(g, C.espinho, 5));
  },
  construir(m) {
    const raiz = m.raiz;
    const tronco = m.pivo(raiz, 0, 0, 0);
    // corpo, pescoço e espinhos do dorso (menos no lugar da sela) numa malha só
    m.mesclar('tronco', tronco, [
      ['corpo', 0, 10.5, 0], ['pescoco', 0, 13.5, -9.5],
      ['espinho', 0, 16, 5.5], ['espinho', 0, 16, -6.8], ['espinho', 0, 15.5, 3.2, 0.3, 0, 0],
    ]);
    // cabeça grande: chifrinhos para trás e focinho com narinas
    const cab = m.pivo(tronco, 0, 15, -10.5);
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, 1.5, -3.5], ['focinho', 0, -0.5, -9.5],
      ['chifre', -3, 8, -1, 0.5, 0, 0.25], ['chifre', 3, 8, -1, 0.5, 0, -0.25],
    ]);
    // cauda em duas partes, com uma chamininha na ponta
    const rabo1 = m.pivo(tronco, 0, 11, 8);
    rabo1.rotation.x = 0.15;
    m.parte('rabo1', rabo1, 0, 0, 4);
    m.parte('espinho', rabo1, 0, 3.5, 3);
    const rabo2 = m.pivo(rabo1, 0, 0, 8);
    rabo2.rotation.x = -0.4;
    m.parte('rabo2', rabo2, 0, 0, 4);
    m.parte('espinho', rabo2, 0, 2.5, 4);
    const chama = m.caixaBrilho(rabo2, (PALETAS_FILHOTE[m.variante] || PALETAS_FILHOTE[0]).chama, 3, 3, 3, 0, 0, 9.5);
    // asas: pivô no ombro, a membrana vai para trás e para o lado
    const asas = [];
    for (const s of [-1, 1]) {
      const pv = m.pivo(tronco, s * 4.5, 14.8, -2);
      m.mesclar(s < 0 ? 'asa_e' : 'asa_d', pv, [['asa', s * 5.5, 0, 3.5], ['osso', s * 5.5, 0.5, -0.8]]);
      asas.push(pv);
    }
    // 4 patas curtinhas
    const patas = [];
    for (const [x, z] of [[-3.5, -5], [3.5, -5], [-3.5, 5.5], [3.5, 5.5]]) {
      const pv = m.pivo(raiz, x, 6, z);
      m.parte('pata', pv, 0, -3, 0);
      patas.push(pv);
    }
    instalarEquipamento(m, {
      sela: { pai: tronco, y: 15, z: 0, w: 9, d: 7, ey: 5 },
      corpo: { pai: tronco, w: 9, h: 9, d: 16, y: 10.5, z: 0 },
      cabeca: { pai: cab, w: 10, h: 9, d: 9, x: 0, y: 1.5, z: -3.5 },
    });
    const TROTE = [0, Math.PI, Math.PI, 0];
    return (dt, vel, est) => {
      const voando = !!est.voando;
      // patas: andam em diagonal; voando ficam recolhidas
      for (let i = 0; i < 4; i++) {
        const ando = Math.sin(m.fase + TROTE[i]) * 0.7 * m.amp;
        patas[i].rotation.x = voando ? (i < 2 ? 0.6 : -0.6) + Math.sin(m.tempo * 6 + i) * 0.08 : ando;
      }
      // asas: batem forte voando; paradas, balançam de leve (e mais ao andar)
      const ang = voando
        ? 0.25 + 0.85 * Math.sin(m.tempo * 13)
        : 0.95 + Math.sin(m.tempo * 1.6) * 0.04 + m.amp * 0.1 * Math.sin(m.tempo * 9);
      asas[0].rotation.z = -ang; asas[1].rotation.z = ang;
      // asas dobradas (menores) quando está no chão; abertas por inteiro voando
      m._abre = aproximar(m._abre === undefined ? 0 : m._abre, voando ? 1 : 0, dt * 8);
      const aberta = m._abre;
      for (const a of asas) a.scale.set(0.8 + 0.2 * aberta, 1, 0.55 + 0.45 * aberta);
      // corpo: sobe e desce voando, balança ao andar
      tronco.position.y = voando ? Math.sin(m.tempo * 6.5) * 0.06 + 0.1 : Math.abs(Math.sin(m.fase)) * 0.015 * m.amp;
      tronco.rotation.x = voando ? 0.1 + Math.sin(m.tempo * 6.5 + 1) * 0.04 : 0;
      cab.rotation.x = Math.sin(m.fase * 2 + 1) * 0.05 * m.amp + Math.sin(m.tempo * 1.3) * 0.03 + (est.atacando ? 0.3 * Math.sin(m.tempo * 14) : 0);
      // cauda ondula; chama pisca
      rabo1.rotation.y = Math.sin(m.tempo * 2.5) * 0.25;
      rabo2.rotation.y = Math.sin(m.tempo * 2.5 - 1) * 0.4;
      rabo1.rotation.x = voando ? -0.1 : 0.15;
      chama.scale.setScalar((0.9 + 0.3 * Math.sin(m.tempo * 21)) * m._esc * 3);
    };
  },
});

// ---------------------------------------------------------------------
// CACHORRO (pet; 1 pixel = 1/16 de bloco; ~0.72 de altura)
// ---------------------------------------------------------------------
const PELAGENS_CACHORRO = [
  { pelo: '#c4843e', claro: '#ecd2a2', orelha: '#8e5a26', sombra: '#a46a2c', manchas: null },       // caramelo
  { pelo: '#f2f0ea', claro: '#ffffff', orelha: '#5a3a24', sombra: '#d8d6d0', manchas: '#6a4428' },  // branco com manchas
  { pelo: '#26262c', claro: '#b27a46', orelha: '#16161a', sombra: '#18181c', manchas: null },         // preto e fogo
];

registrarModelo('cachorro', {
  esc: 1 / 16, altura: 0.72, raio: 0.32, meiaLargura: 0.22, passo: 4, semente: 303,
  variantes: 3,
  partes: {
    corpo: [5, 5, 8], cabeca: [5, 5, 5], focinho: [3, 2, 2], orelha: [2, 3, 1], perna: [2, 4, 2],
    rabo: [2, 2, 4], lingua: [1, 1, 3], coleira: [6, 2, 2],
  },
  pintar(p, r, v) {
    const c = PELAGENS_CACHORRO[v % PELAGENS_CACHORRO.length];
    // corpo com barriga e peito claros
    p.todas(r.corpo).forEach((g) => p.enche(g, c.pelo, 7));
    p.enche(r.corpo.baixo, c.claro, 5);
    p.lados(r.corpo).forEach((g) => { p.enche(g, c.claro, 5, g[3] - 1); p.pontos(g, 4, c.sombra); });
    p.enche(r.corpo.frente, c.pelo, 6); p.ret(r.corpo.frente, 1, 2, 3, 3, c.claro);
    if (c.manchas) {
      p.ret(r.corpo.topo, 1, 1, 3, 3, c.manchas); p.ret(r.corpo.topo, 2, 5, 3, 2, '#2e2a28');
      p.lados(r.corpo).forEach((g) => p.ret(g, 2, 0, 3, 3, c.manchas));
    }
    // cabeça: olhos escuros, sobrancelhas claras (no cachorro preto, "de fogo")
    const h = r.cabeca;
    p.todas(h).forEach((g) => p.enche(g, c.pelo, 6));
    p.pix(h.frente, 1, 2, '#17100e'); p.pix(h.frente, 3, 2, '#17100e');
    for (const [g, dir] of [[h.direita, true], [h.esquerda, false]]) p.pix(g, bordaFrente(g, dir, 1), 2, '#17100e');   // olho de lado
    p.pix(h.frente, 1, 1, v === 2 ? c.claro : c.pelo); p.pix(h.frente, 3, 1, v === 2 ? c.claro : c.pelo);
    p.ret(h.frente, 1, 3, 3, 2, c.claro);
    if (c.manchas) { p.ret(h.frente, 3, 0, 2, 3, c.manchas); p.pix(h.frente, 3, 2, '#17100e'); p.ret(h.topo, 3, 0, 2, 3, c.manchas); }
    p.todas(r.focinho).forEach((g) => p.enche(g, c.claro, 5));
    p.ret(r.focinho.frente, 1, 0, 1, 1, '#141012');                           // nariz
    p.pix(r.focinho.frente, 0, 0, '#141012'); p.pix(r.focinho.frente, 2, 0, '#141012');
    p.pix(r.focinho.topo, 1, 0, '#141012');
    p.todas(r.orelha).forEach((g) => p.enche(g, c.orelha, 5));
    // patas com pezinhos claros
    p.todas(r.perna).forEach((g) => p.enche(g, c.pelo, 6));
    p.lados(r.perna).forEach((g) => p.ret(g, 0, 3, g[2], 1, c.claro));
    p.todas(r.rabo).forEach((g) => p.enche(g, c.pelo, 6));
    p.enche(r.rabo.frente, c.claro, 4);
    p.todas(r.lingua).forEach((g) => p.enche(g, '#e66a7a', 6));
    // coleira vermelha com plaquinha dourada
    p.todas(r.coleira).forEach((g) => p.enche(g, '#c42a2a', 6));
    p.pix(r.coleira.frente, 2, 1, '#f2c830'); p.pix(r.coleira.frente, 3, 1, '#f2c830');
  },
  construir(m) {
    const raiz = m.raiz;
    const tronco = m.pivo(raiz, 0, 0, 0);
    m.parte('corpo', tronco, 0, 6.5, 0);
    // cabeça (pescoço no pivô): orelhas caídas, focinho e coleira juntos
    const cab = m.pivo(tronco, 0, 9, -5);
    m.mesclar('cabeca', cab, [
      ['cabeca', 0, 0, -2], ['focinho', 0, -1.2, -5.5],
      ['orelha', -3.2, 0.8, -1.2, 0, 0, -0.3], ['orelha', 3.2, 0.8, -1.2, 0, 0, 0.3],
      ['coleira', 0, -1.7, 0.6],
    ]);
    const lingua = m.parte('lingua', cab, 0, -2.6, -5.8);
    lingua.visible = false;
    // rabinho levantado, abana de um lado para o outro
    const rabo = m.pivo(tronco, 0, 8.5, 4);
    rabo.rotation.x = -0.9;
    m.parte('rabo', rabo, 0, 0, 2);
    const patas = [];
    for (const [x, z] of [[-1.5, -3], [1.5, -3], [-1.5, 3], [1.5, 3]]) {
      const pv = m.pivo(raiz, x, 4, z);
      m.parte('perna', pv, 0, -2, 0);
      patas.push(pv);
    }
    const TROTE = [0, Math.PI, Math.PI, 0], GALOPE = [0, 0.5, 2.8, 3.3];
    return (dt, vel, est) => {
      const gal = limitar((vel - 2.5) / 3, 0, 1);
      const A = (0.6 + 0.4 * gal) * m.amp;
      for (let i = 0; i < 4; i++) patas[i].rotation.x = Math.sin(m.fase + lerp(TROTE[i], GALOPE[i], gal)) * A;
      // bote: salta para frente com as patas da frente esticadas
      if (est.atacando) {
        const s = 0.5 + 0.5 * Math.sin(m.tempo * 12);
        tronco.position.y = s * 0.12;
        tronco.position.z = -s * 2.5 * m._esc;
        tronco.rotation.x = s * 0.3;
        patas[0].rotation.x = patas[1].rotation.x = -0.9 * s;
        cab.rotation.x = -0.25 * s;
      } else {
        tronco.position.y = Math.abs(Math.sin(m.fase)) * (0.01 + 0.03 * gal) * m.amp;
        tronco.position.z = 0;
        tronco.rotation.x = Math.sin(m.fase + 0.6) * 0.06 * gal;
        cab.rotation.x = Math.sin(m.fase * 2) * 0.05 * m.amp + Math.sin(m.tempo * 1.4) * 0.02;
      }
      // rabo: abana rápido parado (alegre) e mais curto correndo
      const parado = 1 - m.amp;
      rabo.rotation.y = Math.sin(m.tempo * (14 + 6 * m.amp)) * (0.2 + 0.55 * parado);
      rabo.rotation.x = -0.9 + gal * 0.35;
      // língua de fora ao correr, ofegando
      lingua.visible = m.amp > 0.55 && vel > 2.5;
      if (lingua.visible) lingua.scale.z = 0.8 + 0.3 * Math.sin(m.tempo * 18);
    };
  },
});

// ---------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------
/**
 * Cria o modelo de um mob.
 * opcoes (opcional): { variante } escolhe a pelagem dos tipos que têm variantes
 * (cavalo: 0 marrom, 1 castanho escuro, 2 branco, 3 preto; cachorro: 0 caramelo,
 * 1 branco com manchas, 2 preto). Sem `variante`, é sorteada.
 * Devolve { grupo, altura, raio, variante, assento, animar(dt, vel, estado), piscarDano(),
 *           morrer(t0a1), definirLuz(v), definirVida(frac), definirSela(bool),
 *           definirArmaduraMontaria('ferro'|'ouro'|'diamante'|null), dispose() }.
 * definirSela, definirArmaduraMontaria e assento só têm efeito nas montarias.
 */
export function criarModeloMob(tipo, opcoes = {}) {
  const def = MODELOS[tipo];
  if (!def) throw new Error('Modelo de mob desconhecido: ' + tipo);
  opcoes = opcoes || {};
  let variante = 0;
  if (def.variantes) {
    const v = Number.isFinite(opcoes.variante) ? Math.floor(opcoes.variante) : Math.floor(Math.random() * def.variantes);
    variante = ((v % def.variantes) + def.variantes) % def.variantes;
  }
  return new ModeloMob(tipo, def, recursosDe(tipo, variante), opcoes, variante);
}
