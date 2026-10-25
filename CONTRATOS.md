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


### Fase 6: baús, construção, luz de tochas e crafting
**Blocos novos (blocks.js):** 19 `TABUAS`, 20 `VIDRO`, 21 `TIJOLOS`, 22 `PORTA`, 23 `TOCHA`, 24 `BAU`, 25 `MINERIO_CARVAO`.
Campos novos em `registrar`:
- `modelo`: 'cubo' (padrão), 'porta' ou 'tocha'
- `luz`: luz própria de 0 a 15 (tocha 14; minérios de cristal 5)
- `juntarIguais`: não desenha a face entre dois blocos iguais (vidro)
- `interativo`: o botão direito usa o bloco em vez de colocar (baú, porta)
Detalhes:
- `VIDRO`: opaco false, recorte true (moldura clara e centro transparente com reflexos), `juntarIguais: true`, dureza 0.3, som 'vidro'.
- `PORTA`: modelo 'porta', opaco false, interativo, dureza 1, som 'madeira'. Ocupa 2 blocos, os dois com o mesmo id; quem diferencia é o estado.
- `TOCHA`: modelo 'tocha', solido false, opaco false, `luz: 14`, dureza 0, som 'madeira'.
- `BAU`: cubo opaco com frente própria, interativo, dureza 1, som 'madeira'.
- `MINERIO_CARVAO`: solta `carvao`.

**Estado do bloco** (um byte por posição, guardado à parte):
- porta: bits 0–1 = direção (0 = -Z, 1 = +X, 2 = +Z, 3 = -X), bit 2 = aberta, bit 3 = metade de cima
- tocha: 0 = no chão; 1 a 4 = na parede, encostada no lado -Z, +X, +Z ou -X
- baú: bits 0–1 = direção da frente

**Itens novos (items.js):** blocos `tabuas`, `vidro`, `tijolos`, `porta` (coloca 2 blocos), `tocha`, `bau`; tipo novo `'material'`: `graveto`, `carvao`.

**world.js / chunk.js:**
- `definirBloco(x, y, z, id, origem = 'local', estado = 0)`, `obterEstado(x, y, z)` → 0..255
- `definirBlocos(lista, origem = 'local')`: lista de `[x, y, z, id, estado?]`; remonta cada chunk uma vez só e chama os ouvintes uma vez, com `{ lista, origem }` (campo `lote: true`)
- `modificacoes` / `exportarModificacoes()`: `[x, y, z, id, estado]` (aceita listas antigas de 4 posições)
- Malha:
  - 'porta': caixa fina (3/16) na posição da direção e aberta/fechada; textura de cima/baixo pelo bit 3
  - 'tocha': palito de 2×10/16 com a ponta acesa (brilho), inclinado na parede
  - o resto continua cubo
- Luz de bloco: propagação em largura (BFS) a partir de blocos com `luz`, perdendo 1 por bloco, atravessando blocos não opacos e as bordas dos chunks. Atributo `aLuzBloco` no shader, cor quente; luz final = max(céu × luzDoDia, bloco). Colocar ou tirar uma tocha atualiza a luz em menos de ~5 ms.
- `luzEm(x, y, z)` → 0..1 (combina céu × dia e bloco) para personagens e itens.
- `caixaColisao(x, y, z)` → null (não colide) ou `[x0, y0, z0, x1, y1, z1]` dentro do bloco (cubo = `[0,0,0,1,1,1]`; porta fechada = fina; aberta = fina no lado da dobradiça; tocha = null)
- `caixaSelecao(x, y, z)`: a caixa do contorno e do raycast. O `raycast` acerta as caixas reais dos modelos.
- Etapa de minérios: o carvão é comum (y de 5 a 70, veios de 3 a 8 blocos).

**receitas.js:** `RECEITAS = [{ id, resultado: { item, qtd }, ingredientes: [{ item, qtd }] }]`, `podeCriar(inventario, receita)` → quantas vezes, `criar(inventario, receita, vezes = 1)` → `{ criados, sobra }` (a sobra vai para o chão por quem chamou). Receitas:
- tronco 1 → tábuas 4
- tábuas 2 → gravetos 4
- graveto 1 + carvão 1 → tochas 4
- tábuas 8 → baú
- tábuas 6 → porta
- areia 1 → vidro 1
- pedra 2 + terra 2 → tijolos 4

**ui.js:**
- Coluna "Criar" na tela E: a lista de receitas, com o ícone do resultado, o nome e os ingredientes (ícone + "2/8", em vermelho quando falta). Clique cria 1 e Shift+clique cria o máximo. A coluna atualiza quando o inventário muda.
- `abrirBau({ titulo, espacos, aoMudarEspaco(i, valor), aoFechar })`: tela com os 27 espaços do baú + o inventário, com a mesma mecânica de arrastar; Shift+clique move entre os dois. Conta como menu; E fecha.
- `atualizarBau(espacos)`, `bauAberto`

**baus.js:** `export class Baus({ mundo, rede, itensChao })`:
- `abrir(x, y, z)` → Promise de `espacos[27]`; `definirEspaco(x, y, z, i, valor)` (valor `{ item, qtd }` ou null); `aoMudar(fn(x, y, z, i, valor))`; `fechar(x, y, z)`
- No anfitrião/sozinho, um ouvinte de `mundo.aoAlterarBloco` larga o conteúdo de um baú quebrado (de qualquer jogador) como itens no chão e apaga o registro.
- `exportar()` / `carregar(obj)` (`"x,y,z"` → espacos)

