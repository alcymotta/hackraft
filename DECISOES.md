# Decisões tomadas durante o desenvolvimento

Desde a Fase 3, o Claude segue direto até a Fase 11 sem parar a cada fase, como você pediu. Aqui ficam as escolhas que ele fez sozinho, para você revisar quando quiser. Se quiser mudar alguma, é só pedir.

## Gerais
- **Texturas:** geradas por código (16×16, estilo Minecraft). O Voxel Pack do Kenney usa outro estilo, em 128×128, e não cobre os blocos do jogo. Ainda dá para trocar qualquer textura por um PNG seu (veja `assets/textures/texturas.json`).
- **Sons e música:** sintetizados pelo próprio jogo. Baixar pacotes exigiria sua permissão a cada download. Os sons do Kenney podem ser acrescentados depois em `assets/sounds/sons.json`.
- **Correr com Shift:** Ctrl+W fecharia a aba do navegador.
- **Câmera com V:** o F5 também funciona, mas em notebooks ele pode recarregar a página.
- **Quebrar segurando o botão:** o tempo depende da dureza do bloco. Por isso o cristal roxo (Fase 5) tem graça: com ele a quebra fica instantânea.

## Fase 2: multiplayer
- **Visitantes:** inventário, posição e equipamento ficam guardados **no mundo de quem criou a sala**, pelo apelido.
- **O navegador do visitante nunca salva nada**, para não apagar o mundo dele.
- **Sem internet:** "Criar sala" vira modo sozinho.
- **Código da sala:** quando o anfitrião recarrega, a sala tenta manter o mesmo código.

## Fase 3: personagem e roupas
- **Teclas:** **E** abre inventário + equipamento e **C** abre a aparência (cores). Esse já é o jeito final da Fase 10, para não fazer o trabalho duas vezes.
- **Onde achar roupas agora:** "presentes misteriosos" espalhados pelo mundo, cerca de 1 a cada 3 ou 4 chunks. Monstros, alfaiate e crafting entram nas fases deles, usando os mesmos itens.
- **Trocar itens entre jogadores:** G joga o item no chão (Shift+G joga a pilha), ou arraste para fora do inventário. Os itens no chão somem em 10 minutos.
- **Bônus de roupa:** o ninja corre 10% mais rápido e faz passos silenciosos, e o cavaleiro tem +2 de defesa. A defesa passa a valer quando houver dano, na Fase 7.
- **Roupa hacker:** existe como item, mas não sai do presente. Ela é do comando /hacker (Fase 4).

## Fase 4: chat e comandos
- **O chat não solta o mouse:** abrir o chat (T) mantém o mouse preso, e o jogador para enquanto você digita. O Esc fecha o chat e mostra a pausa, porque o navegador sempre solta o mouse no Esc.
- **Horário:** qualquer jogador pode usar /dia e /noite. O anfitrião aplica e avisa todos no chat.
- **Casa:** cada jogador tem a sua (/setcasa), guardada no mundo do anfitrião.
- **/dar:** aceita o nome do item com ou sem acento ("espada de madeira" ou "espada_madeira").
- **Raio-X do /hacker:** por enquanto mostra os presentes enterrados; a partir da Fase 5, também os minérios de poder.
- **Efeitos do hacker:** discretos e seguros para a vista, sem flashes fortes nem rápidos.

## Fase 5: minérios de poder
- **Vida antecipada:** a barra de vida (corações), o dano de queda, a morte e o renascer na casa vieram para esta fase, para o cristal verde (regeneração) ter efeito. Na Fase 7, os monstros passam a causar dano usando esse sistema.
- **Morrer não perde itens**, para não frustrar uma criança.
- **Poderes de ataque antes dos monstros:** a bola de fogo queima madeira e folhas, o gelo congela a água (vira bloco de gelo) e o raio cai onde você mira. Quando os monstros chegarem (Fase 7), os três passam a acertá-los também.

