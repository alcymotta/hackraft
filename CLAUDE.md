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
`export class Jogador` com `constructor({ camera, scene, mundo, inventario, ui, som, personagem, texturas })` (`texturas` é usado para as rachaduras):
- `posicao` (`Vector3`, nos pés), `velocidade`, `yaw`, `pitch`, `noChao`, `naAgua`, `modoCamera` (`'primeira'` ou `'terceira'`)
- `atualizar(dt)`
- `teletransportar(x, y, z)`
- `serializar()` → `{ pos: [x, y, z], yaw, pitch }`; `carregar(dados)`
- Trata WASD, espaço (pular/nadar), Shift (correr), V ou F5 (câmera; em notebooks o F5 pode ser o "Atualizar" do sistema, que não dá para bloquear) e os botões do mouse. Só age quando `ui.mouseTravado && !ui.menuAberto`.

### save.js
`salvarJogo(estado)`, `carregarJogo()` → estado ou `null`, `apagarJogo()`. Chave: `CONFIG.CHAVE_SAVE`.
Estado: `{ versao: 1, semente, modificacoes, jogador, inventario, hora }`

### main.js
Cria o renderer (canvas `#tela`, sem antialias, pixelRatio ≤ 2), a cena e a câmera, e monta todos os módulos. Roda o loop (dt limitado a 0.05 s), salva sozinho e expõe `window.jogo = { mundo, ceu, jogador, inventario, ui, som, salvar }` para depuração e para os comandos do chat.
Na Fase 2, o fluxo passou a ser: texturas → UI → tela inicial → (Criar sala | Entrar com código) → só então cria Mundo/Céu/Jogador. No modo cliente, o mundo vem do anfitrião e **nada é salvo** no navegador do cliente (para não apagar o mundo dele).

### network.js (Fase 2)
PeerJS 1.5.5 vem por `<script>` no index.html (UMD), então use `window.Peer`. Código da sala: 5 letras/números sem caracteres confusos (sem 0/O/1/I/L). O id no PeerJS é `'hackraft-' + codigo`.
`export class Rede` com `constructor({ apelido, cores })` (`cores` é opcional e vai na mensagem `ola`). Também exporta `normalizarCodigo(texto)`. O protocolo completo (ola, bemvindo, mods, recusado, entrou, saiu, pos, bloco, hora, meuEstado, tchau) está documentado no cabeçalho do network.js.
- `modo`: `'sozinho' | 'anfitriao' | 'cliente'`; `codigo`; `meuId`
- `async criarSala()` → código. Se o PeerJS falhar (sem internet), rejeita, e o main segue no modo `'sozinho'`.
- `async entrarNaSala(codigo)` → `{ apelido, semente, modificacoes, hora, meuEstado, posAnfitriao: [x, y, z], jogadores }`. O `apelido` é o final, que pode virar "Pai 2" se o nome já existir na sala. `meuEstado` é `{ pos, yaw, pitch, inventario }` ou null. Rejeita com uma mensagem em português se não achar a sala (tempo limite de ~10 s).
- `ligar({ mundo, ceu, jogador, inventario, remotos, ui })`: começa a sincronizar, depois que o mundo existe
- `atualizar(dt)`: a cada quadro (envia a posição ~15×/s, o horário a cada 5 s etc.)
- `listaJogadores()` → `[{ id, apelido, anfitriao }]` (inclui você); `quantidadeJogadores` (getter)
- Anfitrião: `carregarDadosJogadores(obj)` / `exportarDadosJogadores()`: posição e inventário de cada visitante, por apelido, salvos no mundo do anfitrião
- `aoDesconectar(fn)`: o cliente perdeu o anfitrião
- `encerrar()`
- Regras: o anfitrião é a autoridade. Os blocos alterados vão por `mundo.aoAlterarBloco` (só envia quando `origem === 'local'`); a alteração recebida é aplicada com `definirBloco(..., 'rede')`, o anfitrião repassa para os outros, e o cliente aplica a própria mudança na hora (otimista). O horário vem do anfitrião. A lista de modificações pode ser grande: use a serialização padrão do PeerJS (binary, que divide mensagens grandes) ou mande em lotes.

