// =====================================================================
// Hackraft - Receitas de criar (crafting)
// ---------------------------------------------------------------------
// Não usa three nem o DOM: só mexe no inventário (dá para testar no Node).
// =====================================================================

// Cada receita: o que sai e o que é gasto. Os nomes são ids de itens.
export const RECEITAS = [
  { id: 'tabuas', resultado: { item: 'tabuas', qtd: 4 }, ingredientes: [{ item: 'tronco', qtd: 1 }] },
  { id: 'graveto', resultado: { item: 'graveto', qtd: 4 }, ingredientes: [{ item: 'tabuas', qtd: 2 }] },
  { id: 'tocha', resultado: { item: 'tocha', qtd: 4 }, ingredientes: [{ item: 'graveto', qtd: 1 }, { item: 'carvao', qtd: 1 }] },
  { id: 'bau', resultado: { item: 'bau', qtd: 1 }, ingredientes: [{ item: 'tabuas', qtd: 8 }] },
  { id: 'porta', resultado: { item: 'porta', qtd: 1 }, ingredientes: [{ item: 'tabuas', qtd: 6 }] },
  { id: 'vidro', resultado: { item: 'vidro', qtd: 1 }, ingredientes: [{ item: 'areia', qtd: 1 }] },
  { id: 'tijolos', resultado: { item: 'tijolos', qtd: 4 }, ingredientes: [{ item: 'pedra', qtd: 2 }, { item: 'terra', qtd: 2 }] },
  // Fase 9: a forja (funde metais, forja e melhora equipamentos)
  { id: 'forja', resultado: { item: 'forja', qtd: 1 }, ingredientes: [{ item: 'pedra', qtd: 8 }, { item: 'carvao', qtd: 4 }] },
];

// Quanto o inventário tem de um item (somando todas as pilhas)
function contar(inventario, item) {
  let total = 0;
  const espacos = inventario.espacos;
  for (let i = 0; i < espacos.length; i++) {
    const e = espacos[i];
    if (e && e.item === item) total += e.qtd;
  }
  return total;
}

/** Quantas vezes dá para criar a receita com o que há no inventário (0 = nenhuma) */
export function podeCriar(inventario, receita) {
  let vezes = Infinity;
  for (const ing of receita.ingredientes) {
    vezes = Math.min(vezes, Math.floor(contar(inventario, ing.item) / ing.qtd));
  }
  return Number.isFinite(vezes) ? vezes : 0;
}

/**
 * Cria a receita `vezes` vezes (limitado ao que dá para fazer).
 * Devolve { criados, sobra }: criados = total do resultado produzido
 * e sobra = quanto desse total NÃO coube no inventário (quem chamou
 * deve largar a sobra no chão).
 */
export function criar(inventario, receita, vezes = 1) {
  vezes = Math.min(Math.floor(vezes), podeCriar(inventario, receita));
  if (!(vezes >= 1)) return { criados: 0, sobra: 0 };

  // Gasta os ingredientes, procurando em qualquer espaço
  for (const ing of receita.ingredientes) {
    let falta = ing.qtd * vezes;
    for (let i = 0; i < inventario.espacos.length && falta > 0; i++) {
      const e = inventario.espacos[i];
      if (e && e.item === ing.item) falta -= inventario.remover(i, falta);
    }
  }
  // Entrega o resultado (o espaço liberado acima já conta)
  const total = receita.resultado.qtd * vezes;
  const sobra = inventario.adicionar(receita.resultado.item, total);
  return { criados: total, sobra };
}
