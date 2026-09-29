import { query } from './db'
import { sendPushToAll } from './push'
import { getAccountOverview, type StoreOverviewRow } from './accountOverview'
import { getDayThroughHour } from './intradayProfit'
import { REFERENCE_TZ, todayInTz, shiftDate } from './mobileRange'
import type { Tenant } from './tenant'

/**
 * Alerts and the daily summary.
 *
 * The thresholds live in the database rather than in a browser, because the
 * thing that evaluates them is a server-side scheduler with no client. They are
 * owner-level, not per-tenant: this is the same scope as the mobile app, which
 * spans every store and sits outside Clerk.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

export interface Rule { enabled: boolean; threshold: number }

export interface AlertConfig {
  /** Net ROAS for the day below this number. */
  roasDrop: Rule
  /** Day's ad spend above this percentage of the trailing 7-day average. */
  spendSpike: Rule
  /** Margin for the day below this percentage. */
  marginDrop: Rule
  /** Push a summary of the day at `hour`, local to the reference timezone. */
  dailySummary: { enabled: boolean; hour: number }
  /** A store below this ad spend today is too early to judge. */
  minSpend: number
  /** No performance alert before this hour: mornings are always ugly. */
  fromHour: number
}

export const DEFAULT_CONFIG: AlertConfig = {
  roasDrop:     { enabled: true,  threshold: 1.5 },
  spendSpike:   { enabled: false, threshold: 200 },
  marginDrop:   { enabled: true,  threshold: 10 },
  dailySummary: { enabled: true,  hour: 21 },
  minSpend: 50,
  fromHour: 12,
}

const CONFIG_ID = 'owner'

/** Merge a stored blob over the defaults so a new field never reads undefined. */
function merge(raw: Partial<AlertConfig> | null | undefined): AlertConfig {
  if (!raw) return DEFAULT_CONFIG
  return {
    roasDrop:     { ...DEFAULT_CONFIG.roasDrop,     ...(raw.roasDrop     ?? {}) },
    spendSpike:   { ...DEFAULT_CONFIG.spendSpike,   ...(raw.spendSpike   ?? {}) },
    marginDrop:   { ...DEFAULT_CONFIG.marginDrop,   ...(raw.marginDrop   ?? {}) },
    dailySummary: { ...DEFAULT_CONFIG.dailySummary, ...(raw.dailySummary ?? {}) },
    minSpend: raw.minSpend ?? DEFAULT_CONFIG.minSpend,
    fromHour: raw.fromHour ?? DEFAULT_CONFIG.fromHour,
  }
}

export async function getAlertConfig(): Promise<AlertConfig> {
  try {
    const rows = await query<{ settings: Partial<AlertConfig> }>(
      `SELECT settings FROM alert_settings WHERE id = $1`, [CONFIG_ID]
    )
    return merge(rows[0]?.settings)
  } catch {
    // Table not migrated yet — defaults keep the scheduler running.
    return DEFAULT_CONFIG
  }
}

export async function saveAlertConfig(patch: Partial<AlertConfig>): Promise<AlertConfig> {
  const next = merge({ ...(await getAlertConfig()), ...patch })
  await query(
    `INSERT INTO alert_settings (id, settings, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = $2::jsonb, updated_at = NOW()`,
    [CONFIG_ID, JSON.stringify(next)]
  )
  return next
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Every store the mobile app reports on. */
export async function allStores(): Promise<Tenant[]> {
  return query<Tenant>(
    `SELECT * FROM tenants WHERE shopify_access_token IS NOT NULL ORDER BY created_at`
  )
}

/** Hour of day (0-23) in the reference timezone. */
export function hourInTz(tz = REFERENCE_TZ): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date())
  )
}

/**
 * Claim an alert for today. Returns false when it was already sent — the
 * unique index does the work, so two overlapping scheduler passes cannot
 * both win.
 */
