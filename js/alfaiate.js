// =====================================================================
// Hackraft - Alfaiate (Fase 10)
// ---------------------------------------------------------------------
// Dois pedaços neste arquivo, como no forja.js:
//   1. LÓGICA PURA (sem DOM, dá para testar no Node): receitas de costura,
//      preços da loja e as funções costurar / comprar / contarMoedas.
//      Todas devolvem { ok, motivo } com o texto em português.
//   2. TelaAlfaiate: o painel da mesa do alfaiate, com DOM e CSS próprios.
//      À esquerda um provador (boneco girando) mostra a roupa escolhida
//      antes de costurar ou comprar. À direita ficam as abas Costurar e Loja.
// =====================================================================

import { obterItem } from './items.js';
import { contarItem } from './forja.js';

// three e character.js são carregados só quando a tela abre (import dinâmico),
// para a lógica pura continuar testável no Node, sem navegador.

// ---------------------------------------------------------------------
// Números ajustáveis
// ---------------------------------------------------------------------
const VELOCIDADE_GIRO_PROVADOR = 0.6;  // radianos por segundo
const SENSIBILIDADE_GIRO = 0.012;      // arrastar o mouse gira o boneco
const TAMANHO_PROVADOR = { largura: 200, altura: 300 };
const NOME_MOEDA = 'moeda';

// ---------------------------------------------------------------------
// Receitas e preços (do contrato da Fase 10)
// ---------------------------------------------------------------------
const RECEITAS_BRUTAS = [
  { resultado: 'roupa_ninja', entradas: [['tecido', 5], ['carvao', 3]] },
  { resultado: 'roupa_cavaleiro', entradas: [['tecido', 4], ['barra_ferro', 3], ['barra_ouro', 1]] },
  { resultado: 'roupa_mago', entradas: [['tecido', 6], ['cristal_roxo', 1], ['pena', 2]] },
  { resultado: 'roupa_astronauta', entradas: [['tecido', 5], ['barra_prata', 3], ['vidro', 2]] },
  { resultado: 'roupa_pirata', entradas: [['tecido', 5], ['couro_orc', 2], ['moeda', 5]] },
  { resultado: 'capa_vermelha', entradas: [['tecido', 4], ['cristal_vermelho', 1]] },
  { resultado: 'capa_azul', entradas: [['tecido', 4], ['cristal_azul', 1]] },
];

const PRECOS_BRUTOS = {
  roupa_ninja: 20, roupa_cavaleiro: 25, roupa_mago: 30, roupa_astronauta: 35, roupa_pirata: 20,
  capa_vermelha: 10, capa_azul: 10,
};

/** Receitas de costura: [{ id, resultado, entradas: [{ item, qtd }] }] (só itens que existem) */
export const RECEITAS_ALFAIATE = RECEITAS_BRUTAS
  .filter((r) => obterItem(r.resultado) && r.entradas.every(([item]) => obterItem(item)))
  .map((r) => ({
    id: 'costurar_' + r.resultado,
    resultado: r.resultado,
    entradas: r.entradas.map(([item, qtd]) => ({ item, qtd })),
  }));

/** Preço em moedas de cada peça: { roupa_ninja: 20, ... } (só itens que existem) */
export const PRECOS_LOJA = {};
for (const [nome, preco] of Object.entries(PRECOS_BRUTOS)) {
  if (obterItem(nome)) PRECOS_LOJA[nome] = preco;
}

// ---------------------------------------------------------------------
// Funções de apoio
// ---------------------------------------------------------------------
function rotuloDoItem(nome) {
  const def = obterItem(nome);
  return def?.rotulo ?? String(nome).replace(/_/g, ' ');
}

function minusculo(texto) {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** Plural simples da primeira palavra: moeda -> moedas, carvão -> carvões */
function pluralizar(texto, n) {
  if (n === 1) return texto;
  const partes = texto.split(' ');
  let p = partes[0];
  if (p.endsWith('ão')) p = p.slice(0, -2) + 'ões';
  else if (!p.endsWith('s')) p += 's';
  partes[0] = p;
  return partes.join(' ');
}

function textoQuantidade(item, n) {
  return `${n} ${pluralizar(minusculo(rotuloDoItem(item)), n)}`;
}

function juntar(lista) {
  if (lista.length <= 1) return lista.join('');
  return lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1];
}

