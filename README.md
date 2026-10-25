# Hackraft

Jogo 3D de blocos no estilo Minecraft, feito para um pai jogar com o filho no navegador, sem instalar nada.

**Jogue agora:** https://alcymotta.github.io/hackraft/

---

## Jogar em dupla (passo a passo)

1. Cada um abre o link acima no **Chrome**.
2. Um de vocês põe um apelido e clica em **Criar sala**. O código da sala aparece no canto da tela.
3. O outro põe o apelido, digita o código (5 letras) no campo "Código da sala" e clica em **Entrar**.

Dicas:
- Quem criou a sala guarda o mundo no próprio navegador. O inventário, a posição e o equipamento de quem entra ficam guardados no mundo de quem criou a sala. O navegador do visitante não salva nada.
- Não minimize a janela de quem criou a sala. Com a aba escondida, o jogo dele para e o outro jogador fica parado junto.
- Se a versão nova não aparecer, aperte **Ctrl+Shift+R** para pegar a versão nova (sem usar o cache do navegador).
- Sem internet, "Criar sala" vira modo sozinho.

---

## Controles

| Tecla / mouse | O que faz |
|---|---|
| **W A S D** | andar |
| **Espaço** | pular (e nadar; no voo, subir) |
| **Shift** | correr (no voo, descer) |
| **Mouse** | olhar |
| **Botão esquerdo** (segurado) | quebrar bloco (ou bater num mob) |
| **Botão direito** | colocar bloco |
| **Botão direito** num baú, porta, forja ou mesa do alfaiate | abrir ou usar (com **Shift**, coloca um bloco encostado nele) |
| **1-9** ou **roda do mouse** | escolher o item da barra |
| **E** | inventário e equipamento (também fecha a forja e o alfaiate) |
| **C** | aparência (cores do personagem) |
| **G** | largar o item (**Shift+G** larga a pilha toda) |
| **Q** | usar o cristal de poder selecionado |
| **T** | abrir o chat (com **/** você já começa a digitar um comando) |
| **N** | ligar ou desligar o minimapa |
| **V** ou **F5** | trocar a câmera (1ª e 3ª pessoa) |
| **F3** | informações (debug) |
| **M** | ligar ou desligar o som |
| **R** | montar e desmontar (ainda em construção, Fase 11) |
| **Esc** | pausa |

---

## Comandos do chat

Digite **T** (ou **/**) para abrir o chat. Tudo que começa com "/" é um comando.

| Comando | O que faz |
|---|---|
| `/ajuda` ou `/ajuda <comando>` | mostra a lista de comandos, ou explica um deles |
| `/dia` | muda para o dia (qualquer jogador pode) |
| `/noite` | muda para a noite (qualquer jogador pode) |
| `/luavermelha` | chama, ou manda embora, a Lua Vermelha (só quem criou a sala) |
| `/voar` | liga ou desliga o voo (Espaço sobe, Shift desce) |
| `/criativo` | liga ou desliga o modo criativo |
| `/tp <jogador>` | vai até outro jogador (basta o começo do nome) |
| `/casa` | volta para a sua casa |
| `/setcasa` | marca o lugar onde você está como a sua casa |
| `/dar <item> [quantidade]` | dá um item para você (de 1 a 640) |
| `/spawn <mob> [quantidade]` | cria um mob na sua frente (até 10); só quem criou a sala pode. Sem o nome, lista os mobs |
| `/armageddon` | faz um meteoro gigante cair perto de você |
| `/hacker` | liga ou desliga o modo hacker |

Exemplos:
- `/dar espada_ferro 1`
- `/dar pedra 64`
- `/dar espada de madeira` (com ou sem acento, com espaço ou com "_")
- `/tp Filho`
- `/spawn zumbi 3`
- `/spawn aranha_gigante`

Observações:
- `/dar` só entrega até 10 de cada vez para itens que não empilham (roupas, espadas, armaduras).
- `/tp` só funciona com outro jogador na sala.
- Os nomes dos mobs para `/spawn` são: porco, galinha, zumbi, aranha, esqueleto, aranha_gigante, orc_guerreiro, orc_xama, dragao e hidra.

---

## Guia rápido do jogo

### Primeiros passos

1. **Pegue madeira.** Quebre um tronco de árvore. Não existe bancada: as receitas ficam na tela **E**.
2. **Faça tábuas.** Na tela E, 1 tronco vira 4 tábuas.
3. **Faça gravetos e tochas.** 2 tábuas viram 4 gravetos. Para as tochas, você ainda precisa de carvão (minério preto no subsolo).
4. **Antes da noite, faça um abrigo.** Não existem ferramentas: você quebra os blocos com a mão. As armas (espadas) vêm da forja e de presentes misteriosos.
5. **Acenda tochas dentro do abrigo.** Os monstros aparecem à noite e somem quando o sol nasce.

