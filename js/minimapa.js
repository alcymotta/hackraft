// =====================================================================
// Hackraft - Minimapa
// ---------------------------------------------------------------------
// Um quadradinho no canto superior direito com o mapa visto de cima,
// ao redor do jogador (norte = -Z fica sempre para cima).
//
// Como usar (no main.js):
//   const minimapa = new Minimapa({ mundo, jogador, remotos, rede, mobs });
//   ... e a cada quadro:  minimapa.atualizar(dt);
// A tecla N liga e desliga (o estado fica salvo no localStorage
// 'hackraft-minimapa'). `minimapa.alternar()` e `minimapa.visivel` também existem.
//
// Como funciona: para cada coluna (x, z) do mapa procuramos o bloco mais alto
// e guardamos a cor num cache. O cache é um "anel" 128x128 indexado por
// (x & 127, z & 127): quando o jogador anda, as colunas novas entram e as
// velhas são sobrescritas sozinhas. Só algumas colunas são calculadas por
// atualização (ORCAMENTO), para o desenho nunca pesar.
// =====================================================================

import { B, BLOCOS } from './blocks.js';
import { CONFIG } from './config.js';

// ---- Números ajustáveis do minimapa ----
const TAMANHO = 160;          // lado do desenho em pixels da tela
const RAIO = 48;              // blocos mostrados para cada lado
const LADO = RAIO * 2;        // 96 pixels do mapa (1 pixel por bloco)
const ANEL = 128;             // lado do cache (potência de 2, maior que LADO)
const INTERVALO = 0.25;       // segundos entre redesenhos (~4 por segundo)
const ORCAMENTO = 2500;       // colunas novas calculadas por redesenho
const VALIDADE_MIN = 40;      // redesenhos até uma coluna ser recalculada (blocos mudam)
const ESPALHA = 30;           // variação da validade (para não recalcular tudo junto)
const SUBIDA_BUSCA = 10;      // quantos blocos acima do topo procurar (folhas, água)
const CHAVE_SALVA = 'hackraft-minimapa';

// Cor (R, G, B) de cada bloco no mapa; o que não está aqui fica cinza
const COR_PADRAO = [140, 140, 140];
const CORES = [];
CORES[B.GRAMA] = [88, 152, 62];
CORES[B.TERRA] = [121, 85, 56];
CORES[B.PEDRA] = [126, 126, 128];
CORES[B.AREIA] = [219, 206, 150];
CORES[B.AGUA] = [48, 92, 205];
CORES[B.TRONCO] = [92, 66, 40];
CORES[B.FOLHAS] = [36, 96, 40];
CORES[B.ROCHA_MATRIZ] = [48, 48, 58];
CORES[B.GELO] = [165, 212, 240];
CORES[B.TABUAS] = [175, 135, 85];
CORES[B.TIJOLOS] = [150, 72, 62];
CORES[B.VIDRO] = [190, 222, 232];
CORES[B.PRESENTE] = [220, 60, 90];

const ESCURO = (255 << 24) | (22 << 16) | (18 << 8) | 16; // coluna ainda não carregada
const ESCALA = TAMANHO / LADO;

