// =====================================================================
// Hackraft - Poderes (Fase 5)
// ---------------------------------------------------------------------
// Cristais que dão poderes por tempo limitado:
//  - velocidade, pulo, voar, regeneracao, soco: só mudam os "modificadores"
//    (o player.js lê esses números e aplica);
//  - fogo, raio, gelo: ataques. O botão esquerdo atira em vez de quebrar.
// Aqui também ficam o HUD dos poderes ativos (canto superior direito),
// as auras de partículas e o desenho dos efeitos que chegam pela rede.
// =====================================================================

import * as THREE from 'three';
import { B, BLOCOS } from './blocks.js';
import { ITENS, obterItem } from './items.js';

// ---- Números ajustáveis deste módulo (poderes são só daqui) ----
const TEMPO_MAXIMO = 90;          // segundos acumulados no máximo por poder
const INTERVALO_TIRO = 0.4;       // segundos entre dois tiros
const INTERVALO_REGENERACAO = 1.5;// segundos entre +1 de vida (verde)
const AURA_POR_SEGUNDO = 6;       // partículas de aura por poder, por segundo
const AVISO_PISCA = 5;            // o ícone pisca nos últimos N segundos

const FOGO = { velocidade: 25, alcance: 30, dano: 6, queimar: 3 };
const GELO = { velocidade: 20, alcance: 30, dano: 3, lento: 4, raioCongelar: 2 };
const RAIO = { alcance: 25, cone: 20, salto: 6, saltos: 2, dano: 8, duracao: 0.2, segmentos: 10 };

const PASSO_PROJETIL = 0.4;       // tamanho do passo ao testar colisão
const MAX_PROJETEIS = 12;
const MAX_LINHAS = 4;

const ATAQUES = ['fogo', 'raio', 'gelo'];

// ---- Opções de partículas reaproveitadas (só x/y/z mudam antes de emitir) ----
// O particulas.emitir não guarda a referência, então é seguro reusar.
const EF_FAISCA_RAIO = {
  x: 0, y: 0, z: 0, qtd: 14, cores: ['#ffffff', '#fff27a', '#ffe14a'],
  velocidade: 4, espalhar: 1, gravidade: 4, vida: 0.4, tamanho: 0.1, aditivo: true,
};
const EF_RASTRO_FOGO = {
  x: 0, y: 0, z: 0, qtd: 2, cores: ['#ff9a2a', '#ffd23f', '#ff5a1a'],
  velocidade: 0.6, espalhar: 0.15, gravidade: -1, vida: 0.4, tamanho: 0.14, aditivo: true,
};
const EF_RASTRO_FUMACA = {
  x: 0, y: 0, z: 0, qtd: 1, cor: '#555555',
  velocidade: 0.4, espalhar: 0.1, gravidade: -1.5, vida: 0.9, tamanho: 0.2, aditivo: false,
};
const EF_RASTRO_GELO = {
  x: 0, y: 0, z: 0, qtd: 2, cores: ['#ffffff', '#c8f6ff'],
  velocidade: 0.5, espalhar: 0.15, gravidade: 1, vida: 0.6, tamanho: 0.1, aditivo: true,
};
const EF_IMPACTO_FOGO = {
  x: 0, y: 0, z: 0, qtd: 24, cores: ['#ffcf3f', '#ff8a2a', '#ffffff'],
  velocidade: 4, espalhar: 0.5, gravidade: 6, vida: 0.5, tamanho: 0.1, aditivo: true,
};
const EF_IMPACTO_GELO = {
  x: 0, y: 0, z: 0, qtd: 20, cores: ['#a8f0ff', '#ffffff', '#6fd0ff'],
  velocidade: 3.5, espalhar: 0.5, gravidade: 8, vida: 0.7, tamanho: 0.1, aditivo: false,
};

/** Retorna um número aleatório entre -1 e 1 */
const aleat = () => Math.random() * 2 - 1;

