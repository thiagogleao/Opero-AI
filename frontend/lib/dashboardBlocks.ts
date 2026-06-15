export interface BlockDef {
  id: string
  label: string
  description: string
  defaultVisible: boolean
  defaultOrder: number
}

export interface BlockState {
  id: string
  visible: boolean
}

export const BLOCK_DEFS: BlockDef[] = [
  {
    id: 'kpi-cards',
    label: 'Métricas Principais',
    description: 'Receita, pedidos, ROAS, gasto FB, clientes e carrinho abandonado',
    defaultVisible: true,
    defaultOrder: 0,
  },
  {
    id: 'profit-banner',
    label: 'Painel de Lucro',
    description: 'Lucro líquido, margem, lucro por pedido e break-even ROAS',
    defaultVisible: true,
    defaultOrder: 1,
  },
  {
    id: 'profit-charts',
    label: 'Lucro Diário + Margem',
    description: 'Evolução do lucro por dia e breakdown de margem por categoria de custo',
    defaultVisible: true,
    defaultOrder: 2,
  },
  {
    id: 'funnel-visual',
    label: 'Funil de Conversão',
    description: 'Impressões → Cliques → Carrinho → Checkout → Compras com taxas entre etapas',
    defaultVisible: true,
    defaultOrder: 3,
  },
  {
    id: 'revenue-chart',
    label: 'Receita ao Longo do Tempo',
    description: 'Receita Shopify e gasto FB por dia',
    defaultVisible: true,
    defaultOrder: 4,
  },
  {
    id: 'roas-chart',
    label: 'ROAS ao Longo do Tempo',
    description: 'ROAS real (Shopify ÷ FB) e ROAS FB por dia',
    defaultVisible: true,
    defaultOrder: 5,
  },
  {
    id: 'creatives-table',
    label: 'Top Criativos',
    description: 'Diagnóstico de criativos com sinais KILL / SCALE / REFRESH / OK',
    defaultVisible: true,
    defaultOrder: 6,
  },
  {
    id: 'country-chart',
    label: 'Desempenho por País',
    description: 'Receita e lucro por país com comparação Shopify vs FB',
    defaultVisible: true,
    defaultOrder: 7,
  },
  {
    id: 'country-spend',
    label: 'Gasto FB por País',
    description: 'Tabela detalhada: gasto, receita FB, ROAS, compras e CPC por país',
    defaultVisible: false,
    defaultOrder: 8,
  },
  {
    id: 'customer-chart',
    label: 'Clientes Novos vs Recorrentes',
    description: 'Evolução da proporção de novos e recorrentes ao longo do tempo',
    defaultVisible: true,
    defaultOrder: 9,
  },
  {
    id: 'ltv-section',
    label: 'LTV de Clientes',
    description: 'Segmentos de valor de vida do cliente (1, 2, 3+ pedidos)',
    defaultVisible: true,
    defaultOrder: 10,
  },
  {
    id: 'breakdown-tabs',
    label: 'Breakdowns FB',
    description: 'Desempenho por dispositivo, placement e faixa etária/gênero (últimos 14 dias)',
    defaultVisible: true,
    defaultOrder: 11,
  },
  {
    id: 'campaign-profit',
    label: 'Lucro por Campanha',
    description: 'Estimativa de lucro real por campanha usando dados Shopify por produto e país',
    defaultVisible: true,
    defaultOrder: 12,
  },
  {
    id: 'ai-panel',
    label: 'Análise com AI',
    description: 'Insights automáticos e recomendações de otimização gerados por AI',
    defaultVisible: true,
    defaultOrder: 13,
  },
  {
    id: 'notes',
    label: 'Notas e Avisos',
    description: 'Explicações sobre ROAS real vs FB e divergência de atribuição',
    defaultVisible: true,
    defaultOrder: 14,
  },
]

export function getDefaultLayout(): BlockState[] {
  return [...BLOCK_DEFS]
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map(b => ({ id: b.id, visible: b.defaultVisible }))
}

export function mergeWithDefaults(saved: BlockState[]): BlockState[] {
  const savedIds = new Set(saved.map(b => b.id))
  const defaults = getDefaultLayout()
  // Keep saved order + visibility, append any new blocks at end
  const result = saved.filter(b => BLOCK_DEFS.some(d => d.id === b.id))
  for (const d of defaults) {
    if (!savedIds.has(d.id)) result.push(d)
  }
  return result
}

export function getBlockDef(id: string): BlockDef | undefined {
  return BLOCK_DEFS.find(b => b.id === id)
}
