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
// =====================================================================

import * as THREE from 'three';
import { CONFIG, CICLO_SEGUNDOS } from './config.js';
import { criarTexturas } from './textures.js';
import { Inventario } from './inventory.js';
import { InterfaceJogo } from './ui.js';
import { Mundo } from './world.js';
import { Ceu } from './sky.js';
import { Personagem, coresPorApelido } from './character.js';
import { Jogador } from './player.js';
import { JogadoresRemotos } from './jogadores_remotos.js';
import { Rede } from './network.js';
import { som } from './audio.js';
import { BLOCOS, SOLIDO, LIQUIDO } from './blocks.js';
import { salvarJogo, carregarJogo, apagarJogo } from './save.js';

const NOMES_MODO = { sozinho: 'sozinho', anfitriao: 'anfitrião', cliente: 'cliente' };

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

  // ----- Texturas, inventário e interface -----
  // (a tela de carregamento do index.html já começa visível, com "Carregando...")
  const texturas = await criarTexturas();
  const inventario = new Inventario();
  ui = new InterfaceJogo({ inventario, texturas, canvas });

  // ----- Estado da partida (preenchido quando o jogo é montado) -----
  let rede = null;          // Rede (modo 'sozinho', 'anfitriao' ou 'cliente')
  let jogo = null;          // { semente, mundo, ceu, personagem, jogador, remotos }
  let montando = false;     // evita montar duas vezes (clique duplo)
  let impedirSalvar = false; // ligado no "Novo mundo", senão o mundo velho voltaria
  let ultimoAvisoSalvar = -Infinity; // quando avisamos do save cheio pela última vez

  // ----- Salvamento (só anfitrião ou sozinho; o cliente NUNCA salva) -----
  function podeSalvar() {
    return !!jogo && !!rede && rede.modo !== 'cliente' && !impedirSalvar;
  }

  function salvar() {
    if (!podeSalvar()) return false;
    const ok = salvarJogo({
      versao: 2,
      semente: jogo.semente,
      modificacoes: jogo.mundo.exportarModificacoes(),
      jogador: jogo.jogador.serializar(),
      inventario: inventario.serializar(),
      hora: jogo.ceu.hora,
      jogadores: rede.exportarDadosJogadores(),
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

    // Cada apelido tem uma cor de roupa (os outros veem a mesma cor)
    const personagem = new Personagem(coresPorApelido(apelido));
    const jogador = new Jogador({ camera, scene, mundo, inventario, ui, som, personagem, texturas });
    const remotos = new JogadoresRemotos(scene);

    jogo = { semente, mundo, ceu, personagem, jogador, remotos };
  }

  // Depois de posicionar o jogador: liga a rede, expõe para depuração e começa o loop
  function comecar() {
    const { mundo, ceu, jogador, remotos } = jogo;
    rede.ligar({ mundo, ceu, jogador, inventario, remotos, ui });

    window.jogo = {
      mundo, ceu, jogador, inventario, ui, som, salvar, rede, remotos,
      renderer, scene, camera, texturas,
    };

    // ----- Loop do jogo -----
    const relogio = new THREE.Clock();
    let tempoDebug = 0;
    let quadrosDebug = 0;
    let fps = 0;
    let tempoSalvar = 0;

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
        'Câmera: ' + jogador.modoCamera,
        'Rede: ' + NOMES_MODO[rede.modo] + (rede.codigo ? '  Sala: ' + rede.codigo : '') +
          '  Jogadores: ' + rede.quantidadeJogadores,
      ].join('\n');
    }

    renderer.setAnimationLoop(() => {
      const dt = Math.min(relogio.getDelta(), 0.05);

      jogador.atualizar(dt);
      rede.atualizar(dt);
      remotos.atualizar(dt);
      mundo.atualizar(jogador.posicao);
      ceu.atualizar(dt, camera.position);
      mundo.definirLuzDoDia(ceu.luzDoDia);
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
      rede = new Rede({ apelido, cores: coresPorApelido(apelido) });
      let codigo = null;
      try {
        codigo = await rede.criarSala();
      } catch (erro) {
        // Sem internet (ou servidor fora do ar): joga sozinho, sem erro na tela
        console.warn('Hackraft: multiplayer indisponível, jogando sozinho.', erro);
      }

      const estado = carregarJogo(); // versão 1 ou 2 (ou null)
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
      const { mundo, jogador } = jogo;
      if (estado && estado.jogador && Array.isArray(estado.jogador.pos)) {
        jogador.carregar(estado.jogador);
      } else {
        const nasc = mundo.pontoDeNascimento();
        jogador.teletransportar(nasc.x, nasc.y, nasc.z);
      }
      mundo.prepararArea(jogador.posicao, 2);

      // Posição e inventário de quem já visitou este mundo
      rede.carregarDadosJogadores(estado && estado.jogadores);
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
    const novaRede = new Rede({ apelido, cores: coresPorApelido(apelido) });
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

      // Inventário: o que o anfitrião guardou deste apelido (ou vazio)
      inventario.carregar(dados.meuEstado ? dados.meuEstado.inventario : null);

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
