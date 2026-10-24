// =====================================================================
// Hackraft - Modo hacker (Fase 4)
// ---------------------------------------------------------------------
// Ao ligar (/hacker):
//   1. abertura de ~3,6 s: interferências suaves, tela escura,
//      "ACESSO CONCEDIDO" digitado e fade de volta para o jogo;
//   2. ambiente: tom verde, vinheta, scanlines e chuva de letras Matrix
//      (só nas laterais, o centro da tela fica limpo);
//   3. raio-X por 30 s: contorno brilhante nos blocos com `xray: true`
//      (o presente, e os minérios de poder da Fase 5) através das paredes;
//   4. o personagem veste a roupa 'hacker' (sem mexer na roupa equipada).
//
// Segurança para a vista: nada de flash forte nem contínuo. As
// interferências têm opacidade baixa e acontecem só na abertura.
// =====================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { BLOCOS } from './blocks.js';

// ---------- Números ajustáveis deste módulo ----------
const DURACAO_RAIOX = 30;       // segundos de raio-X a cada ativação
const RAIO_RAIOX = 20;          // blocos em volta do jogador
const INTERVALO_VARREDURA = 1;  // segundos entre varreduras
const ORCAMENTO_VARREDURA_MS = 2; // tempo máximo de varredura por quadro
const MAX_INSTANCIAS = 200;     // máximo de contornos desenhados
const FPS_MATRIX = 20;          // quadros por segundo da chuva de letras
const TAM_COLUNA = 16;          // largura de cada coluna de letras (px)
const COR_VERDE = '#33ff66';

// Linha do tempo da abertura (segundos)
const ABERTURA = {
  interferencias: [0.10, 0.60, 1.00], // início de cada uma (3 em 1,2 s)
  duracaoInterf: 0.2,
  opacidadeInterf: 0.3,               // máximo permitido: 0.35
  escurecerDe: 0.8,
  escurecerAte: 1.4,
  escuroMax: 0.85,
  digitarDe: 1.4,
  tempoPorLetra: 0.06,
  fimTexto: 2.9,                      // aqui começa o fade de saída
  fade: 0.6,
};
const TEXTO_ACESSO = 'ACESSO CONCEDIDO';
const TEXTO_SUB = '> sistema invadido com sucesso_';

const CSS = `
#hacker-ambiente { position: fixed; inset: 0; pointer-events: none; z-index: 4; opacity: 1; transition: opacity 0.4s; }
#hacker-ambiente.saindo { opacity: 0; }
#hacker-ambiente > div, #hacker-ambiente > canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
#hacker-tom { background: rgba(0, 255, 120, 0.05); mix-blend-mode: screen; }
#hacker-vinheta { background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,20,8,0.55) 100%); }
#hacker-scanlines { background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px); }
#hacker-matrix {
  opacity: 0.35;
  -webkit-mask-image: radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.35) 55%, #000 80%);
  mask-image: radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.35) 55%, #000 80%);
}
#hacker-abertura { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 15; }
#hacker-raiox {
  position: fixed; left: 8px; top: 8px; z-index: 7; pointer-events: none;
  padding: 3px 8px; background: rgba(0, 0, 0, 0.55); border: 1px solid #33ff66;
  font: bold 13px 'Courier New', monospace; color: #33ff66; text-shadow: 0 0 6px #33ff66;
}
`;

// Letras da chuva Matrix: katakana + números + letras
const LETRAS = [];
for (let c = 0x30A1; c <= 0x30F6; c++) LETRAS.push(String.fromCharCode(c));
for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') LETRAS.push(c);