export class Poderes {
  constructor({ jogador, mundo, scene, camera, particulas, som, ui, inventario, rede, remotos, texturas }) {
    this.jogador = jogador;
    this.mundo = mundo;
    this.scene = scene;
    this.camera = camera;
    this.particulas = particulas;
    this.som = som;
    this.ui = ui;
    this.inventario = inventario;
    this.rede = rede;
    this.remotos = remotos;
    this.texturas = texturas;

    /** poder -> segundos restantes */
    this.ativos = new Map();

    this._ordem = new Map();      // poder -> número de ativação (o ataque mais recente vence)
    this._contadorOrdem = 0;
    this._ouvintesMudar = [];
    this._listarAlvos = null;
    this._poderesRemotos = new Map(); // id -> [poder, ...]
    this._recarga = 0;
    this._regen = 0;
    this._auraAcc = 0;
    this._alvosQuadro = null;     // cache de _listarAlvos() no quadro atual
    this._dtTempo = 0;
    this._mudouTempo = false;
    // Funções criadas uma vez só (para usar com Map.forEach sem alocar)
    this._passarTempo = (resta, poder) => {
      const novo = resta - this._dtTempo;
      if (novo <= 0) {
        this.ativos.delete(poder);
        this._mudouTempo = true;
      } else {
        this.ativos.set(poder, novo);
      }
    };
    this._desenharItemHud = (resta, poder) => this._atualizarItemHud(poder, resta);
    this._removerHudSeAcabou = (h, poder) => {
      if (!this.ativos.has(poder)) { h.el.remove(); this._itensHud.delete(poder); }
    };

    // Objeto reaproveitado devolvido por modificadores()
    this._mods = {
      velocidade: 1, pulo: 1, voar: false, regeneracao: false,
      quebraInstantanea: false, semDanoQueda: false, ataque: null,
    };

    // poder -> nome do item (para achar o ícone e a cor)
    this._itemDoPoder = new Map();
    for (const [nome, def] of ITENS) {
      if (def.tipo === 'poder' && def.poder) this._itemDoPoder.set(def.poder, nome);
    }

    // Vetores de trabalho (nada de criar vetor novo por quadro)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._pontosCadeia = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._acertados = [];

    this._criarProjeteis();
    this._criarLinhas();
    this._criarHud();
  }

  // ===================================================================
  // Uso dos cristais
  // ===================================================================

  /** Consome 1 cristal e ativa (ou soma tempo). Devolve true se usou. */
  usar(nome) {
    const item = obterItem(nome);
    if (!item || item.tipo !== 'poder' || !item.poder) return false;

    const atual = this.ativos.get(item.poder) ?? 0;
    if (atual >= TEMPO_MAXIMO - 0.5) {
      this.ui?.mostrarMensagem?.(`${item.rotulo}: já está no máximo!`);
      return false;
    }

    // Acha o primeiro espaço com esse item
    const espacos = this.inventario.espacos;
    let indice = -1;
    for (let i = 0; i < espacos.length; i++) {
      if (espacos[i] && espacos[i].item === nome) { indice = i; break; }
    }
    if (indice < 0) return false;
    this.inventario.remover(indice, 1);

    const duracao = item.duracao ?? 30;
    const eraAtivo = this.ativos.has(item.poder);
    this.ativos.set(item.poder, Math.min(TEMPO_MAXIMO, atual + duracao));
    this._ordem.set(item.poder, ++this._contadorOrdem);

    // Efeitos de aparecer
    const p = this.jogador.posicao;
    this.particulas?.emitir?.({
      x: p.x, y: p.y + 0.9, z: p.z, qtd: 30, cor: item.cor,
      velocidade: 3, espalhar: 0.5, gravidade: 0, vida: 0.8, tamanho: 0.12, aditivo: true,
    });
    this.som?.poder?.(item.poder);
    this.ui?.mostrarMensagem?.(`${item.rotulo} ativado! (${Math.round(duracao)} s)`);
    this.rede?.enviarEfeito?.({
      tipo: 'poder', origem: [p.x, p.y + 0.9, p.z], direcao: [0, 1, 0], cor: item.cor,
    });

    if (!eraAtivo) this._avisarMudanca();
    this._atualizarHud(true);
    return true;
  }

  /** Lista (nova) dos poderes ativos */
  listaAtivos() {
    return Array.from(this.ativos.keys());
  }

  /** Registra uma função que recebe a lista dos ativos sempre que muda */
  aoMudarAtivos(fn) {
    this._ouvintesMudar.push(fn);
  }

  _avisarMudanca() {
    if (this._ouvintesMudar.length === 0) return;
    const lista = this.listaAtivos();
    for (const fn of this._ouvintesMudar) fn(lista);
  }