/** Tira `qtd` unidades do item, de qualquer pilha (começa pelo fim) */
function tirarItem(inventario, item, qtd) {
  let falta = qtd;
  for (let i = inventario.espacos.length - 1; i >= 0 && falta > 0; i--) {
    const e = inventario.espacos[i];
    if (e && e.item === item) falta -= inventario.remover(i, falta);
  }
  return qtd - falta;
}

/** Lista o que falta para pagar `entradas` */
function faltando(inventario, entradas) {
  const lista = [];
  for (const { item, qtd } of entradas) {
    const falta = qtd - contarItem(inventario, item);
    if (falta > 0) lista.push({ item, qtd: falta });
  }
  return lista;
}

function motivoFalta(lista) {
  const partes = lista.map(({ item, qtd }) => textoQuantidade(item, qtd));
  const unico = lista.length === 1 && lista[0].qtd === 1;
  return (unico ? 'Falta ' : 'Faltam ') + juntar(partes);
}

/** Paga as entradas e entrega o resultado. Se não couber, desfaz tudo. */
function trocar(inventario, entradas, resultado) {
  for (const { item, qtd } of entradas) tirarItem(inventario, item, qtd);
  const resto = inventario.adicionar(resultado, 1);
  if (resto === 0) return true;
  // Não coube: devolve o que tinha entrado e as entradas
  tirarItem(inventario, resultado, 1 - resto);
  for (const { item, qtd } of entradas) inventario.adicionar(item, qtd);
  return false;
}

/** Quantas moedas o inventário tem */
export function contarMoedas(inventario) {
  return contarItem(inventario, NOME_MOEDA);
}

/** "Roupa de ninja" -> "Roupa de ninja costurada!" / "Capa azul" -> "Capa azul costurada!" */
function textoFeito(nome, verbo) {
  return `${rotuloDoItem(nome)} ${verbo}!`;
}

// ---------------------------------------------------------------------
// Costurar e comprar
// ---------------------------------------------------------------------

/** Costura uma peça gastando os ingredientes. Devolve { ok, motivo } */
export function costurar(inventario, receita) {
  if (!receita || !obterItem(receita.resultado)) return { ok: false, motivo: 'Essa peça ainda não existe.' };
  const lista = faltando(inventario, receita.entradas);
  if (lista.length > 0) return { ok: false, motivo: motivoFalta(lista) };
  if (!trocar(inventario, receita.entradas, receita.resultado)) {
    return { ok: false, motivo: 'Seu inventário está cheio.' };
  }
  return { ok: true, motivo: textoFeito(receita.resultado, 'costurada') + ' Equipe na tela E.' };
}

/** Compra uma peça com moedas. Devolve { ok, motivo } */
export function comprar(inventario, nomeItem) {
  const preco = PRECOS_LOJA[nomeItem];
  if (preco === undefined || !obterItem(nomeItem)) return { ok: false, motivo: 'Essa peça não está à venda.' };
  const entradas = [{ item: NOME_MOEDA, qtd: preco }];
  const lista = faltando(inventario, entradas);
  if (lista.length > 0) return { ok: false, motivo: motivoFalta(lista) };
  if (!trocar(inventario, entradas, nomeItem)) {
    return { ok: false, motivo: 'Seu inventário está cheio.' };
  }
  return { ok: true, motivo: textoFeito(nomeItem, 'comprada') + ' Equipe na tela E.' };
}

