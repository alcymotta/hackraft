// =====================================================================
// Hackraft - Programa principal
// ---------------------------------------------------------------------
// Cria o renderizador, a cena e a câmera, monta todos os módulos
// (mundo, céu, jogador, interface...) e roda o loop do jogo.
// =====================================================================

import * as THREE from 'three';
import { CONFIG, CICLO_SEGUNDOS } from './config.js';
import { criarTexturas } from './textures.js';
import { Inventario } from './inventory.js';
import { InterfaceJogo } from './ui.js';
import { Mundo } from './world.js';
import { Ceu } from './sky.js';
import { Personagem } from './character.js';
import { Jogador } from './player.js';
import { som } from './audio.js';
import { BLOCOS } from './blocks.js';
import { salvarJogo, carregarJogo, apagarJogo } from './save.js';

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

  // ----- Texturas, save, inventário e interface -----
  // (a tela de carregamento do index.html já começa visível, com "Carregando...")
  const texturas = await criarTexturas();
  const estado = carregarJogo();
  const semente = estado && estado.semente !== undefined
    ? estado.semente
    : Math.floor(Math.random() * 2147483647);

  const inventario = new Inventario();
  if (estado && estado.inventario) inventario.carregar(estado.inventario);

  ui = new InterfaceJogo({ inventario, texturas, canvas });
  ui.mostrarCarregando('Gerando o mundo...');
  await new Promise(requestAnimationFrame); // deixa o texto aparecer

  // ----- Mundo, céu, personagem e jogador -----
  const mundo = new Mundo(scene, texturas, semente);
  if (estado && estado.modificacoes) mundo.carregarModificacoes(estado.modificacoes);

  const ceu = new Ceu(scene);
  if (estado && typeof estado.hora === 'number') ceu.definirHora(estado.hora);

  const personagem = new Personagem();
  const jogador = new Jogador({ camera, scene, mundo, inventario, ui, som, personagem, texturas });

  if (estado && estado.jogador && Array.isArray(estado.jogador.pos)) {
    jogador.carregar(estado.jogador);
  } else {
    const nasc = mundo.pontoDeNascimento();
    jogador.teletransportar(nasc.x, nasc.y, nasc.z);
  }
  mundo.prepararArea(jogador.posicao, 2);

  // ----- Salvamento -----
  let impedirSalvar = false; // ligado no "Novo mundo", senão o mundo velho voltaria

  let ultimoAvisoSalvar = -Infinity; // quando avisamos do save cheio pela última vez

  function salvar() {
    if (impedirSalvar) return false;
    const ok = salvarJogo({
      versao: 1,
      semente,
      modificacoes: mundo.exportarModificacoes(),
      jogador: jogador.serializar(),
      inventario: inventario.serializar(),
      hora: ceu.hora,
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
    ui.devolverMao();
    salvar();
  }

  function novoMundo() {
    impedirSalvar = true;
    apagarJogo();
    location.reload();
  }

  window.addEventListener('beforeunload', salvarSaindo);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) salvarSaindo();
  });

  // ----- Depuração -----
  window.jogo = { mundo, ceu, jogador, inventario, ui, som, salvar, renderer, scene, camera, texturas };

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
      'Semente: ' + semente,
      'Câmera: ' + jogador.modoCamera,
    ].join('\n');
  }

  renderer.setAnimationLoop(() => {
    const dt = Math.min(relogio.getDelta(), 0.05);

    jogador.atualizar(dt);
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

    // Autosave
    tempoSalvar += dt;
    if (tempoSalvar >= CONFIG.AUTOSAVE_SEGUNDOS) {
      tempoSalvar = 0;
      salvar();
    }
  });

  // ----- Pronto: mostra a tela inicial -----
  ui.esconderCarregando();
  ui.mostrarTelaInicial({ aoJogar() {}, aoNovoMundo: novoMundo });
}

iniciar().catch(mostrarErro);
