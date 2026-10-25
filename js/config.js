// =====================================================================
// Hackraft - Configurações gerais
// ---------------------------------------------------------------------
// Todos os números que você pode querer ajustar ficam aqui.
// Mude um valor, salve e recarregue a página para ver o efeito.
// =====================================================================

export const CONFIG = {
  // ----- Dia e noite -----
  DIA_SEGUNDOS: 180,        // duração do dia (3 minutos)
  NOITE_SEGUNDOS: 120,      // duração da noite (2 minutos)
  TRANSICAO_SEGUNDOS: 15,   // duração do amanhecer e do anoitecer (as cores se misturam)
  LUZ_MINIMA: 0.15,         // quão escura fica a noite (0 = breu total, 1 = igual ao dia)
  HORA_INICIAL: 20,         // em segundos desde o nascer do sol, ao criar um mundo novo

  // ----- Mundo -----
  TAMANHO_CHUNK: 16,        // largura e profundidade de cada pedaço (chunk) do mundo
  ALTURA_MUNDO: 96,         // altura máxima do mundo, em blocos
  NIVEL_MAR: 30,            // altura da água dos lagos e mares
  DISTANCIA_RENDER: 6,      // quantos chunks em volta do jogador ficam visíveis
  CHUNKS_POR_QUADRO: 3,     // quantos chunks são montados por quadro (mais = carrega rápido, mas pode travar)
  NEVOA_INICIO: 0.55,       // a névoa começa nesta fração da distância visível
  NEVOA_FIM: 0.95,          // e fica total nesta fração
  CAMERA_LONGE: 1000,       // até onde a câmera enxerga (o céu fica dentro disso)
  ORCAMENTO_CHUNKS_MS: 8,   // tempo máximo (milissegundos) por quadro gasto montando chunks
  LUZ_CAVERNA: 0.3,         // brilho mínimo dentro de cavernas (0 = escuro total)
  LUZ_MINIMA_BLOCOS: 0.04,  // brilho mínimo dos blocos, mesmo no escuro
  ALFA_AGUA: 0.7,           // opacidade da água (1 = opaca)
  AFUNDAR_AGUA: 0.1,        // quanto a superfície da água fica abaixo do topo do bloco

  // ----- Jogador -----
  GRAVIDADE: 28,            // blocos por segundo², puxando para baixo
  VEL_ANDAR: 4.3,           // blocos por segundo
  VEL_CORRER: 6.5,          // segurando Shift
  VEL_NADAR: 2.5,           // dentro da água
  VEL_PULO: 9,              // velocidade para cima ao pular
  ALCANCE: 5,               // distância máxima para quebrar e colocar blocos
  LARGURA_JOGADOR: 0.6,
  ALTURA_JOGADOR: 1.8,
  ALTURA_OLHOS: 1.62,
  SENSIBILIDADE_MOUSE: 0.0022,
  CAMPO_DE_VISAO: 75,       // em graus
  DISTANCIA_3A_PESSOA: 4,   // distância da câmera na terceira pessoa (tecla V ou F5)
  INTERVALO_COLOCAR: 0.25,  // segundos entre blocos colocados segurando o botão direito
  ESPERA_APOS_QUEBRAR: 0.15, // pausa (segundos) depois de quebrar um bloco
  INTERVALO_GOLPE: 0.25,    // segundos entre os sons de golpe ao quebrar
  DISTANCIA_PASSO: 2.0,     // blocos andados entre um som de passo e outro
  ACEL_CHAO: 60,            // quão rápido o jogador ganha velocidade no chão
  ACEL_AR: 15,              // idem, no ar (menos controle)
  ACEL_AGUA: 20,            // idem, na água
  GRAVIDADE_AGUA: 6,        // gravidade dentro da água (bem menor)
  ARRASTO_AGUA: 3,          // freio vertical da água
  VEL_SUBIR_AGUA: 3.5,      // velocidade de subida nadando (Space)
  VEL_MAX_QUEDA: 55,        // velocidade máxima de queda
  VEL_VOAR: 10,             // velocidade horizontal voando (comando /voar)
  VEL_VOAR_VERTICAL: 8,     // velocidade de subir (Espaço) e descer (Shift) voando
  ACEL_VOAR: 40,            // quão rápido ganha e perde velocidade voando (maior = para mais seco)
  Y_ABISMO: -10,           // abaixo disso o jogador volta ao ponto de nascimento

  // ----- Inventário -----
  TAMANHO_PILHA: 64,        // quantos itens iguais cabem num espaço
  ESPACOS_HOTBAR: 9,
  ESPACOS_INVENTARIO: 36,   // total (9 da hotbar + 27 da mochila)

  // ----- Itens no chão (Fase 3) -----
  ITEM_TAMANHO: 0.4,        // tamanho do desenho do item no chão, em blocos
  ITEM_RAIO_PEGAR: 1.3,     // a esta distância (em blocos) o jogador pega o item
  ITEM_RAIO_PUXAR: 2.5,     // a esta distância o item começa a ser puxado para o jogador
  ITEM_FORCA_PUXAR: 16,     // força do "puxão" (maior = o item vem mais rápido)
  ITEM_VIDA_S: 600,         // segundos até o item sumir sozinho (600 = 10 minutos)
  ITEM_ATRASO_S: 0.5,       // segundos até um item recém-solto poder ser pego
  ITEM_ATRASO_DONO_S: 2,    // quem soltou espera mais para pegar de volta (e o item não é puxado para ele)
  ITEM_GRAVIDADE: 20,       // gravidade dos itens (um pouco menor que a do jogador)
  ITEM_IMPULSO: 4.5,        // velocidade do item ao ser jogado (tecla G), na direção do olhar
  MAX_ITENS_CHAO: 256,      // máximo de itens no chão ao mesmo tempo (o mais antigo some)

  // ----- Tesouros (Fase 3) -----
  CHANCE_PRESENTE: 0.32,    // chance de um chunk ter um presente misterioso (0.32 = ~1 a cada 3,5 chunks; no mar e nos picos não tem)
                            // (mudar isto muda onde os presentes nascem em TODOS os mundos)

  // ----- Salvamento -----
  CHAVE_SAVE: 'hackraft-save-v1',
  AUTOSAVE_SEGUNDOS: 30,

  // ----- Multiplayer -----
  MAX_JOGADORES: 8,              // máximo de jogadores numa sala (contando o anfitrião)
  ENVIOS_POSICAO_POR_SEGUNDO: 15, // quantas vezes por segundo a posição é enviada
  INTERVALO_HORA_S: 5,           // a cada quantos segundos o anfitrião manda a hora do dia
  TOLERANCIA_HORA_S: 1,          // o cliente só corrige a hora se a diferença passar disso
  INTERVALO_ESTADO_S: 10,        // a cada quantos segundos o cliente manda inventário e posição para o anfitrião guardar
  TEMPO_LIMITE_CONEXAO_S: 10,    // tempo máximo esperando o servidor ou a sala responder
  TEMPO_SEM_RESPOSTA_S: 20,      // sem nenhuma mensagem por esse tempo = a conexão caiu (aba travada, internet caiu)
  MODS_POR_LOTE: 1000,           // blocos mudados por mensagem ao mandar o mundo para quem entra (1000 = ~20 KB (5 inteiros por bloco), cabe numa mensagem só)
  ESPERA_AO_CAIR_S: 3,           // segundos mostrando o aviso antes de voltar ao início (cliente)
  CHANCE_LUA_VERMELHA: 1 / 8,    // chance de cada noite ser de Lua Vermelha (Fase 8)

  // ----- Chat (Fase 4) -----
  CHAT_MAX_CARACTERES: 200,      // tamanho máximo de uma mensagem de chat (o resto é cortado)
  CHAT_INTERVALO_MIN_MS: 150,    // o anfitrião ignora mensagens de um mesmo cliente mais rápidas que isso (anti-spam)

  // ----- Vida e poderes (Fase 5) -----
  VIDA_MAX: 20,                  // 20 = 10 corações
  QUEDA_SEGURA: 3,               // blocos que dá para cair sem se machucar
  EMPURRAO_DANO: 5,              // empurrãozinho horizontal ao levar dano com direção
  EMPURRAO_DANO_CIMA: 4,         // e para cima
  EFEITOS_POR_SEGUNDO_MAX: 10,   // limite de mensagens `efeito` por jogador (anti-spam)
  MAX_PODERES_REDE: 8,           // máximo de poderes ativos aceitos numa mensagem `poderes`
  REGEN_INTERVALO_S: 1.5,        // cristal verde: +1 de vida a cada tanto tempo
  BRILHO_INTERVALO_S: 0.3,       // de quanto em quanto tempo saem brilhinhos dos cristais
  BRILHO_RAIO: 14,               // distância máxima (blocos) para os brilhinhos
  BRILHO_POR_VEZ: 3,             // quantos blocos brilham a cada vez

  // ----- Mobs, combate e comida (Fase 7) -----
  ALCANCE_ATAQUE: 4,             // distância (blocos) para bater num mob
  INTERVALO_GOLPE_MOB: 0.5,      // segundos entre dois golpes
  TEMPO_COMER: 0.8,              // segundos segurando o botão direito para comer
  DEFESA_POR_PONTO: 0.04,        // cada ponto de defesa tira 4% do dano dos mobs
  DEFESA_MAX_REDUCAO: 0.8,       // a armadura nunca tira mais que 80% do dano

  // ----- Baús, construção e tochas (Fase 6) -----
  ESPACOS_BAU: 27,               // espaços de um baú
  BLOCOS_POR_LOTE_MAX: 512,      // máximo de blocos numa mensagem `blocos` (lote)
  BAU_TEMPO_LIMITE_S: 5,         // o cliente desiste de abrir o baú se o anfitrião não responder
  TOCHA_INTERVALO_S: 0.15,       // de quanto em quanto tempo saem fagulhas das tochas
  TOCHA_RAIO: 14,                // distância máxima (blocos) para as fagulhas das tochas
  TOCHA_POR_VEZ: 3,              // quantas tochas soltam fagulhas a cada vez
  BAU_DIST_MAX: 12,              // o anfitrião só atende `bauAbrir` de quem está até essa distância (blocos)

  // ----- XP, níveis, efeitos, forja e roupas (Fases 8, 9 e 10) -----
  XP_BASE: 40,                   // XP para subir do nível n = floor(XP_BASE × n^XP_EXPOENTE)
  XP_EXPOENTE: 1.4,
  VIDA_POR_NIVEL: 2,             // +2 de vida (1 coração) a cada nível
  VIDA_MAX_NIVEIS: 40,           // teto da vida máxima (20 corações)
  CURA_AO_SUBIR_NIVEL: 4,        // vida devolvida ao subir de nível
  EFEITO_DANO_INTERVALO_S: 1,    // veneno e fogo tiram 1 de vida a cada tanto tempo
  EFEITO_LENTO_FATOR: 0.5,       // lento: velocidade × 0.5
  EFEITO_FOGO_PADRAO_S: 3,       // duração do fogo quando ninguém diz
  EFEITO_VENENO_PADRAO_S: 4,     // duração do veneno quando ninguém diz
  EFEITO_LENTO_PADRAO_S: 4,      // duração do lento quando ninguém diz
  FORJA_RAIO: 12,                // distância máxima (blocos) para sair fogo das forjas
  FORJA_INTERVALO_S: 0.2,        // de quanto em quanto tempo saem fagulhas das forjas
  FORJA_POR_VEZ: 2,              // quantas forjas soltam fogo a cada vez
};

// Duração total de um dia completo (dia + noite), em segundos
export const CICLO_SEGUNDOS = CONFIG.DIA_SEGUNDOS + CONFIG.NOITE_SEGUNDOS;
