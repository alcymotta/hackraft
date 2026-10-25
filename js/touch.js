// =====================================================================
// Hackraft - Controles de toque (celular e tablet) - Fase 12
// ---------------------------------------------------------------------
// Desenha na tela os controles que substituem o teclado e o mouse:
//   - joystick à esquerda (andar e correr)
//   - arrastar o dedo no resto da tela (olhar)
//   - botões à direita: Pular, Descer, Quebrar/Atacar, Colocar/Usar
//   - barra de atalhos no topo (Inventário, Chat, Poder, Montar, Mais, Pausa)
// Só cria alguma coisa se MODO_TOQUE for true (veja config.js); no PC
// este módulo não faz nada.
//
// Cada dedo é seguido pelo seu pointerId, então dá para andar, olhar e
// apertar botões ao mesmo tempo (multi-toque).
// =====================================================================

import { CONFIG, MODO_TOQUE } from './config.js';

// Atalhos sempre visíveis no topo: [texto do botão, code da tecla, dica]
const ATALHOS_TOPO = [
  ['Inv.', 'KeyE', 'Inventário'],
  ['Chat', 'KeyT', 'Chat'],
  ['Poder', 'KeyQ', 'Usar poder'],
  ['Montar', 'KeyR', 'Montar ou desmontar'],
];

// Atalhos guardados no botão "Mais"
const ATALHOS_MAIS = [
  ['Aparência', 'KeyC'],
  ['Câmera', 'KeyV'],
  ['Largar', 'KeyG'],
  ['Minimapa', 'KeyN'],
  ['Som', 'KeyM'],
];

// Modos de visibilidade (atributo data-modo no elemento raiz)
const MODO_ESCONDIDO = '0';   // tela de menu, pausa, carregando...
const MODO_JOGO = '1';        // jogando: tudo aparece
const MODO_CHAT = '2';        // chat aberto: só a barra de cima (para poder sair)
const MODO_FECHAR = '3';      // inventário/baú aberto: só o botão Fechar

// Cria um elemento com classe e texto
function criar(tag, classe, texto, pai) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto) el.textContent = texto;
  if (pai) pai.appendChild(el);
  return el;
}

export class ControlesToque {
  /**
   * ui: InterfaceJogo, jogador: Jogador, canvas: o canvas do jogo.
   * Fora do MODO_TOQUE não faz nada (this.ativo fica false).
   */
  constructor({ ui, jogador, canvas } = {}) {
    this.ativo = false;
    if (!MODO_TOQUE || !ui || !jogador || !canvas) return;
    this.ativo = true;
    this.ui = ui;
    this.jogador = jogador;
    this.canvas = canvas;

    // Estado do joystick (sem criar objetos durante o jogo)
    this._joyId = -1;
    this._joyX0 = 0;
    this._joyY0 = 0;
    // Estado do dedo que olha (arrastando no canvas) e do dedo do botão Quebrar
    // (que também gira a câmera enquanto arrasta)
    this._olharId = -1;
    this._olharX = 0;
    this._olharY = 0;
    this._quebrarId = -1;
    this._quebrarX = 0;
    this._quebrarY = 0;

    this._modo = '';
    this._descerVisivel = null;

    this._montarDom();
    this._ligarEventos();
    this._atualizar();
    // Confere a cada 0,1 s o que mostrar (barato: só lê alguns booleanos)
    setInterval(() => this._atualizar(), 100);
  }