**Rede (protocolo versão 5):**
- `bloco` ganha o campo `e` (estado)
- `blocos` (lote) `{ lista }` com até 512 entradas
- `bauAbrir` `{ x, y, z }` (cliente→anfitrião) → `bauConteudo` `{ x, y, z, espacos }`
- `bauEspaco` `{ x, y, z, i, item, qtd }` (nos dois sentidos; o anfitrião repassa para os outros)
- Tudo validado.

**Player:**
- Com o botão direito num bloco interativo: baú → abre a tela do baú; porta → abre/fecha as duas metades com `definirBlocos`. Segurando Shift, coloca o bloco normalmente.
- Colocar:
  - porta precisa de 2 espaços livres, direção pelo yaw;
  - tocha no chão (face de cima) ou na parede (face lateral; nunca embaixo);
  - baú virado para o jogador.
- Quebrar uma metade da porta tira as duas.
- A colisão e o raycast usam `caixaColisao` / `caixaSelecao`.
- O fogo e o gelo dos poderes passam a usar `definirBlocos`.

**Save versão 6:** `baus` + modificações com estado.
**Como ficou a Fase 6:**
- `world.js`:
  - `definirBloco` → true se mudou o id ou o estado (recusa id desconhecido ou NaN); `definirBlocos` → quantos mudaram.
  - Evento simples: `{ x, y, z, id, estado, anterior, estadoAnterior, origem }`. Lote: `{ lote: true, lista: [[x, y, z, id, estado, anterior, estadoAnterior]], origem }`, só com os que mudaram.
  - `modificacoes` continua `"x,y,z"` → id; os estados diferentes de 0 ficam em `estadosModificados`. `exportarModificacoes()` → sempre 5 números.
  - `caixaColisao` e `caixaSelecao` devolvem um array COMPARTILHADO (não altere).
  - `raycast` ganhou `estado` e `t`.
  - Extras: `luzEm`, `luzBlocoEm`, `corLuzBloco`, `direcaoDoYaw(yaw)`, `estadoTochaPelaNormal(normal)`.
  - Chaves opcionais no config: `COR_LUZ_TOCHA`, `FORCA_LUZ_TOCHA`, `CURVA_LUZ_TOCHA`.
- `chunk.js` exporta `Iluminacao` (BFS de luz de bloco, remoção com duas filas), `caixaColisaoDe`/`caixaSelecaoDe` e as tabelas `MODELO`, `TAPA` e `LUZ_PROPRIA`. Porta e tocha nunca são opacas.
- Estados (direções 0 = -Z, 1 = +X, 2 = +Z, 3 = -X):
  - porta: bits 0–1 = direção do olhar de quem colocou, 4 = aberta, 8 = metade de cima;
  - tocha: 0 = no chão, 1 a 4 = encostada no bloco em -Z/+X/+Z/-X;
  - baú: a frente aponta para a direção (o player grava olhar + 2).
- `baus.js`:
  - `Baus` tem também `obter(x, y, z)`;
  - `aoMudar` só dispara para mudanças de outros jogadores;
  - o cliente guarda só a cópia do baú aberto.
- Rede (protocolo versão 5):
  - `bloco.e`; `blocos { lista }` com até 512 entradas (uma inválida anula o lote);
  - `bauAbrir`, `bauConteudo`, `bauEspaco` (vazio = item null, qtd 0); distância máxima de 12 blocos até o baú;
  - `mods` com 5 inteiros por bloco;
  - `rede.aoBau`, `enviarBauAbrir`, `enviarBauEspaco`.
- `player.js`: recebe `baus`; `jogador.bauAberto` (`{x, y, z}` ou null); o botão direito interativo age só no clique.
- `ui.js`: `abrirBau`, `atualizarBau`, `fecharBau(travar)`, `bauAberto`; coluna Criar na tela E. `receitas.js`: `criar` → `{ criados, sobra }`.
- Save versão 6 (`baus`).
### Fase 7: mobs (animais de dia, monstros à noite), combate e comida
**mobs.js (motor de mobs; o anfitrião simula, os clientes só mostram):** `export class Mobs({ scene, mundo, ceu, rede, particulas, som, itensChao, ui, obterJogadores })`
- `obterJogadores()` → `[{ id, posicao, local, defesa }]`: o anfitrião usa para gerar mobs perto de cada jogador e escolher alvos.
- Registro de tipos: `TIPOS_MOB[tipo] = { nome, vidaMax, velocidade, dano, alcance, visao, altura, raio, hostil, diurno, sobeParede, voa, xp, drops: [{ item, min, max, chance }], comportamento }`. Fase 7: `porco`, `galinha` (pacíficos, de dia), `zumbi`, `aranha` (hostis, de noite). Pronto para a Fase 8 trazer mais (esqueleto com flechas, orcs, dragão voador, hidra).
- **Anfitrião:**
  - Gera mobs a 24–48 blocos de cada jogador, em chunks prontos: animais sobre grama, de dia (máx. ~8 por jogador); monstros à noite, em lugares escuros (`luzEm` < 0.35), até ~10 por jogador, e também em cavernas escuras.
  - Mobs a mais de 96 blocos de todos somem.
  - Ao amanhecer, os monstros na luz do sol pegam fogo (partículas) e somem em 3 s.