Tempo do jogo: o dia dura 3 minutos e a noite 2 minutos, ou seja, um dia inteiro tem 5 minutos.

### Crafting (tela E)

Na tela **E**, a lista de receitas mostra o que dá para fazer. Clique na receita para criar.

| Receita | Ingredientes | Resultado |
|---|---|---|
| Tábuas | 1 tronco | 4 tábuas |
| Gravetos | 2 tábuas | 4 gravetos |
| Tocha | 1 graveto + 1 carvão | 4 tochas |
| Baú | 8 tábuas | 1 baú |
| Porta | 6 tábuas | 1 porta |
| Vidro | 1 areia | 1 vidro |
| Tijolos | 2 pedra + 2 terra | 4 tijolos |
| Forja | 8 pedra + 4 carvão | 1 forja |
| Tecido | 3 fio de seda | 1 tecido |
| Mesa do alfaiate | 4 tábuas + 2 fio de seda | 1 mesa do alfaiate |
| Fogueira | 3 gravetos + 1 carvão + 1 tronco | 1 fogueira |
| Flecha | 1 graveto + 1 pena | 4 flechas |
| Osso encantado | 1 osso + 1 cristal verde | 1 osso encantado (para domar o lobo gigante) |
| Fio de seda mágico | 1 seda rara + 1 cristal roxo | 1 fio de seda mágico (para domar a aranha gigante) |
| Sela | 3 couro de orc + 1 barra de ferro | 1 sela (para montar) |
| Armadura de montaria de ferro | 6 barras de ferro | 1 armadura de montaria |
| Armadura de montaria de ouro | 6 barras de ouro | 1 armadura de montaria |
| Armadura de montaria de diamante | 6 diamantes | 1 armadura de montaria |
| Apito | 1 barra de prata + 1 graveto | 1 apito (chama as montarias) |

### Cristais de poder

Os minérios de cristal (no subsolo) soltam cristais. Escolha o cristal na barra de itens e aperte **Q** para usar. O efeito dura 30 segundos. A Roupa de mago deixa os poderes durarem 30% a mais.

| Cristal | Cor | Poder |
|---|---|---|
| Cristal azul | azul | supervelocidade (corre muito mais rápido) |
| Cristal vermelho | vermelho | superpulo, sem dano de queda |
| Cristal dourado | dourado | voar |
| Cristal verde | verde | regeneração (recupera vida aos poucos) |
| Cristal roxo | roxo | quebra qualquer bloco na hora |
| Cristal de fogo | laranja | atira bolas de fogo (queima madeira e folhas) |
| Cristal de raio | branco | solta raios na mira |
| Cristal de gelo | azul-claro | atira gelo (congela a água) |

### Forja

A **forja** faz o papel da bigorna e da fornalha. Coloque a forja no chão e clique com o **botão direito** nela. Ela tem 4 abas:

- **Fundir:** 1 minério bruto + 1 carvão viram 1 barra (cobre, ferro, prata, ouro e dracônio).
- **Forjar:** cria espadas e armaduras com barras, diamantes ou escamas.
  - Cada peça gasta uma quantidade do material: espada 2 (e 1 graveto), capacete 5, peitoral 8, calça 7, botas 4.
  - Materiais que dá para forjar: cobre, ferro, prata, ouro, diamante, dracônio, escama de dragão e escama de hidra.
  - Madeira e couro não se forjam, só se melhoram.
- **Melhorar:** sobe o equipamento de **+1 até +5**. A melhoria nunca falha.
  - Cada nível gasta 2, 3, 4, 5 e 6 unidades do material (o do +1 ao +5).
  - Espada: +1 de dano a cada nível.
  - Armadura: no +5, ganha +3 de defesa.
  - A melhoria aparece no nome do item (ex.: "espada_ferro+2") e vai junto quando você guarda ou dá o item.
- **Especiais:** a **maçã dourada** (1 maçã + 4 barras de ouro), usada para domar cavalos.

Itens de chefão (escamas de dragão e de hidra) também viram armaduras e servem para melhorar.

### Alfaiate (mesa do alfaiate)

Construa a **mesa do alfaiate** (receita na tela E) e use o **botão direito** nela. Ela tem duas abas:

- **Costurar:** faz a roupa com materiais.
- **Loja:** compra a roupa com **moedas**. As moedas caem dos orcs.

