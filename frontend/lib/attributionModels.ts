/**
 * Attribution types and labels, with no database import.
 *
 * The client component needs MODELS at runtime. Importing it from the module
 * that also opens a Postgres pool drags that module's whole import graph into
 * the browser bundle — which is how a page ends up shipping server code to the
 * client. Keeping the plain values here makes that impossible rather than
 * merely unlikely.
 */

export type Model = 'first' | 'last' | 'linear'

export const MODELS: { key: Model; label: string; hint: string }[] = [
  { key: 'first',  label: 'Primeiro clique', hint: 'Crédito para o anúncio que trouxe a pessoa pela primeira vez' },
  { key: 'last',   label: 'Último clique',   hint: 'Crédito para o último anúncio antes da compra' },
  { key: 'linear', label: 'Dividido',        hint: 'Crédito repartido entre todos os anúncios da jornada' },
]

export interface CreativeAttribution {
  adId: string
  name: string | null
  campaignName: string | null
  thumbnail: string | null
  /** Orders the journey credits to this ad. Fractional under the linear model. */
  orders: number
  revenue: number
  spend: number
  /** What Meta reports for itself over the same window. */
  metaPurchases: number
  metaRevenue: number
  roasJourney: number | null
  roasMeta: number | null
}

export interface Coverage {
  orders: number
  withJourney: number
  withAd: number
  pct: number
  attributablePct: number
}

export interface SourceRow {
  source: string
  orders: number
  revenue: number
}

export interface JourneyOrder {
  orderId: string
  orderNumber: number | null
  total: number
  createdAt: string
  momentsCount: number | null
  daysToConversion: number | null
  touches: {
    seq: number
    occurredAt: string | null
    source: string | null
    utmMedium: string | null
    adId: string | null
    adName: string | null
    landingPage: string | null
  }[]
}

export type JourneyFilter = 'all' | 'paid' | 'unattributed' | 'multi'

export const JOURNEY_FILTERS: { key: JourneyFilter; label: string }[] = [
  { key: 'all',          label: 'Todos' },
  { key: 'paid',         label: 'Com anúncio' },
  { key: 'unattributed', label: 'Sem anúncio' },
  { key: 'multi',        label: 'Vários toques' },
]

export interface JourneyPage {
  orders: JourneyOrder[]
  total: number
  hasMore: boolean
}
