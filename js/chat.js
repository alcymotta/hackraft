// =====================================================================
// Hackraft - Chat (Fase 4)
// ---------------------------------------------------------------------
// Caixa de mensagens no canto inferior esquerdo + campo de texto.
// T abre o chat, "/" abre já com a barra digitada. Enter envia, Esc fecha.
// Texto que começa com "/" é um comando (registrado por registrarComando).
// Tudo é escrito com textContent: nada que o jogador digita vira HTML.
// =====================================================================

const TEMPO_VISIVEL = 10000;     // ms que a mensagem fica na tela com o chat fechado
const TEMPO_FADE = 1000;         // ms do desaparecimento suave
const MAX_HISTORICO = 100;       // mensagens guardadas
const MAX_VISIVEIS_ABERTO = 50;  // mensagens mostradas com o chat aberto
const MAX_ENVIADAS = 50;         // textos enviados lembrados (setas cima/baixo)
const MAX_CARACTERES = 200;

// Cor do apelido, escolhida por um hash do nome (cada jogador tem a sua)
function corDoApelido(nome) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return 'hsl(' + (h % 360) + ', 75%, 68%)';
}

export class Chat {
  constructor({ ui } = {}) {
    this.ui = ui || null;
    this._aberto = false;
    this.comandos = new Map();          // nome -> { uso, ajuda, executar }
    this.ouvinteMensagem = null;        // fn(texto) para mensagens normais
    this.mensagens = [];                // { el, temporizadores[] } (mais antigas primeiro)
    this.enviadas = [];                 // textos já enviados
    this.posHistorico = 0;              // posição ao navegar com as setas
    this.rascunho = '';                 // o que estava digitado antes de navegar

    // --- DOM ---
    this.raiz = document.createElement('div');
    this.raiz.id = 'chat';
    this.elLista = document.createElement('div');
    this.elLista.className = 'chat-lista';
    this.elCampo = document.createElement('input');
    this.elCampo.type = 'text';
    this.elCampo.className = 'chat-campo oculto';
    this.elCampo.maxLength = MAX_CARACTERES;
    this.elCampo.autocomplete = 'off';
    this.elCampo.spellcheck = false;
    this.elCampo.placeholder = 'Escreva uma mensagem ou /ajuda';
    this.raiz.append(this.elLista, this.elCampo);
    document.body.appendChild(this.raiz);

    this.elCampo.addEventListener('keydown', (e) => this._teclaNoCampo(e));

    // T e / abrem o chat (só quando se está jogando)
    window.addEventListener('keydown', (e) => this._teclaGlobal(e));

    // Soltou o mouse (pausa, Esc): fecha o chat.
    // ui.aoMudarTravamento avisa no PC e no celular (lá não existe
    // 'pointerlockchange'); sem ele, escutamos o evento do navegador.
    const aoSoltar = () => {
      if (this._aberto && this.ui && !this.ui.mouseTravado) this.fechar();
    };
    if (this.ui && typeof this.ui.aoMudarTravamento === 'function') this.ui.aoMudarTravamento(aoSoltar);
    else document.addEventListener('pointerlockchange', aoSoltar);

    // Faz o jogador parar de andar e ignorar cliques enquanto o chat está aberto
    if (this.ui && typeof this.ui.adicionarMenuExtra === 'function') {
      this.ui.adicionarMenuExtra(() => this._aberto);
    }
  }

  get aberto() { return this._aberto; }