| Peça | Costurar com | Preço na loja |
|---|---|---|
| Roupa de ninja | 5 tecido + 3 carvão | 20 moedas |
| Roupa de cavaleiro | 4 tecido + 3 barras de ferro + 1 barra de ouro | 25 moedas |
| Roupa de mago | 6 tecido + 1 cristal roxo + 2 penas | 30 moedas |
| Roupa de astronauta | 5 tecido + 3 barras de prata + 2 vidro | 35 moedas |
| Roupa de pirata | 5 tecido + 2 couro de orc + 5 moedas | 20 moedas |
| Capa vermelha | 4 tecido + 1 cristal vermelho | 10 moedas |
| Capa azul | 4 tecido + 1 cristal azul | 10 moedas |

Equipe a roupa na tela **E** (o provador da mesa mostra como ela fica).

### Roupas e bônus

| Roupa | Bônus |
|---|---|
| Ninja | corre 10% mais rápido e tem passos silenciosos |
| Cavaleiro | defesa +2 |
| Mago | poderes duram 30% a mais |
| Astronauta | pula 30% mais alto e aguenta quedas maiores (+5 blocos) |
| Pirata | nada 50% mais rápido |
| Hacker | só visual; não sai de presente nem da mesa (para ganhar, use `/dar roupa_hacker`) |

As capas são só enfeite. As roupas aparecem em "presentes misteriosos" espalhados pelo mundo e também podem cair dos orcs e chefões.

A armadura reduz o dano que você recebe: cada ponto de defesa tira 4% do dano, até 80%.

### Monstros e chefões

| Mob | Onde e quando | O que solta | XP |
|---|---|---|---|
| Porco | dia, na grama | costeletas (1 a 3) | 1 |
| Galinha | dia, na grama | coxinha, penas | 1 |
| Zumbi | noite e lugares escuros | carne podre | 5 |
| Aranha | noite, florestas e cavernas; sobe parede | fio de seda | 5 |
| Esqueleto | noite e cavernas; atira flechas | ossos (1 a 2), às vezes flechas | 8 |
| Aranha gigante | noite; maior e envenenadora | fio de seda (2 a 4), seda rara (10%) | 15 |
| Orc guerreiro | noite, em grupos de 2 a 3 | moedas (2 a 5), couro de orc | 20 |
| Orc xamã | junto dos orcs; atira orbe roxo | moedas (3 a 6), cristal roxo (15%) | 25 |
| **Dragão Ancestral** (chefão) | **Ninho do Dragão** (pico alto) ou Lua Vermelha | escamas de dragão (4 a 8), ovo de dragão, espada do dragão (40%) | 500 |
| **Hidra de Três Cabeças** (chefão) | **Covil da Hidra** (lago escuro) ou Lua Vermelha | escamas de hidra (4 a 8), espada da hidra (50%), cristal verde (3) | 600 |

- A **espada do dragão** põe fogo no inimigo. A **espada da hidra** envenena.
- O **veneno** tira vida só até 1 coração (não mata). O **fogo** e os ataques podem matar.
- Os chefões aparecem quando alguém chega a menos de 40 blocos da área deles. Cada um aparece no máximo uma vez por dia de jogo.
- A maioria dos monstros pega fogo e some ao amanhecer.
- **Lua Vermelha:** cerca de 1 noite a cada 8. O céu fica avermelhado, aparecem mais monstros e pode surgir um chefão perto de vocês. De manhã, o chefão da Lua Vermelha vai embora. O comando `/luavermelha` chama a lua (só quem criou a sala).

### Níveis e XP

- Cada mob derrotado dá XP (veja a coluna XP acima).
- Para subir de nível, é preciso cada vez mais XP.
- Cada nível dá **+1 coração** (até 20 corações) e **+1 de força** (mais dano corpo a corpo).
- O jogador começa com 10 corações.

### Montarias e pet

<!-- conferir quando a Fase 11 ficar pronta -->

Esta parte ainda está sendo construída (Fase 11).

**Como conseguir cada montaria:**

| Montaria | Onde aparece | Item para domar | Velocidade | Especial |
|---|---|---|---|---|
| Cavalo | planícies, de dia (em grupo) | maçã dourada | rápido | pula bem alto |
| Lobo gigante | florestas, à noite | osso encantado | muito rápido | ataca os monstros perto de você |
| Aranha gigante domada | vem da aranha gigante, quando ela está fraca (menos de 30% de vida) | fio de seda mágico | rápido | sobe paredes |
| Filhote de dragão | nasce do ovo de dragão | (já nasce domado) | rápido | voa por 10 segundos (recarga de 20 s) |

**Como domar:** segure o item na mão e clique com o **botão direito** na criatura. Aparece uma barra de "confiança" que enche em uns 5 segundos. Se a criatura apanhar ou você se afastar mais de 4 blocos, o item se perde.

**Sela:** toda montaria precisa de **sela** para você montar. Use o **botão direito** na sua montaria com a sela na mão.

**Armadura de montaria:** o botão direito com a armadura na mão coloca a proteção na montaria (ferro, ouro ou diamante, com defesa 4, 7 e 10).

