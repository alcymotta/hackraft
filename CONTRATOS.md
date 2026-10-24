# Hackraft: contratos entre módulos

Este arquivo é a "combinação" entre os módulos: nomes de classes, métodos, mensagens de rede e formatos do save. Quem escreve um módulo segue exatamente estes nomes. Se precisar mudar algo, atualize aqui também. As seções estão organizadas por fase; leia a do módulo em que vai trabalhar e as das fases mais recentes que mexeram nele.

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
- Como ficou:
  - `pedirHora(s)` serve a todos os modos: o anfitrião ou o modo sozinho aplicam direto e avisam. `hora` ganhou o campo `por` (apelido); quando vem, todos aplicam na hora.
  - `rede.aoAviso(fn)` recebe os avisos (entrou, saiu, mudou a hora...), que o main manda para o chat.
  - `rede.casa` (`[x, y, z]` ou null) e `rede.definirCasa(pos)`; `ctx.obterCasa()` devolve um array.
  - O anfitrião ignora chat repetido em menos de 150 ms (`CONFIG.CHAT_INTERVALO_MIN_MS`).
  - Save versão 4. O chat tem `enviarTexto(texto)`, útil para testes.

### Fase 5: minérios de poder, vida e partículas
**Blocos novos:** ids 10 a 17 para os minérios de cristal (`MINERIO_AZUL`, `MINERIO_VERMELHO`, `MINERIO_DOURADO`, `MINERIO_VERDE`, `MINERIO_ROXO`, `MINERIO_FOGO`, `MINERIO_RAIO`, `MINERIO_GELO`) e id 18 para o `GELO`.
- Os minérios têm pedra com cristais coloridos (helper `minerio()`), dureza 2, som 'pedra', `xray: true`, `corXray` na cor do cristal e `brilho: true`.
- Cada minério solta o seu item (`item: 'cristal_azul'` etc.).
- O gelo é azul-claro translúcido, opaco para a malha (simples), dureza 0.5 e som 'pedra'.
- Campo novo em blocks.js: `brilho` (padrão false). A malha passa esse valor para o shader, que faz o bloco brilhar pulsando, visível até no escuro.

**Itens novos:** tipo `'poder'` (pilha 16): `cristal_azul` (supervelocidade), `cristal_vermelho` (superpulo), `cristal_dourado` (voar), `cristal_verde` (regeneração), `cristal_roxo` (soco forte), `cristal_fogo`, `cristal_raio`, `cristal_gelo`. Campos: `poder` (id do poder), `duracao` (30), `cor`, `ataque` (true para fogo, raio e gelo). O `iconeItem` mostra uma gema facetada na cor do cristal.

**world.js:** a etapa "minérios" (antes das árvores) usa veios de 1 a 4 blocos de cristal, só dentro de pedra, entre y=4 e y=28 (mais raros quanto mais alto), escolhidos por hash da semente. Média alvo: ~1 a 2 cristais por chunk, com as 8 cores distribuídas. Deixe a etapa pronta para a Fase 9 acrescentar cobre, ferro, prata, ouro, diamante e dracônio.

**particulas.js:** `export class Particulas({ scene })`:
- `emitir({ x, y, z, qtd, cor | cores[], velocidade, espalhar, gravidade, vida, tamanho, aditivo })`, `explosaoBloco(x, y, z, idBloco, texturas)` (pedacinhos coloridos com as cores da textura do bloco) e `atualizar(dt)`
- Usa um pool fixo (ex.: 2000 partículas) num `THREE.Points` ou `InstancedMesh`, sem alocar por quadro.
- Quebrar bloco solta pedacinhos, os minérios de cristal soltam brilhinhos de vez em quando, e há efeitos para fogo, raio e gelo.

**Vida (player.js + ui.js):**
- `jogador.vida` (0 a `CONFIG.VIDA_MAX` = 20, ou seja, 10 corações), `machucar(qtd, causa)`, `curar(qtd)` e `aoMorrer(fn)`.
- Queda: dano = blocos caídos − 3 (não vale voando nem caindo na água).
- Ao machucar: tela levemente vermelha, empurrãozinho e som. Morte: tela "Você desmaiou!" com o botão "Voltar para casa", que leva para a casa com a vida cheia. **Os itens não se perdem.**
- `ui.atualizarVida(vida, max)`: corações acima da hotbar, com meio coração.
- A vida é salva (`jogador.serializar` passa a incluir `vida`).

**powers.js:** `export class Poderes({ jogador, mundo, scene, camera, particulas, som, ui, inventario, rede })`:
- `usar(nomeItem)` → bool: consome 1 cristal e ativa o poder por 30 s. Usar o mesmo de novo soma tempo, até no máximo 90 s.
- `ativos` (Map poder → segundos restantes), `atualizar(dt)` e `modificadores()` → `{ velocidade, pulo, voar, regeneracao, quebraInstantanea, ataque: 'fogo' | 'raio' | 'gelo' | null }`
- HUD próprio: ícones com contador no canto superior direito, abaixo do selo da sala.
- Efeitos:
  - azul: velocidade × 2;
  - vermelho: pulo × 1.8 e sem dano de queda;
  - dourado: voa (igual ao /voar, mas só pelo tempo do poder);
  - verde: +1 de vida a cada 1.5 s;
  - roxo: quebra qualquer bloco quebrável na hora.
