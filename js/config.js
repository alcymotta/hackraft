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
  CHUNKS_POR_QUADRO: 2,     // quantos chunks são montados por quadro (mais = carrega rápido, mas pode travar)
  NEVOA_INICIO: 0.55,       // a névoa começa nesta fração da distância visível
  NEVOA_FIM: 0.95,          // e fica total nesta fração
  CAMERA_LONGE: 1000,       // até onde a câmera enxerga (o céu fica dentro disso)

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
  DISTANCIA_3A_PESSOA: 4,   // distância da câmera na terceira pessoa (F5)

  // ----- Inventário -----
  TAMANHO_PILHA: 64,        // quantos itens iguais cabem num espaço
  ESPACOS_HOTBAR: 9,
  ESPACOS_INVENTARIO: 36,   // total (9 da hotbar + 27 da mochila)

  // ----- Salvamento -----
  CHAVE_SAVE: 'hackraft-save-v1',
  AUTOSAVE_SEGUNDOS: 30,
};

// Duração total de um dia completo (dia + noite), em segundos
export const CICLO_SEGUNDOS = CONFIG.DIA_SEGUNDOS + CONFIG.NOITE_SEGUNDOS;