- **IA simples por estados:**
  - passear: animais andam e param;
  - fugir: o animal que apanha corre para longe por 4 s;
  - perseguir: o monstro vê um jogador a até `visao` blocos (ignora `/voar` alto);
  - atacar: dentro do `alcance`, com 1 s entre os ataques.
  - Movimento com gravidade e colisão de caixa com o mundo (pode reutilizar `caixaColisao`); pula degraus de 1 bloco; a aranha sobe paredes; não entra na água funda de propósito; evita cair de mais de 3 blocos ao perseguir.
- **Dano no jogador:** o anfitrião manda `dano { qtd, de: [x, y, z] }` só para o alvo. O jogador local aplica `qtd × (1 − min(0.8, defesa × 0.04))` e recebe um empurrão para longe do mob.
- **Atacar mob:**
  - o cliente manda `atacarMob { id, dano, dir }`; o anfitrião aplica se a distância for ≤ 5 (6 para poderes);
  - recuo, piscar vermelho e barra de vida acima do mob por 3 s depois de apanhar;
  - morte: o mob tomba de lado, fica vermelho e some, os drops viram itens no chão e quem matou recebe `xp` (a Fase 8 usa).
- `mobs.alvosParaPoderes()` devolve a lista para `poderes.registrarAlvos`; o `receberDano` desse alvo encaminha ao anfitrião (no cliente) ou aplica (no anfitrião). Os efeitos `queimar` (dano por 3 s) e `lento` (velocidade × 0.4 por 4 s, cor azulada) funcionam.
- `raycastMob(origem, dir, alcance)` → `{ id, t }` ou null (caixas dos mobs).
- `atualizar(dt)`; `exportar()`/`carregar()` NÃO precisam (os mobs não são salvos).
- **Rede:**
  - `mobs` (anfitrião→todos, ~10/s): estado compacto `[id, tipoIdx, x, y, z, yaw, flags (andando/atacando/apanhou/queimando/lento), vida%]` num `Float32Array`;
  - `mobNovo { id, tipo }` e `mobRemovido { id, morreu }`;
  - `atacarMob` (cliente→anfitrião), `dano` (anfitrião→alvo), `xp { qtd }` (anfitrião→quem matou).
  - Os clientes interpolam (100 ms de atraso).

**modelos_mobs.js:** `criarModeloMob(tipo)` → `{ grupo, altura, raio, animar(dt, vel, estado), piscarDano(), morrer(t0a1), definirLuz(v), dispose() }`. Bonecos de caixas com textura pixelada gerada por código, como o personagem, olhando para -Z:
- porco: rosa, focinho e rabinho;
- galinha: branca, crista vermelha, bico amarelo, asinhas que batem;
- zumbi: pele verde, camisa azul rasgada, braços esticados para frente;
- aranha: corpo escuro peludo, 8 pernas animadas, olhos vermelhos com emissive.
Barra de vida: sprite com canvas que mostra a % de vida, e `definirVida(frac)`.

**Comida e drops (items.js / blocks.js):**
- Tipo `'comida'`, com o campo `cura`: `costeleta` (porco, cura 6), `coxinha` (galinha, cura 4), `maca` (as folhas soltam com 8% de chance ao quebrar, cura 3).
- Materiais: `pena` (galinha), `carne_podre` (zumbi; comer cura 1, mas tem 50% de chance de tirar 1), `fio_seda` (aranha).
- Comer: com comida na mão, segurar o botão direito por 0.8 s (com som de mastigar) consome 1 e cura. Só funciona se a vida não estiver cheia, exceto a maçã.

**Combate do jogador:**
- O botão esquerdo com um mob na mira (mais perto que o bloco, até 4 blocos) bate no mob em vez de quebrar o bloco.
- Dano: mão 1, espada = `dano` do item na mão principal do equipamento (a espada de madeira dá 4). Pode bater de novo a cada 0.5 s.
- O braço faz `animarGolpe`.

**Sons (audio.js):** `som.mob(tipo, evento)` com evento 'idle', 'dano' ou 'morte' para cada tipo (porco: oinc; galinha: cocoricó curto; zumbi: gemido grave; aranha: chiado), `som.golpeMob()`, `som.comer()`.- Baús no multiplayer ("comparar e trocar"):
  - `bauEspaco` leva `antes` (o valor que o cliente via no espaço);
  - o anfitrião só aplica se o espaço atual for igual a `antes`; se não for, responde `bauRecusado { x, y, z, i, antes, valor, atual }`;
  - o cliente desfaz no inventário (`ui.removerItensDoJogador` / `ui.devolverAoJogador`) e corrige a tela;
  - `baus.aoRecusar(fn)` e `ui aoMudarEspaco(i, valor, antes)`, que só é chamado se o espaço mudou de fato.
### Fase 8: monstros estilo RPG, chefões, XP e níveis
**Tipos novos em `TIPOS_MOB` (mobs.js) e `MODELOS` (modelos_mobs.js):**
| tipo | vida | dano | comportamento | onde/quando | xp | drops |
|---|---|---|---|---|---|---|
| `esqueleto` | 20 | 3 (flecha) | atira flechas de 8 a 16 blocos; foge se você chega muito perto | noite e cavernas | 8 | `osso` (1–2), às vezes `flecha` |
| `aranha_gigante` | 40 | 5 | como a aranha, maior (2×), sobe parede, envenena (2 s) | noite, florestas e cavernas | 15 | `fio_seda` (2–4), `seda_rara` (10%) |
| `orc_guerreiro` | 45 | 7 | corpo a corpo forte, investida curta | noite, em grupos de 2–3 | 20 | `moeda` (2–5), `couro_orc` |
| `orc_xama` | 30 | 5 (magia) | fica longe, lança orbe roxo teleguiado de leve, às vezes cura um orc perto | acompanha orcs | 25 | `moeda` (3–6), `cristal_roxo` (15%) |
| `dragao` (chefão) | 400 | sopro de fogo 8 + garra 10 | voa em círculos, mergulha, sopra fogo em cone, pousa às vezes | Ninho do Dragão ou Lua Vermelha | 500 | `escama_dragao` (4–8), `ovo_dragao` (1), `espada_dragao` (40%) |
| `hidra` (chefão) | 500 | por cabeça | 3 cabeças: fogo (bola), gelo (rajada que deixa lento) e veneno (nuvem); cada cabeça ataca no seu ritmo | Covil da Hidra (lago escuro) ou Lua Vermelha | 600 | `escama_hidra` (4–8), `espada_hidra` (50%), `cristal_verde` (3) |

