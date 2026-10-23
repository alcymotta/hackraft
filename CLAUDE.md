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
js/network.js       (Fase 2) multiplayer
js/chat.js          (Fase 4) chat e comandos
js/powers.js        (Fase 5) poderes
js/mobs.js          (Fase 7) animais e monstros
assets/textures/    PNGs opcionais que substituem as texturas geradas (ver texturas.json)
assets/sounds/      sons opcionais (ver sons.json)
.claude/agents/     subagentes: organizador, programador, arquiteto, testador
.claude/commands/   /planejar
```

## Contratos entre módulos
Esta seção é a "combinação" entre os módulos. Quem escreve um módulo segue exatamente estes nomes. Se precisar mudar algo, atualize aqui também.

### textures.js
`export async function criarTexturas()` → objeto `texturas`:
- `array`: `THREE.DataArrayTexture` 16×16×N (RGBA, uma camada por textura), `magFilter = NearestFilter`, `minFilter = NearestMipmapLinearFilter`, mipmaps ligados, `colorSpace = SRGBColorSpace`
- `indice(nome)` → número da camada da textura (os nomes vêm de `NOMES_TEXTURAS` em blocks.js)
- `atlasCanvas`: canvas com todas as texturas lado a lado (o atlas)
- `canvasDaTextura(nome)` → canvas 16×16
- `iconeBloco(id)` → dataURL de um ícone 3D pequeno (topo + 2 lados) para a interface
- `rachaduras`: array com 10 `THREE.CanvasTexture` 16×16 (fundo transparente, NearestFilter), as fases de quebra
- As folhas têm furos transparentes (alpha 0), para o recorte.
- Substituição opcional: `assets/textures/texturas.json` (`{"substituir": ["pedra", ...]}`). Para cada nome da lista, carrega `assets/textures/<nome>.png` no lugar da textura gerada.

### world.js
`export class Mundo` com `constructor(scene, texturas, semente)`:
- `semente`
- `atualizar(posJogador)`: põe na fila os chunks em volta, monta até `CONFIG.CHUNKS_POR_QUADRO` por quadro e descarrega os que ficaram longe
- `prepararArea(pos, raio)`: gera e monta na hora os chunks em volta de `pos` (usado ao iniciar)
- `estaPronto(x, z)` → `true` se o chunk dessa posição já tem dados e malha
- `obterBloco(x, y, z)` → id (coordenadas inteiras; fora da altura ou em chunk não carregado devolve `B.AR`)
- `definirBloco(x, y, z, id, origem = 'local')`: muda o bloco, registra em `modificacoes`, remonta o chunk (e o vizinho, se estiver na borda) e chama os ouvintes com `{x, y, z, id, anterior, origem}`
- `aoAlterarBloco(fn)`: registra um ouvinte (a rede usa na Fase 2)
- `raycast(origem, direcao, alcance)` → `{x, y, z, normal: {x, y, z}, id}` ou `null` (ignora ar e água)
- `pontoDeNascimento()` → `THREE.Vector3` nos pés, em terra firme perto de (0, 0)
- `modificacoes`: `Map` com chave `"x,y,z"` → id
- `exportarModificacoes()` → `[[x, y, z, id], ...]`; `carregarModificacoes(lista)`
- `definirLuzDoDia(v)`: valor de 0 a 1 (uniform do shader)
- `estatisticas()` → `{ chunks, fila }` (para o debug)

### sky.js
`export class Ceu` com `constructor(scene)`. Cria a cúpula do céu, o sol, a lua, as estrelas, as nuvens, as luzes (ambiente + direcional, para personagens e objetos) e `scene.fog`.
- `atualizar(dt, posCamera)`: avança o tempo e mantém o céu centrado na câmera
- `hora`: segundos desde o nascer do sol (0 até `CICLO_SEGUNDOS`). Dia de 0 a `DIA_SEGUNDOS`, noite depois.
- `definirHora(segundos)`
- `luzDoDia`: de `CONFIG.LUZ_MINIMA` a 1, com transição suave
- `ehNoite`: boolean

### character.js
`export class Personagem` com `constructor(cores = {})`. Cores: `pele`, `cabelo`, `olhos`, `camisa`, `calca`, `sapato` (strings CSS).
- `grupo`: `THREE.Group` com a origem nos pés, olhando para -Z quando `rotation.y = 0`, altura total de 1.8
- `animar(dt, velHorizontal, noAr)`: balança braços e pernas
- `definirOlhar(pitch)`: inclina a cabeça
- `definirCores(cores)`: redesenha a skin
- `skinCanvas`: canvas 64×64 no layout de skin do Minecraft (as roupas viram camadas nas Fases 3 e 10)
- Material `MeshLambertMaterial` (recebe a luz do céu)

### inventory.js
`export class Inventario`:
- `espacos`: array de 36 posições, cada uma `{ item, qtd }` ou `null`. As posições 0 a 8 são a hotbar.
- `selecionado`: 0 a 8; `selecionar(i)`
- `adicionar(item, qtd = 1)` → quanto sobrou (0 = coube tudo). Primeiro completa as pilhas iguais, depois ocupa espaços vazios (hotbar primeiro).
- `remover(indice, qtd = 1)` → quanto foi removido
- `itemSelecionado()` → `{ item, qtd }` ou `null`
- `aoMudar(fn)`; `notificar()` (chame depois de mexer em `espacos` diretamente)
- `serializar()` → objeto simples; `carregar(dados)`

### ui.js
`export class InterfaceJogo` com `constructor({ inventario, texturas, canvas })`. Controla o HTML da interface **e o pointer lock**.
- Teclas que a UI trata: 1–9 e a roda do mouse (escolhem o espaço da hotbar), E (abre/fecha o inventário), F3 (debug), M (mudo), Esc (fecha o inventário)
- `mostrarCarregando(texto)` / `esconderCarregando()`
- `mostrarTelaInicial({ aoJogar, aoNovoMundo })`: "Jogar" chama `aoJogar` e trava o mouse
- `travarMouse()` / `soltarMouse()`
- `get mouseTravado` → `document.pointerLockElement === canvas`
- `get menuAberto` → true se o inventário, a pausa ou a tela inicial estiverem abertos
- Quando o pointer lock é solto sem o inventário aberto, mostra a tela de pausa (Continuar, volume, Novo mundo)
- `atualizarDebug(texto)`: texto da F3 (só aparece se o debug estiver ligado)
- `mostrarMensagem(texto)`: aviso que some depois de alguns segundos
- `definirSubmerso(bool)`: tom azul na tela quando a câmera está dentro da água
- Os ícones vêm de `texturas.iconeBloco(obterItem(nome).bloco)`

### audio.js
`export const som` com:
- `iniciar()`: cria o AudioContext (chamar depois do primeiro clique)
- `passo(tipo)`, `quebrar(tipo)`, `colocar(tipo)`, `golpe(tipo)`. O tipo vem de `BLOCOS[id].som`.
- `definirVolume(v)` (0 a 1), `alternarMudo()`, `volume`, `mudo`
- Arquivos opcionais: `assets/sounds/sons.json` mapeia um evento (`"passo_grama"`, `"quebrar_pedra"`, ...) para uma lista de arquivos. O que estiver faltando é sintetizado com WebAudio.

### player.js
`export class Jogador` com `constructor({ camera, scene, mundo, inventario, ui, som, personagem })`:
- `posicao` (`Vector3`, nos pés), `velocidade`, `yaw`, `pitch`, `noChao`, `naAgua`, `modoCamera` (`'primeira'` ou `'terceira'`)
- `atualizar(dt)`
- `teletransportar(x, y, z)`
- `serializar()` → `{ pos: [x, y, z], yaw, pitch }`; `carregar(dados)`
- Trata WASD, espaço (pular/nadar), Shift (correr), F5 (câmera) e os botões do mouse. Só age quando `ui.mouseTravado && !ui.menuAberto`.

### save.js
`salvarJogo(estado)`, `carregarJogo()` → estado ou `null`, `apagarJogo()`. Chave: `CONFIG.CHAVE_SAVE`.
Estado: `{ versao: 1, semente, modificacoes, jogador, inventario, hora }`

### main.js
Cria o renderer (canvas `#tela`, sem antialias, pixelRatio ≤ 2), a cena e a câmera, e monta todos os módulos. Roda o loop (dt limitado a 0.05 s), salva sozinho e expõe `window.jogo = { mundo, ceu, jogador, inventario, ui, som, salvar }` para depuração e para os comandos do chat.

