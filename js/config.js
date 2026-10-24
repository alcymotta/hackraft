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
  Y_ABISMO: -10,            // abaixo disso o jogador volta ao ponto de nascimento

  // ----- Inventário -----
  TAMANHO_PILHA: 64,        // quantos itens iguais cabem num espaço
  ESPACOS_HOTBAR: 9,
  ESPACOS_INVENTARIO: 36,   // total (9 da hotbar + 27 da mochila)

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
  MODS_POR_LOTE: 1000,           // blocos mudados por mensagem ao mandar o mundo para quem entra (1000 = 16 KB, cabe numa mensagem só)
  ESPERA_AO_CAIR_S: 3,           // segundos mostrando o aviso antes de voltar ao início (cliente)
};

// Duração total de um dia completo (dia + noite), em segundos
export const CICLO_SEGUNDOS = CONFIG.DIA_SEGUNDOS + CONFIG.NOITE_SEGUNDOS;
