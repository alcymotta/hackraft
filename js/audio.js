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

// =====================================================================
// Música de fundo gerada 100% com WebAudio (sem arquivos)
// ---------------------------------------------------------------------
// Dois "climas": dia (calmo, Dó maior pentatônico) e noite (Lá menor,
// mais grave, com drone). Cada clima tem o seu próprio canal de volume
// (barramento), e a troca de clima é um crossfade de alguns segundos.
// Caminho do som: barramento do clima -> volume da música -> ganho geral.
// As notas são agendadas pelo relógio do AudioContext (um pouco à frente).
// =====================================================================

const MUSICA = {
  BPM: 70,
  CROSSFADE: 6,          // segundos para trocar entre dia e noite
  VOLUME_PADRAO: 0.35,
  MAX_VOZES: 12,         // limite de notas soltas ao mesmo tempo
  ANTECEDENCIA: 0.2,     // quanto à frente agendamos (s)
  INTERVALO: 50,         // de quanto em quanto tempo o agendador roda (ms)
  BATIDAS_ACORDE: 8,     // duração de cada acorde, em batidas
};

// Converte nota MIDI (69 = Lá 440 Hz) em frequência
const midiParaHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const sortear = (lista) => lista[(Math.random() * lista.length) | 0];

// Escalas (semitons a partir da base) e acordes (notas MIDI)
const DIA = {
  base: 60, // Dó central
  escala: [0, 2, 4, 7, 9],              // pentatônica maior
  acordes: [[48, 55, 64], [45, 52, 60], [43, 50, 57], [48, 55, 62]],
};
const NOITE = {
  base: 45, // Lá grave
  escala: [0, 3, 5, 7, 10],             // pentatônica menor
  acordes: [[33, 40, 45], [38, 45, 50], [40, 47, 52], [36, 43, 48]],
};

// Clima do chefão: mais rápido, baixo em Lá menor e acordes dissonantes
const CHEFAO = {
  BPM: 120,
  baixo: 33, // Lá bem grave
  acordes: [[45, 51, 57], [44, 50, 56], [45, 52, 58], [43, 49, 55]], // clusters tensos
};

class Musica {
  constructor(som) {
    this.som = som;
    this.volume = MUSICA.VOLUME_PADRAO;
    this.ligada = true;
    this.clima = 'dia';
    this._pronta = false;      // grafo de áudio criado?
    this._timer = null;
    this._vozes = 0;
    this._proximo = 0;         // instante (relógio do ctx) do próximo passo
    this._passo = 0;
    this._fadeAte = 0;         // enquanto agora < isso, os dois climas tocam
    this._drone = null;
    this._anterior = 'dia';    // clima de antes (toca junto durante o crossfade)
  }

  // Chamado pelo Som ao ler as preferências salvas
  _aplicarSalvo(d) {
    if (!d) return;
    if (typeof d.volume === 'number') this.volume = Math.min(1, Math.max(0, d.volume));
    if (typeof d.ligada === 'boolean') this.ligada = d.ligada;
  }

  /** Começa a tocar (se estiver ligada). Precisa de som.iniciar() antes. */
  iniciar() {
    if (!this.som.ctx) return;
    try {
      if (!this._pronta) this._montar();
      if (this.ligada) this._comecar();
    } catch (e) {
      console.warn('Música: não foi possível iniciar', e);
    }
  }