  // ------------------------------------------------------------------
  // Montagem dos elementos
  // ------------------------------------------------------------------
  _montarDom() {
    // display: contents = o elemento raiz não ocupa lugar; os filhos são fixos na tela
    const raiz = criar('div', '', '', document.body);
    raiz.id = 'toque';
    this.raiz = raiz;

    // Zona do joystick (metade esquerda, parte de baixo) + o joystick desenhado
    this.zonaJoy = criar('div', 'toque-joy-zona', '', raiz);
    this.joyBase = criar('div', 'toque-joy-base', '', raiz);
    this.joyKnob = criar('div', 'toque-joy-knob', '', this.joyBase);
    this.joyDica = criar('div', 'toque-joy-dica', '', raiz); // círculo fraco mostrando onde tocar

    // Botões de ação (direita)
    const acoes = criar('div', 'toque-acoes', '', raiz);
    this.btnQuebrar = criar('button', 'toque-btn toque-quebrar', 'Quebrar', acoes);
    this.btnUsar = criar('button', 'toque-btn toque-usar', 'Usar', acoes);
    this.btnPular = criar('button', 'toque-btn toque-pular', 'Pular', acoes);
    this.btnDescer = criar('button', 'toque-btn toque-descer', 'Descer', acoes);
    this.btnDescer.classList.add('oculto');
    this._descerVisivel = false;

    // Barra de atalhos (topo, à direita)
    const topo = criar('div', 'toque-topo', '', raiz);
    this.elTopo = topo;
    for (const [texto, code, dica] of ATALHOS_TOPO) {
      const b = criar('button', 'toque-btn toque-mini toque-atalho', texto, topo);
      b.title = dica;
      b.dataset.code = code;
    }
    this.btnMais = criar('button', 'toque-btn toque-mini toque-atalho', 'Mais', topo);
    this.btnPausa = criar('button', 'toque-btn toque-mini toque-pausa', 'Pausa', topo);

    // Painel do botão "Mais"
    this.painelMais = criar('div', 'toque-mais oculto', '', raiz);
    for (const [texto, code] of ATALHOS_MAIS) {
      const b = criar('button', 'toque-btn toque-mini', texto, this.painelMais);
      b.dataset.code = code;
    }

    // Botão Fechar (inventário e baú não têm outro jeito de fechar no celular)
    this.btnFechar = criar('button', 'toque-btn toque-mini toque-fechar', 'Fechar', raiz);
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------
  _ligarEventos() {
    const jog = this;

    // ----- Joystick (zona da esquerda) -----
    this.zonaJoy.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (jog._joyId !== -1) return;
      jog._joyId = e.pointerId;
      jog._joyX0 = e.clientX;
      jog._joyY0 = e.clientY;
      jog.joyBase.style.left = e.clientX + 'px';
      jog.joyBase.style.top = e.clientY + 'px';
      jog.joyBase.classList.add('ativo');
      jog.joyKnob.style.transform = 'translate(-50%, -50%)';
      try { jog.zonaJoy.setPointerCapture(e.pointerId); } catch (erro) { /* tudo bem */ }
    });

