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
// =====================================================================

import * as THREE from 'three';
import { CONFIG, CICLO_SEGUNDOS } from './config.js';
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
import { Baus } from './baus.js';
import { som } from './audio.js';
import { B, BLOCOS, SOLIDO, LIQUIDO } from './blocks.js';
import { salvarJogo, carregarJogo, apagarJogo } from './save.js';

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

async function iniciar() {
  // ----- Renderizador, cena e câmera -----
  const canvas = document.getElementById('tela');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    CONFIG.CAMPO_DE_VISAO, window.innerWidth / window.innerHeight, 0.05, CONFIG.CAMERA_LONGE);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ----- Texturas, inventário, equipamento e interface -----
  // (a tela de carregamento do index.html já começa visível, com "Carregando...")
  const texturas = await criarTexturas();
  const inventario = new Inventario();
  const equipamento = new Equipamento();
  ui = new InterfaceJogo({ inventario, equipamento, texturas, canvas });
  const chat = new Chat({ ui });

  // ----- Estado da partida (preenchido quando o jogo é montado) -----
  let rede = null;          // Rede (modo 'sozinho', 'anfitriao' ou 'cliente')
  let jogo = null;          // { semente, mundo, ceu, personagem, jogador, remotos, itensChao }
  let montando = false;     // evita montar duas vezes (clique duplo)
  let impedirSalvar = false; // ligado no "Novo mundo", senão o mundo velho voltaria
  let ultimoAvisoSalvar = -Infinity; // quando avisamos do save cheio pela última vez
  let aparenciaBase = null; // cores da skin base deste navegador (definidas ao entrar no jogo)

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
      versao: 6,
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
      camera, scene, mundo, inventario, ui, som, personagem, texturas, equipamento, particulas, baus,
      // No multiplayer, quem cria o item no chão é o anfitrião: passa pela rede
      soltarItem: (item, qtd, x, y, z, vx, vy, vz) => rede.soltarItem(item, qtd, x, y, z, vx, vy, vz),
    });
    const remotos = new JogadoresRemotos(scene);

    // Poderes dos cristais (precisam do jogador, dos bonecos remotos e da rede)
    const poderes = new Poderes({
      jogador, mundo, scene, camera, particulas, som, ui, inventario, rede, remotos, texturas,
    });
    jogador.poderes = poderes;

    jogo = { semente, mundo, ceu, personagem, jogador, remotos, itensChao, particulas, poderes, baus };
  }

  // Depois de posicionar o jogador: liga a rede, expõe para depuração e começa o loop
  function comecar() {
    const { mundo, ceu, jogador, remotos, itensChao, particulas, poderes, baus } = jogo;
    aplicarAparencia();

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

    // ----- Vida: ao morrer, mostra a tela e volta para casa com a vida cheia -----
    ui.atualizarVida(jogador.vida, CONFIG.VIDA_MAX);
    jogador.aoMorrer(() => {
      ui.mostrarMorte({
        aoRenascer: () => {
          const [cx, cy, cz] = obterCasa();
          mundo.prepararArea({ x: cx, y: cy, z: cz }, 1); // o chão da casa precisa existir
          jogador.teletransportar(cx, cy, cz);
          jogador.renascer();
        },
      });
    });

    /** Aceita [x, y, z] ou { x, y, z } (os comandos mandam uma lista) */
    const lerPos = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p);
    registrarComandos(chat, {
      jogador, ceu, rede, remotos, inventario, equipamento, hacker, mundo,
      // Muda a hora: a rede aplica (anfitrião/sozinho) ou pede ao anfitrião (cliente)
      mudarHora: (segundos) => rede.pedirHora(segundos),
      obterCasa,
      definirCasa: (pos) => {
        const p = lerPos(pos);
        rede.definirCasa([p.x, p.y, p.z]);
        if (rede.modo !== 'cliente') salvar();
      },
    });

    window.jogo = {
      mundo, ceu, jogador, inventario, equipamento, itensChao, ui, som, salvar, rede, remotos,
      renderer, scene, camera, texturas, chat, hacker, particulas, poderes, baus,
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
        'Câmera: ' + jogador.modoCamera,
        'Rede: ' + NOMES_MODO[rede.modo] + (rede.codigo ? '  Sala: ' + rede.codigo : '') +
          '  Jogadores: ' + rede.quantidadeJogadores,
      ].join('\n');
    }

    renderer.setAnimationLoop(() => {
      const dt = Math.min(relogio.getDelta(), 0.05);

      jogador.atualizar(dt);
      poderes.atualizar(dt);
      particulas.atualizar(dt);
      brilharCristais(dt);
      if (typeof mundo.blocosProximos === 'function') fogoDasTochas(dt);
      itensChao.atualizar(dt);
      rede.atualizar(dt);
      remotos.atualizar(dt);
      mundo.atualizar(jogador.posicao);
      ceu.atualizar(dt, camera.position);
      mundo.definirLuzDoDia(ceu.luzDoDia);
      tempoShader += dt;
      if (typeof mundo.definirTempo === 'function') mundo.definirTempo(tempoShader);
      if (typeof mundo.luzEm !== 'function') itensChao.definirLuz(ceu.luzDoDia); // com luzEm, quem define é fogoDasTochas
      hacker.atualizar(dt, jogador.posicao);
      const clima = ceu.ehNoite ? 'noite' : 'dia';
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
  async function aoCriarSala(apelido) {
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

      const estado = carregarJogo(); // versão 1 a 4 (ou null)
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
  ui.mostrarTelaInicial({ aoCriarSala, aoEntrar, aoNovoMundo: novoMundo });
}

iniciar().catch(mostrarErro);