  // Cria os ganhos e o reverb (uma vez só)
  _montar() {
    const ctx = this.som.ctx;
    this._saida = ctx.createGain();
    this._saida.gain.value = 0;
    this._saida.connect(this.som.mestre);

    // Reverb simples: ruído estéreo que decai, 2.8 s
    const taxa = ctx.sampleRate;
    const tam = Math.floor(taxa * 2.8);
    const imp = ctx.createBuffer(2, tam, taxa);
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c);
      for (let i = 0; i < tam; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / tam, 2.5);
      }
    }
    this._reverb = ctx.createConvolver();
    this._reverb.buffer = imp;
    const retorno = ctx.createGain();
    retorno.gain.value = 0.5;
    this._reverb.connect(retorno).connect(this._saida);

    // Um barramento por clima (som direto) e um "envio" por clima (para o reverb)
    this._barDia = ctx.createGain();
    this._barNoite = ctx.createGain();
    this._barChefao = ctx.createGain();
    this._envioChefao = ctx.createGain();
    this._barChefao.connect(this._saida);
    this._envioChefao.connect(this._reverb);
    this._envioDia = ctx.createGain();
    this._envioNoite = ctx.createGain();
    this._barDia.connect(this._saida);
    this._barNoite.connect(this._saida);
    this._envioDia.connect(this._reverb);
    this._envioNoite.connect(this._reverb);
    this._ajustarClima(false);
    this._pronta = true;
  }

  // Põe os ganhos dos climas no valor certo (com ou sem crossfade)
  _ajustarClima(suave) {
    const t = this.som.ctx.currentTime;
    const c = this.clima;
    const dia = c === 'dia' ? 1 : 0;
    const noite = c === 'noite' ? 1 : 0;
    const chefao = c === 'chefao' ? 1 : 0;
    const alvos = [[this._barDia, dia], [this._barNoite, noite], [this._barChefao, chefao],
                   [this._envioDia, dia], [this._envioNoite, noite], [this._envioChefao, chefao]];
    for (const [no, v] of alvos) {
      no.gain.cancelScheduledValues(t);
      no.gain.setValueAtTime(no.gain.value, t);
      if (suave) no.gain.linearRampToValueAtTime(v, t + MUSICA.CROSSFADE);
      else no.gain.setValueAtTime(v, t);
    }
    if (suave) this._fadeAte = t + MUSICA.CROSSFADE + 1;
  }

  _comecar() {
    if (this._timer) return;
    const t = this.som.ctx.currentTime;
    this._saida.gain.cancelScheduledValues(t);
    this._saida.gain.setValueAtTime(this._saida.gain.value, t);
    this._saida.gain.linearRampToValueAtTime(this.volume, t + 1.5);
    this._proximo = t + 0.3;
    this._passo = 0;
    this._criarDrone();
    this._timer = setInterval(() => this._agendar(), MUSICA.INTERVALO);
  }

  _parar() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!this._pronta) return;
    const t = this.som.ctx.currentTime;
    this._saida.gain.cancelScheduledValues(t);
    this._saida.gain.setValueAtTime(this._saida.gain.value, t);
    this._saida.gain.linearRampToValueAtTime(0, t + 0.6);
    this._pararDrone(t + 0.7);
  }

  // Drone grave contínuo (só se ouve quando o barramento da noite sobe)
  _criarDrone() {
    if (this._drone) return;
    const ctx = this.som.ctx;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 220;
    filtro.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    // LFO lento abrindo e fechando o filtro
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGanho = ctx.createGain();
    lfoGanho.gain.value = 90;
    lfo.connect(lfoGanho).connect(filtro.frequency);
    const oscs = [];
    for (const [tipo, hz, det] of [['sine', 55, 0], ['triangle', 82.4, 6], ['sine', 54.6, -4]]) {
      const o = ctx.createOscillator();
      o.type = tipo;
      o.frequency.value = hz;
      o.detune.value = det;
      o.connect(filtro);
      o.start();
      oscs.push(o);
    }
    lfo.start();
    filtro.connect(g).connect(this._barNoite);
    this._drone = { oscs, lfo };
  }

  _pararDrone(quando) {
    if (!this._drone) return;
    const d = this._drone;
    this._drone = null;
    for (const o of d.oscs) o.stop(quando);
    d.lfo.stop(quando);
  }

  // Roda a cada ~50 ms: agenda os passos que caem nos próximos 0.2 s
  _agendar() {
    const ctx = this.som.ctx;
    if (!ctx || document.hidden || ctx.state !== 'running') {
      // Pausado: ao voltar, recomeça do "agora" em vez de tocar tudo atrasado
      if (ctx) this._proximo = Math.max(this._proximo, ctx.currentTime + 0.1);
      return;
    }
    const agora = ctx.currentTime;
    if (this._proximo < agora) this._proximo = agora + 0.05;
    // colcheia (o chefão é bem mais rápido)
    const passoDur = 60 / (this.clima === 'chefao' ? CHEFAO.BPM : MUSICA.BPM) / 2;
    while (this._proximo < agora + MUSICA.ANTECEDENCIA) {
      // durante o crossfade toca o clima novo e o anterior
      const fading = agora < this._fadeAte;
      const a = this._anterior;
      const c = this.clima;
      if (c === 'dia' || (fading && a === 'dia')) this._passoDia(this._proximo, passoDur);
      if (c === 'noite' || (fading && a === 'noite')) this._passoNoite(this._proximo, passoDur);
      if (c === 'chefao' || (fading && a === 'chefao')) this._passoChefao(this._proximo, passoDur);
      this._proximo += passoDur;
      this._passo++;
    }
  }

  // ---------- DIA ----------
  _passoDia(t, passoDur) {
    const porAcorde = MUSICA.BATIDAS_ACORDE * 2;
    if (this._passo % porAcorde === 0) {
      const i = (this._passo / porAcorde) % DIA.acordes.length;
      this._pad(DIA.acordes[i], t, this._barDia, 0.05);
      // às vezes uma melodia curta de 4 a 6 notas, começando um pouco depois
      if (Math.random() < 0.55) {
        this._melodia(DIA, t + passoDur * 3, passoDur * 2, this._barDia, this._envioDia);
      }
    }
    // arpejo esparso: ~65% dos passos, nota aleatória da escala
    if (Math.random() < 0.65) {
      const grau = sortear(DIA.escala) + sortear([0, 12]);
      this._nota('triangle', midiParaHz(DIA.base + grau), t, 2.2, 0.07, this._barDia, this._envioDia, 0.5);
    }
  }

  // Melodia: poucas notas numa oitava mais alta, com bastante reverb
  _melodia(clima, t, espaco, barramento, envio) {
    const n = 4 + ((Math.random() * 3) | 0); // 4 a 6 notas
    const tam = clima.escala.length;
    let grau = (Math.random() * tam) | 0;
    for (let i = 0; i < n; i++) {
      // anda para perto da nota anterior (soa mais como melodia)
      grau = Math.min(tam * 2 - 1, Math.max(0, grau + sortear([-2, -1, -1, 1, 1, 2])));
      const semitom = clima.escala[grau % tam] + Math.floor(grau / tam) * 12 + 12;
      const dur = i === n - 1 ? 3 : 1.6;
      const quando = t + i * espaco * (0.9 + Math.random() * 0.4);
      this._nota('sine', midiParaHz(clima.base + semitom), quando, dur, 0.1, barramento, envio, 1.1);
    }
  }

  // ---------- NOITE ----------
  _passoNoite(t) {
    const porAcorde = MUSICA.BATIDAS_ACORDE * 2;
    if (this._passo % porAcorde === 0) {
      const i = (this._passo / porAcorde) % NOITE.acordes.length;
      this._pad(NOITE.acordes[i], t, this._barNoite, 0.06);
    }
    // notas esparsas e graves (~25%)
    if (Math.random() < 0.25) {
      const grau = sortear(NOITE.escala) + sortear([0, 0, 12]);
      this._nota('triangle', midiParaHz(NOITE.base + grau), t, 2.8, 0.09, this._barNoite, this._envioNoite, 0.6);
    }
    // pulso lento ocasional (a cada 4 batidas, em metade das vezes)
    if (this._passo % 8 === 0 && Math.random() < 0.5) this._pulso(t);
  }

  // ---------- CHEFÃO ----------
  // Tenso: tambor grave marcado, baixo em ostinato (Lá menor) e pads dissonantes
  _passoChefao(t, passoDur) {
    const p = this._passo % 8; // um compasso = 8 colcheias
    // tambor: bumbo nos tempos fortes, mais seco nos contratempos
    if (p === 0 || p === 3 || p === 4 || p === 6) this._tambor(t, p === 0 ? 0.42 : 0.3, p === 0 ? 62 : 75);
    if (p === 2 || p === 6) this._caixa(t);
    // baixo em ostinato: Lá, Lá, Dó, Lá, Ré, Lá, Mi bemol, Mi
    const baixo = [0, 0, 3, 0, 5, 0, 6, 7];
    this._nota('sawtooth', midiParaHz(CHEFAO.baixo + baixo[p]), t, passoDur * 0.9, 0.07, this._barChefao, this._envioChefao, 0.15, 380);
    // pads dissonantes a cada 2 compassos
    if (this._passo % 16 === 0) {
      const i = (this._passo / 16) % CHEFAO.acordes.length;
      this._pad(CHEFAO.acordes[i], t, this._barChefao, 0.045, 6, 900);
    }
    // sirene curta e aguda de vez em quando
    if (this._passo % 16 === 8 && Math.random() < 0.4) {
      this._nota('triangle', midiParaHz(CHEFAO.baixo + 36 + sortear([0, 1, 6])), t, 1.2, 0.05, this._barChefao, this._envioChefao, 0.8);
    }
  }

  // Bumbo grave que cai de tom
  _tambor(t, volume, hz) {
    if (this._vozes >= MUSICA.MAX_VOZES + 4) return;
    const o = this.som.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz * 2, t);
    o.frequency.exponentialRampToValueAtTime(hz * 0.55, t + 0.2);
    const g = this.som.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this._barChefao);
    this._iniciarVoz(o, t, t + 0.4, g);
  }

  // Estalo seco de ruído (caixa)
  _caixa(t) {
    const ctx = this.som.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.som.ruido;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(f).connect(g).connect(this._barChefao);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.14);
  }

  // Batida grave e macia
  _pulso(t) {
    if (this._vozes >= MUSICA.MAX_VOZES) return;
    const ctx = this.som.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this._barNoite);
    this._iniciarVoz(o, t, t + 0.65, g);
  }

  // ---------- Peças básicas ----------

  // Liga um oscilador, conta a voz e solta tudo quando acabar
  _iniciarVoz(osc, t, fim, ...extras) {
    this._vozes++;
    osc.onended = () => {
      this._vozes--;
      osc.disconnect();
      for (const e of extras) e.disconnect();
    };
    osc.start(t);
    osc.stop(fim);
  }

  // Acorde longo e suave: sine/triangle desafinados, passa-baixas, ataque e release lentos
  _pad(notas, t, barramento, volume, duracao, corte = 700) {
    const ctx = this.som.ctx;
    const dur = duracao || (60 / MUSICA.BPM * MUSICA.BATIDAS_ACORDE + 2.5);
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = corte;
    filtro.Q.value = 0.5;
    const g = ctx.createGain();
    const ataque = Math.min(2.5, dur * 0.3), release = Math.min(3.5, dur * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + ataque);
    g.gain.setValueAtTime(volume, t + dur - release);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    filtro.connect(g).connect(barramento);
    notas.forEach((m, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = midiParaHz(m);
      o.detune.value = (Math.random() - 0.5) * 16; // levemente desafinado
      o.connect(filtro);
      // o pad não passa pelo limite de vozes (o acorde não pode ficar incompleto)
      this._iniciarVoz(o, t, t + dur + 0.05, i === notas.length - 1 ? g : filtro);
    });
  }

  // Nota simples com envelope; `parteReverb` manda um tanto para o reverb
  _nota(tipo, hz, t, dur, volume, barramento, envio, parteReverb, corte) {
    if (this._vozes >= MUSICA.MAX_VOZES) return;
    const ctx = this.som.ctx;
    const o = ctx.createOscillator();
    o.type = tipo;
    o.frequency.value = hz;
    o.detune.value = (Math.random() - 0.5) * 10;
    const g = ctx.createGain();
    // `corte` (opcional): passa-baixas para suavizar ondas ásperas (baixo do chefão)
    let ult = o;
    let lp = null;
    if (corte) {
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = corte;
      o.connect(lp);
      ult = lp;
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ult.connect(g);
    g.connect(barramento);
    const e = ctx.createGain();
    e.gain.value = parteReverb;
    g.connect(e).connect(envio);
    if (lp) this._iniciarVoz(o, t, t + dur + 0.05, lp, g, e);
    else this._iniciarVoz(o, t, t + dur + 0.05, g, e);
  }

  // ---------- API pública ----------

  /** Troca entre 'dia', 'noite' e 'chefao' com crossfade. Mesmo clima: nada. */
  definirClima(clima) {
    if (clima !== 'dia' && clima !== 'noite' && clima !== 'chefao') return;
    if (clima === this.clima) return;
    this._anterior = this.clima;
    this.clima = clima;
    if (this._pronta) this._ajustarClima(true);
  }

  definirVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (this._pronta && this.ligada) {
      const t = this.som.ctx.currentTime;
      this._saida.gain.cancelScheduledValues(t);
      this._saida.gain.setValueAtTime(this.volume, t);
    }
    this.som._salvar();
  }

  /** Liga/desliga a música. Devolve o novo estado (ligada). */
  alternar() {
    this.ligada = !this.ligada;
    if (this.ligada) this.iniciar();
    else this._parar();
    this.som._salvar();
    return this.ligada;
  }
}