### jogadores_remotos.js (Fase 2)
`export class JogadoresRemotos` com `constructor(scene)`:
- `adicionar(id, apelido, cores)`, `remover(id)`, `limpar()`, `definirAparencia(id, aparenciaCompleta)` (`{ cores, roupa, armadura, mao, acessorio }`, repassa para `personagem.definirAparencia`; se o jogador ainda não existe, guarda e aplica no `adicionar`)
- `receberEstado(id, { x, y, z, yaw, pitch, noAr, quebrando })`
- `atualizar(dt)`: move suavemente até o último estado recebido (interpolação), anima com `Personagem.animar` e mantém o nome acima da cabeça
- `posicaoDe(id)` → `Vector3` ou null (para o /tp da Fase 4); `apelidoDe(id)`

### character.js (Fase 2)
- `export function coresPorApelido(apelido)` → objeto `cores` com a camisa (e a calça) escolhidas de uma paleta a partir de um hash do apelido, para cada jogador ter uma cor diferente
- `animarGolpe()`: balanço curto do braço direito (ao quebrar ou colocar bloco)

### ui.js (Fase 2)
- `mostrarTelaInicial({ aoCriarSala(apelido), aoEntrar(apelido, codigo), aoNovoMundo })` substitui `aoJogar`. Os callbacks devolvem uma Promise: enquanto ela não resolve, a tela mostra "Conectando..." e desativa os botões. Se resolver, esconde a tela e trava o mouse (se o navegador recusar, aparece a pausa com "Continuar"). Se rejeitar, mostra o erro na tela inicial e reativa os botões.
- O apelido fica salvo no localStorage (`'hackraft-apelido'`), com no máximo 16 caracteres. Vazio vira "Jogador".
- `mostrarSala(codigo)`: um selo "Sala: ABCDE" no canto superior direito e, na pausa, o código em destaque, com o texto "Passe este código para o outro jogador"
- `atualizarJogadores(lista)`: na pausa, mostra a lista de quem está online; no selo, a quantidade

### Save (Fase 2)
`versao: 2` acrescenta `jogadores: { [apelido]: { pos, yaw, pitch, inventario } }`. `carregarJogo` aceita a versão 1 (sem `jogadores`).

### Fase 3: personagem, roupas e equipamento
Decisão: **E** abre inventário + equipamento (como pede a Fase 10). **C** abre a aparência (cores da skin base), que também tem um botão "Personagem" na tela inicial.

**blocks.js:** `B.PRESENTE = 9` ("Presente misterioso"): texturas `presente_topo` e `presente_lado`, dureza 0.3, som 'madeira', `item: null`, `sorteio: 'presente'`. Ao quebrar, o jogador ganha 1 item aleatório de `TABELA_PRESENTE` (o sorteio pode usar Math.random, porque não é geração de mundo).

**items.js:** tipos `'bloco' | 'roupa' | 'armadura' | 'arma' | 'acessorio'`. Todo item tem `nome`, `rotulo`, `tipo`, `pilha` (1 para equipáveis) e `descricao` (texto curto). Por tipo:
- roupa: `visual` ('ninja', 'cavaleiro', 'mago', 'astronauta', 'pirata', 'hacker') e `bonus: { velocidade?, defesa?, silencioso? }` (ninja: velocidade 0.1 e silencioso; cavaleiro: defesa 2)
- armadura: `parte` ('capacete', 'peitoral', 'calca', 'botas'), `material` ('couro', 'ferro'; a Fase 9 traz mais) e `defesa`
- arma: `visual` ('espada_madeira') e `dano`
- acessorio: `visual` ('capa_vermelha', 'capa_azul')

Itens da Fase 3: `roupa_ninja`, `roupa_cavaleiro`, `roupa_mago`, `roupa_astronauta`, `roupa_pirata`, `roupa_hacker` (fora do presente; é do /hacker, na Fase 4), `capacete_couro`, `peitoral_couro`, `calca_couro`, `botas_couro`, os mesmos de ferro, `espada_madeira`, `capa_vermelha` e `capa_azul`.
Exporta também: `SLOTS_EQUIPAMENTO = ['roupa', 'capacete', 'peitoral', 'calca', 'botas', 'mao', 'acessorio']`, `slotDoItem(nome)` → slot ou null, e `TABELA_PRESENTE` (lista de nomes).

