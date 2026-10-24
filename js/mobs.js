// =====================================================================
// Hackraft - Mobs: animais de dia, monstros à noite (Fase 7)
// ---------------------------------------------------------------------
// QUEM FAZ O QUÊ
//   - O ANFITRIÃO (ou quem joga sozinho) é a "autoridade": só ele decide
//     onde os mobs nascem, para onde andam, quanta vida têm e quando
//     morrem. Ele roda a IA e a física de todos os mobs.
//   - Os CLIENTES só mostram. Recebem ~10 vezes por segundo a posição de
//     cada mob (mensagem `mobs`) e desenham o boneco andando suave entre uma
//     mensagem e outra (interpolação, veja _interpolar). Quando o jogador do
//     cliente bate num mob, o pedido vai para o anfitrião (`atacarMob`),
//     que confere e aplica.
//   - Por que assim? Se cada computador simulasse os mobs, cada um veria o
//     zumbi num lugar diferente. Com um só "dono", todos veem o mesmo.
//
// IA POR ESTADOS (cada mob está sempre em um estado)
//   passear   : anda numa direção sorteada por alguns segundos e para
//   fugir     : o animal que apanha corre para longe por 4 s
//   perseguir : o monstro viu um jogador a até `visao` blocos e vai atrás
//   atacar    : perto o bastante (`alcance`): bate a cada 1 s
//   A IA "pensa" 10 vezes por segundo quando há um jogador perto e só 2
//   vezes por segundo quando todos estão longe (economiza processamento).
//   A física (andar, cair, bater em parede) roda todo quadro.
//
// FÍSICA
//   Cada mob é uma caixa (largura = 2 × raio, altura = altura). A cada
//   quadro ela anda um eixo por vez (X, Z e depois Y) e para ao encostar em
//   um bloco, igual ao jogador. As caixas dos blocos vêm de
//   `mundo.caixaColisao` (porta fina, tocha sem colisão...).
//   - Encostou numa parede de 1 bloco andando? Pula (degrau).
//   - A aranha não pula: sobe pela parede (`sobeParede`).
//   - A IA olha o chão à frente: não entra em água funda de propósito e não
//     pula de mais de 2 blocos passeando (3 perseguindo).
//
// DIA E NOITE
//   Os animais nascem de dia sobre a grama; os monstros nascem no escuro
//   (luz < 0.35): de noite na superfície e, a qualquer hora, no fundo das
//   cavernas (de dia, no máximo 4 por jogador, para sobrar lugar para os da
//   noite). Ao amanhecer, os monstros que estão sob o céu aberto pegam
//   fogo e somem em 3 s.
//   Os mobs só nascem e andam onde o ANFITRIÃO tem o mundo carregado (em
//   volta dele, ~6 chunks): um visitante muito longe do anfitrião não vê mobs.
//
// DESEMPENHO
//   - Até 40 mobs. Nada de criar objetos a cada quadro: os mobs e os
//     modelos são reaproveitados (pools), as listas também.
//   - Mobs longe de todos os jogadores pensam menos vezes; os que estão
//     longe do seu jogador não são animados nem desenhados.
//
// FASE 8 (ganchos prontos para monstros novos)
//   - registrarTipoMob(nome, def): tipos novos (esqueleto, orcs, dragão,
//     hidra...). A ordem de registro vira o número do tipo na rede, então
//     registre sempre na mesma ordem (no próprio código, não pelo console).
//   - registrarComportamento(nome, fn): IA nova (fn(mobs, mob, dt) escolhe
//     querX/querZ/querVel/querVy e yawAlvo, como os de baixo).
//   - `ataqueDistancia: { alcance, intervalo, dano, projetil, velocidade }`:
//     o comportamento 'monstro' chama o gancho definido com
//     mobs.definirAtaqueDistancia(fn) quando o alvo está nessa distância
//     (o esqueleto com flechas cria o projétil lá).
//   - `voa: true` + `alturaVoo`: sem gravidade; o comportamento escolhe
//     `querVy` (o dragão).
//   - `chefao: true`: não conta nos limites, não some longe, não queima no
//     sol e mostra a barra de chefão (ui.mostrarBarraChefao, se existir).
//   - Hidra com várias cabeças: é um mob só (uma caixa); as cabeças são do
//     modelo (modelos_mobs.js).
//
// Exporta: Mobs, TIPOS_MOB, ORDEM_TIPOS, COMPORTAMENTOS, registrarTipoMob,
//          registrarComportamento
// =====================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { B, BLOCOS, SOLIDO, LIQUIDO } from './blocks.js';
import { ITENS } from './items.js';

// Os modelos (bonecos) vêm de modelos_mobs.js. Se o arquivo faltar ou der
// erro, cada mob vira uma caixa colorida (dá para jogar e testar assim).
let criarModeloExterno = null;
try {
  const mod = await import('./modelos_mobs.js');
  if (typeof mod.criarModeloMob === 'function') criarModeloExterno = mod.criarModeloMob;
} catch (e) {
  console.warn('Hackraft: modelos_mobs.js indisponível; os mobs serão caixas coloridas.', e);
}

// ---------------------------------------------------------------------
// Números ajustáveis (o integrador pode passar para o config.js depois)
// ---------------------------------------------------------------------
const MAX_MOBS = 40;                  // mobs vivos ao mesmo tempo (todos os jogadores juntos)
const MAX_ANIMAIS_POR_JOGADOR = 8;
const MAX_MONSTROS_POR_JOGADOR = 10;  // de noite
const MAX_MONSTROS_DIA = 4;           // de dia (só nas cavernas): assim sobra lugar para os da noite
const RAIO_CONTAGEM = 64;             // mobs até essa distância contam como "do jogador" nos limites
const DIST_GERAR_MIN = 24;            // os mobs nascem a 24-48 blocos dos jogadores
const DIST_GERAR_MAX = 48;
const DIST_SUMIR = 96;                // longe assim de todos os jogadores, o mob some
const INTERVALO_GERAR = 1;            // segundos entre as tentativas de gerar mobs
const TENTATIVAS_POR_JOGADOR = 6;     // lugares sorteados por jogador a cada tentativa
const GERADOS_POR_VEZ = 2;            // no máximo isso por jogador a cada segundo
const LUZ_MAX_MONSTRO = 0.35;         // monstros só nascem com menos luz que isso
const LUZ_DIA_ANIMAIS = 0.7;          // animais só nascem com a luz do dia acima disso
const PROFUNDIDADE_CAVERNA = 6;       // de dia, monstros só nascem pelo menos isso abaixo do topo da coluna
const LUZ_SOL_QUEIMA = 0.5;           // com a luz do dia acima disso, o sol queima os monstros

const VEL_MAX_QUEDA = 20;             // blocos por segundo
const VEL_PULO_MOB = 8.6;             // pulo de 1 bloco (com a gravidade do jogo)
const VEL_SUBIR_PAREDE = 2.6;         // aranha subindo a parede
const VEL_PLANAR = 2.5;               // a galinha cai devagar (bate as asas)
const VEL_GIRO = 9;                   // radianos por segundo ao virar
const ACEL_CHAO = 12;                 // quão rápido o mob ganha a velocidade que quer (no chão)
const ACEL_AR = 2.5;                  // no ar quase não muda (o empurrão do golpe continua)
const RECUO_GOLPE = 6.5;              // empurrão ao apanhar (horizontal)
const RECUO_CIMA = 4.5;               // e para cima
const FATOR_LENTO = 0.4;              // efeito "lento" (gelo): velocidade × 0.4
const DANO_QUEIMAR_POR_S = 1;         // efeito "queimar" (fogo): 1 de dano por segundo
const TEMPO_SOL = 3;                  // segundos queimando no sol até sumir
const TEMPO_FUGA = 4;                 // segundos que o animal foge depois de apanhar
const TEMPO_MORTE = 0.9;              // duração da animação de morte
const RECARGA_ATAQUE = 1;             // segundos entre os ataques de um monstro
const QUEDA_MAX_PASSEAR = 2;          // maior queda que o mob aceita passeando
const QUEDA_MAX_PERSEGUIR = 3;        // e perseguindo
const DIST_IA_PERTO = 32;             // até aqui a IA pensa a cada IA_PERTO segundos
const IA_PERTO = 0.1;
const IA_LONGE = 0.5;
const ENVIOS_POR_SEGUNDO = 10;        // estado dos mobs pela rede
const ATRASO_INTERP_MS = 100;         // o cliente desenha os mobs 100 ms "no passado"
const DIST_VISIVEL = (CONFIG.DISTANCIA_RENDER + 1) * CONFIG.TAMANHO_CHUNK; // além disso, nem desenha
const DIST_SOM = 24;                  // de longe assim não se ouve o mob
const INTERVALO_SOM_IDLE = 1.2;       // segundos entre dois barulhinhos (de qualquer mob)
const MODELOS_NO_POOL = 12;           // modelos guardados para reaproveitar, por tipo
const RAIO_JOGADOR = (CONFIG.LARGURA_JOGADOR ?? 0.6) / 2;
const GRAVIDADE = CONFIG.GRAVIDADE;

// Rede
const CAMPOS_REDE = 8;                // números por mob na mensagem `mobs`
const MAX_MOBS_REDE = 64;
const HIST = 4;                       // posições guardadas por mob para interpolar (cliente)
const ID_MAX = 16777216;              // 2^24: o Float32 guarda inteiros até aqui sem erro

// Bits do campo `flags` (mensagem `mobs`). Os bits 8 a 11 são o contador de golpes.
const F_ANDANDO = 1, F_ATACANDO = 2, F_QUEIMANDO = 4, F_LENTO = 8, F_SUBINDO = 16, F_NO_AR = 32, F_NADANDO = 64;

const EPS = 0.001;
const EIXO_X = 1, EIXO_Y = 2, EIXO_Z = 3;
const CAIXA_CHEIA = [0, 0, 0, 1, 1, 1];
const ALTURA = CONFIG.ALTURA_MUNDO;
const TAM = CONFIG.TAMANHO_CHUNK;
const VAZIO = [];

// Blocos com modelo próprio (porta, tocha): a caixa de colisão vem do mundo
const MODELO_ESPECIAL = new Uint8Array(256);
for (const b of BLOCOS) if (b && b.modelo && b.modelo !== 'cubo') MODELO_ESPECIAL[b.id] = 1;

// Opções de partículas reaproveitadas (só x/y/z mudam antes de emitir)
const EF_FOGO = {
  x: 0, y: 0, z: 0, qtd: 3, cores: ['#ff9a2a', '#ffd23f', '#ff5a1a'],
  velocidade: 0.7, vy: 1.4, espalhar: 0.5, gravidade: -2, vida: 0.45, tamanho: 0.13, aditivo: true,
};
const EF_POF = {
  x: 0, y: 0, z: 0, qtd: 14, cores: ['#ffffff', '#e2e2e2', '#bdbdbd'],
  velocidade: 1.3, espalhar: 0.6, gravidade: -0.8, vida: 0.7, tamanho: 0.2, arrasto: 1.5,
};

// =====================================================================
// TIPOS DE MOB (registro)
// =====================================================================

