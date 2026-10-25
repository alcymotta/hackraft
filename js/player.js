// =====================================================================
// Hackraft - Jogador
// ---------------------------------------------------------------------
// Cuida de: teclado e mouse, movimento e física (gravidade, pulo, água),
// colisão com os blocos, câmera (1ª e 3ª pessoa), quebrar e colocar blocos.
// O jogador só age quando o mouse está travado e nenhum menu está aberto.
//
// Fase 3: a roupa muda o jogador (bônus de velocidade, passos silenciosos),
// os presentes misteriosos dão um item quando quebrados, e o jogador pode
// soltar itens no chão (soltarNaFrente).
//
// Fase 5: vida (machucar, curar, morrer), dano de queda e os poderes dos
// cristais (velocidade, pulo, voar, quebra instantânea, ataque). Os poderes
// vêm do objeto `poderes` (ligado depois, com `jogador.poderes = poderes`).
//
// Fases 8 a 10: XP e níveis (mais vida e força), efeitos (veneno, lento e
// fogo), a forja (botão direito no bloco FORJA) e os bônus das roupas
// (pulo, queda segura, nado e duração dos poderes).
//
// Fase 11 (montarias): R monta na sua montaria com sela (até 3 blocos) e
// desce. Montado, QUEM ANDA É O JOGADOR, mas com a caixa, a velocidade e o
// pulo da montaria (os Mobs fazem o bicho acompanhar). A aranha sobe paredes,
// o filhote de dragão voa segurando Espaço (10 s, depois descansa 20 s), a
// câmera fica mais alta e não há dano de queda. O botão direito num bicho
// doma, dá osso, põe sela/armadura, monta e manda o pet sentar (com Shift);
// com o apito na mão, chama as montarias.
// =====================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { B, BLOCOS, SOLIDO, LIQUIDO } from './blocks.js';
import { obterItem, TABELA_PRESENTE } from './items.js';
import { MaoPrimeiraPessoa } from './character.js';

const METADE_LARGURA = CONFIG.LARGURA_JOGADOR / 2;
const ALTURA = CONFIG.ALTURA_JOGADOR;
const EPS = 0.0001;                 // folguinha para evitar erros de arredondamento
const PASSO_MAX = 0.3;              // deslocamento máximo por subpasso (em blocos)
const LIMITE_PITCH = Math.PI / 2 - 0.01;
const CAIXA_CHEIA = Object.freeze([0, 0, 0, 1, 1, 1]); // caixa de um cubo inteiro (Fase 6)
const BIT_ABERTA = 4;                // estado da porta: bit 2 = aberta
const BIT_CIMA = 8;                  // estado da porta: bit 3 = metade de cima
// Modificadores "sem poder nenhum" (usado enquanto não há `poderes`)
const MODS_VAZIOS = Object.freeze({
  velocidade: 1, pulo: 1, voar: false, regeneracao: false, quebraInstantanea: false, ataque: null,
  semDanoQueda: false,
});