class Som {
  constructor() {
    this.ctx = null;
    this.mestre = null;
    this.ruido = null;       // buffer de ruído branco reaproveitado
    this.buffers = new Map(); // evento -> [AudioBuffer, ...]
    this.volume = 0.7;
    this.mudo = false;
    this.musica = new Musica(this);
    this._lerSalvo();
  }

  _lerSalvo() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (d) {
        if (typeof d.volume === 'number') this.volume = Math.min(1, Math.max(0, d.volume));
        this.mudo = !!d.mudo;
        this.musica._aplicarSalvo(d.musica);
      }
    } catch (e) { /* sem localStorage: tudo bem */ }
  }

  _salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify({
        volume: this.volume,
        mudo: this.mudo,
        musica: { ligada: this.musica.ligada, volume: this.musica.volume },
      }));
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

  /**
   * Som de "interferência digital" (~0.8 s): ruído picotado (bitcrush),
   * chiado, notas rápidas de modem e um bip grave no final.
   */
  glitch() {
    if (!this.ctx || this.mudo || this.volume <= 0) return;
    try {
      const ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      const dur = 0.8;

      // Ruído "picotado": cada valor aleatório é segurado por vários
      // samples (imita a redução de resolução) e some em pedaços.
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let i = 0;
      while (i < n) {
        const seg = 20 + ((Math.random() * 400) | 0);    // tamanho do pedaço
        const segura = 2 + ((Math.random() * 14) | 0);   // quanto segura cada valor
        const muda = Math.random() < 0.3;                // pedaços em silêncio
        let v = 0;
        for (let k = 0; k < seg && i < n; k++, i++) {
          if (k % segura === 0) v = Math.round((Math.random() * 2 - 1) * 4) / 4;
          d[i] = muda ? 0 : v;
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const passaAlta = ctx.createBiquadFilter();
      passaAlta.type = 'highpass';
      passaAlta.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.03);
      g.gain.setValueAtTime(0.16, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(passaAlta).connect(g).connect(this.mestre);
      src.start(t0);

      // Chiado eletrônico suave por baixo
      const chiado = ctx.createBufferSource();
      chiado.buffer = this.ruido;
      chiado.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 6000;
      bp.Q.value = 0.8;
      const gc = ctx.createGain();
      gc.gain.setValueAtTime(0.0001, t0);
      gc.gain.linearRampToValueAtTime(0.05, t0 + 0.05);
      gc.gain.exponentialRampToValueAtTime(0.0001, t0 + dur - 0.1);
      chiado.connect(bp).connect(gc).connect(this.mestre);
      chiado.start(t0, Math.random() * 0.5);
      chiado.stop(t0 + dur);

      // Notas rápidas de "modem", alternando agudos
      const freqs = [1200, 2200, 1700, 2600, 1400, 2400];
      freqs.forEach((f, k) => {
        const t = t0 + 0.05 + k * 0.07;
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const go = ctx.createGain();
        go.gain.setValueAtTime(0.0001, t);
        go.gain.linearRampToValueAtTime(0.035, t + 0.005);
        go.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
        o.connect(go).connect(this.mestre);
        o.start(t);
        o.stop(t + 0.07);
      });

      // Bip final grave
      const tb = t0 + 0.55;
      const bip = ctx.createOscillator();
      bip.type = 'square';
      bip.frequency.value = 110;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const gb = ctx.createGain();
      gb.gain.setValueAtTime(0.0001, tb);
      gb.gain.linearRampToValueAtTime(0.14, tb + 0.01);
      gb.gain.setValueAtTime(0.14, tb + 0.18);
      gb.gain.exponentialRampToValueAtTime(0.0001, tb + 0.25);
      bip.connect(lp).connect(gb).connect(this.mestre);
      bip.start(tb);
      bip.stop(tb + 0.27);
    } catch (e) { /* som é enfeite: nunca derruba o jogo */ }
  }

  definirVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0));
    this._aplicarGanho();
    this._salvar();
  }

  // ----- Sons da Fase 5 (poderes e vida), todos sintetizados e curtinhos -----

  /** Pode tocar agora? (áudio ligado, sem mudo) */
  _podeTocar() {
    if (!this.ctx || this.mudo || this.volume <= 0) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  /** Tom com forma de onda, que vai de `de` Hz até `ate` Hz */
  _tomOnda(t0, onda, de, ate, dur, forca) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = onda;
    osc.frequency.setValueAtTime(de, t0);
    osc.frequency.exponentialRampToValueAtTime(ate, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(forca, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.mestre);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Ruído filtrado cuja frequência vai de `de` até `ate` */
  _ruidoVarrido(t0, tipoFiltro, de, ate, dur, forca, q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ruido;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = tipoFiltro;
    f.Q.value = q;
    f.frequency.setValueAtTime(de, t0);
    f.frequency.exponentialRampToValueAtTime(ate, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(forca, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.mestre);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  /** "Brilho" ascendente ao ativar um cristal (o `id` do poder muda um pouco o tom) */
  poder(id) {
    if (id === 'nivel') { this.nivel(); return; }
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      let base = 520;
      if (typeof id === 'string') {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 7;
        base *= Math.pow(2, h / 12);
      }
      // quatro notinhas subindo (arpejo) + um chiado agudo
      [1, 1.25, 1.5, 2].forEach((m, k) => {
        this._tomOnda(t0 + k * 0.06, 'triangle', base * m, base * m * 1.02, 0.25, 0.12);
      });
      this._ruidoVarrido(t0, 'highpass', 3000, 9000, 0.35, 0.04);
    } catch (e) { /* som é enfeite */ }
  }

  /** Som do tiro: 'fogo' (whoosh grave), 'raio' (estalo elétrico), 'gelo' (cristal agudo) */
  tiro(tipo) {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      if (tipo === 'raio') {
        this._ruidoVarrido(t0, 'highpass', 6000, 1500, 0.18, 0.2);
        this._tomOnda(t0, 'sawtooth', 1800, 90, 0.2, 0.12);
        this._tomOnda(t0 + 0.05, 'square', 900, 120, 0.12, 0.05);
      } else if (tipo === 'gelo') {
        this._tomOnda(t0, 'sine', 2400, 3600, 0.25, 0.1);
        this._tomOnda(t0 + 0.04, 'sine', 3200, 4800, 0.2, 0.06);
        this._ruidoVarrido(t0, 'highpass', 5000, 8000, 0.15, 0.05);
      } else {
        // fogo (e qualquer outro): whoosh grave que sobe e some
        this._ruidoVarrido(t0, 'lowpass', 300, 1400, 0.4, 0.25, 0.8);
        this._tomOnda(t0, 'sine', 140, 70, 0.3, 0.14);
      }
    } catch (e) { /* som é enfeite */ }
  }

  /** "Uff" curto e grave de quando o jogador leva dano */
  dano() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      this._tomOnda(t0, 'sawtooth', 190, 90, 0.18, 0.12);
      this._ruidoVarrido(t0, 'lowpass', 900, 250, 0.15, 0.18);
    } catch (e) { /* som é enfeite */ }
  }

  // ----- Sons da Fase 7 (mobs, pancada e comer), todos sintetizados -----

  /**
   * Uma "voz" de mob: oscilador com glide de `de` a `ate` Hz, filtro passa-baixas,
   * vibrato (vib = [hz, profundidade em Hz]) e envelope. `v` é o volume (0 a 1).
   */
  _vozMob(t0, o) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.onda;
    osc.frequency.setValueAtTime(o.de, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.ate), t0 + o.dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.filtro ?? 1500;
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.forca * o.v), t0 + (o.ataque ?? 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(f).connect(g).connect(this.mestre);
    let lfo = null;
    if (o.vib) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = o.vib[0];
      const lg = ctx.createGain();
      lg.gain.value = o.vib[1];
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + o.dur + 0.02);
    }
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  /** Ruído filtrado com tremolo (volume tremendo) para o chiado da aranha */
  _chiado(t0, freq, dur, forca, tremHz) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ruido;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, forca), t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    // tremolo: um oscilador lento somando ao ganho
    const trem = ctx.createOscillator();
    trem.frequency.value = tremHz;
    const tg = ctx.createGain();
    tg.gain.value = forca * 0.6;
    trem.connect(tg).connect(g.gain);
    src.connect(f).connect(g).connect(this.mestre);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
    trem.start(t0);
    trem.stop(t0 + dur + 0.02);
  }

  /**
   * Som de um mob. tipo: 'porco' | 'galinha' | 'zumbi' | 'aranha' (outros = genérico).
   * evento: 'idle' | 'dano' | 'morte'. volume (0 a 1) é opcional: mobs longe tocam baixinho.
   */
  mob(tipo, evento = 'idle', volume = 1) {
    if (!this._podeTocar()) return;
    const v = Math.min(1, Math.max(0, Number(volume) || 0));
    if (v <= 0.01) return;
    try {
      const t0 = this.ctx.currentTime;
      const r = 0.92 + Math.random() * 0.16; // variação de tom a cada vez
      // tipos novos (Fases 8 e 11) têm vozes próprias
      if (this._mobNovo(tipo, evento, v, t0, r)) return;
      // dano: mais agudo e curto; morte: mais longo e caindo; ataque: o idle mais agudo
      const dano = evento === 'dano';
      const morte = evento === 'morte';
      const tomM = dano ? 1.3 : evento === 'ataque' ? 1.4 : 1;
      const durM = dano ? 0.65 : morte ? 1.8 : 1;
      const quedaM = morte ? 0.5 : 1;

      if (tipo === 'porco') {
        // "oinc": dente-de-serra com filtro; sobe um pouco e cai
        const d = 0.22 * durM;
        this._vozMob(t0, { onda: 'sawtooth', de: 200 * r * tomM, ate: 120 * r * tomM * quedaM, dur: d, forca: 0.22, filtro: 700, q: 3, v });
        this._vozMob(t0 + d * 0.9, { onda: 'sawtooth', de: 150 * r * tomM, ate: 260 * r * tomM * (morte ? 0.4 : 1), dur: d * 0.7, forca: 0.2, filtro: 900, q: 2, v });
      } else if (tipo === 'galinha') {
        // "có-có": notinhas curtas e agudas
        const n = morte ? 3 : dano ? 1 : 2;
        for (let k = 0; k < n; k++) {
          const t = t0 + k * 0.11;
          const f0 = (700 + k * 60) * r * tomM;
          this._vozMob(t, { onda: 'square', de: f0, ate: f0 * (morte ? 0.55 : 0.8), dur: 0.09 * durM, forca: 0.09, filtro: 2600, q: 2, ataque: 0.008, v });
        }
      } else if (tipo === 'zumbi') {
        // gemido grave com vibrato lento
        const d = 0.9 * durM;
        this._vozMob(t0, {
          onda: 'sawtooth', de: 110 * r * tomM, ate: (morte ? 55 : 85) * r * tomM, dur: d,
          forca: 0.2, filtro: 420, q: 2, ataque: 0.12, vib: [5, 9], v,
        });
        this._ruidoVarrido(t0, 'lowpass', 500, 200, d * 0.8, 0.05 * v, 0.7);
      } else if (tipo === 'aranha') {
        // chiado áspero
        const d = 0.45 * durM;
        this._chiado(t0, (dano ? 5200 : 3800) * r, d, 0.18 * v, dano ? 38 : 24);
      } else {
        // genérico: um grunhido simples
        this._vozMob(t0, { onda: 'triangle', de: 260 * r * tomM, ate: 160 * r * quedaM, dur: 0.25 * durM, forca: 0.18, filtro: 1200, v });
      }
    } catch (e) { /* som é enfeite */ }
  }

  /** "Tump" de pancada num mob */
  golpeMob() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      this._tomOnda(t0, 'sine', 160 * (0.9 + Math.random() * 0.2), 55, 0.14, 0.35);
      this._ruidoVarrido(t0, 'lowpass', 1200, 300, 0.08, 0.15);
    } catch (e) { /* som é enfeite */ }
  }

  /** Três "nhac" curtos de mastigar */
  comer() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      for (let k = 0; k < 3; k++) {
        const t = t0 + k * 0.16;
        this._ruidoVarrido(t, 'bandpass', 1800 + Math.random() * 600, 900, 0.07, 0.3, 1.5);
        this._tomOnda(t, 'triangle', 220 + Math.random() * 40, 120, 0.06, 0.12);
      }
    } catch (e) { /* som é enfeite */ }
  }

  // ----- Sons das Fases 8 e 11 (chefões, montarias, forja...), todos sintetizados -----

  /** Vários cliques secos e rápidos (ossos, estalos). `queda` multiplica a frequência a cada clique. */
  _cliques(t0, n, espaco, freq, forca, queda = 1) {
    for (let k = 0; k < n; k++) {
      const t = t0 + k * espaco * (0.7 + Math.random() * 0.6);
      const f = freq * Math.pow(queda, k) * (0.8 + Math.random() * 0.4);
      this._ruidoVarrido(t, 'bandpass', f, f * 0.6, 0.04, forca, 4);
    }
  }

  /** Sopro de fogo: ruído grave que sobe devagar e depois some ("fuuu") */
  _sopro(t0, dur, forca) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ruido;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(250, t0);
    f.frequency.exponentialRampToValueAtTime(1100, t0 + dur * 0.4);
    f.frequency.exponentialRampToValueAtTime(300, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(forca, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.mestre);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  /** Voz dos tipos de mob novos (Fases 8 e 11). Devolve true se tratou o tipo. */
  _mobNovo(tipo, evento, v, t0, r) {
    const dano = evento === 'dano';
    const morte = evento === 'morte';
    const ataque = evento === 'ataque';
    const tomM = dano ? 1.3 : ataque ? 1.4 : 1;
    const durM = dano ? 0.65 : morte ? 1.8 : 1;
    const queda = morte ? 0.5 : 1;

    switch (tipo) {
      case 'esqueleto': {
        // chocalhar de ossos: cliques secos e rápidos
        const n = morte ? 12 : dano ? 6 : ataque ? 4 : 5;
        this._cliques(t0, n, morte ? 0.055 : 0.045, 3000 * r * tomM, 0.65 * v, morte ? 0.93 : 1);
        if (ataque) this._tomOnda(t0, 'triangle', 900 * r, 500, 0.08, 0.06 * v);
        return true;
      }
      case 'aranha_gigante':
      case 'aranha_montaria': {
        // chiado grave e longo (a montaria é mais suave e curta)
        const suave = tipo === 'aranha_montaria' ? 0.6 : 1;
        const d = (0.9 * durM * (suave < 1 ? 0.7 : 1));
        this._chiado(t0, (dano ? 2600 : 1700) * r * (ataque ? 1.3 : 1), d, 0.38 * v * suave, dano ? 30 : 16);
        this._ruidoVarrido(t0, 'lowpass', 700, 220, d * 0.8, 0.15 * v * suave, 0.7);
        return true;
      }
      case 'orc_guerreiro': {
        // grunhido grave e áspero: dente-de-serra com filtro fechado e vibrato rápido
        const d = 0.55 * durM;
        this._vozMob(t0, { onda: 'sawtooth', de: 100 * r * tomM, ate: 62 * r * tomM * queda, dur: d, forca: 0.22, filtro: 380, q: 4, ataque: 0.04, vib: [26, 10], v });
        this._vozMob(t0, { onda: 'square', de: 50 * r * tomM, ate: 35 * queda, dur: d, forca: 0.1, filtro: 200, v });
        this._ruidoVarrido(t0, 'lowpass', 900, 250, d * 0.7, 0.07 * v, 1);
        return true;
      }
      case 'orc_xama': {
        // canto curto e misterioso: 3 notas com vibrato e ecos (imitando reverb)
        const base = 330 * r * (dano ? 1.2 : 1);
        const razoes = morte ? [1, 0.84, 0.66] : ataque ? [1, 1.26, 1.5] : [1, 1.2, 0.9];
        razoes.forEach((m, k) => {
          const t = t0 + k * 0.2;
          const f = base * m;
          [[0, 1], [0.14, 0.35], [0.3, 0.15]].forEach(([atraso, vol]) => {
            this._vozMob(t + atraso, { onda: 'triangle', de: f, ate: f * 0.99, dur: 0.38 * (morte ? 1.6 : 1), forca: 0.14 * vol, filtro: 2200, ataque: 0.06, vib: [6, f * 0.015], v });
          });
        });
        return true;
      }
      case 'dragao': {
        if (ataque) {
          // sopro de fogo
          this._sopro(t0, 1.1, 0.6 * v);
          this._tomOnda(t0, 'sine', 90, 55, 0.6, 0.12 * v);
          return true;
        }
        // rugido: ruído filtrado + oscilador grave descendo
        const d = 1.2 * (dano ? 0.7 : morte ? 1.7 : 1);
        this._vozMob(t0, { onda: 'sawtooth', de: 130 * r * (dano ? 1.25 : 1), ate: 45 * r * queda, dur: d, forca: 0.24, filtro: 520, q: 3, ataque: 0.08, vib: [18, 8], v });
        this._tomOnda(t0, 'sine', 70 * r, 32, d, 0.2 * v);
        this._ruidoVarrido(t0, 'bandpass', 900, 200, d, 0.2 * v, 0.8);
        return true;
      }
      // Dragões elementais: o mesmo rugido do dragão de fogo, com timbre próprio
      case 'dragao_gelo': {
        if (ataque) {
          // rajada de gelo: sopro mais agudo + vento chiando + cristais tilintando
          this._sopro(t0, 1.0, 0.45 * v);
          this._ruidoVarrido(t0, 'highpass', 3000, 7000, 1.0, 0.12 * v, 0.7);
          for (let k = 0; k < 5; k++) this._tomOnda(t0 + 0.1 + k * 0.13, 'triangle', 2400 + Math.random() * 1600, 2200, 0.25, 0.04 * v);
          return true;
        }
        // rugido mais agudo e "de vidro": a mesma voz, um pouco mais alta, com brilho em cima
        const d = 1.2 * (dano ? 0.7 : morte ? 1.7 : 1);
        this._vozMob(t0, { onda: 'sawtooth', de: 170 * r * (dano ? 1.25 : 1), ate: 60 * r * queda, dur: d, forca: 0.2, filtro: 900, q: 4, ataque: 0.08, vib: [12, 10], v });
        this._tomOnda(t0, 'sine', 90 * r, 40, d, 0.16 * v);
        this._ruidoVarrido(t0, 'bandpass', 2600, 900, d, 0.14 * v, 1.2);
        this._tomOnda(t0 + 0.1, 'triangle', 1800 * r, 1500, d * 0.8, 0.035 * v);
        return true;
      }
      case 'dragao_veneno': {
        if (ataque) {
          // nuvem de veneno: sibilo comprido + borbulhas
          this._chiado(t0, 2600 * r, 1.1, 0.32 * v, 18);
          this._sopro(t0, 1.2, 0.3 * v);
          for (let k = 0; k < 6; k++) this._tomOnda(t0 + k * 0.15, 'sine', 240 + Math.random() * 160, 600, 0.08, 0.05 * v);
          return true;
        }
        // rugido grave e "molhado": vibrato lento e largo, com borbulhas
        const d = 1.3 * (dano ? 0.7 : morte ? 1.7 : 1);
        this._vozMob(t0, { onda: 'sawtooth', de: 115 * r * (dano ? 1.25 : 1), ate: 40 * r * queda, dur: d, forca: 0.24, filtro: 420, q: 5, ataque: 0.1, vib: [7, 14], v });
        this._tomOnda(t0, 'sine', 62 * r, 30, d, 0.2 * v);
        this._chiado(t0 + 0.1, 1800 * r, d * 0.8, 0.12 * v, 9);
        for (let k = 0; k < 4; k++) this._tomOnda(t0 + 0.2 + k * 0.22, 'sine', 180 + Math.random() * 120, 420, 0.07, 0.04 * v);
        return true;
      }
      case 'dragao_raio': {
        if (ataque) {
          // a tempestade se forma: zumbido elétrico subindo + estalos
          this._vozMob(t0, { onda: 'square', de: 70, ate: 160, dur: 1.2, forca: 0.08, filtro: 1400, q: 2, ataque: 0.2, vib: [45, 12], v });
          this._cliques(t0, 10, 0.1, 4200, 0.35 * v, 1);
          return true;
        }
        // rugido com zumbido elétrico por cima
        const d = 1.2 * (dano ? 0.7 : morte ? 1.7 : 1);
        this._vozMob(t0, { onda: 'sawtooth', de: 140 * r * (dano ? 1.25 : 1), ate: 50 * r * queda, dur: d, forca: 0.22, filtro: 600, q: 3, ataque: 0.08, vib: [22, 9], v });
        this._tomOnda(t0, 'sine', 72 * r, 34, d, 0.18 * v);
        this._vozMob(t0, { onda: 'square', de: 110 * r, ate: 90 * r, dur: d * 0.9, forca: 0.05, filtro: 2500, q: 2, ataque: 0.05, vib: [60, 8], v });
        this._cliques(t0 + 0.1, 5, 0.12, 3800, 0.25 * v, 1);
        return true;
      }
      case 'hidra': {
        // sibilo triplo: 3 chiados em alturas diferentes
        const alturas = morte ? [2400, 1800, 1200] : [2200, 3300, 2700];
        alturas.forEach((f, k) => {
          this._chiado(t0 + k * 0.2 * (morte ? 1.5 : 1), f * r * (dano ? 1.2 : 1), 0.3 * (morte ? 1.5 : 1), 0.32 * v, 28);
        });
        return true;
      }
      case 'cavalo': {
        // relincho: vibrato rápido, sobe e depois desce
        const f = 520 * r * (ataque ? 1.2 : 1);
        const sobe = dano ? 0.15 : 0.28;
        this._vozMob(t0, { onda: 'sawtooth', de: f, ate: f * 1.8, dur: sobe, forca: 0.14, filtro: 2400, q: 2, ataque: 0.03, vib: [13, 35], v });
        this._vozMob(t0 + sobe, { onda: 'sawtooth', de: f * 1.8, ate: f * 0.7 * queda, dur: (dano ? 0.25 : 0.55) * (morte ? 1.8 : 1), forca: 0.14, filtro: 2200, q: 2, ataque: 0.01, vib: [14, 40], v });
        this._ruidoVarrido(t0, 'bandpass', 2500, 1500, 0.3, 0.04 * v, 1);
        return true;
      }
      case 'lobo_gigante': {
        if (ataque) {
          // rosnado: grave, com vibrato muito rápido
          this._vozMob(t0, { onda: 'sawtooth', de: 85 * r, ate: 70 * r, dur: 0.6, forca: 0.22, filtro: 320, q: 3, ataque: 0.05, vib: [32, 14], v });
          this._ruidoVarrido(t0, 'lowpass', 800, 300, 0.5, 0.08 * v, 1);
        } else if (dano) {
          this._vozMob(t0, { onda: 'triangle', de: 800 * r, ate: 450, dur: 0.25, forca: 0.16, filtro: 2500, vib: [12, 25], v });
        } else {
          // uivo: glide longo, sobe e desce
          const k = morte ? 0.7 : 1;
          this._vozMob(t0, { onda: 'triangle', de: 280 * r * k, ate: 620 * r * k, dur: 0.8, forca: 0.17, filtro: 1800, ataque: 0.15, vib: [5, 7], v });
          this._vozMob(t0 + 0.8, { onda: 'triangle', de: 620 * r * k, ate: 400 * r * k * queda, dur: 0.9, forca: 0.15, filtro: 1600, ataque: 0.02, vib: [5, 8], v });
        }
        return true;
      }
      case 'filhote_dragao': {
        // guincho agudo e fofo
        const f = 1300 * r * (dano ? 1.2 : 1);
        this._vozMob(t0, { onda: 'triangle', de: f, ate: f * 1.7, dur: 0.16, forca: 0.12, filtro: 5000, ataque: 0.015, vib: [22, 70], v });
        this._vozMob(t0 + 0.14, { onda: 'triangle', de: f * 1.7, ate: f * (morte ? 0.6 : 1.1), dur: morte ? 0.5 : 0.18, forca: 0.1, filtro: 5000, ataque: 0.01, vib: [20, 60], v });
        return true;
      }
      default:
        return false;
    }
  }

  /** Zunido rápido de flecha */
  flecha() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      this._ruidoVarrido(t0, 'bandpass', 6500, 1500, 0.2, 0.3, 3);
      this._tomOnda(t0, 'sine', 1800, 600, 0.12, 0.05);
    } catch (e) { /* som é enfeite */ }
  }

  /** Orbe mágico: "uóóm" com brilho */
  magia() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      this._vozMob(t0, { onda: 'sine', de: 180, ate: 430, dur: 0.6, forca: 0.22, filtro: 2000, ataque: 0.12, vib: [8, 14], v: 1 });
      this._tomOnda(t0 + 0.05, 'triangle', 2000, 3200, 0.4, 0.05);
      this._tomOnda(t0 + 0.15, 'triangle', 2600, 4000, 0.35, 0.04);
      this._ruidoVarrido(t0, 'highpass', 4000, 9000, 0.4, 0.03);
    } catch (e) { /* som é enfeite */ }
  }

  /** Três marteladas metálicas com eco curto */
  forja() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      for (let k = 0; k < 3; k++) {
        const t = t0 + k * 0.3;
        // a martelada e depois o eco (mais baixo)
        [[0, 1], [0.1, 0.3]].forEach(([atraso, vol]) => {
          const ta = t + atraso;
          this._ruidoVarrido(ta, 'bandpass', 3200, 1500, 0.07, 0.22 * vol, 2);
          this._tomOnda(ta, 'sine', 1400 + k * 80, 1380 + k * 80, 0.3, 0.12 * vol);
          this._tomOnda(ta, 'sine', 2150 + k * 100, 2100 + k * 100, 0.22, 0.07 * vol);
          this._tomOnda(ta, 'sine', 180, 100, 0.08, 0.2 * vol);
        });
      }
    } catch (e) { /* som é enfeite */ }
  }

  /**
   * Trovão do raio do dragão: estalo seco + ronco grave que vai sumindo.
   * `vol` (0 a 1): longe, mais baixo.
   */
  trovao(vol = 1) {
    if (!this._podeTocar()) return;
    const v = Math.min(1, Math.max(0, Number(vol) || 0));
    if (v <= 0.02) return;
    try {
      const t0 = this.ctx.currentTime;
      this._ruidoVarrido(t0, 'bandpass', 4200, 1200, 0.12, 0.55 * v, 1.5);     // o estalo
      this._ruidoVarrido(t0 + 0.04, 'lowpass', 900, 70, 1.8, 0.45 * v, 0.7);  // o ronco
      this._tomOnda(t0 + 0.02, 'sine', 70, 28, 1.4, 0.3 * v);
      this._cliques(t0, 4, 0.03, 5000, 0.3 * v, 0.9);
    } catch (e) { /* som é enfeite */ }
  }

  /** Choquinho da espada de raio */
  choque() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      this._cliques(t0, 4, 0.025, 4600, 0.28, 1);
      this._tomOnda(t0, 'square', 900, 300, 0.12, 0.04);
    } catch (e) { /* som é enfeite */ }
  }

  /** Uma batida grave de asas */
  asas() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      this._ruidoVarrido(t0, 'lowpass', 800, 180, 0.45, 0.28, 0.7);
      this._tomOnda(t0, 'sine', 80, 38, 0.35, 0.25);
    } catch (e) { /* som é enfeite */ }
  }

  /** Assobio agudo de 2 notas */
  apito() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      this._vozMob(t0, { onda: 'sine', de: 1900, ate: 2100, dur: 0.2, forca: 0.14, filtro: 5000, ataque: 0.03, vib: [30, 30], v: 1 });
      this._vozMob(t0 + 0.2, { onda: 'sine', de: 2500, ate: 2350, dur: 0.3, forca: 0.14, filtro: 5000, ataque: 0.03, vib: [30, 40], v: 1 });
      this._ruidoVarrido(t0, 'highpass', 5000, 7000, 0.45, 0.02);
    } catch (e) { /* som é enfeite */ }
  }

  /** Ao concluir a doma (progresso 1) toca um "plim" feliz; abaixo disso, nada */
  domar(progresso) {
    if (!(progresso >= 1)) return;
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      [660, 880, 1320, 1760].forEach((f, k) => {
        this._tomOnda(t0 + k * 0.08, 'triangle', f, f * 1.01, k === 3 ? 0.5 : 0.2, 0.12);
      });
      this._ruidoVarrido(t0 + 0.2, 'highpass', 6000, 9000, 0.3, 0.025);
    } catch (e) { /* som é enfeite */ }
  }

  /** Ovo rachando: estalos irregulares */
  chocar() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      const tempos = [0, 0.09, 0.2, 0.28, 0.45, 0.6];
      tempos.forEach((dt) => {
        this._ruidoVarrido(t0 + dt, 'bandpass', 1500 + Math.random() * 2500, 900, 0.05, 0.5, 3);
      });
      this._tomOnda(t0 + 0.6, 'sine', 300, 140, 0.15, 0.1);
    } catch (e) { /* som é enfeite */ }
  }

  /** Fanfarra curta de subir de nível: 3 notas ascendentes */
  nivel() {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      [[523, 0, 0.16], [659, 0.15, 0.16], [784, 0.3, 0.2], [1047, 0.45, 0.6]].forEach(([f, dt, d]) => {
        this._tomOnda(t0 + dt, 'triangle', f, f * 1.005, d, 0.14);
        this._tomOnda(t0 + dt, 'square', f * 2, f * 2, d * 0.7, 0.025);
      });
    } catch (e) { /* som é enfeite */ }
  }

  /** Som de receber um efeito: 'veneno', 'lento' ou 'fogo' */
  efeito(tipo) {
    if (!this._podeTocar()) return;
    try {
      const t0 = this.ctx.currentTime;
      if (tipo === 'veneno') {
        // bolhas borbulhando para baixo
        this._vozMob(t0, { onda: 'sine', de: 500, ate: 220, dur: 0.45, forca: 0.14, filtro: 1500, vib: [14, 60], v: 1 });
        this._tomOnda(t0 + 0.1, 'sine', 300, 700, 0.1, 0.08);
        this._tomOnda(t0 + 0.25, 'sine', 250, 600, 0.1, 0.07);
        this._chiado(t0, 3500, 0.4, 0.06, 22);
      } else if (tipo === 'lento') {
        // tom que arrasta para baixo, como câmera lenta
        this._tomOnda(t0, 'sawtooth', 420, 100, 0.6, 0.07);
        this._tomOnda(t0, 'sine', 300, 70, 0.6, 0.14);
      } else if (tipo === 'fogo') {
        // labareda crepitante
        this._ruidoVarrido(t0, 'lowpass', 1800, 400, 0.45, 0.2, 0.8);
        this._cliques(t0 + 0.05, 5, 0.06, 2500, 0.12);
      }
    } catch (e) { /* som é enfeite */ }
  }

  alternarMudo() {
    this.mudo = !this.mudo;
    this._aplicarGanho();
    this._salvar();
    return this.mudo;
  }
}

export const som = new Som();
