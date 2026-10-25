// =====================================================================
// Hackraft - Programa principal
// ---------------------------------------------------------------------
// O caminho do jogo:
//   1) Cria o renderizador, a cena e a câmera, as texturas, o inventário
//      e a interface. Mostra a tela inicial. O mundo AINDA NÃO existe.
//   2) O jogador escolhe:
//      - "Criar sala": vira ANFITRIÃO. O mundo vem do save deste
//        navegador. Sem internet, joga sozinho do mesmo jeito.
//      - "Entrar" (com o código): vira CLIENTE. O mundo vem do anfitrião
//        e NADA é salvo neste navegador (senão o mundo do anfitrião
//        apagaria o mundo de quem está entrando).
//   3) Monta o mundo, o céu, o jogador e os bonecos dos outros, liga a
//      rede e começa o loop do jogo.
//
// APARÊNCIA (Fase 3)
//   A aparência completa de um jogador = as cores da skin base (de cada
//   navegador, editadas na tela C) + o que ele está vestindo (Equipamento).
//   Sempre que uma das duas muda, aplicarAparencia() atualiza o boneco,
//   o preview da interface e manda para os outros jogadores.
//
// CHAT, COMANDOS E /HACKER (Fase 4)
//   O Chat (tecla T) manda as mensagens normais para a rede e executa os
//   comandos (/dia, /voar, /tp...). Os comandos recebem um "ctx" com as
//   peças do jogo (veja registrarComandos em comandos.js). O ModoHacker
//   cuida dos efeitos de tela do /hacker. A música troca entre dia e noite.
//
// VIDA, PODERES E PARTÍCULAS (Fase 5)
//   O Jogador tem vida (morre e volta para casa). Os cristais ativam poderes
//   (Poderes) e as Particulas desenham pedacinhos, brilhos e efeitos.
//   Este arquivo liga as peças e roda: poderes.atualizar, particulas.atualizar,
//   os brilhinhos dos minérios.
//
// FORJA, XP E EFEITOS (Fases 8 a 10)
//   A TelaForja abre com o botão direito num bloco FORJA (o Jogador cuida do
//   clique). O XP dos mobs vira nível (jogador.ganharXp), o dano dos mobs pode
//   trazer um efeito (veneno, lento, fogo) e as forjas perto de você soltam fogo.
//
// MONTARIAS E PET (Fase 11)
//   Quem anda com a montaria é o Jogador (player.js); os Mobs guardam o dono,
//   a sela e quem está montado. Depois de mover os bonecos dos outros
//   (remotos.atualizar), mobs.posicionarCavaleiros põe cada cavaleiro sentado
//   no assento. Os ovos de dragão chocando soltam faíscas (e estalam no fim).
//   O save (versão 9) guarda as montarias, os pets e os ovos.
// =====================================================================

import * as THREE from 'three';
import { CONFIG, CICLO_SEGUNDOS, MODO_TOQUE } from './config.js';
import { ControlesToque } from './touch.js';
import { criarTexturas } from './textures.js';
import { Inventario } from './inventory.js';
import { Equipamento } from './equipamento.js';
import { InterfaceJogo } from './ui.js';
import { Mundo } from './world.js';
import { Ceu } from './sky.js';
import { Personagem, coresPorApelido } from './character.js';
import { Jogador } from './player.js';
import { JogadoresRemotos } from './jogadores_remotos.js';
import { ItensNoChao, quantoCabe } from './itens_chao.js';
import { Rede } from './network.js';
import { Chat } from './chat.js';
import { registrarComandos } from './comandos.js';
import { ModoHacker } from './hacker.js';
import { Particulas } from './particulas.js';
import { Poderes } from './powers.js';
import { Meteoro } from './meteoro.js';
import { Baus } from './baus.js';
import { TelaForja } from './forja.js';
import { TelaAlfaiate } from './alfaiate.js';
import { Minimapa } from './minimapa.js';
import { som } from './audio.js';
import { B, BLOCOS, SOLIDO, LIQUIDO } from './blocks.js';
import { salvarJogo, carregarJogo, apagarJogo } from './save.js';

// Celular (Fase 12): a classe "modo-toque" liga o CSS próprio do toque
// (hotbar clicável, chat no topo, aviso "gire o celular", botões "Mover tudo"...)
if (MODO_TOQUE) document.body.classList.add('modo-toque');

const NOMES_MODO = { sozinho: 'sozinho', anfitriao: 'anfitrião', cliente: 'cliente' };
const CHAVES_CORES = ['pele', 'cabelo', 'olhos', 'camisa', 'calca', 'sapato'];

/** Só as cores conhecidas, e só se forem textos curtos (vêm do localStorage) */
function limparCores(c) {
  const r = {};
  if (!c || typeof c !== 'object') return r;
  for (const k of CHAVES_CORES) {
    if (typeof c[k] === 'string' && c[k].length <= 32) r[k] = c[k];
  }
  return r;
}

// Mostra um erro na tela de carregamento (usa a UI se ela já existir)
let ui = null;
function mostrarErro(erro) {
  console.error(erro);
  const texto = 'Erro: ' + (erro && erro.message ? erro.message : erro);
  if (ui) {
    ui.mostrarCarregando(texto);
  } else {
    const caixa = document.getElementById('carregando');
    const p = document.getElementById('carregando-texto');
    if (p) p.textContent = texto;
    if (caixa) caixa.classList.remove('oculto');
  }
}

/**
 * Espera o navegador desenhar um quadro (para um texto aparecer na tela).
 * Com a aba escondida o navegador não desenha nada, então esperamos no
 * máximo 100 ms para não travar a montagem do mundo.
 */
function esperarUmQuadro() {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Procura um lugar livre perto de (x0, y0, z0): chão firme embaixo e dois
 * blocos de ar (pés e cabeça), fora da água. Serve para quem entra nascer
 * AO LADO do anfitrião, e não dentro dele. Devolve [x, y, z] nos pés.
 */
function lugarLivrePerto(mundo, x0, y0, z0) {
  const bx = Math.floor(x0);
  const by = Math.floor(y0);
  const bz = Math.floor(z0);
  const livre = (x, y, z) => {
    const pes = mundo.obterBloco(x, y, z);
    const cabeca = mundo.obterBloco(x, y + 1, z);
    return SOLIDO[mundo.obterBloco(x, y - 1, z)] && !SOLIDO[pes] && !SOLIDO[cabeca] && !LIQUIDO[pes];
  };
  // Anéis quadrados em volta do anfitrião: distância 2, depois 1, 3, 4
  for (const r of [2, 1, 3, 4]) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // só a borda do anel
        // Um pouco acima e abaixo da altura do anfitrião (morros)
        for (let dy = 2; dy >= -3; dy--) {
          const x = bx + dx, y = by + dy, z = bz + dz;
          if (y < 1 || y + 2 >= CONFIG.ALTURA_MUNDO) continue;
          if (livre(x, y, z)) return [x + 0.5, y, z + 0.5];
        }
      }
    }
  }
  return [x0, y0, z0]; // não achou: nasce no mesmo lugar (jogadores não colidem entre si)
}

