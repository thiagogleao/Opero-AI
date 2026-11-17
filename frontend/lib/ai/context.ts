import type { StoreRef } from '@/lib/access'
import { query } from '@/lib/db'
import { isConfigured, loadStores, minutesIntoDay, safeTz, todayInTz } from '@/lib/engine'
import { storeNotes } from './storeNotes'

/**
 * Who the AI is talking about, resolved on the server from the store the
 * route already checked against the viewer. The old Copilot read whichever
 * store had id = Clerk user id and never knew the date, so it mixed stores
 * and bucketed "ontem" in UTC.
 */
export interface StoreContext {
  id: string
  /** Disambiguated display name ("Dumpling Squishy · 8jcp3a"). */
  name: string
  domain: string | null
  timezone: string
  archived: boolean
  /** The shop's own currency. Opero stores every amount in US$ already. */
  currency: string | null
  /** False when the store has no cost settings: its "profit" is revenue − ads. */
  configured: boolean
  /** The store's calendar date and wall-clock time right now. */
  today: string
  localTime: string
  weekday: string
  notes: string[]
}

export async function loadStoreContext(store: StoreRef, now: Date = new Date()): Promise<StoreContext> {
  const tz = safeTz(store.timezone)
  const [rows, cur] = await Promise.all([
    loadStores([store.id]),
    query<{ shopify_currency: string | null }>(`SELECT shopify_currency FROM tenants WHERE id = $1`, [store.id]),
  ])
  const mins = minutesIntoDay(tz, now)
  return {
    id: store.id,
    name: store.name,
    domain: store.domain,
    timezone: tz,
    archived: store.archived,
    currency: cur[0]?.shopify_currency ?? null,
    configured: isConfigured(rows[0]?.settings ?? null),
    today: todayInTz(tz, now),
    localTime: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
    weekday: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: tz }).format(now),
    notes: storeNotes(store.domain),
  }
}

/** One line on what currency the numbers are in. */
export function currencyLine(ctx: Pick<StoreContext, 'currency'>): string {
  if (!ctx.currency || ctx.currency === 'USD') return 'Valores em dólar (US$).'
  return `A loja vende em ${ctx.currency}; todos os valores do Opero já estão convertidos para dólar (US$).`
}