**Montar:** fique a até 3 blocos da sua montaria e aperte **R**. Para descer, aperte **R** de novo. Enquanto estiver montado, **WASD** move a montaria e **Espaço** pula.

**Apito:** com o apito na mão, o **botão direito** chama todas as suas montarias. Se estiverem longe (mais de 30 blocos), elas teleportam para perto de você.

**Ovo de dragão:** só cai do Dragão Ancestral. Coloque o ovo no chão e deixe uma **fogueira** a até 3 blocos dele. Depois de cerca de 5 minutos (um dia inteiro de jogo), nasce um filhote de dragão, já domado por quem colocou o ovo.

**Pet, o cachorro:** é um animal raro que aparece de dia nas planícies. Dê **3 ossos** para ele. Depois de domado, ele segue você, ataca quem atacar você e tem vida própria. Para ele sentar ou levantar, use **Shift + botão direito** nele.

### Modo criativo e minimapa

- **Modo criativo (`/criativo`):** blocos infinitos, quebra instantânea, voo (Espaço sobe, Shift desce) e sem dano. A rocha-matriz continua inquebrável. Cada jogador tem o seu modo.
- **Minimapa (tecla N):** fica no canto superior direito e mostra você, o outro jogador e a sua casa.

---

## Rodar no seu computador (para mexer no código)

Você precisa de um servidor local, porque o jogo não funciona com duplo clique no `index.html`.

- Pelo terminal (precisa do Node.js instalado): `npx --yes serve -l 5173 .` e abrir http://localhost:5173
- Ou pela extensão **Live Server** do VS Code (botão "Go Live").

Não precisa instalar pacotes: o jogo usa só HTML, CSS e JavaScript.

---

## Publicar no GitHub Pages (passo a passo)

Este jogo já está publicado em **alcymotta/hackraft**: https://alcymotta.github.io/hackraft/

Para publicar uma cópia sua:

1. Crie uma conta em https://github.com (se ainda não tiver).
2. Crie um repositório **público** (ex.: `hackraft`).
3. No terminal, dentro da pasta do projeto, ligue o projeto ao repositório e envie os arquivos:
   ```
   git remote add origin https://github.com/SEU_USUARIO/hackraft.git
   git push -u origin main
   ```
4. No site do GitHub, entre no repositório e vá em **Settings → Pages**.
5. Em **Build and deployment**, escolha **Deploy from a branch**, depois **main** e **/ (root)**, e clique em **Save**.
6. Espere 1 a 2 minutos. O endereço aparece na mesma tela (algo como `https://SEU_USUARIO.github.io/hackraft/`).

O arquivo `.nojekyll` já está no projeto, para o GitHub Pages servir os arquivos direto.

**Como atualizar depois:** salve as mudanças com um commit e envie com `git push`.

---

## Se algo der errado

| Problema | O que fazer |
|---|---|
| Tela preta ou aparece "Erro" | Abra o jogo com servidor (veja "Rodar no seu computador"). Aperte F12 e veja a aba **Console** para ver a mensagem de erro. |
| "Sala não encontrada" | O código está errado, ou quem criou a sala fechou o jogo. Confira o código com quem criou. |
| O outro jogador não aparece | Pode ser internet, firewall ou redes diferentes. Tente as duas pessoas na mesma rede Wi-Fi. |
| F5 recarregou a página sem querer | Para trocar a câmera, use **V**. O F5 recarrega a página. |
| Jogo lento | Feche outras abas. Se precisar, diminua a distância de visão em `js/config.js`, na linha `DISTANCIA_RENDER` (hoje 6). |

---

## Voltar para uma versão anterior

O projeto guarda as versões no Git. Pelo terminal, na pasta do projeto:

- `git log --oneline`: mostra a lista de versões salvas, com um código do lado de cada uma.
- `git restore .`: desfaz as mudanças feitas desde a última versão salva (cuidado: apaga essas mudanças).
- `git revert <código>`: cria uma versão nova que desfaz uma versão específica, sem apagar o histórico.

---

## Como o projeto foi feito

O jogo foi feito com o Claude Code, dividido em 4 agentes: **organizador** (arquivos, Git e documentação), **programador** (código do dia a dia), **arquiteto** (multiplayer, mundo e desempenho) e **testador** (revisão e roteiro de testes). O arquivo `CLAUDE.md` explica as regras do projeto. O `CONTRATOS.md` guarda como os módulos conversam entre si, e o `DECISOES.md` lista as escolhas que foram feitas sem perguntar, para o dono revisar.

---

## Créditos

- **Three.js** (licença MIT): motor 3D.
- **PeerJS** (licença MIT): conexão entre os jogadores.
- **Texturas e sons:** gerados pelo próprio código do jogo.
- **Fonte Press Start 2P:** Google Fonts.