## Fase 6: baús e construção
- **Crafting em lista:** em vez da grade 3×3 do Minecraft, a tela E mostra uma lista de receitas. Basta clicar, o que é mais fácil para criança.
- **Receitas simples:**
  - tronco → 4 tábuas
  - tábuas → gravetos, baú ou porta
  - graveto + carvão → 4 tochas
  - areia → vidro, sem precisar de fornalha
  - pedra + terra → tijolos
- **Carvão novo:** veio comum no subsolo, porque é preciso para fazer tochas.
- **Luz de verdade:** as tochas iluminam em volta, de bloco em bloco, e os cristais de poder soltam uma luz fraquinha nas cavernas.
- **Botão direito:** num baú abre e numa porta abre/fecha. Segure **Shift** para colocar um bloco encostado nele.
- **Baú quebrado:** o conteúdo cai no chão.
- **Baús no multiplayer:** os dois jogadores podem mexer no mesmo baú, e quem mexe por último no mesmo espaço vence.
## Fase 7: mobs
- **O anfitrião controla os mobs:** os dois jogadores veem os mesmos bichos, e os mobs não são salvos (reaparecem ao jogar).
- **Defesa da armadura:** cada ponto tira 4% do dano, até no máximo 80%.
- **Comida:**
  - porco → costeleta, galinha → coxinha; as folhas às vezes soltam maçã (ela será usada na maçã dourada da Fase 11);
  - comer é segurar o botão direito com a comida na mão;
  - não existe fome, para ficar simples: comida só cura.
- **Monstros ao amanhecer:** pegam fogo e somem.
## Fase 8: monstros RPG
- **Onde estão os chefões:** "Ninho do Dragão" (num pico alto) e "Covil da Hidra" (num lago escuro), 1 de cada a cada região de 12×12 chunks. O chefão aparece quando alguém chega perto, no máximo uma vez por dia de jogo.
- **Lua Vermelha:** cerca de 1 a cada 8 noites, com céu avermelhado, mais monstros e chance de chefão aparecer perto dos jogadores.
- **Níveis:** cada nível dá +1 coração (até 20 corações) e +1 de força no golpe.
- **Moedas:** os orcs soltam moedas, que vão servir no alfaiate (Fase 10).
- **Ovo de dragão:** só o dragão solta. Ele é usado na Fase 11 para conquistar o filhote de dragão.
## Fase 9: forja e melhorias
- **Fases em paralelo:** a Fase 9 foi feita junto com o fim da Fase 7, porque não depende dos mobs.
- **Uma só "Forja":** ela faz o papel da bigorna e da fornalha. Funde minério bruto com carvão em barra, forja espadas e armaduras, e melhora itens.
- **Melhorias de +1 a +5:** nunca falham, e cada nível deixa o item mais brilhante.
- **Como a melhoria é guardada:** fica no nome do item (ex.: "espada_ferro+2"). Assim ela vai junto quando o item é guardado no baú ou dado ao outro jogador.
- **Itens de chefão:** as escamas do dragão e da hidra viram armaduras especiais, e também servem para melhorar os itens de chefão.
## Fase 10: alfaiate
- **Mesa do alfaiate:** em vez de um personagem-alfaiate numa vila (que exigiria gerar vilas), o alfaiate é uma mesa que você mesmo constrói. Nela dá para costurar roupas com materiais ou comprá-las com moedas dos orcs.
- **Tecido:** é feito de fio de seda (que vem das aranhas).
- **Bônus novos:** o mago faz os poderes durarem 30% a mais, o astronauta pula mais e aguenta quedas maiores, e o pirata nada mais rápido.

## Fase 11: montarias
- **Fogueira em vez de lava:** como o mundo não tem lava, o ovo de dragão é chocado perto de uma fogueira por 1 dia de jogo (5 minutos).
- **Aranha gigante:** precisa estar enfraquecida (menos de 30% de vida) para tentar domar, como pedido.
- **Sela obrigatória:** toda montaria precisa de sela para montar, e a sela é feita de couro de orc.