/** TIPOS_MOB[nome] = definição completa (com os padrões preenchidos) */
export const TIPOS_MOB = {};
/** Nomes na ordem de registro. O índice é o "tipo" na mensagem `mobs`. */
export const ORDEM_TIPOS = [];

/**
 * Cadastra (ou substitui) um tipo de mob. Campos:
 *  - nome (rótulo na tela), vidaMax, velocidade (andar/perseguir), velFuga
 *  - dano, alcance (blocos além da borda do corpo), visao (blocos)
 *  - altura, raio (meia largura): a caixa de colisão
 *  - hostil, diurno, sobeParede, voa, xp
 *  - drops: [{ item, min, max, chance }]
 *  - comportamento: nome em COMPORTAMENTOS ('animal' | 'monstro')
 *  - som: tipo para som.mob (padrão: o próprio nome)
 *  - nasce: 'grama' (animais, de dia) | 'escuro' (monstros) | null (só por criarMob)
 *  - peso: chance relativa de ser sorteado entre os que nascem no mesmo lugar
 *  - grupo: [min, max] quantos nascem juntos
 *  - queimaNoSol (padrão = hostil), planar (cai devagar), pulaNoAlvo (bote)
 *  - corReserva: cor da caixa se o modelo não existir
 *  - Fase 8: ataqueDistancia, alturaVoo, chefao (veja o cabeçalho)
 */
export function registrarTipoMob(nome, def) {
  const d = {
    tipo: nome,
    nome: def.nome ?? nome,
    vidaMax: def.vidaMax ?? 10,
    velocidade: def.velocidade ?? 1.2,
    velFuga: def.velFuga ?? (def.velocidade ?? 1.2) * 2.5,
    dano: def.dano ?? 0,
    alcance: def.alcance ?? 0,
    visao: def.visao ?? 0,
    altura: def.altura ?? 1,
    raio: def.raio ?? 0.4,
    hostil: def.hostil ?? false,
    diurno: def.diurno ?? !def.hostil,
    sobeParede: def.sobeParede ?? false,
    voa: def.voa ?? false,
    xp: def.xp ?? 1,
    drops: Array.isArray(def.drops) ? def.drops : [],
    comportamento: def.comportamento ?? (def.hostil ? 'monstro' : 'animal'),
    som: def.som ?? nome,
    nasce: def.nasce ?? null,
    peso: def.peso ?? 1,
    grupo: def.grupo ?? [1, 1],
    queimaNoSol: def.queimaNoSol ?? !!def.hostil,
    planar: def.planar ?? false,
    pulaNoAlvo: def.pulaNoAlvo ?? false,
    corReserva: def.corReserva ?? '#cc66aa',
    // Fase 8
    ataqueDistancia: def.ataqueDistancia ?? null,
    alturaVoo: def.alturaVoo ?? 0,
    chefao: def.chefao ?? false,
    indice: 0,
  };
  let i = ORDEM_TIPOS.indexOf(nome);
  if (i < 0) { i = ORDEM_TIPOS.length; ORDEM_TIPOS.push(nome); }
  d.indice = i;
  TIPOS_MOB[nome] = d;
  versaoTipos++;
  return d;
}
let versaoTipos = 0; // muda a cada registro (as listas de sorteio são refeitas)

// ----- Os mobs da Fase 7 -----
registrarTipoMob('porco', {
  nome: 'Porco', vidaMax: 10, velocidade: 1.1, velFuga: 3.4, altura: 0.9, raio: 0.4,
  xp: 1, nasce: 'grama', peso: 1, grupo: [2, 3], corReserva: '#f0a0b0',
  drops: [{ item: 'costeleta', min: 1, max: 3, chance: 1 }],
});
registrarTipoMob('galinha', {
  nome: 'Galinha', vidaMax: 4, velocidade: 1.0, velFuga: 3.2, altura: 0.72, raio: 0.22,
  xp: 1, nasce: 'grama', peso: 1, grupo: [2, 4], planar: true, corReserva: '#f4f4f4',
  drops: [{ item: 'coxinha', min: 1, max: 1, chance: 1 }, { item: 'pena', min: 0, max: 2, chance: 1 }],
});
registrarTipoMob('zumbi', {
  nome: 'Zumbi', vidaMax: 20, velocidade: 2.4, dano: 3, alcance: 0.9, visao: 16,
  altura: 1.8, raio: 0.3, hostil: true, xp: 5, nasce: 'escuro', peso: 3, corReserva: '#4f8a3a',
  drops: [{ item: 'carne_podre', min: 0, max: 2, chance: 1 }],
});
registrarTipoMob('aranha', {
  nome: 'Aranha', vidaMax: 16, velocidade: 3.3, dano: 2, alcance: 0.6, visao: 16,
  altura: 0.9, raio: 0.7, hostil: true, sobeParede: true, pulaNoAlvo: true, xp: 5,
  nasce: 'escuro', peso: 2, corReserva: '#3a2f2f',
  drops: [{ item: 'fio_seda', min: 0, max: 2, chance: 1 }],
});

// =====================================================================
// COMPORTAMENTOS (a "cabeça" de cada mob)
// Cada um recebe (mobs, m, dt) e escolhe para onde o mob quer ir:
//   m.querX, m.querZ (direção, comprimento 1), m.querVel (blocos/s),
//   m.querVy (só para quem voa) e m.yawAlvo (para onde olhar).
// =====================================================================

export const COMPORTAMENTOS = {};

/** Cadastra uma IA nova (Fase 8: 'atirador', 'voador', 'chefao'...) */
export function registrarComportamento(nome, fn) {
  COMPORTAMENTOS[nome] = fn;
}

/** Passear: anda um pouco numa direção sorteada, para, escolhe outra... */
function passear(mobs, m, dt, velocidade) {
  m.estado = 'passear';
  m.tEstado -= dt;
  if (m.tEstado <= 0) {
    if (m.querVel > 0 || Math.random() < 0.35) {
      // Para um pouco
      m.querVel = 0;
      m.tEstado = 2 + Math.random() * 5;
    } else {
      const a = Math.random() * Math.PI * 2;
      m.querX = Math.sin(a);
      m.querZ = Math.cos(a);
      m.querVel = velocidade;
      m.tEstado = 1.5 + Math.random() * 3;
    }
  }
  if (m.querVel > 0) {
    // Buraco, água funda ou mob preso numa parede alta: para e pensa de novo logo
    if (!mobs._caminhoLivre(m, m.querX, m.querZ, QUEDA_MAX_PASSEAR) || m.tPreso > 0.6) {
      m.querVel = 0;
      m.tPreso = 0;
      m.tEstado = 0.4 + Math.random() * 0.8;
    } else {
      m.yawAlvo = Math.atan2(-m.querX, -m.querZ);
    }
  }
  if (m.def.voa) m.querVy = mobs._vyParaAltura(m, mobs._chaoAbaixo(m) + m.def.alturaVoo);
}

/** Animal: passeia; se apanhar, foge para longe de quem bateu */
registrarComportamento('animal', (mobs, m, dt) => {
  const def = m.def;
  if (m.estado === 'fugir') {
    m.tEstado -= dt;
    if (m.tEstado <= 0) {
      m.estado = 'passear';
      m.tEstado = 0;
      m.querVel = 0;
      return;
    }
    // Direção: para longe do ponto de onde veio o golpe, balançando um pouco
    let dx = m.x - m.fugirX, dz = m.z - m.fugirZ;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.01) { dx = Math.sin(m.yaw); dz = Math.cos(m.yaw); } else { dx /= d; dz /= d; }
    const ang = (Math.random() - 0.5) * 0.8;
    const c = Math.cos(ang), s = Math.sin(ang);
    let qx = dx * c - dz * s, qz = dx * s + dz * c;
    // Buraco ou parede alta: tenta para o lado
    if (!mobs._caminhoLivre(m, qx, qz, QUEDA_MAX_PASSEAR) || m.tPreso > 0.4) {
      const t = qx; qx = -qz; qz = t;
      if (m.desvioLado < 0) { qx = -qx; qz = -qz; }
      m.tPreso = 0;
    }
    m.querX = qx; m.querZ = qz;
    m.querVel = def.velFuga;
    m.yawAlvo = Math.atan2(-qx, -qz);
    return;
  }
  passear(mobs, m, dt, def.velocidade);
});

/** Monstro: procura um jogador, persegue e bate; sem ninguém, vaga devagar */
registrarComportamento('monstro', (mobs, m, dt) => {
  const def = m.def;
  // 1) Alvo: continua com o mesmo enquanto ele for válido; senão procura outro (2× por s)
  let alvo = mobs._jogadorPorId(m.alvoId);
  if (alvo && !mobs._alvoValido(m, alvo, def.visao * 1.5)) alvo = null;
  m.tVisao -= dt;
  if (!alvo && m.tVisao <= 0) {
    m.tVisao = 0.5;
    alvo = mobs._procurarAlvo(m);
  }
  m.alvoId = alvo ? alvo.id : null;
  if (!alvo) {
    passear(mobs, m, dt, def.velocidade * 0.45);
    return;
  }

  const p = alvo.posicao;
  let dx = p.x - m.x, dz = p.z - m.z;
  const dy = p.y - m.y;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 0.001) { dx /= dist; dz /= dist; }
  m.yawAlvo = Math.atan2(-dx, -dz);
  if (def.voa) m.querVy = mobs._vyParaAltura(m, p.y + def.alturaVoo);

  const alcance = def.alcance + def.raio + RAIO_JOGADOR;

  // 2) Fase 8: ataque à distância (o gancho decide; se devolver true, terminou)
  if (def.ataqueDistancia && dist > alcance && dist <= def.ataqueDistancia.alcance) {
    if (mobs._ataqueDistancia(m, alvo, dist)) return;
  }

  // 3) Perto: ataca (1 vez por segundo)
  if (dist <= alcance && dy > -1.5 && dy < def.altura + 0.5) {
    m.estado = 'atacar';
    m.querVel = 0;
    if (m.recarga <= 0) {
      m.recarga = RECARGA_ATAQUE;
      m.tAtacando = 0.45;
      mobs._baterNoJogador(m, alvo);
    }
    return;
  }

  // 4) Persegue
  m.estado = 'perseguir';
  let qx = dx, qz = dz;
  if (m.tDesvio > 0) {
    // Preso numa parede alta: anda de lado por um tempo
    m.tDesvio -= dt;
    const t = qx; qx = -qz * m.desvioLado; qz = t * m.desvioLado;
  } else if (m.tPreso > 0.5) {
    m.tDesvio = 0.8 + Math.random() * 0.6;
    m.desvioLado = Math.random() < 0.5 ? 1 : -1;
    m.tPreso = 0;
  }
  if (!mobs._caminhoLivre(m, qx, qz, QUEDA_MAX_PERSEGUIR)) {
    m.querVel = 0; // beira de um buraco fundo (ou água funda): espera ali
    return;
  }
  m.querX = qx; m.querZ = qz;
  m.querVel = def.velocidade;
  // Bote da aranha: um pulo na direção do jogador
  if (def.pulaNoAlvo && m.noChao && dist > 1.6 && dist < 3.6 && m.recarga <= 0.2 && Math.random() < 0.25) {
    m.vy = 6.2;
    m.vx = dx * 6;
    m.vz = dz * 6;
    m.recarga = Math.max(m.recarga, 0.6);
  }
});

