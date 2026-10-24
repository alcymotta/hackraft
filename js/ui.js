// =====================================================================
// Hackraft - Interface do jogo
// ---------------------------------------------------------------------
// Controla o HTML da interface (mira, hotbar, inventário, telas) e o
// pointer lock (o mouse "preso" na tela para olhar em volta).
// =====================================================================

import { CONFIG } from './config.js';
import { obterItem } from './items.js';
import { som } from './audio.js';

// Lista de controles mostrada na tela inicial e na pausa
const CONTROLES = [
  ['W A S D', 'andar'],
  ['Espaço', 'pular / nadar'],
  ['Shift', 'correr'],
  ['Mouse', 'olhar'],
  ['Botão esq.', 'segurar para quebrar'],
  ['Botão dir.', 'colocar bloco'],
  ['1-9 / roda', 'escolher item'],
  ['E', 'inventário'],
  ['V ou F5', 'trocar câmera'],
  ['F3', 'informações'],
  ['M', 'ligar/desligar som'],
  ['Esc', 'pausa'],
];

const TEMPO_NOME_ITEM = 1500;   // ms que o nome do item fica na tela
const TEMPO_MENSAGEM = 3000;    // ms que um aviso fica na tela
const TEMPO_CONFIRMAR = 3000;   // ms do "Tem certeza?" do Novo mundo

// Atalho para pegar elementos pelo id
const $ = (id) => document.getElementById(id);

export class InterfaceJogo {
  constructor({ inventario, texturas, canvas }) {
    this.inventario = inventario;
    this.texturas = texturas;
    this.canvas = canvas;

    // Estados das telas
    this.inventarioAberto = false;
    this.pausaAberta = false;
    this.inicialAberta = false;
    this.debugLigado = false;
    this.mao = null;                    // pilha "na mão": { item, qtd } ou null
    this.aoNovoMundo = null;            // guardado em mostrarTelaInicial
    this.iconesPorNome = new Map();     // cache: nome do item -> dataURL
    this.ultimoSelecionado = inventario.selecionado;

    // Elementos
    this.elHotbar = $('hotbar');
    this.elNomeItem = $('nome-item');
    this.elInventario = $('inventario');
    this.elInvGrade = $('inv-grade');
    this.elInvHotbar = $('inv-hotbar');
    this.elDica = $('dica');
    this.elMao = $('mao');
    this.elInicial = $('tela-inicial');
    this.elPausa = $('tela-pausa');
    this.elCarregando = $('carregando');
    this.elDebug = $('debug');
    this.elMensagem = $('mensagem');
    this.elSubmerso = $('submerso');

    this.codigoSala = null;
    this.jogadoresOnline = 0;
    this.temporizadorNome = null;
    this.temporizadorMensagem = null;
    this.temporizadorMensagem2 = null;

    this._montarEspacos();
    this._montarControles();
    this._ligarBotoes();
    this._ligarEventos();

    // A hotbar e o inventário se atualizam sozinhos
    inventario.aoMudar(() => this._atualizarEspacos());
    this._atualizarEspacos();
  }

