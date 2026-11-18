/**
 * Why a ROAS has no break-even to be judged against, and how to say it.
 * Pure (no React, no CSS): RoasGauge and VerdictCard use it, and so can any
 * text helper (lib/views/verdict roasSummary should word the same cases the
 * same way).
 *
 * The engine's breakEvenRoas is revenue ÷ contribution, null when the
 * contribution is ≤ 0. So a null break-even has different causes, and only
 * one of them is "custos não configurados":
 *   no_costs         the store has no cost settings: the break-even is unknown
 *   no_sales         the store sold nothing in the window: every ad dollar was
 *                    a loss, there is no ratio to compute
 *   no_margin        costs are set and there were sales, but product, shipping
 *                    and fees already ate the whole revenue: no ROAS breaks even
 *   no_contribution  costs are set and nothing was left before ads, cause not
 *                    given (one of the two above)
 *   other_store      a campaign whose sales land in another store: this
 *                    store's break-even does not apply
 *   unknown          null with nothing else known: say only "desconhecido"
 */

export type BreakEvenReason = 'no_costs' | 'no_sales' | 'no_margin' | 'no_contribution' | 'other_store' | 'unknown'

export interface BreakEvenFacts {
  breakEven: number | null
  /** The store has cost settings. false always means no_costs (an
   *  unconfigured store's engine break-even is a meaningless 1×). */
  configured?: boolean
  /** Store revenue in the same window (≤ 0 = no sales). */
  revenue?: number | null
  /** Store contribution before ads in the same window, in dollars or as a
   *  share of revenue: only its sign is read. */
  contribution?: number | null
  /** The caller knows better (e.g. 'other_store' for a shared campaign). */
  reason?: BreakEvenReason | null
}

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** The usable break-even, or null. */
export function usableBreakEven(f: BreakEvenFacts): number | null {
  if (f.reason || f.configured === false || (known(f.revenue) && f.revenue <= 0)) return null
  return known(f.breakEven) && f.breakEven > 0 ? f.breakEven : null
}

/** Why there is no break-even, or null when there is one to compare with. */
export function breakEvenReason(f: BreakEvenFacts): BreakEvenReason | null {
  if (f.reason) return f.reason
  // No sales outranks the cost settings (as in verdict storeStatus): even with
  // costs there would be no ratio, every ad dollar was a loss, and "configure
  // os custos" would send the owner to the wrong fix.
  if (known(f.revenue) && f.revenue <= 0) return 'no_sales'
  if (f.configured === false) return 'no_costs'
  if (usableBreakEven(f) !== null) return null
  if (f.configured === true) {
    // A positive contribution with a null break-even means the caller dropped
    // a valid one: claim nothing.
    if (known(f.contribution) && f.contribution > 0) return 'unknown'
    if (known(f.revenue) && f.revenue > 0) return 'no_margin'
    if (known(f.contribution) && f.contribution < 0) return 'no_margin'
    return 'no_contribution'
  }
  return 'unknown'
}

export interface ReasonWords {
  /** Before the arrow ("empate desconhecido", "sem empate"); null = no arrow. */
  lead: string | null
  /** After the arrow, coloured by tone. */
  verdict: string
  /** The short form for a table cell (replaces lead → verdict). */
  mini: string
  /** neg: a loss whatever the ROAS; warn: a setting is missing; mut: no judgement. */
  tone: 'neg' | 'warn' | 'mut'
  /** One plain sentence for an explanation under the gauge. */
  explain: string
}

export const REASON_WORDS: Record<BreakEvenReason, ReasonWords> = {
  no_costs: {
    lead: 'empate desconhecido', verdict: 'custos não configurados',
    mini: 'empate desconhecido → custos não configurados', tone: 'warn',
    explain: 'Sem o custo dos produtos não dá para saber em que ROAS esta loja empata.',
  },
  no_sales: {
    lead: 'sem empate', verdict: 'nenhuma venda no período: todo o gasto foi prejuízo',
    mini: 'sem empate → loja sem vendas', tone: 'neg',
    explain: 'A loja não vendeu nada no período: todo o gasto com anúncios virou prejuízo, e sem vendas não há ROAS de empate.',
  },
  no_margin: {
    lead: 'sem empate', verdict: 'produto, frete e taxas já passam da receita',
    mini: 'sem empate → custos passam da receita', tone: 'neg',
    explain: 'Produto, frete e taxas já custaram mais do que as vendas trouxeram: não sobra nada para pagar anúncios, então nenhum ROAS empata neste período.',
  },
  no_contribution: {
    lead: 'sem empate', verdict: 'nada sobra das vendas antes dos anúncios',
    mini: 'sem empate → nada sobra antes dos anúncios', tone: 'neg',
    explain: 'Depois de produto, frete e taxas não sobrou nada das vendas: nenhum ROAS empata neste período.',
  },
  other_store: {
    lead: 'vende em outra loja', verdict: 'sem empate desta loja para comparar',
    mini: 'vende em outra loja', tone: 'mut',
    explain: 'As vendas desta campanha caem em outra loja: o empate desta loja não serve para julgá-la.',
  },
  unknown: {
    lead: null, verdict: 'empate desconhecido',
    mini: 'empate desconhecido', tone: 'mut',
    explain: 'Não há ROAS de empate calculado para este período.',
  },
}

/** "empate desconhecido → custos não configurados", "sem empate → …". */
export function reasonText(r: BreakEvenReason, mini = false): string {
  const w = REASON_WORDS[r]
  if (mini) return w.mini
  return w.lead ? `${w.lead} → ${w.verdict}` : w.verdict
}