## Subagentes e fluxo de trabalho
- A conversa principal é a **coordenadora**: divide cada fase em tarefas e manda cada uma para o agente certo, em paralelo quando são independentes.
- `organizador` (haiku): arquivos, assets, Git, README, CLAUDE.md
- `programador` (sonnet): código do dia a dia
- `arquiteto` (opus): multiplayer, mundo/chunks, desempenho, IA, bugs difíceis
- `testador` (haiku): revisão e roteiro de testes (não edita)
- `/planejar <tarefa>` classifica a tarefa e indica o agente.
- Antes de cada fase: mostrar a divisão tarefa → agente. No fim: dizer quais agentes foram usados, explicar como testar e **esperar a confirmação** antes de seguir.
- Commit no fim de cada fase que funcionar: `Fase N: resumo`.

## Fases
- [x] Fase 0: preparação (agentes, /planejar, Git, estrutura)
- [ ] Fase 1: mundo e movimento
- [ ] Fase 2: multiplayer
- [ ] Fase 3: personagem e roupinhas
- [ ] Fase 4: chat e comandos (+ /hacker)
- [ ] Fase 5: minérios de poder
- [ ] Fase 6: baús e construção
- [ ] Fase 7: mobs
- [ ] Fase 8: monstros estilo RPG
- [ ] Fase 9: armas, armaduras, minérios e forja
- [ ] Fase 10: roupas como itens e camadas de equipamento
- [ ] Fase 11: montarias

## Voltar para uma versão anterior (Git)
- `git log --oneline`: lista as versões salvas
- `git restore .`: desfaz o que mudou desde o último commit
- `git revert <código>`: cria uma versão nova que desfaz um commit específico