**equipamento.js:** `export class Equipamento`:
- `espacos`: `{ roupa, capacete, peitoral, calca, botas, mao, acessorio }`, cada um com o nome do item ou null
- `esconderArmadura`, `esconderCapacete` (booleans)
- `podeEquipar(slot, item)`, `equipar(slot, item)` → item que saiu ou null, `desequipar(slot)` → item ou null
- `bonus()` → `{ velocidade, defesa, silencioso }` (soma de roupa e armadura; a defesa conta mesmo com a armadura escondida)
- `aparencia()` → `{ roupa: visual|null, armadura: { capacete, peitoral, calca, botas } (material ou null, já respeitando os "esconder"), mao: visual|null, acessorio: visual|null }`
- `aoMudar(fn)`, `notificar()`, `serializar()`, `carregar(dados)`

**textures.js:** `iconeItem(nome)` → dataURL 48×48 para QUALQUER item. Blocos usam `iconeBloco`. Roupa vira uma camiseta pixelada com as cores da roupa, armadura vira a peça na cor do material, e há ícones de espada e de capa. A UI e os itens no chão usam só o `iconeItem`.

**character.js:**
- `definirAparencia({ cores, roupa, armadura, mao, acessorio })`, no formato de `Equipamento.aparencia()` + `cores` da skin base. Camadas:
  1. skin base;
  2. roupa, desenhada por cima na skin e na 2ª camada (caixas 0.5 px maiores, como o "chapéu/jaqueta" do Minecraft), com peças extras em 3D quando fizer sentido (chapéu de mago, chapéu de pirata, capacete de vidro do astronauta, faixa do ninja);
  3. armadura, com caixas 1 px maiores e textura do material por parte.

  Capa atrás das costas, balançando com o movimento. Item da mão no braço direito.
- `get aparenciaAtual`. Exporta `VISUAIS_ROUPA` e `MATERIAIS_ARMADURA`.
- A roupa hacker tem detalhes verde-neon que brilham (emissive).
- `definirCores(cores)` continua funcionando (mantém o resto da aparência).

**Aparência base:** `{ pele, cabelo, olhos, camisa, calca, sapato }`. É de cada navegador (localStorage `'hackraft-aparencia'`), começa em `coresPorApelido(apelido)` e é editada na tela C.

**ui.js:**
- `new InterfaceJogo({ inventario, equipamento, texturas, canvas })`
- E: painel de equipamento (7 espaços em volta de um preview do boneco girando, num 2º WebGLRenderer só para o preview, que só renderiza com a tela aberta; arrastar gira), com caixas "Esconder armadura" e "Esconder capacete", + a grade do inventário. A pilha na mão é solta num espaço de equipamento só se o item couber nele.
- `definirAparenciaPreview(aparenciaCompleta)`
- C (e o botão "Personagem" da tela inicial): tela de aparência com paletas (pele 8 tons, cabelo 8, olhos 6, camisa 8, calça 6) e preview. Salvar chama `aoMudarAparenciaBase(cores)`.
- Largar item: G solta 1 do item selecionado (Shift+G, a pilha toda); arrastar a pilha da mão para fora do painel e clicar também solta. A UI tira do inventário e chama `aoSoltarItem(item, qtd)`.
- Callbacks configurados com `ui.definirCallbacks({ aoSoltarItem, aoMudarAparenciaBase })`.
- Dicas ao passar o mouse: rótulo, descrição, defesa/dano/bônus.

**itens_chao.js:** `export class ItensNoChao({ scene, mundo, texturas })`:
- Itens no chão: sprite com `iconeItem`, ~0.4 de tamanho, flutuando e girando, com gravidade e colisão simples com os blocos. Passar perto (1.3 bloco) pega; o item é puxado de leve na direção do jogador.
- `criar(id, item, qtd, x, y, z, vx, vy, vz)`, `remover(id)`, `atualizar(dt)`, `exportar()` / `carregar(lista)`
- Somem depois de 10 minutos.

**Rede (Fase 3):**
- Mensagens novas: `soltar` (cliente→anfitrião), `itemNovo` e `itemRemovido` (anfitrião→todos), `pegar` (cliente→anfitrião), `ganhou` (anfitrião→cliente que pegou) e `aparencia` (cada um envia a sua; o anfitrião repassa).
- O `bemvindo` leva os itens no chão e as aparências dos jogadores. O `meuEstado` leva o `equipamento`.
- O anfitrião é a autoridade: só ele cria e remove itens no chão.

**Save (versão 3):** acrescenta `equipamento` (do anfitrião), `itensChao` e `jogadores[apelido].equipamento`. `carregarJogo` aceita as versões 1 a 3.

