// =====================================================================
// Hackraft - Itens no chão
// ---------------------------------------------------------------------
// Quando alguém solta um item (tecla G, arrastando para fora do
// inventário, ou um presente que não coube), ele vira um "item no chão":
// um desenho pequeno (sprite) que flutua, gira de leve, cai com a
// gravidade e para em cima dos blocos.
//
// Quem passa perto pega: a menos de ITEM_RAIO_PUXAR blocos o item é
// puxado na direção do jogador, e a menos de ITEM_RAIO_PEGAR ele é pego.
//
// QUEM MANDA NOS ITENS
//   No multiplayer, só o anfitrião cria e remove itens (ele é a
//   "autoridade"). Este arquivo só cuida de mostrar e mexer os itens; quem
//   decide é a rede (network.js):
//     - `autoridade = true` (sozinho ou anfitrião): os itens somem sozinhos
//       depois de ITEM_VIDA_S e avisam por `aoSumir(id)`, para a rede
//       contar aos outros.
//     - `autoridade = false` (cliente): o item só some quando o anfitrião
//       manda (mensagem `itemRemovido`).
//   Quando o jogador local encosta num item, chamamos `aoPegar(entrada)`
//   (configurado em definirColetor). A rede decide se ele ganha o item.
//
// DESEMPENHO
//   - Uma textura e um material por TIPO de item (todos os itens de pedra
//     usam o mesmo material). Assim, mudar a luz do dia mexe em poucos
//     materiais, e não em cada item.
//   - Os sprites removidos ficam guardados numa reserva e são reusados.
//   - O loop (atualizar) não cria objetos novos.
//
// Exporta: ItensNoChao (contrato do CLAUDE.md), quantoCabe
// =====================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { SOLIDO, LIQUIDO } from './blocks.js';
import { obterItem } from './items.js';

// Números ajustáveis (os principais ficam no config.js)
const TAMANHO = CONFIG.ITEM_TAMANHO ?? 0.4;           // largura do desenho, em blocos
const RAIO_PEGAR = CONFIG.ITEM_RAIO_PEGAR ?? 1.3;     // distância para pegar
const RAIO_PUXAR = CONFIG.ITEM_RAIO_PUXAR ?? 2.5;     // distância em que começa a ser puxado
const FORCA_PUXAR = CONFIG.ITEM_FORCA_PUXAR ?? 16;    // aceleração do "puxão" (blocos/s²)
const VIDA = CONFIG.ITEM_VIDA_S ?? 600;               // segundos até sumir (10 minutos)
const ATRASO = CONFIG.ITEM_ATRASO_S ?? 0.5;           // espera até poder ser pego (item novo)
const ATRASO_DONO = CONFIG.ITEM_ATRASO_DONO_S ?? 2;   // espera para quem soltou pegar de volta
const GRAVIDADE = CONFIG.ITEM_GRAVIDADE ?? 20;
const MAXIMO = CONFIG.MAX_ITENS_CHAO ?? 256;          // itens no chão ao mesmo tempo

const VEL_MAX = 20;          // velocidade máxima (blocos/s)
const RAIO = 0.125;          // meia largura da "caixa" do item (para bater nas paredes)
const ALTURA_CAIXA = 0.25;   // altura da caixa do item
const ATRITO_CHAO = 10;      // freio no chão (por segundo)
const ARRASTO_AR = 0.4;      // freio no ar
const ARRASTO_AGUA = 4;      // freio na água
const SUBIR_AGUA = 0.8;      // na água o item boia (sobe devagar)
const PASSO_MAX = 0.4;       // deslocamento máximo por subpasso (não atravessa blocos)
const PASSO_FISICA = 1 / 60; // a física dos itens anda em passos fixos (veja atualizar)
const MAX_PASSOS = 6;        // no máximo 6 passos por quadro (0,1 s)
const ESPERA_PEDIDO = 0.6;   // segundos entre dois pedidos de "pegar" o mesmo item
const LUZ_MINIMA_ITEM = 0.3; // à noite o item escurece, mas continua visível

/**
 * Quantos itens com esse nome ainda cabem no inventário
 * (completando as pilhas iguais + os espaços vazios).
 */
