// =====================================================================
// Hackraft - Meteoro (comando /armageddon)
// ---------------------------------------------------------------------
// Um cometa gigante cai do céu perto de quem usou o comando, abre uma
// cratera e empurra/machuca quem estiver perto.
//
//   const meteoro = new Meteoro({ scene, mundo, particulas, jogador, rede, som, ui,
//                                 obterAlvos });
//   meteoro.invocar()                -> começa a queda (e avisa os outros jogadores)
//   meteoro.cair(x, y, z, dono)      -> a queda em si; dono = true muda os blocos
//   meteoro.atualizar(dt)            -> chame todo quadro
//
// Quem usa o comando (dono) abre a cratera e machuca os mobs. Os outros
// jogadores só veem o cometa e sentem o impacto (cada um cuida de si).
// =====================================================================

import * as THREE from 'three';
import { B } from './blocks.js';

const DISTANCIA_IMPACTO = 32;   // blocos à frente de quem usou o comando
const RAIO_METEORO = 3.2;       // tamanho do cometa
const RAIO_CRATERA = 9;         // blocos
const ALTURA_INICIAL = 260;     // de onde o cometa começa, acima do impacto
const RECUO_INICIAL = 60;       // e o quanto ele começa "para trás"
const VELOCIDADE = 24;          // blocos por segundo (a queda dura uns 11 s)
const RAIO_ONDA = 20;           // até onde o impacto machuca
const DANO_MAX = 14;            // dano no centro da onda
const DANO_MOBS = 60;
const DURACAO_CAUDA = 40;       // comprimento da cauda de fogo

