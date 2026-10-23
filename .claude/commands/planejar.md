---
description: Classifica uma tarefa do Hackraft (simples, média ou complexa) e diz qual agente vai usar
argument-hint: <descrição da tarefa>
---

Tarefa: $ARGUMENTS

Classifique esta tarefa do projeto Hackraft e diga qual agente deve fazê-la. **Não execute a tarefa.**

Critérios:
- **Simples** → `organizador` (haiku): criar ou mover arquivos e pastas, baixar ou organizar assets, commits, atualizar README ou CLAUDE.md. Não exige lógica de jogo.
- **Média** → `programador` (sonnet): uma funcionalidade com escopo claro em poucos arquivos (blocos, inventário, interface, chat, comandos, roupas, sons, partículas).
- **Complexa** → `arquiteto` (opus): multiplayer, geração do mundo e chunks, shaders, desempenho, IA de monstros e chefões, ou bugs difíceis que envolvem vários sistemas.
- **Revisão ou testes** → `testador` (haiku).

Se a tarefa tiver partes de níveis diferentes, divida em subtarefas e indique o agente de cada uma, dizendo quais podem rodar em paralelo.

Responda em português, em até 5 linhas:
1. Classificação
2. Agente (e modelo)
3. Motivo, em uma frase
4. Subtarefas, se houver divisão