  // ------------------------------------------------------------------
  // Construção do HTML dos espaços (feita uma vez só)
  // ------------------------------------------------------------------
  _criarEspaco(indice, aoClicar) {
    const el = document.createElement('div');
    el.className = 'espaco';
    el.dataset.indice = indice;
    const img = document.createElement('img');
    img.draggable = false;
    img.className = 'oculto';
    const qtd = document.createElement('span');
    qtd.className = 'qtd';
    el.append(img, qtd);
    if (aoClicar) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        aoClicar(indice, e.button);
      });
      el.addEventListener('mouseenter', () => this._mostrarDica(indice));
      el.addEventListener('mouseleave', () => this._esconderDica());
    }
    // Guardamos o que está desenhado, para só mexer no DOM quando mudar
    return { el, img, qtd, chave: '' };
  }

  _montarEspacos() {
    const n = CONFIG.ESPACOS_HOTBAR;
    this.espacosHud = [];       // hotbar da tela
    this.espacosInv = [];       // índice 0..35 do inventário (hotbar + mochila)

    for (let i = 0; i < n; i++) {
      const e = this._criarEspaco(i, null);
      this.elHotbar.appendChild(e.el);
      this.espacosHud.push(e);
    }
    // Mochila: espaços 9 a 35
    for (let i = n; i < CONFIG.ESPACOS_INVENTARIO; i++) {
      const e = this._criarEspaco(i, (idx, botao) => this._clicarEspaco(idx, botao));
      this.elInvGrade.appendChild(e.el);
      this.espacosInv[i] = e;
    }
    // Hotbar dentro do inventário: espaços 0 a 8
    for (let i = 0; i < n; i++) {
      const e = this._criarEspaco(i, (idx, botao) => this._clicarEspaco(idx, botao));
      this.elInvHotbar.appendChild(e.el);
      this.espacosInv[i] = e;
    }
  }

  _montarControles() {
    for (const lista of document.querySelectorAll('.lista-controles')) {
      lista.innerHTML = '';
      for (const [tecla, acao] of CONTROLES) {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = tecla;
        li.append(b, ' ' + acao);
        lista.appendChild(li);
      }
    }
  }

  // ------------------------------------------------------------------
  // Ícones
  // ------------------------------------------------------------------
  _icone(nome) {
    let url = this.iconesPorNome.get(nome);
    if (url === undefined) {
      const def = obterItem(nome);
      url = def && def.bloco != null ? this.texturas.iconeBloco(def.bloco) : '';
      this.iconesPorNome.set(nome, url);
    }
    return url;
  }

  // Desenha um espaço só se o conteúdo mudou
  _desenharEspaco(e, conteudo) {
    const chave = conteudo ? conteudo.item + ':' + conteudo.qtd : '';
    if (e.chave === chave) return;
    e.chave = chave;
    if (!conteudo) {
      e.img.classList.add('oculto');
      e.qtd.textContent = '';
      return;
    }
    const url = this._icone(conteudo.item);
    if (e.img.getAttribute('src') !== url) e.img.src = url;
    e.img.classList.remove('oculto');
    e.qtd.textContent = conteudo.qtd > 1 ? conteudo.qtd : '';
  }

  _atualizarEspacos() {
    const inv = this.inventario;
    for (let i = 0; i < CONFIG.ESPACOS_HOTBAR; i++) {
      this._desenharEspaco(this.espacosHud[i], inv.espacos[i]);
      this.espacosHud[i].el.classList.toggle('selecionado', i === inv.selecionado);
    }
    // O inventário só precisa ser redesenhado quando está aberto
    if (this.inventarioAberto) {
      for (let i = 0; i < CONFIG.ESPACOS_INVENTARIO; i++) {
        this._desenharEspaco(this.espacosInv[i], inv.espacos[i]);
        this.espacosInv[i].el.classList.toggle('selecionado', i === inv.selecionado);
      }
    }
    // Trocou de espaço: mostra o nome do item por um instante
    if (inv.selecionado !== this.ultimoSelecionado) {
      this.ultimoSelecionado = inv.selecionado;
      this._mostrarNomeDoItem();
    }
  }

  _mostrarNomeDoItem() {
    const s = this.inventario.espacos[this.inventario.selecionado];
    const def = s ? obterItem(s.item) : null;
    clearTimeout(this.temporizadorNome);
    if (!def) {
      this.elNomeItem.classList.remove('visivel');
      return;
    }
    this.elNomeItem.textContent = def.rotulo;
    this.elNomeItem.classList.add('visivel');
    this.temporizadorNome = setTimeout(() => {
      this.elNomeItem.classList.remove('visivel'); // some devagar (transição do CSS)
    }, TEMPO_NOME_ITEM);
  }

  // ------------------------------------------------------------------
  // Inventário: mexer nas pilhas
  // ------------------------------------------------------------------
  _clicarEspaco(i, botao) {
    const espacos = this.inventario.espacos;
    const s = espacos[i];
    const m = this.mao;

    if (botao === 0) {
      // Botão esquerdo: pega, solta, junta ou troca
      if (!m) {
        if (s) { this.mao = s; espacos[i] = null; }
      } else if (!s) {
        espacos[i] = m; this.mao = null;
      } else if (s.item === m.item) {
        const limite = this.inventario.limiteDaPilha(s.item);
        const move = Math.min(limite - s.qtd, m.qtd);
        s.qtd += move;
        m.qtd -= move;
        if (m.qtd <= 0) this.mao = null;
        else if (move === 0) { espacos[i] = m; this.mao = s; } // pilha cheia: troca
      } else {
        espacos[i] = m; this.mao = s;
      }
    } else if (botao === 2) {
      // Botão direito: pega metade ou solta 1
      if (!m) {
        if (s) {
          const metade = Math.ceil(s.qtd / 2);
          this.mao = { item: s.item, qtd: metade };
          s.qtd -= metade;
          if (s.qtd <= 0) espacos[i] = null;
        }
      } else if (!s) {
        espacos[i] = { item: m.item, qtd: 1 };
        m.qtd -= 1;
        if (m.qtd <= 0) this.mao = null;
      } else if (s.item === m.item) {
        if (s.qtd < this.inventario.limiteDaPilha(s.item)) {
          s.qtd += 1;
          m.qtd -= 1;
          if (m.qtd <= 0) this.mao = null;
        }
      } else {
        espacos[i] = m; this.mao = s;
      }
    } else {
      return;
    }
    this.inventario.notificar();
    this._desenharMao();
    this._mostrarDica(i);
  }

  _desenharMao() {
    const m = this.mao;
    if (!m) {
      this.elMao.classList.add('oculto');
      this.elMao.innerHTML = '';
      return;
    }
    this.elMao.classList.remove('oculto');
    this.elMao.innerHTML = '';
    const img = document.createElement('img');
    img.src = this._icone(m.item);
    const q = document.createElement('span');
    q.className = 'qtd';
    q.textContent = m.qtd > 1 ? m.qtd : '';
    this.elMao.append(img, q);
    this._esconderDica();
  }

  _mostrarDica(i) {
    const s = this.inventario.espacos[i];
    const def = s && !this.mao ? obterItem(s.item) : null;
    if (!def) { this._esconderDica(); return; }
    this.elDica.textContent = def.rotulo;
    this.elDica.classList.remove('oculto');
  }

  _esconderDica() {
    this.elDica.classList.add('oculto');
  }

  _moverDicaEMao(x, y) {
    this.elMao.style.left = x + 'px';
    this.elMao.style.top = y + 'px';
    this.elDica.style.left = (x + 14) + 'px';
    this.elDica.style.top = (y - 34) + 'px';
  }

  // ------------------------------------------------------------------
  // Abrir e fechar telas
  // ------------------------------------------------------------------
  abrirInventario() {
    this.inventarioAberto = true;
    this.elInventario.classList.remove('oculto');
    // Redesenha tudo (os espaços do inventário ficam desatualizados enquanto fechado)
    for (const e of this.espacosInv) if (e) e.chave = '?';
    this._atualizarEspacos();
    this.soltarMouse();
  }

  fecharInventario(travar = true) {
    if (!this.inventarioAberto) return;
    this.inventarioAberto = false;
    this.elInventario.classList.add('oculto');
    this._esconderDica();
    // Devolve o que estiver na mão
    if (this.mao) {
      const sobra = this.inventario.adicionar(this.mao.item, this.mao.qtd);
      if (sobra > 0) {
        // Não coube tudo: a sobra continua na mão e o inventário fica aberto
        this.mao.qtd = sobra;
        this.inventarioAberto = true;
        this.elInventario.classList.remove('oculto');
        this._desenharMao();
        this.inventario.notificar();
        this.mostrarMensagem('Inventário cheio! Solte o item num espaço vazio.');
        return false;
      }
      this.mao = null;
      this._desenharMao();
      this.inventario.notificar();
    }
    if (travar) this.travarMouse();
    return true;
  }

  // Devolve a pilha da mão ao inventário (o que sobrar se perde).
  // Usado ao fechar a página, antes de salvar.
  devolverMao() {
    if (!this.mao) return;
    this.inventario.adicionar(this.mao.item, this.mao.qtd);
    this.mao = null;
    this._desenharMao();
    this.inventario.notificar();
  }

  _mostrarPausa() {
    this.pausaAberta = true;
    this.elPausa.classList.remove('oculto');
    this._atualizarBotaoMudo();
    $('volume').value = Math.round(som.volume * 100);
  }

  _esconderPausa() {
    this.pausaAberta = false;
    this.elPausa.classList.add('oculto');
  }

  // ------------------------------------------------------------------
  // Pointer lock
  // ------------------------------------------------------------------
  travarMouse() {
    try {
      const p = this.canvas.requestPointerLock();
      // Alguns navegadores devolvem uma Promise; se recusar, mantemos a pausa
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (!this.mouseTravado && !this.inventarioAberto && !this.inicialAberta) {
            this._mostrarPausa();
          }
        });
      }
    } catch (e) {
      if (!this.inventarioAberto && !this.inicialAberta) this._mostrarPausa();
    }
  }

  soltarMouse() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get mouseTravado() {
    return document.pointerLockElement === this.canvas;
  }

  get menuAberto() {
    return this.inventarioAberto || this.pausaAberta || this.inicialAberta;
  }

  // ------------------------------------------------------------------
  // Telas
  // ------------------------------------------------------------------
  mostrarTelaInicial({ aoCriarSala, aoEntrar, aoNovoMundo }) {
    this.aoNovoMundo = aoNovoMundo;
    this.inicialAberta = true;
    this.elInicial.classList.remove('oculto');

    const campoApelido = $('campo-apelido');
    const campoCodigo = $('campo-codigo');
    const btnCriar = $('btn-criar-sala');
    const btnEntrar = $('btn-entrar');
    const btnNovo = $('btn-novo-inicial');
    const status = $('status-inicial');

    // Apelido salvo da última vez
    campoApelido.value = this._lerApelidoSalvo();

    // Código: sempre em maiúsculas e sem espaços
    campoCodigo.oninput = () => {
      campoCodigo.value = campoCodigo.value.toUpperCase().replace(/\s+/g, '');
    };

    const mostrarStatus = (texto, erro = false) => {
      status.textContent = texto;
      status.classList.toggle('erro', erro);
    };
    // Voltando de uma queda de conexão: já deixa o código preenchido
    try {
      const reentrar = sessionStorage.getItem('hackraft-reentrar');
      if (reentrar !== null) {
        sessionStorage.removeItem('hackraft-reentrar');
        if (reentrar) {
          campoCodigo.value = reentrar.toUpperCase().replace(/\s+/g, '');
          mostrarStatus('A conexão caiu. Clique em Entrar para voltar.');
        }
      }
    } catch (e) { /* sem sessionStorage: segue normal */ }
    const ocupar = (sim) => {
      for (const b of [btnCriar, btnEntrar, btnNovo]) b.disabled = sim;
      campoApelido.disabled = sim;
      campoCodigo.disabled = sim;
    };

    // Roda a ação (que devolve uma Promise) e trata o resultado
    const executar = async (acao) => {
      const apelido = this._normalizarApelido(campoApelido.value);
      campoApelido.value = apelido;
      this._salvarApelido(apelido);
      som.iniciar();
      mostrarStatus('Conectando...');
      ocupar(true);
      try {
        await acao(apelido);
      } catch (erro) {
        mostrarStatus((erro && erro.message) || 'Não foi possível conectar.', true);
        ocupar(false);
        return;
      }
      // Deu certo: esconde a tela inicial e prende o mouse
      ocupar(false);
      mostrarStatus('');
      this.inicialAberta = false;
      this.elInicial.classList.add('oculto');
      this.travarMouse();
    };

    btnCriar.onclick = (e) => {
      e.currentTarget.blur(); // o Espaço do jogo não deve "clicar" no botão
      if (aoCriarSala) executar((apelido) => aoCriarSala(apelido));
    };
    const entrar = () => {
      const codigo = campoCodigo.value.toUpperCase().replace(/\s+/g, '');
      if (codigo.length !== 5) {
        mostrarStatus('Digite o código de 5 letras', true);
        return;
      }
      if (aoEntrar) executar((apelido) => aoEntrar(apelido, codigo));
    };
    btnEntrar.onclick = (e) => { e.currentTarget.blur(); entrar(); };
    campoCodigo.onkeydown = (e) => { if (e.key === 'Enter') entrar(); };

    this._confirmarDoisCliques(btnNovo, () => {
      if (this.aoNovoMundo) this.aoNovoMundo();
    });
  }

  // ------------------------------------------------------------------
  // Apelido (salvo no navegador)
  // ------------------------------------------------------------------
  _normalizarApelido(texto) {
    const t = String(texto || '').trim().slice(0, 16);
    return t || 'Jogador';
  }

  _lerApelidoSalvo() {
    try {
      const salvo = localStorage.getItem('hackraft-apelido');
      if (salvo) return this._normalizarApelido(salvo);
    } catch (e) { /* sem localStorage: segue sem apelido salvo */ }
    return '';
  }

  _salvarApelido(apelido) {
    try { localStorage.setItem('hackraft-apelido', apelido); } catch (e) { /* ignora */ }
  }

  // ------------------------------------------------------------------
  // Sala (multiplayer)
  // ------------------------------------------------------------------
  mostrarSala(codigo) {
    this.codigoSala = codigo || null;
    if (!this.codigoSala) this.jogadoresOnline = 0;
    $('codigo-sala').textContent = this.codigoSala || '';
    $('area-sala').classList.toggle('oculto', !this.codigoSala);
    this._atualizarSelo();
  }

  atualizarJogadores(lista) {
    lista = lista || [];
    this.jogadoresOnline = lista.length;
    const ul = $('lista-jogadores');
    ul.innerHTML = '';
    for (const j of lista) {
      const li = document.createElement('li');
      li.textContent = j.apelido; // textContent: apelido nunca vira HTML
      ul.appendChild(li);
    }
    this._atualizarSelo();
  }

  _atualizarSelo() {
    const selo = $('selo-sala');
    if (!this.codigoSala) {
      selo.classList.add('oculto');
      return;
    }
    const n = this.jogadoresOnline || 1;
    selo.textContent = 'Sala: ' + this.codigoSala + ' · ' + n + (n === 1 ? ' jogador' : ' jogadores');
    selo.classList.remove('oculto');
  }

  mostrarCarregando(texto) {
    $('carregando-texto').textContent = texto || 'Carregando...';
    this.elCarregando.classList.remove('oculto');
  }

  esconderCarregando() {
    this.elCarregando.classList.add('oculto');
  }

  // Botão que pede um segundo clique para confirmar (sem confirm() do navegador)
  _confirmarDoisCliques(botao, aoConfirmar) {
    const textoOriginal = botao.textContent;
    let temporizador = null;
    const reiniciar = () => {
      clearTimeout(temporizador);
      temporizador = null;
      botao.textContent = textoOriginal;
      botao.classList.remove('confirmando');
    };
    botao.onclick = () => {
      botao.blur(); // o Espaço do jogo não deve "clicar" no botão de novo
      if (temporizador) {
        reiniciar();
        aoConfirmar();
      } else {
        botao.textContent = 'Tem certeza? Clique de novo';
        botao.classList.add('confirmando');
        temporizador = setTimeout(reiniciar, TEMPO_CONFIRMAR);
      }
    };
  }

  _atualizarBotaoMudo() {
    $('btn-mudo').textContent = som.mudo ? 'Som desligado' : 'Som ligado';
  }

  _ligarBotoes() {
    $('btn-continuar').onclick = (e) => {
      e.currentTarget.blur();
      this.travarMouse();
    };

    $('btn-copiar').onclick = async (e) => {
      const botao = e.currentTarget;
      botao.blur();
      try {
        await navigator.clipboard.writeText(this.codigoSala || '');
        this.mostrarMensagem('Código copiado!');
      } catch (erro) { /* sem permissão: o código continua visível para copiar à mão */ }
    };

    $('volume').addEventListener('input', (e) => {
      som.definirVolume(Number(e.target.value) / 100);
    });
    $('btn-mudo').onclick = (e) => {
      e.currentTarget.blur();
      som.alternarMudo();
      this._atualizarBotaoMudo();
    };
    this._confirmarDoisCliques($('btn-novo-pausa'), () => {
      this._esconderPausa();
      if (this.aoNovoMundo) this.aoNovoMundo();
      this.travarMouse();
    });
  }

  // ------------------------------------------------------------------
  // Teclado, mouse e pointer lock
  // ------------------------------------------------------------------
  _ligarEventos() {
    document.addEventListener('pointerlockchange', () => {
      if (this.mouseTravado) {
        // Tira o foco de qualquer campo/controle, para as teclas voltarem ao jogo
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        this._esconderPausa();
      } else if (!this.inventarioAberto && !this.inicialAberta &&
                 this.elCarregando.classList.contains('oculto')) {
        this._mostrarPausa();
      }
    });

    window.addEventListener('mousemove', (e) => this._moverDicaEMao(e.clientX, e.clientY));

    window.addEventListener('wheel', (e) => {
      if (!this.mouseTravado || this.menuAberto) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      this.inventario.selecionar(this.inventario.selecionado + dir);
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      // Digitando num campo de texto: nenhum atalho do jogo vale
      const alvo = e.target;
      if (alvo && ((alvo.tagName === 'INPUT' && alvo.type !== 'range') || alvo.tagName === 'TEXTAREA')) return;

      // Durante o carregamento, E e 1-9 são ignoradas
      const carregando = !this.elCarregando.classList.contains('oculto');
      const emJogo = !this.inicialAberta && !this.pausaAberta && !carregando;

      // Teclas 1 a 9
      if (/^Digit[1-9]$/.test(e.code) && emJogo) {
        this.inventario.selecionar(Number(e.code.slice(5)) - 1);
        return;
      }
      switch (e.code) {
        case 'KeyE':
          if (!emJogo || e.repeat) return;
          if (this.inventarioAberto) this.fecharInventario(true);
          else this.abrirInventario();
          break;
        case 'F3':
          e.preventDefault();
          this.debugLigado = !this.debugLigado;
          this.elDebug.classList.toggle('oculto', !this.debugLigado);
          break;
        case 'KeyM': {
          if (e.repeat) return;
          const mudo = som.alternarMudo();
          this._atualizarBotaoMudo();
          this.mostrarMensagem(mudo ? 'Som desligado' : 'Som ligado');
          break;
        }
        case 'Escape':
          // Esc não conta como gesto do usuário (o navegador recusa o pointer lock):
          // fecha o inventário e mostra a pausa; o "Continuar" trava o mouse.
          if (this.inventarioAberto && this.fecharInventario(false)) this._mostrarPausa();
          break;
      }
    });
  }

  // ------------------------------------------------------------------
  // Avisos e efeitos
  // ------------------------------------------------------------------
  atualizarDebug(texto) {
    if (this.debugLigado) this.elDebug.textContent = texto;
  }

  mostrarMensagem(texto) {
    clearTimeout(this.temporizadorMensagem);
    clearTimeout(this.temporizadorMensagem2);
    this.elMensagem.textContent = texto;
    this.elMensagem.classList.remove('oculto');
    this.elMensagem.style.opacity = '1';
    this.temporizadorMensagem = setTimeout(() => {
      this.elMensagem.style.opacity = '0';
      this.temporizadorMensagem2 = setTimeout(
        () => this.elMensagem.classList.add('oculto'), 600);
    }, TEMPO_MENSAGEM);
  }

  definirSubmerso(sim) {
    this.elSubmerso.classList.toggle('oculto', !sim);
  }
}
