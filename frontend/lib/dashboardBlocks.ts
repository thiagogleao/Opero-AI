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
  // ── Default layout (exact same order/grouping as original dashboard) ──────
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
    id: 'revenue-roas',
    label: 'Receita + ROAS',
    description: 'Gráficos de receita Shopify e ROAS real lado a lado',
    defaultVisible: true,
    defaultOrder: 3,
  },
  {
    id: 'creatives-country',
    label: 'Criativos + Países',
    description: 'Top criativos (KILL/SCALE/REFRESH) e desempenho por país lado a lado',
    defaultVisible: true,
    defaultOrder: 4,
  },
  {
    id: 'customer-chart',
    label: 'Clientes Novos vs Recorrentes',
    description: 'Evolução da proporção de novos e recorrentes ao longo do tempo',
    defaultVisible: true,
    defaultOrder: 5,
  },
  {
    id: 'ltv-breakdowns',
    label: 'LTV + Breakdowns FB',
    description: 'Valor de vida do cliente e breakdowns por dispositivo/placement/idade-gênero lado a lado',
    defaultVisible: true,
    defaultOrder: 6,
  },
  {
    id: 'campaign-profit',
    label: 'Lucro por Campanha',
    description: 'Estimativa de lucro real por campanha usando dados Shopify por produto e país',
    defaultVisible: true,
    defaultOrder: 7,
  },
  {
    id: 'ai-panel',
    label: 'Análise com AI',
    description: 'Insights automáticos e recomendações de otimização gerados por AI',
    defaultVisible: true,
    defaultOrder: 8,
  },
  {
    id: 'notes',
    label: 'Notas e Avisos',
    description: 'Explicações sobre ROAS real vs FB e divergência de atribuição',
    defaultVisible: true,
    defaultOrder: 9,
  },
  // ── Extra blocks (hidden by default, add via Personalizar) ────────────────
  {
    id: 'funnel-visual',
    label: 'Funil de Conversão',
    description: 'Impressões → Cliques → Carrinho → Checkout → Compras com taxas entre etapas',
    defaultVisible: false,
    defaultOrder: 10,
  },
  {
    id: 'country-spend',
    label: 'Gasto FB por País',
    description: 'Tabela detalhada: gasto, receita FB, ROAS, compras e CPC por país',
    defaultVisible: false,
    defaultOrder: 11,
  },
  {
    id: 'creatives-table',
    label: 'Top Criativos (individual)',
    description: 'Tabela de criativos em largura total, sem o gráfico de países ao lado',
    defaultVisible: false,
    defaultOrder: 12,
  },
  {
    id: 'country-chart',
    label: 'Desempenho por País (individual)',
    description: 'Gráfico de países em largura total, sem a tabela de criativos ao lado',
    defaultVisible: false,
    defaultOrder: 13,
  },
  {
    id: 'ltv-section',
    label: 'LTV de Clientes (individual)',
    description: 'Segmentos de valor de vida do cliente em largura total',
    defaultVisible: false,
    defaultOrder: 14,
  },
  {
    id: 'breakdown-tabs',
    label: 'Breakdowns FB (individual)',
    description: 'Dispositivo, placement e idade/gênero em largura total',
    defaultVisible: false,
    defaultOrder: 15,
  },
  {
    id: 'revenue-chart',
    label: 'Receita (individual)',
    description: 'Gráfico de receita Shopify em largura total, sem o ROAS ao lado',
    defaultVisible: false,
    defaultOrder: 16,
  },
  {
    id: 'roas-chart',
    label: 'ROAS (individual)',
    description: 'Gráfico de ROAS em largura total, sem a receita ao lado',
    defaultVisible: false,
    defaultOrder: 17,
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