**Projéteis de mob (anfitrião):** flecha, orbe, bola de fogo, rajada de gelo e nuvem de veneno. A rede manda `projetilMob { id, tipo, origem, dir }` e `projetilFim { id, ponto }`; os clientes desenham. O dano no jogador vem pela mensagem `dano` (com `efeito: 'veneno' | 'lento' | 'fogo'`).

**Áreas especiais (world.js, determinísticas pela semente):**
- **Ninho do Dragão:** 1 por região de 12×12 chunks, num pico alto. Plataforma de pedra escura com ossos e brasas, e o dracônio aparece em volta (a Fase 9 usa).
- **Covil da Hidra:** 1 por região de 12×12 chunks, deslocado do ninho. Lago escuro com ilhota de pedra musgosa.
- `mundo.areasEspeciais(perto, raio)` → `[{ tipo: 'ninho' | 'covil', x, y, z }]`.
- O chefão aparece quando um jogador chega a menos de 40 blocos da área, uma vez por dia de jogo. Ele não aparece de novo enquanto estiver vivo.

**Lua Vermelha:** 1 a cada ~8 noites (sorteada pelo anfitrião ao anoitecer e sincronizada). A lua e o céu ficam avermelhados (`ceu.definirLuaVermelha(bool)`), aparecem mais monstros, e um chefão pode surgir perto dos jogadores (30% por noite vermelha). Aviso no chat: "🌕 A Lua Vermelha nasceu... cuidado!".

**XP e níveis (player.js / ui.js):**
- `jogador.xp` (total), `jogador.nivel`. XP para o próximo nível = `floor(40 × nivel^1.4)`.
- A cada nível: +2 de vida máxima (1 coração, até 40 = 20 corações) e +1 de força (dano extra no corpo a corpo, em `forcaExtra()`).
- Subir de nível: partículas douradas, som e mensagem "Nível 5! (+1 coração, +1 força)".
- UI: barra de XP verde fina acima da hotbar, com o número do nível no meio; os corações quebram em 2 fileiras depois de 10.
- O XP e o nível são salvos (`jogador.serializar`; os visitantes, pelo `meuEstado`).

**Efeitos no jogador:**
- veneno: 1 de dano por segundo por N s, corações esverdeados;
- lento: velocidade × 0.5, tela azulada leve;
- fogo: 1 de dano por segundo por 3 s, chamas na tela.

**UI de chefão:** barra grande no topo, com o nome ("Dragão Ancestral", "Hidra de Três Cabeças") e a vida, visível para todos que estiverem a até 64 blocos.

**Itens novos (items.js):**
- materiais: `osso`, `flecha`, `seda_rara`, `moeda` (pilha 99), `couro_orc`, `escama_dragao`, `escama_hidra`;
- `ovo_dragao` (pilha 1; a Fase 11 choca);
- armas: `espada_dragao` (dano 14; acerto põe fogo), `espada_hidra` (dano 12; acerto envenena);
- os efeitos das armas ficam no campo `efeitoArma`.

**Sons:** esqueleto (chocalhar de ossos), orc (grunhido), xamã (canto mágico curto), dragão (rugido grave + bater de asas), hidra (sibilo triplo), flecha (zunido), música de chefão (tensa, usando o `som.musica` com o clima `'chefao'`).
### Fase 9: minérios, forja, armas, armaduras e melhorias
**Blocos (blocks.js):** 26 `MINERIO_COBRE`, 27 `MINERIO_FERRO`, 28 `MINERIO_PRATA`, 29 `MINERIO_OURO`, 30 `MINERIO_DIAMANTE`, 31 `MINERIO_DRACONIO` (brilho roxo-avermelhado, `luz: 3`, `xray: true`), 32 `FORJA` (interativo; topo com bigorna, lados de fornalha acesa; dureza 2).
**Itens brutos (soltos pelos minérios):** `cobre_bruto`, `ferro_bruto`, `prata_bruta`, `ouro_bruto`, `diamante` (já é gema), `draconio_bruto`.
**Barras (fundidas na forja: 1 bruto + 1 carvão → 1 barra):** `barra_cobre`, `barra_ferro`, `barra_prata`, `barra_ouro`, `barra_draconio`.
**Materiais de equipamento (`MATERIAIS_EQUIP`):**
| material | espada (dano) | armadura (capacete/peitoral/calça/botas) | custo (espada / peça) |
|---|---|---|---|
| madeira | 4 (já existe) | — | — |
| couro | — | 1/3/2/1 (já existe) | — |
| cobre | 5 | 1/3/2/1 | 2 barras / 3–5 barras |
| ferro | 6 | 2/6/5/2 (já existe) | 2 / 3–5 |
| prata | 7 | 2/6/5/2 + 1 no peitoral | 2 / 3–5 |
| ouro | 6 | 1/4/3/1 | 2 / 3–5 |
| diamante | 9 | 3/8/6/3 | 2 diamantes / 3–5 diamantes |
| draconio | 12 | 4/9/7/4 | 2 barras de dracônio / 3–5 |
| escama_dragao | — | 4/10/8/4 | escamas de dragão (Fase 8) |
| escama_hidra | — | 4/9/8/4 + resistência a veneno | escamas de hidra (Fase 8) |