  /** `fnListar()` devolve [{ id, posicao, raio, receberDano(qtd, tipo, efeito) }] */
  registrarAlvos(fnListar) {
    this._listarAlvos = fnListar;
  }

  /** Números que o player.js aplica (objeto reaproveitado) */
  modificadores() {
    const m = this._mods;
    const a = this.ativos;
    m.velocidade = a.has('velocidade') ? 2 : 1;
    m.pulo = a.has('pulo') ? 1.8 : 1;
    m.semDanoQueda = a.has('pulo');
    m.voar = a.has('voar');
    m.regeneracao = a.has('regeneracao');
    m.quebraInstantanea = a.has('soco');
    // O ataque ativado por último é o que vale
    let melhor = null, ordemMelhor = -1;
    for (let i = 0; i < ATAQUES.length; i++) {
      const nome = ATAQUES[i];
      if (a.has(nome)) {
        const o = this._ordem.get(nome) ?? 0;
        if (o > ordemMelhor) { ordemMelhor = o; melhor = nome; }
      }
    }
    m.ataque = melhor;
    return m;
  }

  // ===================================================================
  // Quadro a quadro
  // ===================================================================

  atualizar(dt) {
    if (this._recarga > 0) this._recarga -= dt;

    // Tempo dos poderes
    this._alvosQuadro = null;
    this._dtTempo = dt;
    this._mudouTempo = false;
    this.ativos.forEach(this._passarTempo);
    const mudou = this._mudouTempo;
    if (mudou) this._avisarMudanca();

    // Regeneração
    if (this.ativos.has('regeneracao')) {
      this._regen += dt;
      if (this._regen >= INTERVALO_REGENERACAO) {
        this._regen -= INTERVALO_REGENERACAO;
        this.jogador.curar?.(1);
      }
    } else {
      this._regen = 0;
    }

    this._atualizarAuras(dt);
    this._atualizarProjeteis(dt);
    this._atualizarLinhas(dt);
    this._atualizarHud(mudou);
  }

  // ===================================================================
  // Auras
  // ===================================================================

  definirPoderesRemotos(id, lista) {
    if (!lista || lista.length === 0) this._poderesRemotos.delete(id);
    else this._poderesRemotos.set(id, lista.slice());
  }

  _corDoPoder(poder) {
    const nomeItem = this._itemDoPoder.get(poder);
    return nomeItem ? ITENS.get(nomeItem).cor : '#ffffff';
  }

  _emitirAura(pos, poder) {
    this.particulas?.emitir?.({
      x: pos.x + aleat() * 0.45, y: pos.y + 0.1 + Math.random() * 1.7, z: pos.z + aleat() * 0.45,
      qtd: 1, cor: this._corDoPoder(poder),
      velocidade: 0.4, espalhar: 0.2, gravidade: 0, vida: 0.9, tamanho: 0.08, aditivo: true,
    });
  }

  _atualizarAuras(dt) {
    this._auraAcc += dt;
    const passo = 1 / AURA_POR_SEGUNDO;
    if (this._auraAcc < passo) return;
    this._auraAcc -= passo;
    if (this._auraAcc > passo) this._auraAcc = 0; // quadro muito lento: não acumula

    // Jogador local: só vale a pena na 3ª pessoa
    if (this.jogador.modoCamera === 'terceira') {
      for (const poder of this.ativos.keys()) this._emitirAura(this.jogador.posicao, poder);
    }
    // Jogadores remotos
    if (this.remotos && this._poderesRemotos.size > 0) {
      for (const [id, lista] of this._poderesRemotos) {
        const pos = this.remotos.posicaoDe?.(id);
        if (!pos) continue;
        for (let i = 0; i < lista.length; i++) this._emitirAura(pos, lista[i]);
      }
    }
  }

  // ===================================================================
  // HUD
  // ===================================================================

