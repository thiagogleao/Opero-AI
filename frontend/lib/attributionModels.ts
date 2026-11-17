/**
 * Attribution types and labels, with no database import.
 *
 * The client component needs MODELS at runtime. Importing it from the module
 * that also opens a Postgres pool drags that module's whole import graph into
 * the browser bundle — which is how a page ends up shipping server code to the
 * client. Keeping the plain values here makes that impossible rather than
 * merely unlikely.
 */

import type { DateRange } from './engine/dates'

export type Model = 'first' | 'last' | 'linear'

export const MODELS: { key: Model; label: string; hint: string }[] = [
  { key: 'first',  label: 'Primeiro clique', hint: 'Crédito para o anúncio que trouxe a pessoa pela primeira vez' },
  { key: 'last',   label: 'Último clique',   hint: 'Crédito para o último anúncio antes da compra' },
  { key: 'linear', label: 'Dividido',        hint: 'Crédito repartido entre todos os anúncios da jornada' },
]

export function isModel(v: unknown): v is Model {
  return v === 'first' || v === 'last' || v === 'linear'
}

/** The rule behind "De onde vieram as vendas", said on screen so nobody
 *  compares it with the creative table's first *ad* click and finds a gap. */
export const SOURCE_RULE = 'Primeira visita registrada de cada pedido, de qualquer origem'

/** Said wherever stores share an ad account (CAMP HALLOW's ads run in EPOCH's). */
export const SHARED_ACCOUNT_NOTE =
  'Quando os anúncios de uma loja rodam na conta de outra, o gasto fica na loja dona da conta ' +
  'e as vendas na loja que vendeu. Some as duas para julgar o resultado.'

export interface CreativeAttribution {
  adId: string
  name: string | null
  campaignName: string | null
  thumbnail: string | null
  /** Orders this store's journeys credit to the ad. Fractional under the linear model. */
  orders: number
  revenue: number
  /** Orders other stores of the same login credit to this ad (a shared ad
   *  account: CAMP HALLOW's sales on EPOCH's ads). */
  siblingOrders: number
  siblingRevenue: number
  /** The ad's whole Meta spend in the window, whichever store's account
   *  holds it. */
  spend: number
  /** Store whose ad account runs this ad (by its spend history); null when no
   *  connected account of this login has ever reported it. */
  adStoreId: string | null
  /** What Meta reports for itself over the same window, phantom rows removed. */
  metaPurchases: number
  metaRevenue: number
  /** All journey revenue credited to the ad (this store + siblings) / spend. */
  roasJourney: number | null
  roasMeta: number | null
}

/** Header numbers, computed over every ad — never from the visible rows. */
export interface AttributionTotals {
  /** Orders and revenue this store's journeys credit to any ad. */
  orders: number
  revenue: number
  /** Meta spend in this store's own ad account (= the profit engine's Meta
   *  spend for the store). */
  spend: number
  /** Meta's own claim for that spend, phantom rows removed. */
  metaPurchases: number
  metaRevenue: number
  /** Journey revenue (this store and its siblings) credited to ads of this
   *  store's account: the like-for-like figure to set against metaRevenue. */
  journeyRevenueOwnAds: number
  journeyOrdersOwnAds: number
  /** Part of journeyRevenueOwnAds that landed in sibling stores. */
  siblingRevenue: number
  siblingOrders: number
  /** Spend of other stores' accounts on ads this store's journeys credit. */
  sharedSpend: number
  /** Revenue credited to ads no connected account reports (a third account). */
  unknownAdRevenue: number
  roasJourney: number | null
  roasMeta: number | null
  /** (metaRevenue − journeyRevenueOwnAds) / journeyRevenueOwnAds, in %. */
  metaGapPct: number | null
  adsWithActivity: number
}

export interface PhantomDisclosure {
  /** Ad-days dropped because Meta reported a purchase value above $20,000. */
  rows: number
  value: number
}

export interface SharedAdAccount {
  /** Store whose ad account runs the ads. */
  adStoreId: string
  adStoreName: string
  /** Store where the journeys credit the sales. */
  salesStoreId: string
  salesStoreName: string
  orders: number
  revenue: number
}

export interface Coverage {
  orders: number
  withJourney: number
  withAd: number
  pct: number
  attributablePct: number
  /** Journeys Shopify had not finished computing when last asked. */
  pending?: number
  /** Last pass of the journey collector for this store (ISO), null if never. */
  journeysUpdatedAt?: string | null
}

export interface SourceRow {
  source: string
  orders: number
  revenue: number
}

export interface AttributionReport {
  storeId: string
  range: DateRange
  model: Model
  coverage: Coverage
  totals: AttributionTotals
  /** The `limit` ads with most spend (then revenue). */
  creatives: CreativeAttribution[]
  /** Everything below the cut, summed into one row (adId 'outros'). */
  others: (CreativeAttribution & { count: number }) | null
  sources: SourceRow[]
  sharedAccounts: SharedAdAccount[]
  phantom: PhantomDisclosure
}

export interface JourneyTouch {
  seq: number
  /** ISO instant. */
  occurredAt: string | null
  /** Wall clock in the store's timezone, "YYYY-MM-DD HH:MM". */
  occurredAtLocal: string | null
  source: string | null
  utmMedium: string | null
  adId: string | null
  adName: string | null
  landingPage: string | null
}

export interface JourneyOrder {
  orderId: string
  orderNumber: number | null
  total: number
  /** Wall clock in the store's timezone, "YYYY-MM-DDTHH:MM:SS" — the date a
   *  reader expects next to the order, not the UTC one. */
  createdAt: string
  /** ISO instant (UTC). */
  createdAtUtc: string
  /** How many visits Shopify counted; can exceed touches.length when Shopify
   *  holds more moments than were collected. */
  momentsCount: number | null
  daysToConversion: number | null
  touches: JourneyTouch[]
}

export type JourneyFilter = 'all' | 'paid' | 'unattributed' | 'multi'

export const JOURNEY_FILTERS: { key: JourneyFilter; label: string }[] = [
  { key: 'all',          label: 'Todos' },
  { key: 'paid',         label: 'Com anúncio' },
  { key: 'unattributed', label: 'Sem anúncio' },
  { key: 'multi',        label: 'Vários toques' },
]

export function isJourneyFilter(v: unknown): v is JourneyFilter {
  return v === 'all' || v === 'paid' || v === 'unattributed' || v === 'multi'
}

export interface JourneyPage {
  orders: JourneyOrder[]
  total: number
  hasMore: boolean
  /** Opaque keyset cursor for the next page; null at the end. */
  nextCursor: string | null
}
