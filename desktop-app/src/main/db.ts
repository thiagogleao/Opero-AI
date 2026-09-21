import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'

/**
 * Data layer for Opero Finance.
 *
 * This file used to talk to Postgres directly and carry its own copy of the
 * profit calculation. Both were mistakes. The copy drifted — when the supplier
 * rate card landed it kept charging the old price and the app showed $8.4k less
 * profit for September than the mobile app did — and the connection string was
 * a write-capable production password compiled into the installer.
 *
 * Now every number comes from /api/desktop, which runs the one calculation in
 * frontend/lib/profitCalc.ts that the web and mobile apps also use. There is
 * nothing left here to drift, and no database credential to leak.
 */

const DEFAULT_BASE = 'https://opero-ai-production.up.railway.app'

/** The API base. Not a secret; overridable for local development. */
function apiBase(): string {
  return (process.env.OPERO_API_URL ?? DEFAULT_BASE).replace(/\/+$/, '')
}

/**
 * The owner-only token, shared with the mobile PWA (MOBILE_ACCESS_TOKEN).
 * It lives outside the bundle on purpose: in the environment, or in the app's
 * own state file, never in source and never in the installer.
 */
function apiToken(): string | null {
  const fromEnv = process.env.OPERO_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    const file = join(app.getPath('userData'), 'opero-finance', 'state.json')
    if (!existsSync(file)) return null
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    const t = typeof raw.apiToken === 'string' ? raw.apiToken.trim() : ''
    return t || null
  } catch {
    return null
  }
}

export class MissingTokenError extends Error {
  constructor() {
    super(
      'Opero Finance nao esta configurado.\n\n' +
      'Abra o arquivo:\n' +
      join(app.getPath('userData'), 'opero-finance', 'state.json') + '\n\n' +
      'e adicione a chave "apiToken" com o valor de MOBILE_ACCESS_TOKEN ' +
      '(o mesmo segredo do app mobile). Depois reabra o aplicativo.'
    )
    this.name = 'MissingTokenError'
  }
}

async function api<T>(params: Record<string, string>): Promise<T> {
  const token = apiToken()
  if (!token) throw new MissingTokenError()

  const url = new URL('/api/desktop', apiBase())
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, {
    headers: { 'x-mobile-token': token },
    signal: AbortSignal.timeout(30_000),
  })

  if (res.status === 404) {
    // mobileAuth deliberately answers 404 rather than 401, so it leaks nothing
    // about what is missing. For us it means exactly one thing.
    throw new Error('Token recusado pelo servidor. Confira "apiToken" no state.json.')
  }
  if (!res.ok) throw new Error(`API ${res.status} em ${params.action ?? '?'}`)
  return (await res.json()) as T
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tenant      { id: string; shopify_domain: string; display_name: string; timezone: string }
export interface StoreStats  { tenantId: string; displayName: string; domain: string; orders: number; revenue: number; cogs: number; fees: number; fbSpend: number; profit: number; margin: number; configured: boolean }
export interface DailyPoint  { date: string; revenue: number; profit: number; fbSpend: number }
export interface Alert       { level: 'error' | 'warning' | 'info'; store: string; message: string }

/** Mirrors ProfitSummary in frontend/lib/profitCalc.ts. */
interface ProfitSummary {
  configured: boolean
  orderCount: number
  totalRevenue: number
  netProfit: number
  margin: number
  fbSpend: number
  totalCogs: number      // already includes packaging
  totalShipping: number
  totalFees: number
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/**
 * Short-lived response cache. It only spares the API repeated identical calls
 * while a page re-renders; anything longer made the app disagree with the web
 * dashboard for minutes after a settings change. The refresh button clears it.
 */
const CACHE_TTL = 60 * 1000
const _cache   = new Map<string, { at: number; value: unknown }>()
const _pending = new Map<string, Promise<unknown>>()

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T
  const inflight = _pending.get(key)
  if (inflight) return inflight as Promise<T>

  const p = load()
    .then(v => { _cache.set(key, { at: Date.now(), value: v }); _pending.delete(key); return v })
    .catch(e => { _pending.delete(key); throw e })
  _pending.set(key, p)
  return p
}

