// =====================================================================
// Hackraft - Jogador
// ---------------------------------------------------------------------
// Cuida de: teclado e mouse, movimento e física (gravidade, pulo, água),
// colisão com os blocos, câmera (1ª e 3ª pessoa), quebrar e colocar blocos.
// O jogador só age quando o mouse está travado e nenhum menu está aberto.
// =====================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { B, BLOCOS, SOLIDO, LIQUIDO } from './blocks.js';
import { obterItem } from './items.js';

const METADE_LARGURA = CONFIG.LARGURA_JOGADOR / 2;
const ALTURA = CONFIG.ALTURA_JOGADOR;
const EPS = 0.0001;                 // folguinha para evitar erros de arredondamento
const PASSO_MAX = 0.3;              // deslocamento máximo por subpasso (em blocos)
const LIMITE_PITCH = Math.PI / 2 - 0.01;

export class Jogador {
  /**
   * @param opcoes { camera, scene, mundo, inventario, ui, som, personagem, texturas }
   * `texturas` é extra (fora do contrato): usado nas rachaduras de quebrar bloco.
   */
  constructor({ camera, scene, mundo, inventario, ui, som, personagem, texturas }) {
    this.camera = camera;
    this.scene = scene;
    this.mundo = mundo;
    this.inventario = inventario;
    this.ui = ui;
    this.som = som;
    this.personagem = personagem;
    this.texturas = texturas;

    // Estado do jogador
    this.posicao = new THREE.Vector3(0, 80, 0); // nos pés
    this.velocidade = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.noChao = false;
    this.naAgua = false;
    this.modoCamera = 'primeira';

    // Entrada
    this.teclas = {};                  // event.code → true se apertada
    this.botoes = [false, false, false];

    // Quebrar e colocar
    this.alvoX = 0; this.alvoY = 0; this.alvoZ = 0;
    this.temAlvoQuebra = false;
    this.progresso = 0;
    this.tempoGolpe = 0;
    this.espera = 0;                   // pausa depois de quebrar
    this.tempoColocar = 0;

    // Passos e submersão
    this.distPasso = 0;
    this.submerso = false;
    this.velHorizontal = 0;

    // Objetos reaproveitados (evita criar lixo a cada quadro)
    this._olhos = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this.camera.rotation.order = 'YXZ';

    // Personagem (só aparece na 3ª pessoa)
    this.personagem.grupo.visible = false;
    scene.add(this.personagem.grupo);

    // Contorno do bloco mirado
    this.contorno = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 })
    );
    this.contorno.visible = false;
    scene.add(this.contorno);

    // Rachadura que aparece no bloco sendo quebrado
    this.rachaduraMat = new THREE.MeshBasicMaterial({
      map: texturas && texturas.rachaduras ? texturas.rachaduras[0] : null,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.rachadura = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), this.rachaduraMat);
    this.rachadura.visible = false;
    scene.add(this.rachadura);
    this.estagioRachadura = -1;

    this._ligarEventos();
  }

  // ------------------------------------------------------------------
  // Entrada (teclado e mouse)
  // ------------------------------------------------------------------

  /** true se o jogador pode agir agora */
  get ativo() {
    return this.ui.mouseTravado && !this.ui.menuAberto;
  }

  _ligarEventos() {
    window.addEventListener('keydown', (e) => {
      // F5 ou V trocam a câmera. No F5 também tentamos impedir que a página
      // recarregue. Em muitos notebooks, porém, a tecla F5 (sem o Fn) manda o
      // comando "Atualizar" do sistema, que o navegador não deixa bloquear.
      // Por isso existe a tecla V como alternativa.
      const ehF5 = e.code === 'F5' || e.key === 'F5' || e.code === 'BrowserRefresh';
      if (ehF5 || e.code === 'KeyV') {
        if (ehF5) e.preventDefault();
        if (!e.repeat && this.ativo) {
          this.modoCamera = this.modoCamera === 'primeira' ? 'terceira' : 'primeira';
        }
        return;
      }
      this.teclas[e.code] = true;
      // Evita que o espaço "aperte" algum botão da página
      if (e.code === 'Space' && this.ativo) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      this.teclas[e.code] = false;
    });

    // Se a janela perder o foco, ninguém fica "preso" andando
    window.addEventListener('blur', () => {
      this.teclas = {};
      this.botoes[0] = this.botoes[1] = this.botoes[2] = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.ativo) return;
      this.yaw -= e.movementX * CONFIG.SENSIBILIDADE_MOUSE;
      this.pitch -= e.movementY * CONFIG.SENSIBILIDADE_MOUSE;
      if (this.pitch > LIMITE_PITCH) this.pitch = LIMITE_PITCH;
      if (this.pitch < -LIMITE_PITCH) this.pitch = -LIMITE_PITCH;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.ativo || e.button > 2) return;
      this.botoes[e.button] = true;
      if (e.button === 2) this.tempoColocar = 0; // coloca na hora
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.botoes[e.button] = false;
    });
  }

  // ------------------------------------------------------------------
  // Colisão
  // ------------------------------------------------------------------

  /** true se a caixa do jogador, com os pés em (px, py, pz), encosta num bloco sólido */
  _colide(px, py, pz) {
    const x0 = Math.floor(px - METADE_LARGURA + EPS);
    const x1 = Math.floor(px + METADE_LARGURA - EPS);
    const y0 = Math.floor(py + EPS);
    const y1 = Math.floor(py + ALTURA - EPS);
    const z0 = Math.floor(pz - METADE_LARGURA + EPS);
    const z1 = Math.floor(pz + METADE_LARGURA - EPS);
    const mundo = this.mundo;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (SOLIDO[mundo.obterBloco(x, y, z)]) return true;
        }
      }
    }
    return false;
  }

  /** Move o jogador no eixo Y; ajusta noChao e a velocidade se bater */
  _moverY(d) {
    const p = this.posicao;
    const novo = p.y + d;
    if (!this._colide(p.x, novo, p.z)) {
      p.y = novo;
      return;
    }
    if (d < 0) {
      p.y = Math.floor(novo + EPS) + 1; // pousa em cima do bloco
      this.noChao = true;
    } else {
      p.y = Math.floor(novo + ALTURA - EPS) - ALTURA; // bate a cabeça
    }
    this.velocidade.y = 0;
  }

  _moverX(d) {
    const p = this.posicao;
    const novo = p.x + d;
    if (!this._colide(novo, p.y, p.z)) {
      p.x = novo;
      return;
    }
    p.x = d > 0
      ? Math.floor(novo + METADE_LARGURA - EPS) - METADE_LARGURA
      : Math.floor(novo - METADE_LARGURA + EPS) + 1 + METADE_LARGURA;
    this.velocidade.x = 0;
  }

  _moverZ(d) {
    const p = this.posicao;
    const novo = p.z + d;
    if (!this._colide(p.x, p.y, novo)) {
      p.z = novo;
      return;
    }
    p.z = d > 0
      ? Math.floor(novo + METADE_LARGURA - EPS) - METADE_LARGURA
      : Math.floor(novo - METADE_LARGURA + EPS) + 1 + METADE_LARGURA;
    this.velocidade.z = 0;
  }

  // ------------------------------------------------------------------
  // Loop principal do jogador
  // ------------------------------------------------------------------

  atualizar(dt) {
    const ativo = this.ativo;
    const p = this.posicao;
    const mundo = this.mundo;

    // Sem controle (menu aberto): solta os botões do mouse
    if (!ativo) {
      this.botoes[0] = this.botoes[1] = this.botoes[2] = false;
    }

    // Só mexe na física se o chão sob o jogador já existe
    if (mundo.estaPronto(p.x, p.z)) {
      this._fisica(dt, ativo);
    } else {
      this.velocidade.set(0, 0, 0);
    }

    // Caiu no vazio: volta ao ponto de nascimento
    if (p.y < CONFIG.Y_ABISMO) {
      const s = mundo.pontoDeNascimento();
      this.teletransportar(s.x, s.y, s.z);
    }

    this._atualizarCamera();

    // Ações com os blocos (usa os olhos e a direção do olhar)
    if (ativo) {
      this._acoesDeBloco(dt);
    } else {
      this._limparQuebra();
      this.contorno.visible = false;
    }

    // Personagem visível só na 3ª pessoa
    const terceira = this.modoCamera === 'terceira';
    this.personagem.grupo.visible = terceira;
    if (terceira) {
      this.personagem.grupo.position.copy(p);
      this.personagem.grupo.rotation.y = this.yaw;
      this.personagem.animar(dt, this.velHorizontal, !this.noChao);
      this.personagem.definirOlhar(this.pitch);
    }
  }

  _fisica(dt, ativo) {
    const p = this.posicao;
    const v = this.velocidade;
    const mundo = this.mundo;
    const t = this.teclas;

    // Está na água? (bloco nos pés ou no meio do corpo)
    const idPes = mundo.obterBloco(p.x, p.y + 0.1, p.z);
    const idMeio = mundo.obterBloco(p.x, p.y + 0.9, p.z);
    this.naAgua = !!(LIQUIDO[idPes] || LIQUIDO[idMeio]);
    const naAgua = this.naAgua;

    // Direção desejada, a partir do yaw
    let frente = 0, lado = 0;
    let pulando = false, correndo = false;
    if (ativo) {
      if (t.KeyW) frente += 1;
      if (t.KeyS) frente -= 1;
      if (t.KeyD) lado += 1;
      if (t.KeyA) lado -= 1;
      pulando = !!t.Space;
      correndo = !!(t.ShiftLeft || t.ShiftRight);
    }
    const sen = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let dx = -sen * frente + cos * lado;
    let dz = -cos * frente - sen * lado;
    const comp = Math.hypot(dx, dz);
    if (comp > 0) { dx /= comp; dz /= comp; }

    const vel = naAgua ? CONFIG.VEL_NADAR : (correndo ? CONFIG.VEL_CORRER : CONFIG.VEL_ANDAR);
    const alvoX = dx * vel;
    const alvoZ = dz * vel;
    const acel = (naAgua ? CONFIG.ACEL_AGUA : (this.noChao ? CONFIG.ACEL_CHAO : CONFIG.ACEL_AR)) * dt;

    // Aproxima a velocidade horizontal da desejada, de forma suave
    const difX = alvoX - v.x;
    const difZ = alvoZ - v.z;
    const difLen = Math.hypot(difX, difZ);
    if (difLen <= acel) {
      v.x = alvoX;
      v.z = alvoZ;
    } else {
      v.x += (difX / difLen) * acel;
      v.z += (difZ / difLen) * acel;
    }

    // Vertical
    if (naAgua) {
      v.y -= CONFIG.GRAVIDADE_AGUA * dt;
      v.y -= v.y * Math.min(1, CONFIG.ARRASTO_AGUA * dt);
      if (pulando) {
        // Na superfície (cabeça fora da água) dá para pular para fora
        const cabecaNaAgua = LIQUIDO[mundo.obterBloco(p.x, p.y + 1.4, p.z)];
        if (!cabecaNaAgua) {
          if (v.y < CONFIG.VEL_PULO * 0.8) v.y = CONFIG.VEL_PULO * 0.8;
        } else {
          v.y += (CONFIG.VEL_SUBIR_AGUA - v.y) * Math.min(1, 8 * dt);
        }
      }
    } else {
      v.y -= CONFIG.GRAVIDADE * dt;
      if (v.y < -CONFIG.VEL_MAX_QUEDA) v.y = -CONFIG.VEL_MAX_QUEDA;
      if (pulando && this.noChao) {
        v.y = CONFIG.VEL_PULO;
        this.noChao = false;
      }
    }

    // Move em subpassos (para não atravessar paredes), eixo por eixo
    const ddx = v.x * dt, ddy = v.y * dt, ddz = v.z * dt;
    const maior = Math.max(Math.abs(ddx), Math.abs(ddy), Math.abs(ddz));
    const n = Math.max(1, Math.ceil(maior / PASSO_MAX));
    this.noChao = false;
    for (let i = 0; i < n; i++) {
      this._moverY(ddy / n);
      this._moverX(ddx / n);
      this._moverZ(ddz / n);
    }

    this.velHorizontal = Math.hypot(v.x, v.z);

    // Passos
    if (this.noChao && !naAgua && this.velHorizontal > 0.5) {
      this.distPasso += this.velHorizontal * dt;
      if (this.distPasso >= CONFIG.DISTANCIA_PASSO) {
        this.distPasso = 0;
        const bloco = BLOCOS[mundo.obterBloco(p.x, p.y - 0.1, p.z)];
        if (bloco && bloco.som) this.som.passo(bloco.som);
      }
    } else if (!this.noChao) {
      this.distPasso = 0;
    }
  }

  // ------------------------------------------------------------------
  // Câmera
  // ------------------------------------------------------------------
  _atualizarCamera() {
    const p = this.posicao;
    const cam = this.camera;
    const olhos = this._olhos;
    olhos.set(p.x, p.y + CONFIG.ALTURA_OLHOS, p.z);

    // Direção do olhar
    const cp = Math.cos(this.pitch);
    this._dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    cam.rotation.set(this.pitch, this.yaw, 0);

    if (this.modoCamera === 'terceira') {
      // Anda para trás passo a passo até achar um bloco no caminho
      const d = this._dir;
      let dist = CONFIG.DISTANCIA_3A_PESSOA;
      for (let s = 0.1; s <= CONFIG.DISTANCIA_3A_PESSOA; s += 0.1) {
        const id = this.mundo.obterBloco(olhos.x - d.x * s, olhos.y - d.y * s, olhos.z - d.z * s);
        if (SOLIDO[id]) {
          dist = Math.max(0, s - 0.2);
          break;
        }
      }
      cam.position.set(olhos.x - d.x * dist, olhos.y - d.y * dist, olhos.z - d.z * dist);
    } else {
      cam.position.copy(olhos);
    }

    // Tom azul se a câmera estiver dentro da água
    const sub = !!LIQUIDO[this.mundo.obterBloco(cam.position.x, cam.position.y, cam.position.z)];
    if (sub !== this.submerso) {
      this.submerso = sub;
      this.ui.definirSubmerso(sub);
    }
  }

  // ------------------------------------------------------------------
  // Quebrar e colocar blocos
  // ------------------------------------------------------------------
  _limparQuebra() {
    this.temAlvoQuebra = false;
    this.progresso = 0;
    this.tempoGolpe = 0;
    this.rachadura.visible = false;
    this.estagioRachadura = -1;
  }

  _acoesDeBloco(dt) {
    const mundo = this.mundo;
    const alvo = mundo.raycast(this._olhos, this._dir, CONFIG.ALCANCE);

    // Contorno
    if (alvo) {
      this.contorno.position.set(alvo.x + 0.5, alvo.y + 0.5, alvo.z + 0.5);
      this.contorno.visible = true;
    } else {
      this.contorno.visible = false;
    }

    if (this.espera > 0) this.espera -= dt;
    if (this.tempoColocar > 0) this.tempoColocar -= dt;

    // ----- Quebrar (botão esquerdo) -----
    if (this.botoes[0] && alvo && this.espera <= 0) {
      const mesmo = this.temAlvoQuebra && alvo.x === this.alvoX &&
                    alvo.y === this.alvoY && alvo.z === this.alvoZ;
      if (!mesmo) {
        this._limparQuebra();
        this.temAlvoQuebra = true;
        this.alvoX = alvo.x; this.alvoY = alvo.y; this.alvoZ = alvo.z;
        this.tempoGolpe = 0;
      }
      const bloco = BLOCOS[alvo.id];
      if (bloco.dureza === Infinity) {
        // Bloco inquebrável: sem progresso, sem som e sem rachadura
        this.rachadura.visible = false;
      } else {
        this.progresso += dt / Math.max(bloco.dureza, 0.01);
        // Som de golpe
        this.tempoGolpe -= dt;
        if (this.tempoGolpe <= 0) {
          this.tempoGolpe = CONFIG.INTERVALO_GOLPE;
          if (bloco.som) this.som.golpe(bloco.som);
        }
        if (this.progresso >= 1) {
          this._quebrar(alvo, bloco);
        } else {
          this._mostrarRachadura();
        }
      }
    } else if (this.temAlvoQuebra) {
      // Soltou o botão ou trocou de alvo
      this._limparQuebra();
    }

    // ----- Colocar (botão direito) -----
    if (this.botoes[2] && this.tempoColocar <= 0 && alvo) {
      this._colocar(alvo);
    }
  }

  _mostrarRachadura() {
    const estagio = Math.min(9, Math.floor(this.progresso * 10));
    this.rachadura.position.set(this.alvoX + 0.5, this.alvoY + 0.5, this.alvoZ + 0.5);
    this.rachadura.visible = true;
    if (estagio !== this.estagioRachadura && this.texturas && this.texturas.rachaduras) {
      this.estagioRachadura = estagio;
      this.rachaduraMat.map = this.texturas.rachaduras[estagio];
    }
  }

  _quebrar(alvo, bloco) {
    this.mundo.definirBloco(alvo.x, alvo.y, alvo.z, B.AR);
    if (bloco.item !== null) {
      const sobrou = this.inventario.adicionar(bloco.item, 1);
      if (sobrou > 0) this.ui.mostrarMensagem('Inventário cheio!');
    }
    if (bloco.som) this.som.quebrar(bloco.som);
    this._limparQuebra();
    this.espera = CONFIG.ESPERA_APOS_QUEBRAR;
  }

  _colocar(alvo) {
    const n = alvo.normal;
    if (n.x === 0 && n.y === 0 && n.z === 0) return; // origem dentro de um bloco

    // O item na mão precisa ser um bloco
    const sel = this.inventario.itemSelecionado();
    if (!sel) return;
    const def = obterItem(sel.item);
    if (!def || def.tipo !== 'bloco' || def.bloco === null) return;

    const x = alvo.x + n.x, y = alvo.y + n.y, z = alvo.z + n.z;
    const destino = this.mundo.obterBloco(x, y, z);
    if (destino !== B.AR && !LIQUIDO[destino]) return;

    // Bloco sólido não pode nascer dentro do jogador
    if (SOLIDO[def.bloco]) {
      const p = this.posicao;
      const cruza = x < p.x + METADE_LARGURA && x + 1 > p.x - METADE_LARGURA &&
                    y < p.y + ALTURA && y + 1 > p.y &&
                    z < p.z + METADE_LARGURA && z + 1 > p.z - METADE_LARGURA;
      if (cruza) return;
    }

    if (this.mundo.definirBloco(x, y, z, def.bloco)) {
      this.inventario.remover(this.inventario.selecionado, 1);
      const tipo = BLOCOS[def.bloco].som;
      if (tipo) this.som.colocar(tipo);
      this.tempoColocar = CONFIG.INTERVALO_COLOCAR;
    }
  }

  // ------------------------------------------------------------------
  // Posição, salvar e carregar
  // ------------------------------------------------------------------
  teletransportar(x, y, z) {
    this.posicao.set(x, y, z);
    this.velocidade.set(0, 0, 0);
    this.noChao = false;
  }

  serializar() {
    return {
      pos: [this.posicao.x, this.posicao.y, this.posicao.z],
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  carregar(dados) {
    if (!dados) return;
    if (Array.isArray(dados.pos) && dados.pos.length === 3 && dados.pos.every(Number.isFinite)) {
      this.teletransportar(dados.pos[0], dados.pos[1], dados.pos[2]);
    }
    if (Number.isFinite(dados.yaw)) this.yaw = dados.yaw;
    if (Number.isFinite(dados.pitch)) {
      this.pitch = Math.max(-LIMITE_PITCH, Math.min(LIMITE_PITCH, dados.pitch));
    }
  }
}
