// =====================================================================
// Hackraft - Forja (Fase 9)
// ---------------------------------------------------------------------
// Dois pedaços neste arquivo:
//   1. LÓGICA PURA (sem DOM, dá para testar no Node): receitas de fundir
//      e de forjar, custo de melhoria e as funções fundir / forjar /
//      melhorar. Todas devolvem { ok, motivo } com o texto em português.
//   2. TelaForja: o painel da forja (3 abas), com DOM e CSS próprios.
//
// A melhoria (+1 a +5) fica escrita no NOME do item: 'espada_ferro+2'.
// Os nomes de items.js (nomeBase, melhoriaDe, MATERIAIS_EQUIP) são
// opcionais: se ainda não existirem, usamos versões locais.
// =====================================================================

import * as ITENS_JS from './items.js';

const { obterItem } = ITENS_JS;

// ---------------------------------------------------------------------
// Números ajustáveis
// ---------------------------------------------------------------------
const NIVEL_MAXIMO = 5;          // melhoria máxima (+5)
const DURACAO_BRILHO_MS = 800;   // quanto tempo o ícone brilha
const INTERVALO_MARTELO_MS = 150; // tempo entre as 3 marteladas
const MARTELADAS = 3;

// Quantas unidades do material cada peça custa (como no Minecraft)
const CUSTO_PECA = { espada: 2, capacete: 5, peitoral: 8, calca: 7, botas: 4 };
const PECAS = ['espada', 'capacete', 'peitoral', 'calca', 'botas'];
const NOME_PECA = { espada: 'Espada', capacete: 'Capacete', peitoral: 'Peitoral', calca: 'Calça', botas: 'Botas' };

// Materiais que dá para forjar (usado se MATERIAIS_EQUIP não existir em items.js).
// madeira e couro ficam de fora: não se forja, só se melhora.
const MATERIAIS_FORJAVEIS_PADRAO = ['cobre', 'ferro', 'prata', 'ouro', 'diamante', 'draconio', 'escama_dragao', 'escama_hidra'];

// Qual item serve de "unidade" de cada material (o que se gasta)
const UNIDADE_DO_MATERIAL = {
  cobre: 'barra_cobre',
  ferro: 'barra_ferro',
  prata: 'barra_prata',
  ouro: 'barra_ouro',
  diamante: 'diamante',
  draconio: 'barra_draconio',
  madeira: 'tabuas',
  couro: 'couro_orc',
  escama_dragao: 'escama_dragao',
  escama_hidra: 'escama_hidra',
  // as espadas de chefão se chamam espada_dragao e espada_hidra
  dragao: 'escama_dragao',
  hidra: 'escama_hidra',
};

/** Item gasto para um material (usa MATERIAIS_EQUIP quando tiver o campo item) */
function unidadeDoMaterial(material) {
  const m = ITENS_JS.MATERIAIS_EQUIP?.[material];
  return m?.item ?? UNIDADE_DO_MATERIAL[material] ?? null;
}

const ROTULO_MATERIAL = {
  cobre: 'Cobre', ferro: 'Ferro', prata: 'Prata', ouro: 'Ouro', diamante: 'Diamante', draconio: 'Dracônio',
  escama_dragao: 'Dragão', escama_hidra: 'Hidra', madeira: 'Madeira', couro: 'Couro',
};

// ---------------------------------------------------------------------
// Receitas de fundir: 1 bruto + 1 carvão -> 1 barra
// ---------------------------------------------------------------------
function receitaFundir(metal, bruto) {
  return {
    id: 'fundir_' + metal,
    entradas: [{ item: bruto, qtd: 1 }, { item: 'carvao', qtd: 1 }],
    saida: { item: 'barra_' + metal, qtd: 1 },
  };
}

export const RECEITAS_FUNDIR = [
  receitaFundir('cobre', 'cobre_bruto'),
  receitaFundir('ferro', 'ferro_bruto'),
  receitaFundir('prata', 'prata_bruta'),
  receitaFundir('ouro', 'ouro_bruto'),
  receitaFundir('draconio', 'draconio_bruto'),
];

// ---------------------------------------------------------------------
// Funções de apoio sobre nomes e inventário
// ---------------------------------------------------------------------

/** 'espada_ferro+2' -> 'espada_ferro' */
export function nomeBase(nome) {
  if (typeof ITENS_JS.nomeBase === 'function') return ITENS_JS.nomeBase(nome);
  return String(nome ?? '').replace(/\+\d+$/, '');
}

