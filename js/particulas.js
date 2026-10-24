// =====================================================================
// Hackraft - Partículas (Fase 5)
// ---------------------------------------------------------------------
// Pedacinhos de bloco, fumaça, fagulhas, brilhos, neve...
// Usa um "pool" fixo: todas as partículas são criadas uma vez só e
// reaproveitadas, então não sobra lixo para o navegador limpar.
// Há duas camadas (cada uma é um THREE.Points):
//   - normal: pedacinhos quadrados e fumaça (mistura normal)
//   - aditiva: brilhos redondos, fogo, raio, gelo (somam luz)
// =====================================================================

import * as THREE from 'three';
import { texturaDaFace, SOLIDO } from './blocks.js';

// ----- Números ajustáveis -----
const MAX_NORMAL = 1000;          // máximo de partículas vivas na camada normal
const MAX_ADITIVA = 1000;         // idem na camada aditiva (total = 2000)
const PEDACINHOS_EXPLOSAO = 20;   // pedacinhos soltos ao quebrar um bloco
const TAMANHO_PEDACINHO = 0.11;   // tamanho de um pedacinho (em blocos)
const VELOCIDADE_PEDACINHO = 2.6; // velocidade de saída dos pedacinhos
const GRAVIDADE_PEDACINHO = 14;   // gravidade dos pedacinhos
const VIDA_PEDACINHO = 0.9;       // segundos de vida dos pedacinhos
const QUICAR_FATOR = 0.3;         // quanto da velocidade volta ao quicar (0 = para seco)
const ATRITO_CHAO = 0.6;          // quanto da velocidade horizontal sobra ao quicar

// Padrões de emitir() (tudo pode ser trocado na chamada)
const PADRAO = {
  qtd: 8, cor: '#ffffff', velocidade: 2, espalhar: 0.2, gravidade: 0,
  vida: 0.8, tamanho: 0.12, aditivo: false, arrasto: 0, quicar: false,
};

// ----- Shader -----
// O tamanho do ponto é dado em blocos (mundo) e diminui com a distância.
const VERTEX = `
  attribute vec3 cor;
  attribute float tamanho;
  attribute float alfa;
  uniform float uEscala;   // pixels por bloco a 1 de distância
  varying vec3 vCor;
  varying float vAlfa;
  void main() {
    vCor = cor;
    vAlfa = alfa;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, tamanho * uEscala / max(0.1, -mv.z));
  }
`;
const FRAGMENT = `
  uniform float uRedondo;  // 1 = ponto redondo suave, 0 = quadrado
  varying vec3 vCor;
  varying float vAlfa;
  void main() {
    float a = vAlfa;
    if (uRedondo > 0.5) {
      float d = length(gl_PointCoord - 0.5);
      a *= 1.0 - smoothstep(0.05, 0.5, d);
    }
    if (a < 0.01) discard;
    gl_FragColor = vec4(vCor, a);
  }
`;