export function quantoCabe(inventario, item) {
  if (!inventario || !obterItem(item)) return 0;
  const limite = inventario.limiteDaPilha(item);
  const espacos = inventario.espacos;
  let cabe = 0;
  for (let i = 0; i < espacos.length; i++) {
    const e = espacos[i];
    if (!e) cabe += limite;
    else if (e.item === item && e.qtd < limite) cabe += limite - e.qtd;
  }
  return cabe;
}

/** Quadradinho roxo e preto, usado se o ícone do item não existir */
function canvasReserva() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c040c0';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  return c;
}

const numeroOk = (v) => typeof v === 'number' && Number.isFinite(v);

export class ItensNoChao {
  /**
   * @param opcoes { scene, mundo, texturas }
   *   `texturas.iconeItem(nome)` dá o desenho de cada item.
   */
  constructor({ scene, mundo, texturas }) {
    this.scene = scene;
    this.mundo = mundo;
    this.texturas = texturas;

    this.itens = [];            // lista de entradas (na ordem em que foram criadas)
    this.porId = new Map();     // id → entrada
    this._proximoId = 1;

    // Configurado pela rede (veja o cabeçalho)
    this.autoridade = true;
    this.aoSumir = null;

    // Jogador local (configurado em definirColetor)
    this._posColetor = null;    // Vector3 nos pés do jogador
    this._podePegar = null;     // fn(item) → true se cabe no inventário
    this._aoPegar = null;       // fn(entrada)

    this._materiais = new Map(); // nome do item → SpriteMaterial
    this._listaMateriais = [];   // os mesmos materiais numa lista (percorrer sem criar objetos)
    this._reserva = [];          // sprites guardados para reusar
    this._tempo = 0;
    this._acumulado = 0;         // tempo que ainda não virou passo de física
    this._luz = 1;

    this.grupo = new THREE.Group();
    this.grupo.name = 'itens no chão';
    scene.add(this.grupo);
  }

  /** Quantos itens estão no chão */
  get quantidade() {
    return this.itens.length;
  }

  /** Um id que ainda não foi usado (só quem tem a autoridade cria itens) */
  novoId() {
    return this._proximoId++;
  }

  /** Entrada do item (ou undefined). Campos: id, item, qtd, x, y, z, vx, vy, vz, idade */
  obter(id) {
    return this.porId.get(id);
  }

  /**
   * Diz quem é o jogador local (o único que pega itens NESTE computador).
   *   posicao:   Vector3 nos pés do jogador (a referência é guardada)
   *   podePegar: fn(item) → true se ainda cabe no inventário
   *   aoPegar:   fn(entrada) chamada quando o jogador encosta no item
   */
  definirColetor({ posicao, podePegar, aoPegar }) {
    this._posColetor = posicao || null;
    this._podePegar = podePegar || null;
    this._aoPegar = aoPegar || null;
  }

  // ------------------------------------------------------------------
  // Criar e remover
  // ------------------------------------------------------------------

  /**
   * Põe um item no chão. Se o id já existir, o item antigo é trocado.
   * `soltoPorMim` = foi o jogador DESTE computador que soltou: ele espera
   * mais para pegar de volta e o item não é puxado para ele (senão o item
   * voltaria na hora para quem quis dar ou jogar fora).
   * Devolve a entrada criada (ou null se os dados forem inválidos).
   */
  criar(id, item, qtd, x, y, z, vx = 0, vy = 0, vz = 0, soltoPorMim = false) {
    if (!obterItem(item) || !Number.isInteger(qtd) || qtd < 1) return null;
    if (!numeroOk(x) || !numeroOk(y) || !numeroOk(z)) return null;
    if (!numeroOk(vx)) vx = 0;
    if (!numeroOk(vy)) vy = 0;
    if (!numeroOk(vz)) vz = 0;

    if (this.porId.has(id)) this.remover(id);
    // Muitos itens no chão: o mais antigo some (só quem manda decide isso)
    if (this.autoridade) {
      while (this.itens.length >= MAXIMO) {
        const velho = this.itens[0];
        this.remover(velho.id);
        if (this.aoSumir) this.aoSumir(velho.id);
      }
    }

    const sprite = this._reserva.pop() || new THREE.Sprite();
    sprite.material = this._material(item);
    sprite.scale.set(TAMANHO, TAMANHO, 1);
    sprite.visible = false; // aparece no primeiro atualizar (se o chunk estiver pronto)
    this.grupo.add(sprite);

    const e = {
      id, item, qtd,
      x, y, z,
      vx: limitar(vx), vy: limitar(vy), vz: limitar(vz),
      idade: 0,
      atraso: soltoPorMim ? ATRASO_DONO : ATRASO,
      puxar: !soltoPorMim,
      espera: 0,              // tempo até poder pedir para pegar de novo
      noChao: false,
      fase: (typeof id === 'number' ? id : this.itens.length) * 1.7, // cada item balança num ritmo
      sprite,
    };
    this.itens.push(e);
    this.porId.set(id, e);
    if (Number.isInteger(id) && id >= this._proximoId) this._proximoId = id + 1;
    return e;
  }