  _criarHud() {
    if (typeof document === 'undefined') return;
    const estilo = document.createElement('style');
    estilo.textContent = `
      #hud-poderes {
        position: fixed; right: 10px; top: 52px; display: flex; flex-wrap: wrap;
        justify-content: flex-end; gap: 6px; max-width: 280px;
        pointer-events: none; z-index: 7;
      }
      .poder-ativo {
        position: relative; width: 40px; height: 40px; border-radius: 50%;
        background: conic-gradient(var(--cor-poder) calc(var(--pct) * 1%), rgba(0,0,0,0.55) 0);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 8px var(--cor-poder);
      }
      .poder-ativo .miolo {
        width: 32px; height: 32px; border-radius: 50%; background: rgba(0,0,0,0.75);
        display: flex; align-items: center; justify-content: center; overflow: hidden;
      }
      .poder-ativo img { width: 26px; height: 26px; image-rendering: pixelated; }
      .poder-ativo .seg {
        position: absolute; bottom: -7px; right: -4px; padding: 0 3px;
        font-family: var(--fonte-pixel, monospace); font-size: 10px; color: #fff;
        background: rgba(0,0,0,0.75); border: 1px solid #000; text-shadow: 1px 1px 0 #3f3f3f;
      }
      .poder-ativo.piscando { animation: poder-pisca 0.7s ease-in-out infinite; }
      @keyframes poder-pisca { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    `;
    document.head.appendChild(estilo);

    this._hud = document.createElement('div');
    this._hud.id = 'hud-poderes';
    document.body.appendChild(this._hud);
    this._itensHud = new Map(); // poder -> { el, seg, ultSeg, ultPct, piscando }
  }

  _atualizarHud(forcar) {
    if (!this._hud) return;
    // Remove os ícones que acabaram
    if (forcar) this._itensHud.forEach(this._removerHudSeAcabou);
    this.ativos.forEach(this._desenharItemHud);
  }

  // Cria (se preciso) e atualiza o ícone de um poder no HUD
  _atualizarItemHud(poder, resta) {
    {
      let h = this._itensHud.get(poder);
      if (!h) {
        const nomeItem = this._itemDoPoder.get(poder);
        const el = document.createElement('div');
        el.className = 'poder-ativo';
        el.style.setProperty('--cor-poder', this._corDoPoder(poder));
        const miolo = document.createElement('div');
        miolo.className = 'miolo';
        const img = document.createElement('img');
        if (nomeItem && this.texturas?.iconeItem) img.src = this.texturas.iconeItem(nomeItem);
        miolo.appendChild(img);
        const seg = document.createElement('div');
        seg.className = 'seg';
        el.appendChild(miolo);
        el.appendChild(seg);
        this._hud.appendChild(el);
        h = { el, seg, ultSeg: -1, ultPct: -1, piscando: false };
        this._itensHud.set(poder, h);
      }
      const segs = Math.ceil(resta);
      if (segs !== h.ultSeg) { h.ultSeg = segs; h.seg.textContent = segs + 's'; }
      const pct = Math.round(Math.min(100, (resta / 30) * 100));
      if (pct !== h.ultPct) { h.ultPct = pct; h.el.style.setProperty('--pct', pct); }
      const pisca = resta <= AVISO_PISCA;
      if (pisca !== h.piscando) { h.piscando = pisca; h.el.classList.toggle('piscando', pisca); }
    }
  }

  // ===================================================================
  // Ataques: disparo local
  // ===================================================================

  /** Atira o ataque ativo. Devolve true se atirou (respeita o intervalo). */
  atirar(origem, direcao) {
    if (this._recarga > 0) return false;
    const ataque = this.modificadores().ataque;
    if (!ataque) return false;
    this._recarga = INTERVALO_TIRO;

    const d = this._v4.set(direcao.x, direcao.y, direcao.z).normalize();
    const ox = origem.x, oy = origem.y, oz = origem.z;
    const efeito = { tipo: ataque, origem: [ox, oy, oz], direcao: [d.x, d.y, d.z] };

    if (ataque === 'raio') {
      this._atirarRaio(ox, oy, oz, d, efeito);
    } else {
      this._lancarProjetil(ataque, ox, oy, oz, d.x, d.y, d.z, true);
    }
    this.som?.poder?.(ataque);
    this.rede?.enviarEfeito?.(efeito);
    return true;
  }

  /** Alvos atuais (lista vazia se ninguém registrou) */
  _alvos() {
    // A lista é pedida no máximo uma vez por quadro (zerada no começo do atualizar)
    if (this._alvosQuadro) return this._alvosQuadro;
    this._alvosQuadro = this._listarAlvos ? (this._listarAlvos() ?? []) : [];
    return this._alvosQuadro;
  }

  // ---- Raio ----