  // ------------------------------------------------------------------
  // Teclado
  // ------------------------------------------------------------------
  _teclaGlobal(e) {
    if (this._aberto || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const eT = e.code === 'KeyT';
    const eBarra = e.key === '/';
    if (!eT && !eBarra) return;
    // Só no jogo: mouse preso, sem menu e fora de campos de texto
    const alvo = e.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return;
    if (!this.ui || !this.ui.mouseTravado || this.ui.menuAberto) return;
    e.preventDefault(); // a letra não entra no campo
    this.abrir(eBarra ? '/' : '');
  }

  _teclaNoCampo(e) {
    // Nada do que se digita aqui deve chegar aos atalhos do jogo
    e.stopPropagation();
    // Tab, F3 e F5 não devem mexer no foco, abrir busca nem recarregar a página
    if (e.key === 'Tab' || e.key === 'F3' || e.key === 'F5') e.preventDefault();
    if (e.key === 'Enter') {
      e.preventDefault();
      this._enviar();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.fechar();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._navegar(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._navegar(1);
    }
  }

  // Seta para cima/baixo: percorre o que já foi enviado
  _navegar(passo) {
    if (this.enviadas.length === 0) return;
    if (this.posHistorico === this.enviadas.length) this.rascunho = this.elCampo.value;
    const nova = Math.max(0, Math.min(this.enviadas.length, this.posHistorico + passo));
    this.posHistorico = nova;
    this.elCampo.value = nova === this.enviadas.length ? this.rascunho : this.enviadas[nova];
    const fim = this.elCampo.value.length;
    this.elCampo.setSelectionRange(fim, fim);
  }

  // ------------------------------------------------------------------
  // Abrir e fechar
  // ------------------------------------------------------------------
  abrir(texto = '') {
    if (this._aberto) return;
    this._aberto = true;
    this.raiz.classList.add('aberto');
    this.elCampo.classList.remove('oculto');
    this.elCampo.value = texto;
    this.posHistorico = this.enviadas.length;
    this._atualizarVisiveis();
    this.elCampo.focus();
    const fim = texto.length;
    this.elCampo.setSelectionRange(fim, fim);
  }

  fechar() {
    if (!this._aberto) return;
    this._aberto = false;
    this.raiz.classList.remove('aberto');
    this.elCampo.classList.add('oculto');
    this.elCampo.value = '';
    this.elCampo.blur(); // o foco volta para o jogo
    this._atualizarVisiveis();
  }

  _enviar() {
    const texto = this.elCampo.value.trim();
    this.fechar();
    if (!texto) return;
    this.enviadas.push(texto);
    if (this.enviadas.length > MAX_ENVIADAS) this.enviadas.shift();
    this.enviarTexto(texto);
  }

  // Trata um texto como se o jogador tivesse digitado e dado Enter
  enviarTexto(texto) {
    texto = String(texto).slice(0, MAX_CARACTERES);
    if (texto.startsWith('/')) {
      this._executarComando(texto);
    } else if (this.ouvinteMensagem) {
      this.ouvinteMensagem(texto);   // o main manda pela rede (e mostra o resultado)
    } else {
      this.adicionarMensagem({ de: 'Você', texto, tipo: 'jogador' }); // sozinho, sem ouvinte
    }
  }

  // ------------------------------------------------------------------
  // Comandos
  // ------------------------------------------------------------------
  registrarComando(nome, def) {
    this.comandos.set(String(nome).toLowerCase(), def);
  }

  aoEnviarMensagem(fn) {
    this.ouvinteMensagem = fn;
  }

  _executarComando(texto) {
    const partes = texto.slice(1).trim().split(/\s+/);
    const nome = (partes.shift() || '').toLowerCase();
    const cmd = this.comandos.get(nome);
    if (!cmd) {
      this.adicionarMensagem({ texto: '✖ Comando desconhecido: /' + nome + '. Digite /ajuda para ver a lista.', tipo: 'erro' });
      return;
    }
    try {
      cmd.executar(partes);
    } catch (erro) {
      console.error('Erro no comando /' + nome, erro);
      this.adicionarMensagem({ texto: '✖ Algo deu errado no comando /' + nome + '.', tipo: 'erro' });
    }
  }

  // ------------------------------------------------------------------
  // Mensagens
  // ------------------------------------------------------------------
  // tipo: 'jogador' | 'sistema' | 'erro' | 'sucesso'
  adicionarMensagem({ de, texto, tipo = 'sistema' } = {}) {
    const el = document.createElement('div');
    el.className = 'chat-msg chat-' + tipo;
    if (tipo === 'jogador' && de) {
      const nome = document.createElement('span');
      nome.className = 'chat-nome';
      nome.style.color = corDoApelido(String(de));
      nome.textContent = '<' + de + '> ';
      el.appendChild(nome);
    }
    el.appendChild(document.createTextNode(String(texto ?? '')));
    this.elLista.appendChild(el);

    // Depois de um tempo, esmaece e some (só vale com o chat fechado)
    const msg = { el, t1: 0, t2: 0 };
    msg.t1 = setTimeout(() => {
      el.classList.add('sumindo');
      msg.t2 = setTimeout(() => el.classList.add('velha'), TEMPO_FADE);
    }, TEMPO_VISIVEL);
    this.mensagens.push(msg);

    // Limite do histórico
    while (this.mensagens.length > MAX_HISTORICO) {
      const velha = this.mensagens.shift();
      clearTimeout(velha.t1);
      clearTimeout(velha.t2);
      velha.el.remove();
    }
    if (this._aberto) this._atualizarVisiveis();
  }

  // Com o chat aberto só as últimas 50 aparecem
  _atualizarVisiveis() {
    const n = this.mensagens.length;
    for (let i = 0; i < n; i++) {
      this.mensagens[i].el.classList.toggle('fora', this._aberto && i < n - MAX_VISIVEIS_ABERTO);
    }
    this.elLista.scrollTop = this.elLista.scrollHeight;
  }

  // ------------------------------------------------------------------
  // Modo hacker: fonte de terminal verde
  // ------------------------------------------------------------------
  definirModoHacker(sim) {
    this.raiz.classList.toggle('hacker', !!sim);
  }
}