// Uma camada: guarda os dados de cada partícula em arrays fixos
class Camada {
  constructor(scene, max, aditiva) {
    this.max = max;
    this.vivas = 0;
    this.aditiva = aditiva;
    this.proximoSobrescrever = 0;       // quando enche, troca as mais antigas em rodízio
    // Dados que vão para a placa de vídeo
    this.pos = new Float32Array(max * 3);
    this.cor = new Float32Array(max * 3);
    this.tam = new Float32Array(max);
    this.alfa = new Float32Array(max);
    // Dados só da simulação
    this.vel = new Float32Array(max * 3);
    this.tempo = new Float32Array(max);      // vida restante
    this.vidaTotal = new Float32Array(max);
    this.tamBase = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.arrasto = new Float32Array(max);
    this.quica = new Uint8Array(max);

    const geo = new THREE.BufferGeometry();
    this.atrPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.atrCor = new THREE.BufferAttribute(this.cor, 3).setUsage(THREE.DynamicDrawUsage);
    this.atrTam = new THREE.BufferAttribute(this.tam, 1).setUsage(THREE.DynamicDrawUsage);
    this.atrAlfa = new THREE.BufferAttribute(this.alfa, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.atrPos);
    geo.setAttribute('cor', this.atrCor);
    geo.setAttribute('tamanho', this.atrTam);
    geo.setAttribute('alfa', this.atrAlfa);
    geo.setDrawRange(0, 0);
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uEscala: { value: 500 }, uRedondo: { value: aditiva ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: aditiva ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pontos = new THREE.Points(geo, this.material);
    this.pontos.frustumCulled = false;   // as posições mudam o tempo todo
    this.pontos.renderOrder = aditiva ? 11 : 10;
    // Antes de desenhar, calcula quantos pixels vale 1 bloco a 1 de distância
    const tamTela = new THREE.Vector2();
    this.pontos.onBeforeRender = (renderer, cena, camera) => {
      renderer.getDrawingBufferSize(tamTela);
      const fov = (camera.fov || 75) * Math.PI / 180;
      this.material.uniforms.uEscala.value = tamTela.y / (2 * Math.tan(fov / 2));
    };
    scene.add(this.pontos);
  }

  // Devolve o índice livre (ou o de uma partícula antiga, se estiver cheio)
  reservar() {
    if (this.vivas < this.max) return this.vivas++;
    const i = this.proximoSobrescrever;
    this.proximoSobrescrever = (i + 1) % this.max;
    return i;
  }

  // Copia a partícula "de" para o lugar "para" (usado ao remover uma morta)
  copiar(de, para) {
    const d3 = de * 3, p3 = para * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[p3 + k] = this.pos[d3 + k];
      this.cor[p3 + k] = this.cor[d3 + k];
      this.vel[p3 + k] = this.vel[d3 + k];
    }
    this.tam[para] = this.tam[de];
    this.alfa[para] = this.alfa[de];
    this.tempo[para] = this.tempo[de];
    this.vidaTotal[para] = this.vidaTotal[de];
    this.tamBase[para] = this.tamBase[de];
    this.grav[para] = this.grav[de];
    this.arrasto[para] = this.arrasto[de];
    this.quica[para] = this.quica[de];
  }
}

// Cores temporárias (reaproveitadas, sem criar objetos a cada chamada)
const _cor = new THREE.Color();
const _rgb = { r: 0, g: 0, b: 0 };
const _cacheCores = new Map();   // texto CSS -> [r, g, b] (valores sRGB, prontos para o shader)

// Converte uma cor (texto CSS, número 0xRRGGBB ou THREE.Color) em r,g,b (0 a 1)
// e guarda em saida[pos..pos+2]. Textos são convertidos só uma vez (cache).
function escreverCor(c, saida, pos) {
  if (typeof c === 'string') {
    let v = _cacheCores.get(c);
    if (!v) {
      _cor.set(c).getRGB(_rgb, THREE.SRGBColorSpace);
      v = [_rgb.r, _rgb.g, _rgb.b];
      if (_cacheCores.size >= 64) _cacheCores.clear();   // limite do cache
      _cacheCores.set(c, v);
    }
    saida[pos] = v[0]; saida[pos + 1] = v[1]; saida[pos + 2] = v[2];
    return;
  }
  if (typeof c === 'number') _cor.setHex(c);
  else if (c && c.isColor) _cor.copy(c);
  else _cor.set('#ffffff');
  _cor.getRGB(_rgb, THREE.SRGBColorSpace);
  saida[pos] = _rgb.r; saida[pos + 1] = _rgb.g; saida[pos + 2] = _rgb.b;
}

export class Particulas {
  /** mundo é opcional: com ele os pedacinhos quicam no chão */
  constructor({ scene, mundo = null }) {
    this.scene = scene;
    this.mundo = mundo;
    this.normal = new Camada(scene, MAX_NORMAL, false);
    this.aditiva = new Camada(scene, MAX_ADITIVA, true);
    this.coresPorBloco = new Map();     // id do bloco -> Float32Array [r,g,b, r,g,b, ...]
    this.coresPorTextura = new Map();   // nome da textura -> Float32Array
    this._listaCores = [];              // lista temporária de cores (cores[])
  }

  definirMundo(mundo) { this.mundo = mundo; }

  /** Quantas partículas estão vivas agora (para o debug) */
  get vivas() { return this.normal.vivas + this.aditiva.vivas; }