export class Meteoro {
  constructor({ scene, mundo, particulas, jogador, rede, som, ui, obterAlvos }) {
    this.scene = scene;
    this.mundo = mundo;
    this.particulas = particulas;
    this.jogador = jogador;
    this.rede = rede;
    this.som = som;
    this.ui = ui;
    this.obterAlvos = obterAlvos || null;   // () => [{ posicao, raio, receberDano }]

    this.ativo = false;
    this.dono = false;
    this.alvo = new THREE.Vector3();        // ponto do impacto
    this.dir = new THREE.Vector3();         // direção da queda (unitária)
    this.restante = 0;                      // distância que falta percorrer
    this.tempo = 0;

    // ----- visual: pedra escura + casca de lava + cauda de fogo -----
    this.grupo = new THREE.Group();
    this.grupo.visible = false;
    const pedra = new THREE.Mesh(
      new THREE.IcosahedronGeometry(RAIO_METEORO, 1),
      new THREE.MeshBasicMaterial({ color: 0x2b1b14 }),
    );
    const lava = new THREE.Mesh(
      new THREE.IcosahedronGeometry(RAIO_METEORO * 1.18, 1),
      new THREE.MeshBasicMaterial({
        color: 0xff6a1a, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    // Cone apontando para trás (o +Y do cone vira "para trás" do cometa)
    const geoCauda = new THREE.ConeGeometry(RAIO_METEORO * 1.1, DURACAO_CAUDA, 12, 1, true);
    geoCauda.translate(0, DURACAO_CAUDA / 2, 0);
    const cauda = new THREE.Mesh(
      geoCauda,
      new THREE.MeshBasicMaterial({
        color: 0xff9a3a, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.grupo.add(pedra, lava, cauda);
    this.cauda = cauda;
    this.pedra = pedra;
    this.grupo.frustumCulled = false;
    scene.add(this.grupo);

    this._cima = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
  }

  /** Comando /armageddon: escolhe o ponto à frente do jogador e começa a queda */
  invocar() {
    if (this.ativo) return false;
    const p = this.jogador.posicao;
    const yaw = this.jogador.yaw;
    const x = Math.floor(p.x - Math.sin(yaw) * DISTANCIA_IMPACTO);
    const z = Math.floor(p.z - Math.cos(yaw) * DISTANCIA_IMPACTO);
    // Procura o chão de verdade: de cima para baixo, o primeiro bloco que não é ar
    let y = Math.floor(p.y) + 1;
    for (let yy = Math.floor(p.y) + 40; yy > 1; yy--) {
      if (this.mundo.obterBloco(x, yy, z) !== B.AR) { y = yy + 1; break; }
    }
    this.cair(x + 0.5, y, z + 0.5, true, yaw);
    // Os outros jogadores veem o cometa descer (direcao = onde ele começa a "olhar")
    this.rede?.enviarEfeito?.({
      tipo: 'meteoro', origem: [x + 0.5, y, z + 0.5], direcao: [-Math.sin(yaw), 0, -Math.cos(yaw)],
    });
    return true;
  }

  /** Começa a queda até o ponto (x, y, z). dono: este jogador abre a cratera. */
  cair(x, y, z, dono, yaw = null, hx = 0, hz = 0) {
    if (this.ativo) return;
    // Direção horizontal de onde o cometa vem: "adiante" de quem lançou
    let fx = hx, fz = hz;
    if (yaw !== null) { fx = -Math.sin(yaw); fz = -Math.cos(yaw); }
    const m = Math.hypot(fx, fz) || 1;
    fx /= m; fz /= m;

    this.alvo.set(x, y, z);
    const inicio = this._tmp.set(x + fx * RECUO_INICIAL, y + ALTURA_INICIAL, z + fz * RECUO_INICIAL);
    this.dir.subVectors(this.alvo, inicio);
    this.restante = this.dir.length();
    this.dir.normalize();
    this.grupo.position.copy(inicio);
    // A cauda aponta para trás (contra a direção da queda)
    this.cauda.quaternion.setFromUnitVectors(this._cima, this._tmp.copy(this.dir).negate());
    this.grupo.visible = true;
    this.ativo = true;
    this.dono = dono;
    this.tempo = 0;
    this.ui?.mostrarMensagem?.('☄ Um meteoro está caindo!');
  }

  atualizar(dt) {
    if (!this.ativo) return;
    this.tempo += dt;

    const passo = Math.min(VELOCIDADE * dt, this.restante);
    this.grupo.position.addScaledVector(this.dir, passo);
    this.restante -= passo;
    this.pedra.rotation.x += dt * 0.8;
    this.pedra.rotation.z += dt * 0.5;

    // Rastro de fogo e fumaça atrás do cometa
    const pos = this.grupo.position;
    this.particulas?.emitir?.({
      x: pos.x - this.dir.x * 2, y: pos.y - this.dir.y * 2, z: pos.z - this.dir.z * 2,
      qtd: 14, cores: ['#ff9a2a', '#ffd23f', '#ff5a1a'], espalhar: RAIO_METEORO * 1.4,
      velocidade: 3, gravidade: -1, vida: 1.2, tamanho: 0.9, aditivo: true, arrasto: 1,
    });
    this.particulas?.emitir?.({
      x: pos.x - this.dir.x * 5, y: pos.y - this.dir.y * 5, z: pos.z - this.dir.z * 5,
      qtd: 6, cores: ['#3a3a3a', '#555555'], espalhar: RAIO_METEORO * 1.6,
      velocidade: 1.5, gravidade: -0.4, vida: 2.5, tamanho: 1.4, aditivo: false, arrasto: 0.8,
    });

    if (this.restante <= 0) this._impacto();
  }

  _impacto() {
    this.ativo = false;
    this.grupo.visible = false;
    const { x, y, z } = this.alvo;

    // Explosão: bola de fogo, fumaça e pedaços voando
    this.particulas?.emitir?.({
      x, y: y + 1, z, qtd: 260, cores: ['#fff2a0', '#ffb030', '#ff6a1a'], espalhar: 5,
      velocidade: 22, gravidade: 4, vida: 1.6, tamanho: 0.9, aditivo: true, arrasto: 0.6,
    });
    this.particulas?.emitir?.({
      x, y: y + 2, z, qtd: 160, cores: ['#2f2f2f', '#4a4a4a', '#666666'], espalhar: 6,
      velocidade: 12, vy: 6, gravidade: -0.6, vida: 3.5, tamanho: 1.6, aditivo: false, arrasto: 0.7,
    });
    this.particulas?.emitir?.({
      x, y: y + 1, z, qtd: 220, cores: ['#6b4a2c', '#7a7a7a', '#4e3a26'], espalhar: 4,
      velocidade: 18, vy: 14, gravidade: 22, vida: 3, tamanho: 0.45, quicar: true, arrasto: 0.2,
    });
    this.som?.golpe?.('pedra');
    this.som?.dano?.();

    if (this.dono) this._abrirCratera(x, y, z);
    this._onda(x, y, z);
  }

  /** Tira os blocos numa tigela (esfera) em volta do impacto */
  _abrirCratera(cx, cy, cz) {
    const bx = Math.floor(cx), by = Math.floor(cy) - 3, bz = Math.floor(cz);
    const r = RAIO_CRATERA;
    const lista = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          const x = bx + dx, y = by + dy, z = bz + dz;
          if (y < 1) continue;
          const id = this.mundo.obterBloco(x, y, z);
          if (id === B.AR || id === B.ROCHA_MATRIZ) continue;
          lista.push([x, y, z, B.AR]);
        }
      }
    }
    if (lista.length === 0) return;
    if (typeof this.mundo.definirBlocos === 'function') this.mundo.definirBlocos(lista, 'local');
    else for (const b of lista) this.mundo.definirBloco(b[0], b[1], b[2], b[3], 'local');
  }

  /** Empurra e machuca quem está perto (cada jogador cuida de si; o dono cuida dos mobs) */
  _onda(x, y, z) {
    const p = this.jogador.posicao;
    const dx = p.x - x, dz = p.z - z;
    const dist = Math.hypot(dx, p.y - y, dz);
    if (dist < RAIO_ONDA) {
      const dano = Math.max(1, Math.round(DANO_MAX * (1 - dist / RAIO_ONDA)));
      this.jogador.machucar?.(dano, { tipo: 'meteoro', direcao: { x: dx, y: 0, z: dz } });
    }
    if (!this.dono || !this.obterAlvos) return;
    for (const alvo of this.obterAlvos()) {
      const d = Math.hypot(alvo.posicao.x - x, alvo.posicao.y - y, alvo.posicao.z - z);
      if (d < RAIO_ONDA) alvo.receberDano?.(Math.round(DANO_MOBS * (1 - d / RAIO_ONDA)), 'fogo', { queimar: 5 });
    }
  }
}
