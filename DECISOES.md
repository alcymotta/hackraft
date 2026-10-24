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
