// =====================================================================
// Hackraft - Interface do jogo
// ---------------------------------------------------------------------
// Controla o HTML da interface (mira, hotbar, inventário, equipamento,
// aparência, telas) e o pointer lock (o mouse "preso" na tela).
// =====================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import * as MODULO_ITENS from './items.js';
import { obterItem } from './items.js';
import { som } from './audio.js';
import { Personagem } from './character.js';

// Espaços de equipamento (mesma ordem do contrato: items.js exporta SLOTS_EQUIPAMENTO)
const SLOTS = MODULO_ITENS.SLOTS_EQUIPAMENTO || ['roupa', 'capacete', 'peitoral', 'calca', 'botas', 'mao', 'acessorio'];
// Qual espaço de equipamento serve para um item (ou null)
const slotDoItem = (nome) => (MODULO_ITENS.slotDoItem ? MODULO_ITENS.slotDoItem(nome) : null);

// Como cada espaço aparece na tela: [rótulo, ícone-fantasma quando vazio]
const ROTULOS_SLOT = {
  roupa: ['Roupa', '👕'], capacete: ['Capacete', '⛑'], peitoral: ['Peitoral', '🛡'],
  calca: ['Calça', '👖'], botas: ['Botas', '👢'], mao: ['Mão', '⚔'], acessorio: ['Acessório', '🧣'],
};
const COLUNA_ESQUERDA = ['capacete', 'peitoral', 'calca', 'botas'];
const COLUNA_DIREITA = ['roupa', 'mao', 'acessorio'];

// Cores disponíveis na tela de aparência (C): [campo, título, cores]
const PALETAS = [
  ['pele', 'Pele', ['#fbe3d0', '#f5cba7', '#e8b48a', '#d19a6a', '#b57a4e', '#8d5a36', '#6a3f24', '#43271a']],
  ['cabelo', 'Cabelo', ['#1b1b1f', '#3b2414', '#6b4423', '#e3c565', '#b5451b', '#eeeeee', '#3a6fd8', '#f06aa8']],
  ['olhos', 'Olhos', ['#2b2b2b', '#3b6fd0', '#3a9a4a', '#6b4423', '#7a7a82', '#8a46c8']],
  ['camisa', 'Camisa', ['#d83a3a', '#3a6fd8', '#3fae44', '#e8d238', '#8a46c8', '#f08a24', '#30d0d0', '#f06aa8']],
  ['calca', 'Calça', ['#3b3326', '#2a3b50', '#2e2e3a', '#33383f', '#5c3a26', '#3d3a5c']],
];
const CORES_BASE_PADRAO = {
  pele: '#e8b48a', cabelo: '#3b2414', olhos: '#2b2b2b', camisa: '#3a6fd8', calca: '#2a3b50', sapato: '#3a3a3a',
};

// Cor do nome do item na dica, conforme o tipo
const COR_TIPO = { roupa: '#c58bff', armadura: '#6ab4ff', arma: '#ff6b6b', acessorio: '#ffd35a' };

// ----- Vida (corações) -----
const CORACOES = 10;                 // quantos corações aparecem (cada um vale 2 de vida)
const VIDA_BAIXA = 4;                // com esta vida ou menos os corações tremem
const TEMPO_DANO_MS = 400;           // tempo da vinheta vermelha
const TEMPO_PISCAR_MS = 200;         // tempo dos corações brancos
// Desenho do coração, 9x9 ('X' = pixel do coração)
const FORMA_CORACAO = [
  '..XX.XX..',
  '.XXXXXXX.',
  'XXXXXXXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXX...',
  '....X....',
];

const VELOCIDADE_GIRO_PREVIEW = 0.6;  // radianos por segundo do boneco girando sozinho
const SENSIBILIDADE_GIRO = 0.012;      // radianos por pixel ao arrastar
const CHAVE_APARENCIA = 'hackraft-aparencia';

