// =====================================================================
// Hackraft - Mobs: animais de dia, monstros à noite (Fase 7) e
//            monstros estilo RPG, projéteis e chefões (Fase 8)
// ---------------------------------------------------------------------
// QUEM FAZ O QUÊ
//   - O ANFITRIÃO (ou quem joga sozinho) é a "autoridade": só ele decide
//     onde os mobs nascem, para onde andam, quanta vida têm e quando
//     morrem. Ele roda a IA e a física de todos os mobs (e dos projéteis).
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
//   atacar    : perto o bastante (`alcance`): bate a cada 1 s, se não tiver
//               parede no meio (linha de visão)
//   Preso numa parede alta, o monstro "dá a volta": anda de lado por 2 s (ou
//   mais, enquanto a parede continuar na frente) e, se não adiantar, tenta o
//   outro lado.
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
//   - As aranhas não pulam: sobem pela parede (`sobeParede`).
//   - A IA olha o chão à frente: não entra em água funda de propósito e não
//     pula de mais de 2 blocos passeando (3 perseguindo).
//   - Mob num chunk que o anfitrião não tem carregado some depois de 3 s
//     (senão ficaria congelado no ar).
//
// DIA E NOITE
//   Os animais nascem de dia sobre a grama; os monstros nascem no escuro
//   (luz < 0.35): de noite na superfície e, a qualquer hora, no fundo das
//   cavernas. Ao amanhecer, os monstros que estão sob o céu aberto pegam
//   fogo e somem em 3 s. Os mobs só nascem e andam onde o ANFITRIÃO tem o
//   mundo carregado (em volta dele, ~6 chunks).
//
// FASE 8: MONSTROS ESTILO RPG
//   esqueleto      : fica a 8–16 blocos e atira flechas (com gravidade leve);
//                    se você chega perto, ele recua
//   aranha_gigante : aranha grande que sobe parede e envenena (2 s); na
//                    superfície só nasce em florestas (nas cavernas, em qualquer lugar)
//   orc_guerreiro  : forte no corpo a corpo, dá uma investida curta; nasce em
//                    grupos de 2–3, às vezes com um xamã
//   orc_xama       : fica longe, joga um orbe roxo que persegue de leve e,
//                    de vez em quando, cura um orc ferido perto
//   dragao (chefão): voa em círculos sobre o ninho, mergulha para dar uma
//                    garrada, sopra fogo em cone (dano enquanto você estiver
//                    no cone) e às vezes pousa
//   hidra (chefão) : parada no covil, gira para os jogadores; 3 cabeças, cada
//                    uma no seu ritmo: bola de fogo, rajada de gelo (deixa
//                    lento) e nuvem de veneno (fica 4 s no chão). Vida única.
//
// PROJÉTEIS (Fase 8)
//   Simulados no anfitrião (movimento, gravidade, batida em bloco e em
//   jogador). A rede manda `projetilMob` quando sai e `projetilFim` quando
//   acaba; os clientes só desenham (malhas simples + partículas).
//   O sopro do dragão também é um "projétil" (um cone parado por ~2 s).
//
// CHEFÕES (Fase 8)
//   Aparecem quando alguém chega a menos de 40 blocos de um Ninho do Dragão
//   ou de um Covil da Hidra (world.js), no máximo uma vez por dia de jogo
//   (e não de novo enquanto estiver vivo). Na Lua Vermelha, 30% de chance de
//   um chefão surgir perto de um jogador; esse vai embora quando a lua acaba
//   (de manhã), assim que ninguém estiver a menos de 32 blocos dele (a hidra
//   não anda: ficaria para sempre do lado da casa). Não contam nos limites, não somem
//   por distância (só se todos ficarem a mais de 128 blocos por 30 s) e não
//   queimam no sol. A barra grande no topo (ui.mostrarBarraChefao) aparece
//   para quem está a até 64 blocos. XP do chefão: todos a até 64 blocos.
//
// DESEMPENHO
//   - Até 40 mobs e 64 projéteis. Nada de criar objetos a cada quadro: mobs,
//     modelos, projéteis e malhas são reaproveitados (pools), listas também.
//   - Mobs longe de todos os jogadores pensam menos vezes; os que estão
//     longe do seu jogador não são animados nem desenhados.
//
// GANCHOS
//   - registrarTipoMob(nome, def): tipos novos. A ordem de registro vira o
//     número do tipo na rede, então registre sempre na mesma ordem.
//   - registrarComportamento(nome, fn): IA nova (fn(mobs, mob, dt) escolhe
//     querX/querZ/querVel/querVy e yawAlvo).
//   - definirAtaqueDistancia(fn): gancho do comportamento 'monstro' (Fase 7).
//
// Exporta: Mobs, TIPOS_MOB, ORDEM_TIPOS, COMPORTAMENTOS, TIPOS_PROJETIL,
//          registrarTipoMob, registrarComportamento
// =====================================================================

import * as THREE from 'three';
import { CONFIG, CICLO_SEGUNDOS } from './config.js';
import { B, BLOCOS, SOLIDO, LIQUIDO } from './blocks.js';
import { ITENS, obterItem } from './items.js';
import { BIOMA } from './world.js';

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
const MAX_MONSTROS_LUA = 16;          // de noite, na Lua Vermelha
const MAX_MONSTROS_DIA = 4;           // de dia (só nas cavernas): assim sobra lugar para os da noite
const RAIO_CONTAGEM = 64;             // mobs até essa distância contam como "do jogador" nos limites
const DIST_GERAR_MIN = 24;            // os mobs nascem a 24-48 blocos dos jogadores
const DIST_GERAR_MAX = 48;
const DIST_SUMIR = 96;                // longe assim de todos os jogadores, o mob some
const INTERVALO_GERAR = 1;            // segundos entre as tentativas de gerar mobs
const TENTATIVAS_POR_JOGADOR = 6;     // lugares sorteados por jogador a cada tentativa
const GERADOS_POR_VEZ = 2;            // no máximo isso por jogador a cada segundo
const GERADOS_POR_VEZ_LUA = 3;        // na Lua Vermelha
const LUZ_MAX_MONSTRO = 0.35;         // monstros só nascem com menos luz que isso
const LUZ_DIA_ANIMAIS = 0.7;          // animais só nascem com a luz do dia acima disso
const PROFUNDIDADE_CAVERNA = 6;       // de dia, monstros só nascem pelo menos isso abaixo do topo da coluna
const LUZ_SOL_QUEIMA = 0.5;           // com a luz do dia acima disso, o sol queima os monstros
const TEMPO_SEM_CHUNK = 3;            // segundos num chunk não carregado até o mob sumir

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
const DANO_VENENO_POR_S = 1;          // efeito "veneno" (espada da hidra): 1 por segundo
const TEMPO_SOL = 3;                  // segundos queimando no sol até sumir
const TEMPO_FUGA = 4;                 // segundos que o animal foge depois de apanhar
const TEMPO_MORTE = 0.9;              // duração da animação de morte
const RECARGA_ATAQUE = 1;             // segundos entre os ataques de um monstro
const QUEDA_MAX_PASSEAR = 2;          // maior queda que o mob aceita passeando
const QUEDA_MAX_PERSEGUIR = 3;        // e perseguindo
const TEMPO_DESVIO = 2;               // preso numa parede alta: anda de lado por isso
const DIST_IA_PERTO = 32;             // até aqui a IA pensa a cada IA_PERTO segundos
const IA_PERTO = 0.1;
const IA_LONGE = 0.5;
const ENVIOS_POR_SEGUNDO = 10;        // estado dos mobs pela rede
const ATRASO_INTERP_MS = 100;         // o cliente desenha os mobs 100 ms "no passado"
const DIST_VISIVEL = (CONFIG.DISTANCIA_RENDER + 1) * CONFIG.TAMANHO_CHUNK; // além disso, nem desenha
const DIST_SOM = 24;                  // de longe assim não se ouve o mob
const DIST_SOM_CHEFAO = 56;           // os chefões se ouvem de mais longe
const INTERVALO_SOM_IDLE = 1.2;       // segundos entre dois barulhinhos (de qualquer mob)
const INTERVALO_SOM_DANO_PERIODICO = 3000; // ms: queimando/envenenado, no máximo 1 gemido a cada 3 s por mob
const MODELOS_NO_POOL = 12;           // modelos guardados para reaproveitar, por tipo
const RAIO_JOGADOR = (CONFIG.LARGURA_JOGADOR ?? 0.6) / 2;
const ALTURA_JOGADOR = CONFIG.ALTURA_JOGADOR ?? 1.8;
const ALTURA_OLHOS = CONFIG.ALTURA_OLHOS ?? 1.62;
const DIST_PARTICULA_OLHOS = 1.6;     // partículas de projétil mais perto que isso dos meus olhos não são criadas
const GRAVIDADE = CONFIG.GRAVIDADE;

// Chefões (Fase 8)
const DIST_CHEFAO_AREA = 40;          // chegar a menos disso de um ninho/covil acorda o chefão
const DIST_BARRA_CHEFAO = 64;         // a barra do chefão aparece para quem está até aqui
const DIST_XP_CHEFAO = 64;            // todos até aqui ganham o XP do chefão
const DIST_SUMIR_CHEFAO = 128;        // longe assim de todos por TEMPO_SUMIR_CHEFAO, o chefão vai embora
const TEMPO_SUMIR_CHEFAO = 30;
const CHANCE_CHEFAO_LUA = 0.3;        // chance de um chefão surgir numa noite de Lua Vermelha
const DIST_LUTA_CHEFAO = 32;          // o chefão da Lua Vermelha só vai embora (de manhã) sem ninguém até aqui
const RECUO_CHEFAO = 0.15;            // os chefões quase não são empurrados

// Rede
const CAMPOS_REDE = 8;                // números por mob na mensagem `mobs`
const MAX_MOBS_REDE = 64;
const HIST = 4;                       // posições guardadas por mob para interpolar (cliente)
const ID_MAX = 16777216;              // 2^24: o Float32 guarda inteiros até aqui sem erro

// Bits do campo `flags` (mensagem `mobs`). Os bits 8 a 11 são o contador de golpes.
const F_ANDANDO = 1, F_ATACANDO = 2, F_QUEIMANDO = 4, F_LENTO = 8, F_SUBINDO = 16, F_NO_AR = 32, F_NADANDO = 64;
// Fase 8: envenenado (bit 7), cabeças da hidra atacando (12 a 14), soprando fogo (15), pousado (16)
const F_ENVENENADO = 128;
const F_CABECA = [1 << 12, 1 << 13, 1 << 14];
const F_SOPRANDO = 1 << 15;
const F_POUSADO = 1 << 16;

const EPS = 0.001;
const EIXO_X = 1, EIXO_Y = 2, EIXO_Z = 3;
const CAIXA_CHEIA = [0, 0, 0, 1, 1, 1];
const ALTURA = CONFIG.ALTURA_MUNDO;
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
const EF_VENENO_MOB = {
  x: 0, y: 0, z: 0, qtd: 2, cores: ['#5dd23a', '#8ae05a', '#3fa82a'],
  velocidade: 0.4, vy: 0.6, espalhar: 0.5, gravidade: -0.6, vida: 0.6, tamanho: 0.12, aditivo: false,
};

// Efeitos das armas de chefão no golpe (Fase 8): 'fogo' queima 3 s, 'veneno' envenena 3 s
const EF_ARMA_FOGO = Object.freeze({ queimar: 3 });
const EF_ARMA_VENENO = Object.freeze({ veneno: 3 });

/** Efeito de um golpe: o texto da arma ('fogo' | 'veneno') ou { queimar?, lento?, veneno? } */
function efeitoDeArma(e) {
  if (e === 'fogo') return EF_ARMA_FOGO;
  if (e === 'veneno') return EF_ARMA_VENENO;
  if (e && typeof e === 'object' && (e.queimar > 0 || e.lento > 0 || e.veneno > 0)) return e;
  return null;
}

// Roupas que os orcs e os chefões soltam (sem a hacker). Refeita se a lista de itens mudar.
let roupasCache = null, tamanhoItensRoupas = -1;
function roupasSorteaveis() {
  if (roupasCache && tamanhoItensRoupas === ITENS.size) return roupasCache;
  roupasCache = [];
  for (const def of ITENS.values()) {
    if (def && def.tipo === 'roupa' && def.nome !== 'roupa_hacker') roupasCache.push(def.nome);
  }
  tamanhoItensRoupas = ITENS.size;
  return roupasCache;
}

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
 *  - comportamento: nome em COMPORTAMENTOS ('animal' | 'monstro' | 'atirador' | 'orc' | 'xama' | 'dragao' | 'hidra')
 *  - som: tipo para som.mob (padrão: o próprio nome)
 *  - nasce: 'grama' (animais, de dia) | 'escuro' (monstros) | null (só por criarMob)
 *  - peso: chance relativa de ser sorteado entre os que nascem no mesmo lugar
 *  - grupo: [min, max] quantos nascem juntos
 *  - queimaNoSol (padrão = hostil), planar (cai devagar), pulaNoAlvo (bote)
 *  - corReserva: cor da caixa se o modelo não existir
 *  - ataqueDistancia: { alcance, min, intervalo, dano, projetil, velocidade, mira }
 *  - alturaVoo, chefao
 *  - Fase 8: efeitoAtaque ({ efeito, segundos }: o golpe envenena...),
 *    chanceRoupa (0 a 1), roupaGarantida, biomaSuperficie ('floresta'),
 *    soNoite, acompanhante ({ tipo, chance }), familia ('orc'), giro (rad/s),
 *    somAtaque (toca som.mob(tipo, 'ataque') ao bater)
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
    ataqueDistancia: def.ataqueDistancia ?? null,
    alturaVoo: def.alturaVoo ?? 0,
    chefao: def.chefao ?? false,
    // Fase 8
    efeitoAtaque: def.efeitoAtaque ?? null,
    chanceRoupa: def.chanceRoupa ?? 0,
    roupaGarantida: def.roupaGarantida ?? false,
    biomaSuperficie: def.biomaSuperficie ?? null,
    soNoite: def.soNoite ?? false,
    acompanhante: def.acompanhante ?? null,
    familia: def.familia ?? null,
    giro: def.giro ?? VEL_GIRO,
    somAtaque: def.somAtaque ?? false,
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