export class Minimapa {
  constructor({ mundo, jogador, remotos = null, rede = null, mobs = null }) {
    this.mundo = mundo;
    this.jogador = jogador;
    this.remotos = remotos;
    this.rede = rede;
    this.mobs = mobs;

    // Cache em anel: chave (x, z), cor (R,G,B), altura e "idade" de cada coluna
    this._chaveX = new Int32Array(ANEL * ANEL).fill(0x7fffffff);
    this._chaveZ = new Int32Array(ANEL * ANEL);
    this._cor = new Uint8Array(ANEL * ANEL * 3);
    this._alt = new Int16Array(ANEL * ANEL);
    this._validade = new Int32Array(ANEL * ANEL); // número do redesenho em que expira
    this._n = 0;                                  // contador de redesenhos
    this._tempo = 0;

    // Imagem do mapa (1 pixel por bloco), ampliada ao desenhar
    this._mapa = document.createElement('canvas');
    this._mapa.width = this._mapa.height = LADO;
    this._mapaCtx = this._mapa.getContext('2d');
    this._imagem = this._mapaCtx.createImageData(LADO, LADO);
    this._pixels = new Uint32Array(this._imagem.data.buffer);

    this._visivel = false;
    this._topoAtual = -1;
    this._criarDom();

    let salvo = '1';
    try { salvo = localStorage.getItem(CHAVE_SALVA) ?? '1'; } catch (e) { /* sem localStorage */ }
    this._definirVisivel(salvo !== '0');

    // Tecla N: liga e desliga (não vale em menus nem digitando)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyN' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      const alvo = e.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
      if (!this.jogador.ativo) return; // menu aberto, morto ou mouse solto
      this.alternar();
    });
  }

  get visivel() { return this._visivel; }

  alternar() {
    this._definirVisivel(!this._visivel);
    try { localStorage.setItem(CHAVE_SALVA, this._visivel ? '1' : '0'); } catch (e) { /* ignora */ }
    if (this._visivel) this._tempo = INTERVALO; // redesenha já
  }

  _definirVisivel(v) {
    this._visivel = !!v;
    this._canvas.style.display = this._visivel ? 'block' : 'none';
  }

  // ------------------------------------------------------------------
  // DOM e CSS (próprios deste módulo)
  // ------------------------------------------------------------------
  _criarDom() {
    const estilo = document.createElement('style');
    estilo.textContent = `
      #minimapa {
        position: fixed; right: 10px; top: 60px; width: ${TAMANHO}px; height: ${TAMANHO}px;
        border: 3px solid #000; box-shadow: inset 0 0 0 2px #8a8a8a, 0 0 0 2px #5a5a5a;
        background: #161210; image-rendering: pixelated;
        pointer-events: none; z-index: 6;
      }`;
    document.head.appendChild(estilo);
    const c = document.createElement('canvas');
    c.id = 'minimapa';
    c.width = c.height = TAMANHO;
    document.body.appendChild(c);
    this._canvas = c;
    this._ctx = c.getContext('2d');
    this._ctx.imageSmoothingEnabled = false;
  }

  /** Fica abaixo do selo da sala e do HUD de poderes (que cresce quando há poderes) */
  _ajustarTopo() {
    const hud = document.getElementById('hud-poderes');
    let topo = 60;
    if (hud && hud.childElementCount > 0) topo = Math.max(topo, Math.ceil(hud.getBoundingClientRect().bottom) + 12);
    if (topo !== this._topoAtual) {
      this._topoAtual = topo;
      this._canvas.style.top = topo + 'px';
    }
  }

  // ------------------------------------------------------------------
  // Cache das colunas
  // ------------------------------------------------------------------

  /** Calcula e guarda a cor da coluna (x, z). Devolve false se o chunk ainda não está pronto. */
  _calcularColuna(x, z, idx) {
    const mundo = this.mundo;
    if (!mundo.estaPronto(x, z)) return false;
    const topo = mundo.topoColuna(x, z);
    let y = Math.min(CONFIG.ALTURA_MUNDO - 1, topo + SUBIDA_BUSCA);
    const fim = Math.max(0, topo - 2);
    let id = B.PEDRA;
    for (; y >= fim; y--) {
      const b = mundo.obterBloco(x, y, z);
      if (b === B.AR) continue;
      const def = BLOCOS[b];
      // Tocha, porta e afins não aparecem de cima: continua descendo
      if (def && def.modelo !== 'cubo' && !def.liquido) continue;
      id = b;
      break;
    }
    const cor = CORES[id] || COR_PADRAO;
    const k = idx * 3;
    this._cor[k] = cor[0]; this._cor[k + 1] = cor[1]; this._cor[k + 2] = cor[2];
    this._alt[idx] = y;
    this._chaveX[idx] = x;
    this._chaveZ[idx] = z;
    this._validade[idx] = this._n + VALIDADE_MIN + ((x * 7 + z * 13) & 0x7fffffff) % ESPALHA;
    return true;
  }

  // ------------------------------------------------------------------
  // Quadro
  // ------------------------------------------------------------------
  atualizar(dt) {
    if (!this._visivel) return;
    this._tempo += dt;
    if (this._tempo < INTERVALO) return;
    this._tempo = 0;
    this._n++;
    this._ajustarTopo();
    this._desenhar();
  }

  _desenhar() {
    const p = this.jogador.posicao;
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    const x0 = cx - RAIO;
    const z0 = cz - RAIO;
    const pixels = this._pixels;
    const cor = this._cor;
    const alt = this._alt;
    const chaveX = this._chaveX;
    const chaveZ = this._chaveZ;
    let orcamento = ORCAMENTO;

    // 1) Pinta o mapa: pixel (i, j) é o bloco (x0 + i, z0 + j)
    for (let j = 0; j < LADO; j++) {
      const z = z0 + j;
      for (let i = 0; i < LADO; i++) {
        const x = x0 + i;
        const idx = (x & (ANEL - 1)) + (z & (ANEL - 1)) * ANEL;
        const tem = chaveX[idx] === x && chaveZ[idx] === z;
        if (!tem || (this._validade[idx] <= this._n && orcamento > 0)) {
          if (orcamento > 0) {
            orcamento--;
            if (!this._calcularColuna(x, z, idx) && !tem) { pixels[i + j * LADO] = ESCURO; continue; }
          } else {
            pixels[i + j * LADO] = ESCURO;
            continue;
          }
        }
        // Sombra pela altura: mais alto que o vizinho do norte/oeste = claro; mais baixo = escuro
        const idxN = (x & (ANEL - 1)) + ((z - 1) & (ANEL - 1)) * ANEL;
        const idxO = ((x - 1) & (ANEL - 1)) + (z & (ANEL - 1)) * ANEL;
        const a = alt[idx];
        let dif = 0;
        if (chaveX[idxN] === x && chaveZ[idxN] === z - 1) dif += a - alt[idxN];
        if (chaveX[idxO] === x - 1 && chaveZ[idxO] === z) dif += a - alt[idxO];
        let sombra = 1 + dif * 0.07 + (a - 64) * 0.004;
        if (sombra < 0.6) sombra = 0.6; else if (sombra > 1.3) sombra = 1.3;
        const k = idx * 3;
        let r = cor[k] * sombra, g = cor[k + 1] * sombra, b = cor[k + 2] * sombra;
        if (r > 255) r = 255;
        if (g > 255) g = 255;
        if (b > 255) b = 255;
        pixels[i + j * LADO] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }
    this._mapaCtx.putImageData(this._imagem, 0, 0);

    // 2) Amplia o mapa no canvas, deslocado pela parte fracionária (você fica no centro exato)
    const ctx = this._ctx;
    const fx = (p.x - cx - 0.5) * ESCALA;
    const fz = (p.z - cz - 0.5) * ESCALA;
    ctx.fillStyle = '#161210';
    ctx.fillRect(0, 0, TAMANHO, TAMANHO);
    ctx.drawImage(this._mapa, -fx, -fz, TAMANHO, TAMANHO);

    // 3) Marcadores
    this._desenharMarcadores(ctx, p.x, p.z);

    // 4) Seta do jogador no centro (gira com o yaw: yaw 0 olha para -Z = para cima)
    const c = TAMANHO / 2;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-this.jogador.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.restore();

    // 5) O "N" do norte
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText('N', c, 2);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText('N', c, 2);
  }

  /** Converte uma posição do mundo em pixel do canvas; devolve true se estava dentro da borda */
  _ponto(wx, wz, px, pz) {
    // saída em this._sx / this._sy
    let sx = TAMANHO / 2 + (wx - px) * ESCALA;
    let sy = TAMANHO / 2 + (wz - pz) * ESCALA;
    const margem = 6;
    let dentro = true;
    if (sx < margem) { sx = margem; dentro = false; } else if (sx > TAMANHO - margem) { sx = TAMANHO - margem; dentro = false; }
    if (sy < margem) { sy = margem; dentro = false; } else if (sy > TAMANHO - margem) { sy = TAMANHO - margem; dentro = false; }
    this._sx = sx;
    this._sy = sy;
    return dentro;
  }

  _desenharMarcadores(ctx, px, pz) {
    // Casa: casinha (fica presa na borda quando está longe)
    const casa = this.rede ? this.rede.casa : null;
    if (casa && casa.length === 3) {
      this._ponto(casa[0] + 0.5, casa[2] + 0.5, px, pz);
      const x = this._sx, y = this._sy;
      ctx.fillStyle = '#e8d070';
      ctx.fillRect(x - 4, y - 1, 8, 6);
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 1);
      ctx.lineTo(x, y - 7);
      ctx.lineTo(x + 6, y - 1);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000';
      ctx.strokeRect(x - 3.5, y - 0.5, 7, 5);
    }

    // Mobs hostis: pontinhos vermelhos (só os que estão dentro do mapa)
    const mobs = this.mobs;
    if (mobs && mobs.lista) {
      ctx.fillStyle = '#ff2a2a';
      const lista = mobs.lista;
      for (let i = 0; i < lista.length; i++) {
        const m = lista[i];
        if (!m.def || !m.def.hostil || m.morrendo || m.descartar) continue;
        if (!this._ponto(m.x, m.z, px, pz)) continue;
        const t = m.def.chefao ? 5 : 3;
        ctx.fillRect(this._sx - t / 2, this._sy - t / 2, t, t);
      }
    }

    // Outros jogadores: ponto com a cor da camisa e o apelido perto da borda
    const remotos = this.remotos && this.remotos.remotos;
    if (remotos) {
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const r of remotos.values()) {
        if (!r.recebeu) continue;
        const pos = r.personagem.grupo.position;
        const dentro = this._ponto(pos.x, pos.z, px, pz);
        const x = this._sx, y = this._sy;
        const camisa = (r.personagem.cores && r.personagem.cores.camisa) || '#4a90e2';
        ctx.beginPath();
        ctx.arc(x, y, dentro ? 4 : 3, 0, 6.2832);
        ctx.fillStyle = camisa;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        // Apelido: sempre que está perto da borda (ou fora do mapa, preso na borda)
        const perto = !dentro || x < 36 || x > TAMANHO - 36 || y < 20 || y > TAMANHO - 20;
        if (perto) {
          const tx = Math.max(24, Math.min(TAMANHO - 24, x));
          const ty = Math.max(20, y - 5);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#000';
          ctx.strokeText(r.apelido, tx, ty);
          ctx.fillStyle = '#fff';
          ctx.fillText(r.apelido, tx, ty);
        }
      }
    }
  }
}