  _atirarRaio(ox, oy, oz, d, efeito) {
    const alvos = this._alvos();
    const cosCone = Math.cos(RAIO.cone * Math.PI / 180);
    const v = this._v1;

    // Alvo mais perto da mira, dentro do cone
    let melhor = null, melhorCos = cosCone;
    for (let i = 0; i < alvos.length; i++) {
      const a = alvos[i];
      v.set(a.posicao.x - ox, a.posicao.y + (a.raio ?? 0.5) - oy, a.posicao.z - oz);
      const dist = v.length();
      if (dist > RAIO.alcance || dist < 0.001) continue;
      const c = v.dot(d) / dist;
      if (c >= melhorCos) { melhorCos = c; melhor = a; }
    }

    const pts = this._pontosCadeia;
    let n = 0; // quantos pontos de destino
    this._acertados.length = 0;

    if (melhor) {
      this._pontoDoAlvo(melhor, pts[n++]);
      this._acertados.push(melhor);
      // Saltos para alvos próximos
      for (let s = 0; s < RAIO.saltos; s++) {
        const ult = pts[n - 1];
        let prox = null, menor = RAIO.salto;
        for (let i = 0; i < alvos.length; i++) {
          const a = alvos[i];
          if (this._acertados.includes(a)) continue;
          const dist = v.set(a.posicao.x - ult.x, a.posicao.y + (a.raio ?? 0.5) - ult.y, a.posicao.z - ult.z).length();
          if (dist <= menor) { menor = dist; prox = a; }
        }
        if (!prox) break;
        this._pontoDoAlvo(prox, pts[n++]);
        this._acertados.push(prox);
      }
      for (let i = 0; i < this._acertados.length; i++) {
        this._acertados[i].receberDano?.(RAIO.dano, 'raio', {});
      }
    } else {
      // Sem alvo: bloco mirado ou 25 blocos à frente
      const o = this._v2.set(ox, oy, oz);
      const bate = this.mundo.raycast(o, d, RAIO.alcance);
      if (bate) {
        pts[n++].set(bate.x + 0.5 + bate.normal.x * 0.5, bate.y + 0.5 + bate.normal.y * 0.5, bate.z + 0.5 + bate.normal.z * 0.5);
      } else {
        pts[n++].set(ox + d.x * RAIO.alcance, oy + d.y * RAIO.alcance, oz + d.z * RAIO.alcance);
      }
    }

    // Registra no efeito (para a rede): fim e cadeia
    efeito.fim = [pts[0].x, pts[0].y, pts[0].z];
    if (n > 1) {
      efeito.cadeia = [];
      for (let i = 1; i < n; i++) efeito.cadeia.push([pts[i].x, pts[i].y, pts[i].z]);
    }
    this._desenharRaio(ox, oy, oz, d, pts, n);
  }

  _pontoDoAlvo(alvo, saida) {
    saida.set(alvo.posicao.x, alvo.posicao.y + (alvo.raio ?? 0.5), alvo.posicao.z);
  }