// ----- Os monstros da Fase 8 (mesma ordem sempre: o índice vai pela rede) -----
registrarTipoMob('esqueleto', {
  nome: 'Esqueleto', vidaMax: 20, velocidade: 2.3, dano: 3, alcance: 0.9, visao: 20,
  altura: 1.9, raio: 0.3, hostil: true, xp: 8, nasce: 'escuro', peso: 2.2, corReserva: '#e6e2d4',
  comportamento: 'atirador',
  ataqueDistancia: { alcance: 16, min: 8, intervalo: 2, dano: 3, projetil: 'flecha', velocidade: 20, mira: 0.7 },
  drops: [{ item: 'osso', min: 1, max: 2, chance: 1 }, { item: 'flecha', min: 1, max: 2, chance: 0.4 }],
});
registrarTipoMob('aranha_gigante', {
  // A caixa de colisão é menor que o boneco (as pernas ficam de fora) para caber nas cavernas
  nome: 'Aranha gigante', vidaMax: 40, velocidade: 3.6, dano: 5, alcance: 0.9, visao: 18,
  altura: 1.3, raio: 0.95, hostil: true, sobeParede: true, pulaNoAlvo: true, xp: 15,
  nasce: 'escuro', peso: 0.7, biomaSuperficie: 'floresta', corReserva: '#2a2020', somAtaque: true,
  efeitoAtaque: { efeito: 'veneno', segundos: 2 },
  drops: [{ item: 'fio_seda', min: 2, max: 4, chance: 1 }, { item: 'seda_rara', min: 1, max: 1, chance: 0.1 }],
});
registrarTipoMob('orc_guerreiro', {
  nome: 'Orc guerreiro', vidaMax: 45, velocidade: 2.6, dano: 7, alcance: 1.0, visao: 20,
  altura: 2.0, raio: 0.4, hostil: true, xp: 20, nasce: 'escuro', peso: 0.9, grupo: [2, 3],
  soNoite: true, familia: 'orc', comportamento: 'orc', chanceRoupa: 0.03, somAtaque: true,
  acompanhante: { tipo: 'orc_xama', chance: 0.35 }, corReserva: '#4f7a2e',
  drops: [{ item: 'moeda', min: 2, max: 5, chance: 1 }, { item: 'couro_orc', min: 1, max: 1, chance: 0.7 }],
});
registrarTipoMob('orc_xama', {
  nome: 'Orc xamã', vidaMax: 30, velocidade: 2.2, dano: 5, alcance: 0.9, visao: 22,
  altura: 1.85, raio: 0.35, hostil: true, xp: 25, nasce: null, familia: 'orc', comportamento: 'xama',
  chanceRoupa: 0.03, corReserva: '#6a3a8a',
  ataqueDistancia: { alcance: 16, min: 7, intervalo: 3, dano: 5, projetil: 'orbe', velocidade: 7.5, mira: 0.6 },
  drops: [{ item: 'moeda', min: 3, max: 6, chance: 1 }, { item: 'cristal_roxo', min: 1, max: 1, chance: 0.15 }],
});
registrarTipoMob('dragao', {
  nome: 'Dragão Ancestral', vidaMax: 400, velocidade: 7.5, dano: 10, alcance: 1.6, visao: 56,
  altura: 2.6, raio: 1.6, hostil: true, voa: true, alturaVoo: 11, chefao: true, xp: 500,
  comportamento: 'dragao', giro: 2.6, queimaNoSol: false, roupaGarantida: true, corReserva: '#8a1a1a',
  drops: [
    { item: 'escama_dragao', min: 4, max: 8, chance: 1 },
    { item: 'ovo_dragao', min: 1, max: 1, chance: 1 },
    { item: 'espada_dragao', min: 1, max: 1, chance: 0.4 },
  ],
});
registrarTipoMob('hidra', {
  nome: 'Hidra de Três Cabeças', vidaMax: 500, velocidade: 0, dano: 6, alcance: 1, visao: 30,
  altura: 4.0, raio: 1.4, hostil: true, chefao: true, xp: 600, comportamento: 'hidra', giro: 1.6,
  queimaNoSol: false, roupaGarantida: true, corReserva: '#2f7a6c',
  drops: [
    { item: 'escama_hidra', min: 4, max: 8, chance: 1 },
    { item: 'espada_hidra', min: 1, max: 1, chance: 0.5 },
    { item: 'cristal_verde', min: 3, max: 3, chance: 1 },
  ],
});

// =====================================================================
// PROJÉTEIS DE MOB (Fase 8)
// =====================================================================
/**
 * TIPOS_PROJETIL[tipo]:
 *   grav (blocos/s²), raio (para acertar), vida (s), dano, efeito/segundos
 *   (no jogador acertado), guia (rad/s: persegue o jogador alvo), guiaMob
 *   (persegue um mob: a cura do xamã), explosao/danoExplosao (bola de fogo),
 *   nuvem (o veneno vira nuvem no chão), sopro (cone de fogo parado).
 */
export const TIPOS_PROJETIL = {
  flecha: { grav: 6, raio: 0.12, vida: 4, dano: 3, efeito: null, segundos: 0 },
  orbe: { grav: 0, raio: 0.35, vida: 5, dano: 5, efeito: null, segundos: 0, guia: 1.6 },
  bola_fogo: { grav: 1.5, raio: 0.45, vida: 4, dano: 6, efeito: 'fogo', segundos: 3, explosao: 2.2, danoExplosao: 3 },
  gelo: { grav: 0, raio: 0.3, vida: 2.5, dano: 2, efeito: 'lento', segundos: 4 },
  veneno: { grav: 12, raio: 0.4, vida: 4, dano: 3, efeito: 'veneno', segundos: 4, nuvem: true },
  cura: { grav: 0, raio: 0.3, vida: 3, dano: 0, efeito: null, segundos: 0, guiaMob: 7, cura: 12 },
  sopro: { grav: 0, raio: 0, vida: 2.2, dano: 2, efeito: 'fogo', segundos: 3, sopro: true },
};
const MAX_PROJETEIS = 64;
const MALHAS_NO_POOL = 24;            // malhas guardadas por tipo de projétil
const ALCANCE_SOPRO = 11;             // comprimento do cone de fogo
const COS_SOPRO = 0.92;               // abertura do cone (~23° para cada lado)
const INTERVALO_DANO_SOPRO = 0.5;     // dano do sopro a cada 0,5 s dentro do cone
const NUVEM_RAIO = 2.6;               // nuvem de veneno no chão
const NUVEM_TEMPO = 4;
const MAX_NUVENS = 12;
const CURA_XAMA = 12;                 // vida devolvida pela cura do xamã

// Partículas dos projéteis (reaproveitadas)
const EF_RASTRO = {
  orbe: { x: 0, y: 0, z: 0, qtd: 1, cores: ['#a040ff', '#c070ff', '#7a20e0'], velocidade: 0.3, espalhar: 0.15, gravidade: 0, vida: 0.45, tamanho: 0.14, aditivo: false },
  bola_fogo: { x: 0, y: 0, z: 0, qtd: 2, cores: ['#ff7a1a', '#ffb02a', '#e8401a'], velocidade: 0.6, espalhar: 0.3, gravidade: -1, vida: 0.4, tamanho: 0.18, aditivo: false },
  gelo: { x: 0, y: 0, z: 0, qtd: 1, cores: ['#ffffff', '#c8f4ff', '#8fe0ff'], velocidade: 0.3, espalhar: 0.15, gravidade: 1, vida: 0.5, tamanho: 0.1, aditivo: true },
  veneno: { x: 0, y: 0, z: 0, qtd: 1, cores: ['#5dd23a', '#8ae05a', '#3fa82a'], velocidade: 0.3, espalhar: 0.2, gravidade: 4, vida: 0.6, tamanho: 0.13, aditivo: false },
  cura: { x: 0, y: 0, z: 0, qtd: 1, cores: ['#9aff9a', '#e8ffe0', '#3fff7a'], velocidade: 0.3, espalhar: 0.15, gravidade: -0.5, vida: 0.5, tamanho: 0.12, aditivo: true },
};
const INTERVALO_RASTRO = { orbe: 0.04, bola_fogo: 0.03, gelo: 0.06, veneno: 0.05, cura: 0.04 };
const EF_IMPACTO = {
  flecha: { x: 0, y: 0, z: 0, qtd: 5, cores: ['#8a6a3a', '#b0a080', '#6a6a6a'], velocidade: 1.2, espalhar: 0.1, gravidade: 8, vida: 0.4, tamanho: 0.07, aditivo: false },
  orbe: { x: 0, y: 0, z: 0, qtd: 18, cores: ['#c070ff', '#e8b0ff', '#ffffff'], velocidade: 2.6, espalhar: 0.2, gravidade: 0, vida: 0.55, tamanho: 0.14, aditivo: true, arrasto: 2 },
  bola_fogo: { x: 0, y: 0, z: 0, qtd: 28, cores: ['#ff9a2a', '#ffd23f', '#ff5a1a', '#ffffff'], velocidade: 3.4, espalhar: 0.4, gravidade: -0.5, vida: 0.6, tamanho: 0.22, aditivo: true, arrasto: 2 },
  gelo: { x: 0, y: 0, z: 0, qtd: 14, cores: ['#ffffff', '#c8f4ff', '#8fe0ff'], velocidade: 2.2, espalhar: 0.2, gravidade: 3, vida: 0.6, tamanho: 0.1, aditivo: true },
  veneno: { x: 0, y: 0, z: 0, qtd: 16, cores: ['#5dd23a', '#8ae05a', '#3fa82a'], velocidade: 2, espalhar: 0.3, gravidade: 3, vida: 0.6, tamanho: 0.15, aditivo: false },
  cura: { x: 0, y: 0, z: 0, qtd: 20, cores: ['#9aff9a', '#e8ffe0', '#3fff7a'], velocidade: 1.4, vy: 1.2, espalhar: 0.8, gravidade: -0.5, vida: 0.9, tamanho: 0.14, aditivo: true },
};
const EF_FUMACA_FOGO = { x: 0, y: 0, z: 0, qtd: 6, cores: ['#5a5a5a', '#7a7a7a'], velocidade: 0.8, vy: 0.8, espalhar: 0.6, gravidade: -0.5, vida: 1.2, tamanho: 0.35, arrasto: 1 };
// O fogo do sopro tem duas partes: o "corpo" (cores normais, aparece bem até de
// dia, contra o céu claro) e o brilho (aditivo, que acende de noite)
const EF_SOPRO = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, qtd: 4, cores: ['#ff7a1a', '#ffb02a', '#e8401a', '#ffd23f'], velocidade: 2.6, espalhar: 0.35, gravidade: -1.5, vida: 0.75, tamanho: 0.34, aditivo: false, arrasto: 0.4 };
const EF_SOPRO_BRILHO = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, qtd: 2, cores: ['#ffd23f', '#ffe8a0', '#ff9a2a'], velocidade: 2, espalhar: 0.25, gravidade: -1.5, vida: 0.6, tamanho: 0.3, aditivo: true, arrasto: 0.4 };
const EF_NUVEM = { x: 0, y: 0, z: 0, qtd: 3, cores: ['#5dd23a', '#3fa82a', '#8ae05a', '#2f7a22'], velocidade: 0.3, vy: 0.35, espalhar: 0.4, gravidade: -0.3, vida: 1.3, tamanho: 0.5, aditivo: false, arrasto: 1 };

// Malhas dos projéteis: geometrias e materiais criados uma vez só
let RECURSOS_PROJ = null;
function recursosProjeteis() {
  if (RECURSOS_PROJ) return RECURSOS_PROJ;
  // A casca das bolas usa cor normal (aparece de dia, contra o céu claro); o
  // miolo é aditivo (brilha de noite)
  const brilho = (cor, opacidade = 1) => new THREE.MeshBasicMaterial({
    color: cor, transparent: true, opacity: opacidade, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const casca = (cor, opacidade = 0.9) => new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: opacidade });
  RECURSOS_PROJ = {
    caixa: new THREE.BoxGeometry(1, 1, 1),
    bola: new THREE.IcosahedronGeometry(1, 1),
    cristal: new THREE.OctahedronGeometry(1, 0),
    // A flecha tem um brilho próprio fraco (emissive): de noite, só com a luz
    // da lua, ela ficaria preta contra o céu e ninguém conseguiria desviar
    madeira: new THREE.MeshLambertMaterial({ color: 0xa07a44, emissive: 0x3a2a16 }),
    ponta: new THREE.MeshLambertMaterial({ color: 0xb0b0b8, emissive: 0x4a4a52 }),
    pena: new THREE.MeshLambertMaterial({ color: 0xf0f0f0, emissive: 0x8a8a8a }),
    orbe: casca(0x8a2ae0, 0.8), orbeNucleo: brilho(0xffe0ff),
    fogo: casca(0xff5a14, 0.92), fogoNucleo: brilho(0xffe27a),
    gelo: casca(0x8fe4ff, 0.9),
    veneno: new THREE.MeshBasicMaterial({ color: 0x4fc22a, transparent: true, opacity: 0.85 }),
    cura: brilho(0x7aff9a, 0.9),
  };
  return RECURSOS_PROJ;
}

/** Malha nova de um projétil (a frente é +Z: o lookAt aponta o +Z para onde ele vai) */
function criarMalhaProjetil(tipo) {
  const R = recursosProjeteis();
  const g = new THREE.Group();
  const peca = (geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (tipo) {
    case 'flecha':
      peca(R.caixa, R.madeira, 0.07, 0.07, 0.75);
      peca(R.caixa, R.ponta, 0.11, 0.11, 0.14, 0, 0, 0.42);
      peca(R.caixa, R.pena, 0.03, 0.18, 0.2, 0, 0, -0.32);
      peca(R.caixa, R.pena, 0.18, 0.03, 0.2, 0, 0, -0.32);
      break;
    case 'orbe':
      peca(R.bola, R.orbeNucleo, 0.16, 0.16, 0.16);
      peca(R.bola, R.orbe, 0.3, 0.3, 0.3);
      break;
    case 'bola_fogo':
      peca(R.bola, R.fogoNucleo, 0.26, 0.26, 0.26);
      peca(R.bola, R.fogo, 0.42, 0.42, 0.42);
      break;
    case 'gelo':
      peca(R.cristal, R.gelo, 0.12, 0.12, 0.38);
      break;
    case 'veneno':
      peca(R.bola, R.veneno, 0.3, 0.3, 0.3);
      break;
    case 'cura':
      peca(R.bola, R.cura, 0.17, 0.17, 0.17);
      break;
    default:
      break;
  }
  return g;
}

/**
 * Velocidade para um tiro com gravidade sair de (ox, oy, oz) e cair em
 * (tx, ty, tz) com a rapidez `v` (blocos/s). Usa o ângulo baixo (tiro
 * reto); se não der para alcançar, atira a 45°. Escreve em `saida`.
 */
function mirarBalistico(ox, oy, oz, tx, ty, tz, v, g, saida, alto = false) {
  const dx = tx - ox, dz = tz - oz, dy = ty - oy;
  const dh = Math.sqrt(dx * dx + dz * dz);
  const hx = dh > 0.001 ? dx / dh : 0, hz = dh > 0.001 ? dz / dh : 0;
  let ang;
  if (g <= 0.001) {
    ang = Math.atan2(dy, dh);
  } else {
    const v2 = v * v;
    const disc = v2 * v2 - g * (g * dh * dh + 2 * dy * v2);
    if (disc < 0 || dh < 0.001) ang = dh < 0.001 ? (dy >= 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI / 4;
    else ang = Math.atan((v2 + (alto ? 1 : -1) * Math.sqrt(disc)) / (g * dh));
  }
  const c = Math.cos(ang);
  saida.x = hx * c * v;
  saida.y = Math.sin(ang) * v;
  saida.z = hz * c * v;
  return saida;
}

// =====================================================================
// COMPORTAMENTOS (a "cabeça" de cada mob)
// Cada um recebe (mobs, m, dt) e escolhe para onde o mob quer ir:
//   m.querX, m.querZ (direção, comprimento 1), m.querVel (blocos/s),
//   m.querVy (só para quem voa) e m.yawAlvo (para onde olhar).
// =====================================================================

export const COMPORTAMENTOS = {};

/** Cadastra uma IA nova */
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
  const alvo = mobs._escolherAlvo(m, dt);
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

  // Ataque à distância pelo gancho da Fase 7 (se alguém registrou)
  if (def.ataqueDistancia && dist > alcance && dist <= def.ataqueDistancia.alcance) {
    if (mobs._ataqueDistancia(m, alvo, dist)) return;
  }

  // Perto: ataca (1 vez por segundo), mas só se não tiver parede no meio
  if (dist <= alcance && dy > -1.5 && dy < def.altura + 0.5) {
    if (m.recarga > 0) {
      m.estado = 'atacar';
      m.querVel = 0;
      return;
    }
    if (mobs._alcancaCorpoACorpo(m, p)) {
      m.estado = 'atacar';
      m.querVel = 0;
      m.nDesvios = 0;
      m.recarga = RECARGA_ATAQUE;
      m.tAtacando = 0.45;
      mobs._baterNoJogador(m, alvo);
      return;
    }
    // Parede no meio (ex.: o jogador em cima de uma plataforma): tenta dar a
    // volta e só confere de novo daqui a pouco
    m.recarga = 0.3;
    if (m.tDesvio <= 0) m.tPreso = Math.max(m.tPreso, 0.6);
  }

  // Persegue (desviando das paredes altas)
  m.estado = 'perseguir';
  if (!mobs._andarPara(m, dx, dz, def.velocidade, dt, QUEDA_MAX_PERSEGUIR)) return;
  // Bote da aranha: um pulo na direção do jogador
  if (def.pulaNoAlvo && m.noChao && dist > 1.6 && dist < 3.6 && m.recarga <= 0.2 && Math.random() < 0.25) {
    m.vy = 6.2;
    m.vx = dx * 6;
    m.vz = dz * 6;
    m.recarga = Math.max(m.recarga, 0.6);
  }
});