// =====================================================================
// Modelo reserva: uma caixa colorida com a mesma "interface" do modelo
// =====================================================================
let geoCaixaReserva = null;

function criarModeloCaixa(tipo) {
  const def = TIPOS_MOB[tipo];
  if (!geoCaixaReserva) geoCaixaReserva = new THREE.BoxGeometry(1, 1, 1);
  const grupo = new THREE.Group();
  const raiz = new THREE.Group();
  grupo.add(raiz);
  const base = new THREE.Color(def.corReserva);
  const mat = new THREE.MeshLambertMaterial({ color: base.clone(), emissive: 0x000000 });
  const corpo = new THREE.Mesh(geoCaixaReserva, mat);
  corpo.scale.set(def.raio * 2, def.altura, def.raio * 2);
  corpo.position.y = def.altura / 2;
  raiz.add(corpo);
  // Um "nariz" escuro mostra para onde o mob olha (-Z)
  const matNariz = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const nariz = new THREE.Mesh(geoCaixaReserva, matNariz);
  nariz.scale.set(def.raio * 0.6, def.altura * 0.2, 0.1);
  nariz.position.set(0, def.altura * 0.75, -def.raio - 0.05);
  raiz.add(nariz);
  let flash = 0, tempo = 0;
  return {
    grupo, altura: def.altura, raio: def.raio, _materiais: [mat],
    animar(dt, vel) {
      tempo += dt;
      raiz.position.y = vel > 0.2 ? Math.abs(Math.sin(tempo * 9)) * 0.06 : 0;
      if (flash > 0) {
        flash = Math.max(0, flash - dt);
        mat.emissive.setRGB(flash * 2.5, 0, 0);
      }
    },
    piscarDano() { flash = 0.3; },
    morrer(t) {
      raiz.rotation.z = Math.min(1, t * 2) * Math.PI / 2;
      mat.emissive.setRGB(t > 0 ? 0.6 : 0, 0, 0);
      mat.transparent = t > 0.7;
      mat.opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    },
    definirLuz(v) { mat.color.copy(base).multiplyScalar(0.35 + 0.65 * v); },
    definirVida() { /* sem barra no modelo reserva */ },
    dispose() {
      mat.dispose();
      matNariz.dispose();
      if (grupo.parent) grupo.parent.remove(grupo);
    },
  };
}

/** Cria o modelo do tipo (modelos_mobs.js) ou, sem ele, a caixa reserva */
function criarModelo(tipo) {
  if (criarModeloExterno) {
    try {
      return criarModeloExterno(tipo);
    } catch (e) {
      // Tipo sem modelo (ex.: um mob novo da Fase 8 ainda sem boneco)
    }
  }
  return criarModeloCaixa(tipo);
}

// =====================================================================
// MOBS
// =====================================================================

export class Mobs {
  /**
   * @param opcoes { scene, mundo, ceu, rede, particulas, som, itensChao, ui, obterJogadores }
   *   obterJogadores() → [{ id, posicao, local, defesa }]: todos os jogadores
   *   vivos (o seu tem `local: true`). Os objetos podem ser reaproveitados.
   */
  constructor({ scene, mundo, ceu = null, rede = null, particulas = null, som = null,
    itensChao = null, ui = null, obterJogadores = null } = {}) {
    this.scene = scene;
    this.mundo = mundo;
    this.ceu = ceu;
    this.rede = rede;
    this.particulas = particulas;
    this.som = som;
    this.itensChao = itensChao;
    this.ui = ui;
    this.obterJogadores = obterJogadores;

    this.lista = [];                  // mobs ativos (inclusive os que estão morrendo)
    this.porId = new Map();           // id → mob
    this._livres = [];                // objetos de mob para reaproveitar
    this._modelosLivres = new Map();  // tipo → [modelos guardados]
    this._proximoId = 1;
    this._ouvintesDano = [];
    this._ouvintesXp = [];
    this._fnAtaqueDistancia = null;   // gancho da Fase 8

    // Coisas reaproveitadas (nada de objetos novos no loop)
    this._alvos = [];
    this._resultadoRaio = { id: 0, t: 0 };
    this._posMob = { x: 0, y: 0, z: 0 };
    this._origemVisao = { x: 0, y: 0, z: 0 };
    this._dirVisao = { x: 0, y: 0, z: 0 };
    this._dirPoder = { x: 0, y: 0, z: 0 };
    this._bufRede = new Float32Array(MAX_MOBS_REDE * CAMPOS_REDE);
    this._jogadores = VAZIO;
    this._local = null;               // o meu jogador ({ posicao }) neste quadro
    this._contAnimais = 0;
    this._contMonstros = 0;

    // Relógios
    this._tGerar = 0;
    this._tEnvio = 0;
    this._offset = null;              // (cliente) relógio local − relógio do anfitrião, em ms
    this._enviouVazio = false;
    this._esperaSomIdle = 0;

    // Listas de sorteio (refeitas quando um tipo novo é registrado)
    this._versaoTipos = -1;
    this._tiposGrama = [];
    this._tiposEscuro = [];

    // A rede precisa saber de nós (bemvindo, atacarMob e as mensagens dos mobs)
    if (rede && typeof rede.registrarMobs === 'function') rede.registrarMobs(this);
  }

  // ------------------------------------------------------------------
  // Informações e ouvintes
  // ------------------------------------------------------------------

  /** true no anfitrião e no modo sozinho (quem simula); false no cliente */
  get autoridade() {
    return !this.rede || this.rede.modo !== 'cliente';
  }

  /** Quantos mobs vivos existem (para o F3) */
  get quantidade() {
    let n = 0;
    for (let i = 0; i < this.lista.length; i++) {
      const m = this.lista[i];
      if (!m.morrendo && !m.descartar) n++;
    }
    return n;
  }

  /**
   * Registra quem recebe o dano dos mobs no MEU jogador: fn({ qtd, de, efeito }).
   * `de` = [x, y, z] do mob; `qtd` vem sem o desconto da armadura.
   * Devolve uma função que cancela o registro.
   */
  aoDanoJogador(fn) {
    if (typeof fn !== 'function') return () => {};
    this._ouvintesDano.push(fn);
    return () => {
      const i = this._ouvintesDano.indexOf(fn);
      if (i >= 0) this._ouvintesDano.splice(i, 1);
    };
  }

  /** Registra quem recebe o XP quando EU mato um mob: fn(qtd) */
  aoXp(fn) {
    if (typeof fn !== 'function') return () => {};
    this._ouvintesXp.push(fn);
    return () => {
      const i = this._ouvintesXp.indexOf(fn);
      if (i >= 0) this._ouvintesXp.splice(i, 1);
    };
  }

  /**
   * Fase 8: gancho do ataque à distância (esqueleto, orc arqueiro...).
   * fn({ mobs, mob, alvo, dist }) → true se cuidou do mob neste instante
   * (atirou ou está mirando); false para o mob se aproximar normalmente.
   */
  definirAtaqueDistancia(fn) {
    this._fnAtaqueDistancia = typeof fn === 'function' ? fn : null;
  }

  // ------------------------------------------------------------------
  // Quadro a quadro
  // ------------------------------------------------------------------