async function claim(kind: string, tenantId: string, day: string, payload: unknown): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO alert_events (kind, tenant_id, day, payload)
     VALUES ($1, $2, $3::date, $4::jsonb)
     ON CONFLICT (kind, tenant_id, day) DO NOTHING
     RETURNING id`,
    [kind, tenantId, day, JSON.stringify(payload ?? {})]
  )
  return rows.length > 0
}

function money(v: number): string {
  const s = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 10_000) return `${s}$${(a / 1000).toFixed(1)}K`
  return `${s}$${a.toFixed(0)}`
}

/** Trailing ad spend per store over `days` days, ending the day before today. */
async function spendBaseline(day: string, days = 7): Promise<Map<string, number>> {
  const rows = await query<{ tenant_id: string; avg_spend: string }>(
    `SELECT tenant_id, (SUM(spend) / $3::numeric)::text AS avg_spend
     FROM fb_ad_daily_metrics
     WHERE date BETWEEN $1::date AND $2::date
     GROUP BY tenant_id`,
    [shiftDate(day, -days), shiftDate(day, -1), days]
  )
  return new Map(rows.map(r => [r.tenant_id, Number(r.avg_spend)]))
}

// ─── Threshold alerts ─────────────────────────────────────────────────────────

export interface FiredAlert { kind: string; store: string; title: string; body: string }

/**
 * Evaluate today's numbers for every store and push whatever crossed a line.
 * Each alert is sent at most once per store per day.
 *
 * `dryRun` returns what would fire without claiming the day's slot or sending
 * anything — running a check by hand must not silently swallow the real alert.
 */
export async function runAlertChecks(
  opts: { force?: boolean; dryRun?: boolean } = {}
): Promise<FiredAlert[]> {
  const cfg = await getAlertConfig()
  const day = todayInTz(REFERENCE_TZ)

  const anyRule = cfg.roasDrop.enabled || cfg.spendSpike.enabled || cfg.marginDrop.enabled
  if (!anyRule) return []
  // Half a day of orders against a full day of ad spend always looks like a
  // disaster, so nothing fires before the configured hour.
  if (!opts.force && !opts.dryRun && hourInTz() < cfg.fromHour) return []

  const stores = await allStores()
  if (stores.length === 0) return []

  const overview = await getAccountOverview(stores, day, day)
  const baseline = cfg.spendSpike.enabled ? await spendBaseline(day) : new Map<string, number>()

  const fired: FiredAlert[] = []

  for (const s of overview.stores) {
    if (s.failed) continue

    // Too little spent today to judge anything by.
    const judgeable = s.adSpend >= cfg.minSpend

    if (cfg.roasDrop.enabled && judgeable && s.roas > 0 && s.roas < cfg.roasDrop.threshold) {
      const alert = {
        kind: 'roas_drop', store: s.name,
        title: `⚠️ ROAS ${s.roas.toFixed(2)}× — ${s.name}`,
        body: `Abaixo da meta de ${cfg.roasDrop.threshold}×. Hoje: ${money(s.revenue)} de receita, ${money(s.adSpend)} em anúncios, lucro ${money(s.profit)}.`,
      }
      if (await maybeSend(alert, s, day, opts)) fired.push(alert)
    }

    if (cfg.marginDrop.enabled && judgeable && s.revenue > 0 && s.margin < cfg.marginDrop.threshold) {
      const alert = {
        kind: 'margin_drop', store: s.name,
        title: `⚠️ Margem ${s.margin.toFixed(0)}% — ${s.name}`,
        body: `Abaixo de ${cfg.marginDrop.threshold}%. Hoje: ${money(s.revenue)} de receita e ${money(s.profit)} de lucro em ${s.orders} pedidos.`,
      }
      if (await maybeSend(alert, s, day, opts)) fired.push(alert)
    }

    if (cfg.spendSpike.enabled) {
      const avg = baseline.get(s.id) ?? 0
      const pct = avg > 0 ? (s.adSpend / avg) * 100 : 0
      if (avg > 0 && s.adSpend >= cfg.minSpend && pct >= cfg.spendSpike.threshold) {
        const alert = {
          kind: 'spend_spike', store: s.name,
          title: `📣 Gasto ${pct.toFixed(0)}% da média — ${s.name}`,
          body: `${money(s.adSpend)} hoje contra ${money(avg)} de média dos últimos 7 dias. ROAS ${s.roas > 0 ? `${s.roas.toFixed(2)}×` : '—'}.`,
        }
        if (await maybeSend(alert, s, day, opts)) fired.push(alert)
      }
    }
  }

  if (fired.length) {
    const verb = opts.dryRun ? 'would fire' : 'sent'
    console.log(`[alerts] ${verb} ${fired.length}: ${fired.map(f => `${f.kind}/${f.store}`).join(', ')}`)
  }
  return fired
}

async function maybeSend(
  alert: FiredAlert, store: StoreOverviewRow, day: string,
  opts: { force?: boolean; dryRun?: boolean }
): Promise<boolean> {
  if (opts.dryRun) return true
  if (!opts.force && !(await claim(alert.kind, store.id, day, { title: alert.title }))) return false
  await sendPushToAll({
    title: alert.title,
    body: alert.body,
    url: '/m',
    tag: `${alert.kind}-${store.id}-${day}`,
    data: { kind: alert.kind, tenantId: store.id },
  })
  return true
}

// ─── Daily summary ────────────────────────────────────────────────────────────

/** Push the day's account-wide result, compared with yesterday. */
export async function sendDailySummary(opts: { force?: boolean } = {}): Promise<boolean> {
  const cfg = await getAlertConfig()
  if (!cfg.dailySummary.enabled && !opts.force) return false

  const day = todayInTz(REFERENCE_TZ)
  const prev = shiftDate(day, -1)

  if (!opts.force && !(await claim('daily_summary', '*', day, { hour: cfg.dailySummary.hour }))) return false

  const stores = await allStores()
  if (stores.length === 0) return false

  // Yesterday is cut at the hour this summary is being sent, so a 9pm report
  // is not comparing twenty-one hours against twenty-four.
  const hour = hourInTz()
  const [today, yesterday] = await Promise.all([
    getAccountOverview(stores, day, day),
    getDayThroughHour(stores.map(s => s.id), prev, hour),
  ])

  const t = today.totals
  const delta = yesterday.profit !== 0
    ? ` (${t.profit >= yesterday.profit ? '+' : ''}${(((t.profit - yesterday.profit) / Math.abs(yesterday.profit)) * 100).toFixed(0)}% vs ontem nesta hora)`
    : ''

  const ranked = today.stores.filter(s => !s.failed)
  const worst = ranked[ranked.length - 1]
  const best  = ranked[0]

  const lines = [
    `${t.orders} pedidos · ${money(t.revenue)} receita · ${money(t.adSpend)} ads · margem ${t.revenue > 0 ? `${t.margin.toFixed(0)}%` : '—'}`,
    ranked.length > 1 && best  ? `Melhor: ${best.name} ${money(best.profit)}`   : null,
    ranked.length > 1 && worst && worst.id !== best?.id ? `Pior: ${worst.name} ${money(worst.profit)}` : null,
  ].filter(Boolean)

  await sendPushToAll({
    title: `📊 Hoje: ${money(t.profit)} de lucro${delta}`,
    body: lines.join(' · '),
    url: '/m',
    tag: `daily-summary-${day}`,
    data: { kind: 'daily_summary', profit: t.profit },
  })

  console.log(`[alerts] daily summary sent for ${day}: profit ${t.profit.toFixed(2)}`)
  return true
}