/**
 * Atirador (esqueleto; o xamã também usa): fica entre `min` e `alcance`
 * blocos do jogador, recua se ele chegar perto, anda de lado devagar e
 * atira quando enxerga o alvo (mira por um instante antes de soltar).
 */
registrarComportamento('atirador', (mobs, m, dt) => {
  const def = m.def;
  const at = def.ataqueDistancia;
  const alvo = mobs._escolherAlvo(m, dt);
  if (!alvo || !at) {
    m.tMira = 0;
    passear(mobs, m, dt, def.velocidade * 0.45);
    return;
  }
  const p = alvo.posicao;
  let dx = p.x - m.x, dz = p.z - m.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 0.001) { dx /= dist; dz /= dist; }
  m.yawAlvo = Math.atan2(-dx, -dz);

  // Mirando: fica parado (só gira) até soltar
  if (m.tMira > 0) {
    m.estado = 'atacar';
    m.querVel = 0;
    m.tMira -= dt;
    if (m.tMira <= 0) {
      mobs._atirar(m, alvo);
      m.recarga = at.intervalo * (0.85 + Math.random() * 0.4);
    }
    return;
  }
  if (dist < at.min) {
    // Perto demais: recua (de costas, olhando para o jogador)
    m.estado = 'fugir';
    if (!mobs._andarPara(m, -dx, -dz, def.velocidade, dt, QUEDA_MAX_PASSEAR)) {
      // sem para onde recuar: atira de perto mesmo
      if (m.recarga <= 0 && dist > 2) { m.tMira = at.mira * 0.6; m.tAtacando = at.mira; }
    }
    return;
  }
  if (dist > at.alcance) {
    m.estado = 'perseguir';
    mobs._andarPara(m, dx, dz, def.velocidade, dt, QUEDA_MAX_PERSEGUIR);
    return;
  }
  // Na distância boa: de vez em quando anda de lado devagar
  m.estado = 'mirar';
  m.tLado -= dt;
  if (m.tLado <= 0) {
    m.tLado = 1.5 + Math.random() * 2;
    const r = Math.random();
    m.ladoAtirador = r < 0.35 ? 1 : r < 0.7 ? -1 : 0;
  }
  if (m.ladoAtirador !== 0) {
    mobs._andarPara(m, -dz * m.ladoAtirador, dx * m.ladoAtirador, def.velocidade * 0.35, dt, QUEDA_MAX_PASSEAR);
  } else {
    m.querVel = 0;
  }
  if (m.recarga <= 0) {
    if (mobs._linhaDeVisao(m, p)) {
      m.tMira = at.mira;
      m.tAtacando = at.mira + 0.2; // puxando a corda / levantando o cajado
      m.querVel = 0;
    } else {
      // Não enxerga: chega mais perto e tenta de novo logo
      mobs._andarPara(m, dx, dz, def.velocidade, dt, QUEDA_MAX_PERSEGUIR);
      m.recarga = 0.4;
    }
  }
});

/** Orc guerreiro: monstro de corpo a corpo com uma investida curta */
registrarComportamento('orc', (mobs, m, dt) => {
  const def = m.def;
  m.recargaInvestida -= dt;
  if (m.tInvestida > 0) {
    m.tInvestida -= dt;
    m.estado = 'investida';
    m.querVel = def.velocidade * 3;
    const alvo = mobs._jogadorPorId(m.alvoId);
    if (alvo && alvo.posicao && !alvo.morto) {
      const p = alvo.posicao;
      const dx = p.x - m.x, dz = p.z - m.z, dy = p.y - m.y;
      const alc = def.alcance + def.raio + RAIO_JOGADOR + 0.4;
      if (dx * dx + dz * dz <= alc * alc && dy > -1.5 && dy < def.altura) {
        if (mobs._alcancaCorpoACorpo(m, p)) {
          mobs._baterNoJogador(m, alvo, def.dano + 2); // a investida dói um pouco mais
          m.tAtacando = 0.45;
          m.recarga = RECARGA_ATAQUE;
        }
        m.tInvestida = 0;
      }
    }
    if (m.bateuParede || m.tInvestida <= 0) {
      m.tInvestida = 0;
      m.querVel = 0;
    }
    return;
  }
  COMPORTAMENTOS.monstro(mobs, m, dt);
  if (m.estado !== 'perseguir' || m.recargaInvestida > 0 || !m.noChao) return;
  const alvo = mobs._jogadorPorId(m.alvoId);
  if (!alvo || !alvo.posicao) return;
  const p = alvo.posicao;
  const dx = p.x - m.x, dz = p.z - m.z, dy = p.y - m.y;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 3.5 || dist > 9 || dy > 1.5 || dy < -1.5) return;
  if (!mobs._linhaDeVisao(m, p)) { m.recargaInvestida = 1; return; }
  // Investida: corre reto (direção travada) por um instante, com um pulinho
  m.querX = dx / dist;
  m.querZ = dz / dist;
  m.tInvestida = 0.8;
  m.recargaInvestida = 5 + Math.random() * 3;
  m.tAtacando = 0.3;
  m.vy = 3.5;
  mobs._tocar(m, 'ataque');
});

/** Orc xamã: cura orcs feridos de vez em quando e, no resto do tempo, atira orbes */
registrarComportamento('xama', (mobs, m, dt) => {
  m.recargaCura -= dt;
  if (m.recargaCura <= 0 && m.tMira <= 0) {
    const ferido = mobs._orcFerido(m, 10);
    if (ferido) {
      mobs._lancarCura(m, ferido);
      m.recargaCura = 6 + Math.random() * 3;
      m.tAtacando = 0.7;
    } else {
      m.recargaCura = 1;
    }
  }
  COMPORTAMENTOS.atirador(mobs, m, dt);
});

/**
 * Dragão (chefão). Fases:
 *   circular  → voa em círculos sobre a casa (o ninho) ou em volta do alvo
 *   mergulho  → desce rápido no jogador e dá uma garrada
 *   subir     → volta para o alto depois do mergulho
 *   aproximar → para a ~9 blocos do jogador, um pouco acima
 *   sopro     → fica parado soprando fogo em cone (~2 s)
 *   descer / pousado / decolar → pousa às vezes, anda e dá garradas no chão
 */
registrarComportamento('dragao', (mobs, m, dt) => {
  const def = m.def;
  const alvo = mobs._alvoChefao(m, def.visao, dt);
  m.tFase += dt;
  m.tAtaqueEsp -= dt;
  m.tPousar -= dt;
  const p = alvo ? alvo.posicao : null;
  const virarPara = (x, z) => { m.yawAlvo = Math.atan2(-(x - m.x), -(z - m.z)); };
  const virarParaVoo = () => {
    if (m.vx * m.vx + m.vz * m.vz > 1) m.yawAlvo = Math.atan2(-m.vx, -m.vz);
  };
  const mudar = (fase) => { m.fase = fase; m.tFase = 0; };

  switch (m.fase) {
    case 'mergulho': {
      if (p && m.tFase < 1.2) { m.alvoX = p.x; m.alvoY = p.y + 1; m.alvoZ = p.z; } // persegue no começo, depois "trava"
      const d = mobs._voarPara(m, m.alvoX, m.alvoY, m.alvoZ, 15, false);
      m.querVy = Math.max(-12, Math.min(12, (m.alvoY - (m.y + def.altura * 0.4)) * 3));
      m.tAtacando = 0.3;
      virarParaVoo();
      if (!m.acertou && p && !alvo.morto) {
        const ex = p.x - m.x, ey = p.y + 1 - (m.y + def.altura * 0.4), ez = p.z - m.z;
        const r = def.raio + 1.6;
        if (ex * ex + ey * ey + ez * ez <= r * r) {
          mobs._baterNoJogador(m, alvo, def.dano); // garrada
          m.acertou = true;
          mudar('subir');
          return;
        }
      }
      if (d < 1.5 || m.tFase > 3.5 || m.noChao || m.bateuParede) mudar('subir');
      return;
    }
    case 'subir': {
      m.querVel = 8;
      m.querVy = 6;
      virarParaVoo();
      if (m.tFase > 1.6) {
        mudar('circular');
        m.tAtaqueEsp = 3 + Math.random() * 3;
      }
      return;
    }
    case 'aproximar': {
      if (!p || alvo.morto) { mudar('circular'); return; }
      let ux = m.x - p.x, uz = m.z - p.z;
      const du = Math.sqrt(ux * ux + uz * uz) || 1;
      ux /= du; uz /= du;
      const px = p.x + ux * 9, pz = p.z + uz * 9;
      const py = Math.max(p.y + 6, mobs._topo(px, pz) + 4);
      const d = mobs._voarPara(m, px, py, pz, 10, true);
      virarPara(p.x, p.z);
      if (d < 2.5 || m.tFase > 4) {
        mudar('sopro');
        mobs._iniciarSopro(m, alvo);
      }
      return;
    }
    case 'sopro': {
      m.querVel = 0;
      m.querVy = 0;
      if (p) virarPara(p.x, p.z);
      if (m.tFase > TIPOS_PROJETIL.sopro.vida || !m.soproId) {
        mobs._terminarSopro(m);
        mudar('subir');
      }
      return;
    }
    case 'descer': {
      // Pousa na casa (o ninho), se estiver perto; senão perto do jogador
      const dh = Math.hypot(m.pousoX - m.x, m.pousoZ - m.z);
      const yAlvo = dh > 2.5 ? m.pousoY + 4 : m.pousoY - 1;
      mobs._voarPara(m, m.pousoX, yAlvo, m.pousoZ, 8, true);
      if (dh <= 2.5) m.querVy = -4;
      virarParaVoo();
      if (m.noChao) { mudar('pousado'); m.tDuracao = 6 + Math.random() * 3; m.soprouNoChao = false; }
      else if (m.tFase > 9 || m.bateuParede) mudar('decolar');
      return;
    }
    case 'pousado': {
      m.querVy = -3; // fica no chão
      if (m.soproId) { m.querVel = 0; if (p) virarPara(p.x, p.z); return; }
      if (p && !alvo.morto) {
        let dx = p.x - m.x, dz = p.z - m.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.01) { dx /= dist; dz /= dist; }
        virarPara(p.x, p.z);
        const alc = def.alcance + def.raio + RAIO_JOGADOR + 0.6;
        if (dist <= alc) {
          m.querVel = 0;
          if (m.recarga <= 0 && mobs._alcancaCorpoACorpo(m, p)) {
            m.recarga = 1.6;
            m.tAtacando = 0.5;
            mobs._baterNoJogador(m, alvo, def.dano);
          }
        } else if (!m.soprouNoChao && dist < 12 && m.tFase > 1.5) {
          m.soprouNoChao = true;
          m.querVel = 0;
          mobs._iniciarSopro(m, alvo);
        } else {
          m.querX = dx; m.querZ = dz;
          m.querVel = 2.2;
        }
      } else {
        m.querVel = 0;
      }
      if (m.tFase > m.tDuracao) {
        mobs._terminarSopro(m);
        mudar('decolar');
      }
      return;
    }
    case 'decolar': {
      m.querVel = 3;
      m.querVy = 7;
      virarParaVoo();
      if (m.tFase > 1.8) {
        mudar('circular');
        m.tAtaqueEsp = 3 + Math.random() * 3;
        m.tPousar = 25 + Math.random() * 15;
      }
      return;
    }
    default: {
      // circular: em volta da casa ou, se o alvo estiver longe dela, em volta do alvo
      m.fase = 'circular';
      let cx = m.casaX, cz = m.casaZ;
      if (p && Math.hypot(p.x - m.casaX, p.z - m.casaZ) > 48) { cx = p.x; cz = p.z; }
      const R = 15, vel = def.velocidade;
      m.angCirculo += (vel / R) * dt;
      const px = cx + Math.cos(m.angCirculo) * R, pz = cz + Math.sin(m.angCirculo) * R;
      const py = Math.max(m.casaY + def.alturaVoo, p ? p.y + 10 : 0, mobs._topo(px, pz) + 7, mobs._topo(m.x, m.z) + 5);
      mobs._voarPara(m, px, py, pz, vel, false);
      if (m.bateuParede) m.querVy = 6;
      virarParaVoo();
      if (p && !alvo.morto && m.tAtaqueEsp <= 0) {
        const r = Math.random();
        if (r < 0.45) {
          m.alvoX = p.x; m.alvoY = p.y + 1; m.alvoZ = p.z;
          m.acertou = false;
          mudar('mergulho');
          mobs._tocar(m, 'idle'); // rugido antes de mergulhar
        } else if (r < 0.85 || m.tPousar > 0) {
          mudar('aproximar');
        } else {
          // Pouso: no ninho, se estiver perto; senão perto do jogador
          const pertoDaCasa = Math.hypot(m.x - m.casaX, m.z - m.casaZ) < 40;
          m.pousoX = pertoDaCasa ? m.casaX : p.x + (m.x > p.x ? 5 : -5);
          m.pousoZ = pertoDaCasa ? m.casaZ : p.z + (m.z > p.z ? 5 : -5);
          m.pousoY = mobs._topo(m.pousoX, m.pousoZ);
          mudar('descer');
        }
      }
    }
  }
});