// Lista de controles mostrada na tela inicial e na pausa
const CONTROLES = [
  ['W A S D', 'andar'],
  ['Espaço', 'pular / nadar'],
  ['Shift', 'correr'],
  ['Mouse', 'olhar'],
  ['Botão esq.', 'segurar para quebrar'],
  ['Botão dir.', 'colocar bloco'],
  ['1-9 / roda', 'escolher item'],
  ['E', 'inventário e equipamento'],
  ['C', 'aparência'],
  ['G', 'largar item (Shift: tudo)'],
  ['Q', 'usar cristal de poder'],
  ['T', 'chat'],
  ['/', 'comandos'],
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

// ---------------------------------------------------------------------
// Preview do boneco: canvas próprio com renderer, cena e Personagem.
// Só desenha enquanto está ligado (iniciar/parar), para não gastar à toa.
// ---------------------------------------------------------------------
class PreviewBoneco {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.rodando = false;
    this._idQuadro = 0;                  // id do requestAnimationFrame agendado
    this.arrastando = false;
    this.ultimoTempo = 0;
    this.giro = Math.PI + 0.5;           // de frente para a câmera, meio de lado
    this._quadro = (t) => this._loop(t); // criado uma vez só (sem lixo no loop)
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(canvas.width, canvas.height, false);
      this.renderer.setClearColor(0x000000, 0);
      this.cena = new THREE.Scene();
      this.cena.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sol = new THREE.DirectionalLight(0xffffff, 1.6);
      sol.position.set(2, 4, 5);
      this.cena.add(sol);
      this.camera = new THREE.PerspectiveCamera(28, canvas.width / canvas.height, 0.1, 50);
      this.camera.position.set(0, 1.0, 4.9);
      this.camera.lookAt(0, 0.9, 0);
      this.personagem = new Personagem({});
      this.cena.add(this.personagem.grupo);
      this.ok = true;
    } catch (e) {
      console.warn('Preview do boneco indisponível:', e);
    }

    // Arrastar com o mouse gira o boneco
    let ultimoX = 0;
    canvas.addEventListener('mousedown', (e) => {
      this.arrastando = true;
      ultimoX = e.clientX;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.arrastando) return;
      this.giro += (e.clientX - ultimoX) * SENSIBILIDADE_GIRO;
      ultimoX = e.clientX;
    });
    window.addEventListener('mouseup', () => { this.arrastando = false; });
  }

  aplicar(aparencia) {
    if (!this.ok || !aparencia) return;
    if (typeof this.personagem.definirAparencia === 'function') this.personagem.definirAparencia(aparencia);
    else if (aparencia.cores) this.personagem.definirCores(aparencia.cores);
  }

  iniciar() {
    if (!this.ok || this.rodando) return;
    this.rodando = true;
    this.ultimoTempo = performance.now();
    this._idQuadro = requestAnimationFrame(this._quadro);
  }

  parar() {
    this.rodando = false;
    // Cancela o quadro agendado, para não nascer um segundo loop ao reabrir
    cancelAnimationFrame(this._idQuadro);
    this._idQuadro = 0;
  }

  _loop(t) {
    if (!this.rodando) return;
    const dt = Math.min((t - this.ultimoTempo) / 1000, 0.1);
    this.ultimoTempo = t;
    if (!this.arrastando) this.giro += dt * VELOCIDADE_GIRO_PREVIEW;
    this.personagem.grupo.rotation.y = this.giro;
    this.personagem.animar(dt, 0, false); // parado (deixa a capa balançar de leve)
    this.renderer.render(this.cena, this.camera);
    this._idQuadro = requestAnimationFrame(this._quadro);
  }
}

export class InterfaceJogo {
  constructor({ inventario, equipamento, texturas, canvas }) {
    this.inventario = inventario;
    this.equipamento = equipamento || null;
    this.texturas = texturas;
    this.canvas = canvas;

    // Estados das telas
    this.inventarioAberto = false;
    this.aparenciaAberta = false;
    this.aparenciaOrigem = 'jogo';      // 'jogo' ou 'inicial' (de onde a tela C foi aberta)
    this.pausaAberta = false;
    this.inicialAberta = false;
    this.debugLigado = false;
    this.mao = null;                    // pilha "na mão": { item, qtd } ou null
    this.aoNovoMundo = null;            // guardado em mostrarTelaInicial
    this.morteAberta = false;           // tela "Você desmaiou!"
    this.aoUsarItem = null;             // callback do Q e do duplo clique (definirCallbacks)
    this.aoSoltarItem = null;           // callbacks (definirCallbacks)
    this.aoMudarAparenciaBase = null;
    this.iconesPorNome = new Map();     // cache: nome do item -> dataURL
    this.ultimoSelecionado = inventario.selecionado;
    this.fonteDicaAtual = null;         // função que diz qual item está sob o mouse
    this.menusExtras = [];              // funções de adicionarMenuExtra

    // Aparência: a base (cores salvas no navegador) e a completa (com equipamento)
    this.aparenciaBase = this._lerAparenciaSalva();
    this.aparenciaPreview = null;
    this.rascunhoCores = null;          // cores sendo editadas na tela C

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
    this.elAparencia = $('tela-aparencia');
    this.elCarregando = $('carregando');
    this.elDebug = $('debug');
    this.elMensagem = $('mensagem');
    this.elSubmerso = $('submerso');
    this.elVida = $('vida');
    this.elDano = $('dano');
    this.elMorte = $('tela-morte');
    this.temporizadorDano = null;
    this.temporizadorPiscar = null;
    this.vidaMostrada = -1;             // última vida desenhada (para só mexer no DOM quando muda)
    this.vidaMaxMostrada = -1;

    this.codigoSala = null;
    this.jogadoresOnline = 0;
    this.temporizadorNome = null;
    this.temporizadorMensagem = null;
    this.temporizadorMensagem2 = null;

    this.previewInv = null;             // criados na primeira vez que a tela abre
    this.previewAparencia = null;

    this._montarEspacos();
    this._montarEquipamento();
    this._montarPaletas();
    this._montarControles();
    this._montarCoracoes();
    this._ligarBotoes();
    this._ligarEventos();

    // A hotbar e o inventário se atualizam sozinhos
    inventario.aoMudar(() => this._atualizarEspacos());
    if (this.equipamento && this.equipamento.aoMudar) {
      this.equipamento.aoMudar(() => this._atualizarEquipamento());
    }
    this._atualizarEspacos();
  }