/**
 * Direção do empurrão ao levar um golpe. `de` pode ser a posição do mob
 * ([x, y, z] ou {x, y, z}); o empurrão vai da posição dele para o jogador.
 */
const _dirGolpe = { x: 0, y: 0, z: 0 };
function direcaoDoGolpe(jogador, de) {
  let mx, mz;
  if (Array.isArray(de)) { mx = de[0]; mz = de[2]; } else if (de) { mx = de.x; mz = de.z; }
  if (!Number.isFinite(mx) || !Number.isFinite(mz)) return null;
  _dirGolpe.x = jogador.posicao.x - mx;
  _dirGolpe.z = jogador.posicao.z - mz;
  return _dirGolpe;
}

async function iniciar() {
  // ----- Renderizador, cena e câmera -----
  const canvas = document.getElementById('tela');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  // Celular (modo toque): a tela tem MUITOS pixels (devicePixelRatio 2 a 4)
  // e o processador é mais fraco. Desenhar com no máximo 1.25 pixel por
  // ponto da página deixa a imagem um pouco menos nítida, mas o jogo fica
  // bem mais rápido. (A distância de visão menor do celular já foi aplicada
  // no config.js, porque o world.js lê esse número assim que é carregado.)
  const pixelRatioMax = MODO_TOQUE ? CONFIG.TOQUE.PIXEL_RATIO_MAX : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioMax));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    CONFIG.CAMPO_DE_VISAO, window.innerWidth / window.innerHeight, 0.05, CONFIG.CAMERA_LONGE);

  const ajustarTamanho = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', ajustarTamanho);
  if (MODO_TOQUE) {
    // Girar o celular: alguns navegadores (Safari) avisam ANTES de a página
    // mudar de tamanho, então ajustamos agora e de novo um pouco depois.
    const aoGirar = () => {
      ajustarTamanho();
      setTimeout(ajustarTamanho, 300);
    };
    window.addEventListener('orientationchange', aoGirar);
    if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
      screen.orientation.addEventListener('change', aoGirar);
    }
  }

  // ----- Texturas, inventário, equipamento e interface -----
  // (a tela de carregamento do index.html já começa visível, com "Carregando...")
  const texturas = await criarTexturas();
  const inventario = new Inventario();
  const equipamento = new Equipamento();
  ui = new InterfaceJogo({ inventario, equipamento, texturas, canvas });
  const chat = new Chat({ ui });
  const telaForja = new TelaForja({ ui, texturas }); // Fase 9: a tela da forja (já conta como menu aberto)
  const telaAlfaiate = new TelaAlfaiate({ ui, texturas }); // Fase 10: a mesa do alfaiate

  // ----- Estado da partida (preenchido quando o jogo é montado) -----
  let rede = null;          // Rede (modo 'sozinho', 'anfitriao' ou 'cliente')
  let jogo = null;          // { semente, mundo, ceu, personagem, jogador, remotos, itensChao }
  let montando = false;     // evita montar duas vezes (clique duplo)
  let impedirSalvar = false; // ligado no "Novo mundo", senão o mundo velho voltaria
  let ultimoAvisoSalvar = -Infinity; // quando avisamos do save cheio pela última vez
  let aparenciaBase = null; // cores da skin base deste navegador (definidas ao entrar no jogo)
  let modoMundo = 'sobrevivencia'; // 'sobrevivencia' | 'criativo' | 'hardcore' (do save ou do anfitrião)
  let fimDeJogoMostrado = false;   // Hardcore: a tela "Fim de jogo" já apareceu

  // ----- Aparência (cores da skin + equipamento) -----

  /**
   * Cores da skin base: as que foram salvas na tela C (a UI guarda no
   * localStorage 'hackraft-aparencia') ou, se nunca mexeram, as cores
   * escolhidas pelo apelido.
   */
  function lerAparenciaBase(apelido) {
    const padrao = coresPorApelido(apelido);
    const salvas = ui.aparenciaBase;
    if (salvas && typeof salvas === 'object') return { ...padrao, ...limparCores(salvas) };
    return padrao;
  }

  /** A aparência completa: { cores, roupa, armadura, mao, acessorio } */
  function aparenciaCompleta() {
    return { cores: { ...aparenciaBase }, ...equipamento.aparencia() };
  }

  /** Atualiza o boneco, o preview da interface e avisa os outros jogadores */
  function aplicarAparencia() {
    if (!aparenciaBase) return; // o jogo ainda não começou
    const ap = aparenciaCompleta();
    if (jogo) jogo.personagem.definirAparencia(ap);
    ui.definirAparenciaPreview(ap);
    if (rede) rede.enviarAparencia(ap);
  }

  // Trocar de roupa/armadura (pela tela E ou pelos comandos) muda o boneco na hora
  equipamento.aoMudar(() => aplicarAparencia());

  ui.definirCallbacks({
    // A UI já tirou o item do inventário: ele vai para o chão, na frente do jogador
    aoSoltarItem(item, qtd) {
      if (jogo) jogo.jogador.soltarNaFrente(item, qtd);
      else inventario.adicionar(item, qtd); // (sem jogo ainda: devolve)
    },
    // Q ou duplo clique num cristal: usa o poder (quem consome o item é o Poderes.usar)
    aoUsarItem(nome) {
      return !!(jogo && jogo.poderes && jogo.poderes.usar(nome));
    },
    // Salvou novas cores na tela C (a UI já guardou no localStorage)
    aoMudarAparenciaBase(cores) {
      if (!aparenciaBase) return; // ainda na tela inicial: as cores são lidas ao entrar
      aparenciaBase = { ...aparenciaBase, ...limparCores(cores) };
      aplicarAparencia();
    },
  });

  // ----- Salvamento (só anfitrião ou sozinho; o cliente NUNCA salva) -----
  function podeSalvar() {
    return !!jogo && !!rede && rede.modo !== 'cliente' && !impedirSalvar;
  }

  function salvar() {
    if (!podeSalvar()) return false;
    const ok = salvarJogo({
      versao: 10,
      modoMundo, // 'sobrevivencia' | 'criativo' | 'hardcore'
      // Fase 11: montarias e pets domados, e os ovos de dragão chocando
      montarias: jogo.mobs && typeof jogo.mobs.exportarMontarias === 'function' ? jogo.mobs.exportarMontarias() : [],
      ovos: jogo.mobs && typeof jogo.mobs.exportarOvos === 'function' ? jogo.mobs.exportarOvos() : [],
      baus: jogo.baus.exportar(),
      semente: jogo.semente,
      modificacoes: jogo.mundo.exportarModificacoes(),
      jogador: jogo.jogador.serializar(),
      inventario: inventario.serializar(),
      hora: jogo.ceu.hora,
      jogadores: rede.exportarDadosJogadores(),
      equipamento: equipamento.serializar(),
      itensChao: jogo.itensChao.exportar(),
      casa: rede.casa, // [x, y, z] ou null (comando /setcasa do anfitrião)
    });
    // Save cheio: avisa, no máximo uma vez a cada 60 s
    if (!ok && performance.now() - ultimoAvisoSalvar > 60000) {
      ultimoAvisoSalvar = performance.now();
      ui.mostrarMensagem('Não foi possível salvar o mundo (sem espaço no navegador).');
    }
    return ok;
  }

  // Ao fechar/ocultar a página, o item da mão volta ao inventário antes de salvar
  function salvarSaindo() {
    if (!podeSalvar()) return;
    ui.devolverMao();
    salvar();
  }

  // Pausa > "Sair para o menu": salva, desconecta da sala e volta à tela inicial
  function sairParaMenu() {
    salvarSaindo();
    impedirSalvar = true;   // o beforeunload não salva de novo
    if (rede) rede.encerrar();
    location.reload();
  }

  function novoMundo() {
    if (rede && rede.modo === 'cliente') {
      ui.mostrarMensagem('Só o anfitrião pode criar um mundo novo.');
      return;
    }
    impedirSalvar = true;
    apagarJogo();
    if (rede) rede.encerrar();
    location.reload();
  }

  /**
   * Monta a função `obterJogadores()` dos mobs: [{ id, apelido, posicao, local, defesa, morto }]
   * (o meu também tem `yaw` e `noAr`: a montaria em que estou segue o meu jogador).
   * Os objetos são reaproveitados (nada de lixo no loop). A lista de quem está
   * na sala é relida só a cada 1 s; as posições são lidas a cada chamada.
   */
  function criarListaDeJogadores(jogador, remotos) {
    const lista = [];
    const cache = new Map();          // id -> objeto reaproveitado
    let ids = [];
    let ultimaLeitura = -Infinity;
    const obter = (id) => {
      let o = cache.get(id);
      if (!o) { o = { id, apelido: '', posicao: null, local: false, defesa: 0, morto: false, yaw: 0, noAr: false }; cache.set(id, o); }
      return o;
    };
    return () => {
      const agora = performance.now();
      if (agora - ultimaLeitura > 1000) {
        ultimaLeitura = agora;
        const l = rede ? rede.listaJogadores() : [];
        ids = l.map((j) => j.id);
        for (const j of l) obter(j.id).apelido = j.apelido; // o dono das montarias é o apelido
      }
      lista.length = 0;
      const meuId = rede && rede.meuId ? rede.meuId : 'local';
      const eu = obter(meuId);
      eu.posicao = jogador.posicao;
      eu.local = true;
      eu.defesa = jogador.bonus ? jogador.bonus.defesa : 0;
      eu.morto = jogador.morto; // o local fica SEMPRE na lista (os mobs usam a posição para som e distância)
      eu.apelido = rede ? rede.apelido : '';
      eu.yaw = jogador.yaw;
      eu.noAr = !jogador.noChao && !jogador.naAgua;
      lista.push(eu);
      for (const id of ids) {
        if (id === meuId) continue;
        const pos = remotos.posicaoDe(id);
        if (!pos) continue;
        const o = obter(id);
        o.posicao = pos;
        o.local = false;
        // Morto na tela de morte? (a rede manda junto com a posição, Fase 8)
        o.morto = !!(rede && typeof rede.estaMorto === 'function' && rede.estaMorto(id));
        // A defesa dos outros jogadores: se a rede souber, usa; senão 0
        o.defesa = (rede && typeof rede.defesaDe === 'function' ? rede.defesaDe(id) : 0) || 0;
        lista.push(o);
      }
      return lista;
    };
  }

  // ----- Montagem do jogo (depois da escolha na tela inicial) -----
  async function montarJogo({ apelido, semente, modificacoes, hora }) {
    ui.mostrarCarregando('Gerando o mundo...');
    await esperarUmQuadro(); // deixa o texto aparecer

    const mundo = new Mundo(scene, texturas, semente);
    if (Array.isArray(modificacoes)) mundo.carregarModificacoes(modificacoes);

    const ceu = new Ceu(scene);
    if (typeof hora === 'number' && Number.isFinite(hora)) ceu.definirHora(hora);

    // O boneco começa com as cores da skin base (a roupa vem em aplicarAparencia)
    aparenciaBase = lerAparenciaBase(apelido);
    const personagem = new Personagem(aparenciaBase);
    const itensChao = new ItensNoChao({ scene, mundo, texturas });
    const particulas = new Particulas({ scene, mundo });
    // Baús (Fase 6): o conteúdo mora no anfitrião; a rede (já criada) transporta
    const baus = new Baus({ mundo, rede, itensChao });
    const jogador = new Jogador({
      camera, scene, mundo, inventario, ui, som, personagem, texturas, equipamento, particulas, baus, telaForja, telaAlfaiate,
      // No multiplayer, quem cria o item no chão é o anfitrião: passa pela rede
      soltarItem: (item, qtd, x, y, z, vx, vy, vz) => rede.soltarItem(item, qtd, x, y, z, vx, vy, vz),
    });
    jogador.obterAparenciaBase = () => ({ ...aparenciaBase });
    const remotos = new JogadoresRemotos(scene);

    // Poderes dos cristais (precisam do jogador, dos bonecos remotos e da rede)
    const poderes = new Poderes({
      jogador, mundo, scene, camera, particulas, som, ui, inventario, rede, remotos, texturas,
    });
    jogador.poderes = poderes;

    // Mobs (Fase 7). Import dinâmico: se o módulo falhar, o jogo continua sem mobs.
    let mobs = null;
    try {
      const modulo = await import('./mobs.js');
      if (typeof modulo.Mobs === 'function') {
        mobs = new modulo.Mobs({
          scene, mundo, ceu, rede, particulas, som, itensChao, ui,
          obterJogadores: criarListaDeJogadores(jogador, remotos),
        });
      }
    } catch (erro) {
      console.warn('Hackraft: mobs indisponíveis.', erro);
    }
    jogador.mobs = mobs;

    jogo = { semente, mundo, ceu, personagem, jogador, remotos, itensChao, particulas, poderes, baus, mobs };
  }

  // Depois de posicionar o jogador: liga a rede, expõe para depuração e começa o loop
  function comecar() {
    const { mundo, ceu, jogador, remotos, itensChao, particulas, poderes, baus, mobs } = jogo;
    aplicarAparencia();

    // ----- Mobs (Fase 7): alvos dos poderes, dano em mim e XP -----
    if (mobs) {
      poderes.registrarAlvos(() => mobs.alvosParaPoderes());
      // O dano chega do anfitrião; a armadura reduz (cada ponto de defesa tira 4%)
      mobs.aoDanoJogador(({ qtd, de, efeito }) => {
        if (jogador.criativo) return; // /criativo: sem dano e sem veneno/lento/fogo
        const reducao = Math.min(CONFIG.DEFESA_MAX_REDUCAO, (jogador.bonus.defesa || 0) * CONFIG.DEFESA_POR_PONTO);
        jogador.machucar(qtd * (1 - reducao), { direcao: direcaoDoGolpe(jogador, de) });
        // O golpe pode trazer um efeito: 'veneno' | 'lento' | 'fogo' (texto) ou { tipo, segundos }
        if (efeito) {
          if (typeof efeito === 'string') jogador.aplicarEfeito(efeito);
          else jogador.aplicarEfeito(efeito.tipo, efeito.segundos);
        }
      });
      // XP por matar mobs: soma no total e pode subir de nível
      mobs.aoXp((qtd) => {
        jogador.ganharXp(qtd);
        ui.mostrarXp(qtd);
      });
    }

    // ----- Baús: mudanças de outros jogadores e baú quebrado com a tela aberta -----
    baus.aoMudar((x, y, z, i, valor) => {
      const ab = jogador.bauAberto;
      if (ab && ab.x === x && ab.y === y && ab.z === z && ui.bauAberto) {
        const espacos = baus.obter(x, y, z);
        if (espacos) ui.atualizarBau(espacos);
      }
    });
    // O anfitrião recusou uma mudança minha (alguém mexeu no mesmo espaço): desfaz o efeito
    baus.aoRecusar(({ x, y, z, antes, valor, atual }) => {
      // Descobre o que eu TIREI do baú e o que eu COLOQUEI
      let tirado = null, colocado = null;
      if (antes && valor && antes.item === valor.item) {
        if (valor.qtd < antes.qtd) tirado = { item: antes.item, qtd: antes.qtd - valor.qtd };
        else if (valor.qtd > antes.qtd) colocado = { item: antes.item, qtd: valor.qtd - antes.qtd };
      } else {
        tirado = antes;      // item A saiu (ou o espaço foi esvaziado)
        colocado = valor;    // item B entrou (ou o espaço estava vazio)
      }
      if (tirado) ui.removerItensDoJogador(tirado.item, tirado.qtd);
      if (colocado) ui.devolverAoJogador(colocado.item, colocado.qtd);
      const ab = jogador.bauAberto;
      if (ab && ab.x === x && ab.y === y && ab.z === z && ui.bauAberto) {
        const espacos = baus.obter(x, y, z);
        if (espacos) ui.atualizarBau(espacos);   // mostra o valor de verdade
      }
      ui.mostrarMensagem('Alguém mexeu nesse espaço ao mesmo tempo!');
    });
    mundo.aoAlterarBloco((ev) => {
      const ab = jogador.bauAberto;
      if (!ab || !ui.bauAberto) return;
      let quebrou = false;
      if (ev.lote && Array.isArray(ev.lista)) {
        for (const b of ev.lista) if (b[0] === ab.x && b[1] === ab.y && b[2] === ab.z && b[3] !== B.BAU) quebrou = true;
      } else if (ev.x === ab.x && ev.y === ab.y && ev.z === ab.z && ev.id !== B.BAU) {
        quebrou = true;
      }
      if (quebrou) {
        jogador.bauAberto = null;
        ui.fecharBau(true);
      }
    }); // boneco, preview e rede com a roupa certa

    // ----- Chat e avisos da rede (registrar ANTES de rede.ligar) -----
    // Mensagem de chat de qualquer jogador (inclusive a minha, de volta)
    rede.aoChat((m) => chat.adicionarMensagem({ de: m.apelido, texto: m.texto, tipo: 'jogador' }));
    // "X entrou", "X saiu", "X mudou para noite" também vão para o chat
    rede.aoAviso((texto) => chat.adicionarMensagem({ de: '', texto, tipo: 'sistema' }));
    // Texto normal (sem /) digitado no chat vai para a rede (sozinho: só aparece aqui)
    chat.aoEnviarMensagem((texto) => rede.enviarChat(texto));
    rede.ligar({
      mundo, ceu, jogador, inventario, remotos, ui, equipamento, itensChao,
      aoPegarItem: () => som.golpe('folhas'), // um "plim" curtinho ao pegar um item
      poderes,
    });
    // Os poderes ativos em mim vão para os outros jogadores (aura)
    poderes.aoMudarAtivos((lista) => rede.enviarPoderes(lista));

    // O jogador local pega os itens do chão (se couber no inventário).
    // Quem decide se ele ganha mesmo o item é a rede (o anfitrião).
    itensChao.definirColetor({
      posicao: jogador.posicao,
      podePegar: (item) => quantoCabe(inventario, item) > 0,
      aoPegar: (entrada) => rede.pegarItem(entrada),
    });

    // ----- Modo hacker e comandos do chat -----
    const hacker = new ModoHacker({ equipamento, mundo, scene, camera, chat, som, ui });

    /** Casa salva (vai no save do anfitrião ou no meuEstado do cliente) ou o ponto de nascimento */
    const obterCasa = () => {
      if (rede.casa) return rede.casa.slice();
      const n = mundo.pontoDeNascimento();
      return [n.x, n.y, n.z];
    };

    // Se salvar morto, o save guarda a casa (não o lugar da morte)
    jogador.obterPosRenascer = obterCasa;

    // Fase 11: a montaria/pet desmaiado volta para a casa do dono
    if (mobs) {
      mobs.obterCasaDe = (apelido) => {
        if (apelido === rede.apelido) return obterCasa();
        return rede.casaDe(apelido) || obterCasa();
      };
    }

    // ----- Tipo de mundo (Sobrevivência, Criativo ou Hardcore) -----
    ui.definirModoMundo(modoMundo);
    if (modoMundo === 'criativo') {
      // Mundo Criativo: todos voam, têm blocos infinitos e o /criativo não desliga
      jogador.criativoTravado = true;
      jogador.definirCriativo(true);
    }

    /** Hardcore: todos caíram. O anfitrião apaga o mundo; todos veem "Fim de jogo". */
    const fimDeJogo = () => {
      if (fimDeJogoMostrado) return;
      fimDeJogoMostrado = true;
      if (rede.modo !== 'cliente') {
        impedirSalvar = true; // nada de salvar de novo (nem ao fechar a página)
        apagarJogo();
        rede.enviarFimDeJogo();
      }
      ui.mostrarFimDeJogo('Todos caíram. O mundo Hardcore foi apagado.', () => {
        impedirSalvar = true;
        if (rede) rede.encerrar();
        location.reload();
      });
    };
    rede.aoFimDeJogo(fimDeJogo);

    // Fui reanimado por outro jogador: volto no lugar onde caí, com metade da vida
    rede.aoReanimado((por) => {
      if (!jogador.morto || !jogador.caido) return;
      jogador.reviver();
      ui.esconderCaido(true);
      ui.mostrarMensagem((por || 'Alguém') + ' te reanimou!');
    });

    // ----- Vida: ao morrer, mostra a tela e volta para casa com a vida cheia -----
    jogador.atualizarHud(); // corações e barra de XP
    jogador.aoMorrer(() => {
      // Hardcore: não renasce. Fica caído até alguém reanimar (ou fim de jogo se todos caírem)
      if (modoMundo === 'hardcore') {
        jogador.caido = true;
        if (rede.modo !== 'cliente' && rede.todosCaidos()) fimDeJogo();
        else ui.mostrarCaido({ aoSair: sairParaMenu });
        return;
      }
      ui.mostrarMorte({
        aoRenascer: () => {
          const [cx, cy, cz] = obterCasa();
          mundo.prepararArea({ x: cx, y: cy, z: cz }, 1); // o chão da casa precisa existir
          jogador.teletransportar(cx, cy, cz);
          jogador.renascer();
        },
      });
    });

    // ----- Meteoro (/armageddon) -----
    const meteoro = new Meteoro({
      scene, mundo, particulas, jogador, rede, som, ui,
      obterAlvos: () => (mobs ? mobs.alvosParaPoderes() : []),
    });
    // Meteoro lançado por outro jogador: só desenha e sente o impacto
    poderes.aoMeteoroRemoto = (x, y, z, hx, hz) => meteoro.cair(x, y, z, false, null, hx, hz);

    /** Aceita [x, y, z] ou { x, y, z } (os comandos mandam uma lista) */
    const lerPos = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p);
    registrarComandos(chat, {
      jogador, ceu, rede, remotos, inventario, equipamento, hacker, mundo, meteoro,
      // Muda a hora: a rede aplica (anfitrião/sozinho) ou pede ao anfitrião (cliente)
      mudarHora: (segundos) => rede.pedirHora(segundos),
      obterCasa,
      definirCasa: (pos) => {
        const p = lerPos(pos);
        rede.definirCasa([p.x, p.y, p.z]);
        if (rede.modo !== 'cliente') salvar();
      },
    });

    // ----- Minimapa (tecla N; o DOM e o CSS ficam no próprio módulo) -----
    // Se der erro ao criar, o jogo continua sem minimapa.
    let minimapa = null;
    try {
      minimapa = new Minimapa({ mundo, jogador, remotos, rede, mobs });
    } catch (erro) {
      console.warn('Hackraft: minimapa indisponível.', erro);
    }
    // Celular: o minimapa começa desligado (a tela é pequena e ele cobriria
    // os botões). Só se o jogador nunca escolheu: o botão N liga, e a escolha
    // fica salva pelo próprio minimapa ('hackraft-minimapa'). O debug (F3) já
    // começa desligado nos dois modos.
    if (MODO_TOQUE && minimapa && minimapa.visivel) {
      let escolhido = true;
      try { escolhido = localStorage.getItem('hackraft-minimapa') !== null; } catch (e) { /* sem localStorage */ }
      if (!escolhido) minimapa.alternar();
    }

    // ----- Controles de toque (celular): joystick, botões e atalhos na tela -----
    // Só existe no MODO_TOQUE; no PC nem é criado. Se falhar, o jogo segue sem eles.
    let controlesToque = null;
    if (MODO_TOQUE) {
      try {
        controlesToque = new ControlesToque({ ui, jogador, canvas });
      } catch (erro) {
        console.warn('Hackraft: controles de toque indisponíveis.', erro);
      }
    }

    window.jogo = {
      controlesToque,
      mundo, ceu, jogador, inventario, equipamento, itensChao, ui, som, salvar, rede, remotos,
      renderer, scene, camera, texturas, chat, hacker, particulas, poderes, baus, mobs, telaForja, telaAlfaiate,
      minimapa,
    };

    // Música e boas-vindas
    if (som.musica && typeof som.musica.iniciar === 'function') som.musica.iniciar();
    let climaAtual = null; // 'dia' ou 'noite' (só avisa a música quando muda)
    chat.adicionarMensagem({
      de: '', tipo: 'sistema',
      texto: 'Bem-vindo ao Hackraft! Aperte T para conversar ou digite /ajuda',
    });

    // ----- Loop do jogo -----
    const relogio = new THREE.Clock();
    let tempoDebug = 0;
    let quadrosDebug = 0;
    let fps = 0;
    let tempoSalvar = 0;
    let tempoShader = 0;     // segundos desde o início (pulsar dos minérios que brilham)
    let tempoBrilho = 0;     // brilhinhos dos cristais

    /** A cada ~0.3 s, alguns minérios que brilham perto de você soltam brilhinhos na cor do cristal */
    function brilharCristais(dt) {
      tempoBrilho += dt;
      if (tempoBrilho < CONFIG.BRILHO_INTERVALO_S) return;
      tempoBrilho = 0;
      if (typeof mundo.blocosProximos !== 'function' || typeof particulas.brilhoCristal !== 'function') return;
      // Pega até 32 cristais perto (do mais perto ao mais longe) e sorteia alguns para brilhar
      const lista = mundo.blocosProximos(jogador.posicao, CONFIG.BRILHO_RAIO, (id) => BLOCOS[id]?.brilho, 32);
      if (!lista || lista.length === 0) return;
      for (let i = 0; i < CONFIG.BRILHO_POR_VEZ; i++) {
        const b = lista[Math.floor(Math.random() * lista.length)]; // b = [x, y, z, id]
        const def = BLOCOS[b[3]];
        if (def) particulas.brilhoCristal(b[0] + 0.5, b[1] + 0.5, b[2] + 0.5, def.corXray);
      }
    }

    // ----- Ovos de dragão chocando (Fase 11): faíscas e, perto do fim, estalos -----
    // O anfitrião guarda o progresso no estado do bloco (0 = frio, 1 a 15 = chocando),
    // então todos os computadores veem o mesmo.
    let tempoOvos = 0, tempoEstalo = 0;
    const ehOvo = (id) => id === B.OVO_DRAGAO;
    function ovosChocando(dt) {
      tempoOvos += dt;
      tempoEstalo -= dt;
      if (tempoOvos < 0.3) return;
      tempoOvos = 0;
      if (B.OVO_DRAGAO === undefined || typeof particulas.emitir !== 'function') return;
      const lista = mundo.blocosProximos(jogador.posicao, 16, ehOvo, 8);
      if (!lista || lista.length === 0) return;
      for (const b of lista) {
        const nivel = typeof mundo.obterEstado === 'function' ? mundo.obterEstado(b[0], b[1], b[2]) : 0;
        if (!nivel) continue;
        // quanto mais perto de nascer, mais faíscas
        particulas.emitir({
          x: b[0] + 0.5, y: b[1] + 0.8, z: b[2] + 0.5, qtd: 1 + Math.floor(nivel / 5),
          cores: ['#ffb02a', '#ff6a1a', '#ffe08a'], velocidade: 0.6, vy: 1, espalhar: 0.4,
          gravidade: -1, vida: 0.7, tamanho: 0.08, aditivo: true,
        });
        const dx = b[0] + 0.5 - jogador.posicao.x, dz = b[2] + 0.5 - jogador.posicao.z;
        if (nivel >= 13 && tempoEstalo <= 0 && dx * dx + dz * dz < 144) {
          tempoEstalo = 3 + Math.random() * 2;
          if (typeof som.chocar === 'function') som.chocar();
        }
      }
    }

    // ----- Tochas (Fase 6): fagulhas e fumaça nas tochas perto de você -----
    let tempoTochas = 0;
    const ehTocha = (id) => BLOCOS[id]?.modelo === 'tocha'; // criada uma vez só (sem lixo no loop)
    // Quanto a tocha na parede fica deslocada (estado 1 a 4 = encostada em -Z, +X, +Z, -X)
    const DESLOC_X = [0, 0, 0.3, 0, -0.3];
    const DESLOC_Z = [0, -0.3, 0, 0.3, 0];

    function fogoDasTochas(dt) {
      tempoTochas += dt;
      if (tempoTochas < CONFIG.TOCHA_INTERVALO_S) return;
      tempoTochas = 0;
      // A luz dos itens no chão acompanha o lugar onde o jogador está
      const p = jogador.posicao;
      itensChao.definirLuz(typeof mundo.luzEm === 'function'
        ? mundo.luzEm(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z))
        : ceu.luzDoDia);
      if (typeof particulas.emitir !== 'function') return;
      const lista = mundo.blocosProximos(p, CONFIG.TOCHA_RAIO, ehTocha, 32);
      if (!lista || lista.length === 0) return;
      const n = Math.min(CONFIG.TOCHA_POR_VEZ, lista.length);
      for (let k = 0; k < n; k++) {
        const b = lista[Math.floor(Math.random() * lista.length)]; // [x, y, z, id]
        const est = typeof mundo.obterEstado === 'function' ? mundo.obterEstado(b[0], b[1], b[2]) : 0;
        const parede = est >= 1 && est <= 4;
        const x = b[0] + 0.5 + (parede ? DESLOC_X[est] : 0);
        const y = b[1] + (parede ? 0.85 : 0.7);
        const z = b[2] + 0.5 + (parede ? DESLOC_Z[est] : 0);
        particulas.emitir({
          x, y, z, qtd: 1, cores: ['#ffb02a', '#ffe066', '#ff7a1a'],
          velocidade: 0.4, espalhar: 0.04, gravidade: -1.5, vida: 0.5, tamanho: 0.07, aditivo: true,
        });
        if (Math.random() < 0.4) {
          particulas.emitir({
            x, y: y + 0.1, z, qtd: 1, cor: '#555555',
            velocidade: 0.3, espalhar: 0.05, gravidade: -1, vida: 1.0, tamanho: 0.1, aditivo: false,
          });
        }
      }
    }

    // ----- Forjas (Fase 9): fogo saindo do topo das forjas perto de você -----
    let tempoForjas = 0;
    const ehForja = (id) => id === B.FORJA;
    function fogoDasForjas(dt) {
      tempoForjas += dt;
      if (tempoForjas < CONFIG.FORJA_INTERVALO_S) return;
      tempoForjas = 0;
      const lista = mundo.blocosProximos(jogador.posicao, CONFIG.FORJA_RAIO, ehForja, 16, listaForjas);
      if (!lista || lista.length === 0) return;
      const n = Math.min(CONFIG.FORJA_POR_VEZ, lista.length);
      for (let k = 0; k < n; k++) {
        const b = lista[Math.floor(Math.random() * lista.length)]; // [x, y, z, id]
        const x = b[0] + 0.5 + (Math.random() - 0.5) * 0.5;
        const z = b[2] + 0.5 + (Math.random() - 0.5) * 0.5;
        particulas.emitir({
          x, y: b[1] + 1.05, z, qtd: 1, cores: ['#ff7a1a', '#ffd23a', '#ff4a1a'],
          velocidade: 0.5, espalhar: 0.05, gravidade: -2, vida: 0.6, tamanho: 0.08, aditivo: true,
        });
        if (Math.random() < 0.3) {
          particulas.emitir({
            x, y: b[1] + 1.15, z, qtd: 1, cor: '#555555',
            velocidade: 0.3, espalhar: 0.05, gravidade: -1, vida: 1.2, tamanho: 0.12, aditivo: false,
          });
        }
      }
    }
    // ----- Fogueiras (Fase 10): fogo e fumaça -----
    let tempoFogueiras = 0;
    const ehFogueira = (id) => id === B.FOGUEIRA;
    const listaFogueiras = [];
    function fogoDasFogueiras(dt) {
      tempoFogueiras += dt;
      if (tempoFogueiras < CONFIG.FORJA_INTERVALO_S) return;
      tempoFogueiras = 0;
      const lista = mundo.blocosProximos(jogador.posicao, CONFIG.FORJA_RAIO, ehFogueira, 16, listaFogueiras);
      if (!lista || lista.length === 0) return;
      const n = Math.min(CONFIG.FORJA_POR_VEZ, lista.length);
      for (let k = 0; k < n; k++) {
        const b = lista[Math.floor(Math.random() * lista.length)];
        const x = b[0] + 0.5 + (Math.random() - 0.5) * 0.4;
        const z = b[2] + 0.5 + (Math.random() - 0.5) * 0.4;
        particulas.emitir({
          x, y: b[1] + 0.35, z, qtd: 1, cores: ['#ffb02a', '#ffe066', '#ff7a1a'],
          velocidade: 0.5, espalhar: 0.05, gravidade: -2, vida: 0.7, tamanho: 0.09, aditivo: true,
        });
        if (Math.random() < 0.5) {
          particulas.emitir({
            x, y: b[1] + 0.6, z, qtd: 1, cor: '#555555',
            velocidade: 0.4, espalhar: 0.06, gravidade: -1, vida: 1.4, tamanho: 0.14, aditivo: false,
          });
        }
      }
    }
    const listaForjas = []; // reaproveitada a cada chamada (evita lixo no loop)

    const pad = (n) => String(n).padStart(2, '0');

    function textoDebug() {
      const p = jogador.posicao;
      const tam = CONFIG.TAMANHO_CHUNK;
      const est = mundo.estatisticas();
      const idEmbaixo = mundo.obterBloco(p.x, p.y - 0.5, p.z);
      const bloco = BLOCOS[idEmbaixo];
      const hora = Math.floor(ceu.hora) % CICLO_SEGUNDOS;
      return [
        'Hackraft',
        'FPS: ' + fps,
        'XYZ: ' + p.x.toFixed(2) + ' / ' + p.y.toFixed(2) + ' / ' + p.z.toFixed(2),
        'Chunk: ' + Math.floor(p.x / tam) + ', ' + Math.floor(p.z / tam),
        'Bloco embaixo: ' + (bloco ? bloco.rotulo : '?'),
        'Hora: ' + pad(Math.floor(hora / 60)) + ':' + pad(hora % 60) + ' (' + (ceu.ehNoite ? 'Noite' : 'Dia') + ')',
        'Chunks: ' + est.chunks + '  Fila: ' + est.fila + '  Faces: ' + est.faces,
        'Semente: ' + jogo.semente,
        'Itens no chão: ' + itensChao.quantidade,
        'Mobs: ' + (mobs ? (mobs.quantidade ?? '?') : 'desligado') + '  XP: ' + jogador.xpTotal + '  Nível: ' + jogador.nivel,
        'Câmera: ' + jogador.modoCamera,
        'Rede: ' + NOMES_MODO[rede.modo] + (rede.codigo ? '  Sala: ' + rede.codigo : '') +
          '  Jogadores: ' + rede.quantidadeJogadores,
      ].join('\n');
    }

    // ----- Hardcore: reanimar, corpos caídos e fim de jogo -----
    const T_REANIMAR = CONFIG.REANIMAR_TEMPO_S;
    const reanim = { id: null, tempo: 0, esperarSoltar: false };
    let tempoFim = 0;
    let corpoLocalDeitado = false;

    /** O corpo caído mais perto de mim (até REANIMAR_DIST blocos), ou null */
    const corpoPerto = () => {
      let melhor = null;
      let melhorD = CONFIG.REANIMAR_DIST * CONFIG.REANIMAR_DIST;
      const p = jogador.posicao;
      for (const r of remotos.remotos.values()) {
        if (!r.recebeu || !rede.estaMorto(r.id)) continue;
        const q = r.personagem.grupo.position;
        const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d <= melhorD) { melhorD = d; melhor = r; }
      }
      return melhor;
    };

    /** Segurar o botão direito (mão vazia) perto de um corpo por REANIMAR_TEMPO_S segundos */
    const atualizarReanimar = (dt) => {
      let corpo = null;
      const segurando = jogador.botoes[2];
      if (!segurando) reanim.esperarSoltar = false;
      if (modoMundo === 'hardcore' && jogador.ativo && segurando && !reanim.esperarSoltar &&
          !jogador.montaria && !inventario.itemSelecionado()) {
        corpo = corpoPerto();
      }
      if (!corpo) {
        if (reanim.id !== null) { reanim.id = null; reanim.tempo = 0; ui.mostrarReanimando(null); }
        jogador.bloqueioDireito = false;
        return;
      }
      if (reanim.id !== corpo.id) { reanim.id = corpo.id; reanim.tempo = 0; }
      reanim.tempo += dt;
      jogador.bloqueioDireito = true; // o botão direito só serve para reanimar agora
      ui.mostrarReanimando(reanim.tempo / T_REANIMAR, corpo.apelido);
      if (reanim.tempo >= T_REANIMAR) {
        if (rede.reanimar(corpo.apelido)) ui.mostrarMensagem('Você reanimou ' + corpo.apelido + '!');
        reanim.id = null; reanim.tempo = 0;
        reanim.esperarSoltar = true; // só reanima de novo se soltar e apertar outra vez
        ui.mostrarReanimando(null);
        jogador.bloqueioDireito = false;
      }
    };

    /** Antes de mover os bonecos remotos: tira o "levantinho" que demos aos corpos deitados */
    const antesDosRemotos = () => {
      for (const r of remotos.remotos.values()) {
        if (r.dyCaido) { r.personagem.grupo.position.y -= r.dyCaido; r.dyCaido = 0; }
      }
    };

    /** Depois: deita quem está caído (e escreve "(caído)" no nome) e levanta quem foi reanimado */
    const depoisDosRemotos = () => {
      for (const r of remotos.remotos.values()) {
        if (!r.recebeu) continue;
        const caido = rede.estaMorto(r.id);
        const g = r.personagem.grupo;
        if (caido) {
          g.rotation.order = 'YXZ';        // primeiro deita (x), depois gira para onde olhava (y)
          g.rotation.x = Math.PI / 2;      // de costas no chão, com a cabeça para trás
          g.position.y += 0.25; r.dyCaido = 0.25; // a espessura do corpo não afunda no chão
          r.etiqueta.sprite.position.y = g.position.y + 0.9;
        } else if (g.rotation.x !== 0) {
          g.rotation.x = 0;
        }
        if (!!r.etiquetaCaido !== caido && typeof remotos._criarEtiqueta === 'function') {
          // Troca a etiqueta do nome: "<apelido> (caído)"
          r.etiquetaCaido = caido;
          const nova = remotos._criarEtiqueta(caido ? r.apelido + ' (caído)' : r.apelido);
          nova.sprite.visible = true;
          scene.add(nova.sprite);
          scene.remove(r.etiqueta.sprite);
          r.etiqueta.sprite.material.map.dispose();
          r.etiqueta.sprite.material.dispose();
          r.etiqueta = nova;
          if (caido) nova.sprite.position.y = g.position.y + 0.9;
        }
      }
    };

    /** Eu caído (Hardcore): meu corpo deitado e a câmera olhando de cima */
    const corpoECameraLocal = (dt) => {
      const g = jogador.personagem.grupo;
      if (jogador.caido) {
        const p = jogador.posicao;
        // A câmera sobe até 4,5 blocos, parando antes de um teto
        let alt = 1.5;
        while (alt < 4.5 && !SOLIDO[mundo.obterBloco(p.x, p.y + alt + 0.5, p.z)]) alt += 0.5;
        camera.position.set(p.x, p.y + alt, p.z);
        camera.rotation.set(-Math.PI / 2, jogador.yaw, 0); // olhando para baixo
        g.visible = true;
        g.rotation.order = 'YXZ';
        g.rotation.set(Math.PI / 2, jogador.yaw, 0);
        g.position.set(p.x, p.y + 0.25, p.z);
        corpoLocalDeitado = true;
      } else if (corpoLocalDeitado) {
        g.rotation.x = 0;
        corpoLocalDeitado = false;
      }
      // Fim de jogo: o anfitrião (ou quem joga sozinho) confere de vez em quando
      if (modoMundo === 'hardcore' && jogador.morto && rede.modo !== 'cliente' && !fimDeJogoMostrado) {
        tempoFim += dt;
        if (tempoFim >= 0.25) {
          tempoFim = 0;
          if (rede.todosCaidos()) fimDeJogo();
        }
      }
    };

    renderer.setAnimationLoop(() => {
      const dt = Math.min(relogio.getDelta(), 0.05);

      atualizarReanimar(dt);
      jogador.atualizar(dt);
      corpoECameraLocal(dt);
      poderes.atualizar(dt);
      meteoro.atualizar(dt);
      if (mobs) mobs.atualizar(dt);
      particulas.atualizar(dt);
      brilharCristais(dt);
      if (typeof mundo.blocosProximos === 'function') { fogoDasTochas(dt); fogoDasForjas(dt); fogoDasFogueiras(dt); }
      itensChao.atualizar(dt);
      rede.atualizar(dt);
      antesDosRemotos();
      remotos.atualizar(dt);
      depoisDosRemotos();
      // Fase 11: cada cavaleiro (eu na 3ª pessoa e os outros) sentado no assento da montaria
      if (mobs) mobs.posicionarCavaleiros(remotos, jogador.personagem);
      if (typeof mundo.blocosProximos === 'function') ovosChocando(dt);
      mundo.atualizar(jogador.posicao);
      ceu.atualizar(dt, camera.position);
      mundo.definirLuzDoDia(ceu.luzDoDia);
      tempoShader += dt;
      if (typeof mundo.definirTempo === 'function') mundo.definirTempo(tempoShader);
      if (typeof mundo.luzEm !== 'function') itensChao.definirLuz(ceu.luzDoDia); // com luzEm, quem define é fogoDasTochas
      hacker.atualizar(dt, jogador.posicao);
      if (minimapa) minimapa.atualizar(dt);
      // Música: 'chefao' enquanto houver um chefão vivo perto (até 64 blocos); senão dia/noite
      const clima = mobs && mobs.chefaoPerto ? 'chefao' : (ceu.ehNoite ? 'noite' : 'dia');
      if (clima !== climaAtual) {
        climaAtual = clima;
        if (som.musica && typeof som.musica.definirClima === 'function') som.musica.definirClima(clima);
      }
      renderer.render(scene, camera);

      // Debug a cada ~0.25 s
      quadrosDebug++;
      tempoDebug += dt;
      if (tempoDebug >= 0.25) {
        fps = Math.round(quadrosDebug / tempoDebug);
        quadrosDebug = 0;
        tempoDebug = 0;
        if (ui.debugLigado) ui.atualizarDebug(textoDebug());
      }

      // Autosave (só anfitrião ou sozinho)
      if (podeSalvar()) {
        tempoSalvar += dt;
        if (tempoSalvar >= CONFIG.AUTOSAVE_SEGUNDOS) {
          tempoSalvar = 0;
          salvar();
        }
      }
    });
  }

  // ----- "Criar sala": anfitrião (ou sozinho, sem internet) -----
  async function aoCriarSala(apelido, modoEscolhido) {
    if (montando || jogo) return;
    montando = true;
    try {
      rede = new Rede({ apelido, cores: lerAparenciaBase(apelido) });
      let codigo = null;
      try {
        codigo = await rede.criarSala();
      } catch (erro) {
        // Sem internet (ou servidor fora do ar): joga sozinho, sem erro na tela
        console.warn('Hackraft: multiplayer indisponível, jogando sozinho.', erro);
      }

      const estado = carregarJogo(); // versão 1 a 10 (ou null)
      // Tipo do mundo: o do save (mundo antigo = sobrevivência) ou o escolhido na tela inicial
      modoMundo = estado ? estado.modoMundo
        : (['sobrevivencia', 'criativo', 'hardcore'].includes(modoEscolhido) ? modoEscolhido : 'sobrevivencia');
      rede.modoMundo = modoMundo; // vai no bemvindo para quem entrar
      const semente = estado && estado.semente !== undefined
        ? estado.semente
        : Math.floor(Math.random() * 2147483647);
      await montarJogo({
        apelido,
        semente,
        modificacoes: estado && estado.modificacoes,
        hora: estado && estado.hora,
      });

      if (estado && estado.inventario) inventario.carregar(estado.inventario);
      if (estado && estado.equipamento) equipamento.carregar(estado.equipamento);
      const { mundo, jogador, itensChao } = jogo;
      if (estado) itensChao.carregar(estado.itensChao);
      if (estado) jogo.baus.carregar(estado.baus);
      if (estado && estado.jogador && Array.isArray(estado.jogador.pos)) {
        jogador.carregar(estado.jogador);
      } else {
        const nasc = mundo.pontoDeNascimento();
        jogador.teletransportar(nasc.x, nasc.y, nasc.z);
      }
      mundo.prepararArea(jogador.posicao, 2);

      // Posição e inventário de quem já visitou este mundo
      rede.carregarDadosJogadores(estado && estado.jogadores);
      if (estado && estado.casa) rede.definirCasa(estado.casa); // casa do anfitrião
      comecar();
      // Fase 11: montarias, pets e ovos de dragão salvos (depois de comecar: os mobs já conhecem os jogadores)
      if (estado && jogo.mobs) {
        jogo.mobs.carregarMontarias(estado.montarias);
        jogo.mobs.carregarOvos(estado.ovos);
      }

      window.addEventListener('beforeunload', salvarSaindo);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) salvarSaindo();
      });

      ui.esconderCarregando();
      if (codigo) {
        ui.mostrarSala(codigo);
      } else {
        ui.mostrarSala(null);
        ui.mostrarMensagem('Sem internet: jogando sozinho.');
      }
      ui.atualizarJogadores(rede.listaJogadores());
    } catch (erro) {
      // Erro ao montar o mundo (bug): mostra na tela de carregamento
      mostrarErro(erro);
      throw erro;
    } finally {
      montando = false;
    }
  }

  // ----- "Entrar": cliente (o mundo vem do anfitrião, nada é salvo aqui) -----
  async function aoEntrar(apelido, codigo) {
    if (montando || jogo) return;
    montando = true;
    const novaRede = new Rede({ apelido, cores: lerAparenciaBase(apelido) });
    let dados;
    try {
      dados = await novaRede.entrarNaSala(codigo);
    } catch (erro) {
      // Não achou a sala, sem internet...: a tela inicial mostra a mensagem
      novaRede.encerrar();
      montando = false;
      throw erro;
    }

    rede = novaRede;
    try {
      modoMundo = dados.modoMundo || 'sobrevivencia'; // o tipo de mundo é o do anfitrião
      await montarJogo({
        apelido,
        semente: dados.semente,
        modificacoes: dados.modificacoes,
        hora: dados.hora,
      });
      const { mundo, jogador } = jogo;

      // Inventário e equipamento: o que o anfitrião guardou deste apelido (ou vazio)
      inventario.carregar(dados.meuEstado ? dados.meuEstado.inventario : null);
      equipamento.carregar(dados.meuEstado ? dados.meuEstado.equipamento : null);

      // Posição: onde parou da última vez, ou ao lado do anfitrião
      if (dados.meuEstado) {
        jogador.carregar(dados.meuEstado);
        mundo.prepararArea(jogador.posicao, 2);
      } else if (dados.posAnfitriao) {
        const [hx, hy, hz] = dados.posAnfitriao;
        mundo.prepararArea({ x: hx, y: hy, z: hz }, 2);
        const [x, y, z] = lugarLivrePerto(mundo, hx, hy, hz);
        jogador.teletransportar(x, y, z);
        // Vira para o anfitrião (com yaw = 0 olhamos para -Z)
        if (x !== hx || z !== hz) jogador.yaw = Math.atan2(-(hx - x), -(hz - z));
      } else {
        const nasc = mundo.pontoDeNascimento();
        jogador.teletransportar(nasc.x, nasc.y, nasc.z);
        mundo.prepararArea(jogador.posicao, 2);
      }

      comecar();

      ui.esconderCarregando();
      ui.mostrarSala(rede.codigo);
      ui.atualizarJogadores(rede.listaJogadores());

      // Perdeu o anfitrião: avisa e volta para a tela inicial.
      // (Registrado por último: se a conexão caiu durante a montagem, a
      // função é chamada na hora e o aviso fica por cima de tudo.)
      rede.aoDesconectar(() => {
        // Guarda o código para a tela inicial já vir preenchida depois do reload
        try { sessionStorage.setItem('hackraft-reentrar', rede.codigo || ''); } catch (e) { /* ignora */ }
        ui.mostrarCarregando('A conexão com o anfitrião caiu. Voltando ao início...');
        ui.soltarMouse();
        setTimeout(() => location.reload(), CONFIG.ESPERA_AO_CAIR_S * 1000);
      });
    } catch (erro) {
      mostrarErro(erro);
      throw erro;
    } finally {
      montando = false;
    }
  }

  // ----- Pronto: mostra a tela inicial -----
  ui.esconderCarregando();
  // Se já existe um mundo salvo, a tela inicial mostra o tipo dele (para outro tipo: Novo mundo)
  const salvoInicial = carregarJogo();
  ui.mostrarTelaInicial({
    aoCriarSala, aoEntrar, aoNovoMundo: novoMundo, aoSair: sairParaMenu,
    modoSalvo: salvoInicial ? salvoInicial.modoMundo : null,
  });
}

iniciar().catch(mostrarErro);
