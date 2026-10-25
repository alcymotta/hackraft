// =====================================================================
// Hackraft - Comandos do chat (Fase 4)
// ---------------------------------------------------------------------
// registrarComandos(chat, ctx) cadastra: /ajuda /dia /noite /voar /tp
// /casa /setcasa /criativo /dar /spawn /armageddon /hacker.
// ctx = { jogador, ceu, rede, remotos, inventario, equipamento, hacker,
//         mundo, meteoro, mudarHora(segundos), obterCasa(), definirCasa(pos) }
// =====================================================================

import { CONFIG } from './config.js';
import { ITENS } from './items.js';
import { TIPOS_MOB } from './mobs.js';

const QTD_MIN = 1;
const QTD_MAX = 640;

// Minúsculas, sem acento, espaços e traços viram "_" ("Espada de Madeira" -> "espada_de_madeira")
function normalizar(texto) {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[\s\-]+/g, '_');
}

// Procura um item pelo nome interno ou pelo rótulo. Devolve o nome interno ou null.
function acharItem(texto) {
  const alvo = normalizar(texto);
  if (!alvo) return null;
  const candidatos = [];
  for (const def of ITENS.values()) {
    const nome = normalizar(def.nome);
    const rotulo = normalizar(def.rotulo || def.nome);
    if (nome === alvo || rotulo === alvo) return def.nome;     // acerto exato
    if (nome.startsWith(alvo) || rotulo.startsWith(alvo)) candidatos.push(def.nome);
  }
  // Só o começo do nome: serve se houver um único item assim
  return candidatos.length === 1 ? candidatos[0] : null;
}

