/**
 * The partner-view chip's words: what the page halves, and what it never does.
 * Pure (no React): the header's SplitChip and the number band's lucro tag
 * (lib/views/numberBand) read the same two sentences.
 */
export function splitChipText(halved: boolean): { label: string; title: string } {
  return halved
    ? {
        label: 'sua parte (50%)',
        title: 'Visão de sócio: lucro, lucro por pedido, resultado de caixa e reembolsos aparecem pela metade, a sua parte. Vendas, gastos, contribuição, margens, ROAS e empate ficam inteiros.',
      }
    : {
        label: 'sua parte (50%) · nada é dividido aqui',
        title: 'Visão de sócio: só lucro, lucro por pedido, resultado de caixa e reembolsos aparecem pela metade, e esta página não mostra nenhum deles. Vendas, gastos, contribuição, margens e ROAS aparecem inteiros.',
      }
}