Custo das peças: capacete 5, peitoral 8, calça 7, botas 4 unidades do material (como no Minecraft). Espada: 2 do material + 1 graveto.
Nomes: `espada_<material>`, `capacete_<material>` etc. Itens existentes continuam iguais (`espada_madeira`, `*_couro`, `*_ferro`).

**Melhoria (+1 a +5) codificada no NOME do item:** `espada_ferro+2`.
- `obterItem(nome)` entende o sufixo `+N`: devolve uma definição derivada (com cache), com `base` (nome sem o sufixo), `melhoria: N`, `rotulo: "Espada de ferro +2"`, `dano: base + N×1` e `defesa: base + ceil(N/2)` por peça.
- Os itens equipáveis com sufixo continuam com `pilha: 1`. `slotDoItem` funciona com o sufixo.
- Quem valida itens (rede, save, baús) deve usar `obterItem(nome)` e não `ITENS.has(nome)`.
- Custo para melhorar até o nível N: N+1 unidades do material do item (barras ou gemas; escamas para os itens de chefão). Para `espada_madeira` e couro: tábuas/couro_orc. Não falha (feito para criança).

**Visual:**
- `Equipamento.aparencia()` devolve a armadura como `'ferro+2'` (material + sufixo) e `mao: 'espada_ferro+2'`.
- `character.js` interpreta o sufixo: cada nível dá um brilho (emissive pulsante na cor do material, mais forte a cada nível; com +5, partículas/aura leve).
- A espada é desenhada na cor do material; dracônio e as de chefão têm detalhes próprios (espada_dragao: lâmina vermelha com brilho de fogo; espada_hidra: verde-azulada).
- Materiais de armadura novos via `registrarMaterialArmadura`.

**forja.js:**
- Lógica pura (sem DOM): `RECEITAS_FUNDIR`, `receitasForjar()` (gerada a partir de `MATERIAIS_EQUIP`), `custoMelhoria(nomeItem)` → `[{ item, qtd }]` ou null, `fundir/forjar/melhorar(inventario, ...)` → `{ ok, motivo }`.
- `TelaForja`: DOM e CSS próprios, injetados como no hacker.js, e registra `ui.adicionarMenuExtra`. Tem 3 abas:
  - **Fundir:** brutos + carvão → barras;
  - **Forjar:** grade de espadas e armaduras por material, com custo e "tenho/preciso";
  - **Melhorar:** o jogador clica num equipamento do inventário ou equipado, vê "+2 → +3", o custo e o botão "Melhorar". Ao melhorar há uma animação de faíscas e martelo, com som.
- `abrir({ inventario, equipamento, particulas, som, aoFechar })`, `fechar()`, `aberta`.

**Crafting (receitas.js):** forja = pedra 8 + carvão 4 (na lista da tela E).

**Mundo:** linhas novas na `TABELA_MINERIOS`:
- cobre: y 10–70, comum
- ferro: y 5–60, comum
- prata: y 5–35, médio
- ouro: y 4–28, raro
- diamante: y 4–14, muito raro
- dracônio: y 4–20, raríssimo; na Fase 8 também nasce em volta dos Ninhos do Dragão
### Fase 10: alfaiate e bônus das roupas
**Blocos:** 33 `MESA_ALFAIATE` (interativa; topo com tesoura, fita métrica e tecido; lados de madeira com carretéis; dureza 1; som 'madeira'), 34 `FOGUEIRA` (modelo próprio simples ou cubo baixo com toras e fogo; `luz: 13`; não sólida; dureza 0.5; usada na Fase 11 para chocar o ovo).
**Itens:** `tecido` (material; crafting: fio_seda 3 → tecido 1). No crafting da tela E: mesa do alfaiate = tábuas 4 + fio_seda 2; fogueira = graveto 3 + carvão 1 + tronco 1.
**alfaiate.js** (como o forja.js: lógica pura + `TelaAlfaiate` com DOM/CSS próprios e `ui.adicionarMenuExtra`):
- Aba **Costurar**, com `RECEITAS_ALFAIATE`:
  - roupa_ninja: tecido 5 + carvão 3
  - roupa_cavaleiro: tecido 4 + barra_ferro 3 + barra_ouro 1
  - roupa_mago: tecido 6 + cristal_roxo 1 + pena 2
  - roupa_astronauta: tecido 5 + barra_prata 3 + vidro 2
  - roupa_pirata: tecido 5 + couro_orc 2 + moeda 5
  - capa_vermelha: tecido 4 + cristal_vermelho 1
  - capa_azul: tecido 4 + cristal_azul 1