/** 'espada_ferro+2' -> 2 (sem sufixo: 0) */
export function nivelDeMelhoria(nome) {
  if (typeof ITENS_JS.melhoriaDe === 'function') return ITENS_JS.melhoriaDe(nome) || 0;
  const m = /\+(\d+)$/.exec(String(nome ?? ''));
  return m ? Number(m[1]) : 0;
}

/** Rótulo bonito do item (com fallback se o item não existir) */
function rotuloDoItem(nome) {
  const def = obterItem(nome);
  if (def && def.rotulo) return def.rotulo;
  const n = nivelDeMelhoria(nome);
  const baseDef = obterItem(nomeBase(nome));
  if (baseDef) return n > 0 ? `${baseDef.rotulo} +${n}` : baseDef.rotulo;
  return String(nome).replace(/_/g, ' ');
}

/** Coloca a primeira letra em minúscula ("Barra de ferro" -> "barra de ferro") */
function minusculo(texto) {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** Plural simples da primeira palavra: barra -> barras, carvão -> carvões */
function pluralizar(texto, n) {
  if (n === 1) return texto;
  const partes = texto.split(' ');
  let p = partes[0];
  if (p.endsWith('ão')) p = p.slice(0, -2) + 'ões';
  else if (!p.endsWith('s')) p += 's';
  partes[0] = p;
  return partes.join(' ');
}

/** "2 barras de ferro" */
function textoQuantidade(item, n) {
  return `${n} ${pluralizar(minusculo(rotuloDoItem(item)), n)}`;
}

/** Junta ["a", "b", "c"] em "a, b e c" */
function juntar(lista) {
  if (lista.length <= 1) return lista.join('');
  return lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1];
}