  /** Desenha o raio da origem passando pelos `n` pontos de `pts` */
  _desenharRaio(ox, oy, oz, d, pts, n) {
    // Começa um pouco à frente e abaixo da câmera
    let ax = ox + d.x * 0.6, ay = oy - 0.25 + d.y * 0.6, az = oz + d.z * 0.6;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      this._usarLinha(ax, ay, az, p.x, p.y, p.z);
      this._faiscaRaio(p.x, p.y, p.z);
      ax = p.x; ay = p.y; az = p.z;
    }
  }

  _faiscaRaio(x, y, z) {
    EF_FAISCA_RAIO.x = x; EF_FAISCA_RAIO.y = y; EF_FAISCA_RAIO.z = z;
    this.particulas?.emitir?.(EF_FAISCA_RAIO);
  }

  // ---- Linhas do raio (pool) ----

  _criarLinhas() {
    this._linhas = [];
    const pontos = RAIO.segmentos + 1;
    for (let i = 0; i < MAX_LINHAS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pontos * 3), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xfff6b0, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const linha = new THREE.Line(geo, mat);
      linha.frustumCulled = false;
      linha.visible = false;
      this.scene.add(linha);
      this._linhas.push({ linha, mat, tempo: 0 });
    }
    this._proxLinha = 0;
  }

  /** Preenche uma linha em zigue-zague entre dois pontos */
  _usarLinha(ax, ay, az, bx, by, bz) {
    const l = this._linhas[this._proxLinha];
    this._proxLinha = (this._proxLinha + 1) % MAX_LINHAS;
    const arr = l.linha.geometry.attributes.position.array;
    const seg = RAIO.segmentos;

    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const comp = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    // Dois vetores perpendiculares à direção
    const u = this._v1.set(dx / comp, dy / comp, dz / comp);
    const p1 = this._v2.set(0, 1, 0).cross(u);
    if (p1.lengthSq() < 0.001) p1.set(1, 0, 0);
    p1.normalize();
    const p2 = this._v3.copy(u).cross(p1).normalize();
    const amp = Math.min(0.7, comp * 0.06);

    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const forca = (i === 0 || i === seg) ? 0 : amp;
      const o1 = aleat() * forca, o2 = aleat() * forca;
      arr[i * 3] = ax + dx * t + p1.x * o1 + p2.x * o2;
      arr[i * 3 + 1] = ay + dy * t + p1.y * o1 + p2.y * o2;
      arr[i * 3 + 2] = az + dz * t + p1.z * o1 + p2.z * o2;
    }
    l.linha.geometry.attributes.position.needsUpdate = true;
    l.tempo = RAIO.duracao;
    l.mat.opacity = 1;
    l.linha.visible = true;
  }

  _atualizarLinhas(dt) {
    for (let i = 0; i < this._linhas.length; i++) {
      const l = this._linhas[i];
      if (!l.linha.visible) continue;
      l.tempo -= dt;
      if (l.tempo <= 0) l.linha.visible = false;
      else l.mat.opacity = l.tempo / RAIO.duracao;
    }
  }

  // ---- Projéteis (pool) ----

  _criarProjeteis() {
    this._projeteis = [];
    const geo = new THREE.SphereGeometry(0.16, 8, 6);
    this._matFogo = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    this._matGelo = new THREE.MeshBasicMaterial({ color: 0xa8f0ff });
    for (let i = 0; i < MAX_PROJETEIS; i++) {
      const malha = new THREE.Mesh(geo, this._matFogo);
      malha.visible = false;
      this.scene.add(malha);
      this._projeteis.push({
        malha, ativo: false, tipo: '', local: false,
        dir: new THREE.Vector3(), restante: 0, quadro: 0,
      });
    }
  }

  _lancarProjetil(tipo, ox, oy, oz, dx, dy, dz, local) {
    // Acha um projétil livre
    let p = null;
    for (let i = 0; i < this._projeteis.length; i++) {
      if (!this._projeteis[i].ativo) { p = this._projeteis[i]; break; }
    }
    if (!p) return;
    p.ativo = true;
    p.tipo = tipo;
    p.local = local;
    p.restante = tipo === 'fogo' ? FOGO.alcance : GELO.alcance;
    p.quadro = 0;
    p.dir.set(dx, dy, dz).normalize();
    // Sai um pouco abaixo e à frente da mira
    p.malha.position.set(ox + p.dir.x * 0.7, oy - 0.2 + p.dir.y * 0.7, oz + p.dir.z * 0.7);
    p.malha.material = tipo === 'fogo' ? this._matFogo : this._matGelo;
    p.malha.visible = true;
  }

  _atualizarProjeteis(dt) {
    for (let i = 0; i < this._projeteis.length; i++) {
      const p = this._projeteis[i];
      if (!p.ativo) continue;
      const fogo = p.tipo === 'fogo';
      let dist = (fogo ? FOGO.velocidade : GELO.velocidade) * dt;
      const pos = p.malha.position;
      let bateu = false;

      while (dist > 0 && !bateu) {
        const passo = Math.min(PASSO_PROJETIL, dist);
        dist -= passo;
        p.restante -= passo;
        const px = pos.x, py = pos.y, pz = pos.z;
        pos.x += p.dir.x * passo;
        pos.y += p.dir.y * passo;
        pos.z += p.dir.z * passo;

        // Alvos (só dano no disparo local)
        if (p.local) {
          const alvo = this._alvoNoPonto(pos.x, pos.y, pos.z);
          if (alvo) {
            if (fogo) alvo.receberDano?.(FOGO.dano, 'fogo', { queimar: FOGO.queimar });
            else alvo.receberDano?.(GELO.dano, 'gelo', { lento: GELO.lento });
            this._impacto(p, pos.x, pos.y, pos.z, null);
            bateu = true;
            break;
          }
        }
        // Blocos
        const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);
        const id = this.mundo.obterBloco(bx, by, bz);
        if (id !== B.AR) {
          const agua = id === B.AGUA;
          if (!agua || !fogo) {
            // Gelo para na água; fogo atravessa a água; os dois param em sólido
            const solido = !agua;
            this._impacto(p, solido ? px : pos.x, solido ? py : pos.y, solido ? pz : pos.z, solido ? { x: bx, y: by, z: bz, id } : null);
            bateu = true;
            break;
          }
        }
        if (p.restante <= 0) { this._impacto(p, pos.x, pos.y, pos.z, null, true); bateu = true; }
      }

      if (bateu) {
        p.ativo = false;
        p.malha.visible = false;
        continue;
      }

      // Rastro de partículas
      p.quadro++;
      if (fogo) {
        EF_RASTRO_FOGO.x = pos.x; EF_RASTRO_FOGO.y = pos.y; EF_RASTRO_FOGO.z = pos.z;
        this.particulas?.emitir?.(EF_RASTRO_FOGO);
        if (p.quadro % 3 === 0) {
          EF_RASTRO_FUMACA.x = pos.x; EF_RASTRO_FUMACA.y = pos.y; EF_RASTRO_FUMACA.z = pos.z;
          this.particulas?.emitir?.(EF_RASTRO_FUMACA);
        }
      } else {
        EF_RASTRO_GELO.x = pos.x; EF_RASTRO_GELO.y = pos.y; EF_RASTRO_GELO.z = pos.z;
        this.particulas?.emitir?.(EF_RASTRO_GELO);
      }
    }
  }

  /** Devolve o alvo cuja esfera contém o ponto (ou null) */
  _alvoNoPonto(x, y, z) {
    if (!this._listarAlvos) return null;
    const alvos = this._alvos();   // lista guardada no quadro
    for (let i = 0; i < alvos.length; i++) {
      const a = alvos[i];
      const r = (a.raio ?? 0.5) + 0.25;
      const dx = x - a.posicao.x, dy = y - (a.posicao.y + (a.raio ?? 0.5)), dz = z - a.posicao.z;
      if (dx * dx + dy * dy + dz * dz <= r * r) return a;
    }
    return null;
  }

  /** O projétil acabou: explosão e (se local) mexe nos blocos. `bloco` = bloco sólido atingido */
  _impacto(p, x, y, z, bloco, fimDoAlcance = false) {
    if (p.tipo === 'fogo') {
      if (!fimDoAlcance) {
        EF_IMPACTO_FOGO.x = x; EF_IMPACTO_FOGO.y = y; EF_IMPACTO_FOGO.z = z;
        this.particulas?.emitir?.(EF_IMPACTO_FOGO);
      }
      if (p.local && bloco && this._ehMadeira(bloco.id)) this._queimar(bloco.x, bloco.y, bloco.z);
    } else {
      EF_IMPACTO_GELO.x = x; EF_IMPACTO_GELO.y = y; EF_IMPACTO_GELO.z = z;
      this.particulas?.emitir?.(EF_IMPACTO_GELO);
      if (p.local && B.GELO !== undefined && !fimDoAlcance) {
        this._congelar(Math.floor(x), Math.floor(y), Math.floor(z));
      }
    }
  }

  _ehMadeira(id) {
    if (id === B.TRONCO || id === B.FOLHAS) return true;
    // O fogo não apaga tocha, não quebra baú e não deixa meia porta
    if (id === B.PORTA || id === B.TOCHA || id === B.BAU) return false;
    return id !== B.PRESENTE && BLOCOS[id]?.som === 'madeira';
  }

  /** Queima a madeira num raio de 1 em volta do bloco atingido */
  _queimar(cx, cy, cz) {
    const lista = []; // [x, y, z, id] de tudo que vai virar ar (mandado de uma vez só)
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let z = cz - 1; z <= cz + 1; z++) {
          const id = this.mundo.obterBloco(x, y, z);
          if (!this._ehMadeira(id)) continue;
          lista.push([x, y, z, B.AR]);
          this._fumacaDeBloco(x + 0.5, y + 0.5, z + 0.5);
        }
      }
    }
    this._aplicarLote(lista);
  }

  /** Muda vários blocos de uma vez (lote). Sem definirBlocos no mundo, um por um. */
  _aplicarLote(lista) {
    if (lista.length === 0) return;
    if (typeof this.mundo.definirBlocos === 'function') {
      this.mundo.definirBlocos(lista, 'local');
    } else {
      for (const b of lista) this.mundo.definirBloco(b[0], b[1], b[2], b[3], 'local');
    }
  }

  _fumacaDeBloco(x, y, z) {
    this.particulas?.emitir?.({
      x, y, z, qtd: 8, cores: ['#ff9a2a', '#ffd23f', '#ff5a1a'],
      velocidade: 1.5, espalhar: 0.4, gravidade: -2, vida: 0.7, tamanho: 0.14, aditivo: true,
    });
    this.particulas?.emitir?.({
      x, y, z, qtd: 4, cor: '#444444',
      velocidade: 0.8, espalhar: 0.3, gravidade: -2, vida: 1.2, tamanho: 0.22, aditivo: false,
    });
  }

  /** Transforma água em gelo num raio de 2 em volta do ponto */
  _congelar(cx, cy, cz) {
    const r = GELO.raioCongelar;
    const lista = [];
    for (let x = cx - r; x <= cx + r; x++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let z = cz - r; z <= cz + r; z++) {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          if (dx * dx + dy * dy + dz * dz > r * r + 1) continue;
          if (this.mundo.obterBloco(x, y, z) !== B.AGUA) continue;
          lista.push([x, y, z, B.GELO]);
          this.particulas?.emitir?.({
            x: x + 0.5, y: y + 0.5, z: z + 0.5, qtd: 3, cores: ['#a8f0ff', '#ffffff'],
            velocidade: 1, espalhar: 0.4, gravidade: 2, vida: 0.6, tamanho: 0.08, aditivo: false,
          });
        }
      }
    }
    this._aplicarLote(lista);
  }

  // ===================================================================
  // Efeito vindo da rede: só desenha (sem dano, sem mexer em blocos)
  // ===================================================================

  receberEfeitoRemoto(efeito) {
    if (!efeito) return;
    // Os pontos podem chegar como [x, y, z] ou {x, y, z}; pontos inválidos são ignorados
    const comoArray = (p) => {
      if (!p) return null;
      const a = Array.isArray(p) ? p : [p.x, p.y, p.z];
      return Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]) ? a : null;
    };
    const o = comoArray(efeito.origem), d = comoArray(efeito.direcao);
    if (!o) return;
    efeito = { ...efeito, fim: comoArray(efeito.fim), cadeia: (Array.isArray(efeito.cadeia) ? efeito.cadeia : []).map(comoArray).filter(Boolean) };
    if (efeito.tipo === 'poder') {
      this.particulas?.emitir?.({
        x: o[0], y: o[1], z: o[2], qtd: 30, cor: efeito.cor ?? '#ffffff',
        velocidade: 3, espalhar: 0.5, gravidade: 0, vida: 0.8, tamanho: 0.12, aditivo: true,
      });
    } else if (efeito.tipo === 'raio') {
      const dir = this._v4.set(d?.[0] ?? 0, d?.[1] ?? 0, d?.[2] ?? -1);
      const pts = this._pontosCadeia;
      let n = 0;
      if (efeito.fim) pts[n++].set(efeito.fim[0], efeito.fim[1], efeito.fim[2]);
      if (efeito.cadeia) {
        for (let i = 0; i < efeito.cadeia.length && n < pts.length; i++) {
          const c = efeito.cadeia[i];
          pts[n++].set(c[0], c[1], c[2]);
        }
      }
      if (n === 0) pts[n++].set(o[0] + dir.x * RAIO.alcance, o[1] + dir.y * RAIO.alcance, o[2] + dir.z * RAIO.alcance);
      this._desenharRaio(o[0], o[1], o[2], dir, pts, n);
    } else if (efeito.tipo === 'fogo' || efeito.tipo === 'gelo') {
      this._lancarProjetil(efeito.tipo, o[0], o[1], o[2], d?.[0] ?? 0, d?.[1] ?? 0, d?.[2] ?? -1, false);
    }
  }
}