  // ------------------------------------------------------------------
  // Emitir
  // ------------------------------------------------------------------
  emitir(o) {
    const p = o || {};
    const qtd = p.qtd ?? PADRAO.qtd;
    const velocidade = p.velocidade ?? PADRAO.velocidade;
    const espalhar = p.espalhar ?? PADRAO.espalhar;
    const gravidade = p.gravidade ?? PADRAO.gravidade;
    const vidaBase = p.vida ?? PADRAO.vida;
    const tamanho = p.tamanho ?? PADRAO.tamanho;
    const arrasto = p.arrasto ?? PADRAO.arrasto;
    const quicar = p.quicar ?? PADRAO.quicar;
    const cam = (p.aditivo ?? PADRAO.aditivo) ? this.aditiva : this.normal;
    const x = p.x || 0, y = p.y || 0, z = p.z || 0;
    const bvx = p.vx || 0, bvy = p.vy || 0, bvz = p.vz || 0;   // velocidade base extra (opcional)

    // Cores: lista (textos, números ou THREE.Color), Float32Array [r,g,b,...] pronto, ou uma só
    const cores = p.cores;
    const temLista = cores && cores.length > 0;
    const prontas = temLista && ArrayBuffer.isView(cores);
    const corUnica = p.cor ?? PADRAO.cor;

    for (let n = 0; n < qtd; n++) {
      const i = cam.reservar();
      const i3 = i * 3;
      // Posição inicial: dentro de um cubo de lado "espalhar" em volta do ponto
      cam.pos[i3] = x + (Math.random() - 0.5) * espalhar;
      cam.pos[i3 + 1] = y + (Math.random() - 0.5) * espalhar;
      cam.pos[i3 + 2] = z + (Math.random() - 0.5) * espalhar;
      // Direção aleatória (esfera) com força variável
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = velocidade * (0.4 + Math.random() * 0.6) / m;
      cam.vel[i3] = bvx + dx * f;
      cam.vel[i3 + 1] = bvy + dy * f;
      cam.vel[i3 + 2] = bvz + dz * f;
      // Cor
      if (prontas) {
        const k = (Math.floor(Math.random() * (cores.length / 3))) * 3;
        cam.cor[i3] = cores[k]; cam.cor[i3 + 1] = cores[k + 1]; cam.cor[i3 + 2] = cores[k + 2];
      } else if (temLista) {
        escreverCor(cores[Math.floor(Math.random() * cores.length)], cam.cor, i3);
      } else {
        escreverCor(corUnica, cam.cor, i3);
      }
      const vida = vidaBase * (0.7 + Math.random() * 0.6);
      cam.tempo[i] = vida;
      cam.vidaTotal[i] = vida;
      cam.tamBase[i] = tamanho * (0.75 + Math.random() * 0.5);
      cam.tam[i] = cam.tamBase[i];
      cam.alfa[i] = 1;
      cam.grav[i] = gravidade;
      cam.arrasto[i] = arrasto;
      cam.quica[i] = quicar ? 1 : 0;
    }
  }