export class Jogador {
  /**
   * @param opcoes { camera, scene, mundo, inventario, ui, som, personagem,
   *                 texturas, equipamento, soltarItem, particulas, poderes }
   *   particulas:  Particulas (pedacinhos ao quebrar bloco), opcional
   *   poderes:     Poderes (opcional; também pode ser ligado depois com
   *                `jogador.poderes = poderes`)
   *   texturas:    usado nas rachaduras de quebrar bloco
   *   equipamento: Equipamento (os bônus da roupa e da armadura)
   *   soltarItem:  fn(item, qtd, x, y, z, vx, vy, vz) → true se deu certo.
   *                Põe um item no chão (o main liga isso à rede, porque no
   *                multiplayer quem cria o item é o anfitrião).
   */
  constructor({ camera, scene, mundo, inventario, ui, som, personagem, texturas, equipamento = null, soltarItem = null, particulas = null, poderes = null, baus = null, telaForja = null, telaAlfaiate = null }) {
    this.telaAlfaiate = telaAlfaiate;  // TelaAlfaiate (Fase 10): abre ao clicar numa MESA_ALFAIATE
    this.obterAparenciaBase = null;    // o main liga: () => cores da skin base (prévia da mesa)
    this.telaForja = telaForja;        // TelaForja (Fase 9): abre ao clicar numa FORJA
    this.baus = baus;                  // Baus (Fase 6): conteúdo dos baús
    this.bauAberto = null;             // { x, y, z } do baú com a tela aberta (ou null)
    this._abrindoBau = false;          // esperando o anfitrião responder?
    this._cliqueDireito = false;       // o botão direito acabou de ser apertado (portas e baús só reagem ao clique)
    this.camera = camera;
    this.scene = scene;
    this.mundo = mundo;
    this.inventario = inventario;
    this.ui = ui;
    this.som = som;
    this.personagem = personagem;
    this.texturas = texturas;
    this.equipamento = equipamento;
    this.soltarItem = soltarItem;
    this.particulas = particulas;
    this.poderes = poderes;
    this._mods = MODS_VAZIOS;          // modificadores dos poderes neste quadro

    // Vida (Fase 5)
    this.vida = CONFIG.VIDA_MAX;
    this.morto = false;
    this.obterPosRenascer = null;      // o main liga: () => [x, y, z] da casa/nascimento
    this._ouvintesMorte = [];
    this._caindo = false;              // saiu do chão e ainda não pousou?
    this._yTopo = 0;                   // y mais alto desde que saiu do chão

    // Bônus do equipamento, guardados aqui (o loop não pede um objeto
    // novo ao equipamento a cada quadro). Atualizados quando ele muda.
    // pulo, queda segura, nado e duração dos poderes vêm das roupas (Fase 10);
    // `resistenciaVeneno` vem da armadura de escamas de hidra (Fase 9) ou de
    // dragão venenoso; `resistenciaLento`, da armadura de escamas de dragão de gelo.
    this.bonus = {
      velocidade: 0, defesa: 0, silencioso: false,
      pulo: 0, quedaSegura: 0, nado: 0, duracaoPoderes: 0, resistenciaVeneno: false, resistenciaLento: false,
    };

    // XP e nível (Fase 8): o nível sai do XP total
    this._xp = 0;
    this._nivel = 1;
    this._xpNoNivel = 0;               // XP já ganho dentro do nível atual
    this._xpParaProximo = CONFIG.XP_BASE;

    // Efeitos (Fase 8): segundos restantes de cada um
    this.efeitos = { veneno: 0, lento: 0, fogo: 0 };
    this._tickEfeito = { veneno: 0, fogo: 0 };   // contagem até o próximo 1 de dano
    this._tempoParticulasEfeito = 0;
    this._mascaraEfeitos = 0;          // quais efeitos a UI está mostrando
    this._contPassos = 0;
    if (equipamento) {
      this.atualizarBonus();
      equipamento.aoMudar(() => this.atualizarBonus());
    }

    // Estado do jogador
    this.posicao = new THREE.Vector3(0, 80, 0); // nos pés
    this.velocidade = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.noChao = false;
    this.naAgua = false;
    this.planando = false;             // planando com a capa (segurando Espaço na queda)
    this.nadando = false;              // nadando deitado (boneco na horizontal)
    this._aguaNoMeio = false;
    this.modoCamera = 'primeira';
    this.voando = false;               // modo voo (comando /voar): sem gravidade
    this.criativo = false;             // modo criativo (comando /criativo): blocos infinitos, voo e sem dano
    this.criativoTravado = false;      // mundo Criativo: o /criativo não consegue desligar
    this.caido = false;                // Hardcore: morreu e espera ser reanimado (o main desenha o corpo e a câmera)
    this.bloqueioDireito = false;      // o main liga enquanto reanima alguém (o botão direito não faz mais nada)
    this._seloCriativo = null;         // selo "CRIATIVO" em cima da hotbar (criado na primeira vez)

    // Entrada
    this.teclas = {};                  // event.code → true se apertada
    this.botoes = [false, false, false];

    // Quebrar e colocar
    this.alvoX = 0; this.alvoY = 0; this.alvoZ = 0;
    this.temAlvoQuebra = false;
    this.progresso = 0;
    this.tempoGolpe = 0;
    this.espera = 0;                   // pausa depois de quebrar
    this.tempoColocar = 0;

    // Combate, comida e XP (Fase 7)
    this.mobs = null;                  // Mobs (o main liga depois: jogador.mobs = mobs)
    this._esperaGolpe = 0;             // tempo até poder bater de novo
    this._tempoComendo = 0;            // há quanto tempo está comendo
    this._comendoItem = null;          // nome da comida que está sendo comida

    // Passos e submersão
    this.distPasso = 0;
    this.submerso = false;
    this.velHorizontal = 0;

    // Montaria (Fase 11): { id, tipo, p (números da montaria), nome } enquanto montado
    this.montaria = null;
    this._meia = METADE_LARGURA;       // meia largura da caixa de colisão (montado: a da montaria)
    this._alt = ALTURA;                // altura da caixa (montado: montaria + cavaleiro)
    this._bateuParede = false;         // bateu numa parede andando (a aranha sobe; os outros pulam o degrau)
    this._vooEnergia = CONFIG.FILHOTE_VOO_S; // segundos de voo que o filhote ainda tem
    this._vooRecarga = 0;              // descansando: segundos até poder voar de novo
    this._voandoFilhote = false;
    this._tUiMontaria = 0;

    // Objetos reaproveitados (evita criar lixo a cada quadro)
    this._olhos = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this.camera.rotation.order = 'YXZ';

    // Personagem (só aparece na 3ª pessoa)
    this.personagem.grupo.visible = false;
    scene.add(this.personagem.grupo);

    // Mãozinha da 1ª pessoa (braço direito no canto da tela)
    this.mao = new MaoPrimeiraPessoa({ scene, camera, personagem: this.personagem, texturas });

    // Contorno do bloco mirado
    this.contorno = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 })
    );
    this.contorno.visible = false;
    scene.add(this.contorno);

    // Rachadura que aparece no bloco sendo quebrado
    this.rachaduraMat = new THREE.MeshBasicMaterial({
      map: texturas && texturas.rachaduras ? texturas.rachaduras[0] : null,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.rachadura = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), this.rachaduraMat);
    this.rachadura.visible = false;
    scene.add(this.rachadura);
    this.estagioRachadura = -1;

    this._ligarEventos();
  }

  /** Lê de novo os bônus da roupa e da armadura (chamado quando o equipamento muda) */
  atualizarBonus() {
    const b = this.equipamento ? this.equipamento.bonus() : null;
    const vel = b && Number.isFinite(b.velocidade) ? b.velocidade : 0;
    this.bonus.velocidade = Math.max(-0.9, Math.min(2, vel)); // limites de segurança
    this.bonus.defesa = b && Number.isFinite(b.defesa) ? b.defesa : 0;
    this.bonus.silencioso = !!(b && b.silencioso);

    // Bônus extras da roupa (Fase 10), lidos direto da definição do item
    const eq = this.equipamento;
    const rb = eq ? (obterItem(eq.espacos.roupa)?.bonus || null) : null;
    const num = (v) => (Number.isFinite(v) && v > 0 ? Math.min(v, 5) : 0);
    this.bonus.pulo = rb ? num(rb.pulo) : 0;
    this.bonus.quedaSegura = rb ? num(rb.quedaSegura) : 0;
    this.bonus.nado = rb ? num(rb.nado) : 0;
    this.bonus.duracaoPoderes = rb ? num(rb.duracaoPoderes) : 0;
    // Resistências: qualquer peça de armadura com `resistencia: 'veneno'` (hidra,
    // dragão venenoso) ou `resistencia: 'lento'` (dragão de gelo) basta
    let resiste = false, resisteLento = false;
    if (eq) {
      for (const parte of ['capacete', 'peitoral', 'calca', 'botas']) {
        const r = obterItem(eq.espacos[parte])?.resistencia;
        if (r === 'veneno') resiste = true;
        else if (r === 'lento') resisteLento = true;
      }
    }
    this.bonus.resistenciaVeneno = resiste;
    this.bonus.resistenciaLento = resisteLento;
    let mudou = false;
    if (resiste && this.efeitos && this.efeitos.veneno > 0) { this.efeitos.veneno = 0; mudou = true; }
    if (resisteLento && this.efeitos && this.efeitos.lento > 0) { this.efeitos.lento = 0; mudou = true; }
    if (mudou) this._atualizarMascaraEfeitos();
  }

  // ------------------------------------------------------------------
  // XP e níveis (Fase 8)
  // ------------------------------------------------------------------

  /** XP total (soma de tudo que já ganhou). Mudar o valor recalcula o nível. */
  get xpTotal() { return this._xp; }
  set xpTotal(v) {
    const antes = this._nivel;
    this._definirXp(v);
    if (this._nivel > antes) this._subiuDeNivel();
    this.atualizarHud();
  }

  /** Nível atual (começa em 1) */
  get nivel() { return this._nivel; }

  /** Vida máxima: 20 no nível 1, +2 por nível, até 40 */
  get vidaMax() {
    return Math.min(CONFIG.VIDA_MAX_NIVEIS, CONFIG.VIDA_MAX + CONFIG.VIDA_POR_NIVEL * (this._nivel - 1));
  }

  /** XP necessário para sair do nível `n` para o próximo */
  static xpParaSubir(n) {
    return Math.floor(CONFIG.XP_BASE * Math.pow(n, CONFIG.XP_EXPOENTE));
  }

  /** Soma XP (pode subir de nível) */
  ganharXp(qtd) {
    if (!Number.isFinite(qtd) || qtd <= 0) return;
    this.xpTotal = this._xp + Math.floor(qtd);
  }

  /** Define o XP total sem comemorar (usado ao carregar o jogo) e recalcula o nível */
  _definirXp(v) {
    this._xp = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    let n = 1;
    let resto = this._xp;
    while (n < 999) {
      const precisa = Jogador.xpParaSubir(n);
      if (resto < precisa) break;
      resto -= precisa;
      n++;
    }
    this._nivel = n;
    this._xpNoNivel = resto;
    this._xpParaProximo = Jogador.xpParaSubir(n);
  }

  /** Redesenha corações e barra de XP (o main chama ao começar) */
  atualizarHud() {
    if (this.ui && this.ui.atualizarXp) this.ui.atualizarXp(this._nivel, this._xpNoNivel / this._xpParaProximo);
    if (this.ui && this.ui.atualizarVida) this.ui.atualizarVida(this.vida, this.vidaMax);
  }

  /** Festa de subir de nível: partículas douradas, som, mensagem e um pouco de vida */
  _subiuDeNivel() {
    const p = this.posicao;
    // Já no teto de 40 de vida? Então este nível só deu força
    const teto = CONFIG.VIDA_MAX + CONFIG.VIDA_POR_NIVEL * (this._nivel - 1) > CONFIG.VIDA_MAX_NIVEIS;
    if (this.particulas && typeof this.particulas.emitir === 'function') {
      // Em 1ª pessoa, a festa sai 1.8 bloco à frente dos olhos (no corpo, cobriria a tela)
      const frente = this.modoCamera === 'primeira';
      this.particulas.emitir({
        x: frente ? p.x - Math.sin(this.yaw) * 1.8 : p.x,
        y: frente ? p.y + CONFIG.ALTURA_OLHOS : p.y + 1,
        z: frente ? p.z - Math.cos(this.yaw) * 1.8 : p.z,
        qtd: 50, cores: ['#ffd23a', '#fff2a0', '#ffb300'],
        velocidade: 3.5, espalhar: 0.6, gravidade: -2, vida: 1.2, tamanho: 0.12, aditivo: true,
      });
    }
    try { if (this.som && typeof this.som.poder === 'function') this.som.poder('nivel'); } catch (e) { /* o som é opcional */ }
    this.ui.mostrarMensagem('Nível ' + this._nivel + '! (' + (teto ? '' : '+1 coração, ') + '+1 força)');
    this.curar(CONFIG.CURA_AO_SUBIR_NIVEL);
  }

  // ------------------------------------------------------------------
  // Efeitos: veneno, lento e fogo (Fase 8)
  // ------------------------------------------------------------------

  /**
   * Aplica um efeito por `segundos` (fica com o maior tempo entre o que já
   * tinha e o novo). Devolve true se o efeito pegou. O veneno não pega com a
   * armadura de escamas de hidra (ou de dragão venenoso), a lentidão não pega
   * com a de dragão de gelo, e o fogo não pega dentro da água.
   */
  aplicarEfeito(tipo, segundos) {
    if (this.morto || !(tipo in this.efeitos)) return false;
    const padrao = { veneno: CONFIG.EFEITO_VENENO_PADRAO_S, lento: CONFIG.EFEITO_LENTO_PADRAO_S, fogo: CONFIG.EFEITO_FOGO_PADRAO_S };
    const seg = Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos, 60) : padrao[tipo];
    if (tipo === 'veneno' && this.bonus.resistenciaVeneno) return false;
    if (tipo === 'lento' && this.bonus.resistenciaLento) return false;
    if (tipo === 'fogo' && this.naAgua) return false;
    if (this.efeitos[tipo] <= 0 && tipo !== 'lento') this._tickEfeito[tipo] = 0;
    this.efeitos[tipo] = Math.max(this.efeitos[tipo], seg);
    this._atualizarMascaraEfeitos();
    return true;
  }

  /** Tira todos os efeitos (ao morrer) */
  limparEfeitos() {
    this.efeitos.veneno = this.efeitos.lento = this.efeitos.fogo = 0;
    this._atualizarMascaraEfeitos();
  }

  /** Avisa a UI quando o conjunto de efeitos ativos muda (ícones, corações verdes, telas) */
  _atualizarMascaraEfeitos() {
    const e = this.efeitos;
    const m = (e.veneno > 0 ? 1 : 0) | (e.lento > 0 ? 2 : 0) | (e.fogo > 0 ? 4 : 0);
    if (m === this._mascaraEfeitos) return;
    this._mascaraEfeitos = m;
    if (this.ui.definirEfeitos) this.ui.definirEfeitos(!!(m & 1), !!(m & 2), !!(m & 4));
  }

  /** Conta o tempo dos efeitos, dá o dano de 1 por segundo e solta partículas */
  _atualizarEfeitos(dt) {
    const e = this.efeitos;
    if (this._mascaraEfeitos === 0 && e.veneno <= 0 && e.lento <= 0 && e.fogo <= 0) return;
    if (this.morto) { this.limparEfeitos(); return; }
    // Entrar na água apaga o fogo
    if (e.fogo > 0 && this.naAgua) {
      e.fogo = 0;
      // Em 1ª pessoa o vapor nasceria dentro da câmera (vira um quadrado cinza na tela)
      if (this.particulas && this.modoCamera !== 'primeira') {
        this.particulas.emitir({
          x: this.posicao.x, y: this.posicao.y + 1, z: this.posicao.z, qtd: 12, cor: '#cccccc',
          velocidade: 1, espalhar: 0.4, gravidade: -1, vida: 0.8, tamanho: 0.12, aditivo: false,
        });
      }
    }
    const intervalo = CONFIG.EFEITO_DANO_INTERVALO_S;
    for (const tipo of ['veneno', 'fogo']) {
      if (e[tipo] <= 0) continue;
      e[tipo] -= dt;
      this._tickEfeito[tipo] += dt;
      if (this._tickEfeito[tipo] >= intervalo) {
        this._tickEfeito[tipo] -= intervalo;
        // O veneno nunca mata: para em 1 de vida (como no Minecraft). O fogo pode matar.
        if (tipo !== 'veneno' || this.vida > 1) this.machucar(1, tipo);
        if (this.morto) return; // _morrer já limpou os efeitos
      }
    }
    if (e.lento > 0) e.lento -= dt;
    if (e.veneno < 0) e.veneno = 0;
    if (e.fogo < 0) e.fogo = 0;
    if (e.lento < 0) e.lento = 0;

    // Partículas: ~6 vezes por segundo
    this._tempoParticulasEfeito += dt;
    // Em 1ª pessoa não solta partículas no corpo (subiriam até a câmera); a tela já mostra o efeito
    if (this._tempoParticulasEfeito >= 0.16 && this.particulas && this.modoCamera !== 'primeira') {
      this._tempoParticulasEfeito = 0;
      const p = this.posicao;
      if (e.veneno > 0) {
        this.particulas.emitir({
          x: p.x, y: p.y + 1.2, z: p.z, qtd: 2, cores: ['#5bd13a', '#8dff6a'],
          velocidade: 0.5, espalhar: 0.35, gravidade: -1, vida: 0.8, tamanho: 0.09, aditivo: true,
        });
      }
      if (e.fogo > 0) {
        this.particulas.emitir({
          x: p.x, y: p.y + 0.9, z: p.z, qtd: 3, cores: ['#ff7a1a', '#ffd23a', '#ff4a1a'],
          velocidade: 0.8, espalhar: 0.35, gravidade: -3, vida: 0.6, tamanho: 0.1, aditivo: true,
        });
      }
    }
    this._atualizarMascaraEfeitos();
  }

  // ------------------------------------------------------------------
  // Entrada (teclado e mouse)
  // ------------------------------------------------------------------

  /** true se o jogador pode agir agora */
  get ativo() {
    return !this.morto && this.ui.mouseTravado && !this.ui.menuAberto;
  }

  // ------------------------------------------------------------------
  // Vida (Fase 5)
  // ------------------------------------------------------------------

  /** Registra uma função chamada quando o jogador morre (vida chegou a 0) */
  aoMorrer(fn) {
    if (typeof fn === 'function') this._ouvintesMorte.push(fn);
  }

  /**
   * Tira vida. `causa` é um texto ('queda', 'fogo'...) ou um objeto
   * { tipo, direcao: {x, y, z} } (a direção em que o golpe vai, para empurrar).
   * Devolve a vida que restou.
   */
  machucar(qtd, causa = null) {
    if (this.criativo) return this.vida; // criativo: sem dano
    if (this.morto || !Number.isFinite(qtd) || qtd <= 0) return this.vida;
    this.vida = Math.max(0, this.vida - qtd);
    if (this.ui.sinalizarDano) this.ui.sinalizarDano();
    if (this.ui.atualizarVida) this.ui.atualizarVida(this.vida, this.vidaMax);
    // Empurrãozinho se o golpe tem direção
    const dir = causa && typeof causa === 'object' ? causa.direcao : null;
    if (dir && Number.isFinite(dir.x) && Number.isFinite(dir.z)) {
      const comp = Math.hypot(dir.x, dir.z) || 1;
      this.velocidade.x += (dir.x / comp) * CONFIG.EMPURRAO_DANO;
      this.velocidade.z += (dir.z / comp) * CONFIG.EMPURRAO_DANO;
      this.velocidade.y = Math.max(this.velocidade.y, CONFIG.EMPURRAO_DANO_CIMA);
      this.noChao = false;
    }
    if (this.som && typeof this.som.dano === 'function') this.som.dano();
    if (this.vida <= 0) this._morrer();
    return this.vida;
  }

  /** Devolve vida (sem passar do máximo). Não revive quem já morreu. */
  curar(qtd) {
    if (this.morto || !Number.isFinite(qtd) || qtd <= 0) return this.vida;
    const nova = Math.min(this.vidaMax, this.vida + qtd);
    if (nova !== this.vida) {
      this.vida = nova;
      if (this.ui.atualizarVida) this.ui.atualizarVida(this.vida, this.vidaMax);
    }
    return this.vida;
  }

  _morrer() {
    if (this.montaria) this.desmontar(); // morreu montado: cai da montaria
    this.morto = true;
    this.vida = 0;
    this.botoes[0] = this.botoes[1] = this.botoes[2] = false;
    this.teclas = {};
    this._limparQuebra();
    this.limparEfeitos();
    if (this.telaForja && this.telaForja.aberta) this.telaForja.fechar(false);
    if (this.telaAlfaiate && this.telaAlfaiate.aberta) this.telaAlfaiate.fechar(false);
    for (const fn of this._ouvintesMorte) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  /** Volta à vida com a vida cheia (o main chama depois de teletransportar para casa) */
  renascer() {
    this.morto = false;
    this.caido = false;
    this.teclas = {};
    this.botoes[0] = this.botoes[1] = this.botoes[2] = false;
    this.vida = this.vidaMax;
    this._caindo = false;
    this.velocidade.set(0, 0, 0);
    this.limparEfeitos();
    if (this.ui.atualizarVida) this.ui.atualizarVida(this.vida, this.vidaMax);
  }

  /**
   * Hardcore: outro jogador me reanimou. Volta ao lugar onde caiu, com uma
   * fração da vida máxima (padrão: metade). Devolve a vida nova.
   */
  reviver(fracao = CONFIG.REANIMAR_VIDA) {
    this.morto = false;
    this.caido = false;
    this.teclas = {};
    this.botoes[0] = this.botoes[1] = this.botoes[2] = false;
    this.vida = Math.max(1, Math.round(this.vidaMax * fracao));
    this._caindo = false;
    this.velocidade.set(0, 0, 0);
    this.limparEfeitos();
    if (this.ui.atualizarVida) this.ui.atualizarVida(this.vida, this.vidaMax);
    return this.vida;
  }

  /** Controla o dano de queda: guarda o y mais alto e, ao pousar, aplica (queda - QUEDA_SEGURA) */
  _verificarQueda(voa, yAntes) {
    const p = this.posicao;
    // Voando, na água ou com o poder de superpulo: nada de dano (e recomeça a contagem)
    if (voa || this.naAgua || this.planando || this._mods.semDanoQueda || this._mods.pulo > 1) {
      this._caindo = false;
      this._yTopo = p.y;
      return;
    }
    if (this.noChao) {
      if (this._caindo) {
        this._caindo = false;
        const dano = Math.floor(this._yTopo - p.y - (CONFIG.QUEDA_SEGURA + this.bonus.quedaSegura) + 0.001);
        if (dano > 0) this.machucar(dano, 'queda');
      }
      this._yTopo = p.y;
    } else if (!this._caindo) {
      this._caindo = true;
      this._yTopo = Math.max(p.y, yAntes); // o y de onde saiu do chão
    } else if (p.y > this._yTopo) {
      this._yTopo = p.y;
    }
  }

  /** true se o evento de teclado veio de um campo de texto */
  _digitando(e) {
    const t = e.target;
    return !!t && ((t.tagName === 'INPUT' && t.type !== 'range') || t.tagName === 'TEXTAREA');
  }

  /** true se está com a capa vermelha ou azul no acessório */
  _temCapa() {
    const a = this.equipamento && this.equipamento.espacos ? this.equipamento.espacos.acessorio : null;
    return a === 'capa_vermelha' || a === 'capa_azul';
  }

  /** true enquanto o botão esquerdo está segurado com um alvo (para a rede animar o golpe) */
  get quebrando() {
    return this.botoes[0] && this.temAlvoQuebra;
  }

  _ligarEventos() {
    window.addEventListener('keydown', (e) => {
      // Digitando num campo de texto (apelido, código): não mexe no jogador
      // (o F5 nunca deve recarregar a página, nem digitando)
      if (e.code === 'F5' || e.key === 'F5') e.preventDefault();
      if (this._digitando(e)) return;
      // F5 ou V trocam a câmera. No F5 também tentamos impedir que a página
      // recarregue. Em muitos notebooks, porém, a tecla F5 (sem o Fn) manda o
      // comando "Atualizar" do sistema, que o navegador não deixa bloquear.
      // Por isso existe a tecla V como alternativa.
      const ehF5 = e.code === 'F5' || e.key === 'F5' || e.code === 'BrowserRefresh';
      if (ehF5 || e.code === 'KeyV') {
        if (ehF5) e.preventDefault();
        if (!e.repeat && this.ativo) {
          this.modoCamera = this.modoCamera === 'primeira' ? 'terceira' : 'primeira';
        }
        return;
      }
      if (this.morto) return;   // morto: não registra teclas
      // R: monta na sua montaria (com sela, até 3 blocos) ou desce (Fase 11)
      if (e.code === 'KeyR' && !e.repeat && this.ativo) this._alternarMontaria();
      this.teclas[e.code] = true;
      // Evita que o espaço "aperte" algum botão da página
      if (e.code === 'Space' && this.ativo) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      // Sempre solta a tecla, mesmo dentro de um campo de texto (senão o boneco fica andando)
      this.teclas[e.code] = false;
      if (this._digitando(e)) return;
    });

    // Se a janela perder o foco, ninguém fica "preso" andando
    window.addEventListener('blur', () => {
      this.teclas = {};
      this.botoes[0] = this.botoes[1] = this.botoes[2] = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.ativo) return;
      this.yaw -= e.movementX * CONFIG.SENSIBILIDADE_MOUSE;
      this.pitch -= e.movementY * CONFIG.SENSIBILIDADE_MOUSE;
      if (this.pitch > LIMITE_PITCH) this.pitch = LIMITE_PITCH;
      if (this.pitch < -LIMITE_PITCH) this.pitch = -LIMITE_PITCH;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.ativo || e.button > 2) return;
      this.botoes[e.button] = true;
      if (e.button === 2) {
        this.tempoColocar = 0; // coloca na hora
        this._cliqueDireito = true;
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.botoes[e.button] = false;
    });
  }

  // ------------------------------------------------------------------
  // Colisão
  // ------------------------------------------------------------------

  /**
   * A caixa de colisão do bloco (x, y, z) com id `id`, em coordenadas do bloco
   * ([x0, y0, z0, x1, y1, z1], de 0 a 1), ou null se não colide.
   * Cubos sólidos usam a caixa inteira. Modelos (porta, tocha) pedem ao mundo.
   */
  _caixaDoBloco(x, y, z, id) {
    const def = BLOCOS[id];
    if (def && def.modelo && def.modelo !== 'cubo' && typeof this.mundo.caixaColisao === 'function') {
      return this.mundo.caixaColisao(x, y, z);
    }
    return SOLIDO[id] ? CAIXA_CHEIA : null;
  }

  /**
   * Procura bloqueios para a caixa do jogador com os pés em (px, py, pz).
   * Sem `eixo`: devolve true se encosta em algo.
   * Com `eixo` ('x', 'y' ou 'z') e o sentido `d` (+1 ou -1) do movimento:
   * devolve a posição (naquele eixo) em que o jogador fica encostado na
   * face do bloqueio mais próxima, ou NaN se não bate em nada.
   */
  _bloqueio(px, py, pz, eixo, d) {
    // A caixa é a do jogador, ou a da montaria quando ele está montado (Fase 11)
    const META = this._meia, ALT = this._alt;
    const x0 = Math.floor(px - META + EPS);
    const x1 = Math.floor(px + META - EPS);
    const y0 = Math.floor(py + EPS);
    const y1 = Math.floor(py + ALT - EPS);
    const z0 = Math.floor(pz - META + EPS);
    const z1 = Math.floor(pz + META - EPS);
    const mundo = this.mundo;
    const jx0 = px - META, jx1 = px + META;
    const jy0 = py, jy1 = py + ALT;
    const jz0 = pz - META, jz1 = pz + META;
    let melhor = NaN;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = mundo.obterBloco(x, y, z);
          if (id === 0) continue; // ar
          const c = this._caixaDoBloco(x, y, z, id);
          if (!c) continue;
          // A caixa do bloco encosta mesmo na caixa do jogador? (cubos inteiros sempre)
          if (c !== CAIXA_CHEIA) {
            if (jx0 + EPS >= x + c[3] || jx1 - EPS <= x + c[0] ||
                jy0 + EPS >= y + c[4] || jy1 - EPS <= y + c[1] ||
                jz0 + EPS >= z + c[5] || jz1 - EPS <= z + c[2]) continue;
          }
          if (!eixo) return true;
          // Posição do jogador encostado na face
          let cand;
          if (eixo === 'x') cand = d > 0 ? x + c[0] - META : x + c[3] + META;
          else if (eixo === 'z') cand = d > 0 ? z + c[2] - META : z + c[5] + META;
          else cand = d > 0 ? y + c[1] - ALT : y + c[4];
          if (Number.isNaN(melhor) || (d > 0 ? cand < melhor : cand > melhor)) melhor = cand;
        }
      }
    }
    return eixo ? melhor : false;
  }

  /** true se a caixa do jogador, com os pés em (px, py, pz), encosta num bloco sólido */
  _colide(px, py, pz) {
    return this._bloqueio(px, py, pz, null, 0) === true;
  }

  /** Move o jogador no eixo Y; ajusta noChao e a velocidade se bater */
  _moverY(d) {
    const p = this.posicao;
    const novo = p.y + d;
    if (!this._colide(p.x, novo, p.z)) {
      p.y = novo;
      return;
    }
    const face = this._bloqueio(p.x, novo, p.z, 'y', d < 0 ? -1 : 1);
    if (d < 0) {
      p.y = Number.isNaN(face) ? p.y : face; // pousa em cima do bloco
      this.noChao = true;
    } else {
      p.y = Number.isNaN(face) ? p.y : face; // bate a cabeça
    }
    this.velocidade.y = 0;
  }

  /** Se a caixa começa dentro de um bloco sólido, sobe até achar espaço livre (máx. 3 blocos) */
  _sairDeDentroDoBloco() {
    const p = this.posicao;
    if (!this._colide(p.x, p.y, p.z)) return;
    for (let i = 1; i <= 3; i++) {
      const y = Math.floor(p.y + EPS) + i;
      if (!this._colide(p.x, y, p.z)) {
        p.y = y;
        if (this.velocidade.y < 0) this.velocidade.y = 0;
        return;
      }
    }
  }

  _moverX(d) {
    if (d === 0) return;
    const p = this.posicao;
    const novo = p.x + d;
    if (!this._colide(novo, p.y, p.z)) {
      p.x = novo;
      return;
    }
    const face = this._bloqueio(novo, p.y, p.z, 'x', d > 0 ? 1 : -1);
    if (!Number.isNaN(face)) p.x = face;
    this.velocidade.x = 0;
    this._bateuParede = true;
  }

  _moverZ(d) {
    if (d === 0) return;
    const p = this.posicao;
    const novo = p.z + d;
    if (!this._colide(p.x, p.y, novo)) {
      p.z = novo;
      return;
    }
    const face = this._bloqueio(p.x, p.y, novo, 'z', d > 0 ? 1 : -1);
    if (!Number.isNaN(face)) p.z = face;
    this.velocidade.z = 0;
    this._bateuParede = true;
  }

  // ------------------------------------------------------------------
  // Loop principal do jogador
  // ------------------------------------------------------------------

  atualizar(dt) {
    const ativo = this.ativo;
    const p = this.posicao;
    const mundo = this.mundo;

    // Modificadores dos poderes (velocidade, pulo, voar...), lidos uma vez por quadro
    this._mods = this.poderes ? (this.poderes.modificadores() || MODS_VAZIOS) : MODS_VAZIOS;

    // Sem controle (menu aberto): solta os botões do mouse
    if (!ativo) {
      this.botoes[0] = this.botoes[1] = this.botoes[2] = false;
    }

    // Montado (Fase 11): a montaria ainda existe e ainda é minha? (pode ter desmaiado)
    if (this.montaria) this._conferirMontaria(dt);

    // Só mexe na física se o chão sob o jogador já existe
    if (mundo.estaPronto(p.x, p.z)) {
      const yAntes = p.y;
      this._fisica(dt, ativo);
      // (montado não leva dano de queda: a montaria aguenta)
      this._verificarQueda(this.voando || !!this._mods.voar || !!this.montaria, yAntes);
    } else {
      this.velocidade.set(0, 0, 0);
      this._caindo = false;
    }

    // Veneno, lento e fogo (dano de 1 por segundo, partículas)
    this._atualizarEfeitos(dt);

    // Caiu no vazio: volta ao ponto de nascimento
    if (p.y < CONFIG.Y_ABISMO) {
      const s = mundo.pontoDeNascimento();
      this.teletransportar(s.x, s.y, s.z);
    }

    this._atualizarCamera();

    // Ações com os blocos (usa os olhos e a direção do olhar)
    if (ativo) {
      this._acoesDeBloco(dt);
    } else {
      this._limparQuebra();
      this._pararComer();
      this.contorno.visible = false;
    }

    // Nadando deitado: dentro d'água (até o peito) e se mexendo ou boiando
    this.nadando = !this.montaria && !this.voando && !this._mods.voar && this.naAgua && this._aguaNoMeio &&
      (this.velHorizontal > 0.5 || !this.noChao);
    if (!this.naAgua) this.nadando = false;

    // Personagem visível só na 3ª pessoa
    const terceira = this.modoCamera === 'terceira';
    this.personagem.grupo.visible = terceira;
    // Mãozinha: só em 1ª pessoa, sem menu, sem morrer e sem montaria
    const sel = this.inventario.itemSelecionado();
    const itemSel = sel ? obterItem(sel.item) : null;
    this.mao.atualizar(dt, !terceira && ativo && !this.morto && !this.montaria, this.velHorizontal, this.noChao,
      itemSel && itemSel.tipo === 'bloco' ? itemSel.bloco : null);
    if (terceira) {
      this.personagem.planando = this.planando;
      this.personagem.nadando = this.nadando;
      this.personagem.grupo.position.copy(p);
      this.personagem.grupo.rotation.y = this.yaw;
      this.personagem.animar(dt, this.velHorizontal, !this.noChao);
      this.personagem.definirOlhar(this.pitch);
    }
  }

  _fisica(dt, ativo) {
    const p = this.posicao;
    const v = this.velocidade;
    const mundo = this.mundo;
    const t = this.teclas;

    // Está na água? (bloco nos pés ou no meio do corpo)
    const idPes = mundo.obterBloco(p.x, p.y + 0.1, p.z);
    const idMeio = mundo.obterBloco(p.x, p.y + 0.9, p.z);
    this.naAgua = !!(LIQUIDO[idPes] || LIQUIDO[idMeio]);
    this._aguaNoMeio = !!LIQUIDO[idMeio];
    const naAgua = this.naAgua;

    // Direção desejada, a partir do yaw
    let frente = 0, lado = 0;
    let pulando = false, correndo = false;
    if (ativo) {
      if (t.KeyW) frente += 1;
      if (t.KeyS) frente -= 1;
      if (t.KeyD) lado += 1;
      if (t.KeyA) lado -= 1;
      pulando = !!t.Space;
      correndo = !!(t.ShiftLeft || t.ShiftRight);
    }
    const sen = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let dx = -sen * frente + cos * lado;
    let dz = -cos * frente - sen * lado;
    const comp = Math.hypot(dx, dz);
    if (comp > 0) { dx /= comp; dz /= comp; }

    // Montado (Fase 11): a velocidade, o pulo e a caixa são os da montaria
    const mont = this.montaria ? this.montaria.p : null;

    // Planar com a capa: caindo rápido, segurando Espaço (sem montaria, fora d'água)
    const eraPlanando = this.planando;
    this.planando = !mont && !this.voando && !this._mods.voar && ativo && pulando && !naAgua && !this.noChao && this._temCapa() &&
      (eraPlanando || v.y < -CONFIG.PLANAR_VEL_INICIO);
    if (this.planando && !eraPlanando && this.som.asas) this.som.asas();

    // Modo voo: física própria (sem gravidade, sem passos)
    if (!mont && (this.voando || this._mods.voar)) {
      this._fisicaVoando(dt, ativo, dx, dz);
      return;
    }
    // Filhote de dragão: segurando Espaço no ar, voa
    if (mont && mont.voa && this._fisicaFilhote(dt, ativo, dx, dz, pulando)) return;

    // Velocidade básica × bônus da roupa (ninja: +10%)
    // Lento (efeito) corta pela metade; a roupa de pirata acelera o nado
    const lento = this.efeitos.lento > 0 ? CONFIG.EFEITO_LENTO_FATOR : 1;
    const vel = mont
      ? mont.vel * (naAgua ? 0.45 : 1) * lento
      : (naAgua ? CONFIG.VEL_NADAR * (1 + this.bonus.nado) : (correndo ? CONFIG.VEL_CORRER : CONFIG.VEL_ANDAR)) *
        (1 + this.bonus.velocidade) * (this._mods.velocidade || 1) * lento;
    let alvoX = dx * vel;
    let alvoZ = dz * vel;
    let acel = (naAgua ? CONFIG.ACEL_AGUA : (this.noChao ? CONFIG.ACEL_CHAO : CONFIG.ACEL_AR)) * dt * (mont ? 1.5 : 1);
    if (this.planando) {
      // Planando: avança para onde está olhando; olhar para baixo ganha velocidade
      const vp = CONFIG.PLANAR_VEL * (1 + Math.max(0, -this.pitch) * CONFIG.PLANAR_GANHO_PITCH);
      alvoX = -sen * vp;
      alvoZ = -cos * vp;
      acel = CONFIG.PLANAR_ACEL * dt;
    }

    // Aproxima a velocidade horizontal da desejada, de forma suave
    const difX = alvoX - v.x;
    const difZ = alvoZ - v.z;
    const difLen = Math.hypot(difX, difZ);
    if (difLen <= acel) {
      v.x = alvoX;
      v.z = alvoZ;
    } else {
      v.x += (difX / difLen) * acel;
      v.z += (difZ / difLen) * acel;
    }

    // Vertical
    if (naAgua) {
      v.y -= CONFIG.GRAVIDADE_AGUA * dt;
      v.y -= v.y * Math.min(1, CONFIG.ARRASTO_AGUA * dt);
      if (pulando) {
        // Na superfície (cabeça fora da água) dá para pular para fora
        const cabecaNaAgua = LIQUIDO[mundo.obterBloco(p.x, p.y + 1.4, p.z)];
        if (!cabecaNaAgua) {
          if (v.y < CONFIG.VEL_PULO * 0.8) v.y = CONFIG.VEL_PULO * 0.8;
        } else {
          v.y += (CONFIG.VEL_SUBIR_AGUA * (1 + this.bonus.nado) - v.y) * Math.min(1, 8 * dt);
        }
      }
    } else if (this.planando) {
      // Queda lenta: a velocidade vertical é puxada para o limite da capa
      if (v.y < -CONFIG.PLANAR_QUEDA) {
        v.y = Math.min(-CONFIG.PLANAR_QUEDA, v.y + CONFIG.PLANAR_FREIO * dt); // a capa freia a queda
      } else {
        v.y = Math.max(-CONFIG.PLANAR_QUEDA, v.y - CONFIG.GRAVIDADE * dt);
      }
    } else if (mont && mont.sobeParede && this._bateuParede && frente > 0) {
      // Aranha montada andando contra a parede: sobe por ela
      v.y = 3.2;
      this.noChao = false;
    } else {
      v.y -= CONFIG.GRAVIDADE * dt;
      if (v.y < -CONFIG.VEL_MAX_QUEDA) v.y = -CONFIG.VEL_MAX_QUEDA;
      if (pulando && this.noChao) {
        v.y = mont ? mont.vyPulo : CONFIG.VEL_PULO * (this._mods.pulo || 1) * (1 + this.bonus.pulo); // astronauta pula mais
        this.noChao = false;
      } else if (mont && this.noChao && this._bateuParede && frente !== 0) {
        // Montaria encostada num degrau de 1 bloco: sobe sozinha (pulinho)
        v.y = CONFIG.VEL_PULO;
        this.noChao = false;
      }
    }

    this._bateuParede = false;
    this._moverComColisao(dt);

    this.velHorizontal = Math.hypot(v.x, v.z);

    // Passos
    if (this.noChao && !naAgua && this.velHorizontal > 0.5) {
      this.distPasso += this.velHorizontal * dt;
      if (this.distPasso >= CONFIG.DISTANCIA_PASSO) {
        this.distPasso = 0;
        // Roupa silenciosa (ninja): só 1 de cada 3 passos faz barulho
        this._contPassos = (this._contPassos + 1) % 3;
        const toca = !this.bonus.silencioso || this._contPassos === 0;
        const bloco = BLOCOS[mundo.obterBloco(p.x, p.y - 0.1, p.z)];
        if (toca && bloco && bloco.som) this.som.passo(bloco.som);
      }
    } else if (!this.noChao) {
      this.distPasso = 0;
    }
  }

  /** Move o jogador pela velocidade atual, em subpassos (para não atravessar paredes), eixo por eixo */
  _moverComColisao(dt) {
    const v = this.velocidade;
    const ddx = v.x * dt, ddy = v.y * dt, ddz = v.z * dt;
    const maior = Math.max(Math.abs(ddx), Math.abs(ddy), Math.abs(ddz));
    const n = Math.max(1, Math.ceil(maior / PASSO_MAX));
    this.noChao = false;
    this._sairDeDentroDoBloco(); // preso dentro de um bloco: sobe
    for (let i = 0; i < n; i++) {
      this._moverY(ddy / n);
      this._moverX(ddx / n);
      this._moverZ(ddz / n);
    }
  }

  /**
   * Física do voo: WASD move na horizontal, Espaço sobe, Shift desce.
   * Sem gravidade. Ao soltar as teclas a velocidade cai a zero aos poucos
   * (ACEL_VOAR). A colisão continua valendo. Tocar o chão não desliga o voo.
   */
  _fisicaVoando(dt, ativo, dx, dz) {
    const v = this.velocidade;
    const t = this.teclas;
    const vel = CONFIG.VEL_VOAR * (1 + this.bonus.velocidade) * (this._mods.velocidade || 1) *
      (this.efeitos.lento > 0 ? CONFIG.EFEITO_LENTO_FATOR : 1);
    const acel = CONFIG.ACEL_VOAR * dt;

    // Horizontal: aproxima da velocidade desejada
    const alvoX = dx * vel, alvoZ = dz * vel;
    const difX = alvoX - v.x, difZ = alvoZ - v.z;
    const difLen = Math.hypot(difX, difZ);
    if (difLen <= acel) {
      v.x = alvoX;
      v.z = alvoZ;
    } else {
      v.x += (difX / difLen) * acel;
      v.z += (difZ / difLen) * acel;
    }

    // Vertical: Espaço sobe, Shift desce
    let alvoY = 0;
    if (ativo) {
      if (t.Space) alvoY += CONFIG.VEL_VOAR_VERTICAL;
      if (t.ShiftLeft || t.ShiftRight) alvoY -= CONFIG.VEL_VOAR_VERTICAL;
    }
    const difY = alvoY - v.y;
    if (Math.abs(difY) <= acel) v.y = alvoY;
    else v.y += Math.sign(difY) * acel;

    // Não entra num chunk que ainda não carregou (senão atravessaria o terreno)
    const pp = this.posicao;
    const mundo = this.mundo;
    if (v.x !== 0 && !mundo.estaPronto(pp.x + Math.sign(v.x) * 2, pp.z)) v.x = 0;
    if (v.z !== 0 && !mundo.estaPronto(pp.x, pp.z + Math.sign(v.z) * 2)) v.z = 0;
    // Limite de altura: um pouco acima do mundo, e nunca abaixo de 1
    const yMax = CONFIG.ALTURA_MUNDO + 20;
    if (pp.y >= yMax && v.y > 0) v.y = 0;
    if (pp.y <= 1 && v.y < 0) v.y = 0;

    this._moverComColisao(dt);
    if (pp.y > yMax) pp.y = yMax;
    if (pp.y < 1) pp.y = 1;
    // Parado em cima de um bloco também conta como "no chão" (para a animação do boneco)
    const p = this.posicao;
    if (!this.noChao && v.y <= 0 && this._colide(p.x, p.y - 0.05, p.z)) this.noChao = true;
    this.velHorizontal = Math.hypot(v.x, v.z);
    this.distPasso = 0; // sem sons de passo voando
  }

  // ------------------------------------------------------------------
  // Câmera
  // ------------------------------------------------------------------
  _atualizarCamera() {
    const p = this.posicao;
    const cam = this.camera;
    const olhos = this._olhos;
    olhos.set(p.x, p.y + (this.montaria ? this.montaria.p.olhos : CONFIG.ALTURA_OLHOS), p.z);

    // Direção do olhar
    const cp = Math.cos(this.pitch);
    this._dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    cam.rotation.set(this.pitch, this.yaw, 0);

    if (this.modoCamera === 'terceira') {
      // Anda para trás passo a passo até achar um bloco no caminho
      const d = this._dir;
      let dist = CONFIG.DISTANCIA_3A_PESSOA;
      for (let s = 0.1; s <= CONFIG.DISTANCIA_3A_PESSOA; s += 0.1) {
        const id = this.mundo.obterBloco(olhos.x - d.x * s, olhos.y - d.y * s, olhos.z - d.z * s);
        if (SOLIDO[id]) {
          dist = Math.max(0, s - 0.2);
          break;
        }
      }
      cam.position.set(olhos.x - d.x * dist, olhos.y - d.y * dist, olhos.z - d.z * dist);
    } else {
      cam.position.copy(olhos);
    }

    // Tom azul se a câmera estiver dentro da água
    const sub = !!LIQUIDO[this.mundo.obterBloco(cam.position.x, cam.position.y, cam.position.z)];
    if (sub !== this.submerso) {
      this.submerso = sub;
      this.ui.definirSubmerso(sub);
    }
  }

  // ------------------------------------------------------------------
  // Quebrar e colocar blocos
  // ------------------------------------------------------------------
  _limparQuebra() {
    this.temAlvoQuebra = false;
    this.progresso = 0;
    this.tempoGolpe = 0;
    this.rachadura.visible = false;
    this.estagioRachadura = -1;
  }

  _acoesDeBloco(dt) {
    const mundo = this.mundo;
    const alvo = mundo.raycast(this._olhos, this._dir, CONFIG.ALCANCE);

    // Contorno
    if (alvo) {
      this._ajustarCaixa(this.contorno, alvo.x, alvo.y, alvo.z);
      this.contorno.visible = true;
    } else {
      this.contorno.visible = false;
    }

    if (this.espera > 0) this.espera -= dt;
    if (this.tempoColocar > 0) this.tempoColocar -= dt;

    if (this._esperaGolpe > 0) this._esperaGolpe -= dt;

    // ----- Mob na mira (Fase 7): se está mais perto que o bloco, o clique bate nele -----
    const mods = this._mods;
    let golpeMob = null;
    if (this.botoes[0] && !mods.ataque && this.mobs && typeof this.mobs.raycastMob === 'function') {
      // (montarias e pets domados não levam golpe: o raio passa por eles)
      const m = this.mobs.raycastMob(this._olhos, this._dir, CONFIG.ALCANCE_ATAQUE, true);
      if (m && (!alvo || !(alvo.t < m.t))) golpeMob = m;
    }

    // ----- Ataque de poder (fogo, raio, gelo): o botão esquerdo atira e NÃO quebra -----
    if (golpeMob) {
      if (this.temAlvoQuebra) this._limparQuebra();
      if (this._esperaGolpe <= 0) this._baterNoMob(golpeMob);
    } else if (mods.ataque && this.poderes) {
      if (this.botoes[0] && this.poderes.atirar(this._olhos, this._dir)) {
        this.personagem.animarGolpe();
        if (this.som && typeof this.som.tiro === 'function') this.som.tiro(mods.ataque);
      }
      if (this.temAlvoQuebra) this._limparQuebra();
    // ----- Quebrar (botão esquerdo) -----
    } else if (this.botoes[0] && alvo && this.espera <= 0) {
      const mesmo = this.temAlvoQuebra && alvo.x === this.alvoX &&
                    alvo.y === this.alvoY && alvo.z === this.alvoZ;
      if (!mesmo) {
        this._limparQuebra();
        this.temAlvoQuebra = true;
        this.alvoX = alvo.x; this.alvoY = alvo.y; this.alvoZ = alvo.z;
        this.tempoGolpe = 0;
      }
      const bloco = BLOCOS[alvo.id];
      if (bloco.dureza === Infinity) {
        // Bloco inquebrável: sem progresso, sem som e sem rachadura
        this.rachadura.visible = false;
      } else {
        // Poder roxo: quebra na hora (progresso = 1)
        if (mods.quebraInstantanea || this.criativo) this.progresso = 1;
        else this.progresso += dt / Math.max(bloco.dureza, 0.01);
        // Som de golpe
        this.tempoGolpe -= dt;
        if (this.tempoGolpe <= 0) {
          this.tempoGolpe = CONFIG.INTERVALO_GOLPE;
          if (bloco.som) this.som.golpe(bloco.som);
          this.personagem.animarGolpe();
        }
        if (this.progresso >= 1) {
          this._quebrar(alvo, bloco);
        } else {
          this._mostrarRachadura();
        }
      }
    } else if (this.temAlvoQuebra) {
      // Soltou o botão ou trocou de alvo
      this._limparQuebra();
    }

    const shift = !!(this.teclas.ShiftLeft || this.teclas.ShiftRight);

    // Reanimando alguém (Hardcore): o botão direito segurado só serve para isso
    if (this.bloqueioDireito) {
      this._cliqueDireito = false;
      this._pararComer();
      return;
    }

    // ----- Montarias e pet (Fase 11): botão direito num bicho, ou o apito -----
    if (this._cliqueDireito && this.mobs && typeof this.mobs.interagir === 'function' && this._interagirComMob(alvo, shift)) {
      this._cliqueDireito = false;
      this.botoes[2] = false;          // segurar o botão não repete (nem come, nem coloca bloco)
      this.tempoColocar = CONFIG.INTERVALO_COLOCAR;
      this._pararComer();
      return;
    }

    // ----- Comer (botão direito segurado com uma comida na mão) -----
    const mirandoInterativo = !!(alvo && BLOCOS[alvo.id] && BLOCOS[alvo.id].interativo && !shift);
    this._atualizarComer(dt, mirandoInterativo);

    // ----- Colocar (botão direito) -----
    if (this.botoes[2] && this.tempoColocar <= 0 && alvo) {
      const defAlvo = BLOCOS[alvo.id];
      if (defAlvo && defAlvo.interativo && !shift) {
        // Baú e porta: só reagem ao clique (segurar o botão não fica abrindo e fechando)
        if (this._cliqueDireito) this._usarBloco(alvo, defAlvo);
      } else {
        this._colocar(alvo);
      }
    }
    this._cliqueDireito = false;
  }

  // ------------------------------------------------------------------
  // Combate (Fase 7)
  // ------------------------------------------------------------------

  /** Dano extra de força: +1 por nível acima do primeiro (Fase 8) */
  forcaExtra() {
    return this._nivel - 1;
  }

  /** Dano de um golpe: a arma na mão principal do equipamento (ou 1 sem arma) + força */
  _danoDoGolpe() {
    const maoItem = this.equipamento ? this.equipamento.espacos.mao : null;
    const base = (maoItem && obterItem(maoItem) && obterItem(maoItem).dano) || 1;
    return base + this.forcaExtra();
  }

  /** Bate no mob mirado (`m` = { id, t }) e começa a espera até o próximo golpe */
  _baterNoMob(m) {
    this._esperaGolpe = CONFIG.INTERVALO_GOLPE_MOB;
    // Armas de chefão (espada do dragão/hidra) acrescentam fogo ou veneno ao golpe
    const mao = this.equipamento ? this.equipamento.espacos.mao : null;
    const efeitoArma = (mao && obterItem(mao) && obterItem(mao).efeitoArma) || undefined;
    this.mobs.atacar(m.id, this._danoDoGolpe(), this._dir, efeitoArma);
    this.personagem.animarGolpe();
    if (this.som && typeof this.som.golpeMob === 'function') this.som.golpeMob();
  }

  // ------------------------------------------------------------------
  // Comida (Fase 7)
  // ------------------------------------------------------------------

  _pararComer() {
    if (this._tempoComendo > 0 || this._comendoItem) {
      this._tempoComendo = 0;
      this._comendoItem = null;
      if (this.ui.mostrarComendo) this.ui.mostrarComendo(0);
    }
  }

  /** Controla o "segurar o botão direito para comer" (chamado todo quadro) */
  _atualizarComer(dt, mirandoInterativo) {
    const sel = this.botoes[2] && !mirandoInterativo ? this.inventario.itemSelecionado() : null;
    const def = sel ? obterItem(sel.item) : null;
    // Só come comida, e só com a vida abaixo do máximo (a maçã pode sempre)
    if (!def || def.tipo !== 'comida' || (this.vida >= this.vidaMax && def.nome !== 'maca')) {
      this._pararComer();
      return;
    }
    // Trocou de comida no meio: recomeça
    if (this._comendoItem !== sel.item) {
      this._comendoItem = sel.item;
      this._tempoComendo = 0;
    }
    this._tempoComendo += dt;
    if (this._tempoComendo >= CONFIG.TEMPO_COMER) {
      this._comer(def);
      this._tempoComendo = 0;
      this._cliqueDireito = false;
      this.botoes[2] = false; // para comer outra, é preciso apertar de novo
      if (this.ui.mostrarComendo) this.ui.mostrarComendo(0);
      this._comendoItem = null;
    } else if (this.ui.mostrarComendo) {
      this.ui.mostrarComendo(this._tempoComendo / CONFIG.TEMPO_COMER);
    }
  }

  /** Come 1 unidade da comida `def`: cura (ou machuca, se for enjoada) */
  _comer(def) {
    this.inventario.remover(this.inventario.selecionado, 1);
    // Cura sempre; a comida enjoada depois pode tirar 1 (assim nunca mata quem está com 1 de vida)
    this.curar(def.cura || 0);
    if (def.enjoo && Math.random() < def.enjoo && this.vida > 1) this.machucar(1, 'enjoo');
    if (this.som && typeof this.som.comer === 'function') this.som.comer();
    // Migalhas saindo da boca
    if (this.particulas && typeof this.particulas.emitir === 'function') {
      const o = this._olhos, d = this._dir;
      this.particulas.emitir({
        x: o.x + d.x * 0.5, y: o.y - 0.25 + d.y * 0.5, z: o.z + d.z * 0.5,
        qtd: 8, cor: def.cor || '#c98a4b', velocidade: 1.5, espalhar: 0.1,
        gravidade: 9, vida: 0.5, tamanho: 0.06, aditivo: false,
      });
    }
  }

  /** Sorteia os drops extras do bloco (`dropExtra`: um objeto ou lista { item, chance, min, max }) */
  _soltarDropExtra(bloco, alvo) {
    const lista = Array.isArray(bloco.dropExtra) ? bloco.dropExtra : (bloco.dropExtra ? [bloco.dropExtra] : []);
    for (const d of lista) {
      if (!d || !d.item || Math.random() >= (d.chance ?? 1)) continue;
      const min = d.min ?? 1;
      const max = d.max ?? min;
      const qtd = min + Math.floor(Math.random() * (max - min + 1));
      if (qtd <= 0) continue;
      const sobrou = this.inventario.adicionar(d.item, qtd);
      if (sobrou > 0 && this.soltarItem) {
        this.soltarItem(d.item, sobrou, alvo.x + 0.5, alvo.y + 0.3, alvo.z + 0.5, 0, 3, 0);
      }
    }
  }

  /**
   * Põe o contorno (ou a rachadura) na caixa de seleção do bloco: o modelo
   * real (porta fina, tocha), ou o cubo inteiro se o mundo não souber dizer.
   */
  _ajustarCaixa(obj, x, y, z) {
    const c = typeof this.mundo.caixaSelecao === 'function' ? this.mundo.caixaSelecao(x, y, z) : null;
    if (c) {
      obj.position.set(x + (c[0] + c[3]) / 2, y + (c[1] + c[4]) / 2, z + (c[2] + c[5]) / 2);
      obj.scale.set(Math.max(0.05, c[3] - c[0]), Math.max(0.05, c[4] - c[1]), Math.max(0.05, c[5] - c[2]));
    } else {
      obj.position.set(x + 0.5, y + 0.5, z + 0.5);
      obj.scale.set(1, 1, 1);
    }
  }

  /** Botão direito num bloco interativo: abre o baú ou abre/fecha a porta */
  _usarBloco(alvo, def) {
    this.tempoColocar = CONFIG.INTERVALO_COLOCAR;
    if (alvo.id === B.BAU) {
      this._abrirBau(alvo.x, alvo.y, alvo.z);
    } else if (alvo.id === B.FORJA) {
      this._abrirForja(alvo.x, alvo.y, alvo.z);
    } else if (alvo.id === B.MESA_ALFAIATE) {
      this._abrirAlfaiate(alvo.x, alvo.y, alvo.z);
    } else if (def.modelo === 'porta') {
      this._alternarPorta(alvo.x, alvo.y, alvo.z, alvo.id);
    }
  }

  /** Abre a tela da forja (Fase 9). A TelaForja cuida de soltar o mouse e do menuAberto. */
  _abrirForja(x, y, z) {
    if (!this.telaForja || this.telaForja.aberta) return;
    this.personagem.animarGolpe();
    this.telaForja.abrir({
      inventario: this.inventario,
      equipamento: this.equipamento,
      particulas: this.particulas,
      som: this.som,
      posForja: { x, y, z },
      aoFechar: () => {},
    });
  }

  /** Abre a tela da mesa do alfaiate (Fase 10) */
  _abrirAlfaiate(x, y, z) {
    if (!this.telaAlfaiate || this.telaAlfaiate.aberta) return;
    this.personagem.animarGolpe();
    this.telaAlfaiate.abrir({
      inventario: this.inventario,
      equipamento: this.equipamento,
      aparenciaBase: this.obterAparenciaBase ? this.obterAparenciaBase() : null,
      particulas: this.particulas,
      som: this.som,
      posMesa: { x, y, z },
      aoFechar: () => {},
    });
  }

  /** Pede o conteúdo do baú e abre a tela dele */
  _abrirBau(x, y, z) {
    if (!this.baus || this._abrindoBau || typeof this.ui.abrirBau !== 'function') return;
    this._abrindoBau = true;
    this.baus.abrir(x, y, z).then((espacos) => {
      this._abrindoBau = false;
      // Se o baú sumiu enquanto esperava, não abre
      if (this.mundo.obterBloco(x, y, z) !== B.BAU) { this.baus.fechar(x, y, z); return; }
      // Se enquanto isso abriu outro menu (inventário, pausa, chat...), não abre o baú
      if (this.ui.menuAberto || !this.ui.mouseTravado) { this.baus.fechar(x, y, z); return; }
      this.bauAberto = { x, y, z };
      this.personagem.animarGolpe();
      this.ui.abrirBau({
        titulo: 'Baú',
        espacos,
        aoMudarEspaco: (i, v, antes) => this.baus.definirEspaco(x, y, z, i, v, antes),
        aoFechar: () => {
          this.bauAberto = null;
          this.baus.fechar(x, y, z);
        },
      });
    }).catch((erro) => {
      this._abrindoBau = false;
      this.ui.mostrarMensagem((erro && erro.message) || 'Não deu para abrir o baú.');
    });
  }

  /** Muda vários blocos de uma vez ([x, y, z, id, estado]); sem definirBlocos, um por um */
  _definirLote(lista) {
    if (typeof this.mundo.definirBlocos === 'function') {
      this.mundo.definirBlocos(lista, 'local');
    } else {
      for (const b of lista) this.mundo.definirBloco(b[0], b[1], b[2], b[3], 'local', b[4] || 0);
    }
  }

  /** Abre ou fecha a porta: troca o bit "aberta" das duas metades */
  _alternarPorta(x, y, z, id) {
    const estado = this.mundo.obterEstado ? this.mundo.obterEstado(x, y, z) : 0;
    const outroY = (estado & BIT_CIMA) ? y - 1 : y + 1;
    const lista = [[x, y, z, id, estado ^ BIT_ABERTA]];
    if (this.mundo.obterBloco(x, outroY, z) === id) {
      const estadoOutro = this.mundo.obterEstado ? this.mundo.obterEstado(x, outroY, z) : 0;
      lista.push([x, outroY, z, id, estadoOutro ^ BIT_ABERTA]);
    }
    this._definirLote(lista);
    const tipo = BLOCOS[id].som;
    if (tipo) this.som.colocar(tipo);
    this.personagem.animarGolpe();
  }

  /** Direção em que o jogador olha: 0 = -Z, 1 = +X, 2 = +Z, 3 = -X */
  _direcaoOlhar() {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
    return fz < 0 ? 0 : 2;
  }

  _mostrarRachadura() {
    const estagio = Math.min(9, Math.floor(this.progresso * 10));
    this._ajustarCaixa(this.rachadura, this.alvoX, this.alvoY, this.alvoZ);
    this.rachadura.visible = true;
    if (estagio !== this.estagioRachadura && this.texturas && this.texturas.rachaduras) {
      this.estagioRachadura = estagio;
      this.rachaduraMat.map = this.texturas.rachaduras[estagio];
    }
  }

  _quebrar(alvo, bloco) {
    const idAnterior = alvo.id;
    if (bloco.modelo === 'porta') {
      // Porta: tirar uma metade tira as duas (num lote só)
      const estado = this.mundo.obterEstado ? this.mundo.obterEstado(alvo.x, alvo.y, alvo.z) : 0;
      const outroY = (estado & BIT_CIMA) ? alvo.y - 1 : alvo.y + 1;
      const lista = [[alvo.x, alvo.y, alvo.z, B.AR, 0]];
      if (this.mundo.obterBloco(alvo.x, outroY, alvo.z) === idAnterior) lista.push([alvo.x, outroY, alvo.z, B.AR, 0]);
      this._definirLote(lista);
    } else {
      this.mundo.definirBloco(alvo.x, alvo.y, alvo.z, B.AR);
    }
    if (this.criativo) {
      // Criativo: quebra sem dar o item (nem presente, nem drop extra)
      if (bloco.som) this.som.quebrar(bloco.som);
      if (this.particulas) this.particulas.explosaoBloco(alvo.x, alvo.y, alvo.z, idAnterior, this.texturas);
      this._limparQuebra();
      this.espera = CONFIG.ESPERA_APOS_QUEBRAR;
      return;
    }
    if (bloco.item !== null) {
      const sobrou = this.inventario.adicionar(bloco.item, 1);
      if (sobrou > 0) this.ui.mostrarMensagem('Inventário cheio!');
    }
    if (bloco.sorteio === 'presente' && !this._abrirPresente(alvo)) {
      // Nada coube nem caiu no chão: o presente volta ao lugar, sem perder o item
      this.mundo.definirBloco(alvo.x, alvo.y, alvo.z, idAnterior);
      this.ui.mostrarMensagem('Inventário cheio! Libere espaço para abrir o presente.');
      this._limparQuebra();
      this.espera = CONFIG.ESPERA_APOS_QUEBRAR;
      return;
    }
    if (bloco.dropExtra) this._soltarDropExtra(bloco, alvo);
    if (bloco.som) this.som.quebrar(bloco.som);
    if (this.particulas) this.particulas.explosaoBloco(alvo.x, alvo.y, alvo.z, idAnterior, this.texturas);
    this._limparQuebra();
    this.espera = CONFIG.ESPERA_APOS_QUEBRAR;
  }

  /**
   * Presente misterioso: sorteia 1 item da TABELA_PRESENTE.
   * (Aqui pode usar Math.random: é um sorteio do jogo, não a geração do
   * mundo. O lugar dos presentes, esse sim, vem da semente.)
   * Se o inventário estiver cheio, o item cai no chão onde estava o presente.
   */
  _abrirPresente(alvo) {
    const tabela = Array.isArray(TABELA_PRESENTE) ? TABELA_PRESENTE : [];
    if (tabela.length === 0) return true;
    const nome = tabela[Math.floor(Math.random() * tabela.length)];
    const def = obterItem(nome);
    if (!def) return true;
    const sobrou = this.inventario.adicionar(nome, 1);
    let texto = 'Você ganhou: ' + def.rotulo + '!';
    if (sobrou > 0) {
      const caiu = this.soltarItem &&
        this.soltarItem(nome, sobrou, alvo.x + 0.5, alvo.y + 0.3, alvo.z + 0.5, 0, 3, 0);
      if (!caiu) return false; // o item não se perde: quem chamou devolve o presente
      texto += ' (inventário cheio: caiu no chão)';
    }
    this.ui.mostrarMensagem(texto);
    return true;
  }

  /**
   * Solta um item na frente do jogador, com um pequeno impulso na direção
   * do olhar (tecla G, ou arrastando a pilha para fora do inventário).
   * O item já deve ter saído do inventário. Se não der para soltar (sem
   * conexão com o anfitrião, por exemplo), ele volta para o inventário.
   */
  soltarNaFrente(item, qtd) {
    const p = this.posicao;
    const cp = Math.cos(this.pitch);
    const dx = -Math.sin(this.yaw) * cp;
    const dy = Math.sin(this.pitch);
    const dz = -Math.cos(this.yaw) * cp;
    // Sai da altura do peito, um pouco à frente (se a frente for parede,
    // sai de dentro do próprio jogador, que é sempre espaço livre)
    let x = p.x + dx * 0.4;
    let y = p.y + 1.3;
    let z = p.z + dz * 0.4;
    if (SOLIDO[this.mundo.obterBloco(x, y, z)]) {
      x = p.x;
      z = p.z;
    }
    const forca = CONFIG.ITEM_IMPULSO ?? 4.5;
    const ok = this.soltarItem &&
      this.soltarItem(item, qtd, x, y, z, dx * forca, dy * forca + 1.5, dz * forca);
    if (!ok) {
      const sobrou = this.inventario.adicionar(item, qtd);
      if (sobrou > 0) this.ui.mostrarMensagem('Não deu para soltar o item.');
    }
    this.personagem.animarGolpe();
    return !!ok;
  }

  _colocar(alvo) {
    const n = alvo.normal;
    if (n.x === 0 && n.y === 0 && n.z === 0) return; // origem dentro de um bloco

    // O item na mão precisa ser um bloco
    const sel = this.inventario.itemSelecionado();
    if (!sel) return;
    const def = obterItem(sel.item);
    if (!def || def.tipo !== 'bloco' || def.bloco === null) return;

    const x = alvo.x + n.x, y = alvo.y + n.y, z = alvo.z + n.z;
    const destino = this.mundo.obterBloco(x, y, z);
    if (destino !== B.AR && !LIQUIDO[destino]) return;

    const blocoNovo = BLOCOS[def.bloco];
    const modelo = blocoNovo ? blocoNovo.modelo : 'cubo';

    // Bloco sólido não pode nascer dentro do jogador (a porta ocupa 2 blocos de altura)
    if (SOLIDO[def.bloco]) {
      const p = this.posicao;
      const altura = modelo === 'porta' ? 2 : 1;
      const cruza = x < p.x + this._meia && x + 1 > p.x - this._meia &&
                    y < p.y + this._alt && y + altura > p.y &&
                    z < p.z + this._meia && z + 1 > p.z - this._meia;
      if (cruza) return;
    }

    let colocou = false;
    if (modelo === 'porta') {
      // Porta: precisa de 2 blocos livres (baixo e cima); a direção vem do olhar
      const acima = this.mundo.obterBloco(x, y + 1, z);
      if (y + 1 >= CONFIG.ALTURA_MUNDO || (acima !== B.AR && !LIQUIDO[acima])) return;
      const dir = this._direcaoOlhar();
      this._definirLote([[x, y, z, def.bloco, dir], [x, y + 1, z, def.bloco, dir | BIT_CIMA]]);
      colocou = true;
    } else if (modelo === 'tocha') {
      // Tocha: em cima de um bloco = 0; na lateral = parede (1 a 4, o lado onde ela encosta); embaixo não
      if (n.y < 0 || !SOLIDO[alvo.id]) return;
      let estado = 0;
      if (n.y === 0) estado = n.z > 0 ? 1 : (n.x < 0 ? 2 : (n.z < 0 ? 3 : 4));
      colocou = !!this.mundo.definirBloco(x, y, z, def.bloco, 'local', estado);
    } else if (def.bloco === B.BAU) {
      // Baú: a frente vira para o jogador (o contrário de para onde ele olha)
      colocou = !!this.mundo.definirBloco(x, y, z, def.bloco, 'local', (this._direcaoOlhar() + 2) % 4);
    } else {
      colocou = !!this.mundo.definirBloco(x, y, z, def.bloco);
    }

    if (colocou) {
      if (!this.criativo) this.inventario.remover(this.inventario.selecionado, 1); // criativo: blocos infinitos
      const tipo = BLOCOS[def.bloco].som;
      if (tipo) this.som.colocar(tipo);
      this.tempoColocar = CONFIG.INTERVALO_COLOCAR;
      this.personagem.animarGolpe();
    }
  }

  // ------------------------------------------------------------------
  // Montarias (Fase 11)
  // ------------------------------------------------------------------

  /**
   * Botão direito com um bicho na mira (mais perto que o bloco): pergunta aos
   * Mobs o que fazer (domar, osso, sela, armadura, montar, sentar). Com o
   * apito na mão, chama as montarias. Devolve true se o clique foi usado.
   */
  _interagirComMob(alvo, shift) {
    const sel = this.inventario.itemSelecionado();
    const item = sel ? sel.item : null;
    if (item === 'apito') {
      this.mobs.apito();
      this.personagem.animarGolpe();
      return true;
    }
    const mm = this.mobs.raycastMob(this._olhos, this._dir, CONFIG.ALCANCE_ATAQUE);
    if (!mm || (alvo && alvo.t < mm.t)) return false;
    const id = mm.id; // (o resultado do raycast é um objeto reaproveitado)
    const r = this.mobs.interagir(id, item, shift);
    if (!r) return false;
    if (r.gastar > 0 && !this.criativo) this.inventario.remover(this.inventario.selecionado, r.gastar);
    if (r.msg) this.ui.mostrarMensagem(r.msg);
    if (r.acao === 'montar') this._montarEm(id);
    if (r.acao) this.personagem.animarGolpe();
    return true;
  }

  /** R: monta na montaria sua mais perto (com sela) ou desce */
  _alternarMontaria() {
    if (this.montaria) { this.desmontar(); return; }
    if (!this.mobs || typeof this.mobs.montariaPerto !== 'function') return;
    const m = this.mobs.montariaPerto(CONFIG.MONTAR_DIST);
    if (!m) {
      this.ui.mostrarMensagem('Nenhuma montaria sua por perto (chegue a até 3 blocos).');
      return;
    }
    this._montarEm(m.id);
  }

  /** Monta na montaria `id`: o jogador vai para o lugar dela e passa a usar a caixa e a velocidade dela */
  _montarEm(id) {
    if (this.montaria || !this.mobs) return false;
    const r = this.mobs.montar(id);
    if (!r || !r.ok) { if (r && r.msg) this.ui.mostrarMensagem(r.msg); return false; }
    const p = this.mobs.paramsMontaria(r.tipo);
    const m = this.mobs.obterMob(id);
    if (!p || !m) { this.mobs.desmontar(); return false; }
    this.montaria = { id, tipo: r.tipo, p, nome: r.nome || p.nome };
    this.voando = false;               // sai do /voar
    this._meia = p.meia;
    this._alt = p.altura;
    this.teletransportar(m.x, m.y, m.z);
    this._sairDeDentroDoBloco();
    this._vooEnergia = CONFIG.FILHOTE_VOO_S;
    this._vooRecarga = 0;
    this._voandoFilhote = false;
    this._limparQuebra();
    this._pararComer();
    this.ui.mostrarMensagem('Montado! Aperte R para descer.' + (p.voa ? ' Segure Espaço para voar.' : ''));
    return true;
  }

  /**
   * Desce da montaria e fica ao lado dela. `avisar` = false quando quem mandou
   * descer foi o anfitrião (a montaria desmaiou, ou ele não deixou montar).
   */
  desmontar(avisar = true) {
    if (!this.montaria) return;
    const p = this.montaria.p;
    if (avisar && this.mobs) this.mobs.desmontar();
    this.montaria = null;
    this._meia = METADE_LARGURA;
    this._alt = ALTURA;
    this._voandoFilhote = false;
    // Ao lado (esquerda, direita ou atrás); sem espaço, em cima da montaria
    const pos = this.posicao;
    const x0 = pos.x, y0 = pos.y, z0 = pos.z;
    const dist = p.meia + METADE_LARGURA + 0.2;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    let achou = false;
    for (const [dx, dz] of [[-c, s], [c, -s], [s, c]]) {
      const x = x0 + dx * dist, z = z0 + dz * dist;
      for (const subir of [0, 1]) {
        if (!this._colide(x, y0 + subir, z)) { pos.set(x, y0 + subir, z); achou = true; break; }
      }
      if (achou) break;
    }
    if (!achou) pos.set(x0, y0 + p.assento, z0);
    this.velocidade.set(0, 0, 0);
    this._caindo = false;
    this._yTopo = pos.y;
    if (this.ui.mostrarMontaria) this.ui.mostrarMontaria(null);
  }

  /** (Todo quadro, montado) A montaria ainda é minha? E o painel com a vida dela (e o voo do filhote). */
  _conferirMontaria(dt) {
    const mobs = this.mobs;
    const m = mobs ? mobs.obterMob(this.montaria.id) : null;
    if (!m || this.morto || mobs.minhaMontaria !== m) {
      // A montaria desmaiou, sumiu ou o anfitrião desfez: cai dela
      this.desmontar(false);
      return;
    }
    this._tUiMontaria -= dt;
    if (this._tUiMontaria > 0 || !this.ui.mostrarMontaria) return;
    this._tUiMontaria = 0.15;
    const p = this.montaria.p;
    this.ui.mostrarMontaria({
      nome: m.nomeDono || this.montaria.nome,
      vida: m.vidaFrac,
      voo: p.voa ? (this._vooRecarga > 0
        ? { frac: 1 - this._vooRecarga / CONFIG.FILHOTE_RECARGA_S, descansando: true }
        : { frac: this._vooEnergia / CONFIG.FILHOTE_VOO_S, descansando: false }) : null,
    });
  }

  /**
   * Filhote de dragão montado: segurando Espaço no ar, voa (o primeiro toque
   * pula). Sem Espaço, plana devagar; Shift desce. A energia dura 10 s e,
   * quando acaba, ele descansa 20 s. Devolve true se cuidou da física deste quadro.
   */
  _fisicaFilhote(dt, ativo, dx, dz, pulando) {
    if (this._vooRecarga > 0) {
      this._vooRecarga -= dt;
      if (this._vooRecarga <= 0) { this._vooRecarga = 0; this._vooEnergia = CONFIG.FILHOTE_VOO_S; }
      this._voandoFilhote = false;
      return false; // descansando: anda como as outras montarias
    }
    if (!this._voandoFilhote) {
      // no chão a energia volta aos pouquinhos
      if (this.noChao) this._vooEnergia = Math.min(CONFIG.FILHOTE_VOO_S, this._vooEnergia + dt * 0.5);
      if (!(pulando && !this.noChao && this._vooEnergia > 0)) return false;
      this._voandoFilhote = true;
    }
    this._vooEnergia -= dt;
    if (this._vooEnergia <= 0) {
      this._vooEnergia = 0;
      this._voandoFilhote = false;
      this._vooRecarga = CONFIG.FILHOTE_RECARGA_S;
      this.ui.mostrarMensagem('O filhote cansou! Ele precisa descansar 20 s para voar de novo.');
      return false;
    }
    const v = this.velocidade;
    const t = this.teclas;
    const vel = this.montaria.p.vel * 1.15 * (this.efeitos.lento > 0 ? CONFIG.EFEITO_LENTO_FATOR : 1);
    const acel = CONFIG.ACEL_VOAR * dt;
    const alvoX = dx * vel, alvoZ = dz * vel;
    const difX = alvoX - v.x, difZ = alvoZ - v.z;
    const difLen = Math.hypot(difX, difZ);
    if (difLen <= acel) { v.x = alvoX; v.z = alvoZ; } else { v.x += (difX / difLen) * acel; v.z += (difZ / difLen) * acel; }
    const desce = ativo && !!(t.ShiftLeft || t.ShiftRight);
    const alvoY = pulando ? 6 : (desce ? -7 : -1.2);
    v.y += (alvoY - v.y) * Math.min(1, 6 * dt);
    // Não entra num chunk que ainda não carregou; limite de altura
    const pp = this.posicao, mundo = this.mundo;
    if (v.x !== 0 && !mundo.estaPronto(pp.x + Math.sign(v.x) * 2, pp.z)) v.x = 0;
    if (v.z !== 0 && !mundo.estaPronto(pp.x, pp.z + Math.sign(v.z) * 2)) v.z = 0;
    const yMax = CONFIG.ALTURA_MUNDO + 20;
    if (pp.y >= yMax && v.y > 0) v.y = 0;
    this._bateuParede = false;
    this._moverComColisao(dt);
    if (pp.y > yMax) pp.y = yMax;
    if (this.noChao && !pulando) this._voandoFilhote = false; // pousou
    this.velHorizontal = Math.hypot(v.x, v.z);
    this.distPasso = 0;
    return true;
  }

  // ------------------------------------------------------------------
  // Posição, salvar e carregar
  // ------------------------------------------------------------------
  teletransportar(x, y, z) {
    this.posicao.set(x, y, z);
    this.velocidade.set(0, 0, 0);
    this.noChao = false;
    this._caindo = false; // o teletransporte não conta como queda
    this._yTopo = y;
  }

  /** Liga ou desliga o modo criativo (comando /criativo). Devolve o novo estado. */
  definirCriativo(ligado) {
    if (!ligado && this.criativoTravado) return this.criativo; // mundo Criativo: não desliga
    this.criativo = !!ligado;
    this.voando = this.criativo;       // ligar = voa; desligar = volta a andar
    if (this.criativo) this._limparQuebra();
    this._mostrarSeloCriativo(this.criativo);
    return this.criativo;
  }

  /** Mostra ou esconde o selo "CRIATIVO" acima da hotbar (DOM próprio, só visual) */
  _mostrarSeloCriativo(ver) {
    if (typeof document === 'undefined') return;
    if (!this._seloCriativo) {
      if (!ver) return;
      const estilo = document.createElement('style');
      estilo.textContent = `
        #selo-criativo {
          position: fixed; left: 50%; transform: translateX(-50%); bottom: 142px;
          padding: 2px 10px; background: rgba(0,0,0,0.55); border: 2px solid #000;
          color: #ffd84a; font-family: var(--fonte-pixel, monospace); font-size: 10px;
          letter-spacing: 2px; text-shadow: 2px 2px 0 #3f3f3f;
          pointer-events: none; z-index: 6;
        }`;
      document.head.appendChild(estilo);
      const el = document.createElement('div');
      el.id = 'selo-criativo';
      el.textContent = 'CRIATIVO';
      document.body.appendChild(el);
      this._seloCriativo = el;
    }
    this._seloCriativo.style.display = ver ? 'block' : 'none';
  }

  serializar() {
    // Hardcore caído: salva no lugar do corpo, já "reanimado" com metade da vida
    if (this.morto && this.caido) {
      return {
        pos: [this.posicao.x, this.posicao.y, this.posicao.z], yaw: this.yaw, pitch: this.pitch,
        vida: Math.max(1, Math.round(this.vidaMax * CONFIG.REANIMAR_VIDA)), xpTotal: this.xpTotal,
      };
    }
    // Morto: salva a casa (ou nascimento) com a vida cheia, para não reabrir no lugar da morte
    if (this.morto && this.obterPosRenascer) {
      const r = this.obterPosRenascer();
      if (Array.isArray(r) && r.length === 3 && r.every(Number.isFinite)) {
        return { pos: [r[0], r[1], r[2]], yaw: this.yaw, pitch: this.pitch, vida: this.vidaMax, xpTotal: this.xpTotal };
      }
    }
    return {
      pos: [this.posicao.x, this.posicao.y, this.posicao.z],
      yaw: this.yaw,
      pitch: this.pitch,
      vida: this.vida,
      xpTotal: this.xpTotal,
      criativo: this.criativo || undefined, // só entra no save quando ligado
    };
  }

  carregar(dados) {
    if (!dados) return;
    if (Array.isArray(dados.pos) && dados.pos.length === 3 && dados.pos.every(Number.isFinite)) {
      this.teletransportar(dados.pos[0], dados.pos[1], dados.pos[2]);
    }
    if (Number.isFinite(dados.yaw)) this.yaw = dados.yaw;
    if (Number.isFinite(dados.pitch)) {
      this.pitch = Math.max(-LIMITE_PITCH, Math.min(LIMITE_PITCH, dados.pitch));
    }
    // XP salvo (sem festa de nível: é só carregar)
    this._definirXp(dados.xpTotal);
    // Vida salva (saves antigos não têm: ficam com a vida cheia). Nunca carrega "morto".
    if (Number.isFinite(dados.vida) && dados.vida > 0) {
      this.vida = Math.min(this.vidaMax, dados.vida);
    } else {
      this.vida = this.vidaMax;
    }
    this.atualizarHud();
    // Criativo salvo (saves antigos não têm: ficam desligados)
    if (dados.criativo === true) this.definirCriativo(true);
  }
}