export function invalidateCache(tenantId?: string) {
  if (!tenantId) { _cache.clear(); return }
  for (const k of [..._cache.keys()]) if (k.includes(tenantId)) _cache.delete(k)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getTenants(): Promise<Tenant[]> {
  return cached('tenants', async () => {
    const rows = await api<{
      id: string; shopify_domain: string; shop_name: string | null; timezone: string | null
    }[]>({ action: 'tenants' })

    const label = (r: { shop_name: string | null; shopify_domain: string }) =>
      r.shop_name ?? r.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja'

    // Clone stores legitimately share a Shopify name, which would render as two
    // identical rows. Append the handle only where names actually collide.
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(label(r), (counts.get(label(r)) ?? 0) + 1)

    return rows.map(r => ({
      id: r.id,
      shopify_domain: r.shopify_domain,
      display_name: (counts.get(label(r)) ?? 0) > 1
        ? `${label(r)} (${r.shopify_domain.replace('.myshopify.com', '')})`
        : label(r),
      timezone: r.timezone ?? 'UTC',
    }))
  })
}

function toStoreStats(tenant: Tenant, s: ProfitSummary): StoreStats {
  return {
    tenantId: tenant.id,
    displayName: tenant.display_name,
    domain: tenant.shopify_domain,
    orders: s.orderCount,
    revenue: s.totalRevenue,
    cogs: s.totalCogs + s.totalShipping,
    fees: s.totalFees,
    fbSpend: s.fbSpend,
    profit: s.netProfit,
    margin: s.margin,
    configured: s.configured,
  }
}

export async function getStoreStats(tenant: Tenant, dateFrom: string, dateTo: string): Promise<StoreStats> {
  const s = await cached(`stats|${tenant.id}|${dateFrom}|${dateTo}`, () =>
    api<ProfitSummary>({ action: 'stats', tenantId: tenant.id, from: dateFrom, to: dateTo })
  )
  return toStoreStats(tenant, s)
}

export async function getDailyData(tenant: Tenant, days: number): Promise<DailyPoint[]> {
  const to   = new Date()
  const from = new Date(); from.setDate(from.getDate() - days)
  const dateFrom = from.toISOString().slice(0, 10)
  const dateTo   = to.toISOString().slice(0, 10)

  const res = await cached(`daily|${tenant.id}|${dateFrom}|${dateTo}`, () =>
    api<{ configured: boolean; dailyData: { date: string; revenue: number; profit: number; fbSpend: number }[] }>(
      { action: 'daily', tenantId: tenant.id, from: dateFrom, to: dateTo }
    )
  )

  // The series comes from generate_series, so each date carries a time part
  // ("2026-09-17 00:00:00+00"). The chart axis expects a plain day.
  return (res.dailyData ?? []).map(p => ({
    date: p.date.slice(0, 10),
    revenue: p.revenue,
    profit: p.profit,
    fbSpend: p.fbSpend,
  }))
}

export async function getAlerts(tenants: Tenant[]): Promise<Alert[]> {
  const y = new Date(); y.setDate(y.getDate() - 1)
  const day = y.toISOString().slice(0, 10)

  const rows = await cached(`all-stats|${day}|${day}`, () =>
    api<({ tenantId: string; error: boolean } & Partial<ProfitSummary>)[]>(
      { action: 'all-stats', from: day, to: day }
    )
  )

  const byId = new Map(rows.map(r => [r.tenantId, r]))
  const alerts: Alert[] = []
  for (const t of tenants) {
    const r = byId.get(t.id)
    if (!r || r.error) continue
    if ((r.orderCount ?? 0) === 0) {
      alerts.push({ level: 'warning', store: t.display_name, message: `Nenhum pedido ontem (${day})` })
    }
  }
  return alerts
}

export async function prefetchAll(tenants: Tenant[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  await Promise.all(
    tenants.map(t => getStoreStats(t, today, today).catch(() => null))
  )
}

export async function testConnection(): Promise<boolean> {
  try { await getTenants(); return true } catch { return false }
}