/** Quantas unidades do item o inventário tem (somando todas as pilhas) */
export function contarItem(inventario, item) {
  let total = 0;
  for (const e of inventario.espacos) if (e && e.item === item) total += e.qtd;
  return total;
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

/** Lista o que falta para pagar `entradas` (multiplicadas por `vezes`) */
function faltando(inventario, entradas, vezes = 1) {
  const lista = [];
  for (const { item, qtd } of entradas) {
    const falta = qtd * vezes - contarItem(inventario, item);
    if (falta > 0) lista.push({ item, qtd: falta });
  }
  return lista;
}

function motivoFalta(lista) {
  const partes = lista.map(({ item, qtd }) => textoQuantidade(item, qtd));
  const unico = lista.length === 1 && lista[0].qtd === 1;
  return (unico ? 'Falta ' : 'Faltam ') + juntar(partes);
}

/**
 * Paga as entradas, entrega as saídas e, se não couber tudo no inventário,
 * desfaz tudo. Devolve true se deu certo.
 */
function trocar(inventario, entradas, saidas, vezes) {
  for (const { item, qtd } of entradas) tirarItem(inventario, item, qtd * vezes);
  const colocados = [];
  let sobrou = false;
  for (const { item, qtd } of saidas) {
    const total = qtd * vezes;
    const resto = inventario.adicionar(item, total);
    colocados.push({ item, qtd: total - resto });
    if (resto > 0) { sobrou = true; break; }
  }
  if (!sobrou) return true;
  // Não coube: devolve as saídas já colocadas e as entradas
  for (const { item, qtd } of colocados) tirarItem(inventario, item, qtd);
  for (const { item, qtd } of entradas) inventario.adicionar(item, qtd * vezes);
  return false;
}

// ---------------------------------------------------------------------
// Fundir
// ---------------------------------------------------------------------

/** Quantas vezes dá para fundir essa receita com o que há no inventário */
export function maximoFundir(inventario, receita) {
  let max = Infinity;
  for (const { item, qtd } of receita.entradas) {
    max = Math.min(max, Math.floor(contarItem(inventario, item) / qtd));
  }
  return Number.isFinite(max) ? max : 0;
}

/** Funde `vezes` vezes. Devolve { ok, motivo, vezes } */
export function fundir(inventario, receita, vezes = 1) {
  vezes = Math.floor(vezes);
  if (!receita || !(vezes >= 1)) return { ok: false, motivo: 'Nada para fundir.', vezes: 0 };
  const lista = faltando(inventario, receita.entradas, vezes);
  if (lista.length > 0) return { ok: false, motivo: motivoFalta(lista), vezes: 0 };
  if (!trocar(inventario, receita.entradas, [receita.saida], vezes)) {
    return { ok: false, motivo: 'Seu inventário está cheio.', vezes: 0 };
  }
  return { ok: true, motivo: `Você fundiu ${textoQuantidade(receita.saida.item, receita.saida.qtd * vezes)}!`, vezes };
}

// ---------------------------------------------------------------------
// Forjar
// ---------------------------------------------------------------------

/** Lê a lista de materiais de MATERIAIS_EQUIP (array, objeto ou Map), ou usa a padrão */
function materiaisForjaveis() {
  const fonte = ITENS_JS.MATERIAIS_EQUIP;
  let nomes = null;
  if (Array.isArray(fonte)) nomes = fonte.map((m) => (typeof m === 'string' ? m : (m?.nome ?? m?.material ?? m?.id)));
  else if (fonte instanceof Map) nomes = [...fonte.keys()];
  else if (fonte && typeof fonte === 'object') nomes = Object.keys(fonte);
  if (!nomes) return MATERIAIS_FORJAVEIS_PADRAO;
  const lista = nomes.filter((n) => typeof n === 'string' && n !== 'madeira' && n !== 'couro');
  return lista.length > 0 ? lista : MATERIAIS_FORJAVEIS_PADRAO;
}

/** Nome do item de uma peça: espada_ferro, capacete_ferro... */
function nomeDaPeca(peca, material) {
  return `${peca}_${material}`;
}

/**
 * Receitas de forjar, geradas dos materiais. Só entram as que têm o item
 * resultado cadastrado. Cada uma: { id, material, peca, resultado, entradas }.
 */
export function receitasForjar() {
  const receitas = [];
  for (const material of materiaisForjaveis()) {
    const unidade = unidadeDoMaterial(material);
    if (!unidade) continue;
    for (const peca of PECAS) {
      const resultado = nomeDaPeca(peca, material);
      if (!obterItem(resultado)) continue;
      const entradas = [{ item: unidade, qtd: CUSTO_PECA[peca] }];
      if (peca === 'espada') entradas.push({ item: 'graveto', qtd: 1 });
      receitas.push({ id: 'forjar_' + resultado, material, peca, resultado, entradas });
    }
  }
  return receitas;
}

/** Forja uma peça. Devolve { ok, motivo } */
export function forjar(inventario, receita) {
  if (!receita || !obterItem(receita.resultado)) return { ok: false, motivo: 'Essa peça ainda não existe.' };
  const lista = faltando(inventario, receita.entradas, 1);
  if (lista.length > 0) return { ok: false, motivo: motivoFalta(lista) };
  if (!trocar(inventario, receita.entradas, [{ item: receita.resultado, qtd: 1 }], 1)) {
    return { ok: false, motivo: 'Seu inventário está cheio.' };
  }
  return { ok: true, motivo: `Você forjou: ${rotuloDoItem(receita.resultado)}!` };
}

// ---------------------------------------------------------------------
// Melhorar (+1 a +5)
// ---------------------------------------------------------------------

/** Material de um equipamento ('ferro', 'madeira', 'dragao'...) ou null */
function materialDoItem(nome) {
  const base = nomeBase(nome);
  const def = obterItem(base);
  if (!def) return null;
  if (def.tipo === 'armadura') return def.material ?? null;
  if (def.tipo === 'arma') {
    if (def.material) return def.material;
    const m = /^espada_(.+)$/.exec(base);
    return m ? m[1] : null;
  }
  return null;
}

/**
 * O que custa para subir uma melhoria: [{ item, qtd }] ou null se o item
 * não pode ser melhorado (ou já está no +5). Para chegar a +N: N+1 unidades.
 */
export function custoMelhoria(nomeItem) {
  const nivel = nivelDeMelhoria(nomeItem);
  if (nivel >= NIVEL_MAXIMO) return null;
  const material = materialDoItem(nomeItem);
  const unidade = material ? unidadeDoMaterial(material) : null;
  if (!unidade) return null;
  return [{ item: unidade, qtd: nivel + 2 }];
}

/** Nome do item no próximo nível: 'espada_ferro+2' -> 'espada_ferro+3' */
export function proximoNivel(nomeItem) {
  return `${nomeBase(nomeItem)}+${nivelDeMelhoria(nomeItem) + 1}`;
}

/** O item na origem ({ tipo: 'inventario', indice } ou { tipo: 'equipamento', slot }) */
export function itemDaOrigem(inventario, equipamento, origem) {
  if (!origem) return null;
  if (origem.tipo === 'inventario') return inventario.espacos[origem.indice]?.item ?? null;
  if (origem.tipo === 'equipamento') return equipamento?.espacos?.[origem.slot] ?? null;
  return null;
}

/** Melhora o item da origem em +1. Devolve { ok, motivo, item } */
export function melhorar(inventario, equipamento, origem) {
  const atual = itemDaOrigem(inventario, equipamento, origem);
  if (!atual) return { ok: false, motivo: 'Escolha um equipamento primeiro.' };
  if (nivelDeMelhoria(atual) >= NIVEL_MAXIMO) return { ok: false, motivo: 'Esse item já está no máximo (+5)!' };
  const custo = custoMelhoria(atual);
  if (!custo) return { ok: false, motivo: 'Esse item não pode ser melhorado.' };
  const novo = proximoNivel(atual);
  if (!obterItem(novo)) return { ok: false, motivo: 'Essa melhoria ainda não existe.' };
  const lista = faltando(inventario, custo, 1);
  if (lista.length > 0) return { ok: false, motivo: motivoFalta(lista) };

  // Paga e troca o nome do item (a pilha é de 1, então o item não muda de lugar)
  for (const { item, qtd } of custo) tirarItem(inventario, item, qtd);
  if (origem.tipo === 'inventario') {
    // pagar pode ter esvaziado o espaço? Só se o material fosse o próprio item (não é)
    inventario.espacos[origem.indice].item = novo;
    inventario.notificar();
  } else {
    equipamento.espacos[origem.slot] = novo;
    equipamento.notificar();
  }
  return { ok: true, motivo: `${rotuloDoItem(novo)}! Ficou mais forte.`, item: novo };
}

/** Equipamentos que a aba Melhorar mostra: [{ origem, item }] (equipados primeiro) */
export function listarMelhoraveis(inventario, equipamento) {
  const lista = [];
  const eMelhoravel = (nome) => {
    const def = obterItem(nomeBase(nome));
    return !!def && (def.tipo === 'arma' || def.tipo === 'armadura');
  };
  if (equipamento?.espacos) {
    for (const slot of Object.keys(equipamento.espacos)) {
      const nome = equipamento.espacos[slot];
      if (nome && eMelhoravel(nome)) lista.push({ origem: { tipo: 'equipamento', slot }, item: nome, equipado: true });
    }
  }
  inventario.espacos.forEach((e, indice) => {
    if (e && eMelhoravel(e.item)) lista.push({ origem: { tipo: 'inventario', indice }, item: e.item, equipado: false });
  });
  return lista;
}

// =====================================================================
// A TELA DA FORJA (só usa DOM quando é criada, nunca no import)
// =====================================================================

const CSS = `
#forja { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.5); z-index: 20; }
#forja.oculto { display: none; }
#forja .forja-painel { background: var(--painel, #c6c6c6); border: 4px solid; border-color: #fff #555 #555 #fff;
  outline: 3px solid #000; color: #222; padding: 14px 16px 12px; width: min(720px, 96vw); max-height: 96vh;
  overflow-y: auto; font-family: var(--fonte-texto, 'Trebuchet MS', sans-serif); }
#forja h2 { margin: 0 0 10px; font-family: var(--fonte-pixel, 'Courier New', monospace); font-size: 14px; color: #3a3a3a; }
#forja .forja-abas { display: flex; gap: 6px; margin-bottom: 10px; }
#forja .forja-aba, #forja .forja-btn { font: bold 14px var(--fonte-texto, sans-serif); color: #222; cursor: pointer;
  background: #b0b0b0; border: 3px solid; border-color: #fff #555 #555 #fff; padding: 6px 14px; }
#forja .forja-aba:hover, #forja .forja-btn:hover:not(:disabled) { background: #d0d0d0; }
#forja .forja-aba.ativa { background: #8b8b8b; border-color: #555 #fff #fff #555; color: #fff; }
#forja .forja-btn:disabled { opacity: 0.45; cursor: not-allowed; }
#forja .forja-btn.grande { font-size: 18px; padding: 10px 26px; background: #e08a2a; color: #fff;
  text-shadow: 1px 1px 0 #6a3a00; }
#forja .forja-btn.grande:hover:not(:disabled) { background: #f0a040; }
#forja .forja-corpo { min-height: 250px; background: #8b8b8b; border: 3px solid; border-color: #555 #fff #fff #555; padding: 10px; }
#forja .forja-linha { display: flex; align-items: center; gap: 8px; background: #a0a0a0; padding: 6px 8px; margin-bottom: 6px;
  border: 2px solid; border-color: #fff #666 #666 #fff; flex-wrap: wrap; }
#forja .forja-ing { display: flex; align-items: center; gap: 4px; font-weight: bold; }
#forja .forja-ing.falta .forja-num { color: #b00000; }
#forja .forja-num { font-family: var(--fonte-pixel, monospace); font-size: 11px; }
#forja .forja-seta { font-size: 20px; font-weight: bold; margin: 0 4px; }
#forja .forja-espaco { flex: 1; }
#forja .forja-celula img.forja-icone { width: 30px; height: 30px; }
#forja img.forja-icone { width: 36px; height: 36px; image-rendering: pixelated; background: #8b8b8b;
  border: 2px solid; border-color: #555 #fff #fff #555; }
#forja img.forja-icone.pequeno { width: 26px; height: 26px; }
#forja img.forja-icone.brilho { animation: forja-brilho 0.8s ease-out; }
@keyframes forja-brilho {
  0% { filter: brightness(1); box-shadow: 0 0 0 0 rgba(255, 200, 80, 0); transform: scale(1); }
  30% { filter: brightness(2.2) saturate(1.5); box-shadow: 0 0 16px 6px rgba(255, 190, 60, 0.95); transform: scale(1.25); }
  100% { filter: brightness(1); box-shadow: 0 0 0 0 rgba(255, 200, 80, 0); transform: scale(1); }
}
#forja table.forja-grade { border-collapse: separate; border-spacing: 5px; width: 100%; }
#forja .forja-grade th { font-size: 12px; color: #fff; text-shadow: 1px 1px 0 #333; font-weight: bold; }
#forja .forja-grade th.mat { text-align: left; white-space: nowrap; }
#forja .forja-celula { width: 100%; background: #a8a8a8; border: 3px solid; border-color: #fff #555 #555 #fff; cursor: pointer;
  padding: 4px 2px; display: flex; flex-direction: column; align-items: center; gap: 2px; color: #222; font: inherit; }
#forja .forja-celula:hover { background: #d4d4d4; }
#forja .forja-celula.falta { opacity: 0.45; }
#forja .forja-celula .forja-num { font-size: 9px; white-space: nowrap; }
#forja .forja-celula.falta .forja-num { color: #900000; }
#forja .forja-vazia { text-align: center; color: #555; }
#forja .forja-melhorar { display: flex; gap: 10px; align-items: stretch; }
#forja .forja-lista { width: 250px; max-height: 300px; overflow-y: auto; }
#forja .forja-item { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; margin-bottom: 4px;
  background: #a8a8a8; border: 2px solid; border-color: #fff #555 #555 #fff; padding: 3px 5px; cursor: pointer; font: bold 13px var(--fonte-texto, sans-serif); color: #222; }
#forja .forja-item:hover { background: #d0d0d0; }
#forja .forja-item.sel { background: #e8c070; border-color: #555 #fff #fff #555; }
#forja .forja-item small { font-weight: normal; color: #444; display: block; }
#forja .forja-detalhe { flex: 1; background: #a0a0a0; padding: 12px; display: flex; flex-direction: column; align-items: center;
  gap: 8px; text-align: center; border: 2px solid; border-color: #fff #666 #666 #fff; }
#forja .forja-detalhe img.forja-icone { width: 64px; height: 64px; }
#forja .forja-titulo-item { font: bold 16px var(--fonte-texto, sans-serif); }
#forja .forja-efeito { color: #1a5a1a; font-weight: bold; }
#forja .forja-msg { min-height: 22px; margin-top: 8px; font-weight: bold; text-align: center; }
#forja .forja-msg.ok { color: #1a6a1a; }
#forja .forja-msg.erro { color: #a00000; }
#forja .forja-dica { min-height: 18px; margin-top: 2px; font-size: 12px; color: #444; text-align: center; }
#forja .forja-rodape { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 12px; color: #444; }
`;

export class TelaForja {
  constructor({ ui, texturas } = {}) {
    this.ui = ui;
    this.texturas = texturas;
    this.aberta = false;

    this.inventario = null;
    this.equipamento = null;
    this.particulas = null;
    this.som = null;
    this.posForja = null;
    this.aoFechar = null;

    this._aba = 'fundir';
    this._selecao = null;          // origem escolhida na aba Melhorar
    this._brilhar = null;          // nome do item que deve brilhar após a ação
    this._msg = { texto: '', tipo: 'ok' };
    this._temporizadores = [];
    this._invsLigados = new WeakSet();

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
    raiz.id = 'forja';
    raiz.className = 'oculto';
    raiz.innerHTML = `
      <div class="forja-painel">
        <h2>Forja</h2>
        <div class="forja-abas"></div>
        <div class="forja-corpo"></div>
        <div class="forja-msg"></div>
        <div class="forja-dica"></div>
        <div class="forja-rodape"><span>E fecha a forja</span><button class="forja-btn" data-fechar>Fechar</button></div>
      </div>`;
    document.body.appendChild(raiz);
    this.elRaiz = raiz;
    this.elAbas = raiz.querySelector('.forja-abas');
    this.elCorpo = raiz.querySelector('.forja-corpo');
    this.elMsg = raiz.querySelector('.forja-msg');
    this.elDica = raiz.querySelector('.forja-dica');
    raiz.querySelector('[data-fechar]').addEventListener('click', () => this.fechar(true));
    // Clicar fora do painel também fecha
    raiz.addEventListener('mousedown', (e) => { if (e.target === raiz) this.fechar(true); });

    for (const [id, texto] of [['fundir', 'Fundir'], ['forjar', 'Forjar'], ['melhorar', 'Melhorar']]) {
      const b = document.createElement('button');
      b.className = 'forja-aba';
      b.textContent = texto;
      b.dataset.aba = id;
      b.addEventListener('click', () => { this._aba = id; this._msg.texto = ''; this._desenhar(); });
      this.elAbas.appendChild(b);
    }
  }

  /** Cria um elemento com classe e texto */
  _el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  /** Imagem do ícone do item (com dica ao passar o mouse) */
  _icone(nome, pequeno = false) {
    const img = this._el('img', 'forja-icone' + (pequeno ? ' pequeno' : ''));
    try { img.src = this.texturas.iconeItem(nome); } catch (e) { /* item sem ícone */ }
    img.alt = rotuloDoItem(nome);
    if (this._brilhar && nomeBase(nome) === nomeBase(this._brilhar)) img.classList.add('brilho');
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

  /** Um ingrediente: ícone + tenho/preciso */
  _ingrediente(item, preciso, tenho) {
    const c = this._el('div', 'forja-ing' + (tenho < preciso ? ' falta' : ''));
    c.appendChild(this._icone(item, true));
    c.appendChild(this._el('span', 'forja-num', `${tenho}/${preciso}`));
    return c;
  }

  // ------------------------------------------------------------------
  // Abrir e fechar
  // ------------------------------------------------------------------
  abrir({ inventario, equipamento, particulas, som, posForja, aoFechar } = {}) {
    this.inventario = inventario;
    this.equipamento = equipamento ?? null;
    this.particulas = particulas ?? null;
    this.som = som ?? null;
    this.posForja = posForja ?? null;
    this.aoFechar = aoFechar ?? null;
    this._msg.texto = '';
    this._selecao = null;
    this._brilhar = null;

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
    if (this.ui?.pausaAberta) this.ui._esconderPausa?.(); // caso a pausa estivesse na tela
    this.elRaiz.classList.remove('oculto');
    this._desenhar();
    this.ui?.soltarMouse?.();
  }

  /** Fecha a forja. `travar` = true volta ao jogo; false (Esc) mostra a pausa */
  fechar(travar = true) {
    if (!this.aberta) return;
    this.aberta = false;
    this.elRaiz.classList.add('oculto');
    for (const t of this._temporizadores) clearTimeout(t);
    this._temporizadores.length = 0;
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
    if (this._aba === 'fundir') this._desenharFundir();
    else if (this._aba === 'forjar') this._desenharForjar();
    else this._desenharMelhorar();
    this.elMsg.textContent = this._msg.texto;
    this.elMsg.className = 'forja-msg ' + this._msg.tipo;
  }

  _desenharFundir() {
    for (const r of RECEITAS_FUNDIR) {
      if (!obterItem(r.saida.item)) continue;
      const linha = this._el('div', 'forja-linha');
      for (const { item, qtd } of r.entradas) {
        linha.appendChild(this._ingrediente(item, qtd, contarItem(this.inventario, item)));
      }
      linha.appendChild(this._el('span', 'forja-seta', '→'));
      linha.appendChild(this._icone(r.saida.item));
      linha.appendChild(this._el('span', 'forja-num', 'x' + contarItem(this.inventario, r.saida.item)));
      linha.appendChild(this._el('span', 'forja-espaco'));

      const max = maximoFundir(this.inventario, r);
      const b1 = this._el('button', 'forja-btn', 'Fundir 1');
      b1.disabled = max < 1;
      b1.addEventListener('click', () => this._acaoFundir(r, 1));
      const bTudo = this._el('button', 'forja-btn', max > 1 ? `Fundir tudo (${max})` : 'Fundir tudo');
      bTudo.disabled = max < 1;
      bTudo.addEventListener('click', () => this._acaoFundir(r, max));
      linha.appendChild(b1);
      linha.appendChild(bTudo);
      this.elCorpo.appendChild(linha);
    }
    if (!this.elCorpo.firstChild) this.elCorpo.appendChild(this._el('p', 'forja-vazia', 'Nenhuma receita disponível.'));
  }

  _desenharForjar() {
    const receitas = receitasForjar();
    if (receitas.length === 0) {
      this.elCorpo.appendChild(this._el('p', 'forja-vazia', 'Nenhuma peça para forjar ainda.'));
      return;
    }
    // Agrupa por material, mantendo a ordem
    const porMaterial = new Map();
    for (const r of receitas) {
      if (!porMaterial.has(r.material)) porMaterial.set(r.material, {});
      porMaterial.get(r.material)[r.peca] = r;
    }
    const tabela = this._el('table', 'forja-grade');
    const cab = this._el('tr');
    cab.appendChild(this._el('th'));
    for (const p of PECAS) cab.appendChild(this._el('th', '', NOME_PECA[p]));
    tabela.appendChild(cab);

    for (const [material, pecas] of porMaterial) {
      const tr = this._el('tr');
      const th = this._el('th', 'mat');
      const unidade = unidadeDoMaterial(material);
      if (unidade && obterItem(unidade)) th.appendChild(this._icone(unidade, true));
      th.appendChild(document.createTextNode(' ' + (ROTULO_MATERIAL[material] ?? material)));
      tr.appendChild(th);
      for (const p of PECAS) {
        const td = this._el('td');
        const r = pecas[p];
        if (r) {
          const tenhoTudo = faltando(this.inventario, r.entradas, 1).length === 0;
          const btn = this._el('button', 'forja-celula' + (tenhoTudo ? '' : ' falta'));
          btn.appendChild(this._icone(r.resultado));
          // Uma linha só: "tenho/preciso" de cada ingrediente (a espada leva também 1 graveto)
          const textos = r.entradas.map(({ item, qtd }) => `${contarItem(this.inventario, item)}/${qtd}`);
          btn.appendChild(this._el('span', 'forja-num', textos.join(' + ')));
          this._dica(btn, r.resultado);
          btn.addEventListener('click', () => this._acaoForjar(r));
          td.appendChild(btn);
        }
        tr.appendChild(td);
      }
      tabela.appendChild(tr);
    }
    this.elCorpo.appendChild(tabela);
  }

  _desenharMelhorar() {
    const caixa = this._el('div', 'forja-melhorar');
    const lista = this._el('div', 'forja-lista');
    const itens = listarMelhoraveis(this.inventario, this.equipamento);

    // A seleção continua válida só se o item ainda está lá
    if (this._selecao && !itemDaOrigem(this.inventario, this.equipamento, this._selecao)) this._selecao = null;

    if (itens.length === 0) lista.appendChild(this._el('p', 'forja-vazia', 'Você não tem armas nem armaduras.'));
    for (const { origem, item, equipado } of itens) {
      const sel = this._selecao && this._selecao.tipo === origem.tipo &&
        (origem.tipo === 'inventario' ? this._selecao.indice === origem.indice : this._selecao.slot === origem.slot);
      const b = this._el('button', 'forja-item' + (sel ? ' sel' : ''));
      b.appendChild(this._icone(item, true));
      const t = this._el('span');
      t.textContent = rotuloDoItem(item);
      if (equipado) t.appendChild(this._el('small', '', 'equipado'));
      b.appendChild(t);
      b.addEventListener('click', () => { this._selecao = origem; this._msg.texto = ''; this._desenhar(); });
      lista.appendChild(b);
    }

    const detalhe = this._el('div', 'forja-detalhe');
    const atual = itemDaOrigem(this.inventario, this.equipamento, this._selecao);
    if (!atual) {
      detalhe.appendChild(this._el('p', 'forja-vazia', 'Escolha uma arma ou armadura na lista.'));
    } else {
      const nivel = nivelDeMelhoria(atual);
      const custo = custoMelhoria(atual);
      detalhe.appendChild(this._icone(atual));
      if (!custo) {
        detalhe.appendChild(this._el('div', 'forja-titulo-item', rotuloDoItem(atual)));
        detalhe.appendChild(this._el('div', 'forja-efeito', nivel >= NIVEL_MAXIMO ? 'No máximo (+5)! Nada mais a melhorar.' : 'Esse item não pode ser melhorado.'));
      } else {
        const prox = proximoNivel(atual);
        const base = rotuloDoItem(nomeBase(atual));
        const de = nivel > 0 ? `${base} +${nivel}` : base;
        detalhe.appendChild(this._el('div', 'forja-titulo-item', `${de} → +${nivel + 1}`));
        detalhe.appendChild(this._el('div', 'forja-efeito', this._textoEfeito(atual, prox)));
        const linhaCusto = this._el('div', 'forja-linha');
        for (const { item, qtd } of custo) linhaCusto.appendChild(this._ingrediente(item, qtd, contarItem(this.inventario, item)));
        detalhe.appendChild(linhaCusto);
        const faltaAlgo = faltando(this.inventario, custo, 1).length > 0;
        const b = this._el('button', 'forja-btn grande', 'Melhorar');
        b.style.opacity = faltaAlgo ? '0.6' : '1';
        b.addEventListener('click', () => this._acaoMelhorar());
        detalhe.appendChild(b);
      }
    }
    caixa.appendChild(lista);
    caixa.appendChild(detalhe);
    this.elCorpo.appendChild(caixa);
  }

  /** "+1 de dano (6 → 7)" ou "+1 de defesa" */
  _textoEfeito(atual, prox) {
    const defA = obterItem(atual);
    const defP = obterItem(prox);
    if (defA?.tipo === 'arma') {
      const mostrar = defP && defP.dano !== undefined && defA.dano !== undefined;
      return mostrar ? `+${defP.dano - defA.dano} de dano (${defA.dano} → ${defP.dano})` : '+1 de dano';
    }
    if (defA?.tipo === 'armadura') {
      if (defP && defP.defesa !== undefined && defA.defesa !== undefined) {
        const d = defP.defesa - defA.defesa;
        return d > 0 ? `+${d} de defesa (${defA.defesa} → ${defP.defesa})` : 'Mais brilho! A defesa sobe no próximo nível.';
      }
      return 'Mais defesa e mais brilho';
    }
    return '';
  }

  // ------------------------------------------------------------------
  // Ações dos botões
  // ------------------------------------------------------------------
  _acaoFundir(receita, vezes) {
    const r = fundir(this.inventario, receita, vezes);
    this._depoisDaAcao(r, r.ok ? receita.saida.item : null);
  }

  _acaoForjar(receita) {
    const r = forjar(this.inventario, receita);
    this._depoisDaAcao(r, r.ok ? receita.resultado : null);
  }

  _acaoMelhorar() {
    const r = melhorar(this.inventario, this.equipamento, this._selecao);
    this._depoisDaAcao(r, r.ok ? r.item : null);
  }

  /** Mostra a mensagem e, se deu certo, faísca, martela e faz o ícone brilhar */
  _depoisDaAcao(resultado, itemNovo) {
    this._msg = { texto: resultado.motivo, tipo: resultado.ok ? 'ok' : 'erro' };
    this._brilhar = resultado.ok ? itemNovo : null;
    this._desenhar(); // (o inventário também já redesenhou; sem problema)
    if (!resultado.ok) return;
    this._efeitos();
    const t = setTimeout(() => { this._brilhar = null; }, DURACAO_BRILHO_MS);
    this._temporizadores.push(t);
  }

  /** Faíscas no bloco da forja + som de martelo (3 marteladas) */
  _efeitos() {
    for (let i = 0; i < MARTELADAS; i++) {
      const t = setTimeout(() => {
        if (this.particulas && this.posForja) {
          const p = this.posForja;
          this.particulas.fagulhas(p.x + 0.5, p.y + 1.1, p.z + 0.5);
        }
        if (this.som) {
          if (typeof this.som.forja === 'function') { if (i === 0) this.som.forja(); }
          else if (typeof this.som.golpe === 'function') this.som.golpe('pedra');
        }
      }, i * INTERVALO_MARTELO_MS);
      this._temporizadores.push(t);
    }
  }
}