- Aba **Loja** (comprar com `moeda`), com `PRECOS_LOJA`: ninja 20, cavaleiro 25, mago 30, astronauta 35, pirata 20, capas 10. Mostra "Você tem N moedas".
- A tela mostra o boneco do jogador com a roupa escolhida (prévia) antes de costurar ou comprar. Pode reutilizar a classe `Personagem` num canvas próprio.
- `abrir({ inventario, equipamento, aparenciaBase, particulas, som, posMesa, aoFechar })`, `fechar()`, `aberta`.
**Bônus das roupas (items.js + player.js):**
- ninja: velocidade 0.1 + silencioso (já existe)
- cavaleiro: defesa 2 (já existe)
- mago: `duracaoPoderes: 0.3` (os poderes duram 30% a mais)
- astronauta: `pulo: 0.3` + `quedaSegura: 5` (+5 blocos sem dano de queda)
- pirata: `nado: 0.5` (nada 50% mais rápido)
- hacker: nenhum
**De onde mais vêm as roupas:**
- orcs soltam uma roupa aleatória (3%);
- os chefões soltam 1 roupa garantida;
- os baús de tesouro dos Ninhos e Covis (Fase 8) podem ter roupa.

### Fase 11: montarias
**Itens para domar:**
- `maca_dourada`: na forja, aba "Especiais", maçã 1 + barra_ouro 4
- `osso_encantado`: na tela E, osso 1 + cristal_verde 1
- `fio_seda_magico`: na tela E, seda_rara 1 + cristal_roxo 1
- `ovo_dragao`: só cai do dragão; para chocar, coloque o ovo (vira bloco 35 `OVO_DRAGAO`, que balança) a até 3 blocos de uma FOGUEIRA por 1 dia de jogo (300 s); então nasce o filhote, já domado por quem colocou o ovo
**Outros itens:** `sela` (couro_orc 3 + barra_ferro 1), `armadura_montaria` (barra_ferro 6; ou de ouro/diamante: barra_ouro 6 / diamante 6), `apito` (barra_prata 1 + graveto 1).
**Montarias (tipos de mob novos, domáveis):**
| montaria | onde | item | velocidade | especial |
|---|---|---|---|---|
| `cavalo` | planícies, de dia (em grupo) | maçã dourada | 9 | pulo alto (2.5 blocos) |
| `lobo_gigante` | florestas, à noite | osso encantado | 11 | ataca os mobs perto de você |
| `aranha_montaria` (aranha gigante domada) | — (vem de aranha gigante enfraquecida, abaixo de 30% de vida) | fio de seda mágico | 8 | sobe paredes |
| `filhote_dragao` | do ovo | — | 10 | voa por 10 s (recarga de 20 s) |
**Domar:** com o item na mão, clique com o botão direito na criatura (que precisa estar calma, ou enfraquecida no caso da aranha gigante). Aparece uma barra de "confiança" que enche em ~5 s. Se a criatura levar dano ou você se afastar mais de 4 blocos, falha e o item é perdido. Se encher, a criatura fica domada (nome do dono acima: "Cavalo de Pai").
**Montar:** R monta/desmonta a montaria mais próxima (até 3 blocos) que seja sua. Montado: WASD move a montaria, Espaço pula (ou voa, no filhote de dragão), e a câmera fica um pouco mais alta.
- A montaria tem vida própria (barra de vida perto da hotbar quando montado) e pode receber sela (necessária para montar) e armadura (defesa 4/7/10, aparece no modelo), aplicadas clicando com o item na mão.
- Montaria com 0 de vida desmaia e volta para a casa do dono depois de 60 s.
- **Apito:** com o apito na mão, botão direito chama todas as suas montarias, que teleportam para perto se estiverem a mais de 30 blocos (com som e partículas).
- **Salvamento:** as montarias domadas são salvas no mundo do anfitrião (tipo, dono, nome, vida, sela, armadura, posição) e reaparecem ao carregar.
- **Multiplayer:** todos veem as montarias e quem está montado. O anfitrião simula a montaria e o dono controla a montaria em que está montado (envia entradas e posição; o anfitrião confia, porque é um jogo de família).
**Como ficou a Fase 7 (protocolo versão 6):**
- **mobs.js:**
  - Exporta `Mobs`, `TIPOS_MOB`, `ORDEM_TIPOS`, `COMPORTAMENTOS`, `registrarTipoMob(nome, def)` e `registrarComportamento(nome, fn)`.
  - Na classe: `atualizar`, `quantidade`, `autoridade`, `limpar`, `atacar(id, dano, dir)` (o `dir` é copiado), `raycastMob` (objeto reaproveitado), `alvosParaPoderes()` (lista reaproveitada), `aoDanoJogador(fn({ qtd, de: [x, y, z], efeito }))`, `aoXp(fn)` e `criarMob(tipo, x, y, z, yaw?)` (só no anfitrião).
  - Ganchos da Fase 8: `definirAtaqueDistancia(fn)` e, nos tipos, os campos `ataqueDistancia`, `voa` + `alturaVoo` e `chefao`. O chefão não conta nos limites, não some longe, não queima no sol e chama `ui.mostrarBarraChefao`, se existir.
  - O `Mobs` se registra sozinho com `rede.registrarMobs(this)`.
  - Os drops usam `rede.soltarDrop` (sem dono).
  - Lê `mundo._chunkEm(cx, cz).alturas` para saber se o mob está debaixo do céu. Seria melhor o world.js oferecer `topoColuna(x, z)`.