export class ModoHacker {
  constructor({ equipamento, mundo, scene, camera, chat, som, ui } = {}) {
    this.equipamento = equipamento;
    this.mundo = mundo;
    this.scene = scene;
    this.camera = camera;
    this.chat = chat;
    this.som = som;
    this.ui = ui;

    this.ativo = false;

    // DOM (criado só quando precisa)
    this._ambiente = null;
    this._canvasMatrix = null;
    this._ctxMatrix = null;
    this._canvasAbertura = null;
    this._ctxAbertura = null;
    this._contador = null;

    // Abertura
    this._tAbertura = -1;       // < 0 = sem abertura em andamento
    this._mensagemDada = false;
    this._interf = [];          // faixas de cada interferência (sorteadas 1 vez)
    this._largura = 0;
    this._altura = 0;

    // Chuva Matrix
    this._gotas = new Float32Array(0); // posição (em linhas) da cabeça de cada coluna
    this._velGotas = new Float32Array(0);
    this._acumMatrix = 0;

    // Raio-X
    this._tRaioX = 0;           // segundos restantes
    this._tVarredura = 0;
    this._varrendo = false;
    this._varrX = 0;            // próxima camada x a varrer
    this._varrCentro = [0, 0, 0];
    this._varrN = 0;            // quantos minérios achados até agora
    this._varrInicio = 0;       // quando a varredura começou (ms)
    this._tempoUltimaVarredura = 0;
    this._achados = new Float32Array(MAX_INSTANCIAS * 3);
    this._idsAchados = new Uint8Array(MAX_INSTANCIAS);
    this._nAchados = 0;
    this._malha = null;
    this._tPulso = 0;
    this._ultTextoContador = '';
    this._tempoUltimaVarredura = 0; // ms, para o debug/medição
    this._tempoMaxQuadro = 0;
    // Objetos reaproveitados
    this._matriz = new THREE.Matrix4();
    this._cor = new THREE.Color();
    this._corCache = new Map();

    this._aoRedimensionar = () => this._redimensionar();
    window.addEventListener('resize', this._aoRedimensionar);
  }

  // =====================================================================
  // Ligar / desligar
  // =====================================================================
  alternar() {
    if (this.ativo) this.desligar();
    else this.ligar();
  }

  ligar() {
    this.ativo = true;
    this.equipamento?.definirRoupaForcada?.('hacker');
    this.chat?.definirModoHacker?.(true);
    this.som?.glitch?.();

    this._injetarCSS();
    this._criarAmbiente();
    this._comecarAbertura();
    this._criarMalha();

    // Reinicia os 30 s de raio-X
    this._tRaioX = DURACAO_RAIOX;
    this._tVarredura = 0;     // varre logo no primeiro quadro
    this._varrendo = false;
    this._criarContador();
  }

  desligar() {
    if (!this.ativo && !this._ambiente) return;
    this.ativo = false;
    this.equipamento?.definirRoupaForcada?.(null);
    this.chat?.definirModoHacker?.(false);

    // Ambiente e abertura somem com fade de 0,4 s
    const amb = this._ambiente;
    if (amb) {
      amb.classList.add('saindo');
      this._ambiente = null;
      this._canvasMatrix = null;
      this._ctxMatrix = null;
      setTimeout(() => amb.remove(), 450);
    }
    const ab = this._canvasAbertura;
    if (ab) {
      ab.style.transition = 'opacity 0.4s';
      ab.style.opacity = '0';
      this._canvasAbertura = null;
      this._ctxAbertura = null;
      setTimeout(() => ab.remove(), 450);
    }
    this._tAbertura = -1;
    this._removerRaioX();
  }

  // =====================================================================
  // Atualização a cada quadro
  // =====================================================================
  atualizar(dt, posJogador) {
    if (!this.ativo) return;
    const t0 = performance.now();

    if (this._tAbertura >= 0) this._atualizarAbertura(dt);
    this._atualizarMatrix(dt);
    this._atualizarRaioX(dt, posJogador);

    const gasto = performance.now() - t0;
    if (gasto > this._tempoMaxQuadro) this._tempoMaxQuadro = gasto;
  }

  // =====================================================================
  // DOM e CSS
  // =====================================================================
  _injetarCSS() {
    if (document.getElementById('estilo-hacker')) return;
    const estilo = document.createElement('style');
    estilo.id = 'estilo-hacker';
    estilo.textContent = CSS;
    document.head.appendChild(estilo);
  }

  _criarAmbiente() {
    if (this._ambiente) this._ambiente.remove();
    const amb = document.createElement('div');
    amb.id = 'hacker-ambiente';
    for (const id of ['hacker-tom', 'hacker-vinheta', 'hacker-scanlines']) {
      const d = document.createElement('div');
      d.id = id;
      amb.appendChild(d);
    }
    const cv = document.createElement('canvas');
    cv.id = 'hacker-matrix';
    amb.appendChild(cv);
    document.body.appendChild(amb);
    this._ambiente = amb;
    this._canvasMatrix = cv;
    this._ctxMatrix = cv.getContext('2d');

    // Canvas da abertura (por cima de tudo do jogo, abaixo dos menus)
    if (this._canvasAbertura) this._canvasAbertura.remove();
    const ab = document.createElement('canvas');
    ab.id = 'hacker-abertura';
    document.body.appendChild(ab);
    this._canvasAbertura = ab;
    this._ctxAbertura = ab.getContext('2d');

    this._largura = 0;
    this._redimensionar();
  }

