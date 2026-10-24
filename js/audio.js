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
    const dia = this.clima === 'dia' ? 1 : 0;
    const alvos = [[this._barDia, dia], [this._barNoite, 1 - dia],
                   [this._envioDia, dia], [this._envioNoite, 1 - dia]];
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
    const passoDur = 60 / MUSICA.BPM / 2; // colcheia
    while (this._proximo < agora + MUSICA.ANTECEDENCIA) {
      const fading = agora < this._fadeAte;
      if (this.clima === 'dia' || fading) this._passoDia(this._proximo, passoDur);
      if (this.clima === 'noite' || fading) this._passoNoite(this._proximo, passoDur);
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
  _pad(notas, t, barramento, volume) {
    const ctx = this.som.ctx;
    const dur = 60 / MUSICA.BPM * MUSICA.BATIDAS_ACORDE + 2.5;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 700;
    filtro.Q.value = 0.5;
    const g = ctx.createGain();
    const ataque = 2.5, release = 3.5;
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
  _nota(tipo, hz, t, dur, volume, barramento, envio, parteReverb) {
    if (this._vozes >= MUSICA.MAX_VOZES) return;
    const ctx = this.som.ctx;
    const o = ctx.createOscillator();
    o.type = tipo;
    o.frequency.value = hz;
    o.detune.value = (Math.random() - 0.5) * 10;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(barramento);
    const e = ctx.createGain();
    e.gain.value = parteReverb;
    g.connect(e).connect(envio);
    this._iniciarVoz(o, t, t + dur + 0.05, g, e);
  }

  // ---------- API pública ----------

  /** Troca entre 'dia' e 'noite' com crossfade. Mesmo clima: nada. */
  definirClima(clima) {
    if (clima !== 'dia' && clima !== 'noite') return;
    if (clima === this.clima) return;
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

  alternarMudo() {
    this.mudo = !this.mudo;
    this._aplicarGanho();
    this._salvar();
    return this.mudo;
  }
}

export const som = new Som();