  /** Tira o item do chão. Devolve { id, item, qtd, x, y, z } ou null se não existia. */
  remover(id) {
    const e = this.porId.get(id);
    if (!e) return null;
    this.porId.delete(id);
    const i = this.itens.indexOf(e);
    if (i >= 0) this.itens.splice(i, 1);
    this.grupo.remove(e.sprite);
    e.sprite.visible = false;
    this._reserva.push(e.sprite);
    e.sprite = null;
    return { id: e.id, item: e.item, qtd: e.qtd, x: e.x, y: e.y, z: e.z };
  }

  /** Tira todos os itens */
  limpar() {
    while (this.itens.length) this.remover(this.itens[this.itens.length - 1].id);
  }

  // ------------------------------------------------------------------
  // Desenho (textura e material de cada tipo de item)
  // ------------------------------------------------------------------

  _material(item) {
    let m = this._materiais.get(item);
    if (m) return m;
    m = new THREE.SpriteMaterial({
      map: this._textura(item),
      alphaTest: 0.5,   // as partes transparentes do ícone são "recortadas"
      fog: true,
    });
    m.color.setScalar(this._luz);
    this._materiais.set(item, m);
    this._listaMateriais.push(m);
    return m;
  }

  _textura(item) {
    const t = this.texturas;
    let fonte = null;
    try {
      if (t && typeof t.iconeItem === 'function') {
        fonte = t.iconeItem(item);
      } else if (t && typeof t.iconeBloco === 'function') {
        const def = obterItem(item);
        if (def && def.bloco !== null && def.bloco !== undefined) fonte = t.iconeBloco(def.bloco);
      }
    } catch (erro) {
      console.warn('Hackraft: sem ícone para o item', item, erro);
    }
    let tex;
    if (fonte instanceof HTMLCanvasElement) tex = new THREE.CanvasTexture(fonte);
    else if (typeof fonte === 'string' && fonte) tex = new THREE.TextureLoader().load(fonte); // dataURL
    else tex = new THREE.CanvasTexture(canvasReserva());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;            // pixels "quadrados" de perto
    tex.minFilter = THREE.LinearMipmapLinearFilter; // suave de longe
    return tex;
  }

  /** Luz do dia (0 a 1): à noite os itens ficam mais escuros, como os blocos */
  definirLuz(v) {
    const luz = Math.max(LUZ_MINIMA_ITEM, Math.min(1, v));
    if (Math.abs(luz - this._luz) < 0.005) return;
    this._luz = luz;
    const lista = this._listaMateriais;
    for (let i = 0; i < lista.length; i++) lista[i].color.setScalar(luz);
  }

  // ------------------------------------------------------------------
  // A cada quadro
  // ------------------------------------------------------------------