  // ------------------------------------------------------------------
  // Cores de um bloco, tiradas dos pixels da textura (com cache)
  // ------------------------------------------------------------------
  _coresDaTextura(nome, texturas) {
    let lista = this.coresPorTextura.get(nome);
    if (lista) return lista;
    const tmp = [];
    try {
      const canvas = texturas.canvasDaTextura(nome);
      const dados = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let k = 0; k < dados.length; k += 4) {
        if (dados[k + 3] < 128) continue;            // ignora furos transparentes
        tmp.push(dados[k] / 255, dados[k + 1] / 255, dados[k + 2] / 255);
      }
    } catch (e) { /* sem canvas: usa cinza */ }
    if (tmp.length === 0) tmp.push(0.5, 0.5, 0.5);
    lista = new Float32Array(tmp);
    this.coresPorTextura.set(nome, lista);
    return lista;
  }

  _coresDoBloco(id, texturas) {
    let lista = this.coresPorBloco.get(id);
    if (lista) return lista;
    // Junta as cores do lado e do topo
    const a = this._coresDaTextura(texturaDaFace(id, 'lado'), texturas);
    const b = this._coresDaTextura(texturaDaFace(id, 'topo'), texturas);
    lista = new Float32Array(a.length + b.length);
    lista.set(a, 0);
    lista.set(b, a.length);
    this.coresPorBloco.set(id, lista);
    return lista;
  }

  /** Pedacinhos saindo do centro do bloco quebrado */
  explosaoBloco(x, y, z, idBloco, texturas) {
    const cores = this._coresDoBloco(idBloco, texturas);
    this.emitir({
      x: x + 0.5, y: y + 0.5, z: z + 0.5,
      qtd: PEDACINHOS_EXPLOSAO, cores, espalhar: 0.6,
      velocidade: VELOCIDADE_PEDACINHO, gravidade: GRAVIDADE_PEDACINHO,
      vida: VIDA_PEDACINHO, tamanho: TAMANHO_PEDACINHO, quicar: true, vy: 1.5,
    });
  }

  // ------------------------------------------------------------------
  // Atalhos para os poderes
  // ------------------------------------------------------------------
  fagulhas(x, y, z, cor = '#ff8a1e') {
    this.emitir({ x, y, z, qtd: 10, cor, velocidade: 2.5, espalhar: 0.15, gravidade: 3, vida: 0.5, tamanho: 0.1, aditivo: true, arrasto: 1 });
  }

  fumaca(x, y, z) {
    this.emitir({ x, y, z, qtd: 4, cores: ['#6e6e6e', '#8a8a8a', '#555555'], velocidade: 0.4, vy: 0.9, espalhar: 0.3, gravidade: -0.5, vida: 1.4, tamanho: 0.3, arrasto: 0.8 });
  }

  neve(x, y, z) {
    this.emitir({ x, y, z, qtd: 6, cores: ['#ffffff', '#d8f0ff'], velocidade: 0.5, espalhar: 0.6, gravidade: 1.2, vida: 1.6, tamanho: 0.08, aditivo: true, arrasto: 1.5 });
  }

  brilhoCristal(x, y, z, cor = '#6ab4ff') {
    this.emitir({ x, y, z, qtd: 3, cor, velocidade: 0.5, vy: 0.6, espalhar: 0.5, gravidade: -0.3, vida: 0.9, tamanho: 0.12, aditivo: true, arrasto: 1 });
  }

  // ------------------------------------------------------------------
  // Atualizar (todo quadro)
  // ------------------------------------------------------------------
  atualizar(dt) {
    this._atualizarCamada(this.normal, dt);
    this._atualizarCamada(this.aditiva, dt);
  }

  _atualizarCamada(c, dt) {
    let n = c.vivas;
    if (n === 0) return;
    const { pos, vel, cor, tam, alfa, tempo, vidaTotal, tamBase, grav, arrasto, quica } = c;
    const mundo = this.mundo;
    const aditiva = c.aditiva;

    let i = 0;
    while (i < n) {
      tempo[i] -= dt;
      if (tempo[i] <= 0) {
        // Morreu: troca de lugar com a última viva (swap) e não avança o i
        n--;
        if (i !== n) c.copiar(n, i);
        continue;
      }
      const i3 = i * 3;
      // Gravidade e arrasto (freio do ar)
      vel[i3 + 1] -= grav[i] * dt;
      if (arrasto[i] > 0) {
        const fa = Math.max(0, 1 - arrasto[i] * dt);
        vel[i3] *= fa; vel[i3 + 1] *= fa; vel[i3 + 2] *= fa;
      }
      const ny = pos[i3 + 1] + vel[i3 + 1] * dt;
      const nx = pos[i3] + vel[i3] * dt;
      const nz = pos[i3 + 2] + vel[i3 + 2] * dt;

      // Quicar no chão (só para quem pediu e se há mundo)
      if (quica[i] && mundo && vel[i3 + 1] < 0 &&
          SOLIDO[mundo.obterBloco(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) {
        vel[i3 + 1] = -vel[i3 + 1] * QUICAR_FATOR;
        vel[i3] *= ATRITO_CHAO;
        vel[i3 + 2] *= ATRITO_CHAO;
        if (Math.abs(vel[i3 + 1]) < 0.5) vel[i3 + 1] = 0;
        pos[i3 + 1] = Math.floor(ny) + 1.001;
      } else {
        pos[i3 + 1] = ny;
      }
      pos[i3] = nx;
      pos[i3 + 2] = nz;

      // Some aos poucos: alfa cai no fim da vida; brilhos também encolhem
      const t = tempo[i] / vidaTotal[i];   // 1 = acabou de nascer, 0 = morrendo
      alfa[i] = t < 0.4 ? t / 0.4 : 1;
      tam[i] = aditiva ? tamBase[i] * (0.4 + 0.6 * t) : tamBase[i];
      i++;
    }
    c.vivas = n;
    if (c.proximoSobrescrever >= n) c.proximoSobrescrever = 0;
    c.geo.setDrawRange(0, n);
    c.atrPos.needsUpdate = true;
    c.atrCor.needsUpdate = true;
    c.atrTam.needsUpdate = true;
    c.atrAlfa.needsUpdate = true;
  }
}
