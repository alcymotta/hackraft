// =====================================================================
// Hackraft - Jogadores remotos
// ---------------------------------------------------------------------
// Mostra os outros jogadores: um Personagem de blocos + uma etiqueta com
// o nome flutuando acima da cabeça. A rede entrega o último estado
// conhecido (poucas vezes por segundo) e aqui a gente suaviza o movimento.
// =====================================================================

import * as THREE from 'three';
import { Personagem } from './character.js';

const SUAVIZACAO = 12;          // quanto maior, mais rápido o boneco alcança o alvo
const DISTANCIA_TELEPORTE = 8;  // acima disso (em blocos), pula direto para o alvo
const INTERVALO_GOLPE = 0.3;    // segundos entre golpes enquanto quebra
const ALTURA_ETIQUETA = 2.15;   // altura da etiqueta acima dos pés
// Quanto subir a etiqueta quando a roupa tem chapéu/capacete 3D
const EXTRA_ETIQUETA = { mago: 0.45, pirata: 0.2, astronauta: 0.1 };
const ALTURA_TEXTO = 0.28;     // altura da etiqueta em blocos

const DOIS_PI = Math.PI * 2;

export class JogadoresRemotos {
  constructor(scene) {
    this.scene = scene;
    this.remotos = new Map(); // id -> dados do jogador remoto
    this.aparenciasPendentes = new Map(); // aparência que chegou antes do jogador ser criado
  }