  atualizar(dt) {
    if (dt <= 0) return;
    this._tempo += dt;
    const mundo = this.mundo;
    const pos = this._posColetor;

    // A física anda em passos FIXOS de 1/60 s, e não com o `dt` do quadro.
    // Por quê? Cada computador roda num ritmo diferente (um a 60 quadros
    // por segundo, outro a 20). Com passos de tamanhos diferentes, o mesmo
    // item jogado do mesmo jeito pararia em lugares um pouco diferentes em
    // cada tela. Com passos iguais, a conta é a mesma nos dois: o item para
    // exatamente no mesmo lugar para todo mundo.
    this._acumulado += dt;
    let passos = 0;
    while (this._acumulado >= PASSO_FISICA && passos < MAX_PASSOS) {
      this._acumulado -= PASSO_FISICA;
      passos++;
    }
    if (passos === MAX_PASSOS) this._acumulado = 0; // computador muito lento: não acumula atraso

    // De trás para a frente: um item pode ser removido no meio do caminho
    for (let i = this.itens.length - 1; i >= 0; i--) {
      const e = this.itens[i];
      if (!e) continue;

      // Chunk ainda não carregado (ou longe demais): o item fica parado e
      // escondido. Sem os blocos embaixo, ele cairia para sempre.
      if (!mundo.estaPronto(e.x, e.z)) {
        e.sprite.visible = false;
        continue;
      }

      e.idade += dt;
      if (this.autoridade && e.idade >= VIDA) {
        this._sumir(e.id);
        continue;
      }
      if (e.atraso > 0) e.atraso -= dt;
      if (e.espera > 0) e.espera -= dt;

      // ----- O jogador local está perto? -----
      let puxando = false;
      if (pos && e.atraso <= 0) {
        // Distância até o corpo do jogador (um segmento dos pés à cabeça)
        const meio = e.y + ALTURA_CAIXA * 0.5;
        const yCorpo = meio < pos.y ? pos.y : (meio > pos.y + 1.6 ? pos.y + 1.6 : meio);
        const dx = pos.x - e.x;
        const dy = yCorpo - meio;
        const dz = pos.z - e.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < RAIO_PUXAR * RAIO_PUXAR && (!this._podePegar || this._podePegar(e.item))) {
          if (d2 < RAIO_PEGAR * RAIO_PEGAR) {
            if (e.espera <= 0 && this._aoPegar) {
              e.espera = ESPERA_PEDIDO;
              this._aoPegar(e);
              if (!this.porId.has(e.id)) continue; // foi pego na hora (sozinho/anfitrião)
            }
          }
          if (e.puxar) {
            // Puxa na direção do jogador (mais forte quanto mais perto)
            const d = Math.sqrt(d2) || 1;
            const forca = FORCA_PUXAR * (1.2 - d / RAIO_PUXAR) * dt / d;
            e.vx += dx * forca;
            e.vy += (dy + 0.3) * forca;
            e.vz += dz * forca;
            puxando = true;
          }
        }
      }

      for (let k = 0; k < passos; k++) this._fisica(e, PASSO_FISICA, puxando);

      // Caiu no vazio (não deveria acontecer: a rocha-matriz não quebra)
      if (e.y < CONFIG.Y_ABISMO) {
        if (this.autoridade) {
          this._sumir(e.id);
          continue;
        }
        e.y = CONFIG.Y_ABISMO;
        e.vx = e.vy = e.vz = 0;
      }

      // ----- Desenho: flutua e gira -----
      // O sprite sempre olha para a câmera; para parecer que gira em pé,
      // "achatamos" a largura com o cosseno (como uma moeda girando).
      const s = e.sprite;
      s.visible = true;
      const t = this._tempo + e.fase;
      s.position.set(e.x, e.y + TAMANHO * 0.5 + 0.04 + Math.sin(t * 2.5) * 0.05, e.z);
      const giro = Math.abs(Math.cos(t * 1.6));
      s.scale.x = TAMANHO * (giro < 0.12 ? 0.12 : giro);
    }
  }

  /** Remove o item e avisa a rede (só quem tem a autoridade chama) */
  _sumir(id) {
    this.remover(id);
    if (this.aoSumir) this.aoSumir(id);
  }

  /** Bloco sólido na posição? */
  _solido(x, y, z) {
    return SOLIDO[this.mundo.obterBloco(x, y, z)] === 1;
  }

  /** Gravidade, água, atrito e colisão com os blocos (eixo por eixo) */
  _fisica(e, dt, puxando) {
    // Preso dentro de um bloco (alguém colocou um bloco em cima): sobe 1
    if (this._solido(e.x, e.y + 0.05, e.z)) {
      e.y = Math.floor(e.y + 0.05) + 1;
      e.vy = 0;
    }

    const naAgua = LIQUIDO[this.mundo.obterBloco(e.x, e.y + 0.1, e.z)] === 1;
    if (naAgua) {
      // Boia: vai até uma velocidade de subida pequena, com bastante freio
      e.vy += (SUBIR_AGUA - e.vy) * Math.min(1, 3 * dt);
      const freio = Math.max(0, 1 - ARRASTO_AGUA * dt);
      e.vx *= freio;
      e.vz *= freio;
    } else {
      e.vy -= GRAVIDADE * (puxando ? 0.4 : 1) * dt;
      const freio = Math.max(0, 1 - (e.noChao && !puxando ? ATRITO_CHAO : ARRASTO_AR) * dt);
      e.vx *= freio;
      e.vz *= freio;
    }
    e.vx = limitar(e.vx);
    e.vy = limitar(e.vy);
    e.vz = limitar(e.vz);

    // Quase parado no chão: nem calcula o movimento (só confere se o chão continua lá)
    if (e.noChao && Math.abs(e.vx) < 0.01 && Math.abs(e.vz) < 0.01 && e.vy <= 0) {
      e.vx = e.vz = 0;
      if (this._solido(e.x, e.y - 0.05, e.z)) {
        e.vy = 0;
        return;
      }
      e.noChao = false; // o bloco de baixo sumiu: volta a cair
    }

    // Subpassos: um item rápido não atravessa um bloco
    const ddx = e.vx * dt, ddy = e.vy * dt, ddz = e.vz * dt;
    const maior = Math.max(Math.abs(ddx), Math.abs(ddy), Math.abs(ddz));
    const n = maior > PASSO_MAX ? Math.ceil(maior / PASSO_MAX) : 1;
    e.noChao = false;
    for (let k = 0; k < n; k++) {
      // Y
      const ny = e.y + ddy / n;
      if (ddy < 0 && this._solido(e.x, ny, e.z)) {
        e.y = Math.floor(ny) + 1; // pousa em cima do bloco
        e.vy = 0;
        e.noChao = true;
      } else if (ddy > 0 && this._solido(e.x, ny + ALTURA_CAIXA, e.z)) {
        e.vy = 0;                 // bateu a "cabeça"
      } else {
        e.y = ny;
      }
      // X
      if (ddx !== 0) {
        const nx = e.x + ddx / n;
        if (this._solido(nx + (ddx > 0 ? RAIO : -RAIO), e.y + 0.05, e.z)) e.vx = 0;
        else e.x = nx;
      }
      // Z
      if (ddz !== 0) {
        const nz = e.z + ddz / n;
        if (this._solido(e.x, e.y + 0.05, nz + (ddz > 0 ? RAIO : -RAIO))) e.vz = 0;
        else e.z = nz;
      }
    }
  }

  // ------------------------------------------------------------------
  // Salvar e carregar (e mandar para quem entra na sala)
  // ------------------------------------------------------------------

  /** [{ id, item, qtd, pos: [x, y, z], idade }] */
  exportar() {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return this.itens.map((e) => ({
      id: e.id,
      item: e.item,
      qtd: e.qtd,
      pos: [r3(e.x), r3(e.y), r3(e.z)],
      idade: Math.round(e.idade),
    }));
  }

  /** Troca os itens pelos da lista (formato de exportar). Ignora o que for inválido. */
  carregar(lista) {
    this.limpar();
    if (!Array.isArray(lista)) return;
    for (const d of lista) {
      if (!d || typeof d !== 'object' || !Array.isArray(d.pos) || d.pos.length !== 3) continue;
      if (!Number.isInteger(d.id) || d.id < 0) continue;
      const e = this.criar(d.id, d.item, d.qtd, d.pos[0], d.pos[1], d.pos[2]);
      if (!e) continue;
      e.atraso = 0;
      if (numeroOk(d.idade) && d.idade > 0) e.idade = Math.min(d.idade, VIDA);
    }
  }

  /** Remove tudo da cena e libera a memória da placa de vídeo */
  destruir() {
    this.limpar();
    for (const m of this._materiais.values()) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    this._materiais.clear();
    this._listaMateriais.length = 0;
    this._reserva.length = 0;
    if (this.grupo.parent) this.grupo.parent.remove(this.grupo);
  }
}

/** Limita a velocidade (um número estranho não manda o item para longe) */
function limitar(v) {
  return v > VEL_MAX ? VEL_MAX : (v < -VEL_MAX ? -VEL_MAX : v);
}