- **Rede:**
  - `mobNovo { id, mob, x, y, z, yaw, vida }`: o tipo do mob vai no campo `mob`.
  - `atacarMob { id, dano, dir, ataque, efeito? }`, com distância máxima de 6 no golpe e 32 nos poderes, e até 12 por segundo.
  - `mobs { t, dados: Float32Array(8 por mob) }`. As flags guardam um contador de golpes nos bits 8–11, mais subindo, no ar e nadando.
  - `dano { qtd, de, efeito? }` vem SEM o desconto da armadura (quem recebe desconta).
  - `xp { qtd }`.
  - O `bemvindo` leva `mobs`.
- Os mobs só existem onde o anfitrião tem o mundo carregado.
## Meteoro (/armageddon)
- `js/meteoro.js`: `new Meteoro({ scene, mundo, particulas, jogador, rede, som, ui, obterAlvos })`; `invocar()` (comando), `cair(x, y, z, dono, yaw, hx, hz)`, `atualizar(dt)`.
- Rede: efeito `{ tipo: 'meteoro', origem: [x, y, z do impacto], direcao: [dx, 0, dz] }`. Os outros jogadores só veem o cometa e sentem o impacto; quem usou o comando abre a cratera (blocos vão pela rede como qualquer `definirBlocos`) e machuca os mobs.

**Fase 11, motor das montarias e do pet (mobs.js + rede + player + main):**
- Tipos novos em `TIPOS_MOB`: `cavalo` (planícies de dia, grupos de 2–4, pacífico), `lobo_gigante` (florestas à noite, neutro: só ataca se apanhar, até ser domado), `aranha_montaria` (vem da aranha gigante domada), `filhote_dragao` (do ovo), `cachorro` (pet).
- Cada mob tem os campos `dono` (apelido ou null), `nomeDono`, `sela`, `armaduraMontaria`, `vidaMontaria` e `domado`. Mob domado não some longe, não queima no sol e não é alvo dos outros mobs (exceto quando o lobo ou o cachorro estão atacando).
- **Domar:**
  - O jogador segura o item certo (`ITENS_DOMAR`) e clica com o botão direito no mob; o cliente pede ao anfitrião (`domar { id }`).
  - Começa uma barra de "confiança" de 5 s, mostrada pela UI acima do mob ou perto da mira.
  - Falha (e o item é gasto) se o mob levar dano ou o jogador se afastar mais de 4 blocos.
  - A aranha gigante só pode ser domada abaixo de 30% de vida.
  - Ao completar: `dono = apelido`, mensagem "Cavalo domado! Use uma sela e aperte R para montar", partículas de coração e `som.domar(1)`.
- **Cachorro (pet):**
  - Nasce como animal raro de dia nas planícies (1 a cada ~3 grupos de animais).
  - Doma com 3 ossos (`osso`): a cada osso dado, a confiança sobe 1/3.
  - Domado, segue o dono (fica a 2–4 blocos, teleporta se passar de 24), senta quando o dono para, ataca os monstros que atacarem o dono (dano 4) e tem vida própria.
  - Clicar com o botão direito no próprio cachorro com Shift faz ele sentar/levantar.
- **Montar:**
  - R monta a montaria SUA mais próxima (até 3 blocos), se ela tiver sela. Montado, o jogador controla: WASD move a montaria na velocidade dela e Espaço pula (o cavalo pula 2.5 blocos).
  - Filhote de dragão: Espaço segurado voa por até 10 s, com recarga de 20 s e uma barra.
  - Lobo: ataca os mobs perto. Aranha: sobe paredes.
  - R de novo desmonta. A câmera fica um pouco mais alta. O personagem fica sentado no `modelo.assento`.
  - O dono controla a própria montaria: manda a posição pela rede (como a dele), e o anfitrião aceita.
- **Sela e armadura:** botão direito na sua montaria com a `sela` ou com uma `armadura_montaria_*` na mão coloca o item (consome; se já tinha, devolve o anterior). A armadura reduz o dano da montaria (`defesaMontaria`). O modelo mostra com `definirSela` / `definirArmaduraMontaria`.
- **Vida da montaria:** com 0, ela desmaia (deita) e reaparece na casa do dono depois de 60 s. Montado, a barra de vida da montaria aparece acima da hotbar.
- **Apito:** botão direito com o `apito` traz todas as suas montarias e o pet para perto (se estiverem a mais de 30 blocos, teleportam), com `som.apito()`.
- **Ovo de dragão:**
  - Colocado como bloco `OVO_DRAGAO`, com uma `FOGUEIRA` a até 3 blocos, conta 300 s (1 dia de jogo), com balanço, partículas e o som `som.chocar()` perto do fim.
  - Ao terminar: o bloco some e nasce um `filhote_dragao` com `dono` = quem colocou o ovo (guarde quem colocou no estado do bloco ou num registro do anfitrião).
- **Salvamento:** as montarias e pets domados ficam no save do anfitrião (`montarias: [{ tipo, dono, variante, sela, armadura, vida, pos }]`), num save versão 9. Os ovos chocando também (`ovos: [{ x, y, z, dono, tempo }]`).
- **Rede (protocolo versão 8):**
  - `domar`, `montar { id }`, `desmontar`, `equiparMontaria { id, item }`, `apito`;
  - o estado dos mobs passa a incluir o dono/montado (nos flags ou numa mensagem `donoMob { id, dono, sela, armadura }`);
  - todos veem quem está montado em quê.