  // Guarda os callbacks que o main usa
  definirCallbacks({ aoSoltarItem, aoMudarAparenciaBase, aoUsarItem } = {}) {
    if (aoUsarItem !== undefined) this.aoUsarItem = aoUsarItem;
    if (aoSoltarItem !== undefined) this.aoSoltarItem = aoSoltarItem;
    if (aoMudarAparenciaBase !== undefined) this.aoMudarAparenciaBase = aoMudarAparenciaBase;
  }

  // ------------------------------------------------------------------
  // Construção do HTML dos espaços (feita uma vez só)
  // ------------------------------------------------------------------
  // id: índice do inventário ou nome do slot de equipamento.
  // fonteDica: função que devolve o nome do item sob o mouse (ou null).
  _criarEspaco(id, aoClicar, fonteDica, fantasma) {
    const el = document.createElement('div');
    el.className = 'espaco';
    const img = document.createElement('img');
    img.draggable = false;
    img.className = 'oculto';
    const qtd = document.createElement('span');
    qtd.className = 'qtd';
    let ghost = null;
    if (fantasma) {
      ghost = document.createElement('span');
      ghost.className = 'fantasma';
      ghost.textContent = fantasma;
      el.appendChild(ghost);
    }
    el.append(img, qtd);
    if (aoClicar) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        aoClicar(id, e.button, e);
        this._mostrarDica(this.fonteDicaAtual);
      });
      el.addEventListener('mouseenter', () => {
        this.fonteDicaAtual = fonteDica;
        this._mostrarDica(fonteDica);
      });
      el.addEventListener('mouseleave', () => {
        this.fonteDicaAtual = null;
        this._esconderDica();
      });
    }
    // Guardamos o que está desenhado, para só mexer no DOM quando mudar
    return { el, img, qtd, ghost, chave: '' };
  }

  _montarEspacos() {
    const n = CONFIG.ESPACOS_HOTBAR;
    this.espacosHud = [];       // hotbar da tela
    this.espacosInv = [];       // índice 0..35 do inventário (hotbar + mochila)
    const clicar = (idx, botao, e) => this._clicarEspaco(idx, botao, e);
    const fonte = (i) => () => {
      const s = this.inventario.espacos[i];
      return s ? s.item : null;
    };

    for (let i = 0; i < n; i++) {
      const e = this._criarEspaco(i, null);
      this.elHotbar.appendChild(e.el);
      this.espacosHud.push(e);
    }
    // Mochila: espaços 9 a 35
    for (let i = n; i < CONFIG.ESPACOS_INVENTARIO; i++) {
      const e = this._criarEspaco(i, clicar, fonte(i));
      this.elInvGrade.appendChild(e.el);
      this.espacosInv[i] = e;
      this._ligarDuploClique(e.el, fonte(i));
    }
    // Hotbar dentro do inventário: espaços 0 a 8
    for (let i = 0; i < n; i++) {
      const e = this._criarEspaco(i, clicar, fonte(i));
      this.elInvHotbar.appendChild(e.el);
      this.espacosInv[i] = e;
      this._ligarDuploClique(e.el, fonte(i));
    }
  }

  // Duplo clique num cristal de poder (tela E): usa o cristal
  _ligarDuploClique(el, fonte) {
    el.addEventListener('dblclick', () => {
      if (this.mao || !this.aoUsarItem) return;
      const nome = fonte();
      const def = nome ? obterItem(nome) : null;
      if (def && def.tipo === 'poder') this.aoUsarItem(nome);
    });
  }

  // ------------------------------------------------------------------
  // Vida: 10 corações pixelados acima da hotbar
  // ------------------------------------------------------------------
  // Desenha um coração num canvas de 9x9: tipo 'cheio', 'meio' ou 'vazio'
  _desenharCoracao(tipo) {
    const c = document.createElement('canvas');
    c.width = 9; c.height = 9;
    const g = c.getContext('2d');
    const dentro = (x, y) => y >= 0 && y < 9 && x >= 0 && x < 9 && FORMA_CORACAO[y][x] === 'X';
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        if (!dentro(x, y)) continue;
        const borda = !dentro(x - 1, y) || !dentro(x + 1, y) || !dentro(x, y - 1) || !dentro(x, y + 1);
        let cor;
        if (borda) cor = '#2a0606';
        else {
          const vermelho = tipo === 'cheio' || (tipo === 'meio' && x <= 4);
          cor = vermelho ? ((x === 2 && y === 2) || (x === 3 && y === 2) ? '#ff9a9a' : '#e02424') : '#3b1c1c';
        }
        g.fillStyle = cor;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c.toDataURL();
  }

  _montarCoracoes() {
    this.imagensCoracao = {
      cheio: this._desenharCoracao('cheio'),
      meio: this._desenharCoracao('meio'),
      vazio: this._desenharCoracao('vazio'),
    };
    this.coracoes = [];
    this.elVida.innerHTML = '';
    for (let i = 0; i < CORACOES; i++) {
      const img = document.createElement('img');
      img.className = 'coracao';
      img.draggable = false;
      img.src = this.imagensCoracao.cheio;
      img.dataset.tipo = 'cheio';
      this.elVida.appendChild(img);
      this.coracoes.push(img);
    }
  }

  /** Atualiza os corações (cada coração vale 2 de vida; ímpar = meio coração) */
  atualizarVida(vida, max = 20) {
    vida = Math.max(0, Math.round(vida));
    if (vida === this.vidaMostrada && max === this.vidaMaxMostrada) return;
    this.vidaMostrada = vida;
    this.vidaMaxMostrada = max;
    for (let i = 0; i < CORACOES; i++) {
      const tipo = vida >= 2 * i + 2 ? 'cheio' : (vida >= 2 * i + 1 ? 'meio' : 'vazio');
      const img = this.coracoes[i];
      if (img.dataset.tipo !== tipo) {
        img.dataset.tipo = tipo;
        img.src = this.imagensCoracao[tipo];
      }
    }
    this.elVida.classList.toggle('tremendo', vida > 0 && vida <= VIDA_BAIXA);
  }

  /** Tomou dano: vinheta vermelha por um instante e corações brancos uma vez */
  sinalizarDano() {
    this.elDano.classList.remove('ativo');
    void this.elDano.offsetWidth;          // reinicia a animação do CSS
    this.elDano.classList.add('ativo');
    clearTimeout(this.temporizadorDano);
    this.temporizadorDano = setTimeout(() => this.elDano.classList.remove('ativo'), TEMPO_DANO_MS + 50);
    this.elVida.classList.add('piscando');
    clearTimeout(this.temporizadorPiscar);
    this.temporizadorPiscar = setTimeout(() => this.elVida.classList.remove('piscando'), TEMPO_PISCAR_MS);
  }

  /** Tela "Você desmaiou!". Os itens não se perdem. */
  mostrarMorte({ aoRenascer } = {}) {
    // A pilha da mão volta ao inventário (sobra vai ao chão), para o inventário fechar de verdade
    this.devolverMao(true);
    // Fecha o que estiver aberto, sem prender o mouse de novo
    if (this.inventarioAberto) this.fecharInventario(false);
    if (this.aparenciaAberta) this.fecharAparencia('nada');
    this._esconderPausa();
    this.elDano.classList.remove('ativo');
    this.morteAberta = true;
    this.elMorte.classList.remove('oculto');
    this.soltarMouse();
    const botao = $('btn-renascer');
    botao.onclick = (e) => {
      e.currentTarget.blur();
      this.morteAberta = false;
      this.elMorte.classList.add('oculto');
      if (aoRenascer) aoRenascer();
      this.travarMouse();
    };
  }

  // Os 7 espaços de equipamento, em duas colunas em volta do preview
  _montarEquipamento() {
    this.espacosEq = {};
    const montar = (coluna, lista) => {
      for (const slot of lista) {
        const [rotulo, fantasma] = ROTULOS_SLOT[slot];
        const caixa = document.createElement('div');
        caixa.className = 'equip-slot';
        const nome = document.createElement('span');
        nome.className = 'equip-rotulo';
        nome.textContent = rotulo;
        const fonte = () => (this.equipamento ? this.equipamento.espacos[slot] || null : null);
        const e = this._criarEspaco(slot, (s, botao, ev) => this._clicarEquipamento(s, botao, ev), fonte, fantasma);
        caixa.append(nome, e.el);
        coluna.appendChild(caixa);
        this.espacosEq[slot] = e;
      }
    };
    montar($('eq-esq'), COLUNA_ESQUERDA);
    montar($('eq-dir'), COLUNA_DIREITA);

    // Caixas "Esconder armadura" e "Esconder capacete"
    const ligarCaixa = (id, campo) => {
      const chk = $(id);
      chk.addEventListener('change', () => {
        chk.blur(); // o Espaço do jogo não deve marcar a caixa
        if (!this.equipamento) return;
        this.equipamento[campo] = chk.checked;
        this.equipamento.notificar();
      });
    };
    ligarCaixa('chk-armadura', 'esconderArmadura');
    ligarCaixa('chk-capacete', 'esconderCapacete');
  }

  // Quadradinhos de cor da tela de aparência
  _montarPaletas() {
    const area = $('paletas');
    this.quadradinhos = [];     // { campo, cor, el }
    for (const [campo, titulo, cores] of PALETAS) {
      const bloco = document.createElement('div');
      bloco.className = 'paleta';
      const t = document.createElement('div');
      t.className = 'paleta-titulo';
      t.textContent = titulo;
      const linha = document.createElement('div');
      linha.className = 'paleta-cores';
      for (const cor of cores) {
        const q = document.createElement('button');
        q.type = 'button';
        q.className = 'quadradinho';
        q.style.background = cor;
        q.title = titulo;
        q.addEventListener('click', () => {
          q.blur();
          this._escolherCor(campo, cor);
        });
        linha.appendChild(q);
        this.quadradinhos.push({ campo, cor, el: q });
      }
      bloco.append(t, linha);
      area.appendChild(bloco);
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
      if (this.texturas.iconeItem) {
        url = this.texturas.iconeItem(nome);
      } else {
        const def = obterItem(nome);
        url = def && def.bloco != null ? this.texturas.iconeBloco(def.bloco) : '';
      }
      this.iconesPorNome.set(nome, url);
    }
    return url;
  }

  // Desenha um espaço só se o conteúdo mudou
  _desenharEspaco(e, conteudo) {
    const chave = conteudo ? conteudo.item + ':' + conteudo.qtd : '';
    if (e.chave === chave) return;
    e.chave = chave;
    if (e.ghost) e.ghost.classList.toggle('oculto', !!conteudo);
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

  // Redesenha os 7 espaços de equipamento e as caixas "esconder"
  _atualizarEquipamento() {
    const eq = this.equipamento;
    if (!eq || !this.inventarioAberto) return;
    for (const slot of SLOTS) {
      const nome = eq.espacos[slot];
      this._desenharEspaco(this.espacosEq[slot], nome ? { item: nome, qtd: 1 } : null);
    }
    $('chk-armadura').checked = !!eq.esconderArmadura;
    $('chk-capacete').checked = !!eq.esconderCapacete;
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
  _clicarEspaco(i, botao, ev) {
    const espacos = this.inventario.espacos;
    const s = espacos[i];
    const m = this.mao;

    // Shift + clique: manda o item direto para o espaço de equipamento certo
    if (ev && ev.shiftKey && botao === 0 && !m) {
      if (s) this._equiparRapido(i);
      return;
    }

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
  }

  // Shift+clique num item do inventário: equipa 1 no espaço certo
  _equiparRapido(i) {
    const eq = this.equipamento;
    const s = this.inventario.espacos[i];
    if (!eq || !s) return;
    const slot = slotDoItem(s.item);
    if (!slot || !eq.podeEquipar(slot, s.item)) return;
    const item = s.item;
    s.qtd -= 1;
    if (s.qtd <= 0) this.inventario.espacos[i] = null;
    const saiu = eq.equipar(slot, item);
    if (saiu) {
      // O que estava equipado ocupa o lugar do item (ou vai para onde couber)
      if (!this.inventario.espacos[i]) this.inventario.espacos[i] = { item: saiu, qtd: 1 };
      else if (this.inventario.adicionar(saiu, 1) > 0) this._soltarOuDevolver(saiu, 1);
    }
    eq.notificar();
    this.inventario.notificar();
  }

  // Clique num espaço de equipamento
  _clicarEquipamento(slot, botao, ev) {
    const eq = this.equipamento;
    if (!eq || (botao !== 0 && botao !== 2)) return;
    const atual = eq.espacos[slot] || null;
    const m = this.mao;

    // Shift + clique: devolve ao inventário
    if (ev && ev.shiftKey && !m) {
      if (!atual) return;
      if (this.inventario.adicionar(atual, 1) > 0) {
        this.mostrarMensagem('Inventário cheio!');
        return;
      }
      eq.desequipar(slot);
    } else if (!m) {
      // Mão vazia: pega o item equipado
      if (!atual) return;
      eq.desequipar(slot);
      this.mao = { item: atual, qtd: 1 };
    } else {
      // Pilha na mão: só vale se o item couber neste espaço
      if (!eq.podeEquipar(slot, m.item)) return;
      if (m.qtd > 1 && atual) {
        // Sobra pilha na mão: o item antigo vai para o inventário
        if (this.inventario.adicionar(atual, 1) > 0) {
          this.mostrarMensagem('Inventário cheio!');
          return;
        }
      }
      const novo = m.item;
      const saiu = eq.equipar(slot, novo);
      m.qtd -= 1;
      if (m.qtd <= 0) this.mao = saiu ? { item: saiu, qtd: 1 } : null;
    }
    eq.notificar();
    this.inventario.notificar();
    this._desenharMao();
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

  // ------------------------------------------------------------------
  // Dicas (tooltip): rótulo colorido, descrição e números do item
  // ------------------------------------------------------------------
  _mostrarDica(fonte) {
    const nome = fonte && !this.mao ? fonte() : null;
    const def = nome ? obterItem(nome) : null;
    if (!def) { this._esconderDica(); return; }

    const el = this.elDica;
    el.innerHTML = '';
    const titulo = document.createElement('div');
    titulo.className = 'dica-nome';
    titulo.style.color = (def.tipo === 'poder' && def.cor) ? def.cor : (COR_TIPO[def.tipo] || '#ffffff');
    titulo.textContent = def.rotulo;
    el.appendChild(titulo);

    const linha = (texto, classe) => {
      const d = document.createElement('div');
      d.className = classe;
      d.textContent = texto;
      el.appendChild(d);
    };
    if (def.descricao) linha(def.descricao, 'dica-desc');
    if (def.tipo === 'poder') linha('Q para usar · ' + (def.duracao ?? 30) + ' s', 'dica-num');
    const bonus = def.bonus || {};
    const defesa = def.defesa ?? bonus.defesa;
    if (defesa) linha('Defesa +' + defesa, 'dica-num');
    if (def.dano) linha('Dano ' + def.dano, 'dica-num');
    if (bonus.velocidade) linha('Velocidade +' + Math.round(bonus.velocidade * 100) + '%', 'dica-num');
    if (bonus.silencioso) linha('Passos silenciosos', 'dica-num');
    el.classList.remove('oculto');
  }

  _esconderDica() {
    this.elDica.classList.add('oculto');
  }

  _moverDicaEMao(x, y) {
    this.elMao.style.left = x + 'px';
    this.elMao.style.top = y + 'px';
    if (!this.elDica.classList.contains('oculto')) {
      // Fica ao lado do mouse, sem sair da tela
      const larg = this.elDica.offsetWidth;
      const alt = this.elDica.offsetHeight;
      const esq = (x + 16 + larg > window.innerWidth) ? x - 16 - larg : x + 16;
      const topo = Math.min(y + 14, window.innerHeight - alt - 4);
      this.elDica.style.left = Math.max(4, esq) + 'px';
      this.elDica.style.top = Math.max(4, topo) + 'px';
    }
  }

  // ------------------------------------------------------------------
  // Largar itens no chão
  // ------------------------------------------------------------------
  // Entrega o item ao main (que cria o item no mundo). Sem callback,
  // devolve ao inventário. Retorna true se foi largado de verdade.
  _soltarOuDevolver(item, qtd) {
    if (this.aoSoltarItem) {
      this.aoSoltarItem(item, qtd);
      return true;
    }
    this.inventario.adicionar(item, qtd);
    return false;
  }

  // Tecla G: solta 1 (ou a pilha toda) do item selecionado na hotbar
  _largarSelecionado(tudo) {
    if (!this.aoSoltarItem) return;
    const i = this.inventario.selecionado;
    const s = this.inventario.espacos[i];
    if (!s) return;
    const qtd = tudo ? s.qtd : 1;
    const item = s.item;
    s.qtd -= qtd;
    if (s.qtd <= 0) this.inventario.espacos[i] = null;
    this.inventario.notificar();
    this.aoSoltarItem(item, qtd);
  }

  // Clique fora do painel com uma pilha na mão: solta a pilha toda
  _largarMao() {
    const m = this.mao;
    if (!m) return;
    if (this.aoSoltarItem) {
      this.mao = null;
      this._desenharMao();
      this.aoSoltarItem(m.item, m.qtd);
    } else {
      // Sem callback: devolve ao inventário (o que não couber continua na mão)
      const sobra = this.inventario.adicionar(m.item, m.qtd);
      if (sobra > 0) m.qtd = sobra; else this.mao = null;
      this._desenharMao();
      this.inventario.notificar();
    }
  }

  // ------------------------------------------------------------------
  // Preview do boneco e aparência
  // ------------------------------------------------------------------
  // O main chama sempre que algo mudar (equipamento, cores...)
  definirAparenciaPreview(aparenciaCompleta) {
    this.aparenciaPreview = aparenciaCompleta;
    if (this.previewInv) this.previewInv.aplicar(aparenciaCompleta);
    if (this.aparenciaAberta) this._aplicarPreviewAparencia();
  }

  _lerAparenciaSalva() {
    try {
      const texto = localStorage.getItem(CHAVE_APARENCIA);
      if (texto) {
        const obj = JSON.parse(texto);
        if (obj && typeof obj === 'object') return { ...CORES_BASE_PADRAO, ...obj };
      }
    } catch (e) { /* sem localStorage ou texto quebrado: usa a cor do apelido */ }
    return null;
  }

  // Na tela C o preview mostra o equipamento atual com as cores do rascunho
  _aplicarPreviewAparencia() {
    if (!this.previewAparencia || !this.rascunhoCores) return;
    this.previewAparencia.aplicar({ ...(this.aparenciaPreview || {}), cores: this.rascunhoCores });
  }

  _escolherCor(campo, cor) {
    if (!this.rascunhoCores) return;
    this.rascunhoCores[campo] = cor;
    this._marcarQuadradinhos();
    this._aplicarPreviewAparencia();
  }

  _marcarQuadradinhos() {
    for (const q of this.quadradinhos) {
      const atual = String(this.rascunhoCores[q.campo] || '').toLowerCase();
      q.el.classList.toggle('escolhido', atual === q.cor);
    }
  }

  abrirAparencia(origem = 'jogo') {
    if (this.aparenciaAberta) return;
    this.aparenciaAberta = true;
    this.aparenciaOrigem = origem;
    // Rascunho: a base salva, ou as cores que o personagem está usando agora
    const atuais = this.aparenciaPreview && this.aparenciaPreview.cores;
    this.rascunhoCores = { ...CORES_BASE_PADRAO, ...(this.aparenciaBase || atuais || {}) };
    this.elAparencia.classList.remove('oculto');
    if (!this.previewAparencia) this.previewAparencia = new PreviewBoneco($('preview-aparencia'));
    this._marcarQuadradinhos();
    this._aplicarPreviewAparencia();
    this.previewAparencia.iniciar();
    this.soltarMouse();
  }

  // modo: 'travar' (trava o mouse de novo), 'pausa' (mostra a pausa) ou 'nada'
  fecharAparencia(modo = 'nada') {
    if (!this.aparenciaAberta) return;
    this.aparenciaAberta = false;
    this.elAparencia.classList.add('oculto');
    if (this.previewAparencia) this.previewAparencia.parar();
    if (this.aparenciaOrigem !== 'jogo') return; // voltou para a tela inicial
    if (modo === 'travar') this.travarMouse();
    else if (modo === 'pausa') this._mostrarPausa();
  }

  _salvarAparencia() {
    this.aparenciaBase = { ...this.rascunhoCores };
    try { localStorage.setItem(CHAVE_APARENCIA, JSON.stringify(this.aparenciaBase)); } catch (e) { /* ignora */ }
    if (this.aoMudarAparenciaBase) this.aoMudarAparenciaBase({ ...this.aparenciaBase });
  }

  // ------------------------------------------------------------------
  // Abrir e fechar telas
  // ------------------------------------------------------------------
  abrirInventario() {
    this.inventarioAberto = true;
    this.elInventario.classList.remove('oculto');
    // Redesenha tudo (os espaços ficam desatualizados enquanto fechado)
    for (const e of this.espacosInv) if (e) e.chave = '?';
    for (const slot of SLOTS) this.espacosEq[slot].chave = '?';
    this._atualizarEspacos();
    this._atualizarEquipamento();
    // O preview só é criado e desenhado com a tela aberta
    if (!this.previewInv) {
      this.previewInv = new PreviewBoneco($('preview-inv'));
      this.previewInv.aplicar(this.aparenciaPreview);
    }
    this.previewInv.iniciar();
    this.soltarMouse();
  }

  fecharInventario(travar = true) {
    if (!this.inventarioAberto) return;
    this.inventarioAberto = false;
    this.elInventario.classList.add('oculto');
    this._esconderDica();
    this.fonteDicaAtual = null;
    if (this.previewInv) this.previewInv.parar();
    // Devolve o que estiver na mão
    if (this.mao) {
      const sobra = this.inventario.adicionar(this.mao.item, this.mao.qtd);
      if (sobra > 0) {
        // Não coube tudo: a sobra continua na mão e o inventário fica aberto
        this.mao.qtd = sobra;
        this.inventarioAberto = true;
        this.elInventario.classList.remove('oculto');
        if (this.previewInv) this.previewInv.iniciar();
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
  // Com soltarSobra = true, o que não couber vai para o chão (aoSoltarItem).
  devolverMao(soltarSobra = false) {
    if (!this.mao) return;
    const { item, qtd } = this.mao;
    const sobra = this.inventario.adicionar(item, qtd);
    this.mao = null;
    this._desenharMao();
    this.inventario.notificar();
    if (sobra > 0 && soltarSobra && this.aoSoltarItem) this.aoSoltarItem(item, sobra);
  }

  _mostrarPausa() {
    this.pausaAberta = true;
    this.elPausa.classList.remove('oculto');
    this._atualizarBotaoMudo();
    $('volume').value = Math.round(som.volume * 100);
    // Música (pode ainda não existir no audio.js)
    if (som.musica?.volume !== undefined) $('volume-musica').value = Math.round(som.musica.volume * 100);
    this._atualizarBotaoMusica();
  }

  _atualizarBotaoMusica() {
    const ligada = som.musica?.ligada;
    $('btn-musica').textContent = 'Música: ' + (ligada === false ? 'desligada' : 'ligada');
  }

  // Registra uma função que devolve true quando uma tela extra (ex.: o chat) está aberta
  adicionarMenuExtra(fn) {
    this.menusExtras.push(fn);
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
          if (!this.mouseTravado && !this.inventarioAberto && !this.aparenciaAberta && !this.inicialAberta && !this.morteAberta) {
            this._mostrarPausa();
          }
        });
      }
    } catch (e) {
      if (!this.inventarioAberto && !this.aparenciaAberta && !this.inicialAberta && !this.morteAberta) this._mostrarPausa();
    }
  }

  soltarMouse() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get mouseTravado() {
    return document.pointerLockElement === this.canvas;
  }

  get menuAberto() {
    if (this.inventarioAberto || this.aparenciaAberta || this.pausaAberta || this.inicialAberta || this.morteAberta) return true;
    for (const fn of this.menusExtras) if (fn()) return true;
    return false;
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
    const btnPersonagem = $('btn-personagem');
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
      for (const b of [btnCriar, btnEntrar, btnNovo, btnPersonagem]) b.disabled = sim;
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
    btnPersonagem.onclick = (e) => {
      e.currentTarget.blur();
      this.abrirAparencia('inicial');
    };

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
    $('volume-musica').addEventListener('input', (e) => {
      som.musica?.definirVolume(Number(e.target.value) / 100);
    });
    $('btn-musica').onclick = (e) => {
      e.currentTarget.blur();
      som.musica?.alternar();
      this._atualizarBotaoMusica();
    };
    this._confirmarDoisCliques($('btn-novo-pausa'), () => {
      this._esconderPausa();
      if (this.aoNovoMundo) this.aoNovoMundo();
      this.travarMouse();
    });

    // Tela de aparência
    $('btn-aparencia-salvar').onclick = (e) => {
      e.currentTarget.blur();
      this._salvarAparencia();
      this.fecharAparencia('travar');
    };
    $('btn-aparencia-cancelar').onclick = (e) => {
      e.currentTarget.blur();
      this.fecharAparencia('travar');
    };

    // Clicar fora do painel do inventário, com uma pilha na mão, solta a pilha
    this.elInventario.addEventListener('mousedown', (e) => {
      if (e.target.closest('.painel-inventario')) return;
      this._largarMao();
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
      } else if (!this.inventarioAberto && !this.aparenciaAberta && !this.inicialAberta && !this.morteAberta &&
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
      if (alvo && ((alvo.tagName === 'INPUT' && alvo.type !== 'range' && alvo.type !== 'checkbox') ||
                   alvo.tagName === 'TEXTAREA')) return;

      // Com um menu extra aberto (ex.: chat), só o Esc continua valendo
      if (e.code !== 'Escape' && this.menusExtras.some((f) => f())) return;

      // Durante o carregamento, as teclas do jogo são ignoradas
      const carregando = !this.elCarregando.classList.contains('oculto');
      const emJogo = !this.inicialAberta && !this.pausaAberta && !this.aparenciaAberta && !carregando && !this.morteAberta;

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
        case 'KeyC':
          if (e.repeat || carregando) return;
          if (this.aparenciaAberta) {
            if (this.aparenciaOrigem === 'jogo') this.fecharAparencia('travar');
          } else if (emJogo && !this.inventarioAberto) {
            this.abrirAparencia('jogo');
          }
          break;
        case 'KeyG':
          // Só no jogo, com o mouse travado e fora de qualquer menu
          if (e.repeat || !emJogo || this.menuAberto || !this.mouseTravado) return;
          this._largarSelecionado(e.shiftKey);
          break;
        case 'KeyQ': {
          // Usa o cristal de poder selecionado na hotbar
          if (e.repeat || !emJogo || this.menuAberto || !this.mouseTravado) return;
          const s = this.inventario.itemSelecionado();
          const def = s ? obterItem(s.item) : null;
          if (def && def.tipo === 'poder') {
            if (this.aoUsarItem) this.aoUsarItem(s.item);
          } else {
            this.mostrarMensagem('Esse item não tem poder para usar.');
          }
          break;
        }
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
          // fecha a tela e mostra a pausa; o "Continuar" trava o mouse.
          if (this.aparenciaAberta) this.fecharAparencia('pausa');
          else if (this.inventarioAberto && this.fecharInventario(false)) this._mostrarPausa();
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