  /** Cria o boneco e a etiqueta de um jogador */
  adicionar(id, apelido, cores) {
    if (this.remotos.has(id)) this.remover(id);

    const personagem = new Personagem(cores);
    personagem.grupo.visible = false; // só aparece quando chegar o primeiro estado
    this.scene.add(personagem.grupo);

    // Se a aparência chegou antes do jogador, aplica agora
    const pendente = this.aparenciasPendentes.get(id);
    if (pendente) {
      personagem.definirAparencia(pendente);
      this.aparenciasPendentes.delete(id);
    }

    const etiqueta = this._criarEtiqueta(apelido);
    this.scene.add(etiqueta.sprite);
    etiqueta.sprite.visible = false;

    this.remotos.set(id, {
      id,
      apelido,
      personagem,
      etiqueta,
      alvo: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, noAr: false, quebrando: false, planando: false, nadando: false },
      recebeu: false,        // já chegou algum estado?
      yaw: 0,
      pitch: 0,
      velocidade: 0,         // velocidade horizontal estimada (blocos/s)
      tempoGolpe: 0,
    });
  }

  remover(id) {
    const r = this.remotos.get(id);
    if (!r) return;
    this.scene.remove(r.personagem.grupo);
    r.personagem.dispose();
    this.scene.remove(r.etiqueta.sprite);
    r.etiqueta.sprite.material.map.dispose();
    r.etiqueta.sprite.material.dispose();
    this.remotos.delete(id);
    this.aparenciasPendentes.delete(id);
  }

  /** Aplica roupa, armadura, mão e acessório: { cores, roupa, armadura, mao, acessorio } */
  definirAparencia(id, aparencia) {
    const r = this.remotos.get(id);
    if (!r) { this.aparenciasPendentes.set(id, aparencia); return; }
    r.personagem.definirAparencia(aparencia);
    // Guarda quanto subir a etiqueta para não cobrir chapéu/capacete
    const roupa = r.personagem.aparenciaAtual;
    r.subirEtiqueta = (EXTRA_ETIQUETA[roupa.roupa] || 0) + (roupa.armadura && roupa.armadura.capacete ? 0.1 : 0);
  }

  limpar() {
    this.aparenciasPendentes.clear();
    for (const id of Array.from(this.remotos.keys())) this.remover(id);
  }

  /** Guarda o estado mais novo como alvo; atualizar() faz o resto */
  receberEstado(id, { x, y, z, yaw, pitch, noAr, quebrando, planando, nadando }) {
    const r = this.remotos.get(id);
    if (!r) return;
    const a = r.alvo;
    a.x = x; a.y = y; a.z = z;
    a.yaw = yaw; a.pitch = pitch;
    a.noAr = !!noAr;
    a.quebrando = !!quebrando;
    a.planando = !!planando;
    a.nadando = !!nadando;

    // Primeiro estado: já nasce no lugar certo
    if (!r.recebeu) {
      r.recebeu = true;
      r.personagem.grupo.position.set(x, y, z);
      r.yaw = yaw;
      r.personagem.grupo.visible = true;
      r.etiqueta.sprite.visible = true;
    }
  }

  /** Move suavemente cada boneco até o alvo e anima */
  atualizar(dt) {
    if (dt <= 0) return;
    const fator = 1 - Math.exp(-dt * SUAVIZACAO);

    for (const r of this.remotos.values()) {
      if (!r.recebeu) continue;
      const a = r.alvo;
      const grupo = r.personagem.grupo;
      const pos = grupo.position;

      const antesX = pos.x;
      const antesZ = pos.z;

      const dx = a.x - pos.x;
      const dy = a.y - pos.y;
      const dz = a.z - pos.z;
      if (dx * dx + dy * dy + dz * dz > DISTANCIA_TELEPORTE * DISTANCIA_TELEPORTE) {
        pos.set(a.x, a.y, a.z); // longe demais: teleporta
        r.velocidade = 0;
      } else {
        pos.x += dx * fator;
        pos.y += dy * fator;
        pos.z += dz * fator;
        // Velocidade horizontal pelo deslocamento deste quadro (suavizada)
        const v = Math.hypot(pos.x - antesX, pos.z - antesZ) / dt;
        r.velocidade += (v - r.velocidade) * Math.min(1, dt * 10);
      }

      // Yaw pelo caminho mais curto
      let dyaw = (a.yaw - r.yaw) % DOIS_PI;
      if (dyaw > Math.PI) dyaw -= DOIS_PI;
      else if (dyaw < -Math.PI) dyaw += DOIS_PI;
      r.yaw += dyaw * fator;
      grupo.rotation.y = r.yaw;

      // Pitch (suavizado também)
      r.pitch += (a.pitch - r.pitch) * fator;
      r.personagem.definirOlhar(r.pitch);

      r.personagem.planando = a.planando;
      r.personagem.nadando = a.nadando;
      r.personagem.animar(dt, r.velocidade, a.noAr);

      // Golpes enquanto está quebrando
      if (a.quebrando) {
        r.tempoGolpe -= dt;
        if (r.tempoGolpe <= 0) {
          r.tempoGolpe = INTERVALO_GOLPE;
          r.personagem.animarGolpe();
        }
      } else {
        r.tempoGolpe = 0;
      }

      // Etiqueta acima da cabeça
      r.etiqueta.sprite.position.set(pos.x, pos.y + ALTURA_ETIQUETA + (r.subirEtiqueta || 0), pos.z);
    }
  }

  /** Posição (nos pés) do jogador, ou null. O Vector3 devolvido é o do próprio boneco: não altere. */
  posicaoDe(id) {
    const r = this.remotos.get(id);
    return r ? r.personagem.grupo.position : null;
  }

  apelidoDe(id) {
    const r = this.remotos.get(id);
    return r ? r.apelido : null;
  }

  // ------------------------------------------------------------------
  // Etiqueta com o nome (Sprite com CanvasTexture)
  // ------------------------------------------------------------------
  _criarEtiqueta(texto) {
    const fonte = 'bold 48px sans-serif';
    const medida = document.createElement('canvas').getContext('2d');
    medida.font = fonte;
    const larguraTexto = Math.ceil(medida.measureText(texto).width);

    const margem = 16;
    const altura = 72;
    const largura = Math.max(altura, larguraTexto + margem * 2);

    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');

    // Fundo preto semitransparente com cantos arredondados
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    const raio = 16;
    ctx.beginPath();
    ctx.moveTo(raio, 0);
    ctx.lineTo(largura - raio, 0);
    ctx.quadraticCurveTo(largura, 0, largura, raio);
    ctx.lineTo(largura, altura - raio);
    ctx.quadraticCurveTo(largura, altura, largura - raio, altura);
    ctx.lineTo(raio, altura);
    ctx.quadraticCurveTo(0, altura, 0, altura - raio);
    ctx.lineTo(0, raio);
    ctx.quadraticCurveTo(0, 0, raio, 0);
    ctx.closePath();
    ctx.fill();

    // Texto branco no centro
    ctx.font = fonte;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, largura / 2, altura / 2 + 3);

    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: textura,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(ALTURA_TEXTO * (largura / altura), ALTURA_TEXTO, 1);
    sprite.renderOrder = 10; // desenha por cima da água e das nuvens
    return { sprite };
  }
}