**Jogador:**
- O construtor passa a ser `constructor({ camera, scene, mundo, inventario, ui, som, personagem, texturas, equipamento, soltarItem })`, com `soltarItem(item, qtd, x, y, z, vx, vy, vz)` → bool.
- `soltarNaFrente(item, qtd)` e `bonus` (atualizado em `equipamento.aoMudar`).
- A velocidade é multiplicada por `1 + bonus.velocidade`. Com `silencioso`, só 1 em cada 3 passos faz som.

**Como ficou a implementação (Fase 3):**
- `itens_chao.js` também exporta `quantoCabe(inventario, item)`. A classe tem ainda:
  - `criar(..., soltoPorMim)`, `novoId()`, `obter(id)`, `quantidade`
  - `definirColetor({ posicao, podePegar, aoPegar })`, `definirLuz(v)`, `limpar()`, `destruir()`
  - `autoridade`, `aoSumir(id)`
- Física dos itens: roda em passos fixos de 1/60 s, para o item parar no mesmo lugar em todos os computadores. O item que você soltou não é puxado para você e só pode ser pego depois de 2 s. Limite de 256 itens no chão.
- `network.js` (protocolo versão 2):
  - Métodos novos: `soltarItem(...)`, `pegarItem(entrada)`, `enviarAparencia(ap)`.
  - `ligar({ ..., equipamento, itensChao, aoPegarItem })`.
  - Mensagens: `soltar` e `pegar` (cliente→anfitrião), `aparencia` (nos dois sentidos), `itemNovo`/`itemRemovido` (anfitrião→todos) e `ganhou` (anfitrião→quem pegou).
  - O anfitrião entrega o que cabe no inventário; o resto continua no chão.
- `world.js`: a etapa `colocarTesouros` põe os presentes por hash da semente (`CONFIG.CHANCE_PRESENTE`). `definirBloco` em chunk não carregado agora gera os dados antes.

### Fase 4: chat, comandos e /hacker
**chat.js:** `export class Chat` com `constructor({ ui })`. Cria o próprio DOM (caixa de mensagens no canto inferior esquerdo + campo de texto), com os estilos em style.css.
- T abre o chat e / abre já com a barra digitada. Só funciona no jogo (fora de menus e de campos de texto).
- Abrir o chat NÃO solta o pointer lock: o foco vai para o campo, e o jogador para porque `ui.menuAberto` passa a incluir o chat (via `ui.adicionarMenuExtra(() => chat.aberto)`).
- Enter envia e fecha. Esc fecha (o navegador solta o mouse e aparece a pausa, o que é normal). Seta para cima/baixo navega no histórico.
- Mensagens somem depois de 10 s com o chat fechado. Com o chat aberto, aparecem as últimas 50.
- `abrir(texto = '')`, `fechar()`, `get aberto`
- `adicionarMensagem({ de, texto, tipo })`, tipo `'jogador' | 'sistema' | 'erro' | 'sucesso'`. Sempre via `textContent`.
- `registrarComando(nome, { uso, ajuda, executar(args) })`; texto que começa com / chama o comando (sem diferenciar maiúsculas). Comando desconhecido mostra erro e sugere /ajuda.
- `aoEnviarMensagem(fn)`: mensagens normais (sem /) vão para `fn(texto)`, e o main manda pela rede.
- `definirModoHacker(bool)`: com ele ligado, a fonte fica de terminal verde.

**comandos.js:** `export function registrarComandos(chat, ctx)`, onde ctx = `{ jogador, ceu, rede, remotos, inventario, equipamento, hacker, mundo, mudarHora(segundos), obterCasa(), definirCasa(pos) }`. Comandos:
- `/ajuda [comando]`
- `/dia` (hora 10 s) e `/noite` (hora `DIA_SEGUNDOS + 10`), via `ctx.mudarHora`
- `/voar`: liga/desliga `jogador.voando`
- `/tp <jogador>`: busca o apelido sem diferenciar maiúsculas e aceita só o começo do nome
- `/casa` e `/setcasa`
- `/dar <item> [qtd]`: aceita o nome (`roupa_ninja`) ou o rótulo sem acento ("espada de madeira"); qtd de 1 a 640, padrão 1; o que não couber vai para o chão
- `/hacker`: liga/desliga o modo hacker