  atualizar(dt) {
    if (!(dt > 0)) return;
    if (this._esperaSomIdle > 0) this._esperaSomIdle -= dt;
    // Jogadores deste quadro (a lista do main é reaproveitada)
    const jog = this.obterJogadores ? this.obterJogadores() : null;
    this._jogadores = Array.isArray(jog) ? jog : VAZIO;
    this._local = null;
    for (let i = 0; i < this._jogadores.length; i++) {
      const j = this._jogadores[i];
      if (j && j.local && j.posicao) { this._local = j; break; }
    }

    if (this.autoridade) {
      this._tGerar += dt;
      if (this._tGerar >= INTERVALO_GERAR) {
        this._tGerar = 0;
        this._sumirLonge();
        this._gerarPerto();
      }
      for (let i = 0; i < this.lista.length; i++) this._simular(this.lista[i], dt);
      this._enviarEstado();
    } else {
      this._interpolarTodos();
    }

    // Desenho e limpeza (de trás para frente: dá para tirar da lista no caminho)
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const m = this.lista[i];
      this._visual(m, dt);
      if (m.descartar || (m.morrendo && m.tMorte >= 1)) this._descartar(i);
    }
  }

  // ------------------------------------------------------------------
  // Criar e remover
  // ------------------------------------------------------------------

  /** Objeto de mob novo (só quando o pool está vazio) */
  _objetoMob() {
    const m = {
      id: 0, tipo: '', def: null,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawAlvo: 0,
      vida: 0, morrendo: false, descartar: false, tMorte: 0,
      estado: 'passear', tEstado: 0,
      querX: 0, querZ: 0, querVel: 0, querVy: 0,
      alvoId: null, fugirX: 0, fugirZ: 0, tVisao: 0, tDesvio: 0, desvioLado: 1, tPreso: 0,
      noChao: false, naAgua: false, bateuParede: false, tSubindo: 0, tAtacando: 0,
      recarga: 0, queimar: 0, tQueimar: 0, queimadoPor: null, lento: 0, sol: 0, tSol: 0,
      golpes: 0, flags: 0, vidaFrac: 1,
      acumIA: 0, dtIA: 0, distJogador: 0,
      // desenho
      modelo: null, tLuz: 0, tSom: 0, tFogo: 0, tNeve: 0, inclinacao: 0, velAnim: 0, xAnt: 0, zAnt: 0, distLocal: 0,
      anim: { atacando: false, voando: false, nadando: false },
      // cliente: histórico de posições [t, x, y, z, yaw] × HIST
      hist: new Float64Array(HIST * 5), nHist: 0, histProvisorio: false,
      golpesVistos: -1, piscouLocal: -Infinity,
      // alvo para os poderes (criado uma vez por objeto)
      alvo: null,
    };
    const alvo = { id: 0, posicao: new THREE.Vector3(), raio: 0.5, receberDano: null };
    alvo.receberDano = (qtd, tipo, efeito) => this._danoDePoder(alvo, qtd, tipo, efeito);
    m.alvo = alvo;
    return m;
  }

  /** Cria um mob (anfitrião ou cliente) e devolve o objeto, ou null se o tipo não existir */
  _novo(id, tipo, x, y, z, yaw, vidaFrac) {
    const def = TIPOS_MOB[tipo];
    if (!def) return null;
    const m = this._livres.pop() || this._objetoMob();
    m.id = id; m.tipo = tipo; m.def = def;
    m.x = x; m.y = y; m.z = z; m.vx = 0; m.vy = 0; m.vz = 0;
    m.yaw = yaw; m.yawAlvo = yaw;
    m.vida = def.vidaMax * vidaFrac; m.vidaFrac = vidaFrac;
    m.morrendo = false; m.descartar = false; m.tMorte = 0;
    m.estado = 'passear'; m.tEstado = Math.random() * 2;
    m.querX = 0; m.querZ = 0; m.querVel = 0; m.querVy = 0;
    m.alvoId = null; m.fugirX = x; m.fugirZ = z; m.tVisao = Math.random() * 0.5;
    m.tDesvio = 0; m.desvioLado = 1; m.tPreso = 0;
    m.noChao = false; m.naAgua = false; m.bateuParede = false; m.tSubindo = 0; m.tAtacando = 0;
    m.recarga = 0; m.queimar = 0; m.tQueimar = 0; m.queimadoPor = null; m.lento = 0; m.sol = 0;
    m.tSol = Math.random() * 0.5;
    m.golpes = 0; m.flags = 0;
    m.acumIA = Math.random() * IA_PERTO; m.dtIA = 0; m.distJogador = 0; // espalha a IA entre os quadros
    m.tLuz = 0; m.tSom = 3 + Math.random() * 10; m.tFogo = 0; m.tNeve = 0;
    m.inclinacao = 0; m.velAnim = 0; m.xAnt = x; m.zAnt = z;
    m.nHist = 0; m.histProvisorio = false; m.golpesVistos = -1; m.piscouLocal = -Infinity;
    m.alvo.id = id;
    m.alvo.raio = Math.max(def.raio, def.altura * 0.45);
    m.modelo = this._pegarModelo(tipo);
    m.modelo.grupo.position.set(x, y, z);
    m.modelo.grupo.rotation.set(0, yaw, 0);
    this.lista.push(m);
    this.porId.set(id, m);
    return m;
  }

  /** Um modelo do tipo, do pool ou novo, já na cena e "zerado" */
  _pegarModelo(tipo) {
    const pool = this._modelosLivres.get(tipo);
    let mod = pool && pool.length > 0 ? pool.pop() : null;
    if (mod) {
      mod.morrer(0);           // desfaz o tombo e a transparência
      mod.definirVida(1);      // esconde a barra
    } else {
      mod = criarModelo(tipo);
      // Ordem "YXZ": primeiro vira (yaw), depois inclina (a aranha subindo a parede)
      mod.grupo.rotation.order = 'YXZ';
    }
    mod.grupo.visible = true;
    if (mod.grupo.parent !== this.scene) this.scene.add(mod.grupo);
    return mod;
  }

  _devolverModelo(tipo, mod) {
    mod.grupo.visible = false;
    let pool = this._modelosLivres.get(tipo);
    if (!pool) { pool = []; this._modelosLivres.set(tipo, pool); }
    if (pool.length < MODELOS_NO_POOL) {
      pool.push(mod);
    } else {
      mod.dispose();
      if (mod.grupo.parent) mod.grupo.parent.remove(mod.grupo);
    }
  }

  /** Tira o mob da lista (índice i) e guarda o objeto e o modelo para reaproveitar */
  _descartar(i) {
    const m = this.lista[i];
    const ult = this.lista.length - 1;
    if (i !== ult) this.lista[i] = this.lista[ult];
    this.lista.length = ult;
    if (this.porId.get(m.id) === m) this.porId.delete(m.id);
    // "Puf" de fumaça no fim da morte
    if (m.morrendo && this.particulas && typeof this.particulas.emitir === 'function' && m.modelo.grupo.visible) {
      EF_POF.x = m.x; EF_POF.y = m.y + m.def.altura * 0.5; EF_POF.z = m.z;
      this.particulas.emitir(EF_POF);
    }
    this._devolverModelo(m.tipo, m.modelo);
    m.modelo = null;
    m.def = null;
    this._livres.push(m);
  }

  /** Próximo id livre (1 a 2^24, dando a volta) */
  _gerarId() {
    for (let k = 0; k < 1000; k++) {
      const id = this._proximoId;
      this._proximoId = this._proximoId + 1 >= ID_MAX ? 1 : this._proximoId + 1;
      if (!this.porId.has(id)) return id;
    }
    return 0;
  }

  /**
   * (Anfitrião/sozinho) Cria um mob agora, com os pés em (x, y, z). Serve para
   * testes e para comandos/eventos (ex.: um chefão da Fase 8). Devolve o id ou null.
   */
  criarMob(tipo, x, y, z, yaw = Math.random() * Math.PI * 2) {
    if (!this.autoridade || !TIPOS_MOB[tipo]) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    const id = this._gerarId();
    if (!id) return null;
    const m = this._novo(id, tipo, x, y, z, yaw, 1);
    if (!m) return null;
    if (this.rede && typeof this.rede.enviarMobNovo === 'function') {
      this.rede.enviarMobNovo(id, tipo, x, y, z, yaw, 1);
    }
    return id;
  }

  /**
   * Remove o mob. morreu = true: toca a animação de morte (tomba, fica
   * vermelho e some); false: some na hora. O anfitrião avisa os clientes.
   */
  _removerMob(m, morreu) {
    if (m.descartar || m.morrendo) return;
    if (morreu) {
      m.morrendo = true;
      m.tMorte = 0;
      m.querVel = 0;
      m.alvoId = null;
      this._tocar(m, 'morte');
    } else {
      m.descartar = true;
    }
    if (this.autoridade && this.rede && typeof this.rede.enviarMobRemovido === 'function') {
      this.rede.enviarMobRemovido(m.id, morreu);
    }
  }

  /** Remove todos os mobs (ex.: trocar de mundo). O anfitrião avisa os clientes. */
  limpar() {
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const m = this.lista[i];
      if (this.autoridade && !m.descartar && !m.morrendo && this.rede && typeof this.rede.enviarMobRemovido === 'function') {
        this.rede.enviarMobRemovido(m.id, false);
      }
      this._descartar(i);
    }
  }

  // ------------------------------------------------------------------
  // Gerar e sumir (anfitrião)
  // ------------------------------------------------------------------

  /** Refaz as listas de sorteio se algum tipo foi registrado depois */
  _atualizarListasTipos() {
    if (this._versaoTipos === versaoTipos) return;
    this._versaoTipos = versaoTipos;
    this._tiposGrama.length = 0;
    this._tiposEscuro.length = 0;
    for (const nome of ORDEM_TIPOS) {
      const d = TIPOS_MOB[nome];
      if (d.nasce === 'grama') this._tiposGrama.push(d);
      else if (d.nasce === 'escuro') this._tiposEscuro.push(d);
    }
  }

  /** Sorteia um tipo da lista pelo `peso` */
  _sortearTipo(lista) {
    let total = 0;
    for (let i = 0; i < lista.length; i++) total += lista[i].peso;
    let r = Math.random() * total;
    for (let i = 0; i < lista.length; i++) {
      r -= lista[i].peso;
      if (r <= 0) return lista[i];
    }
    return lista[lista.length - 1] || null;
  }

  /** Conta animais e monstros perto do ponto (para os limites por jogador) */
  _contarPerto(p) {
    let a = 0, mo = 0;
    const r2 = RAIO_CONTAGEM * RAIO_CONTAGEM;
    for (let i = 0; i < this.lista.length; i++) {
      const m = this.lista[i];
      if (m.morrendo || m.descartar || m.def.chefao) continue;
      const dx = m.x - p.x, dz = m.z - p.z;
      if (dx * dx + dz * dz > r2) continue;
      if (m.def.hostil) mo++; else a++;
    }
    this._contAnimais = a;
    this._contMonstros = mo;
  }

  /** true se algum jogador está a menos de `dist` blocos (na horizontal) de (x, z) */
  _jogadorPerto(x, z, dist) {
    const d2 = dist * dist;
    const jog = this._jogadores;
    for (let i = 0; i < jog.length; i++) {
      const p = jog[i].posicao;
      if (!p) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < d2) return true;
    }
    return false;
  }

  _gerarPerto() {
    const jog = this._jogadores;
    if (jog.length === 0 || this.lista.length >= MAX_MOBS) return;
    this._atualizarListasTipos();
    const noite = this.ceu ? !!this.ceu.ehNoite : false;
    const luzDia = this.ceu ? this.ceu.luzDoDia : 1;
    const diaClaro = !noite && luzDia > LUZ_DIA_ANIMAIS;

    for (let k = 0; k < jog.length; k++) {
      const p = jog[k].posicao;
      if (!p) continue;
      this._contarPerto(p);
      let gerados = 0;
      for (let t = 0; t < TENTATIVAS_POR_JOGADOR && gerados < GERADOS_POR_VEZ; t++) {
        if (this.lista.length >= MAX_MOBS) return;
        const querAnimal = diaClaro && this._contAnimais < MAX_ANIMAIS_POR_JOGADOR && this._tiposGrama.length > 0;
        const querMonstro = this._contMonstros < (noite ? MAX_MONSTROS_POR_JOGADOR : MAX_MONSTROS_DIA) &&
          this._tiposEscuro.length > 0;
        if (!querAnimal && !querMonstro) break;
        const animal = querAnimal && (!querMonstro || Math.random() < 0.5);
        // Ponto sorteado num anel de 24 a 48 blocos em volta do jogador
        const ang = Math.random() * Math.PI * 2;
        const dist = DIST_GERAR_MIN + Math.random() * (DIST_GERAR_MAX - DIST_GERAR_MIN);
        const x = Math.floor(p.x + Math.sin(ang) * dist);
        const z = Math.floor(p.z + Math.cos(ang) * dist);
        if (!this.mundo.estaPronto(x, z) || this._jogadorPerto(x + 0.5, z + 0.5, DIST_GERAR_MIN)) continue;
        if (animal) {
          const def = this._sortearTipo(this._tiposGrama);
          const n = this._gerarGrupoAnimais(def, x, z);
          this._contAnimais += n;
          gerados += n > 0 ? 1 : 0;
        } else {
          const def = this._sortearTipo(this._tiposEscuro);
          const y = this._acharLugarEscuro(def, x, z, p.y, noite);
          if (y < 0) continue;
          this.criarMob(def.tipo, x + 0.5, y, z + 0.5);
          this._contMonstros++;
          gerados++;
        }
      }
    }
  }

  /** Alguns animais do mesmo tipo juntos, sobre a grama perto de (x, z). Devolve quantos nasceram. */
  _gerarGrupoAnimais(def, x, z) {
    const g = def.grupo;
    const n = g[0] + Math.floor(Math.random() * (g[1] - g[0] + 1));
    let feitos = 0;
    for (let i = 0; i < n * 2 && feitos < n; i++) {
      const xx = i === 0 ? x : x + Math.floor(Math.random() * 5) - 2;
      const zz = i === 0 ? z : z + Math.floor(Math.random() * 5) - 2;
      if (!this.mundo.estaPronto(xx, zz)) continue;
      const y = this._acharGrama(def, xx, zz);
      if (y < 0) continue;
      if (this.criarMob(def.tipo, xx + 0.5, y, zz + 0.5) === null) break;
      feitos++;
      if (this.lista.length >= MAX_MOBS) break;
    }
    return feitos;
  }

  /**
   * y do primeiro bloco acima do bloco mais alto que "tapa" a coluna (x, z),
   * ou seja, onde começa o céu aberto. Usa a tabela de alturas do chunk
   * quando dá; senão procura de cima para baixo.
   */
  _topoColuna(x, z) {
    const cx = Math.floor(x / TAM), cz = Math.floor(z / TAM);
    const ch = typeof this.mundo._chunkEm === 'function' ? this.mundo._chunkEm(cx, cz) : null;
    if (ch && ch.alturas) return ch.alturas[(x - cx * TAM) + (z - cz * TAM) * TAM];
    for (let y = ALTURA - 1; y >= 0; y--) {
      const id = this.mundo.obterBloco(x, y, z);
      if (id !== B.AR && !LIQUIDO[id]) return y + 1;
    }
    return 0;
  }

  /** O bloco (x, y, z) está debaixo do céu aberto (nada que tape acima)? */
  _expostoAoCeu(x, y, z) {
    return y >= this._topoColuna(x, z);
  }

  /** Espaço livre para a caixa do tipo `def` com os pés em (px, py, pz), fora da água? */
  _cabe(def, px, py, pz) {
    if (this._colide(def.raio, def.altura, px, py, pz)) return false;
    return !LIQUIDO[this.mundo.obterBloco(Math.floor(px), Math.floor(py), Math.floor(pz))];
  }

  /** y onde um animal pode nascer na coluna (x, z): grama no topo e espaço livre. -1 se não der. */
  _acharGrama(def, x, z) {
    const y = this._topoColuna(x, z);
    if (y < 1 || y >= ALTURA - 2) return -1;
    if (this.mundo.obterBloco(x, y - 1, z) !== B.GRAMA) return -1;
    return this._cabe(def, x + 0.5, y, z + 0.5) ? y : -1;
  }

  /**
   * y onde um monstro pode nascer na coluna (x, z): chão firme, espaço livre
   * e luz < LUZ_MAX_MONSTRO. De noite tenta muitas vezes a superfície; a
   * qualquer hora tenta cavernas (de dia, só bem fundo). -1 se não der.
   */
  _acharLugarEscuro(def, x, z, yJogador, noite) {
    const mundo = this.mundo;
    const topo = this._topoColuna(x, z);
    let y = -1;
    if (noite && Math.random() < 0.6) {
      // Superfície
      if (topo >= 1 && topo < ALTURA - 2 && SOLIDO[mundo.obterBloco(x, topo - 1, z)]) y = topo;
    } else {
      // Caverna: começa numa altura sorteada perto do jogador e desce até achar chão
      let yy = Math.floor(yJogador) + Math.floor(Math.random() * 24) - 16;
      if (yy > ALTURA - 3) yy = ALTURA - 3;
      for (let k = 0; k < 24 && yy > 1; k++, yy--) {
        if (SOLIDO[mundo.obterBloco(x, yy - 1, z)] && !SOLIDO[mundo.obterBloco(x, yy, z)] &&
            !SOLIDO[mundo.obterBloco(x, yy + 1, z)]) {
          y = yy;
          break;
        }
      }
      if (y >= 0 && !noite && y > topo - PROFUNDIDADE_CAVERNA) return -1; // de dia, só no fundo
    }
    if (y < 1) return -1;
    if (typeof mundo.luzEm === 'function' && mundo.luzEm(x, y, z) >= LUZ_MAX_MONSTRO) return -1;
    return this._cabe(def, x + 0.5, y, z + 0.5) ? y : -1;
  }

  /** Mobs longe de todos os jogadores (ou caídos no abismo) somem */
  _sumirLonge() {
    const jog = this._jogadores;
    const d2max = DIST_SUMIR * DIST_SUMIR;
    for (let i = 0; i < this.lista.length; i++) {
      const m = this.lista[i];
      if (m.morrendo || m.descartar) continue;
      if (m.y < -20) { this._removerMob(m, false); continue; }
      if (m.def.chefao || jog.length === 0) continue;
      let perto = false;
      for (let k = 0; k < jog.length; k++) {
        const p = jog[k].posicao;
        if (!p) continue;
        const dx = p.x - m.x, dz = p.z - m.z;
        if (dx * dx + dz * dz <= d2max) { perto = true; break; }
      }
      if (!perto) this._removerMob(m, false);
    }
  }

  // ------------------------------------------------------------------
  // Simulação (anfitrião)
  // ------------------------------------------------------------------

  _simular(m, dt) {
    if (m.descartar) return;
    const def = m.def;
    if (m.recarga > 0) m.recarga -= dt;
    if (m.tAtacando > 0) m.tAtacando -= dt;
    if (m.tSubindo > 0) m.tSubindo -= dt;
    if (m.lento > 0) m.lento = Math.max(0, m.lento - dt);

    // Fogo (poder de fogo): 1 de dano por segundo enquanto durar
    if (m.queimar > 0 && !m.morrendo) {
      m.queimar -= dt;
      m.tQueimar += dt;
      if (m.tQueimar >= 1) {
        m.tQueimar -= 1;
        this._aplicarDano(m, DANO_QUEIMAR_POR_S, null, m.queimadoPor, 'fogo', null);
      }
      if (m.queimar <= 0) { m.queimar = 0; m.tQueimar = 0; }
    }

    if (m.morrendo) {
      m.querVel = 0;
      m.querVy = 0;
    } else {
      // Sol da manhã (a cada 0.5 s)
      m.tSol -= dt;
      if (m.tSol <= 0) {
        m.tSol = 0.5;
        this._conferirSol(m);
      }
      if (m.sol > 0) {
        m.sol -= dt;
        if (m.sol <= 0) {
          m.sol = 0;
          m.vida = 0;
          this._removerMob(m, true); // queimou: some (sem drops nem XP)
        }
      }
      // IA: pensa a cada IA_PERTO s (ou IA_LONGE s, se todos estão longe)
      m.dtIA += dt;
      m.acumIA -= dt;
      if (m.acumIA <= 0 && !m.morrendo) {
        m.distJogador = this._distJogadorMaisPerto(m);
        m.acumIA = m.distJogador < DIST_IA_PERTO ? IA_PERTO : IA_LONGE;
        const fn = COMPORTAMENTOS[def.comportamento] || COMPORTAMENTOS.animal;
        fn(this, m, m.dtIA);
        m.dtIA = 0;
      }
    }

    // Física, só onde o mundo existe (chunk carregado e com malha)
    if (this.mundo.estaPronto(m.x, m.z)) this._fisica(m, dt);

    // Flags para o desenho e para a rede
    let f = 0;
    if (m.vx * m.vx + m.vz * m.vz > 0.04) f |= F_ANDANDO;
    if (m.tAtacando > 0) f |= F_ATACANDO;
    if (m.queimar > 0 || m.sol > 0) f |= F_QUEIMANDO;
    if (m.lento > 0) f |= F_LENTO;
    if (m.tSubindo > 0) f |= F_SUBINDO;
    if (!m.noChao && !m.naAgua && m.tSubindo <= 0) f |= F_NO_AR;
    if (m.naAgua) f |= F_NADANDO;
    m.flags = f | ((m.golpes & 15) << 8);
    m.vidaFrac = Math.max(0, m.vida / def.vidaMax);
  }

  /** Começa a queimar no sol? (monstros, de dia, sob o céu aberto e fora da água) */
  _conferirSol(m) {
    const def = m.def;
    if (!def.queimaNoSol || def.chefao || m.sol > 0 || !this.ceu) return;
    if (this.ceu.ehNoite || this.ceu.luzDoDia < LUZ_SOL_QUEIMA || m.naAgua) return;
    const hx = Math.floor(m.x), hy = Math.floor(m.y + def.altura - 0.1), hz = Math.floor(m.z);
    if (!this.mundo.estaPronto(hx, hz)) return;
    if (this._expostoAoCeu(hx, hy, hz)) {
      m.sol = TEMPO_SOL;
      m.alvoId = null;
    }
  }

  _distJogadorMaisPerto(m) {
    const jog = this._jogadores;
    let melhor = Infinity;
    for (let i = 0; i < jog.length; i++) {
      const p = jog[i].posicao;
      if (!p) continue;
      const dx = p.x - m.x, dz = p.z - m.z;
      const d = dx * dx + dz * dz;
      if (d < melhor) melhor = d;
    }
    return Math.sqrt(melhor);
  }

  _jogadorPorId(id) {
    if (id === null || id === undefined) return null;
    const jog = this._jogadores;
    for (let i = 0; i < jog.length; i++) if (jog[i].id === id) return jog[i];
    return null;
  }

  /** O jogador `j` serve de alvo para o monstro `m`? (perto, sem estar voando alto) */
  _alvoValido(m, j, maxDist) {
    const p = j && j.posicao;
    if (!p) return false;
    const dx = p.x - m.x, dy = p.y - m.y, dz = p.z - m.z;
    if (dx * dx + dz * dz > maxDist * maxDist || dy > 10 || dy < -10) return false;
    return !this._voandoAlto(p);
  }

  /** Ninguém embaixo dos pés por 5 blocos = voando alto (/voar): os monstros ignoram */
  _voandoAlto(p) {
    if (this.mundo.estaPronto && !this.mundo.estaPronto(p.x, p.z)) return false;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    const y0 = Math.floor(p.y - 0.01);
    for (let k = 0; k <= 5; k++) {
      const id = this.mundo.obterBloco(x, y0 - k, z);
      if (SOLIDO[id] || LIQUIDO[id]) return false;
    }
    return y0 - 5 > 0;
  }

  /** Jogador válido mais perto que o monstro consegue ver (raio de visão + linha de visão) */
  _procurarAlvo(m) {
    const jog = this._jogadores;
    let melhor = null, melhorD = Infinity;
    for (let i = 0; i < jog.length; i++) {
      const j = jog[i];
      if (!this._alvoValido(m, j, m.def.visao)) continue;
      const dx = j.posicao.x - m.x, dz = j.posicao.z - m.z;
      const d = dx * dx + dz * dz;
      if (d < melhorD) { melhorD = d; melhor = j; }
    }
    if (melhor && !this._linhaDeVisao(m, melhor.posicao)) return null;
    return melhor;
  }

  /** Nenhum bloco entre os olhos do mob e a cabeça do jogador? */
  _linhaDeVisao(m, p) {
    if (typeof this.mundo.raycast !== 'function') return true;
    const o = this._origemVisao, d = this._dirVisao;
    o.x = m.x; o.y = m.y + m.def.altura * 0.85; o.z = m.z;
    d.x = p.x - o.x; d.y = p.y + 1.5 - o.y; d.z = p.z - o.z;
    const dist = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (dist < 1) return true;
    const r = this.mundo.raycast(o, d, dist);
    return !r || r.t >= dist - 0.6;
  }

  /** Fase 8: ataque à distância. Sem gancho registrado, o mob só se aproxima. */
  _ataqueDistancia(m, alvo, dist) {
    const fn = this._fnAtaqueDistancia;
    if (!fn) return false;
    try {
      return fn({ mobs: this, mob: m, alvo, dist }) === true;
    } catch (e) {
      console.warn('Hackraft: ataque à distância falhou', e);
      return false;
    }
  }

  /** Velocidade vertical para quem voa chegar na altura `y` */
  _vyParaAltura(m, y) {
    const d = y - m.y;
    return Math.max(-4, Math.min(4, d * 1.5));
  }

  /** y do chão embaixo do mob (até 16 blocos), para quem voa */
  _chaoAbaixo(m) {
    const x = Math.floor(m.x), z = Math.floor(m.z);
    let y = Math.floor(m.y);
    for (let k = 0; k < 16 && y > 0; k++, y--) {
      if (SOLIDO[this.mundo.obterBloco(x, y - 1, z)]) return y;
    }
    return y;
  }

  /**
   * Dá para andar na direção (dx, dz)? Olha a coluna logo à frente do corpo:
   * chunk carregado, sem água funda e sem uma queda maior que `quedaMax`.
   * (Parede não conta: a física pula o degrau ou o mob fica "preso" e a IA
   * escolhe outro caminho.)
   */
  _caminhoLivre(m, dx, dz, quedaMax) {
    const def = m.def;
    if (def.voa) return true;
    const alcance = def.raio + 0.45;
    const ax = Math.floor(m.x + dx * alcance), az = Math.floor(m.z + dz * alcance);
    const mundo = this.mundo;
    if (!mundo.estaPronto(ax, az)) return false; // não anda para onde o mundo não existe
    const y0 = Math.floor(m.y + 0.01);
    const pe = mundo.obterBloco(ax, y0, az);
    if (SOLIDO[pe]) return true; // parede ou degrau à frente
    if (LIQUIDO[pe]) return m.naAgua || !LIQUIDO[mundo.obterBloco(ax, y0 - 1, az)]; // água rasa tudo bem
    for (let k = 0; k <= quedaMax; k++) {
      const id = mundo.obterBloco(ax, y0 - 1 - k, az);
      if (SOLIDO[id]) return true;
      if (LIQUIDO[id]) return !LIQUIDO[mundo.obterBloco(ax, y0 - 2 - k, az)];
    }
    return false; // buraco fundo demais
  }

  // ------------------------------------------------------------------
  // Física (anfitrião)
  // ------------------------------------------------------------------

  _fisica(m, dt) {
    const def = m.def;
    // Começou dentro de um bloco (alguém colocou um bloco nele)? Sobe até achar espaço.
    if (this._colide(def.raio, def.altura, m.x, m.y, m.z)) {
      for (let k = 1; k <= 3; k++) {
        const y = Math.floor(m.y + EPS) + k;
        if (!this._colide(def.raio, def.altura, m.x, y, m.z)) { m.y = y; if (m.vy < 0) m.vy = 0; break; }
      }
    }

    // Velocidade horizontal: aproxima da que a IA quer (no ar quase não muda)
    let vel = m.querVel;
    if (m.lento > 0) vel *= FATOR_LENTO;
    if (m.naAgua) vel *= 0.6;
    const desX = m.querX * vel, desZ = m.querZ * vel;
    const k = Math.min(1, (m.noChao || m.naAgua || def.voa ? ACEL_CHAO : ACEL_AR) * dt);
    m.vx += (desX - m.vx) * k;
    m.vz += (desZ - m.vz) * k;

    // Vertical
    if (def.voa) {
      m.vy += (m.querVy - m.vy) * Math.min(1, 4 * dt);
    } else if (m.naAgua) {
      // Boia: com a cabeça na água sobe, com a cabeça fora fica balançando na superfície
      const cabecaNaAgua = this._liquidoEm(m.x, m.y + def.altura * 0.6, m.z);
      m.vy += ((cabecaNaAgua ? 2.2 : 0) - m.vy) * Math.min(1, 4 * dt);
    } else if (m.tSubindo > 0 && def.sobeParede) {
      m.vy = VEL_SUBIR_PAREDE;
    } else {
      m.vy -= GRAVIDADE * dt;
      if (def.planar && m.vy < -VEL_PLANAR) m.vy = -VEL_PLANAR;
      if (m.vy < -VEL_MAX_QUEDA) m.vy = -VEL_MAX_QUEDA;
    }

    this._mover(m, dt);
    m.naAgua = this._liquidoEm(m.x, m.y + 0.2, m.z);

    // Bateu numa parede querendo andar: a aranha sobe; os outros pulam o degrau
    const querAndar = m.querVel > 0 && !m.morrendo;
    if (m.bateuParede && querAndar) {
      if (def.sobeParede) {
        m.tSubindo = 0.25;
      } else if ((m.noChao || m.naAgua) && this._degrauLivre(m)) {
        m.vy = m.naAgua ? 5.5 : VEL_PULO_MOB;
        m.noChao = false;
      } else {
        m.tPreso += dt;
      }
    } else if (m.tPreso > 0) {
      m.tPreso = Math.max(0, m.tPreso - dt * 0.5);
    }

    // Vira devagar para onde quer olhar
    let d = m.yawAlvo - m.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const passo = VEL_GIRO * dt;
    m.yaw += d > passo ? passo : (d < -passo ? -passo : d);
  }

  /** Dá para pular: tem espaço 1 bloco acima, um pouco à frente? */
  _degrauLivre(m) {
    const def = m.def;
    return !this._colide(def.raio, def.altura, m.x + m.querX * 0.35, m.y + 1.05, m.z + m.querZ * 0.35);
  }

  _liquidoEm(x, y, z) {
    return LIQUIDO[this.mundo.obterBloco(Math.floor(x), Math.floor(y), Math.floor(z))] === 1;
  }

  /** Anda um eixo por vez, parando ao encostar num bloco */
  _mover(m, dt) {
    const r = m.def.raio, h = m.def.altura;
    m.bateuParede = false;
    const dx = m.vx * dt, dz = m.vz * dt, dy = m.vy * dt;
    if (dx !== 0) {
      const nx = m.x + dx;
      if (!this._colide(r, h, nx, m.y, m.z)) m.x = nx;
      else {
        const f = this._bloqueio(r, h, nx, m.y, m.z, EIXO_X, dx > 0 ? 1 : -1);
        if (f === f) m.x = f; // (f === f é false só para NaN)
        m.vx = 0;
        m.bateuParede = true;
      }
    }
    if (dz !== 0) {
      const nz = m.z + dz;
      if (!this._colide(r, h, m.x, m.y, nz)) m.z = nz;
      else {
        const f = this._bloqueio(r, h, m.x, m.y, nz, EIXO_Z, dz > 0 ? 1 : -1);
        if (f === f) m.z = f;
        m.vz = 0;
        m.bateuParede = true;
      }
    }
    m.noChao = false;
    if (dy !== 0) {
      const ny = m.y + dy;
      if (!this._colide(r, h, m.x, ny, m.z)) m.y = ny;
      else {
        const f = this._bloqueio(r, h, m.x, ny, m.z, EIXO_Y, dy > 0 ? 1 : -1);
        if (f === f) m.y = f;
        if (dy < 0) m.noChao = true;
        m.vy = 0;
      }
    }
    if (!m.noChao && m.vy <= 0 && this._colide(r, h, m.x, m.y - 0.05, m.z)) m.noChao = true;
  }

  /** A caixa (raio r, altura h) com os pés em (px, py, pz) encosta em algum bloco? */
  _colide(r, h, px, py, pz) {
    return this._bloqueio(r, h, px, py, pz, 0, 0) === true;
  }

  /**
   * Procura bloqueios para a caixa com os pés em (px, py, pz). Sem eixo:
   * devolve true se encosta em algo. Com eixo (EIXO_X/Y/Z) e o sentido d
   * (+1 ou -1): devolve a posição naquele eixo em que a caixa fica
   * encostada na face mais próxima, ou NaN. (Mesma ideia do player.js.)
   */
  _bloqueio(r, h, px, py, pz, eixo, d) {
    const x0 = Math.floor(px - r + EPS), x1 = Math.floor(px + r - EPS);
    const y0 = Math.floor(py + EPS), y1 = Math.floor(py + h - EPS);
    const z0 = Math.floor(pz - r + EPS), z1 = Math.floor(pz + r - EPS);
    const mundo = this.mundo;
    const temCaixa = typeof mundo.caixaColisao === 'function';
    let melhor = NaN;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = mundo.obterBloco(x, y, z);
          if (id === 0 || !SOLIDO[id]) continue;
          let c = CAIXA_CHEIA;
          if (MODELO_ESPECIAL[id] && temCaixa) {
            c = mundo.caixaColisao(x, y, z);
            if (!c) continue;
            // A caixa fina (porta) encosta mesmo na caixa do mob?
            if (px - r + EPS >= x + c[3] || px + r - EPS <= x + c[0] ||
                py + EPS >= y + c[4] || py + h - EPS <= y + c[1] ||
                pz - r + EPS >= z + c[5] || pz + r - EPS <= z + c[2]) continue;
          }
          if (eixo === 0) return true;
          let cand;
          if (eixo === EIXO_X) cand = d > 0 ? x + c[0] - r : x + c[3] + r;
          else if (eixo === EIXO_Z) cand = d > 0 ? z + c[2] - r : z + c[5] + r;
          else cand = d > 0 ? y + c[1] - h : y + c[4];
          if (melhor !== melhor || (d > 0 ? cand < melhor : cand > melhor)) melhor = cand;
        }
      }
    }
    return eixo === 0 ? false : melhor;
  }

  // ------------------------------------------------------------------
  // Combate
  // ------------------------------------------------------------------

  /** Meu id (o mesmo que o main usa no obterJogadores) */
  _idLocal() {
    return this.rede && this.rede.meuId ? this.rede.meuId : 'local';
  }

  /** O monstro `m` bateu no jogador `j` */
  _baterNoJogador(m, j) {
    const qtd = m.def.dano;
    if (!(qtd > 0)) return;
    const de = [m.x, m.y, m.z];
    if (j.local) {
      this._emitirDano({ qtd, de, efeito: null });
    } else if (this.rede && typeof this.rede.enviarDanoJogador === 'function') {
      this.rede.enviarDanoJogador(j.id, qtd, de, null);
    }
  }

  _emitirDano(ev) {
    for (const fn of this._ouvintesDano) {
      try { fn(ev); } catch (e) { console.error(e); }
    }
  }

  _emitirXp(qtd) {
    for (const fn of this._ouvintesXp) {
      try { fn(qtd); } catch (e) { console.error(e); }
    }
  }

  /**
   * (Anfitrião) Aplica dano no mob. `dir` = direção do golpe ({ x, y, z } ou
   * null), `quem` = id do jogador que bateu (ou null), `tipo` = 'golpe' |
   * 'fogo' | 'raio' | 'gelo', `efeito` = { queimar?, lento? } ou null.
   */
  _aplicarDano(m, qtd, dir, quem, tipo, efeito) {
    if (m.morrendo || m.descartar || !(qtd > 0)) return false;
    const def = m.def;
    m.vida -= qtd;
    m.golpes = (m.golpes + 1) & 15;
    m.vidaFrac = Math.max(0, m.vida / def.vidaMax);
    this._mostrarDano(m, m.vidaFrac, m.vida > 0); // no golpe final toca só o som de morte

    // Recuo: empurrão para longe de quem bateu
    let nx = 0, nz = 0;
    if (dir) {
      const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
      if (len > 0.001) { nx = dir.x / len; nz = dir.z / len; }
    }
    if (nx !== 0 || nz !== 0) { // (o fogo queimando por dentro não tem direção: sem empurrão)
      m.vx = nx * RECUO_GOLPE;
      m.vz = nz * RECUO_GOLPE;
      if (m.noChao || m.naAgua) m.vy = RECUO_CIMA;
    }

    // Efeitos dos poderes
    if (efeito) {
      if (efeito.queimar > 0) {
        m.queimar = Math.max(m.queimar, Math.min(10, efeito.queimar));
        m.queimadoPor = quem;
      }
      if (efeito.lento > 0) m.lento = Math.max(m.lento, Math.min(10, efeito.lento));
    }

    // Reação: o animal foge; o monstro vai atrás de quem bateu
    if (!def.hostil) {
      m.estado = 'fugir';
      m.tEstado = TEMPO_FUGA;
      m.fugirX = m.x - nx;
      m.fugirZ = m.z - nz;
      if (nx === 0 && nz === 0) {
        const j = this._jogadorPorId(quem);
        if (j && j.posicao) { m.fugirX = j.posicao.x; m.fugirZ = j.posicao.z; }
      }
      m.desvioLado = Math.random() < 0.5 ? 1 : -1;
      m.acumIA = 0; // pensa já
    } else if (quem && this._jogadorPorId(quem)) {
      m.alvoId = quem;
    }

    if (m.vida <= 0) {
      m.vida = 0;
      this._matar(m, quem);
    }
    return true;
  }

  /** Morreu: animação, drops no chão e XP para quem matou */
  _matar(m, quem) {
    const def = m.def;
    this._removerMob(m, true);
    this._soltarDrops(m);
    if (!(def.xp > 0) || !quem) return;
    if (quem === this._idLocal()) {
      this._emitirXp(def.xp);
    } else if (this.rede && typeof this.rede.enviarXp === 'function') {
      this.rede.enviarXp(quem, def.xp);
    }
  }

  /** Sorteia os drops do tipo e põe no chão (pelo mesmo caminho dos itens soltos) */
  _soltarDrops(m) {
    const drops = m.def.drops;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d || !ITENS.has(d.item) || Math.random() >= (d.chance ?? 1)) continue;
      const min = d.min ?? 1, max = d.max ?? min;
      const qtd = min + Math.floor(Math.random() * (max - min + 1));
      if (qtd <= 0) continue;
      const vx = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2, vy = 3;
      const y = m.y + Math.min(0.6, m.def.altura * 0.5);
      if (this.rede && typeof this.rede.soltarDrop === 'function') {
        this.rede.soltarDrop(d.item, qtd, m.x, y, m.z, vx, vy, vz);
      } else if (this.itensChao) {
        this.itensChao.criar(this.itensChao.novoId(), d.item, qtd, m.x, y, m.z, vx, vy, vz, false);
      }
    }
  }

  /** Pisca, mostra a barra de vida (se souber a vida) e toca o som de dano */
  _mostrarDano(m, frac, comSom) {
    const mod = m.modelo;
    if (mod) {
      mod.piscarDano();
      if (frac !== null) mod.definirVida(frac);
    }
    if (comSom) this._tocar(m, 'dano');
    if (m.def.chefao && frac !== null && this.ui && typeof this.ui.mostrarBarraChefao === 'function') {
      this.ui.mostrarBarraChefao(m.def.nome, frac);
    }
  }

  /**
   * Bater num mob (o jogador local, com a mão ou a espada). `dir` pode ser um
   * Vector3 reaproveitado: só os números são usados. Anfitrião/sozinho:
   * aplica na hora. Cliente: pisca e toca o som já (para não parecer
   * atrasado) e pede ao anfitrião, que confere e aplica de verdade.
   */
  atacar(id, dano, dir) {
    const m = this.porId.get(id);
    if (!m || m.morrendo || m.descartar || !(dano > 0)) return false;
    if (this.autoridade) return this._aplicarDano(m, dano, dir, this._idLocal(), 'golpe', null);
    m.piscouLocal = performance.now();
    this._mostrarDano(m, null, true);
    if (this.rede && typeof this.rede.enviarAtacarMob === 'function') {
      this.rede.enviarAtacarMob(id, dano, dir, 'golpe', null);
    }
    return true;
  }

  /** Um poder (fogo, raio, gelo) acertou o alvo do mob (chamado pelo Poderes) */
  _danoDePoder(alvo, qtd, tipo, efeito) {
    const m = this.porId.get(alvo.id);
    if (!m || m.morrendo || m.descartar || !(qtd > 0)) return;
    // Direção do empurrão: do meu jogador para o mob
    let dir = null;
    const loc = this._local;
    if (loc && loc.posicao) {
      const d = this._dirPoder;
      d.x = m.x - loc.posicao.x; d.y = 0; d.z = m.z - loc.posicao.z;
      dir = d;
    }
    const ef = efeito && (efeito.queimar > 0 || efeito.lento > 0) ? efeito : null;
    const t = tipo === 'fogo' || tipo === 'raio' || tipo === 'gelo' ? tipo : 'golpe';
    if (this.autoridade) {
      this._aplicarDano(m, qtd, dir, this._idLocal(), t, ef);
      return;
    }
    m.piscouLocal = performance.now();
    this._mostrarDano(m, null, true);
    if (this.rede && typeof this.rede.enviarAtacarMob === 'function') {
      this.rede.enviarAtacarMob(m.id, qtd, dir, t, ef);
    }
  }

  /**
   * (Anfitrião) Ataque de um cliente, já conferido pela rede (o mob existe,
   * o dano é razoável e o jogador está perto). Devolve true se aplicou.
   */
  aplicarAtaqueRemoto(quem, id, dano, dir, ataque = 'golpe', efeito = null) {
    if (!this.autoridade) return false;
    const m = this.porId.get(id);
    if (!m || m.morrendo || m.descartar) return false;
    return this._aplicarDano(m, dano, dir, quem, ataque, efeito);
  }

  /** (Anfitrião) Centro do corpo do mob `id` (objeto reaproveitado), ou null se não existe/morrendo */
  posicaoMob(id) {
    const m = this.porId.get(id);
    if (!m || m.morrendo || m.descartar) return null;
    const p = this._posMob;
    p.x = m.x; p.y = m.y + m.def.altura * 0.5; p.z = m.z;
    return p;
  }

  /**
   * Mob na mira: o raio (origem, dir) bate na caixa de algum mob a até
   * `alcance` blocos? Devolve { id, t } (objeto reaproveitado; t = distância)
   * ou null. Usa as posições desenhadas na tela (no cliente, as interpoladas).
   */
  raycastMob(origem, dir, alcance) {
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 0)) return null;
    dx /= len; dy /= len; dz /= len;
    const ox = origem.x, oy = origem.y, oz = origem.z;
    let melhorT = alcance, melhor = null;
    for (let i = 0; i < this.lista.length; i++) {
      const m = this.lista[i];
      if (m.morrendo || m.descartar) continue;
      const r = m.def.raio + 0.1; // um pouquinho maior: mais fácil de acertar
      const t = raioCaixa(ox, oy, oz, dx, dy, dz,
        m.x - r, m.y, m.z - r, m.x + r, m.y + m.def.altura + 0.1, m.z + r, melhorT);
      if (t >= 0 && t <= melhorT) { melhorT = t; melhor = m; }
    }
    if (!melhor) return null;
    const res = this._resultadoRaio;
    res.id = melhor.id;
    res.t = melhorT;
    return res;
  }

  /**
   * Lista para poderes.registrarAlvos: [{ id, posicao, raio, receberDano }].
   * O Poderes usa uma esfera de centro posicao + (0, raio, 0); por isso a
   * posição fica abaixo do centro do corpo. A lista é reaproveitada.
   */
  alvosParaPoderes() {
    const l = this._alvos;
    l.length = 0;
    for (let i = 0; i < this.lista.length; i++) {
      const m = this.lista[i];
      if (m.morrendo || m.descartar) continue;
      const a = m.alvo;
      a.posicao.set(m.x, m.y + m.def.altura * 0.5 - a.raio, m.z);
      l.push(a);
    }
    return l;
  }

  // ------------------------------------------------------------------
  // Rede: anfitrião → clientes
  // ------------------------------------------------------------------

  /** ~10 vezes por segundo: o estado de todos os mobs vivos (só se houver clientes) */
  _enviarEstado() {
    const r = this.rede;
    if (!r || r.modo !== 'anfitriao' || typeof r.enviarEstadoMobs !== 'function' || !r.temClientes) return;
    const agora = performance.now();
    if (agora - this._tEnvio < 1000 / ENVIOS_POR_SEGUNDO) return;
    this._tEnvio = agora;
    const buf = this._bufRede;
    let n = 0;
    for (let i = 0; i < this.lista.length && n < MAX_MOBS_REDE; i++) {
      const m = this.lista[i];
      if (m.morrendo || m.descartar) continue;
      const k = n * CAMPOS_REDE;
      buf[k] = m.id;
      buf[k + 1] = m.def.indice;
      buf[k + 2] = m.x;
      buf[k + 3] = m.y;
      buf[k + 4] = m.z;
      buf[k + 5] = m.yaw;
      buf[k + 6] = m.flags;
      buf[k + 7] = m.vidaFrac;
      n++;
    }
    // Sem mobs: manda uma mensagem vazia só uma vez (não precisa repetir)
    if (n === 0) {
      if (this._enviouVazio) return;
      this._enviouVazio = true;
    } else {
      this._enviouVazio = false;
    }
    r.enviarEstadoMobs(agora, buf.subarray(0, n * CAMPOS_REDE));
  }

  /** Lista para o `bemvindo` de quem entra: [[id, tipo, x, y, z, yaw, vida], ...] */
  exportarParaRede() {
    const l = [];
    for (let i = 0; i < this.lista.length && l.length < MAX_MOBS_REDE; i++) {
      const m = this.lista[i];
      if (m.morrendo || m.descartar) continue;
      l.push([m.id, m.tipo, m.x, m.y, m.z, m.yaw, m.vidaFrac]);
    }
    return l;
  }

  // ------------------------------------------------------------------
  // Rede: cliente (recebe do anfitrião)
  // ------------------------------------------------------------------

  /** Um mob nasceu (ou já existia quando entrei) */
  receberNovo(id, tipo, x, y, z, yaw, vida = 1) {
    if (this.autoridade) return;
    let m = this.porId.get(id);
    if (m && (m.tipo !== tipo || m.morrendo)) {
      // Id reaproveitado com outro tipo (muito raro): troca
      m.descartar = true;
      m = null;
    }
    if (!m) {
      m = this._novo(id, tipo, x, y, z, yaw || 0, Math.max(0, Math.min(1, vida)));
      if (!m) return;
    }
    this._guardarPosicao(m, this._offset === null ? NaN : performance.now() - this._offset, x, y, z, yaw || 0);
  }

  /**
   * Estado de todos os mobs (Float32Array, 8 números por mob). `t` é o
   * relógio do anfitrião quando mandou.
   */
  receberEstado(t, dados) {
    if (this.autoridade) return;
    // Diferença entre o meu relógio e o do anfitrião. Fica com a MENOR já vista
    // (a mensagem que chegou mais rápido), subindo devagar se o atraso mudar.
    const off = performance.now() - t;
    if (this._offset === null || off < this._offset) this._offset = off;
    else this._offset += (off - this._offset) * 0.02;

    for (let k = 0; k + CAMPOS_REDE <= dados.length; k += CAMPOS_REDE) {
      const id = dados[k], idx = dados[k + 1];
      const x = dados[k + 2], y = dados[k + 3], z = dados[k + 4], yaw = dados[k + 5];
      const flags = dados[k + 6], vida = dados[k + 7];
      if (!Number.isInteger(id) || id < 1 || !Number.isFinite(x) || !Number.isFinite(y) ||
          !Number.isFinite(z) || !Number.isFinite(yaw) || !Number.isFinite(vida) || !Number.isInteger(flags)) continue;
      let m = this.porId.get(id);
      if (!m) {
        // Não sabia deste mob (não deveria acontecer): cria pelo número do tipo
        const tipo = ORDEM_TIPOS[idx];
        if (!tipo) continue;
        m = this._novo(id, tipo, x, y, z, yaw, Math.max(0, Math.min(1, vida)));
        if (!m) continue;
      }
      if (m.morrendo || m.descartar) continue;
      this._guardarPosicao(m, t, x, y, z, yaw);
      m.flags = flags;
      m.vidaFrac = Math.max(0, Math.min(1, vida));
      // Contador de golpes mudou: o mob apanhou (pisca e mostra a barra)
      const golpes = (flags >> 8) & 15;
      if (m.golpesVistos >= 0 && golpes !== m.golpesVistos) {
        // Se fui eu que bati agora há pouco, a piscada e o som já aconteceram
        const jaMostrei = performance.now() - m.piscouLocal < 600;
        if (jaMostrei) {
          if (m.modelo) m.modelo.definirVida(m.vidaFrac);
          m.piscouLocal = -Infinity;
        } else {
          this._mostrarDano(m, m.vidaFrac, true);
        }
      }
      m.golpesVistos = golpes;
    }
  }

  /** O anfitrião tirou o mob do jogo (morreu = animação de morte) */
  receberRemovido(id, morreu) {
    if (this.autoridade) return;
    const m = this.porId.get(id);
    if (!m) return;
    if (morreu) {
      if (m.morrendo) return;
      m.morrendo = true;
      m.tMorte = 0;
      m.vidaFrac = 0;
      if (m.modelo) m.modelo.definirVida(0);
      this._tocar(m, 'morte');
    } else {
      m.descartar = true;
    }
  }

  /** (Cliente) Um mob me bateu (mensagem `dano` do anfitrião) */
  receberDanoDaRede(ev) {
    if (!ev || !(ev.qtd > 0)) return;
    this._emitirDano(ev);
  }

  /** (Cliente) Ganhei XP por matar um mob */
  receberXp(qtd) {
    if (qtd > 0) this._emitirXp(qtd);
  }

  /**
   * Guarda uma posição recebida no histórico do mob (t = relógio do
   * anfitrião). Sem relógio ainda (NaN), a posição vale "provisória": é
   * usada direto até chegar a primeira mensagem `mobs`.
   */
  _guardarPosicao(m, t, x, y, z, yaw) {
    const h = m.hist;
    if (t !== t) { // NaN
      m.nHist = 1;
      m.histProvisorio = true;
      h[0] = 0; h[1] = x; h[2] = y; h[3] = z; h[4] = yaw;
      m.x = x; m.y = y; m.z = z; m.yaw = yaw;
      return;
    }
    if (m.histProvisorio) { m.nHist = 0; m.histProvisorio = false; }
    let n = m.nHist;
    if (n > 0 && t <= h[(n - 1) * 5]) return; // fora de ordem ou repetida
    if (n === HIST) {
      // Cheio: empurra todo mundo uma casa para trás (são só 4 posições)
      h.copyWithin(0, 5, HIST * 5);
      n = HIST - 1;
    }
    const k = n * 5;
    h[k] = t; h[k + 1] = x; h[k + 2] = y; h[k + 3] = z; h[k + 4] = yaw;
    m.nHist = n + 1;
  }

  _interpolarTodos() {
    const tr = this._offset === null ? NaN : performance.now() - this._offset - ATRASO_INTERP_MS;
    for (let i = 0; i < this.lista.length; i++) {
      const m = this.lista[i];
      if (m.descartar) continue;
      this._interpolar(m, tr);
    }
  }

  /**
   * Interpolação (cliente): o mob é desenhado onde ele estava 100 ms atrás,
   * no relógio do anfitrião. Como já temos a mensagem de antes e a de
   * depois desse instante, dá para desenhar no meio do caminho entre as
   * duas, e o movimento fica suave mesmo com as mensagens chegando só
   * 10 vezes por segundo (e com pequenos atrasos da internet).
   */
  _interpolar(m, tr) {
    const n = m.nHist;
    if (n === 0) return;
    const h = m.hist;
    let a = 0, b = 0, f = 0;
    if (n === 1 || tr !== tr || tr <= h[0]) {
      a = b = 0;
    } else if (tr >= h[(n - 1) * 5]) {
      a = b = n - 1; // sem mensagem nova ainda: fica parado na última
    } else {
      for (let i = 0; i < n - 1; i++) {
        const t0 = h[i * 5], t1 = h[(i + 1) * 5];
        if (tr >= t0 && tr < t1) {
          a = i; b = i + 1;
          f = (tr - t0) / (t1 - t0);
          break;
        }
      }
    }
    const ka = a * 5, kb = b * 5;
    m.x = h[ka + 1] + (h[kb + 1] - h[ka + 1]) * f;
    m.y = h[ka + 2] + (h[kb + 2] - h[ka + 2]) * f;
    m.z = h[ka + 3] + (h[kb + 3] - h[ka + 3]) * f;
    let dy = h[kb + 4] - h[ka + 4];
    dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // vira pelo lado mais curto
    m.yaw = h[ka + 4] + dy * f;
  }

  // ------------------------------------------------------------------
  // Desenho (anfitrião e cliente)
  // ------------------------------------------------------------------

  _visual(m, dt) {
    const mod = m.modelo;
    if (!mod) return;
    const def = m.def;
    if (m.morrendo) m.tMorte = Math.min(1, m.tMorte + dt / TEMPO_MORTE);

    // Longe do meu jogador: nem desenha nem anima
    const loc = this._local;
    let dist = 0;
    if (loc) {
      const dx = m.x - loc.posicao.x, dy = m.y - loc.posicao.y, dz = m.z - loc.posicao.z;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    m.distLocal = dist;
    const visivel = dist < DIST_VISIVEL && !m.descartar;
    mod.grupo.visible = visivel;

    // Velocidade (para a animação das pernas), medida pelo deslocamento
    const ddx = m.x - m.xAnt, ddz = m.z - m.zAnt;
    m.xAnt = m.x; m.zAnt = m.z;
    const inst = Math.sqrt(ddx * ddx + ddz * ddz) / dt;
    m.velAnim += ((inst < 20 ? inst : 0) - m.velAnim) * Math.min(1, dt * 10);
    if (!visivel) return;

    const fl = m.flags;
    // Aranha na parede: inclina o corpo para cima (de barriga para a parede)
    const subindo = (fl & F_SUBINDO) !== 0 && !m.morrendo;
    m.inclinacao += ((subindo ? 1 : 0) - m.inclinacao) * Math.min(1, dt * 10);
    const inc = m.inclinacao;
    const g = mod.grupo;
    if (inc > 0.001) {
      const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw); // para onde o mob olha
      const frente = def.raio * 0.95 * inc;
      g.position.set(m.x + fx * frente, m.y + def.raio * inc, m.z + fz * frente);
    } else {
      g.position.set(m.x, m.y, m.z);
    }
    g.rotation.set(inc * Math.PI / 2, m.yaw, 0);

    // Animação
    const an = m.anim;
    an.atacando = (fl & F_ATACANDO) !== 0;
    an.voando = (fl & F_NO_AR) !== 0;
    an.nadando = (fl & F_NADANDO) !== 0;
    mod.animar(dt, m.morrendo ? 0 : m.velAnim, an);
    if (m.morrendo) mod.morrer(m.tMorte);

    // Luz do lugar (a cada 0.25 s), com um tom azulado quando está lento
    m.tLuz -= dt;
    if (m.tLuz <= 0) {
      m.tLuz = 0.25;
      const luz = typeof this.mundo.luzEm === 'function'
        ? this.mundo.luzEm(m.x, m.y + def.altura * 0.6, m.z)
        : (this.ceu ? this.ceu.luzDoDia : 1);
      mod.definirLuz(luz);
      if ((fl & F_LENTO) !== 0 && Array.isArray(mod._materiais)) {
        for (const mat of mod._materiais) {
          if (mat && mat.color) { mat.color.r *= 0.55; mat.color.g *= 0.8; }
        }
      }
    }

    const part = this.particulas;
    if (part && typeof part.emitir === 'function' && dist < 48) {
      // Pegando fogo (poder de fogo ou sol da manhã)
      if ((fl & F_QUEIMANDO) !== 0) {
        m.tFogo -= dt;
        if (m.tFogo <= 0) {
          m.tFogo = 0.1;
          EF_FOGO.x = m.x; EF_FOGO.y = m.y + def.altura * 0.4; EF_FOGO.z = m.z;
          EF_FOGO.espalhar = Math.max(0.4, def.raio * 1.6);
          part.emitir(EF_FOGO);
        }
      }
      // Lento (gelo): flocos caindo
      if ((fl & F_LENTO) !== 0 && typeof part.neve === 'function') {
        m.tNeve -= dt;
        if (m.tNeve <= 0) {
          m.tNeve = 0.35;
          part.neve(m.x, m.y + def.altura, m.z);
        }
      }
    }

    // Barulhinho de vez em quando (oinc, cocoricó, gemido, chiado). No máximo
    // um a cada INTERVALO_SOM_IDLE s para todos os mobs juntos: com 40 mobs
    // perto, seria um coral (e cada som cria vários nós de áudio).
    m.tSom -= dt;
    if (m.tSom <= 0) {
      if (this._esperaSomIdle > 0 || m.morrendo || dist >= DIST_SOM) {
        m.tSom = 1 + Math.random() * 3; // tenta de novo daqui a pouco
      } else {
        m.tSom = 6 + Math.random() * 10;
        this._esperaSomIdle = INTERVALO_SOM_IDLE;
        this._tocar(m, 'idle');
      }
    }
  }

  /** Toca um som do mob, mais baixo quanto mais longe do meu jogador */
  _tocar(m, evento) {
    const s = this.som;
    if (!s || typeof s.mob !== 'function') return;
    let vol = 1;
    const loc = this._local;
    if (loc) {
      const dx = m.x - loc.posicao.x, dy = m.y - loc.posicao.y, dz = m.z - loc.posicao.z;
      vol = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / DIST_SOM;
    }
    if (vol > 0.02) s.mob(m.def.som, evento, vol);
  }
}

/**
 * Raio contra caixa (método das "fatias"): devolve a distância t em que o
 * raio (o + d·t, d de comprimento 1) entra na caixa, ou -1 se não bate até tMax.
 * Se a origem já está dentro da caixa, devolve 0.
 */
function raioCaixa(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, tMax) {
  let tmin = 0, tmax = tMax;
  // X
  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return -1;
  } else {
    let t1 = (x0 - ox) / dx, t2 = (x1 - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return -1;
  } else {
    let t1 = (y0 - oy) / dy, t2 = (y1 - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return -1;
  } else {
    let t1 = (z0 - oz) / dz, t2 = (z1 - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