  _criarContador() {
    if (!this._contador) {
      const d = document.createElement('div');
      d.id = 'hacker-raiox';
      document.body.appendChild(d);
      this._contador = d;
    }
    this._contador.style.display = '';
    this._ultTextoContador = '';
    this._posicionarContador();
    this._escreverContador(true);
  }

  /** Põe o contador logo abaixo do debug (se o debug estiver visível) */
  _posicionarContador() {
    const dbg = document.getElementById('debug');
    let topo = 8;
    if (dbg && !dbg.classList.contains('oculto')) topo = dbg.offsetTop + dbg.offsetHeight + 6;
    this._contador.style.top = topo + 'px';
  }

  _escreverContador(forcar = false) {
    if (!this._contador) return;
    const texto = 'RAIO-X ' + Math.ceil(this._tRaioX) + 's';
    if (forcar || texto !== this._ultTextoContador) {
      this._contador.textContent = texto;
      this._ultTextoContador = texto;
    }
  }

  _redimensionar() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this._largura && h === this._altura) return;
    this._largura = w;
    this._altura = h;
    for (const cv of [this._canvasMatrix, this._canvasAbertura]) {
      if (cv) { cv.width = w; cv.height = h; }
    }
    // Recria as colunas da chuva Matrix
    const colunas = Math.ceil(w / TAM_COLUNA);
    this._gotas = new Float32Array(colunas);
    this._velGotas = new Float32Array(colunas);
    const linhas = Math.ceil(h / TAM_COLUNA);
    for (let i = 0; i < colunas; i++) {
      this._gotas[i] = -Math.random() * linhas;
      this._velGotas[i] = 0.35 + Math.random() * 0.6; // linhas por tick
    }
    if (this._ctxMatrix) this._ctxMatrix.clearRect(0, 0, w, h);
  }

  // =====================================================================
  // Abertura
  // =====================================================================
  _comecarAbertura() {
    this._tAbertura = 0;
    this._mensagemDada = false;
    // Sorteia as faixas de cada interferência uma vez (não fica piscando)
    this._interf.length = 0;
    for (let k = 0; k < ABERTURA.interferencias.length; k++) {
      const faixas = [];
      const n = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) {
        faixas.push({
          y: Math.random(),
          h: 0.006 + Math.random() * 0.04,
          dx: (Math.random() - 0.5) * 0.12,
          x0: Math.random() * 0.3,
          larg: 0.4 + Math.random() * 0.6,
        });
      }
      this._interf.push(faixas);
    }
  }

  _atualizarAbertura(dt) {
    this._tAbertura += dt;
    const t = this._tAbertura;
    const ctx = this._ctxAbertura;
    if (!ctx) { this._tAbertura = -1; return; }
    const w = this._largura, h = this._altura;
    const fim = ABERTURA.fimTexto + ABERTURA.fade;

    if (t >= fim) {
      // Acabou: remove o canvas e avisa
      ctx.clearRect(0, 0, w, h);
      this._canvasAbertura.remove();
      this._canvasAbertura = null;
      this._ctxAbertura = null;
      this._tAbertura = -1;
      if (!this._mensagemDada) {
        this._mensagemDada = true;
        this.ui?.mostrarMensagem?.('Modo hacker ATIVADO');
      }
      return;
    }

    ctx.clearRect(0, 0, w, h);

    // Escurecimento (até 85% de preto) e volta no fade final
    let escuro = 0;
    if (t >= ABERTURA.escurecerDe) {
      escuro = Math.min(1, (t - ABERTURA.escurecerDe) / (ABERTURA.escurecerAte - ABERTURA.escurecerDe));
    }
    let fade = 1;
    if (t > ABERTURA.fimTexto) fade = 1 - (t - ABERTURA.fimTexto) / ABERTURA.fade;
    escuro *= ABERTURA.escuroMax * fade;
    if (escuro > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + escuro.toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // Interferências: faixas deslocadas com separação vermelho/ciano
    for (let k = 0; k < ABERTURA.interferencias.length; k++) {
      const ini = ABERTURA.interferencias[k];
      const x = (t - ini) / ABERTURA.duracaoInterf;
      if (x < 0 || x > 1) continue;
      const env = Math.sin(x * Math.PI) * ABERTURA.opacidadeInterf; // sobe e desce suave
      const faixas = this._interf[k];
      for (let i = 0; i < faixas.length; i++) {
        const f = faixas[i];
        const y = f.y * h, alt = f.h * h, dx = f.dx * w;
        const x0 = f.x0 * w, larg = f.larg * w;
        ctx.fillStyle = 'rgba(255,40,60,' + (env * 0.8).toFixed(3) + ')';
        ctx.fillRect(x0 + dx + 4, y, larg, alt);
        ctx.fillStyle = 'rgba(40,230,255,' + (env * 0.8).toFixed(3) + ')';
        ctx.fillRect(x0 + dx - 4, y + 1, larg, alt);
        ctx.fillStyle = 'rgba(255,255,255,' + (env * 0.25).toFixed(3) + ')';
        ctx.fillRect(x0 + dx, y + alt * 0.4, larg, Math.max(1, alt * 0.2));
      }
    }

    // Texto "ACESSO CONCEDIDO" digitado letra por letra
    if (t >= ABERTURA.digitarDe) {
      const letras = Math.min(TEXTO_ACESSO.length, Math.floor((t - ABERTURA.digitarDe) / ABERTURA.tempoPorLetra) + 1);
      const terminou = letras >= TEXTO_ACESSO.length;
      const cursorLigado = Math.floor(t / 0.5) % 2 === 0; // pisca devagar (1 vez por segundo)
      const tamanho = Math.max(24, Math.min(w * 0.06, 72));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + tamanho + "px 'Courier New', monospace";
      ctx.fillStyle = COR_VERDE;
      ctx.shadowColor = COR_VERDE;
      ctx.shadowBlur = 12;
      // Centraliza o texto completo para as letras não "andarem"
      const larguraTotal = ctx.measureText(TEXTO_ACESSO).width;
      ctx.textAlign = 'left';
      const xIni = w / 2 - larguraTotal / 2;
      const yTexto = h / 2;
      ctx.fillText(TEXTO_ACESSO.slice(0, letras) + (cursorLigado ? '▌' : ''), xIni, yTexto);

      if (terminou) {
        const pequeno = Math.max(12, tamanho * 0.28);
        ctx.font = pequeno + "px 'Courier New', monospace";
        ctx.shadowBlur = 6;
        ctx.textAlign = 'center';
        ctx.fillText(TEXTO_SUB, w / 2, yTexto + tamanho * 0.9);
      }
      ctx.restore();
    }
  }

  // =====================================================================
  // Chuva de letras (Matrix)
  // =====================================================================
  _atualizarMatrix(dt) {
    const ctx = this._ctxMatrix;
    if (!ctx) return;
    this._acumMatrix += dt;
    const passo = 1 / FPS_MATRIX;
    if (this._acumMatrix < passo) return;
    this._acumMatrix = Math.min(this._acumMatrix - passo, passo); // sem acumular atraso

    const w = this._largura, h = this._altura;
    const linhas = Math.ceil(h / TAM_COLUNA);

    // Apaga um pouco do que já foi desenhado (cria o rastro que some)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = (TAM_COLUNA - 2) + "px 'Courier New', monospace";
    ctx.textBaseline = 'top';

    const gotas = this._gotas, vel = this._velGotas;
    for (let i = 0; i < gotas.length; i++) {
      const antes = Math.floor(gotas[i]);
      gotas[i] += vel[i];
      const linha = Math.floor(gotas[i]);
      if (linha === antes) continue;
      const x = i * TAM_COLUNA;
      // A letra que era a "cabeça" (clara) vira verde normal
      if (antes >= 0 && antes < linhas) {
        ctx.clearRect(x, antes * TAM_COLUNA, TAM_COLUNA, TAM_COLUNA);
        ctx.fillStyle = '#1fdc50';
        ctx.fillText(LETRAS[(Math.random() * LETRAS.length) | 0], x, antes * TAM_COLUNA);
      }
      // Nova cabeça: mais clara
      if (linha >= 0 && linha < linhas) {
        ctx.clearRect(x, linha * TAM_COLUNA, TAM_COLUNA, TAM_COLUNA);
        ctx.fillStyle = '#d8ffe4';
        ctx.fillText(LETRAS[(Math.random() * LETRAS.length) | 0], x, linha * TAM_COLUNA);
      }
      // Chegou no fim: reinicia no topo, com um atraso aleatório
      if (linha > linhas + 2) {
        gotas[i] = -Math.random() * linhas * 0.8;
        vel[i] = 0.35 + Math.random() * 0.6;
      }
    }
  }

  // =====================================================================
  // Raio-X
  // =====================================================================
  _criarMalha() {
    if (this._malha) return;
    // Textura com borda brilhante e miolo bem fraco (parece um contorno)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(0, 0, 32, 32);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 4;
    c.strokeRect(2, 2, 28, 28);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      opacity: 0.9,
    });
    const malha = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), material, MAX_INSTANCIAS);
    malha.count = 0;
    malha.frustumCulled = false;
    malha.renderOrder = 999;
    // Cor por instância (cria o buffer já com o tamanho certo)
    malha.setColorAt(0, this._cor.set('#33ff66'));
    this.scene.add(malha);
    this._malha = malha;
  }

  _removerRaioX() {
    this._varrendo = false;
    this._nAchados = 0;
    if (this._malha) {
      this.scene.remove(this._malha);
      this._malha.geometry.dispose();
      this._malha.material.map?.dispose();
      this._malha.material.dispose();
      this._malha.dispose();
      this._malha = null;
    }
    if (this._contador) {
      this._contador.remove();
      this._contador = null;
    }
  }

  _atualizarRaioX(dt, pos) {
    if (!this._malha) return;

    // Tempo restante
    if (this._tRaioX > 0) {
      this._tRaioX -= dt;
      if (this._tRaioX <= 0) {
        // Acabou: some contorno e contador (o resto do modo continua)
        this._tRaioX = 0;
        this._removerRaioX();
        return;
      }
      this._escreverContador();
    }

    // Pulsação suave do brilho
    this._tPulso += dt;
    this._malha.material.opacity = 0.65 + 0.3 * Math.sin(this._tPulso * 3);

    // Contador acompanha o debug (aparece/some com F3)
    this._tVarredura -= dt;

    if (!this._varrendo && this._tVarredura <= 0 && pos) {
      this._varrendo = true;
      this._varrX = -RAIO_RAIOX;
      this._varrCentro[0] = Math.floor(pos.x);
      this._varrCentro[1] = Math.floor(pos.y);
      this._varrCentro[2] = Math.floor(pos.z);
      this._varrN = 0;
      this._varrInicio = performance.now();
      this._posicionarContador();
    }
    if (this._varrendo) this._continuarVarredura();
  }

  /** Varre camadas (x) até gastar o orçamento de tempo do quadro */
  _continuarVarredura() {
    const mundo = this.mundo;
    const centro = this._varrCentro;
    const cx = centro[0], cy = centro[1], cz = centro[2];
    const yMin = Math.max(0, cy - RAIO_RAIOX);
    const yMax = Math.min(CONFIG.ALTURA_MUNDO - 1, cy + RAIO_RAIOX);
    const limite = performance.now() + ORCAMENTO_VARREDURA_MS;
    const ach = this._achados, ids = this._idsAchados;

    while (this._varrX <= RAIO_RAIOX) {
      const x = cx + this._varrX;
      for (let z = cz - RAIO_RAIOX; z <= cz + RAIO_RAIOX; z++) {
        for (let y = yMin; y <= yMax; y++) {
          const id = mundo.obterBloco(x, y, z);
          if (id !== 0 && BLOCOS[id]?.xray && this._varrN < MAX_INSTANCIAS) {
            const k = this._varrN * 3;
            ach[k] = x; ach[k + 1] = y; ach[k + 2] = z;
            ids[this._varrN] = id;
            this._varrN++;
          }
        }
      }
      this._varrX++;
      if (performance.now() > limite) break; // continua no próximo quadro
    }

    if (this._varrX > RAIO_RAIOX) {
      this._varrendo = false;
      this._tVarredura = INTERVALO_VARREDURA;
      this._tempoUltimaVarredura = performance.now() - this._varrInicio;
      this._aplicarAchados();
    }
  }

  /** Passa os blocos achados para o InstancedMesh */
  _aplicarAchados() {
    const malha = this._malha;
    if (!malha) return;
    const n = this._varrN;
    this._nAchados = n;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      this._matriz.makeTranslation(this._achados[k] + 0.5, this._achados[k + 1] + 0.5, this._achados[k + 2] + 0.5);
      malha.setMatrixAt(i, this._matriz);
      const id = this._idsAchados[i];
      let cor = this._corCache.get(id);
      if (!cor) {
        cor = new THREE.Color(BLOCOS[id].corXray ?? COR_VERDE);
        this._corCache.set(id, cor);
      }
      malha.setColorAt(i, cor);
    }
    malha.count = n;
    malha.instanceMatrix.needsUpdate = true;
    if (malha.instanceColor) malha.instanceColor.needsUpdate = true;
  }
}