/** Texto curto dos bônus de uma peça: "Corre 10% mais rápido, passos silenciosos" */
export function textoBonus(nome) {
  const def = obterItem(nome);
  if (!def) return '';
  if (def.tipo === 'acessorio') return 'Só enfeite, mas muito estiloso';
  const b = def.bonus || {};
  const partes = [];
  const pct = (v) => Math.round(v * 100) + '%';
  if (b.velocidade) partes.push(`Corre ${pct(b.velocidade)} mais rápido`);
  if (b.silencioso) partes.push('passos silenciosos');
  if (b.defesa) partes.push(`defesa +${b.defesa}`);
  if (b.duracaoPoderes) partes.push(`poderes duram ${pct(b.duracaoPoderes)} a mais`);
  if (b.pulo) partes.push(`pula ${pct(b.pulo)} mais alto`);
  if (b.quedaSegura) partes.push(`aguenta queda de +${b.quedaSegura} blocos`);
  if (b.nado) partes.push(`nada ${pct(b.nado)} mais rápido`);
  if (partes.length === 0) return 'Sem bônus, só visual';
  const t = partes.join(', ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// =====================================================================
// A TELA DO ALFAIATE (só usa DOM quando é criada, nunca no import)
// =====================================================================

const CSS = `
#alfaiate { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.5); z-index: 20; }
#alfaiate.oculto { display: none; }
#alfaiate .alf-painel { background: var(--painel, #c6c6c6); border: 4px solid; border-color: #fff #555 #555 #fff;
  outline: 3px solid #000; color: #222; padding: 14px 16px 12px; width: min(800px, 96vw); max-height: 96vh;
  overflow-y: auto; font-family: var(--fonte-texto, 'Trebuchet MS', sans-serif); }
#alfaiate h2 { margin: 0 0 10px; font-family: var(--fonte-pixel, 'Courier New', monospace); font-size: 14px; color: #3a3a3a; }
#alfaiate .alf-meio { display: flex; gap: 12px; align-items: stretch; }
#alfaiate .alf-provador { width: 210px; flex: none; background: #8b8b8b; border: 3px solid; border-color: #555 #fff #fff #555;
  display: flex; flex-direction: column; align-items: center; padding: 6px; gap: 4px; }
#alfaiate .alf-provador canvas { width: 200px; height: 300px; cursor: grab; background: radial-gradient(#b9c6d6, #7d8794); }
#alfaiate .alf-prov-nome { font: bold 13px var(--fonte-texto, sans-serif); color: #fff; text-shadow: 1px 1px 0 #333; text-align: center; min-height: 32px; }
#alfaiate .alf-direita { flex: 1; min-width: 0; }
#alfaiate .alf-abas { display: flex; gap: 6px; margin-bottom: 8px; }
#alfaiate .alf-aba, #alfaiate .alf-btn { font: bold 14px var(--fonte-texto, sans-serif); color: #222; cursor: pointer;
  background: #b0b0b0; border: 3px solid; border-color: #fff #555 #555 #fff; padding: 6px 14px; }
#alfaiate .alf-aba:hover, #alfaiate .alf-btn:hover:not(:disabled) { background: #d0d0d0; }
#alfaiate .alf-aba.ativa { background: #8b8b8b; border-color: #555 #fff #fff #555; color: #fff; }
#alfaiate .alf-btn:disabled { opacity: 0.45; cursor: not-allowed; }
#alfaiate .alf-btn.principal { background: #e08a2a; color: #fff; text-shadow: 1px 1px 0 #6a3a00; }
#alfaiate .alf-btn.principal:hover:not(:disabled) { background: #f0a040; }
#alfaiate .alf-corpo { height: 330px; overflow-y: auto; background: #8b8b8b; border: 3px solid; border-color: #555 #fff #fff #555; padding: 8px; }
#alfaiate .alf-topo { font-weight: bold; margin-bottom: 6px; color: #fff; text-shadow: 1px 1px 0 #333; }
#alfaiate .alf-linha { display: flex; align-items: center; gap: 8px; background: #a0a0a0; padding: 5px 8px; margin-bottom: 6px;
  border: 2px solid; border-color: #fff #666 #666 #fff; cursor: pointer; }
#alfaiate .alf-linha:hover { background: #b4b4b4; }
#alfaiate .alf-linha.sel { background: #e8c070; border-color: #555 #fff #fff #555; }
#alfaiate .alf-info { flex: 1; min-width: 0; }
#alfaiate .alf-nome { font-weight: bold; font-size: 14px; }
#alfaiate .alf-bonus { font-size: 11px; color: #1a5a1a; font-weight: bold; }
#alfaiate .alf-ings { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
#alfaiate .alf-ing { display: flex; align-items: center; gap: 3px; font-weight: bold; }
#alfaiate .alf-ing.falta .alf-num { color: #b00000; }
#alfaiate .alf-num { font-family: var(--fonte-pixel, monospace); font-size: 10px; }
#alfaiate img.alf-icone { width: 34px; height: 34px; image-rendering: pixelated; background: #8b8b8b;
  border: 2px solid; border-color: #555 #fff #fff #555; flex: none; }
#alfaiate img.alf-icone.pequeno { width: 22px; height: 22px; }
#alfaiate .alf-vazia { text-align: center; color: #333; }
#alfaiate .alf-msg { min-height: 22px; margin-top: 8px; font-weight: bold; text-align: center; }
#alfaiate .alf-msg.ok { color: #1a6a1a; }
#alfaiate .alf-msg.erro { color: #a00000; }
#alfaiate .alf-dica { min-height: 18px; margin-top: 2px; font-size: 12px; color: #444; text-align: center; }
#alfaiate .alf-rodape { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 12px; color: #444; }
@media (max-width: 640px) { #alfaiate .alf-meio { flex-direction: column; } #alfaiate .alf-provador { width: auto; } }
`;

export class TelaAlfaiate {
  constructor({ ui, texturas } = {}) {
    this.ui = ui;
    this.texturas = texturas;
    this.aberta = false;

    this.inventario = null;
    this.equipamento = null;
    this.aparenciaBase = null;
    this.particulas = null;
    this.som = null;
    this.posMesa = null;
    this.aoFechar = null;

    this._aba = 'costurar';
    this._selecionado = null;      // nome do item escolhido (a prévia mostra ele)
    this._msg = { texto: '', tipo: 'ok' };
    this._invsLigados = new WeakSet();

    // Provador (criado só na primeira vez que a tela abre)
    this._prov = null;

    this._criarDOM();

    // Conta como "menu aberto": o jogador para de andar e o mouse fica livre
    if (ui && typeof ui.adicionarMenuExtra === 'function') ui.adicionarMenuExtra(() => this.aberta);

    // E fecha (e volta ao jogo); Esc fecha e mostra a pausa
    window.addEventListener('keydown', (e) => {
      if (!this.aberta || e.repeat) return;
      if (e.code === 'KeyE') this.fechar(true);
      else if (e.code === 'Escape') this.fechar(false);
    });

    // Quando abrimos soltando o mouse, a UI mostraria a pausa: escondemos
    document.addEventListener('pointerlockchange', () => {
      if (this.aberta && this.ui?.pausaAberta && typeof this.ui._esconderPausa === 'function') this.ui._esconderPausa();
    });
  }

  // ------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------
  _criarDOM() {
    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    const raiz = document.createElement('div');
    raiz.id = 'alfaiate';
    raiz.className = 'oculto';
    raiz.innerHTML = `
      <div class="alf-painel">
        <h2>Alfaiate</h2>
        <div class="alf-meio">
          <div class="alf-provador">
            <canvas width="${TAMANHO_PROVADOR.largura}" height="${TAMANHO_PROVADOR.altura}"></canvas>
            <div class="alf-prov-nome"></div>
          </div>
          <div class="alf-direita">
            <div class="alf-abas"></div>
            <div class="alf-corpo"></div>
          </div>
        </div>
        <div class="alf-msg"></div>
        <div class="alf-dica"></div>
        <div class="alf-rodape"><span>E fecha a mesa do alfaiate</span><button class="alf-btn" data-fechar>Fechar</button></div>
      </div>`;
    document.body.appendChild(raiz);
    this.elRaiz = raiz;
    this.elCanvas = raiz.querySelector('canvas');
    this.elProvNome = raiz.querySelector('.alf-prov-nome');
    this.elAbas = raiz.querySelector('.alf-abas');
    this.elCorpo = raiz.querySelector('.alf-corpo');
    this.elMsg = raiz.querySelector('.alf-msg');
    this.elDica = raiz.querySelector('.alf-dica');
    raiz.querySelector('[data-fechar]').addEventListener('click', () => this.fechar(true));
    // Clicar fora do painel também fecha
    raiz.addEventListener('mousedown', (e) => { if (e.target === raiz) this.fechar(true); });

    for (const [id, texto] of [['costurar', 'Costurar'], ['loja', 'Loja']]) {
      const b = document.createElement('button');
      b.className = 'alf-aba';
      b.textContent = texto;
      b.dataset.aba = id;
      b.addEventListener('click', () => { this._aba = id; this._msg.texto = ''; this._desenhar(); });
      this.elAbas.appendChild(b);
    }
  }

  _el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  /** Imagem do ícone do item (com dica ao passar o mouse) */
  _icone(nome, pequeno = false) {
    const img = this._el('img', 'alf-icone' + (pequeno ? ' pequeno' : ''));
    try { img.src = this.texturas.iconeItem(nome); } catch (e) { /* item sem ícone */ }
    img.alt = rotuloDoItem(nome);
    this._dica(img, nome);
    return img;
  }

  /** Mostra rótulo e descrição do item na linha de dica */
  _dica(el, nome) {
    el.addEventListener('mouseenter', () => {
      const def = obterItem(nome);
      this.elDica.textContent = def ? `${rotuloDoItem(nome)}: ${def.descricao || ''}` : rotuloDoItem(nome);
    });
    el.addEventListener('mouseleave', () => { this.elDica.textContent = ''; });
  }

  // ------------------------------------------------------------------
  // Provador (boneco num canvas próprio)
  // ------------------------------------------------------------------
  _criarProvador(THREE, Personagem) {
    const p = { ok: false, rodando: false, idQuadro: 0, giro: Math.PI + 0.5, ultimo: 0, arrastando: false };
    try {
      const canvas = this.elCanvas;
      p.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
      p.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      p.renderer.setSize(canvas.width, canvas.height, false);
      p.renderer.setClearColor(0x000000, 0);
      p.cena = new THREE.Scene();
      p.cena.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sol = new THREE.DirectionalLight(0xffffff, 1.6);
      sol.position.set(2, 4, 5);
      p.cena.add(sol);
      p.camera = new THREE.PerspectiveCamera(28, canvas.width / canvas.height, 0.1, 50);
      p.camera.position.set(0, 1.0, 4.9);
      p.camera.lookAt(0, 0.9, 0);
      p.personagem = new Personagem({});
      p.cena.add(p.personagem.grupo);
      p.quadro = (t) => this._loopProvador(t);   // criado uma vez (sem lixo no loop)
      p.ok = true;

      // Arrastar com o mouse gira o boneco
      let ultimoX = 0;
      canvas.addEventListener('mousedown', (e) => { p.arrastando = true; ultimoX = e.clientX; e.preventDefault(); });
      window.addEventListener('mousemove', (e) => {
        if (!p.arrastando) return;
        p.giro += (e.clientX - ultimoX) * SENSIBILIDADE_GIRO;
        ultimoX = e.clientX;
      });
      window.addEventListener('mouseup', () => { p.arrastando = false; });
    } catch (e) {
      console.warn('Provador do alfaiate indisponível:', e);
    }
    this._prov = p;
  }

  _loopProvador(t) {
    const p = this._prov;
    if (!p || !p.rodando) return;
    const dt = Math.min((t - p.ultimo) / 1000, 0.1);
    p.ultimo = t;
    if (!p.arrastando) p.giro += dt * VELOCIDADE_GIRO_PROVADOR;
    p.personagem.grupo.rotation.y = p.giro;
    p.personagem.animar(dt, 0, false);
    p.renderer.render(p.cena, p.camera);
    p.idQuadro = requestAnimationFrame(p.quadro);
  }

  async _iniciarProvador() {
    if (!this._prov) {
      if (!this._carregandoProv) {
        this._carregandoProv = Promise.all([import('three'), import('./character.js')])
          .then(([THREE, car]) => this._criarProvador(THREE, car.Personagem))
          .catch((e) => { console.warn('Provador do alfaiate indisponível:', e); this._prov = { ok: false }; });
      }
      await this._carregandoProv;
      this._atualizarProvador();
    }
    const p = this._prov;
    if (!this.aberta || !p || !p.ok || p.rodando) return;
    p.rodando = true;
    p.ultimo = performance.now();
    p.idQuadro = requestAnimationFrame(p.quadro);
  }

  _pararProvador() {
    const p = this._prov;
    if (!p) return;
    p.rodando = false;
    cancelAnimationFrame(p.idQuadro);
    p.idQuadro = 0;
  }

  /** Aparência atual (base + equipamento) com a peça escolhida por cima */
  _atualizarProvador() {
    const p = this._prov;
    if (!p || !p.ok) return;
    const ap = this.equipamento?.aparencia ? this.equipamento.aparencia() : {};
    const aplicar = { ...ap, cores: this.aparenciaBase ?? undefined };
    const def = this._selecionado ? obterItem(this._selecionado) : null;
    if (def?.tipo === 'roupa') aplicar.roupa = def.visual;
    else if (def?.tipo === 'acessorio') aplicar.acessorio = def.visual;
    if (aplicar.roupa === undefined) aplicar.roupa = null;
    if (aplicar.acessorio === undefined) aplicar.acessorio = null;
    p.personagem.definirAparencia(aplicar);
    this.elProvNome.textContent = def ? `Prévia: ${rotuloDoItem(this._selecionado)}` : 'Escolha uma peça para ver como fica';
  }

  // ------------------------------------------------------------------
  // Abrir e fechar
  // ------------------------------------------------------------------
  abrir({ inventario, equipamento, aparenciaBase, particulas, som, posMesa, aoFechar } = {}) {
    this.inventario = inventario;
    this.equipamento = equipamento ?? null;
    this.aparenciaBase = aparenciaBase ?? null;
    this.particulas = particulas ?? null;
    this.som = som ?? null;
    this.posMesa = posMesa ?? null;
    this.aoFechar = aoFechar ?? null;
    this._msg.texto = '';
    this._selecionado = this._selecionado ?? RECEITAS_ALFAIATE[0]?.resultado ?? null;

    // Redesenha quando o inventário ou o equipamento mudam (liga uma vez só)
    const redesenhar = () => { if (this.aberta) this._desenhar(); };
    if (inventario && !this._invsLigados.has(inventario)) {
      this._invsLigados.add(inventario);
      inventario.aoMudar(redesenhar);
    }
    if (equipamento && !this._invsLigados.has(equipamento)) {
      this._invsLigados.add(equipamento);
      equipamento.aoMudar(redesenhar);
    }

    this.aberta = true;
    if (this.ui?.pausaAberta) this.ui._esconderPausa?.();
    this.elRaiz.classList.remove('oculto');
    this._desenhar();
    this._iniciarProvador();
    this._atualizarProvador();
    this.ui?.soltarMouse?.();
  }

  /** Fecha a tela. `travar` = true volta ao jogo; false (Esc) mostra a pausa */
  fechar(travar = true) {
    if (!this.aberta) return;
    this.aberta = false;
    this.elRaiz.classList.add('oculto');
    this._pararProvador();
    const cb = this.aoFechar;
    this.aoFechar = null;
    if (typeof cb === 'function') cb();
    if (travar) this.ui?.travarMouse?.();
    else if (typeof this.ui?._mostrarPausa === 'function' && !this.ui.mouseTravado) this.ui._mostrarPausa();
  }

  // ------------------------------------------------------------------
  // Desenho das abas
  // ------------------------------------------------------------------
  _desenhar() {
    if (!this.inventario) return;
    for (const b of this.elAbas.children) b.classList.toggle('ativa', b.dataset.aba === this._aba);
    this.elCorpo.textContent = '';
    if (this._aba === 'costurar') this._desenharCostura();
    else this._desenharLoja();
    this.elMsg.textContent = this._msg.texto;
    this.elMsg.className = 'alf-msg ' + this._msg.tipo;
  }

  /** Escolhe a peça: atualiza a prévia e o destaque da lista */
  _escolher(nome) {
    if (this._selecionado === nome) return;
    this._selecionado = nome;
    this._atualizarProvador();
    for (const linha of this.elCorpo.querySelectorAll('.alf-linha')) {
      linha.classList.toggle('sel', linha.dataset.item === nome);
    }
  }

  /** Começo comum de uma linha: ícone + nome + bônus */
  _linhaBase(nome) {
    const linha = this._el('div', 'alf-linha' + (this._selecionado === nome ? ' sel' : ''));
    linha.dataset.item = nome;
    linha.addEventListener('click', () => this._escolher(nome));
    linha.appendChild(this._icone(nome));
    const info = this._el('div', 'alf-info');
    info.appendChild(this._el('div', 'alf-nome', rotuloDoItem(nome)));
    info.appendChild(this._el('div', 'alf-bonus', textoBonus(nome)));
    linha.appendChild(info);
    return { linha, info };
  }

  _desenharCostura() {
    if (RECEITAS_ALFAIATE.length === 0) {
      this.elCorpo.appendChild(this._el('p', 'alf-vazia', 'Nenhuma peça para costurar ainda.'));
      return;
    }
    for (const r of RECEITAS_ALFAIATE) {
      const { linha, info } = this._linhaBase(r.resultado);
      const ings = this._el('div', 'alf-ings');
      for (const { item, qtd } of r.entradas) {
        const tenho = contarItem(this.inventario, item);
        const c = this._el('div', 'alf-ing' + (tenho < qtd ? ' falta' : ''));
        c.appendChild(this._icone(item, true));
        c.appendChild(this._el('span', 'alf-num', `${tenho}/${qtd}`));
        ings.appendChild(c);
      }
      info.appendChild(ings);
      const pode = faltando(this.inventario, r.entradas).length === 0;
      const b = this._el('button', 'alf-btn' + (pode ? ' principal' : ''), 'Costurar');
      b.style.opacity = pode ? '1' : '0.6';
      b.addEventListener('click', (e) => { e.stopPropagation(); this._selecionado = r.resultado; this._acaoCosturar(r); });
      linha.appendChild(b);
      this.elCorpo.appendChild(linha);
    }
  }

  _desenharLoja() {
    const moedas = contarMoedas(this.inventario);
    this.elCorpo.appendChild(this._el('div', 'alf-topo', `Você tem ${moedas} ${moedas === 1 ? 'moeda' : 'moedas'}`));
    const nomes = Object.keys(PRECOS_LOJA);
    if (nomes.length === 0) {
      this.elCorpo.appendChild(this._el('p', 'alf-vazia', 'A loja está vazia.'));
      return;
    }
    for (const nome of nomes) {
      const preco = PRECOS_LOJA[nome];
      const { linha, info } = this._linhaBase(nome);
      const ings = this._el('div', 'alf-ings');
      const c = this._el('div', 'alf-ing' + (moedas < preco ? ' falta' : ''));
      c.appendChild(this._icone(NOME_MOEDA, true));
      c.appendChild(this._el('span', 'alf-num', `${moedas}/${preco}`));
      ings.appendChild(c);
      info.appendChild(ings);
      const pode = moedas >= preco;
      const b = this._el('button', 'alf-btn' + (pode ? ' principal' : ''), `Comprar (${preco})`);
      b.style.opacity = pode ? '1' : '0.6';
      b.addEventListener('click', (e) => { e.stopPropagation(); this._selecionado = nome; this._acaoComprar(nome); });
      linha.appendChild(b);
      this.elCorpo.appendChild(linha);
    }
  }

  // ------------------------------------------------------------------
  // Ações dos botões
  // ------------------------------------------------------------------
  _acaoCosturar(receita) {
    this._depoisDaAcao(costurar(this.inventario, receita));
  }

  _acaoComprar(nome) {
    this._depoisDaAcao(comprar(this.inventario, nome));
  }

  _depoisDaAcao(resultado) {
    this._msg = { texto: resultado.motivo, tipo: resultado.ok ? 'ok' : 'erro' };
    this._desenhar();
    this._atualizarProvador();
    if (resultado.ok) this._efeitos();
  }

  /** Linhas coloridas de linha e agulha na mesa + um som de pano */
  _efeitos() {
    if (this.particulas && this.posMesa && typeof this.particulas.emitir === 'function') {
      const p = this.posMesa;
      this.particulas.emitir({
        x: p.x + 0.5, y: p.y + 1.1, z: p.z + 0.5, qtd: 18,
        cores: ['#ff4a4a', '#4a8aff', '#ffd84a', '#5be06a', '#d070ff'],
        velocidade: 1.8, vy: 1.2, espalhar: 0.4, gravidade: 2.5, vida: 0.9, tamanho: 0.07, aditivo: true, arrasto: 1,
      });
    }
    if (this.som) {
      if (typeof this.som.colocar === 'function') this.som.colocar('folhas');
      else if (typeof this.som.poder === 'function') this.som.poder('alfaiate');
    }
  }
}