- Ataques (enquanto ativos, o botão esquerdo ATIRA em vez de quebrar; intervalo de ~0.4 s):
  - **fogo:** bola de fogo que voa reto (com partículas) até 30 blocos. Ao bater num bloco de madeira, tronco ou folhas, queima um raio de 1 em volta (vira ar, só esses blocos). Ao bater num alvo, dá dano 6 + fogo.
  - **raio:** acerta na hora o alvo mais próximo da mira (até 25 blocos, num cone de ~20°) e salta para até 2 alvos a até 6 blocos dele. Sem alvo, cai no bloco mirado. Linha em zigue-zague branca/amarela por 0.2 s, com partículas. Dano 8.
  - **gelo:** rajada (projétil azul-claro). Na água, congela um raio de 2 em volta (vira `GELO`). Num alvo, dano 3 + lento/congelado por 4 s.
- **Alvos:** registro genérico `poderes.registrarAlvos(fnListar)`, onde `fnListar()` devolve `[{ id, posicao, raio, receberDano(qtd, tipo, efeito) }]`. Na Fase 5 a lista é vazia; a Fase 7 registra os mobs.
- Uso: Q usa o cristal selecionado na hotbar, e duplo clique num cristal na tela E também usa (a UI chama `aoUsarItem(nome)`). A UI trata o Q e o duplo clique e chama o callback `aoUsarItem(nome)`, registrado com `ui.definirCallbacks({ ..., aoUsarItem })`. Se `poderes.usar(nome)` devolver true, quem consome o cristal do inventário é o `Poderes.usar`.
- O `Poderes` também recebe `remotos` (para as auras) e tem:
  - `atirar(origem, direcao)` → bool (respeita o intervalo; o player chama no lugar de quebrar quando `modificadores().ataque` existe);
  - `receberEfeitoRemoto(efeito)` (só desenha) e `definirPoderesRemotos(id, lista)` (auras);
  - `aoMudarAtivos(fn)` (o main manda a lista pela rede).

**Rede (protocolo versão 4):**
- `efeito` (todos → anfitrião → outros) `{ tipo: 'fogo' | 'raio' | 'gelo' | 'poder', origem, direcao, alvo?, cor? }`: cada computador desenha o efeito localmente.
- Blocos queimados ou congelados vão pelo caminho normal do `definirBloco`.
- Outros jogadores veem uma aura de partículas na cor do poder ativo (mensagem `poderes` com a lista dos ativos, enviada quando muda).

**Como ficou a Fase 5:**
- `world.js` exporta `TABELA_MINERIOS`: cada linha tem bloco, faixa de y, chance, tamanho do veio, `fundo` e `dentro`. Para a Fase 9, é só acrescentar linhas. Cada linha tem o próprio sorteador, então novas linhas não mudam os cristais atuais.
- `mundo.blocosProximos(pos, raio, filtroFn(id), max = 256, saida?)` → `[[x, y, z, id], ...]`, do chunk mais perto ao mais longe. A lista é REAPROVEITADA a cada chamada; passe `saida` se precisar de duas listas ao mesmo tempo.
- `mundo.definirTempo(t)`: uniform `uTempo` (o main chama a cada quadro). Atributo `aBrilho` da malha: 0 = não brilha; 1 a 255 = brilha, e o valor é a fase da pulsação, por posição. Chaves opcionais no config: `PULSO_BASE`, `PULSO_ONDA`, `PULSO_VELOCIDADE`, `PULSO_LUZ_PEDRA`.
- `Particulas({ scene, mundo })`: as cores aceitam texto CSS, número ou THREE.Color. Atalhos: `fagulhas`, `fumaca`, `neve`, `brilhoCristal`.
- `jogador`:
  - `vida`, `morto`, `machucar(qtd, causa)` (causa `{ direcao }` dá empurrão), `curar(qtd)`, `aoMorrer(fn)`, `renascer()`;
  - setters `poderes` e `particulas`;
  - o tiro sai dos olhos do jogador.
- `som`: `poder(id)`, `tiro(tipo)`, `dano()`.
- `ui`: `atualizarVida`, `sinalizarDano`, `mostrarMorte({ aoRenascer })`, `morteAberta`; Q e o duplo clique chamam `aoUsarItem`.
- Rede (protocolo versão 4):
  - `efeito` vai aninhado em `{ tipo: 'efeito', de, efeito: {...} }`;
  - `poderes` `{ lista }`;
  - `rede.enviarEfeito`, `rede.enviarPoderes`;
  - `Poderes.receberEfeitoRemoto` aceita pontos como `[x, y, z]` ou `{x, y, z}`.
- Save versão 5 (vida dentro de `jogador`).