**hacker.js:** `export class ModoHacker` com `constructor({ equipamento, mundo, scene, camera, chat, som, ui })`:
- `ativo`, `alternar()`, `ligar()`, `desligar()`, `atualizar(dt, posJogador)`
- Ligar faz `equipamento.definirRoupaForcada('hacker')`: a roupa equipada continua guardada e volta ao desligar. Também chama `chat.definirModoHacker(true)` e `som.glitch()`.
- Abertura: 2–3 "interferências" suaves em ~1.2 s (faixas horizontais deslocadas e leve separação de cor, SEM flash forte nem rápido: no máximo 3 piscadas por segundo e opacidade baixa) → a tela escurece → "ACESSO CONCEDIDO" digitado letra por letra em verde, com cursor piscando → some com fade.
- Ambiente enquanto estiver ligado:
  - tom verde leve;
  - vinheta;
  - scanlines sutis;
  - letras verdes estilo Matrix descendo nas laterais e bem fracas ao fundo, num canvas 2D com máscara radial que deixa o centro limpo, a ~20 fps;
  - tudo com `pointer-events: none`, criando o próprio DOM e o próprio CSS (injete um `<style>`).
- Raio-X por 30 s a cada ativação: a cada 1 s, procura num raio de 20 blocos os blocos com `xray: true` em BLOCOS (por enquanto, o presente; os minérios de poder da Fase 5 também vão marcar `xray: true`). Mostra cada um com um contorno brilhante (InstancedMesh, aditivo, `depthTest: false`, na cor `BLOCOS[id].corXray` ou verde) e um contador "RAIO-X 30s" no HUD.
- O estado não é salvo (ao recarregar, volta desligado).

**equipamento.js:** `definirRoupaForcada(visual | null)`. Com ela definida, `aparencia().roupa` devolve esse visual. Não vai para o save.

**audio.js:**
- `som.glitch()`
- Música gerada pelo jogo: `som.musica.iniciar()`, `som.musica.definirClima('dia' | 'noite')` (troca suave), `som.musica.alternar()`, `som.musica.ligada`, `som.musica.definirVolume(v)`, `som.musica.volume`. As preferências ficam em `'hackraft-som'`.
- Dia: calma (escala pentatônica maior, pads suaves, arpejo lento). Noite: mais tensa (menor, drone grave, notas esparsas).

**ui.js:**
- `adicionarMenuExtra(fn)`: `menuAberto` também fica true quando alguma função registrada devolver true.
- Na pausa: botão "Música: ligada/desligada" + controle de volume da música.
- Corrigir o loop duplo do preview: guarde o id do requestAnimationFrame e cancele em `parar()`.

**player.js:** `voando` (boolean). Voando: sem gravidade, Espaço sobe, Shift desce, velocidade `CONFIG.VEL_VOAR`, sem dano de queda (o dano vem na Fase 7).

**Rede (protocolo versão 3):**
- `chat`: cliente→anfitrião `{ texto }`; anfitrião→todos `{ de, apelido, texto }`. Máximo de 200 caracteres.
- `pedirHora`: cliente→anfitrião `{ hora }`. O anfitrião aplica e manda `hora` para todos na hora, com o aviso "<apelido> mudou para dia/noite".
- `meuEstado` e `jogadores[apelido]` ganham `casa: [x, y, z]`. O save do anfitrião guarda a casa dele.
- Métodos: `rede.enviarChat(texto)`, `rede.aoChat(fn)`, `rede.pedirHora(s)`.

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
- [x] Fase 1: mundo e movimento
- [x] Fase 2: multiplayer
- [x] Fase 3: personagem e roupinhas
- [ ] Fase 4: chat e comandos (+ /hacker)
- [ ] Fase 5: minérios de poder
- [ ] Fase 6: baús e construção
- [ ] Fase 7: mobs
- [ ] Fase 8: monstros estilo RPG
- [ ] Fase 9: armas, armaduras, minérios e forja
- [ ] Fase 10: roupas como itens e camadas de equipamento
- [ ] Fase 11: montarias

## Pendências técnicas
- Fase 4 (comandos que mudam muitos blocos): criar uma mensagem de rede em lote e um `definirBlocos(lista)` que remonte cada chunk uma vez só.
- Com a aba do anfitrião escondida, o loop do jogo dele para, e o horário dos clientes para junto.

## Voltar para uma versão anterior (Git)
- `git log --oneline`: lista as versões salvas
- `git restore .`: desfaz o que mudou desde o último commit
- `git revert <código>`: cria uma versão nova que desfaz um commit específico
