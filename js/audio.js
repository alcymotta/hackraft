// =====================================================================
// Hackraft - Sons
// ---------------------------------------------------------------------
// Se existir um arquivo em assets/sounds/sons.json, ele manda: cada
// evento ("passo_grama", "quebrar_pedra"...) aponta para uma lista de
// arquivos. O que faltar é sintetizado com WebAudio (ruído filtrado).
// =====================================================================

const CHAVE = 'hackraft-som';

// Características de cada tipo de superfície
//  freq: frequência central do filtro; q: "fechamento" do filtro
const TIPOS = {
  grama:  { freq: 1200, q: 0.8 },
  terra:  { freq: 800,  q: 0.7 },
  pedra:  { freq: 2500, q: 1.2 },
  areia:  { freq: 3500, q: 0.6 },
  madeira:{ freq: 500,  q: 2.5, toc: 170 },
  folhas: { freq: 4000, q: 0.5 },
  agua:   { freq: 700,  q: 1.5, bolha: true },
};

// Duração (s) e força de cada ação
const ACOES = {
  passo:   { dur: 0.09, forca: 0.35 },
  quebrar: { dur: 0.28, forca: 0.9 },
  colocar: { dur: 0.12, forca: 0.6 },
  golpe:   { dur: 0.04, forca: 0.4 },
};

class Som {
  constructor() {
    this.ctx = null;
    this.mestre = null;
    this.ruido = null;       // buffer de ruído branco reaproveitado
    this.buffers = new Map(); // evento -> [AudioBuffer, ...]
    this.volume = 0.7;
    this.mudo = false;
    this._lerSalvo();
  }

  _lerSalvo() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (d) {
        if (typeof d.volume === 'number') this.volume = Math.min(1, Math.max(0, d.volume));
        this.mudo = !!d.mudo;
      }
    } catch (e) { /* sem localStorage: tudo bem */ }
  }

  _salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ volume: this.volume, mudo: this.mudo }));
    } catch (e) { /* ignora */ }
  }

  _aplicarGanho() {
    if (this.mestre) this.mestre.gain.value = this.mudo ? 0 : this.volume;
  }

  /** Cria (ou retoma) o AudioContext. Chame depois de um clique. */
  async iniciar() {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.mestre = this.ctx.createGain();
      this.mestre.connect(this.ctx.destination);
      this._aplicarGanho();
      // 1 segundo de ruído branco
      const n = this.ctx.sampleRate;
      this.ruido = this.ctx.createBuffer(1, n, n);
      const dados = this.ruido.getChannelData(0);
      for (let i = 0; i < n; i++) dados[i] = Math.random() * 2 - 1;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      await this._carregarArquivos();
    } catch (e) {
      console.warn('Som: não foi possível iniciar o áudio', e);
    }
  }

  // Lê sons.json e decodifica os arquivos listados
  async _carregarArquivos() {
    try {
      const resp = await fetch('assets/sounds/sons.json');
      if (!resp.ok) return;
      const mapa = await resp.json();
      for (const [evento, lista] of Object.entries(mapa)) {
        if (evento.startsWith('_') || !Array.isArray(lista)) continue;
        const bufs = [];
        for (const arq of lista) {
          try {
            const r = await fetch('assets/sounds/' + arq);
            if (!r.ok) continue;
            bufs.push(await this.ctx.decodeAudioData(await r.arrayBuffer()));
          } catch (e) { /* arquivo ruim: pula */ }
        }
        if (bufs.length) this.buffers.set(evento, bufs);
      }
    } catch (e) { /* sem sons.json: usa os sintetizados */ }
  }

  // Toca um evento: arquivo se existir, senão sintetiza
  _tocar(acao, tipo) {
    if (!this.ctx || this.mudo || this.volume <= 0) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    const evento = acao + '_' + tipo;
    const bufs = this.buffers.get(evento);
    if (bufs) {
      const src = this.ctx.createBufferSource();
      src.buffer = bufs[(Math.random() * bufs.length) | 0];
      src.playbackRate.value = 0.95 + Math.random() * 0.1;
      src.connect(this.mestre);
      src.start();
      return;
    }
    this._sintetizar(acao, TIPOS[tipo] ? tipo : 'pedra');
  }

  _sintetizar(acao, tipo) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const t = TIPOS[tipo];
    const a = ACOES[acao];
    const variacao = 0.85 + Math.random() * 0.3; // muda o tom a cada toque
    const dur = a.dur;
    const forca = a.forca;
    // "colocar" é um tum mais grave; "golpe" um tique mais agudo
    let freq = t.freq * variacao;
    if (acao === 'colocar') freq *= 0.6;
    if (acao === 'golpe') freq *= 1.4;

    // Ruído filtrado com envelope curto
    const src = ctx.createBufferSource();
    src.buffer = this.ruido;
    src.loop = true;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = freq;
    filtro.Q.value = t.q;
    const g = ctx.createGain();
    // areia chia mais devagar; os outros atacam rápido
    const ataque = tipo === 'areia' ? 0.02 : 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(forca, t0 + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filtro).connect(g).connect(this.mestre);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);

    // Madeira: "toc" grave com ressonância
    if (t.toc) this._tom(t0, t.toc * variacao * (acao === 'colocar' ? 0.8 : 1), dur, forca * 0.7);
    // Colocar: um "tum" grave para todos
    if (acao === 'colocar' && !t.toc) this._tom(t0, 110 * variacao, dur, forca * 0.5);
    // Quebrar: um pouco de corpo grave
    if (acao === 'quebrar') this._tom(t0, 90 * variacao, dur, forca * 0.3);
    // Água: bolha subindo de tom
    if (t.bolha) {
      const f0 = 300 * variacao;
      this._tom(t0, f0, dur * 1.2, forca * 0.5, f0 * 2.2);
    }
  }

  // Um tom simples que cai (ou sobe, se `ate` existir) rapidamente
  _tom(t0, freq, dur, forca, ate) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(ate || freq * 0.6, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(forca, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.mestre);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  passo(tipo)   { this._tocar('passo', tipo); }
  quebrar(tipo) { this._tocar('quebrar', tipo); }
  colocar(tipo) { this._tocar('colocar', tipo); }
  golpe(tipo)   { this._tocar('golpe', tipo); }

  definirVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0));
    this._aplicarGanho();
    this._salvar();
  }

  alternarMudo() {
    this.mudo = !this.mudo;
    this._aplicarGanho();
    this._salvar();
    return this.mudo;
  }
}

export const som = new Som();
