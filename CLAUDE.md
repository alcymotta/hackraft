# Hackraft

Jogo 3D de blocos no estilo Minecraft, feito para um pai jogar com o filho no navegador. Roda direto no GitHub Pages, sem instalar nada. O multiplayer é P2P com PeerJS (entra na Fase 2). O dono do projeto programa pouco: explique tudo de forma simples e em português.

## Como rodar
É preciso um servidor local, porque os ES modules não funcionam abrindo o arquivo direto (`file://`):
- `npx --yes serve -l 5173 .` e abrir http://localhost:5173
- ou a extensão **Live Server** do VS Code (botão "Go Live")

## Tecnologia e convenções
- HTML + CSS + JavaScript puro com ES modules. **Sem build e sem npm.**
- Three.js `0.170.0` pelo importmap do `index.html` (jsDelivr). Nos módulos: `import * as THREE from 'three'`. Os addons vêm de `three/addons/...`.
- Comentários, nomes de variáveis e textos da tela em **português**.
- Números ajustáveis ficam em `js/config.js` (`CONFIG`).
- A geração do mundo é **determinística pela semente** (nada de `Math.random` em `noise.js`, `chunk.js` ou `world.js`).
- Coordenadas: 1 unidade = 1 bloco. Y para cima. O bloco (x,y,z) ocupa de x até x+1. Com `yaw = 0`, câmera e personagem olham para **-Z**.
- Itens do inventário são identificados por **texto** (`'grama'`). Blocos no mundo usam **número** (`B.GRAMA`).
- Desempenho: geometria por chunk, só faces visíveis, nada de alocar objetos dentro do loop principal.

## Estrutura
```
index.html          página, importmap, telas (HTML)
style.css           visual das telas e da interface
js/config.js        CONFIG: constantes ajustáveis
js/blocks.js        B (ids), BLOCOS, SOLIDO/OPACO/LIQUIDO, blocoPorNome, texturaDaFace, NOMES_TEXTURAS
js/items.js         ITENS, registrarItem, obterItem
js/noise.js         ruído com semente (simplex 2D/3D, fBm, hash)
js/chunk.js         dados de um chunk + montagem da malha (faces visíveis, AO)
js/world.js         Mundo: geração, carregar/descarregar chunks, shader dos blocos, raycast
js/textures.js      texturas 16x16 geradas em canvas (+ substituição opcional por PNG)
js/sky.js           Ceu: dia/noite, sol, lua, estrelas, nuvens, luzes, névoa
js/character.js     Personagem de blocos com skin 64x64 e animação
js/inventory.js     Inventario (36 espaços)
js/ui.js            InterfaceJogo: mira, hotbar, inventário (E), telas, debug (F3), pointer lock
js/audio.js         som: passos, quebrar, colocar (arquivos .ogg ou sons sintetizados)
js/player.js        Jogador: física, controles, câmera 1ª/3ª pessoa, quebrar/colocar
js/save.js          salvar/carregar no localStorage
js/main.js          junta tudo e roda o loop
js/network.js       Rede: multiplayer P2P com PeerJS (anfitrião é a autoridade)
js/jogadores_remotos.js  JogadoresRemotos: bonecos e nomes dos outros jogadores
js/equipamento.js   Equipamento: roupa, armadura, mão principal, acessório (Fase 3)
js/itens_chao.js    ItensNoChao: itens largados no mundo (Fase 3)
js/chat.js          Chat: caixa de mensagens (T) e execução de comandos (Fase 4)
js/comandos.js      os comandos /dia, /noite, /voar, /tp, /casa, /setcasa, /dar, /hacker, /ajuda (Fase 4)
js/hacker.js        ModoHacker: efeitos de tela, letras Matrix, raio-X (Fase 4)
js/powers.js        Poderes: cristais, HUD de poderes ativos, ataques de fogo/raio/gelo (Fase 5)
js/particulas.js    Particulas: pedacinhos de bloco, brilhos, fogo, raio, gelo (Fase 5)
js/mobs.js          (Fase 7) animais e monstros
assets/textures/    PNGs opcionais que substituem as texturas geradas (ver texturas.json)
assets/sounds/      sons opcionais (ver sons.json)
CONTRATOS.md        APIs entre módulos, mensagens de rede e formato do save (por fase)
DECISOES.md         decisões tomadas sem consultar o dono do projeto (para ele revisar)
.claude/agents/     subagentes: organizador, programador, arquiteto, testador
.claude/commands/   /planejar
```

## Contratos entre módulos
Os contratos (APIs de cada módulo, mensagens de rede, formato do save, decisões de implementação de cada fase) ficam em **`CONTRATOS.md`**. Leia a parte do módulo em que vai trabalhar antes de começar. Ao mudar uma API, atualize lá.

## Subagentes e fluxo de trabalho
- A conversa principal é a **coordenadora**: divide cada fase em tarefas e manda cada uma para o agente certo, em paralelo quando são independentes.
- `organizador` (haiku): arquivos, assets, Git, README, CLAUDE.md
- `programador` (sonnet): código do dia a dia
- `arquiteto` (opus): multiplayer, mundo/chunks, desempenho, IA, bugs difíceis
- `testador` (haiku): revisão e roteiro de testes (não edita)
- `/planejar <tarefa>` classifica a tarefa e indica o agente.
- Antes de cada fase: mostrar a divisão tarefa → agente. No fim: dizer quais agentes foram usados e explicar como testar. Desde a Fase 3, o dono pediu para seguir direto até a Fase 11 sem esperar confirmação: cada fase é testada pelos agentes (revisão + Chrome headless), vai para o Git e a próxima começa. As decisões tomadas sozinho vão para `DECISOES.md`.
- Commit no fim de cada fase que funcionar: `Fase N: resumo`.

## Fases
- [x] Fase 0: preparação (agentes, /planejar, Git, estrutura)
- [x] Fase 1: mundo e movimento
- [x] Fase 2: multiplayer
- [x] Fase 3: personagem e roupinhas
- [x] Fase 4: chat e comandos (+ /hacker)
- [x] Fase 5: minérios de poder
- [x] Fase 6: baús e construção
- [x] Fase 7: mobs
- [ ] Fase 8: monstros estilo RPG
- [ ] Fase 9: armas, armaduras, minérios e forja (em andamento: minérios, armas e forja prontos; falta ligar no jogo)
- [ ] Fase 10: roupas como itens e camadas de equipamento
- [ ] Fase 11: montarias

## Pendências técnicas
- Com a aba do anfitrião escondida, o loop do jogo dele para, e o horário dos clientes para junto.
- Luz:
  - a luz do céu vem só do mapa de altura (porta e vidro deixam passar);
  - caso raro: se um chunk do meio do caminho for descarregado e a tocha for tirada depois, pode sobrar "luz fantasma" até recarregar.
## Voltar para uma versão anterior (Git)
- `git log --oneline`: lista as versões salvas
- `git restore .`: desfaz o que mudou desde o último commit
- `git revert <código>`: cria uma versão nova que desfaz um commit específico
