import 'server-only'

/**
 * What the cost screen needs from the server, read once per store and window:
 * the saved settings with their version (the same md5 GET /api/profit returns
 * and PUT checks), the saved settings priced for the window by the engine (the
 * same answer as POST /api/profit without a draft), and the product catalogue
 * for the product search.
 */

import type { StoreRef } from '@/lib/access'
import { query } from '@/lib/db'
import { formatRange, todayInTz, type DateRange, type Period } from '@/lib/engine/dates'
import { computeStorePnL } from '@/lib/engine/pnl'
import {
  NO_CONFIG_VERSION, costBreakdown, normalizeSavedConfig,
  type ConfigIssue, type ProfitConfig, type ProfitPreviewResponse,
} from '@/lib/data/profitConfig'
import { storeSummary } from '@/lib/integrations/stores'
import type { CatalogueItem } from './fields'

export interface SavedCosts {
  config: ProfitConfig
  version: string
  configured: boolean
  issues: ConfigIssue[]
  warnings: ConfigIssue[]
}

/** The stored settings, normalised for the form, with the version a save must send back. */
export async function loadSavedCosts(storeId: string): Promise<SavedCosts> {
  const [row] = await query<{ settings: unknown; version: string }>(
    `SELECT settings, md5(settings::text) AS version FROM profit_settings WHERE tenant_id = $1`,
    [storeId],
  )
  const n = normalizeSavedConfig(row?.settings ?? null)
  return { config: n.config, version: row?.version ?? NO_CONFIG_VERSION, configured: n.configured, issues: n.issues, warnings: n.warnings }
}

/** The saved settings priced over `range` — exactly what the dashboard shows
 *  (the engine reads the stored row itself, no override). */
export async function loadSavedPreview(store: StoreRef, period: Period, range: DateRange, saved: SavedCosts): Promise<ProfitPreviewResponse> {
  const run = await computeStorePnL(store.id, range, { products: true })
  if (!run) throw new Error('store not priced')
  return {
    store: { id: store.id, name: store.name, timezone: store.timezone, archived: store.archived },
    period,
    range,
    label: formatRange(range, todayInTz(store.timezone)),
    partial: run.partial,
    source: 'saved',
    configured: run.configured,
    version: saved.version,
    totals: run.totals,
    daily: run.daily,
    breakdown: costBreakdown(run, run.configured ? saved.config : null),
    saved: null,
    changed: false,
    issues: saved.issues,
    warnings: saved.warnings,
  }
}

/** The store's Shopify products, active first, then by title. Products named in
 *  the settings that the catalogue no longer has are added by the product
 *  table itself (ProductCostsSection), from the saved prices. */
export async function loadCatalogue(storeId: string): Promise<CatalogueItem[]> {
  const rows = await query<{ product_id: string; title: string | null; status: string | null }>(
    `SELECT product_id::text AS product_id, title, status FROM shopify_products WHERE tenant_id = $1`,
    [storeId],
  )
  return rows
    .map(r => ({ id: r.product_id, title: (r.title ?? '').trim() || `Produto ${r.product_id}`, status: r.status ?? 'active' }))
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.title.localeCompare(b.title, 'pt-BR'))
}

/** The store's Shopify currency (Hibikura: JPY), for the "costs are in US$" note. */
export async function loadCurrency(store: StoreRef): Promise<string | null> {
  try {
    return (await storeSummary(store)).currency
  } catch {
    return null
  }
}