/** Hidra (chefão): parada, gira para o jogador; cada cabeça ataca no seu ritmo */
const RITMO_CABECA = [3.0, 4.2, 5.6];      // fogo, gelo, veneno (segundos entre ataques)
const ALCANCE_CABECA = [28, 22, 20];
registrarComportamento('hidra', (mobs, m, dt) => {
  m.querVel = 0;
  const alvo = mobs._alvoChefao(m, m.def.visao, dt);
  const tc = m.tCab;
  for (let k = 0; k < 3; k++) if (tc[k] > 0) tc[k] -= dt;
  if (!alvo || alvo.morto) return;
  const p = alvo.posicao;
  const dx = p.x - m.x, dz = p.z - m.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  m.yawAlvo = Math.atan2(-dx, -dz);
  // Só ataca quando já está mais ou menos virada para o alvo (até ~60°)
  let dif = m.yawAlvo - m.yaw;
  dif = Math.atan2(Math.sin(dif), Math.cos(dif));
  if (Math.abs(dif) > 1.05) return;
  for (let k = 0; k < 3; k++) {
    if (tc[k] > 0) continue;
    if (dist > ALCANCE_CABECA[k]) { tc[k] = 0.5; continue; }
    mobs._ataqueCabeca(m, k, alvo);
    tc[k] = RITMO_CABECA[k] * (0.8 + Math.random() * 0.4);
    m.tCabAnim[k] = 1.0;
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
      // Tipo sem modelo: usa a caixa
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
   *   obterJogadores() → [{ id, posicao, local, defesa, morto }]: todos os
   *   jogadores (o seu tem `local: true` e fica na lista mesmo morto). Os
   *   objetos podem ser reaproveitados.
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
    this._fnAtaqueDistancia = null;   // gancho da Fase 7

    // Coisas reaproveitadas (nada de objetos novos no loop)
    this._alvos = [];
    this._resultadoRaio = { id: 0, t: 0 };
    this._posMob = { x: 0, y: 0, z: 0, raio: 0 };
    this._origemVisao = { x: 0, y: 0, z: 0 };
    this._dirVisao = { x: 0, y: 0, z: 0 };
    this._dirPoder = { x: 0, y: 0, z: 0 };
    this._vTiro = { x: 0, y: 0, z: 0 };
    this._bufRede = new Float32Array(MAX_MOBS_REDE * CAMPOS_REDE);
    this._jogadores = VAZIO;
    this._local = null;               // o meu jogador ({ posicao }) neste quadro
    this._contAnimais = 0;
    this._contMonstros = 0;
    this._naSuperficie = false;       // o último lugar escuro achado era na superfície?

    // Relógios
    this._tGerar = 0;
    this._tEnvio = 0;
    this._offset = null;              // (cliente) relógio local − relógio do anfitrião, em ms
    this._enviouVazio = false;
    this._esperaSomIdle = 0;
    this._tAsas = 0;

    // Listas de sorteio (refeitas quando um tipo novo é registrado)
    this._versaoTipos = -1;
    this._tiposGrama = [];
    this._tiposEscuro = [];           // de noite (todos os que nascem no escuro)
    this._tiposEscuroDia = [];        // de dia, nas cavernas (sem os que só saem à noite)

    // Projéteis e nuvens de veneno (Fase 8)
    this._proj = [];                  // projéteis voando
    this._projPorId = new Map();
    this._projLivres = [];
    this._proximoIdProj = 1;
    this._malhasProj = new Map();     // tipo → [malhas guardadas]
    this._nuvens = [];
    for (let i = 0; i < MAX_NUVENS; i++) this._nuvens.push({ ativa: false, x: 0, y: 0, z: 0, t: 0, tDano: 0, tParticula: 0 });

    // Chefões (Fase 8)
    this._dia = 0;                    // dias de jogo desde que o mundo abriu (o chefão volta 1 vez por dia)
    this._horaAnt = null;
    this._chefePorArea = new Map();   // "tipo:x,z" → id do chefão vivo
    this._diaChefao = new Map();      // "tipo:x,z" → dia em que o chefão apareceu
    this._areasTmp = [];
    this._luaAntes = false;
    this._chefaoLuaTentativas = 0;
    this._tBarra = 0;
    this._barraNome = null;           // o que a barra do chefão está mostrando
    this._barraFrac = -1;
    this._chefaoPerto = { tipo: '', nome: '', frac: 0, dist: 0 };
    this._temChefaoPerto = false;

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
   * O chefão vivo mais perto do meu jogador (até 64 blocos):
   * { tipo, nome, frac, dist } (objeto reaproveitado) ou null.
   * O main usa para tocar a música de chefão.
   */
  get chefaoPerto() {
    return this._temChefaoPerto ? this._chefaoPerto : null;
  }

  /**
   * Registra quem recebe o dano dos mobs no MEU jogador: fn({ qtd, de, efeito }).
   * `de` = [x, y, z] do mob; `qtd` vem sem o desconto da armadura.
   * `efeito` (Fase 8) = null, 'veneno' | 'lento' | 'fogo' (duração padrão) ou
   * { tipo, segundos }. Devolve uma função que cancela o registro.
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
   * Gancho do ataque à distância do comportamento 'monstro' (Fase 7).
   * fn({ mobs, mob, alvo, dist }) → true se cuidou do mob neste instante.
   * (Os monstros da Fase 8 usam os comportamentos próprios.)
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
    // Jogadores deste quadro (a lista do main é reaproveitada). O meu fica
    // na lista mesmo morto: a distância (sons, desenho) usa a posição dele.
    const jog = this.obterJogadores ? this.obterJogadores() : null;
    this._jogadores = Array.isArray(jog) ? jog : VAZIO;
    this._local = null;
    for (let i = 0; i < this._jogadores.length; i++) {
      const j = this._jogadores[i];
      if (j && j.local && j.posicao) { this._local = j; break; }
    }
    this._atualizarDia();

    if (this.autoridade) {
      this._tGerar += dt;
      if (this._tGerar >= INTERVALO_GERAR) {
        this._tGerar = 0;
        this._sumirLonge();
        this._gerarPerto();
        this._verificarChefoes();
      }
      for (let i = 0; i < this.lista.length; i++) this._simular(this.lista[i], dt);
      this._enviarEstado();
    } else {
      this._interpolarTodos();
    }

    // Projéteis e nuvens (o anfitrião simula; o cliente só desenha)
    this._atualizarProjeteis(dt);
    this._atualizarNuvens(dt);

    // Desenho e limpeza (de trás para frente: dá para tirar da lista no caminho)
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const m = this.lista[i];
      this._visual(m, dt);
      if (m.descartar || (m.morrendo && m.tMorte >= 1)) this._descartar(i);
    }

    // Barra do chefão (4 vezes por segundo)
    this._tBarra -= dt;
    if (this._tBarra <= 0) {
      this._tBarra = 0.25;
      this._atualizarBarraChefao();
    }
  }

  /** Conta os dias de jogo: a hora "deu a volta" (passou da noite para a manhã) */
  _atualizarDia() {
    if (!this.ceu) return;
    const h = this.ceu.hora;
    if (this._horaAnt !== null && h + CICLO_SEGUNDOS / 2 < this._horaAnt) this._dia++;
    this._horaAnt = h;
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
      alvoId: null, fugirX: 0, fugirZ: 0, tVisao: 0, tDesvio: 0, desvioLado: 1, proxLado: 1, tPreso: 0,
      tDesvioTotal: 0, nDesvios: 0, eixoParede: 0, eixoDesvio: 0,
      noChao: false, naAgua: false, bateuParede: false, tSubindo: 0, tAtacando: 0,
      recarga: 0, queimar: 0, tQueimar: 0, queimadoPor: null, lento: 0, sol: 0, tSol: 0,
      veneno: 0, tVeneno: 0, envenenadoPor: null, tSemChunk: 0,
      golpes: 0, flags: 0, vidaFrac: 1,
      acumIA: 0, dtIA: 0, distJogador: 0,
      // Fase 8: atirador, orc, xamã, dragão e hidra
      tMira: 0, tLado: 0, ladoAtirador: 0, tInvestida: 0, recargaInvestida: 0, recargaCura: 0,
      fase: 'circular', tFase: 0, tAtaqueEsp: 0, tPousar: 0, tDuracao: 0, angCirculo: 0,
      casaX: 0, casaY: 0, casaZ: 0, areaChave: null, tLonge: 0, daLua: false,
      alvoX: 0, alvoY: 0, alvoZ: 0, acertou: false, pousoX: 0, pousoY: 0, pousoZ: 0, soprouNoChao: false,
      soproId: 0, tCab: new Float32Array(3), tCabAnim: new Float32Array(3),
      // desenho
      modelo: null, tLuz: 0, tSom: 0, tSomDano: -Infinity, tFogo: 0, tNeve: 0, tVen: 0,
      inclinacao: 0, velAnim: 0, xAnt: 0, zAnt: 0, distLocal: 0,
      anim: { atacando: false, voando: false, nadando: false, pousado: false, boca: 0, cabecaAtacando: [false, false, false] },
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
    m.tDesvio = 0; m.desvioLado = 1; m.proxLado = Math.random() < 0.5 ? 1 : -1; m.tPreso = 0;
    m.tDesvioTotal = 0; m.nDesvios = 0; m.eixoParede = 0; m.eixoDesvio = 0;
    m.noChao = false; m.naAgua = false; m.bateuParede = false; m.tSubindo = 0; m.tAtacando = 0;
    m.recarga = 0; m.queimar = 0; m.tQueimar = 0; m.queimadoPor = null; m.lento = 0; m.sol = 0;
    m.veneno = 0; m.tVeneno = 0; m.envenenadoPor = null; m.tSemChunk = 0;
    m.tSol = Math.random() * 0.5;
    m.golpes = 0; m.flags = 0;
    m.acumIA = Math.random() * IA_PERTO; m.dtIA = 0; m.distJogador = 0; // espalha a IA entre os quadros
    // Fase 8
    m.tMira = 0; m.tLado = 0; m.ladoAtirador = 0; m.tInvestida = 0;
    m.recargaInvestida = 2 + Math.random() * 3; m.recargaCura = 2 + Math.random() * 3;
    m.fase = 'circular'; m.tFase = 0; m.tAtaqueEsp = 4 + Math.random() * 3; m.tPousar = 20 + Math.random() * 10;
    m.tDuracao = 0; m.angCirculo = Math.random() * Math.PI * 2;
    m.casaX = x; m.casaY = this._topo(x, z); m.casaZ = z; m.areaChave = null; m.tLonge = 0; m.daLua = false;
    m.alvoX = x; m.alvoY = y; m.alvoZ = z; m.acertou = false;
    m.pousoX = x; m.pousoY = y; m.pousoZ = z; m.soprouNoChao = false; m.soproId = 0;
    m.tCab[0] = 1.2; m.tCab[1] = 2.4; m.tCab[2] = 3.6;
    m.tCabAnim.fill(0);
    // desenho
    m.tLuz = 0; m.tSom = 3 + Math.random() * 10; m.tSomDano = -Infinity; m.tFogo = 0; m.tNeve = 0; m.tVen = 0;
    m.inclinacao = 0; m.velAnim = 0; m.xAnt = x; m.zAnt = z;
    const an = m.anim;
    an.atacando = false; an.voando = false; an.nadando = false; an.pousado = false; an.boca = 0;
    an.cabecaAtacando[0] = an.cabecaAtacando[1] = an.cabecaAtacando[2] = false;
    m.nHist = 0; m.histProvisorio = false; m.golpesVistos = -1; m.piscouLocal = -Infinity;
    m.alvo.id = id;
    m.alvo.raio = Math.max(def.raio, def.altura * 0.45);
    m.modelo = this._pegarModelo(tipo);
    m.modelo.grupo.position.set(x, y, z);
    m.modelo.grupo.rotation.set(0, yaw, 0);
    this.lista.push(m);
    this.porId.set(id, m);
    if (def.chefao) this._avisar(def.nome + ' apareceu!');
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
      EF_POF.espalhar = Math.max(0.6, m.def.raio * 1.5);
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
   * testes, comandos e eventos (os chefões). Devolve o id ou null.
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

  /** (Testes) O objeto interno do mob `id`, ou null */
  obterMob(id) {
    return this.porId.get(id) || null;
  }

  /**
   * Remove o mob. morreu = true: toca a animação de morte (tomba, fica
   * vermelho e some); false: some na hora. O anfitrião avisa os clientes.
   */
  _removerMob(m, morreu) {
    if (m.descartar || m.morrendo) return;
    if (m.soproId) this._terminarSopro(m);
    // Chefão que foi embora (sem morrer): pode voltar quando alguém chegar perto de novo
    if (m.def.chefao && m.areaChave) {
      if (this._chefePorArea.get(m.areaChave) === m.id) this._chefePorArea.delete(m.areaChave);
      if (!morreu) this._diaChefao.delete(m.areaChave);
    }
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

  /** Remove todos os mobs e projéteis (ex.: trocar de mundo). O anfitrião avisa os clientes. */
  limpar() {
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const m = this.lista[i];
      if (this.autoridade && !m.descartar && !m.morrendo && this.rede && typeof this.rede.enviarMobRemovido === 'function') {
        this.rede.enviarMobRemovido(m.id, false);
      }
      this._descartar(i);
    }
    for (let i = this._proj.length - 1; i >= 0; i--) {
      const p = this._proj[i];
      if (this.autoridade && this.rede && typeof this.rede.enviarProjetilFim === 'function') {
        this.rede.enviarProjetilFim(p.id, [p.x, p.y, p.z]);
      }
      this._descartarProjetil(i);
    }
    for (const n of this._nuvens) n.ativa = false;
    this._chefePorArea.clear();
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
    this._tiposEscuroDia.length = 0;
    for (const nome of ORDEM_TIPOS) {
      const d = TIPOS_MOB[nome];
      if (d.nasce === 'grama') this._tiposGrama.push(d);
      else if (d.nasce === 'escuro') {
        this._tiposEscuro.push(d);
        if (!d.soNoite) this._tiposEscuroDia.push(d);
      }
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
    const lua = noite && this.ceu && !!this.ceu.luaVermelha;
    const luzDia = this.ceu ? this.ceu.luzDoDia : 1;
    const diaClaro = !noite && luzDia > LUZ_DIA_ANIMAIS;
    const listaEscuro = noite ? this._tiposEscuro : this._tiposEscuroDia;
    const maxMonstros = noite ? (lua ? MAX_MONSTROS_LUA : MAX_MONSTROS_POR_JOGADOR) : MAX_MONSTROS_DIA;
    const porVez = lua ? GERADOS_POR_VEZ_LUA : GERADOS_POR_VEZ;

    for (let k = 0; k < jog.length; k++) {
      const p = jog[k].posicao;
      if (!p || jog[k].morto) continue; // perto de quem está morto não nasce nada
      this._contarPerto(p);
      let gerados = 0;
      for (let t = 0; t < TENTATIVAS_POR_JOGADOR && gerados < porVez; t++) {
        if (this.lista.length >= MAX_MOBS) return;
        const querAnimal = diaClaro && this._contAnimais < MAX_ANIMAIS_POR_JOGADOR && this._tiposGrama.length > 0;
        const querMonstro = this._contMonstros < maxMonstros && listaEscuro.length > 0;
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
          const def = this._sortearTipo(listaEscuro);
          const y = this._acharLugarEscuro(def, x, z, p.y, noite);
          if (y < 0) continue;
          // A aranha gigante, na superfície, só nasce em florestas
          if (def.biomaSuperficie && this._naSuperficie && !this._biomaCombina(def, x, z)) continue;
          const n = this._gerarGrupoMonstros(def, x, y, z);
          this._contMonstros += n;
          if (n > 0) gerados++;
        }
      }
    }
  }

  /** O bioma de (x, z) é o que o tipo pede na superfície? */
  _biomaCombina(def, x, z) {
    if (typeof this.mundo.biomaEm !== 'function') return true;
    const b = this.mundo.biomaEm(x, z);
    if (def.biomaSuperficie === 'floresta') return b === BIOMA.FLORESTA;
    if (def.biomaSuperficie === 'deserto') return b === BIOMA.DESERTO;
    if (def.biomaSuperficie === 'planicie') return b === BIOMA.PLANICIE;
    return true;
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
   * Monstros: 1 ou um grupo (orcs: 2 a 3, às vezes com um xamã junto),
   * todos perto de (x, y, z). Devolve quantos nasceram.
   */
  _gerarGrupoMonstros(def, x, y, z) {
    const g = def.grupo;
    const n = g[0] + Math.floor(Math.random() * (g[1] - g[0] + 1));
    if (this.criarMob(def.tipo, x + 0.5, y, z + 0.5) === null) return 0;
    let feitos = 1;
    for (let i = 0; i < n * 3 && feitos < n && this.lista.length < MAX_MOBS; i++) {
      const xx = x + Math.floor(Math.random() * 7) - 3;
      const zz = z + Math.floor(Math.random() * 7) - 3;
      const yy = this._acharChaoPerto(def, xx, y, zz);
      if (yy < 0) continue;
      if (this.criarMob(def.tipo, xx + 0.5, yy, zz + 0.5) !== null) feitos++;
    }
    const ac = def.acompanhante;
    if (ac && TIPOS_MOB[ac.tipo] && Math.random() < ac.chance && this.lista.length < MAX_MOBS) {
      const dAc = TIPOS_MOB[ac.tipo];
      for (let i = 0; i < 8; i++) {
        const xx = x + Math.floor(Math.random() * 9) - 4;
        const zz = z + Math.floor(Math.random() * 9) - 4;
        const yy = this._acharChaoPerto(dAc, xx, y, zz);
        if (yy < 0) continue;
        if (this.criarMob(dAc.tipo, xx + 0.5, yy, zz + 0.5) !== null) { feitos++; break; }
      }
    }
    return feitos;
  }

  /** Chão firme com espaço livre perto da altura y (de y-2 a y+2), ou -1 */
  _acharChaoPerto(def, x, y, z) {
    if (!this.mundo.estaPronto(x, z)) return -1;
    for (let k = 0; k <= 4; k++) {
      const yy = y + (k & 1 ? (k + 1) >> 1 : -(k >> 1));
      if (yy < 1 || yy >= ALTURA - 2) continue;
      if (!SOLIDO[this.mundo.obterBloco(x, yy - 1, z)]) continue;
      if (this._cabe(def, x + 0.5, yy, z + 0.5)) return yy;
    }
    return -1;
  }

  /**
   * y do primeiro bloco acima do bloco mais alto que "tapa" a coluna (x, z),
   * ou seja, onde começa o céu aberto. Usa o mundo.topoColuna (Fase 8);
   * sem ele, procura de cima para baixo.
   */
  _topoColuna(x, z) {
    if (typeof this.mundo.topoColuna === 'function') return this.mundo.topoColuna(x, z);
    for (let y = ALTURA - 1; y >= 0; y--) {
      const id = this.mundo.obterBloco(x, y, z);
      if (id !== B.AR && !LIQUIDO[id]) return y + 1;
    }
    return 0;
  }

  /** O mesmo, para contas com números quebrados (voo do dragão) */
  _topo(x, z) {
    return this._topoColuna(Math.floor(x), Math.floor(z));
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
   * Deixa em this._naSuperficie se o lugar achado é na superfície.
   */
  _acharLugarEscuro(def, x, z, yJogador, noite) {
    const mundo = this.mundo;
    const topo = this._topoColuna(x, z);
    let y = -1;
    this._naSuperficie = false;
    if (noite && Math.random() < 0.6) {
      // Superfície
      if (topo >= 1 && topo < ALTURA - 2 && SOLIDO[mundo.obterBloco(x, topo - 1, z)]) y = topo;
      this._naSuperficie = true;
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
      if (y >= topo) this._naSuperficie = true;
    }
    if (y < 1) return -1;
    if (typeof mundo.luzEm === 'function' && mundo.luzEm(x, y, z) >= LUZ_MAX_MONSTRO) return -1;
    return this._cabe(def, x + 0.5, y, z + 0.5) ? y : -1;
  }

  /**
   * Mobs longe de todos os jogadores (ou caídos no abismo) somem. Os jogadores
   * mortos também contam como "perto" (continuam na lista do main). Os
   * chefões só vão embora se ficarem 30 s a mais de 128 blocos de todos.
   */
  _sumirLonge() {
    const jog = this._jogadores;
    for (let i = 0; i < this.lista.length; i++) {
      const m = this.lista[i];
      if (m.morrendo || m.descartar) continue;
      if (m.y < -20) { this._removerMob(m, false); continue; }
      if (jog.length === 0) continue; // sem lista de jogadores (início): não decide nada
      const lim = m.def.chefao ? DIST_SUMIR_CHEFAO : DIST_SUMIR;
      const d2max = lim * lim;
      let perto = false;
      for (let k = 0; k < jog.length; k++) {
        const p = jog[k].posicao;
        if (!p) continue;
        const dx = p.x - m.x, dz = p.z - m.z;
        if (dx * dx + dz * dz <= d2max) { perto = true; break; }
      }
      if (m.def.chefao) {
        m.tLonge = perto ? 0 : m.tLonge + INTERVALO_GERAR;
        if (m.tLonge > TEMPO_SUMIR_CHEFAO) this._removerMob(m, false);
      } else if (!perto) {
        this._removerMob(m, false);
      }
    }
  }

  // ------------------------------------------------------------------
  // Chefões (anfitrião)
  // ------------------------------------------------------------------

  /**
   * (A cada 1 s) Alguém chegou a menos de 40 blocos de um ninho ou covil?
   * Acorda o chefão de lá (1 vez por dia de jogo, e nunca 2 ao mesmo tempo).
   * Na Lua Vermelha, 30% de chance de um chefão surgir perto de alguém.
   */
  _verificarChefoes() {
    const jog = this._jogadores;
    if (typeof this.mundo.areasEspeciais === 'function') {
      for (let k = 0; k < jog.length; k++) {
        const j = jog[k];
        if (!j || !j.posicao || j.morto) continue;
        const areas = this.mundo.areasEspeciais(j.posicao, DIST_CHEFAO_AREA, this._areasTmp);
        for (let i = 0; i < areas.length; i++) {
          const a = areas[i];
          const dx = a.x - j.posicao.x, dy = a.y - j.posicao.y, dz = a.z - j.posicao.z;
          if (dx * dx + dy * dy + dz * dz > DIST_CHEFAO_AREA * DIST_CHEFAO_AREA) continue;
          const chave = a.tipo + ':' + a.x + ',' + a.z;
          const vivo = this.porId.get(this._chefePorArea.get(chave));
          if (vivo && !vivo.morrendo && !vivo.descartar) continue;
          if (this._diaChefao.get(chave) === this._dia) continue;
          if (!this.mundo.estaPronto(a.x, a.z)) continue;
          const tipo = a.tipo === 'ninho' ? 'dragao' : 'hidra';
          const id = this.criarMob(tipo, a.x, tipo === 'dragao' ? a.y + 10 : a.y, a.z);
          if (!id) continue;
          const m = this.porId.get(id);
          m.casaX = a.x; m.casaY = a.y; m.casaZ = a.z;
          m.areaChave = chave;
          this._chefePorArea.set(chave, id);
          this._diaChefao.set(chave, this._dia);
        }
      }
    }
    // Lua Vermelha: sorteia no começo da noite vermelha; tenta por alguns segundos
    const lua = !!(this.ceu && this.ceu.luaVermelha && this.ceu.ehNoite);
    if (lua && !this._luaAntes && Math.random() < CHANCE_CHEFAO_LUA) this._chefaoLuaTentativas = 15;
    this._luaAntes = lua;
    if (this._chefaoLuaTentativas > 0) {
      this._chefaoLuaTentativas--;
      if (!lua || this._criarChefaoPerto(Math.random() < 0.5 ? 'dragao' : 'hidra')) this._chefaoLuaTentativas = 0;
    }
    // Acabou a Lua Vermelha: o chefão que veio com ela vai embora (senão a
    // hidra, que não anda, ficaria para sempre do lado da casa). Se alguém
    // estiver lutando com ele (até 32 blocos), espera a luta acabar.
    if (!lua) {
      for (let i = 0; i < this.lista.length; i++) {
        const m = this.lista[i];
        if (!m.daLua || m.morrendo || m.descartar || this._jogadorVivoPerto(m.x, m.z, DIST_LUTA_CHEFAO)) continue;
        this._removerMob(m, false);
        this._avisar(m.def.nome + ' foi embora com a Lua Vermelha.');
      }
    }
  }

  /** Algum jogador vivo a menos de `dist` blocos (na horizontal) de (x, z)? */
  _jogadorVivoPerto(x, z, dist) {
    const d2 = dist * dist;
    const jog = this._jogadores;
    for (let i = 0; i < jog.length; i++) {
      const j = jog[i];
      if (!j || !j.posicao || j.morto) continue;
      const dx = j.posicao.x - x, dz = j.posicao.z - z;
      if (dx * dx + dz * dz < d2) return true;
    }
    return false;
  }

  /** (Lua Vermelha) Cria um chefão perto de um jogador vivo sorteado. Devolve o id ou null. */
  _criarChefaoPerto(tipo) {
    const jog = this._jogadores;
    if (jog.length === 0) return null;
    const j = jog[Math.floor(Math.random() * jog.length)];
    if (!j || !j.posicao || j.morto) return null;
    const p = j.posicao;
    const def = TIPOS_MOB[tipo];
    for (let t = 0; t < 8; t++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = tipo === 'dragao' ? 28 : 18 + Math.random() * 8;
      const x = Math.floor(p.x + Math.sin(ang) * dist), z = Math.floor(p.z + Math.cos(ang) * dist);
      if (!this.mundo.estaPronto(x, z)) continue;
      const topo = this._topoColuna(x, z);
      let y;
      if (tipo === 'dragao') {
        y = Math.max(topo, p.y) + 14;
      } else {
        y = topo;
        if (!SOLIDO[this.mundo.obterBloco(x, y - 1, z)] || !this._cabe(def, x + 0.5, y, z + 0.5)) continue;
      }
      const id = this.criarMob(tipo, x + 0.5, y, z + 0.5);
      if (id) {
        const m = this.porId.get(id);
        m.casaX = x + 0.5; m.casaY = topo; m.casaZ = z + 0.5;
        m.daLua = true; // vai embora quando a Lua Vermelha acabar
      }
      return id;
    }
    return null;
  }

  /** Aviso na tela e no chat deste computador */
  _avisar(texto) {
    if (this.rede && typeof this.rede.avisoLocal === 'function') this.rede.avisoLocal(texto);
    else if (this.ui && typeof this.ui.mostrarMensagem === 'function') this.ui.mostrarMensagem(texto);
  }

  /** Barra do chefão: o chefão vivo mais perto do meu jogador (até 64 blocos) */
  _atualizarBarraChefao() {
    const loc = this._local;
    let melhor = null, melhorD = DIST_BARRA_CHEFAO * DIST_BARRA_CHEFAO;
    if (loc) {
      for (let i = 0; i < this.lista.length; i++) {
        const m = this.lista[i];
        if (!m.def.chefao || m.descartar) continue;
        const dx = m.x - loc.posicao.x, dy = m.y - loc.posicao.y, dz = m.z - loc.posicao.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < melhorD) { melhorD = d2; melhor = m; }
      }
    }
    this._temChefaoPerto = !!melhor && !melhor.morrendo;
    if (melhor) {
      const cp = this._chefaoPerto;
      cp.tipo = melhor.tipo; cp.nome = melhor.def.nome; cp.frac = melhor.morrendo ? 0 : melhor.vidaFrac; cp.dist = Math.sqrt(melhorD);
    }
    const ui = this.ui;
    if (!ui || typeof ui.mostrarBarraChefao !== 'function') return;
    if (melhor) {
      const nome = melhor.def.nome;
      const frac = melhor.morrendo ? 0 : melhor.vidaFrac;
      if (nome !== this._barraNome || Math.abs(frac - this._barraFrac) > 0.002) {
        this._barraNome = nome;
        this._barraFrac = frac;
        ui.mostrarBarraChefao(nome, frac);
      }
    } else if (this._barraNome !== null) {
      this._barraNome = null;
      this._barraFrac = -1;
      ui.mostrarBarraChefao(null, null);
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
    for (let k = 0; k < 3; k++) if (m.tCabAnim[k] > 0) m.tCabAnim[k] -= dt;

    // Fogo (poder de fogo, espada do dragão): 1 de dano por segundo enquanto durar
    if (m.queimar > 0 && !m.morrendo) {
      m.queimar -= dt;
      m.tQueimar += dt;
      if (m.tQueimar >= 1) {
        m.tQueimar -= 1;
        this._aplicarDano(m, DANO_QUEIMAR_POR_S, null, m.queimadoPor, 'tick', null);
      }
      if (m.queimar <= 0) { m.queimar = 0; m.tQueimar = 0; }
    }
    // Veneno (espada da hidra): 1 de dano por segundo enquanto durar
    if (m.veneno > 0 && !m.morrendo) {
      m.veneno -= dt;
      m.tVeneno += dt;
      if (m.tVeneno >= 1) {
        m.tVeneno -= 1;
        this._aplicarDano(m, DANO_VENENO_POR_S, null, m.envenenadoPor, 'tick', null);
      }
      if (m.veneno <= 0) { m.veneno = 0; m.tVeneno = 0; }
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
      // IA: pensa a cada IA_PERTO s (ou IA_LONGE s, se todos estão longe; os chefões sempre rápido)
      m.dtIA += dt;
      m.acumIA -= dt;
      if (m.acumIA <= 0 && !m.morrendo) {
        m.distJogador = this._distJogadorMaisPerto(m);
        m.acumIA = def.chefao || m.distJogador < DIST_IA_PERTO ? IA_PERTO : IA_LONGE;
        const fn = COMPORTAMENTOS[def.comportamento] || COMPORTAMENTOS.animal;
        fn(this, m, m.dtIA);
        m.dtIA = 0;
      }
    }

    // Física, só onde o mundo existe (chunk carregado e com malha). Num chunk
    // que o anfitrião não tem, o mob ficaria congelado: some depois de 3 s.
    if (this.mundo.estaPronto(m.x, m.z)) {
      this._fisica(m, dt);
      m.tSemChunk = 0;
    } else if (!m.morrendo) {
      m.tSemChunk += dt;
      if (m.tSemChunk > TEMPO_SEM_CHUNK) this._removerMob(m, false);
    }

    // Flags para o desenho e para a rede
    let f = 0;
    if (m.vx * m.vx + m.vz * m.vz > 0.04) f |= F_ANDANDO;
    if (m.tAtacando > 0) f |= F_ATACANDO;
    if (m.queimar > 0 || m.sol > 0) f |= F_QUEIMANDO;
    if (m.lento > 0) f |= F_LENTO;
    if (m.tSubindo > 0) f |= F_SUBINDO;
    if (!m.noChao && !m.naAgua && m.tSubindo <= 0) f |= F_NO_AR;
    if (m.naAgua) f |= F_NADANDO;
    if (m.veneno > 0) f |= F_ENVENENADO;
    for (let k = 0; k < 3; k++) if (m.tCabAnim[k] > 0) f |= F_CABECA[k];
    if (m.soproId) f |= F_SOPRANDO;
    if (m.fase === 'pousado' && def.comportamento === 'dragao') f |= F_POUSADO;
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

  /** O jogador `j` serve de alvo para o monstro `m`? (vivo, perto, sem estar voando alto) */
  _alvoValido(m, j, maxDist) {
    const p = j && j.posicao;
    if (!p || j.morto) return false;
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

  /** Alvo do monstro: o mesmo enquanto ele valer; senão procura outro (2 vezes por segundo) */
  _escolherAlvo(m, dt) {
    let alvo = this._jogadorPorId(m.alvoId);
    if (alvo && !this._alvoValido(m, alvo, m.def.visao * 1.5)) alvo = null;
    m.tVisao -= dt;
    if (!alvo && m.tVisao <= 0) {
      m.tVisao = 0.5;
      alvo = this._procurarAlvo(m);
    }
    m.alvoId = alvo ? alvo.id : null;
    return alvo;
  }

  /**
   * Alvo de um chefão: o jogador vivo mais perto até `raio` blocos (na
   * horizontal; ele enxerga longe e ataca até quem está voando). Fica com o
   * mesmo enquanto ele estiver no alcance.
   */
  _alvoChefao(m, raio, dt) {
    let alvo = this._jogadorPorId(m.alvoId);
    const r2 = raio * raio * 1.7;
    if (alvo && (alvo.morto || !alvo.posicao ||
        (alvo.posicao.x - m.x) ** 2 + (alvo.posicao.z - m.z) ** 2 > r2)) alvo = null;
    m.tVisao -= dt;
    if (!alvo && m.tVisao <= 0) {
      m.tVisao = 0.5;
      let melhorD = raio * raio;
      const jog = this._jogadores;
      for (let i = 0; i < jog.length; i++) {
        const j = jog[i];
        if (!j.posicao || j.morto) continue;
        const dx = j.posicao.x - m.x, dy = j.posicao.y - m.y, dz = j.posicao.z - m.z;
        const d = dx * dx + dz * dz;
        if (d < melhorD && dy > -40 && dy < 40) { melhorD = d; alvo = j; }
      }
    }
    m.alvoId = alvo ? alvo.id : null;
    return alvo;
  }

  /** Nenhum bloco entre os olhos do mob e o ponto (px, py + altura, pz) do jogador? */
  _linhaDeVisao(m, p, altura = 1.5) {
    if (typeof this.mundo.raycast !== 'function') return true;
    const o = this._origemVisao, d = this._dirVisao;
    o.x = m.x; o.y = m.y + m.def.altura * 0.85; o.z = m.z;
    d.x = p.x - o.x; d.y = p.y + altura - o.y; d.z = p.z - o.z;
    const dist = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (dist < 1) return true;
    const r = this.mundo.raycast(o, d, dist);
    return !r || r.t >= dist - 0.6;
  }

  /**
   * Dá para bater no jogador agora, sem parede no meio? Confere a linha de
   * visão até a cabeça e até a cintura (basta uma estar livre).
   */
  _alcancaCorpoACorpo(m, p) {
    return this._linhaDeVisao(m, p, 1.5) || this._linhaDeVisao(m, p, 0.6);
  }

  /** Gancho da Fase 7: ataque à distância. Sem gancho registrado, o mob só se aproxima. */
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

  /**
   * Anda na direção (dx, dz) (comprimento 1) com a velocidade `vel`. Preso numa
   * parede alta, "dá a volta": anda de lado por TEMPO_DESVIO s e continua de
   * lado (até 6 s) enquanto ainda houver parede alta na direção do alvo. Se o
   * lado escolhido também estiver fechado, troca de lado (e lembra o lado que
   * funcionou); depois de 3 tentativas sem sair do lugar, tenta o outro lado.
   * Devolve false se parou na beira de um buraco fundo (ou água funda).
   */
  _andarPara(m, dx, dz, vel, dt, quedaMax = QUEDA_MAX_PERSEGUIR) {
    let qx = dx, qz = dz;
    if (m.tPreso > 0.5 && m.tDesvio <= 0) {
      // Começa a dar a volta. O lado é o mesmo da última vez (se deu certo);
      // depois de 3 tentativas sem chegar, tenta o outro.
      m.nDesvios++;
      if (m.nDesvios > 3) { m.proxLado = -m.proxLado; m.nDesvios = 1; }
      m.tDesvio = TEMPO_DESVIO;
      m.tDesvioTotal = 0;
      m.desvioLado = m.proxLado;
      m.eixoDesvio = m.eixoParede || (Math.abs(dx) > Math.abs(dz) ? EIXO_X : EIXO_Z);
      m.tPreso = 0;
    }
    if (m.tDesvio > 0) {
      m.tDesvio -= dt;
      m.tDesvioTotal += dt;
      // Anda reto ao longo da parede (as paredes de blocos são sempre retas em X ou em Z)
      const emX = m.eixoDesvio === EIXO_Z; // a parede barrou o Z: anda em X
      // Acabou o tempo, mas a parede continua na frente: mais um pouco de lado (até 6 s)
      if (m.tDesvio <= 0 && m.tDesvioTotal < 6 &&
          this._paredeAlta(m, emX ? 0 : Math.sign(dx), emX ? Math.sign(dz) : 0)) m.tDesvio = 0.5;
      qx = emX ? m.desvioLado : 0;
      qz = emX ? 0 : m.desvioLado;
      if (m.tPreso > 0.35) { // este lado também está fechado: o outro
        m.desvioLado = -m.desvioLado;
        m.proxLado = m.desvioLado;
        m.tPreso = 0;
      }
    }
    if (!this._caminhoLivre(m, qx, qz, quedaMax)) {
      if (m.tDesvio > 0) m.desvioLado = -m.desvioLado; // buraco do lado: tenta o outro
      m.querVel = 0;
      return false;
    }
    m.querX = qx; m.querZ = qz;
    m.querVel = vel;
    return true;
  }

  /** Tem parede de 2 blocos (alta demais para pular) logo à frente, na direção (dx, dz)? */
  _paredeAlta(m, dx, dz) {
    const alc = m.def.raio + 0.6;
    const ax = Math.floor(m.x + dx * alc), az = Math.floor(m.z + dz * alc);
    const y0 = Math.floor(m.y + 0.01);
    const mundo = this.mundo;
    return SOLIDO[mundo.obterBloco(ax, y0 + 1, az)] === 1 &&
      (SOLIDO[mundo.obterBloco(ax, y0, az)] === 1 || SOLIDO[mundo.obterBloco(ax, y0 + 2, az)] === 1);
  }

  /** Velocidade vertical para quem voa chegar na altura `y` */
  _vyParaAltura(m, y) {
    const d = y - m.y;
    return Math.max(-4, Math.min(4, d * 1.5));
  }

  /**
   * Voo até (x, y, z) com até `vel` blocos/s. Com `frear`, desacelera ao
   * chegar perto. Devolve a distância que falta.
   */
  _voarPara(m, x, y, z, vel, frear) {
    const dx = x - m.x, dy = y - m.y, dz = z - m.z;
    const dh = Math.sqrt(dx * dx + dz * dz);
    if (dh > 0.01) { m.querX = dx / dh; m.querZ = dz / dh; }
    m.querVel = frear ? Math.min(vel, dh * 1.5) : vel;
    m.querVy = Math.max(-vel * 0.6, Math.min(vel * 0.6, dy * 1.5));
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
    if (m.bateuParede && querAndar && !def.voa) {
      if (def.sobeParede) {
        m.tSubindo = 0.25;
      } else if ((m.noChao || m.naAgua) && this._degrauLivre(m)) {
        m.vy = m.naAgua ? 5.5 : VEL_PULO_MOB;
        m.noChao = false;
      } else if (m.vx * m.vx + m.vz * m.vz < m.querVel * m.querVel * 0.12) {
        // Só conta como "preso" se quase não andou (escorregar ao longo da parede não é estar preso)
        m.tPreso += dt;
      }
    } else if (m.tPreso > 0) {
      m.tPreso = Math.max(0, m.tPreso - dt * 0.5);
    }

    // Vira devagar para onde quer olhar (os chefões, bem mais devagar)
    let d = m.yawAlvo - m.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const passo = def.giro * dt;
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
    let eixo = 0; // em que eixo bateu na parede neste quadro (para "dar a volta" ao longo dela)
    const dx = m.vx * dt, dz = m.vz * dt, dy = m.vy * dt;
    if (dx !== 0) {
      const nx = m.x + dx;
      if (!this._colide(r, h, nx, m.y, m.z)) m.x = nx;
      else {
        const f = this._bloqueio(r, h, nx, m.y, m.z, EIXO_X, dx > 0 ? 1 : -1);
        if (f === f) m.x = f; // (f === f é false só para NaN)
        m.vx = 0;
        m.bateuParede = true;
        eixo = EIXO_X;
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
        if (!eixo || Math.abs(m.querZ) > Math.abs(m.querX)) eixo = EIXO_Z;
      }
    }
    if (eixo) m.eixoParede = eixo;
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

  /** O monstro `m` bateu no jogador `j` (com o efeito do tipo, se tiver: a aranha gigante envenena) */
  _baterNoJogador(m, j, qtd = m.def.dano) {
    if (!(qtd > 0)) return;
    const ef = m.def.efeitoAtaque;
    this._danoEmJogador(j, qtd, m.x, m.y, m.z, ef ? ef.efeito : null, ef ? ef.segundos : 0);
    if (m.def.somAtaque) this._tocar(m, 'ataque');
  }

  /**
   * Dano num jogador vindo de (dx, dy, dz) (o empurrão é para longe desse
   * ponto). O meu: chama os ouvintes; o de outro: manda `dano` pela rede.
   * efeito = 'veneno' | 'lento' | 'fogo' | null e segundos (0 = padrão).
   */
  _danoEmJogador(j, qtd, dx, dy, dz, efeito = null, segundos = 0) {
    if (!j || j.morto || !(qtd > 0)) return;
    const de = [dx, dy, dz];
    if (j.local) {
      this._emitirDano({ qtd, de, efeito: efeito ? (segundos > 0 ? { tipo: efeito, segundos } : efeito) : null });
    } else if (this.rede && typeof this.rede.enviarDanoJogador === 'function') {
      this.rede.enviarDanoJogador(j.id, qtd, de, efeito, segundos);
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
   * 'fogo' | 'raio' | 'gelo' | 'tick' (queimadura/veneno a cada segundo),
   * `efeito` = { queimar?, lento?, veneno? } ou null.
   */
  _aplicarDano(m, qtd, dir, quem, tipo, efeito) {
    if (m.morrendo || m.descartar || !(qtd > 0)) return false;
    const def = m.def;
    m.vida -= qtd;
    m.golpes = (m.golpes + 1) & 15;
    m.vidaFrac = Math.max(0, m.vida / def.vidaMax);
    // No golpe final toca só o som de morte; o dano periódico tem o som limitado
    this._mostrarDano(m, m.vidaFrac, m.vida > 0, tipo === 'tick');

    // Recuo: empurrão para longe de quem bateu (os chefões quase não se mexem)
    let nx = 0, nz = 0;
    if (dir) {
      const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
      if (len > 0.001) { nx = dir.x / len; nz = dir.z / len; }
    }
    if (nx !== 0 || nz !== 0) { // (o fogo queimando por dentro não tem direção: sem empurrão)
      const f = def.chefao ? RECUO_CHEFAO : 1;
      m.vx = nx * RECUO_GOLPE * f;
      m.vz = nz * RECUO_GOLPE * f;
      if ((m.noChao || m.naAgua) && !def.chefao) m.vy = RECUO_CIMA;
    }

    // Efeitos dos poderes e das armas de chefão
    if (efeito) {
      if (efeito.queimar > 0) {
        m.queimar = Math.max(m.queimar, Math.min(10, efeito.queimar));
        m.queimadoPor = quem;
      }
      if (efeito.lento > 0) m.lento = Math.max(m.lento, Math.min(10, efeito.lento));
      if (efeito.veneno > 0) {
        m.veneno = Math.max(m.veneno, Math.min(10, efeito.veneno));
        m.envenenadoPor = quem;
      }
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
    } else if (quem && tipo !== 'tick') {
      const j = this._jogadorPorId(quem);
      if (j && !j.morto) m.alvoId = quem;
    }

    if (m.vida <= 0) {
      m.vida = 0;
      this._matar(m, quem);
    }
    return true;
  }

  /** Morreu: animação, drops no chão e XP para quem matou (chefão: todos perto) */
  _matar(m, quem) {
    const def = m.def;
    this._removerMob(m, true);
    this._soltarDrops(m);
    if (!(def.xp > 0)) return;
    if (def.chefao) {
      // Chefão: todo mundo que ajudou (até 64 blocos) ganha o XP inteiro
      const jog = this._jogadores;
      const d2 = DIST_XP_CHEFAO * DIST_XP_CHEFAO;
      for (let i = 0; i < jog.length; i++) {
        const j = jog[i];
        if (!j.posicao) continue;
        const dx = j.posicao.x - m.x, dz = j.posicao.z - m.z;
        if (dx * dx + dz * dz > d2 && j.id !== quem) continue;
        this._darXp(j.id, j.local, def.xp);
      }
      return;
    }
    if (!quem) return;
    this._darXp(quem, quem === this._idLocal(), def.xp);
  }

  _darXp(id, local, qtd) {
    if (local) this._emitirXp(qtd);
    else if (this.rede && typeof this.rede.enviarXp === 'function') this.rede.enviarXp(id, qtd);
  }

  /** Sorteia os drops do tipo e põe no chão (pelo mesmo caminho dos itens soltos) */
  _soltarDrops(m) {
    const def = m.def;
    const drops = def.drops;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d || !obterItem(d.item) || Math.random() >= (d.chance ?? 1)) continue;
      const min = d.min ?? 1, max = d.max ?? min;
      this._soltarItem(m, d.item, min + Math.floor(Math.random() * (max - min + 1)));
    }
    // Roupas (Fase 10): os orcs às vezes (3%), os chefões sempre (sem a hacker)
    if (def.roupaGarantida || (def.chanceRoupa > 0 && Math.random() < def.chanceRoupa)) {
      const roupas = roupasSorteaveis();
      if (roupas.length > 0) this._soltarItem(m, roupas[Math.floor(Math.random() * roupas.length)], 1);
    }
  }

  _soltarItem(m, item, qtd) {
    if (!(qtd > 0)) return;
    const vx = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2, vy = 3;
    const y = m.y + Math.min(0.6, m.def.altura * 0.5);
    if (this.rede && typeof this.rede.soltarDrop === 'function') {
      this.rede.soltarDrop(item, qtd, m.x, y, m.z, vx, vy, vz);
    } else if (this.itensChao) {
      this.itensChao.criar(this.itensChao.novoId(), item, qtd, m.x, y, m.z, vx, vy, vz, false);
    }
  }

  /**
   * Pisca, mostra a barra de vida (se souber a vida) e toca o som de dano.
   * `periodico` (queimando/envenenado): no máximo 1 som a cada 3 s por mob, e
   * só se o limite geral de sons deixar.
   */
  _mostrarDano(m, frac, comSom, periodico = false) {
    const mod = m.modelo;
    if (mod) {
      mod.piscarDano();
      if (frac !== null) mod.definirVida(frac);
    }
    if (!comSom) return;
    if (periodico) {
      const agora = performance.now();
      if (agora - m.tSomDano < INTERVALO_SOM_DANO_PERIODICO || this._esperaSomIdle > 0) return;
      m.tSomDano = agora;
      this._esperaSomIdle = Math.max(this._esperaSomIdle, 0.4);
    }
    this._tocar(m, 'dano');
  }

  /**
   * Bater num mob (o jogador local, com a mão ou a espada). `dir` pode ser um
   * Vector3 reaproveitado: só os números são usados. `efeito` (Fase 8) =
   * efeitoArma do item ('fogo' queima 3 s, 'veneno' envenena 3 s) ou null.
   * Anfitrião/sozinho: aplica na hora. Cliente: pisca e toca o som já (para
   * não parecer atrasado) e pede ao anfitrião, que confere e aplica.
   */
  atacar(id, dano, dir, efeito = null) {
    const m = this.porId.get(id);
    if (!m || m.morrendo || m.descartar || !(dano > 0)) return false;
    const ef = efeitoDeArma(efeito);
    if (this.autoridade) return this._aplicarDano(m, dano, dir, this._idLocal(), 'golpe', ef);
    m.piscouLocal = performance.now();
    this._mostrarDano(m, null, true);
    if (this.rede && typeof this.rede.enviarAtacarMob === 'function') {
      this.rede.enviarAtacarMob(id, dano, dir, 'golpe', ef);
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
    const ef = efeitoDeArma(efeito);
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
    return this._aplicarDano(m, dano, dir, quem, ataque, efeitoDeArma(efeito));
  }

  /**
   * (Anfitrião) Centro do corpo do mob `id` e o raio dele (objeto
   * reaproveitado: { x, y, z, raio }), ou null se não existe/está morrendo.
   */
  posicaoMob(id) {
    const m = this.porId.get(id);
    if (!m || m.morrendo || m.descartar) return null;
    const p = this._posMob;
    p.x = m.x; p.y = m.y + m.def.altura * 0.5; p.z = m.z;
    p.raio = m.def.raio;
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
  // Ataques especiais da Fase 8 (anfitrião)
  // ------------------------------------------------------------------

  /** Atirador: solta o projétil do tipo (flecha ou orbe) mirando no peito do jogador */
  _atirar(m, alvo) {
    const at = m.def.ataqueDistancia;
    const p = alvo && alvo.posicao;
    if (!at || !p || alvo.morto) return;
    const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
    const ox = m.x + fx * (m.def.raio + 0.25), oy = m.y + m.def.altura * 0.78, oz = m.z + fz * (m.def.raio + 0.25);
    const tipo = at.projetil;
    const def = TIPOS_PROJETIL[tipo];
    if (!def) return;
    const v = mirarBalistico(ox, oy, oz, p.x, p.y + 1.1, p.z, at.velocidade, def.grav, this._vTiro);
    // Um pouco de erro (para dar para desviar e não ser injusto)
    const erro = tipo === 'flecha' ? 0.035 : 0.02;
    v.x += (Math.random() - 0.5) * 2 * erro * at.velocidade;
    v.y += (Math.random() - 0.5) * 2 * erro * at.velocidade;
    v.z += (Math.random() - 0.5) * 2 * erro * at.velocidade;
    this._lancarProjetil(tipo, m, ox, oy, oz, v.x, v.y, v.z, at.dano, def.guia ? alvo.id : null, 0);
    this._tocarEspecial(m, tipo === 'flecha' ? 'flecha' : 'magia');
  }

  /** Orc ferido (vida < 75%) mais machucado perto do xamã `m` (ele mesmo não conta) */
  _orcFerido(m, raio) {
    let melhor = null, menor = 0.75;
    const r2 = raio * raio;
    for (let i = 0; i < this.lista.length; i++) {
      const o = this.lista[i];
      if (o === m || o.morrendo || o.descartar || o.def.familia !== 'orc') continue;
      const frac = o.vida / o.def.vidaMax;
      if (frac >= menor) continue;
      const dx = o.x - m.x, dz = o.z - m.z;
      if (dx * dx + dz * dz > r2) continue;
      menor = frac;
      melhor = o;
    }
    return melhor;
  }

  /** Xamã: lança a "cura" (bolinha verde que voa até o orc e devolve vida) */
  _lancarCura(m, orc) {
    const ox = m.x, oy = m.y + m.def.altura + 0.2, oz = m.z;
    const dx = orc.x - ox, dy = orc.y + orc.def.altura * 0.5 - oy, dz = orc.z - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const v = TIPOS_PROJETIL.cura.guiaMob + 4;
    this._lancarProjetil('cura', m, ox, oy, oz, dx / d * v, dy / d * v + 2, dz / d * v, 0, null, orc.id);
    this._tocarEspecial(m, 'magia');
  }

  /**
   * Hidra: a cabeça k ataca (0 = bola de fogo, 1 = rajada de gelo com 3
   * pedaços, 2 = bola de veneno jogada em arco, que vira nuvem no chão).
   */
  _ataqueCabeca(m, k, alvo) {
    const p = alvo.posicao;
    // Posição da boca da cabeça k (modelo olhando para -Z: cabeças em x = -0.65, 0, 0.65)
    const lx = (k - 1) * 0.65, ly = 3.6, lz = -2.6;
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
    const ox = m.x + lx * c + lz * s, oy = m.y + ly, oz = m.z - lx * s + lz * c;
    const v = this._vTiro;
    if (k === 0) {
      const def = TIPOS_PROJETIL.bola_fogo;
      mirarBalistico(ox, oy, oz, p.x, p.y + 1, p.z, 13, def.grav, v);
      this._lancarProjetil('bola_fogo', m, ox, oy, oz, v.x, v.y, v.z, def.dano, null, 0);
    } else if (k === 1) {
      const def = TIPOS_PROJETIL.gelo;
      mirarBalistico(ox, oy, oz, p.x, p.y + 1, p.z, 18, 0, v);
      const vx = v.x, vy = v.y, vz = v.z;
      for (let i = -1; i <= 1; i++) {
        // gira a mira um pouquinho para os lados (leque de 3 pedaços)
        const a = i * 0.08, ca = Math.cos(a), sa = Math.sin(a);
        this._lancarProjetil('gelo', m, ox, oy, oz, vx * ca + vz * sa, vy, -vx * sa + vz * ca, def.dano, null, 0);
      }
    } else {
      const def = TIPOS_PROJETIL.veneno;
      mirarBalistico(ox, oy, oz, p.x, p.y, p.z, 14, def.grav, v);
      this._lancarProjetil('veneno', m, ox, oy, oz, v.x, v.y, v.z, def.dano, null, 0);
    }
    if (Math.random() < 0.5) this._tocar(m, 'ataque');
  }

  /** Dragão: começa a soprar fogo em cone na direção do jogador */
  _iniciarSopro(m, alvo) {
    if (m.soproId) return;
    const p = alvo && alvo.posicao;
    const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
    const ox = m.x + fx * 3.4, oy = m.y + m.def.altura * 0.62, oz = m.z + fz * 3.4;
    let dx = fx, dy = -0.25, dz = fz;
    if (p) { dx = p.x - ox; dy = p.y + 1 - oy; dz = p.z - oz; }
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const pr = this._lancarProjetil('sopro', m, ox, oy, oz, dx / d, dy / d, dz / d, TIPOS_PROJETIL.sopro.dano, null, 0);
    if (pr) m.soproId = pr.id;
    this._tocar(m, 'ataque'); // "fuuu" do sopro
  }

  /** Dragão: para de soprar (fim do tempo, morte ou mudança de fase) */
  _terminarSopro(m) {
    if (!m.soproId) return;
    const p = this._projPorId.get(m.soproId);
    m.soproId = 0;
    if (p && p.ativo && this.autoridade) this._fimProjetil(p, p.x, p.y, p.z, null);
  }

  // ------------------------------------------------------------------
  // Projéteis (anfitrião simula; cliente desenha)
  // ------------------------------------------------------------------

  /** Objeto de projétil do pool, já na lista. Devolve null se estiver cheio. */
  _novoProjetil(id, tipo, x, y, z, vx, vy, vz) {
    const def = TIPOS_PROJETIL[tipo];
    if (!def || this._proj.length >= MAX_PROJETEIS) return null;
    const p = this._projLivres.pop() || {
      id: 0, tipo: '', def: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0,
      dono: 0, alvo: null, alvoMob: 0, dano: 0, malha: null, tRastro: 0, tDano: 0, ativo: false, parado: false,
    };
    p.id = id; p.tipo = tipo; p.def = def;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.t = 0; p.dono = 0; p.alvo = null; p.alvoMob = 0; p.dano = def.dano;
    p.tRastro = 0; p.tDano = 0; p.ativo = true; p.parado = false;
    p.malha = def.sopro ? null : this._pegarMalha(tipo);
    if (p.malha) this._posicionarMalha(p);
    this._proj.push(p);
    this._projPorId.set(id, p);
    return p;
  }

  /** (Anfitrião) Lança um projétil e avisa os clientes. Devolve o projétil ou null. */
  _lancarProjetil(tipo, dono, x, y, z, vx, vy, vz, dano, alvoJogador, alvoMob) {
    if (!this.autoridade) return null;
    let id = 0;
    for (let k = 0; k < 64 && !id; k++) {
      const c = this._proximoIdProj;
      this._proximoIdProj = c + 1 >= ID_MAX ? 1 : c + 1;
      if (!this._projPorId.has(c)) id = c;
    }
    if (!id) return null;
    const p = this._novoProjetil(id, tipo, x, y, z, vx, vy, vz);
    if (!p) return null;
    p.dono = dono ? dono.id : 0;
    p.alvo = alvoJogador || null;
    p.alvoMob = alvoMob || 0;
    if (dano > 0) p.dano = dano;
    if (this.rede && this.rede.temClientes && typeof this.rede.enviarProjetilMob === 'function') {
      this.rede.enviarProjetilMob(id, tipo, [x, y, z], [vx, vy, vz],
        p.alvo || p.alvoMob ? { alvo: p.alvo, alvoMob: p.alvoMob } : null);
    }
    return p;
  }

  /** (Cliente) O anfitrião avisou que um mob atirou: só desenha */
  receberProjetil(id, tipo, origem, dir, alvo = null, alvoMob = 0) {
    if (this.autoridade || !TIPOS_PROJETIL[tipo] || this._projPorId.has(id)) return;
    const p = this._novoProjetil(id, tipo, origem[0], origem[1], origem[2], dir[0], dir[1], dir[2]);
    if (!p) return;
    p.alvo = alvo;
    p.alvoMob = alvoMob;
    if (tipo === 'flecha') this._tocarProjetil(p, 'flecha');
    else if (tipo === 'orbe' || tipo === 'cura') this._tocarProjetil(p, 'magia');
  }

  /** (Cliente) O projétil acabou em `ponto` */
  receberProjetilFim(id, ponto) {
    if (this.autoridade) return;
    const p = this._projPorId.get(id);
    if (!p) return;
    const x = ponto ? ponto[0] : p.x, y = ponto ? ponto[1] : p.y, z = ponto ? ponto[2] : p.z;
    p.ativo = false;
    this._efeitoFim(p.tipo, x, y, z);
    if (p.def.nuvem) this._criarNuvem(x, y, z);
    const i = this._proj.indexOf(p);
    if (i >= 0) this._descartarProjetil(i);
  }

  /** Tira o projétil da lista e guarda o objeto e a malha */
  _descartarProjetil(i) {
    const p = this._proj[i];
    const ult = this._proj.length - 1;
    if (i !== ult) this._proj[i] = this._proj[ult];
    this._proj.length = ult;
    if (this._projPorId.get(p.id) === p) this._projPorId.delete(p.id);
    if (p.malha) this._devolverMalha(p.tipo, p.malha);
    p.malha = null;
    p.ativo = false;
    this._projLivres.push(p);
  }

  _pegarMalha(tipo) {
    const pool = this._malhasProj.get(tipo);
    let g = pool && pool.length > 0 ? pool.pop() : null;
    if (!g) g = criarMalhaProjetil(tipo);
    g.visible = true;
    if (g.parent !== this.scene && this.scene) this.scene.add(g);
    return g;
  }

  _devolverMalha(tipo, g) {
    g.visible = false;
    let pool = this._malhasProj.get(tipo);
    if (!pool) { pool = []; this._malhasProj.set(tipo, pool); }
    if (pool.length < MALHAS_NO_POOL) pool.push(g);
    else if (g.parent) g.parent.remove(g);
  }

  /** Põe a malha no lugar e virada para onde o projétil vai */
  _posicionarMalha(p) {
    const g = p.malha;
    g.position.set(p.x, p.y, p.z);
    if (p.tipo === 'flecha' || p.tipo === 'gelo') {
      if (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz > 0.01) g.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
    } else {
      g.rotation.y += 0.15; // as bolas giram
      g.rotation.x += 0.1;
    }
  }

  /** Jogador vivo que o projétil `p` está encostando (caixa do jogador + raio do projétil), ou null */
  _jogadorAtingido(p) {
    const r = p.def.raio;
    const jog = this._jogadores;
    for (let i = 0; i < jog.length; i++) {
      const j = jog[i];
      const q = j.posicao;
      if (!q || j.morto) continue;
      if (Math.abs(p.x - q.x) > RAIO_JOGADOR + r || Math.abs(p.z - q.z) > RAIO_JOGADOR + r) continue;
      if (p.y < q.y - r || p.y > q.y + ALTURA_JOGADOR + r) continue;
      return j;
    }
    return null;
  }

  _atualizarProjeteis(dt) {
    const lista = this._proj;
    const autoridade = this.autoridade;
    for (let i = lista.length - 1; i >= 0; i--) {
      const p = lista[i];
      if (!p.ativo) { this._descartarProjetil(i); continue; }
      p.t += dt;
      const def = p.def;
      if (def.sopro) {
        this._atualizarSopro(p, dt);
      } else if (!p.parado) {
        // Orbe: persegue o jogador alvo de leve (gira a velocidade aos poucos)
        if (def.guia && p.alvo) {
          const j = this._jogadorPorId(p.alvo);
          if (j && j.posicao && !j.morto) this._guiarPara(p, j.posicao.x, j.posicao.y + 1.1, j.posicao.z, def.guia * dt);
        }
        // Cura: vai até o orc
        let orc = null;
        if (def.guiaMob && p.alvoMob) {
          orc = this.porId.get(p.alvoMob);
          if (orc && !orc.morrendo && !orc.descartar) this._guiarPara(p, orc.x, orc.y + orc.def.altura * 0.5, orc.z, 6 * dt);
          else orc = null;
        }
        p.vy -= def.grav * dt;
        const vel = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
        const passos = Math.max(1, Math.ceil(vel * dt / 0.4));
        const h = dt / passos;
        for (let s = 0; s < passos && p.ativo; s++) {
          p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
          const id = this.mundo.obterBloco(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
          if (SOLIDO[id]) {
            const bx = p.x - p.vx * h, by = p.y - p.vy * h, bz = p.z - p.vz * h;
            if (autoridade) this._fimProjetil(p, bx, by, bz, null);
            else { p.parado = true; p.x = bx; p.y = by; p.z = bz; }
            break;
          }
          if (!autoridade) continue;
          if (def.guiaMob) {
            if (orc) {
              const dx = orc.x - p.x, dy = orc.y + orc.def.altura * 0.5 - p.y, dz = orc.z - p.z;
              if (dx * dx + dy * dy + dz * dz < 1.2) {
                orc.vida = Math.min(orc.def.vidaMax, orc.vida + (def.cura || 0));
                orc.vidaFrac = orc.vida / orc.def.vidaMax;
                if (orc.modelo) orc.modelo.definirVida(orc.vidaFrac);
                this._fimProjetil(p, p.x, p.y, p.z, null);
              }
            }
          } else {
            const j = this._jogadorAtingido(p);
            if (j) {
              if (p.dano > 0) this._danoEmJogador(j, p.dano, p.x - p.vx * 0.05, p.y, p.z - p.vz * 0.05, def.efeito, def.segundos);
              this._fimProjetil(p, p.x, p.y, p.z, j);
            }
          }
        }
      }
      if (!p.ativo) { this._descartarProjetil(i); continue; }
      // Tempo acabou (o cliente espera um pouco mais pelo `projetilFim`)
      if (p.t > def.vida + (autoridade ? 0 : 1.5)) {
        if (autoridade) this._fimProjetil(p, p.x, p.y, p.z, null);
        this._descartarProjetil(i);
        continue;
      }
      if (p.malha) {
        this._posicionarMalha(p);
        if (p.parado) p.malha.visible = false;
      }
      this._rastro(p, dt);
    }
  }

  /** Gira a velocidade do projétil na direção de (tx, ty, tz), no máximo `ang` radianos */
  _guiarPara(p, tx, ty, tz, ang) {
    const vel = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) || 1;
    let dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= d; dy /= d; dz /= d;
    // mistura a direção atual com a do alvo (aproximação simples de girar)
    const k = Math.min(1, ang);
    let nx = p.vx / vel + (dx - p.vx / vel) * k;
    let ny = p.vy / vel + (dy - p.vy / vel) * k;
    let nz = p.vz / vel + (dz - p.vz / vel) * k;
    const n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    p.vx = nx / n * vel; p.vy = ny / n * vel; p.vz = nz / n * vel;
  }

  /**
   * (Anfitrião) O projétil acabou em (x, y, z): explosão da bola de fogo,
   * nuvem do veneno, partículas, e avisa os clientes. `jAtingido` = quem
   * levou o golpe direto (não leva a explosão de novo).
   */
  _fimProjetil(p, x, y, z, jAtingido) {
    if (!p.ativo) return;
    p.ativo = false;
    const def = p.def;
    if (def.explosao) {
      const r2 = def.explosao * def.explosao;
      const jog = this._jogadores;
      for (let i = 0; i < jog.length; i++) {
        const j = jog[i];
        if (j === jAtingido || !j.posicao || j.morto) continue;
        const dx = j.posicao.x - x, dy = j.posicao.y + 0.9 - y, dz = j.posicao.z - z;
        if (dx * dx + dy * dy + dz * dz <= r2) this._danoEmJogador(j, def.danoExplosao, x, y - 0.5, z, def.efeito, def.segundos);
      }
    }
    if (def.nuvem) {
      y = this._chaoEm(x, y, z);
      this._criarNuvem(x, y, z);
    }
    if (this.rede && this.rede.temClientes && typeof this.rede.enviarProjetilFim === 'function') this.rede.enviarProjetilFim(p.id, [x, y, z]);
    if (!def.sopro) this._efeitoFim(p.tipo, x, y, z);
    // o dragão deixa de soprar
    if (def.sopro && p.dono) {
      const d = this.porId.get(p.dono);
      if (d && d.soproId === p.id) d.soproId = 0;
    }
  }

  /** y do chão logo abaixo de (x, y, z) (até 6 blocos), para a nuvem de veneno */
  _chaoEm(x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    let by = Math.floor(y);
    for (let k = 0; k < 6 && by > 0; k++, by--) {
      if (SOLIDO[this.mundo.obterBloco(bx, by - 1, bz)] || LIQUIDO[this.mundo.obterBloco(bx, by - 1, bz)]) return by;
    }
    return Math.floor(y);
  }

  /** Partículas do fim do projétil (anfitrião e cliente) */
  _efeitoFim(tipo, x, y, z) {
    const part = this.particulas;
    if (!part || typeof part.emitir !== 'function' || !this._pertoDeMim(x, y, z, 64)) return;
    // Acertou a MIM (o ponto está colado nos meus olhos): as partículas
    // nasceriam dentro da câmera e virariam quadrados enormes na tela. Os
    // efeitos de tela (fogo, lento, veneno) e o piscar de dano já mostram o golpe.
    if (this._pertoDosOlhos(x, y, z, DIST_PARTICULA_OLHOS)) return;
    const ef = EF_IMPACTO[tipo];
    if (!ef) return;
    ef.x = x; ef.y = y + (tipo === 'veneno' ? 0.3 : 0); ef.z = z;
    part.emitir(ef);
    if (tipo === 'bola_fogo') {
      // A fumaça bem na cara do jogador viraria uma parede cinza na tela: só de longe
      if (!this._pertoDeMim(x, y - 1.5, z, 3)) {
        EF_FUMACA_FOGO.x = x; EF_FUMACA_FOGO.y = y; EF_FUMACA_FOGO.z = z;
        part.emitir(EF_FUMACA_FOGO);
      }
    } else if (tipo === 'gelo' && typeof part.neve === 'function') {
      part.neve(x, y + 0.5, z);
    }
  }

  /** Rastro de partículas atrás do projétil */
  _rastro(p, dt) {
    const part = this.particulas;
    const ef = EF_RASTRO[p.tipo];
    if (!ef || p.parado || !part || typeof part.emitir !== 'function') return;
    p.tRastro -= dt;
    if (p.tRastro > 0) return;
    p.tRastro = INTERVALO_RASTRO[p.tipo] || 0.05;
    if (!this._pertoDeMim(p.x, p.y, p.z, 64) || this._pertoDosOlhos(p.x, p.y, p.z, DIST_PARTICULA_OLHOS)) return;
    ef.x = p.x; ef.y = p.y; ef.z = p.z;
    part.emitir(ef);
  }

  /** Sopro de fogo: partículas no cone e (no anfitrião) o dano a cada 0,5 s */
  _atualizarSopro(p, dt) {
    const dono = p.dono ? this.porId.get(p.dono) : null;
    if (this.autoridade && (!dono || dono.morrendo || dono.descartar)) {
      this._fimProjetil(p, p.x, p.y, p.z, null);
      return;
    }
    // Partículas: saem da boca na direção do cone, um pouco abertas
    const part = this.particulas;
    p.tRastro -= dt;
    if (p.tRastro <= 0 && part && typeof part.emitir === 'function') {
      p.tRastro = 1 / 30;
      if (this._pertoDeMim(p.x, p.y, p.z, 80)) {
        const e = EF_SOPRO, b = EF_SOPRO_BRILHO;
        e.x = b.x = p.x; e.y = b.y = p.y; e.z = b.z = p.z;
        e.vx = b.vx = p.vx * 12; e.vy = b.vy = p.vy * 12; e.vz = b.vz = p.vz * 12;
        part.emitir(e);
        part.emitir(b);
      }
    }
    if (!this.autoridade) return;
    p.tDano -= dt;
    if (p.tDano > 0) return;
    p.tDano = INTERVALO_DANO_SOPRO;
    const jog = this._jogadores;
    for (let i = 0; i < jog.length; i++) {
      const j = jog[i];
      if (!j.posicao || j.morto) continue;
      const tx = j.posicao.x - p.x, ty = j.posicao.y + 1 - p.y, tz = j.posicao.z - p.z;
      const d = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (d > ALCANCE_SOPRO || d < 0.01) continue;
      if ((tx * p.vx + ty * p.vy + tz * p.vz) / d < COS_SOPRO) continue; // fora do cone
      // Atrás de uma parede, o fogo não pega
      if (typeof this.mundo.raycast === 'function') {
        const o = this._origemVisao, dv = this._dirVisao;
        o.x = p.x; o.y = p.y; o.z = p.z; dv.x = tx; dv.y = ty; dv.z = tz;
        const r = this.mundo.raycast(o, dv, d);
        if (r && r.t < d - 0.8) continue;
      }
      this._danoEmJogador(j, p.dano, p.x, p.y, p.z, p.def.efeito, p.def.segundos);
    }
  }

  // ------------------------------------------------------------------
  // Nuvens de veneno (Fase 8)
  // ------------------------------------------------------------------

  _criarNuvem(x, y, z) {
    let n = null, maisVelha = null;
    for (const c of this._nuvens) {
      if (!c.ativa) { n = c; break; }
      if (!maisVelha || c.t > maisVelha.t) maisVelha = c;
    }
    if (!n) n = maisVelha;
    n.ativa = true;
    n.x = x; n.y = y; n.z = z;
    n.t = 0; n.tDano = 0.2; n.tParticula = 0;
  }

  /** As nuvens soltam fumacinha verde; no anfitrião, quem estiver dentro leva veneno */
  _atualizarNuvens(dt) {
    const part = this.particulas;
    const nuvens = this._nuvens;
    for (let k = 0; k < nuvens.length; k++) {
      const c = nuvens[k];
      if (!c.ativa) continue;
      c.t += dt;
      if (c.t >= NUVEM_TEMPO) { c.ativa = false; continue; }
      c.tParticula -= dt;
      if (c.tParticula <= 0 && part && typeof part.emitir === 'function') {
        c.tParticula = 0.07;
        if (this._pertoDeMim(c.x, c.y, c.z, 64)) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * NUVEM_RAIO;
          EF_NUVEM.x = c.x + Math.cos(a) * r; EF_NUVEM.y = c.y + 0.3 + Math.random() * 0.6; EF_NUVEM.z = c.z + Math.sin(a) * r;
          part.emitir(EF_NUVEM);
        }
      }
      if (!this.autoridade) continue;
      c.tDano -= dt;
      if (c.tDano > 0) continue;
      c.tDano = 1;
      const jog = this._jogadores;
      for (let i = 0; i < jog.length; i++) {
        const j = jog[i];
        if (!j.posicao || j.morto) continue;
        const dx = j.posicao.x - c.x, dy = j.posicao.y - c.y, dz = j.posicao.z - c.z;
        if (dx * dx + dz * dz > NUVEM_RAIO * NUVEM_RAIO || dy < -1.5 || dy > 2.5) continue;
        this._danoEmJogador(j, 1, c.x, c.y, c.z, 'veneno', 3);
      }
    }
  }

  /** O ponto está a até `dist` blocos dos olhos do meu jogador? (sem jogador local: não) */
  _pertoDosOlhos(x, y, z, dist) {
    const loc = this._local;
    if (!loc) return false;
    const dx = x - loc.posicao.x, dy = y - (loc.posicao.y + ALTURA_OLHOS), dz = z - loc.posicao.z;
    return dx * dx + dy * dy + dz * dz <= dist * dist;
  }

  /** O ponto está a até `dist` blocos do meu jogador? (sem jogador local: sim) */
  _pertoDeMim(x, y, z, dist) {
    const loc = this._local;
    if (!loc) return true;
    const dx = x - loc.posicao.x, dy = y - loc.posicao.y, dz = z - loc.posicao.z;
    return dx * dx + dy * dy + dz * dz <= dist * dist;
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
          // Queimando ou envenenado: o dano de cada segundo tem o som limitado
          this._mostrarDano(m, m.vidaFrac, true, (flags & (F_QUEIMANDO | F_ENVENENADO)) !== 0);
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
      // Chefão perto de mim sumiu sem morrer (ex.: a Lua Vermelha acabou): avisa,
      // senão parece que ele desapareceu do nada
      if (m.def.chefao && !m.descartar && m.distLocal < DIST_BARRA_CHEFAO) this._avisar(m.def.nome + ' foi embora.');
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

    // Longe do meu jogador (vivo ou morto): nem desenha nem anima
    const loc = this._local;
    let dist = 0;
    if (loc) {
      const dx = m.x - loc.posicao.x, dy = m.y - loc.posicao.y, dz = m.z - loc.posicao.z;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    m.distLocal = dist;
    const visivel = dist < DIST_VISIVEL + (def.chefao ? 32 : 0) && !m.descartar;
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

    // Animação (o estado estendido da Fase 8 vai junto: o modelo usa o que conhece)
    const an = m.anim;
    an.atacando = (fl & F_ATACANDO) !== 0;
    an.voando = (fl & F_NO_AR) !== 0;
    an.nadando = (fl & F_NADANDO) !== 0;
    an.pousado = (fl & F_POUSADO) !== 0;
    const cab = an.cabecaAtacando;
    cab[0] = (fl & F_CABECA[0]) !== 0;
    cab[1] = (fl & F_CABECA[1]) !== 0;
    cab[2] = (fl & F_CABECA[2]) !== 0;
    // Boca do dragão: abre toda no sopro e um pouco no mergulho (garras)
    const alvoBoca = (fl & F_SOPRANDO) !== 0 ? 1 : (an.atacando ? 0.45 : 0);
    an.boca += (alvoBoca - an.boca) * Math.min(1, dt * 8);
    mod.animar(dt, m.morrendo ? 0 : m.velAnim, an);
    if (m.morrendo) mod.morrer(m.tMorte);

    // Luz do lugar (a cada 0.25 s): as tochas iluminam os mobs. Tom azulado
    // quando está lento e esverdeado quando está envenenado.
    m.tLuz -= dt;
    if (m.tLuz <= 0) {
      m.tLuz = 0.25;
      const luz = typeof this.mundo.luzEm === 'function'
        ? this.mundo.luzEm(m.x, m.y + 1, m.z)
        : (this.ceu ? this.ceu.luzDoDia : 1);
      mod.definirLuz(luz);
      const lento = (fl & F_LENTO) !== 0, ven = (fl & F_ENVENENADO) !== 0;
      if ((lento || ven) && Array.isArray(mod._materiais)) {
        const mats = mod._materiais;
        for (let k = 0; k < mats.length; k++) {
          const mat = mats[k];
          if (!mat || !mat.color) continue;
          if (lento) { mat.color.r *= 0.55; mat.color.g *= 0.8; }
          if (ven) { mat.color.r *= 0.7; mat.color.b *= 0.6; }
        }
      }
    }

    const part = this.particulas;
    if (part && typeof part.emitir === 'function' && dist < 48 + (def.chefao ? 32 : 0)) {
      // Pegando fogo (poder de fogo, espada do dragão ou sol da manhã)
      if ((fl & F_QUEIMANDO) !== 0) {
        m.tFogo -= dt;
        if (m.tFogo <= 0) {
          m.tFogo = 0.1;
          EF_FOGO.x = m.x; EF_FOGO.y = m.y + def.altura * 0.4; EF_FOGO.z = m.z;
          EF_FOGO.espalhar = Math.max(0.4, def.raio * 1.6);
          part.emitir(EF_FOGO);
        }
      }
      // Envenenado: bolhinhas verdes
      if ((fl & F_ENVENENADO) !== 0) {
        m.tVen -= dt;
        if (m.tVen <= 0) {
          m.tVen = 0.2;
          EF_VENENO_MOB.x = m.x; EF_VENENO_MOB.y = m.y + def.altura * 0.6; EF_VENENO_MOB.z = m.z;
          EF_VENENO_MOB.espalhar = Math.max(0.4, def.raio * 1.4);
          part.emitir(EF_VENENO_MOB);
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

    // Dragão voando perto: bater de asas
    if (def.comportamento === 'dragao' && an.voando && !m.morrendo && dist < 28) {
      this._tAsas -= dt;
      if (this._tAsas <= 0) {
        this._tAsas = 1.5;
        const s = this.som;
        if (s && typeof s.asas === 'function') s.asas();
      }
    }

    // Barulhinho de vez em quando (oinc, cocoricó, gemido, chiado). No máximo
    // um a cada INTERVALO_SOM_IDLE s para todos os mobs juntos: com 40 mobs
    // perto, seria um coral (e cada som cria vários nós de áudio).
    m.tSom -= dt;
    if (m.tSom <= 0) {
      const alcanceSom = def.chefao ? DIST_SOM_CHEFAO : DIST_SOM;
      if (this._esperaSomIdle > 0 || m.morrendo || !loc || dist >= alcanceSom) {
        m.tSom = 1 + Math.random() * 3; // tenta de novo daqui a pouco
      } else {
        m.tSom = 6 + Math.random() * 10;
        this._esperaSomIdle = INTERVALO_SOM_IDLE;
        this._tocar(m, 'idle');
      }
    }
  }

  /**
   * Toca um som do mob, mais baixo quanto mais longe do meu jogador (vivo ou
   * morto). Sem jogador local, não toca.
   */
  _tocar(m, evento) {
    const s = this.som;
    if (!s || typeof s.mob !== 'function') return;
    const loc = this._local;
    if (!loc) return;
    const dx = m.x - loc.posicao.x, dy = m.y - loc.posicao.y, dz = m.z - loc.posicao.z;
    const alcance = m.def.chefao ? DIST_SOM_CHEFAO : DIST_SOM;
    const vol = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / alcance;
    if (vol > 0.02) s.mob(m.def.som, evento, vol);
  }

  /** Sons sem volume próprio (flecha, magia): só se o mob estiver perto de mim */
  _tocarEspecial(m, nome) {
    const s = this.som;
    if (!s || typeof s[nome] !== 'function' || !this._local) return;
    if (this._pertoDeMim(m.x, m.y, m.z, 20)) s[nome]();
  }

  _tocarProjetil(p, nome) {
    const s = this.som;
    if (!s || typeof s[nome] !== 'function' || !this._local) return;
    if (this._pertoDeMim(p.x, p.y, p.z, 20)) s[nome]();
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