    // ----- Olhar: arrastar no canvas (qualquer lugar sem botão por cima) -----
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (jog._olharId !== -1 || jog._modo !== MODO_JOGO) return;
      jog._olharId = e.pointerId;
      jog._olharX = e.clientX;
      jog._olharY = e.clientY;
      try { jog.canvas.setPointerCapture(e.pointerId); } catch (erro) { /* tudo bem */ }
    });

    // Movimento e fim dos dedos: ouvimos na janela e filtramos pelo pointerId
    window.addEventListener('pointermove', (e) => this._aoMover(e));
    window.addEventListener('pointerup', (e) => this._aoSoltarDedo(e));
    window.addEventListener('pointercancel', (e) => this._aoSoltarDedo(e));

    // ----- Botões de segurar -----
    this._ligarSegurar(this.btnPular,
      () => { this.jogador.teclas.Space = true; },
      () => { this.jogador.teclas.Space = false; });
    this._ligarSegurar(this.btnDescer,
      () => { this.jogador.teclas.ShiftLeft = true; },
      () => { this.jogador.teclas.ShiftLeft = false; });
    this._ligarSegurar(this.btnUsar,
      () => { this.jogador.apertarUsar(true); },
      () => { this.jogador.apertarUsar(false); });

    // Quebrar: segura, e arrastar o dedo nele também gira a câmera
    this.btnQuebrar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this._quebrarId !== -1) return;
      this._quebrarId = e.pointerId;
      this._quebrarX = e.clientX;
      this._quebrarY = e.clientY;
      this.btnQuebrar.classList.add('ativo');
      this.jogador.apertarQuebrar(true);
      try { this.btnQuebrar.setPointerCapture(e.pointerId); } catch (erro) { /* tudo bem */ }
    });

    // ----- Atalhos de teclado (usam 'click': no iPhone o teclado do chat só abre
    // se o foco acontecer dentro do próprio toque do botão) -----
    this.raiz.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !this.raiz.contains(b)) return;
      if (b.dataset.code) {
        this._tecla(b.dataset.code);
        if (this.painelMais.contains(b)) this.painelMais.classList.add('oculto');
      }
    });
    this.btnMais.addEventListener('click', () => this.painelMais.classList.toggle('oculto'));
    this.btnPausa.addEventListener('click', () => this._tecla('Escape'));
    this.btnFechar.addEventListener('click', () => this._tecla('KeyE')); // E fecha inventário e baú

    // ----- Soltar tudo ao pausar / sair da janela -----
    this.ui.aoMudarTravamento((travado) => {
      if (!travado) this._soltarTudo();
      this._atualizar();
    });
    window.addEventListener('blur', () => this._soltarTudo());
    // Mudou a orientação da tela: tira os dedos presos
    window.addEventListener('orientationchange', () => this._soltarTudo());
  }

  // Liga um botão "segurar": aoApertar no toque, aoSoltar ao levantar o dedo
  _ligarSegurar(el, aoApertar, aoSoltar) {
    let id = -1;
    const soltar = (e) => {
      if (e.pointerId !== id) return;
      id = -1;
      el.classList.remove('ativo');
      aoSoltar();
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id !== -1) return;
      id = e.pointerId;
      el.classList.add('ativo');
      aoApertar();
      try { el.setPointerCapture(e.pointerId); } catch (erro) { /* tudo bem */ }
    });
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
    el.addEventListener('lostpointercapture', soltar);
  }

  // Dedo se mexendo: joystick, olhar ou botão Quebrar
  _aoMover(e) {
    const id = e.pointerId;
    if (id === this._joyId) {
      this._moverJoystick(e.clientX, e.clientY);
    } else if (id === this._olharId) {
      this.jogador.girar(e.clientX - this._olharX, e.clientY - this._olharY, CONFIG.TOQUE.SENSIBILIDADE_OLHAR);
      this._olharX = e.clientX;
      this._olharY = e.clientY;
    } else if (id === this._quebrarId) {
      this.jogador.girar(e.clientX - this._quebrarX, e.clientY - this._quebrarY, CONFIG.TOQUE.SENSIBILIDADE_OLHAR);
      this._quebrarX = e.clientX;
      this._quebrarY = e.clientY;
    }
  }

  // Dedo levantado (ou cancelado pelo sistema)
  _aoSoltarDedo(e) {
    const id = e.pointerId;
    if (id === this._joyId) {
      this._joyId = -1;
      this.joyBase.classList.remove('ativo');
      this.jogador.definirMovimentoToque(0, 0, false);
    }
    if (id === this._olharId) this._olharId = -1;
    if (id === this._quebrarId) {
      this._quebrarId = -1;
      this.btnQuebrar.classList.remove('ativo');
      this.jogador.apertarQuebrar(false);
    }
  }

  // Calcula a direção do joystick a partir de onde o dedo está
  _moverJoystick(x, y) {
    const T = CONFIG.TOQUE;
    const dx = x - this._joyX0;
    const dy = y - this._joyY0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const fracao = Math.min(dist / T.RAIO_JOYSTICK_PX, 1);

    // Bolinha desenhada (presa dentro do círculo)
    const f = dist > T.RAIO_JOYSTICK_PX ? T.RAIO_JOYSTICK_PX / dist : 1;
    this.joyKnob.style.transform = 'translate(calc(-50% + ' + (dx * f) + 'px), calc(-50% + ' + (dy * f) + 'px))';

    if (fracao < T.ZONA_MORTA || dist === 0) {
      this.jogador.definirMovimentoToque(0, 0, false);
      return;
    }
    // Depois da zona morta a força cresce de 0 até 1
    const forca = (fracao - T.ZONA_MORTA) / (1 - T.ZONA_MORTA);
    // Tela: y para baixo; "frente" é para cima na tela
    this.jogador.definirMovimentoToque(-dy / dist * forca, dx / dist * forca, fracao >= T.LIMIAR_CORRER);
  }

  // Dispara uma tecla "de mentira" para os atalhos que já existem (E, T, Q...)
  _tecla(code) {
    const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
  }

  // Solta todos os dedos e teclas (pausa, trocar de app, girar a tela)
  _soltarTudo() {
    this._joyId = -1;
    this._olharId = -1;
    this._quebrarId = -1;
    this.joyBase.classList.remove('ativo');
    this.btnQuebrar.classList.remove('ativo');
    this.btnUsar.classList.remove('ativo');
    this.btnPular.classList.remove('ativo');
    this.btnDescer.classList.remove('ativo');
    this.painelMais.classList.add('oculto');
    this.jogador.soltarControles();
    this.jogador.definirMovimentoToque(0, 0, false);
  }

  // ------------------------------------------------------------------
  // Quais controles aparecem agora (chamado a cada 0,1 s e quando pausa)
  // ------------------------------------------------------------------
  _atualizar() {
    const ui = this.ui;
    let modo;
    if (ui.mouseTravado) modo = ui.menuAberto ? MODO_CHAT : MODO_JOGO;
    else modo = (ui.inventarioAberto || ui.bauAberto) ? MODO_FECHAR : MODO_ESCONDIDO;
    if (modo !== this._modo) {
      this._modo = modo;
      this.raiz.dataset.modo = modo;
      // O aviso "gire o celular" (CSS) só vale dentro do jogo, não na tela inicial
      document.body.classList.toggle('jogando-toque', modo === MODO_JOGO || modo === MODO_CHAT);
      if (modo !== MODO_JOGO) this.painelMais.classList.add('oculto');
    }
    // "Descer" só aparece voando ou montado
    const j = this.jogador;
    const descer = modo === MODO_JOGO && !!(j.voando || j.montaria || (j._mods && j._mods.voar));
    if (descer !== this._descerVisivel) {
      this._descerVisivel = descer;
      this.btnDescer.classList.toggle('oculto', !descer);
    }
  }
}