export function registrarComandos(chat, ctx) {
  const ok = (texto) => chat.adicionarMensagem({ texto: '✔ ' + texto, tipo: 'sucesso' });
  const erro = (texto) => chat.adicionarMensagem({ texto: '✖ ' + texto, tipo: 'erro' });
  const info = (texto) => chat.adicionarMensagem({ texto, tipo: 'sistema' });

  // ----- /ajuda -----
  chat.registrarComando('ajuda', {
    uso: '/ajuda [comando]',
    ajuda: 'Mostra os comandos disponíveis.',
    executar(args) {
      if (args.length > 0) {
        const nome = args[0].replace(/^\//, '').toLowerCase();
        const cmd = chat.comandos.get(nome);
        if (!cmd) { erro("Não existe o comando '" + nome + "'. Digite /ajuda para ver a lista."); return; }
        info(cmd.uso);
        info(cmd.ajuda);
        return;
      }
      info('Comandos disponíveis:');
      for (const [, cmd] of chat.comandos) info(cmd.uso + '  -  ' + cmd.ajuda);
    },
  });

  // ----- /dia e /noite -----
  chat.registrarComando('dia', {
    uso: '/dia',
    ajuda: 'Muda para o dia.',
    executar() {
      ctx.mudarHora(10);
      // No anfitrião/sozinho o aviso da rede já aparece; só o cliente espera a resposta
      if (ctx.rede && ctx.rede.modo === 'cliente') info('Pedindo para virar dia...');
    },
  });
  chat.registrarComando('noite', {
    uso: '/noite',
    ajuda: 'Muda para a noite.',
    executar() {
      ctx.mudarHora(CONFIG.DIA_SEGUNDOS + 10);
      if (ctx.rede && ctx.rede.modo === 'cliente') info('Pedindo para virar noite...');
    },
  });

  // ----- /voar -----
  chat.registrarComando('voar', {
    uso: '/voar',
    ajuda: 'Liga ou desliga o modo voo.',
    executar() {
      const j = ctx.jogador;
      j.voando = !j.voando;
      if (j.voando) ok('Modo voo ligado (Espaço sobe, Shift desce)');
      else ok('Modo voo desligado');
    },
  });

  // ----- /criativo -----
  chat.registrarComando('criativo', {
    uso: '/criativo',
    ajuda: 'Liga ou desliga o modo criativo (blocos infinitos, voo e sem dano).',
    executar() {
      // Mundo Criativo: todos já são criativos e não dá para desligar
      if (ctx.jogador.criativoTravado) {
        ok('Este mundo é Criativo: o modo criativo vale para todos e não dá para desligar.');
        return;
      }
      if (ctx.jogador.definirCriativo(!ctx.jogador.criativo)) {
        ok('Modo criativo ligado: blocos infinitos, voo (Espaço/Shift) e sem dano');
      } else {
        ok('Modo criativo desligado');
      }
    },
  });

  // ----- /luavermelha -----
  chat.registrarComando('luavermelha', {
    uso: '/luavermelha',
    ajuda: 'Chama (ou manda embora) a Lua Vermelha: noite com mais monstros e chance de chefão.',
    executar() {
      const rede = ctx.rede;
      if (!rede || typeof rede.definirLuaVermelha !== 'function') { erro('A Lua Vermelha não está disponível.'); return; }
      if (rede.modo === 'cliente') { erro('Só quem criou a sala pode chamar a Lua Vermelha.'); return; }
      const ligar = !rede.luaVermelha;
      // A Lua Vermelha só existe de noite: se for dia, vira noite primeiro
      if (ligar && !ctx.ceu.ehNoite) ctx.mudarHora(CONFIG.DIA_SEGUNDOS + 10);
      rede.definirLuaVermelha(ligar);
      if (!ligar) ok('A Lua Vermelha foi embora.');
    },
  });

  // ----- /tp -----
  chat.registrarComando('tp', {
    uso: '/tp <jogador>',
    ajuda: 'Vai até outro jogador (basta o começo do nome).',
    executar(args) {
      const rede = ctx.rede;
      const lista = rede && rede.modo !== 'sozinho' ? rede.listaJogadores() : [];
      const outros = lista.filter((j) => j.id !== rede.meuId);
      if (!rede || rede.modo === 'sozinho' || outros.length === 0) {
        erro('Você está jogando sozinho. Não há ninguém para visitar.');
        return;
      }
      if (args.length === 0) {
        erro('Diga o nome do jogador. Exemplo: /tp ' + outros[0].apelido);
        return;
      }
      const busca = normalizar(args.join(' '));
      let achados = outros.filter((j) => normalizar(j.apelido) === busca);
      if (achados.length === 0) achados = outros.filter((j) => normalizar(j.apelido).startsWith(busca));
      if (achados.length === 0) {
        erro("Não achei ninguém chamado '" + args.join(' ') + "'. Online: " + outros.map((j) => j.apelido).join(', '));
        return;
      }
      if (achados.length > 1) {
        erro('Vários jogadores combinam: ' + achados.map((j) => j.apelido).join(', ') + '. Digite mais letras.');
        return;
      }
      const alvo = achados[0];
      const pos = ctx.remotos.posicaoDe(alvo.id);
      if (!pos) { erro(alvo.apelido + ' ainda não apareceu no mundo. Tente de novo em instantes.'); return; }
      ctx.jogador.teletransportar(pos.x, pos.y, pos.z);
      ok('Você foi até ' + alvo.apelido + '.');
    },
  });

  // ----- /casa e /setcasa -----
  chat.registrarComando('casa', {
    uso: '/casa',
    ajuda: 'Volta para a sua casa (veja /setcasa).',
    executar() {
      const casa = ctx.obterCasa();
      if (!casa) { erro('Você ainda não tem casa. Use /setcasa no lugar que quiser.'); return; }
      ctx.jogador.teletransportar(casa[0], casa[1], casa[2]);
      ok('Bem-vindo(a) à sua casa!');
    },
  });
  chat.registrarComando('setcasa', {
    uso: '/setcasa',
    ajuda: 'Marca onde você está como a sua casa.',
    executar() {
      const p = ctx.jogador.posicao;
      const casa = [Math.round(p.x), Math.round(p.y), Math.round(p.z)];
      ctx.definirCasa(casa);
      ok('Casa marcada em ' + casa.join(', ') + '.');
    },
  });

  // ----- /dar -----
  chat.registrarComando('dar', {
    uso: '/dar <item> [quantidade]',
    ajuda: 'Dá um item para você (de 1 a 640). Ex.: /dar pedra 64',
    executar(args) {
      if (args.length === 0) { erro('Diga o item. Exemplo: /dar pedra 64'); return; }
      // O último pedaço é a quantidade se for só número ("espada de madeira 3")
      let qtd = 1;
      let partes = args;
      if (args.length > 1 && /^-?\d+$/.test(args[args.length - 1])) {
        qtd = parseInt(args[args.length - 1], 10);
        partes = args.slice(0, -1);
      }
      qtd = Math.max(QTD_MIN, Math.min(QTD_MAX, qtd));
      const texto = partes.join(' ');
      const nome = acharItem(texto);
      if (!nome) {
        erro("Não conheço o item '" + texto + "'. Exemplos: pedra, roupa_ninja, espada_madeira");
        return;
      }
      const def = ITENS.get(nome);
      // Itens que não empilham (roupas, armas...): no máximo 10 de uma vez
      if (def.pilha === 1) qtd = Math.min(qtd, 10);
      let sobra = ctx.inventario.adicionar(nome, qtd);
      if (sobra > 0) {
        // Itens de pilha 1 são soltos de um em um (nunca uma entrada "10x")
        if (def.pilha === 1) for (let i = 0; i < sobra; i++) ctx.jogador.soltarNaFrente(nome, 1);
        else ctx.jogador.soltarNaFrente(nome, sobra);
      }
      const rotulo = def.rotulo || nome;
      if (sobra > 0) ok('Você recebeu ' + (qtd - sobra) + 'x ' + rotulo + ' (' + sobra + ' foram para o chão, o inventário está cheio).');
      else ok('Você recebeu ' + qtd + 'x ' + rotulo + '.');
    },
  });

  // ----- /spawn -----
  chat.registrarComando('spawn', {
    uso: '/spawn <mob> [quantidade]',
    ajuda: 'Cria um mob (animal ou monstro) na sua frente. Sem o nome, lista os mobs.',
    executar(args) {
      const mobs = ctx.jogador.mobs;
      if (!mobs) { erro('Os mobs não estão disponíveis neste jogo.'); return; }
      const tipos = Object.keys(TIPOS_MOB);
      if (args.length === 0) { info('Mobs que existem: ' + tipos.join(', ')); return; }
      let qtd = 1;
      let partes = args;
      if (args.length > 1 && /^\d+$/.test(args[args.length - 1])) {
        qtd = Math.max(1, Math.min(10, parseInt(args[args.length - 1], 10)));
        partes = args.slice(0, -1);
      }
      // (apelidos: "dragao fogo" = o dragão de fogo, que se chama só 'dragao')
      const APELIDOS = { dragao_fogo: 'dragao', dragao_de_fogo: 'dragao' };
      let alvo = normalizar(partes.join(' '));
      if (APELIDOS[alvo]) alvo = APELIDOS[alvo];
      let tipo = tipos.find((t) => normalizar(t) === alvo || normalizar(TIPOS_MOB[t].nome || t) === alvo);
      if (!tipo) {
        const comeca = tipos.filter((t) => normalizar(t).startsWith(alvo));
        if (comeca.length === 1) tipo = comeca[0];
      }
      if (!tipo) {
        // o começo do nome bonito também vale ("dragao de gelo" → Dragão de Gelo Ancestral)
        const pelo = tipos.filter((t) => normalizar(TIPOS_MOB[t].nome || t).startsWith(alvo));
        if (pelo.length === 1) tipo = pelo[0];
      }
      if (!tipo) {
        erro("Não conheço o mob '" + partes.join(' ') + "'. Mobs que existem: " + tipos.join(', '));
        return;
      }
      if (!mobs.autoridade) { erro('Só o anfitrião pode criar mobs.'); return; }
      const p = ctx.jogador.posicao;
      const yaw = ctx.jogador.yaw;
      let criados = 0;
      for (let i = 0; i < qtd; i++) {
        const dist = 3 + i * 0.5;
        const x = p.x - Math.sin(yaw) * dist;
        const z = p.z - Math.cos(yaw) * dist;
        if (mobs.criarMob(tipo, x, p.y + 0.5, z) !== null) criados++;
      }
      if (criados === 0) erro('Não consegui criar o mob (limite de mobs no mundo?).');
      else ok(criados + 'x ' + (TIPOS_MOB[tipo].nome || tipo) + ' criado(s) na sua frente.');
    },
  });

  // ----- /armageddon -----
  chat.registrarComando('armageddon', {
    uso: '/armageddon',
    ajuda: 'Faz um meteoro gigante cair do céu perto de você.',
    executar() {
      if (!ctx.meteoro) { erro('O meteoro não está disponível neste jogo.'); return; }
      if (!ctx.meteoro.invocar()) { erro('Já tem um meteoro caindo. Espere ele cair!'); return; }
      ok('Olhe para o céu... ☄');
    },
  });

  // ----- /hacker -----
  chat.registrarComando('hacker', {
    uso: '/hacker',
    ajuda: 'Liga ou desliga o modo hacker.',
    executar() {
      ctx.hacker.alternar();
    },
  });
}