- **UI:**
  - barra de confiança;
  - barra de vida da montaria;
  - barra de voo do filhote;
  - nome do dono acima da montaria/pet ("Cavalo de Pai").- **Modelos prontos (modelos_mobs.js):**
  - `criarModeloMob(tipo, opcoes = {})`, com `opcoes.variante` (cavalo 0–3; cachorro 0–2; sorteada se faltar). A variante escolhida fica em `modelo.variante`, e o mobs.js deve guardá-la e mandá-la pela rede para o cliente ver a mesma cor.
  - Todo modelo tem `assento` (Object3D no `grupo`; use `getWorldPosition`), `definirSela(bool)` e `definirArmaduraMontaria('ferro' | 'ouro' | 'diamante' | null)` (funções vazias nos que não são montaria).
  - Medidas (altura/raio): cavalo 1.65/0.6, lobo_gigante 1.32/0.55, aranha_montaria 1.8/1.4, filhote_dragao 1.45/0.65 (`estado.voando` bate as asas), cachorro 0.72/0.32 (`atacando` = bote).
**Como ficou a Fase 8:**
- O evento do `definirBloco` ganhou `original` (true se a posição nunca tinha sido mexida).
- O chefão da Lua Vermelha (`m.daLua`) vai embora de manhã, quando ninguém está a menos de 32 blocos.
- Quebrar um baú de tesouro sem abrir solta o mesmo tesouro sorteado.
- `window.jogo.minimapa`. O `/criativo` ignora o dano e os efeitos dos mobs.
- `rede.definirLuaVermelha(bool)` (só no anfitrião), `rede.luaVermelha`; `CONFIG.CHANCE_LUA_VERMELHA`; comando `/luavermelha`.
- As áreas especiais ficam a pelo menos 128 blocos do início.
- Partículas no corpo do jogador não são emitidas em 1ª pessoa.
**Como ficou a Fase 11 (protocolo versão 8, save versão 9):**
- Cliente→anfitrião (máx. 8 pedidos/s): `domar { id, item }`, `montar { id }`, `desmontar`, `equiparMontaria { id, item }`, `apito`, `sentar { id }`.
- Anfitrião→clientes: `donoMob { id, dono, sela, arm, mont, sent, novo }`, `domarEstado` (só quem doma), `avisoMob { texto }`.
- `mobNovo` e o `bemvindo` levam `extra = { v, dono, sela, arm, mont, sent }`. Flags dos mobs: 17 domado, 18 montado, 19 sentado, 20 desmaiado.
- A `pos` de quem está montado é a da montaria. Save 9: `montarias` e `ovos` (progresso do ovo no estado do bloco, 1 a 15).
- Mobs: `interagir`, `montar`, `desmontar`, `montariaPerto`, `apito`, `exportarMontarias/carregarMontarias`, `exportarOvos/carregarOvos`. UI: `mostrarConfianca(frac, nome)`, `mostrarMontaria(info)`.

### Dragões elementais (e água nos buracos)
**Água (world.js):** `definirBloco`/`definirBlocos` com origem `'local'`: um bloco que vira ar com água em cima, ou do lado (até `NIVEL_MAR`, ou abaixo da superfície de um lago mais alto), vira `AGUA`. A água escorre para o ar já existente (para baixo; para os lados só com apoio embaixo) até 3 blocos por buraco e 96 por lote, nunca acima de `NIVEL_MAR`. Num lote, os buracos do mesmo lote se enchem em cadeia e a água tirada abaixo do nível do mar volta (meteoro num lago). Só quem fez a mudança decide: a água sai pela rede como bloco comum (evento simples com `id: AGUA` + um lote extra com o que escorreu). Nada muda no protocolo; quem recebe com origem `'rede'` só aplica.
**Blocos:** 36 `OVO_DRAGAO_GELO`, 37 `OVO_DRAGAO_VENENO`, 38 `OVO_DRAGAO_RAIO`, 39 `NEVE`, 40 `MUSGO_TOXICO` (brilha). Campo novo `ovoDragao` ('fogo' no 35) e `elementoDoOvo(id)`.
**Itens:** `escama_dragao_gelo/veneno/raio`; `MATERIAIS_EQUIP` ganha os 3 (defesa 4/10/8/4; `resistencia`: gelo `'lento'`, veneno `'veneno'`); `espada_gelo` (13, `efeitoArma: 'gelo'` = lento 3 s), `espada_veneno` (13, `'veneno'`), `espada_raio` (12, `'raio'` = +3 de dano no golpe); as espadas têm `material` = a escama (a forja usa para melhorar); ovos `ovo_dragao_<elemento>` (pilha 1).
**world.js:** o ninho tem `elemento` ('fogo' | 'gelo' | 'veneno' | 'raio') em `areasEspeciais`, escolhido por terreno + hash da região; o de fogo ficou igual ao da Fase 8. Exporta `ELEMENTOS_DRAGAO` (o índice é a variante do filhote).
**mobs.js:** tipos `dragao_gelo`, `dragao_veneno`, `dragao_raio` (registrados por último), mesma IA `'dragao'`; campos novos `elemento`, `sopro`, `imune`. Projéteis novos: `sopro_gelo` (lento + congela água), `sopro_veneno` (veneno + nuvem no chão), `tempestade` (chama `relampago`), `relampago` (0,7 s de aviso, dano 5, arco 3 para quem estiver a até 5 blocos). Vão por `projetilMob`/`projetilFim`. O filhote tem `variantes: 4` (cor do ovo). `/spawn` aceita os nomes novos e o começo do nome bonito.
**player.js:** `bonus.resistenciaLento` (armadura com `resistencia: 'lento'`). **audio.js:** vozes `dragao_gelo/veneno/raio`, `som.trovao(vol)`, `som.choque()`.
