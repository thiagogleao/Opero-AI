import { query } from './db'
import { pushDeviceCount, pushKeysConfigured, sendPushToAll, type PushKind, type PushResult } from './push'
import { listStores, type StoreRef } from './access'
import { computePnL, type PnL } from './engine/pnl'
import { REFERENCE_TZ, minutesIntoDay, safeTz, shiftDate, todayInTz, type Period } from './engine/dates'
import { getCampaignSignals, DEFAULT_SCALE_CONFIG, type CampaignSignal } from './scaleSignals'
import { buildPortfolio, type PortfolioStoreRow, type PortfolioView } from './views/portfolio'
import { buildVerdict, judgedStores, verdictInputFromPortfolio } from './views/verdict'
import { formatMoney, formatPct, formatRoas, plural, readablePctChange } from './format'
import { adChannelOf, channelRoas, type AdChannel } from './views/adChannel'

/**
 * Alerts and the daily summary.
 *
 * The thresholds live in the database rather than in a browser, because the
 * thing that evaluates them is a server-side scheduler with no client. They are
 * owner-level: the same scope as the phone, which spans every active store.
 *
 * Every number comes from the profit engine, and each store is judged on its
 * own clock and against its own break-even: a single fixed ROAS target was
 * wrong for every store at once (MOKOO breaks even near 2.7×, Dumpling near
 * 1.6×), and a day with spend and no sales slipped past every rule.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

export interface Rule { enabled: boolean; threshold: number }

export interface AlertConfig {
  /** ROAS of the day on the store's ad channel (lib/views/adChannel: Meta,
   *  Shopify ads or both, as every screen measures it) below the store's own
   *  break-even ROAS (revenue ÷ contribution over the last 7 complete days).
   *  `threshold` is the target used only for stores without cost settings,
   *  whose break-even is unknown. */
  roasDrop: Rule
  /** At least `threshold` dollars of ads today and not one sale. */
  spendNoSales: Rule
  /** Day's ad spend (Meta + Shopify ads, as roasDrop and minSpend measure it)
   *  above this percentage of its trailing 7-day average. */
  spendSpike: Rule
  /** Operating margin for the day below this percentage (stores with cost
   *  settings only: without costs the margin means nothing). */
  marginDrop: Rule
  /** Campaigns that earned more budget, or are burning it; threshold = minimum
   *  margin % a campaign must hold to be worth scaling. */
  scaleAlerts: Rule
  /** Push a summary of the day at `hour`, in the reference timezone (Brasília). */
  dailySummary: { enabled: boolean; hour: number }
  /** A store below this ad spend today (Meta + Shopify ads) is too early to
   *  judge on ROAS/margin. */
  minSpend: number
  /** No performance alert before this hour of the store's own day. */
  fromHour: number
}

export const DEFAULT_CONFIG: AlertConfig = {
  roasDrop:     { enabled: true,  threshold: 1.5 },
  spendNoSales: { enabled: true,  threshold: 50 },
  spendSpike:   { enabled: false, threshold: 200 },
  marginDrop:   { enabled: true,  threshold: 10 },
  scaleAlerts:  { enabled: true,  threshold: 20 },
  dailySummary: { enabled: true,  hour: 21 },
  minSpend: 50,
  fromHour: 12,
}

const CONFIG_ID = 'owner'

type RuleKey = 'roasDrop' | 'spendNoSales' | 'spendSpike' | 'marginDrop' | 'scaleAlerts'
const RULES: Record<RuleKey, { min: number; max: number }> = {
  roasDrop:     { min: 0, max: 100 },
  spendNoSales: { min: 0, max: 1_000_000 },
  spendSpike:   { min: 0, max: 10_000 },
  marginDrop:   { min: -100, max: 100 },
  scaleAlerts:  { min: -100, max: 100 },
}

export class AlertConfigError extends Error {
  constructor(public problems: string[]) { super(problems.join('; ')) }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const hourOk = (v: unknown): v is number => finite(v) && Number.isInteger(v) && v >= 0 && v <= 23

/**
 * Problems with a config patch, one Portuguese sentence each. Fields that are
 * absent are fine; fields that are present must be valid. A cleared input
 * arriving as 0 or "" is refused instead of silently becoming "summary at
 * midnight" or "ROAS target 0".
 */
export function alertPatchProblems(patch: unknown): string[] {
  if (!isObj(patch)) return ['Configuração inválida']
  const out: string[] = []
  for (const key of Object.keys(RULES) as RuleKey[]) {
    const r = patch[key]
    if (r === undefined) continue
    if (!isObj(r)) { out.push(`${key}: formato inválido`); continue }
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') out.push(`${key}.enabled deve ser verdadeiro ou falso`)
    if (r.threshold !== undefined) {
      const { min, max } = RULES[key]
      if (!finite(r.threshold) || r.threshold < min || r.threshold > max) out.push(`${key}.threshold deve ser um número entre ${min} e ${max}`)
      else if (key === 'roasDrop' && r.threshold === 0) out.push('roasDrop.threshold não pode ser 0')
    }
  }
  const ds = patch.dailySummary
  if (ds !== undefined) {
    if (!isObj(ds)) out.push('dailySummary: formato inválido')
    else {
      if (ds.enabled !== undefined && typeof ds.enabled !== 'boolean') out.push('dailySummary.enabled deve ser verdadeiro ou falso')
      if (ds.hour !== undefined && !hourOk(ds.hour)) out.push('dailySummary.hour deve ser uma hora inteira de 0 a 23')
    }
  }
  if (patch.minSpend !== undefined && !(finite(patch.minSpend) && patch.minSpend >= 0)) out.push('minSpend deve ser um número ≥ 0')
  if (patch.fromHour !== undefined && !hourOk(patch.fromHour)) out.push('fromHour deve ser uma hora inteira de 0 a 23')
  return out
}

/**
 * A stored or patched blob, field by field over a base: anything missing or
 * invalid keeps the base value, so a new field never reads undefined and a bad
 * row in the table cannot switch rules off by accident.
 */
export function mergeAlertConfig(base: AlertConfig, raw: unknown): AlertConfig {
  const src = isObj(raw) ? raw : {}
  const rule = (key: RuleKey): Rule => {
    const r = isObj(src[key]) ? (src[key] as Record<string, unknown>) : {}
    const { min, max } = RULES[key]
    return {
      enabled: typeof r.enabled === 'boolean' ? r.enabled : base[key].enabled,
      threshold: finite(r.threshold) && r.threshold >= min && r.threshold <= max ? r.threshold : base[key].threshold,
    }
  }
  const ds = isObj(src.dailySummary) ? src.dailySummary : {}
  return {
    roasDrop: rule('roasDrop'),
    spendNoSales: rule('spendNoSales'),
    spendSpike: rule('spendSpike'),
    marginDrop: rule('marginDrop'),
    scaleAlerts: rule('scaleAlerts'),
    dailySummary: {
      enabled: typeof ds.enabled === 'boolean' ? ds.enabled : base.dailySummary.enabled,
      hour: hourOk(ds.hour) ? ds.hour : base.dailySummary.hour,
    },
    minSpend: finite(src.minSpend) && src.minSpend >= 0 ? src.minSpend : base.minSpend,
    fromHour: hourOk(src.fromHour) ? src.fromHour : base.fromHour,
  }
}

export async function getAlertConfig(): Promise<AlertConfig> {
  try {
    const rows = await query<{ settings: unknown }>(`SELECT settings FROM alert_settings WHERE id = $1`, [CONFIG_ID])
    return mergeAlertConfig(DEFAULT_CONFIG, rows[0]?.settings)
  } catch {
    // Table not migrated yet: defaults keep the scheduler running.
    return DEFAULT_CONFIG
  }
}

/** @throws AlertConfigError when a present field is invalid. */
export async function saveAlertConfig(patch: unknown): Promise<AlertConfig> {
  const problems = alertPatchProblems(patch)
  if (problems.length) throw new AlertConfigError(problems)
  const next = mergeAlertConfig(await getAlertConfig(), patch)
  await query(
    `INSERT INTO alert_settings (id, settings, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = $2::jsonb, updated_at = NOW()`,
    [CONFIG_ID, JSON.stringify(next)],
  )
  return next
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Hour of day (0-23) in `tz`, the reference timezone by default. */
export function hourInTz(tz: string = REFERENCE_TZ, now: Date = new Date()): number {
  return Math.floor(minutesIntoDay(tz, now) / 60)
}

/** Every store the alerts report on: active (not archived) stores. */
async function activeStores(): Promise<StoreRef[]> {
  return listStores({ kind: 'owner' })
}

/**
 * Claim an alert for a day. False when it was already claimed — the unique
 * index does the work, so two overlapping scheduler passes cannot both win.
 *
 * The claim is written with `delivered: null` (being sent); deliver() then
 * records what the push reached (recordDelivery). A claim whose push reached
 * nobody (`delivered: 0`) can be taken again, so the alert still fires once a
 * device is registered, and meanwhile the alerts sheet says it was not
 * delivered instead of listing it as sent. Rows written before the count was
 * stored have no `delivered` key and stay claimed (deliveryOf: unknown).
 */
async function claim(kind: string, key: string, day: string, payload: Record<string, unknown>): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO alert_events (kind, tenant_id, day, payload)
     VALUES ($1, $2, $3::date, $4::jsonb)
     ON CONFLICT (kind, tenant_id, day) DO UPDATE
        SET payload = EXCLUDED.payload, sent_at = now()
      WHERE alert_events.payload->>'delivered' = '0'
     RETURNING id`,
    [kind, key, day, JSON.stringify({ ...payload, delivered: null })],
  )
  return rows.length > 0
}

/** Store on the claim what its push reached (devices that accepted it, how
 *  many were on file, whether this server had a push key), for the sheet. */
async function recordDelivery(kind: string, key: string, day: string, res: PushResult, extra: Record<string, unknown> = {}): Promise<void> {
  const fields = { ...extra, delivered: res.sent, devices: res.devices, keys: pushKeysConfigured() }
  await query(
    `UPDATE alert_events SET payload = COALESCE(payload, '{}'::jsonb) || $4::jsonb
      WHERE kind = $1 AND tenant_id = $2 AND day = $3::date`,
    [kind, key, day, JSON.stringify(fields)],
  )
}

/** Undo a claim when nothing went out at all (the send or the summary threw,
 *  or there was nothing to send), so an error does not spend the day. */
async function release(kind: string, key: string, day: string): Promise<void> {
  await query(`DELETE FROM alert_events WHERE kind = $1 AND tenant_id = $2 AND day = $3::date`, [kind, key, day])
}

// Push titles and bodies are stored and shown again in the phone's alerts
// sheet, so they follow the same pt-BR rules as every screen (lib/format):
// "$1.234", "−$201", "ROAS 0,62×", "Margem −82%".
const money = (v: number) => formatMoney(v)
const pct0 = (v: number, sign = false) => formatPct(v, { digits: 0, sign })
/** A configured threshold, as typed: "10%", "7,5%", "−2,25%". */
const thresholdPct = (v: number) =>
  formatPct(v, { digits: Number.isInteger(v) ? 0 : Number.isInteger(v * 10) ? 1 : 2 })
const orders = (n: number) => plural(n, 'pedido', 'pedidos')

/** "ROAS" (Meta), "ROAS Shopify", "ROAS dos anúncios": the channel a ROAS is
 *  on, in the words of the phone's store rows (Home rowRoas). */
const ALERT_ROAS_NAME: Record<AdChannel, string> = { meta: 'ROAS', shop: 'ROAS Shopify', both: 'ROAS dos anúncios' }

/** "$608 na Meta", "$62,03 em anúncios Shopify", "$5,61 na Meta e $62,03 em
 *  anúncios Shopify": every channel that spent, so the parts add up. */
function spendText(t: Pick<PnL, 'metaSpend' | 'shopSpend'>): string {
  const meta = `${money(t.metaSpend)} na Meta`
  const shop = `${money(t.shopSpend)} em anúncios Shopify`
  if (t.shopSpend > 0) return t.metaSpend > 0 ? `${meta} e ${shop}` : shop
  return meta
}

/**
 * The phone, opened on one store and on the period the push talks about.
 * The period is always explicit: without it the phone restores the last one
 * used (app/m/_lib/selection resolveView), so a tap on today's "ROAS 0,36×"
 * could open "30 dias · no lucro". "today" is the store's own day, as the
 * alerts are.
 *
 * `dia` is the date a "today" push is about, on the calendar the link opens
 * (the store's own; Todas' for the summary). "today" alone opened whatever day
 * it was at the tap: Hibikura's alert about Tokyo's 23 nov, sent at 11h in
 * Brasília and tapped at 12h05, landed on Tokyo's 24 nov at 00h05. The phone
 * opens "Hoje" while it is still that date, and that date otherwise
 * (selection resolveView, notificationDay).
 *
 * With another preset (the scale push's "7 dias") `dia` is the day it was
 * sent: it marks the period and the tab as the link's (selection linkDayOf),
 * so neither becomes the phone's saved choice. Without it the scale push's
 * "7 dias" and Campanhas were stored as the owner's and reopened on every
 * launch.
 */
export const storeUrl = (storeId: string, opts: { tab?: string; periodo?: Period; dia?: string } = {}) => {
  const periodo = opts.periodo ?? 'today'
  return `/m?loja=${encodeURIComponent(storeId)}&periodo=${periodo}${periodo !== 'custom' && opts.dia ? `&dia=${opts.dia}` : ''}${opts.tab ? `&aba=${encodeURIComponent(opts.tab)}` : ''}`
}

/** The daily summary is about every store's day: Todas · Hoje (of `day`, on
 *  Todas' calendar), never the store last pinned on the phone. */
export const summaryUrl = (day: string) => `/m?loja=todas&periodo=today&dia=${day}`

// ─── Threshold alerts (pure evaluation) ───────────────────────────────────────

export type AlertKind = 'roas_drop' | 'spend_no_sales' | 'margin_drop' | 'spend_spike'

/** One store on its own day, as the rules see it. */
export interface StoreAlertInput {
  storeId: string
  name: string
  /** The store's own today (alerts are claimed per store per store-day). */
  day: string
  /** Minutes into the store's own day. */
  minutesIntoDay: number
  configured: boolean
  /** Today so far, from the engine. */
  today: PnL
  /** The last 7 complete days, from the engine: the break-even and the spend
   *  baseline come from here, not from a morning's handful of orders. */
  trailing: PnL
}

export interface AlertCandidate {
  kind: AlertKind
  storeId: string
  store: string
  day: string
  title: string
  body: string
  url: string
}

/** Days in StoreAlertInput.trailing. */
export const TRAILING_DAYS = 7

/**
 * The rules, for one store. Pure, so every edge (no sales, no settings, early
 * morning) is tested without a database.
 */
export function evaluateStoreAlerts(
  s: StoreAlertInput, cfg: AlertConfig, opts: { ignoreHour?: boolean } = {},
): AlertCandidate[] {
  if (!opts.ignoreHour && s.minutesIntoDay < cfg.fromHour * 60) return []
  const t = s.today
  const out: AlertCandidate[] = []
  const base = { storeId: s.storeId, store: s.name, day: s.day, url: storeUrl(s.storeId, { dia: s.day }) }

  // The worst day of all: money going out and nothing coming in. Its own rule,
  // because ROAS 0 and "no revenue, no margin" used to skip every other one.
  if (cfg.spendNoSales.enabled && t.orders === 0 && t.adSpend >= cfg.spendNoSales.threshold) {
    out.push({
      ...base, kind: 'spend_no_sales',
      title: `💸 ${money(t.adSpend)} em anúncios e nenhuma venda — ${s.name}`,
      body: `Hoje até agora: ${spendText(t)}, 0 pedidos. Confira checkout, pagamento e pixel.`,
    })
  }

  // Judged on all the ad money the margin carries (Meta + Shopify ads): gated
  // on Meta alone, Dumpling 8jcp3a — whose ads are mostly Shopify ads — was
  // never judged (7–16 nov: up to $1.567 a day of Shopify ads, $0 of Meta),
  // and its −24,5% day fired only while part of the spend was on Meta.
  const judgeable = t.orders > 0 && t.adSpend >= cfg.minSpend
  // The ROAS of the store's ad channel, as Resumo, the phone and the overview
  // measure it (lib/views/adChannel): revenue ÷ Meta read 2,07× on a day the
  // screens read "ROAS dos anúncios 0,95× · empate 1,46× → no prejuízo".
  const channel = adChannelOf(t)
  const roas = channelRoas(t)
  if (cfg.roasDrop.enabled && judgeable && roas !== null && channel !== null) {
    const own = s.configured ? (s.trailing.breakEvenRoas ?? t.breakEvenRoas) : null
    const target = s.configured ? own : cfg.roasDrop.threshold
    if (target !== null && roas < target) {
      const why = s.configured
        ? `Empate desta loja: ${formatRoas(target)} (receita ÷ margem de contribuição, últimos ${TRAILING_DAYS} dias).`
        : `Custos não configurados: comparado com a meta fixa de ${formatRoas(target)}.`
      // Without cost settings the engine's "lucro" is revenue − ads: never
      // called lucro (the screen the push opens says the same), and the parts
      // named add up to it.
      const result = s.configured
        ? `, lucro ${money(t.operatingProfit)}.`
        : `: receita − anúncios ${money(t.revenue - t.adSpend)} (sem custos configurados).`
      out.push({
        ...base, kind: 'roas_drop',
        title: `⚠️ ${ALERT_ROAS_NAME[channel]} ${formatRoas(roas)} abaixo do empate — ${s.name}`,
        body: `${why} Hoje: ${money(t.revenue)} de receita, ${spendText(t)}${result}`,
      })
    }
  }

  // Below break-even already implies a thin margin: one push per problem.
  const roasFired = out.some(a => a.kind === 'roas_drop')
  if (cfg.marginDrop.enabled && judgeable && !roasFired && s.configured && t.margin !== null && t.margin < cfg.marginDrop.threshold) {
    out.push({
      ...base, kind: 'margin_drop',
      title: `⚠️ Margem ${pct0(t.margin)} — ${s.name}`,
      body: `Abaixo de ${thresholdPct(cfg.marginDrop.threshold)}. Hoje: ${money(t.revenue)} de receita e ${money(t.operatingProfit)} de lucro em ${orders(t.orders)}.`,
    })
  }

  // On all the ad money, as the rules above: measured on Meta alone, a store
  // selling through Shopify ads (Dumpling 8jcp3a, 17 nov: $1.867 against about
  // $860 a day) never spiked, and a Meta spike was told beside the Shopify ROAS.
  if (cfg.spendSpike.enabled) {
    const avg = s.trailing.adSpend / TRAILING_DAYS
    const pct = avg > 0 ? (t.adSpend / avg) * 100 : 0
    if (avg > 0 && t.adSpend >= cfg.minSpend && pct >= cfg.spendSpike.threshold) {
      // One channel: "$1.867 em anúncios Shopify hoje"; both: the total, then its parts.
      const spent = t.metaSpend > 0 && t.shopSpend > 0 ? `${money(t.adSpend)} em anúncios hoje (${spendText(t)})` : `${spendText(t)} hoje`
      out.push({
        ...base, kind: 'spend_spike',
        title: `📣 Gasto em anúncios ${pct0(pct)} da média — ${s.name}`,
        body: `${spent} contra ${money(avg)} de média por dia nos últimos ${TRAILING_DAYS} dias.${roas !== null && channel ? ` ${ALERT_ROAS_NAME[channel]} ${formatRoas(roas)}.` : ''}`,
      })
    }
  }
  return out
}

// ─── Threshold alerts (running) ───────────────────────────────────────────────

export interface FiredAlert {
  kind: string
  storeId: string
  store: string
  title: string
  body: string
  /** Devices reached; 0 on a dry run. */
  delivered: number
}

/** Price every store on its own today, plus its last 7 complete days. Stores
 *  sharing a calendar date share one engine call. */
export async function loadAlertInputs(stores: StoreRef[], now: Date = new Date()): Promise<StoreAlertInput[]> {
  const byDay = new Map<string, StoreRef[]>()
  for (const s of stores) {
    const day = todayInTz(safeTz(s.timezone), now)
    byDay.set(day, [...(byDay.get(day) ?? []), s])
  }
  const out: StoreAlertInput[] = []
  await Promise.all([...byDay].map(async ([day, group]) => {
    const ids = group.map(s => s.id)
    const [today, trailing] = await Promise.all([
      computePnL(ids, { from: day, to: day }, {}, now),
      computePnL(ids, { from: shiftDate(day, -TRAILING_DAYS), to: shiftDate(day, -1) }, {}, now),
    ])
    for (const s of group) {
      const t = today.get(s.id)
      const tr = trailing.get(s.id)
      if (!t || !tr) continue
      out.push({
        storeId: s.id, name: s.name, day, minutesIntoDay: minutesIntoDay(safeTz(s.timezone), now),
        configured: t.configured, today: t.totals, trailing: tr.totals,
      })
    }
  }))
  return out
}

interface RunOpts { force?: boolean; dryRun?: boolean }

/** Send one push under a once-per-day claim and record on the claim what it
 *  reached (one that reached nobody can be taken again: see claim()).
 *  Returns devices reached (0 also when the claim was lost). */
async function deliver(
  claimKind: string, claimKey: string, day: string,
  push: { title: string; body: string; url: string; tag: string; kind: PushKind; data: Record<string, unknown> },
  opts: RunOpts,
): Promise<number> {
  if (!opts.force && !(await claim(claimKind, claimKey, day, { title: push.title }))) return 0
  let res: PushResult
  try {
    res = await sendPushToAll(push)
  } catch (err) {
    if (!opts.force) await release(claimKind, claimKey, day).catch(() => {})
    throw err
  }
  if (!opts.force) {
    await recordDelivery(claimKind, claimKey, day, res)
      .catch(err => console.error('[alerts] could not record the delivery of', claimKind, claimKey, err))
  }
  return res.sent
}

/**
 * Evaluate today's numbers for every active store and push whatever crossed a
 * line, at most once per store per day.
 *
 * `dryRun` returns what would fire right now without claiming or sending —
 * running a check by hand must not silently swallow the real alert. `force`
 * ignores the hour and the once-a-day claim (the "Testar agora" button).
 */
/** Owner's quiet hours, on the Brasília clock: no alert pushes from 23:00 to 08:00. */
export const QUIET_FROM_HOUR = 23
export const QUIET_TO_HOUR = 8

export function inQuietHours(now: Date = new Date()): boolean {
  const h = Math.floor(minutesIntoDay(REFERENCE_TZ, now) / 60)
  return h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR
}

export async function runAlertChecks(opts: RunOpts = {}): Promise<FiredAlert[]> {
  const cfg = await getAlertConfig()
  const anyRule = cfg.roasDrop.enabled || cfg.spendNoSales.enabled || cfg.spendSpike.enabled || cfg.marginDrop.enabled
  if (!anyRule) return []
  // Nobody to tell: do not price anything, and claim nothing.
  if (!opts.dryRun && (await pushDeviceCount()) === 0) return []
  // Each store is judged on its own clock, but the owner sleeps on Brasília's:
  // a Tokyo store's mature day lands at night in Brazil. Nothing is claimed
  // in quiet hours, so the alert still fires once the owner is awake.
  if (!opts.force && !opts.dryRun && inQuietHours()) return []

  const stores = await activeStores()
  if (!stores.length) return []
  const inputs = await loadAlertInputs(stores)

  const fired: FiredAlert[] = []
  for (const input of inputs) {
    for (const a of evaluateStoreAlerts(input, cfg, { ignoreHour: opts.force })) {
      const delivered = opts.dryRun ? 0 : await deliver(a.kind, a.storeId, a.day, {
        title: a.title, body: a.body, url: a.url, kind: 'alert',
        tag: `${a.kind}-${a.storeId}-${a.day}`,
        data: { kind: a.kind, tenantId: a.storeId },
      }, opts)
      if (opts.dryRun || delivered > 0) {
        fired.push({ kind: a.kind, storeId: a.storeId, store: a.store, title: a.title, body: a.body, delivered })
      }
    }
  }

  if (fired.length) {
    const verb = opts.dryRun ? 'would fire' : 'sent'
    console.log(`[alerts] ${verb} ${fired.length}: ${fired.map(f => `${f.kind}/${f.store}`).join(', ')}`)
  }
  return fired
}

// ─── Scale opportunities ──────────────────────────────────────────────────────

/** Title and body of a scale push for one campaign. Pure. */
export function scalePushText(
  storeName: string,
  c: Pick<CampaignSignal, 'name' | 'reasons' | 'spend' | 'orders'> & { verdict: 'scale' | 'cut' },
): { kind: 'scale_up' | 'scale_cut'; title: string; body: string } {
  const scaling = c.verdict === 'scale'
  const title = scaling
    ? `🚀 ${c.name.slice(0, 40)} — dá para escalar`
    : `🛑 ${c.name.slice(0, 40)} — queimando dinheiro`
  const body = [
    c.reasons[0],
    c.reasons[1],
    `${storeName}: ${money(c.spend)} gastos, ${orders(c.orders)} nos últimos 7 dias fechados.`,
  ].filter(Boolean).join(' · ')
  return { kind: scaling ? 'scale_up' : 'scale_cut', title, body }
}

/**
 * Tell the owner which campaigns have earned more budget, and which are
 * burning it. Once per campaign per day.
 *
 * Campaign level because that is the level that can actually be funded in this
 * account's structure, and judged on the margin of the sales the campaign can
 * be shown to have started — ad spend in full against credited revenue only.
 */
export async function runScaleChecks(opts: RunOpts = {}): Promise<FiredAlert[]> {
  const cfg = await getAlertConfig()
  if (!cfg.scaleAlerts.enabled && !opts.force && !opts.dryRun) return []
  if (!opts.dryRun && (await pushDeviceCount()) === 0) return []
  if (!opts.force && !opts.dryRun && inQuietHours()) return []

  const stores = await activeStores()
  const fired: FiredAlert[] = []

  for (const store of stores) {
    const tz = safeTz(store.timezone)
    const day = todayInTz(tz)
    let signals
    try {
      signals = await getCampaignSignals(store.id, { ...DEFAULT_SCALE_CONFIG, minMargin: cfg.scaleAlerts.threshold }, tz)
    } catch (err) {
      console.error('[alerts] scale check failed for', store.id, err)
      continue
    }

    for (const c of signals) {
      if (c.verdict !== 'scale' && c.verdict !== 'cut') continue
      // A paused campaign cannot be given more budget, and telling anyone to
      // cut one they already stopped is noise.
      if (c.status !== 'ACTIVE') continue

      const { kind, title, body } = scalePushText(store.name, { ...c, verdict: c.verdict })

      // The phone, on this store's campaigns: /campaigns is a Clerk page the
      // phone cannot open. On "7 dias": the push names the last 7 closed days,
      // the window the action is judged on — the link's, never the phone's
      // saved period (`dia`, storeUrl).
      const delivered = opts.dryRun ? 0 : await deliver(kind, `${store.id}:${c.campaignId}`, day, {
        title, body, url: storeUrl(store.id, { tab: 'campanhas', periodo: '7d', dia: day }), kind: 'scale',
        tag: `${kind}-${c.campaignId}-${day}`,
        data: { kind, tenantId: store.id, campaignId: c.campaignId },
      }, opts)
      if (opts.dryRun || delivered > 0) fired.push({ kind, storeId: store.id, store: store.name, title, body, delivered })
    }
  }

  if (fired.length) {
    const verb = opts.dryRun ? 'would fire' : 'sent'
    console.log(`[alerts] scale ${verb} ${fired.length}: ${fired.map(f => f.kind).join(', ')}`)
  }
  return fired
}

// ─── Daily summary ────────────────────────────────────────────────────────────

export interface DailySummary {
  title: string
  body: string
  profit: number
}

/**
 * " (+80% vs ontem nesta hora)" / " ($308 a mais que ontem nesta hora)": how
 * today's profit compares with yesterday's, by the verdict's rule (lib/views/
 * verdict). A percentage only between two profits and over a base worth one
 * (format readablePctChange): $310 after $1,89 read "+16.302%", and a swing
 * across zero has no percentage a reader can use. Otherwise the difference in
 * dollars, which a loss turning into a smaller loss reads as a gain. Empty when
 * yesterday's profit is exactly zero: nothing to compare against.
 */
export function vsYesterday(today: number, yesterday: number, sameTimeOfDay: boolean): string {
  if (yesterday === 0) return ''
  const when = `ontem${sameTimeOfDay ? ' nesta hora' : ''}`
  const pct = today >= 0 ? readablePctChange(today, yesterday) : null
  if (pct !== null) return ` (${pct0(pct, true)} vs ${when})`
  const diff = today - yesterday
  if (Math.abs(diff) < 0.005) return ` (igual a ${when})`
  return ` (${money(Math.abs(diff))} ${diff > 0 ? 'a mais' : 'a menos'} que ${when})`
}

type SummaryStore = Pick<PortfolioStoreRow, 'name' | 'totals' | 'configured'>

/**
 * Title and body of the summary. `t` and `before` must be the totals the
 * phone's verdict judges for the same view (dailySummaryOf passes buildVerdict's
 * totals and comparisonTotals): with several stores, only those with cost
 * settings when some have them. Summing every store let Glooty's revenue −
 * ads into the "lucro", the margin and the "vs ontem" base: on 12 nov the push
 * read $1.664 while the Todas · Hoje screen it opens read $1.802. A store left
 * out that way is out of Melhor/Pior and gets its own line, with its revenue −
 * ads, as the verdict names it. When no store has costs the amount is revenue
 * − ads and says so. Pure.
 */
export function summaryText(t: PnL, before: PnL | null, stores: SummaryStore[], sameTimeOfDay: boolean): DailySummary {
  const { judged, excluded } = judgedStores(stores)
  // No store at all (nothing to judge) still reads as profit.
  const withCosts = judged.every(s => s.configured)
  const result = (p: PnL) => (withCosts ? p.operatingProfit : p.revenue - p.adSpend)
  const moved = (s: SummaryStore) => s.totals.orders > 0 || s.totals.adSpend > 0
  const delta = before ? vsYesterday(result(t), result(before), sameTimeOfDay) : ''
  const ranked = judged.filter(moved).sort((a, b) => result(b.totals) - result(a.totals))
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  const noSales = judged.filter(s => s.totals.orders === 0 && s.totals.adSpend > 0)
  const leftOut = excluded.filter(moved)
  const unconfigured = withCosts ? [] : judged.filter(s => !s.configured && moved(s))
  const lines = [
    `${orders(t.orders)} · ${money(t.revenue)} receita · ${money(t.adSpend)} anúncios · margem ${withCosts ? formatPct(t.margin, { digits: 0 }) : '—'}`,
    ranked.length > 1 && best ? `Melhor: ${best.name} ${money(result(best.totals))}` : null,
    ranked.length > 1 && worst && worst !== best ? `Pior: ${worst.name} ${money(result(worst.totals))}` : null,
    noSales.length ? `Sem vendas: ${noSales.map(s => `${s.name} (${money(s.totals.adSpend)} em anúncios)`).join(', ')}` : null,
    leftOut.length
      ? `Fora do lucro, sem custos configurados: ${leftOut.map(s => `${s.name} (receita − anúncios ${money(s.totals.revenue - s.totals.adSpend)})`).join(', ')}`
      : null,
    unconfigured.length ? `Sem custos configurados: ${unconfigured.map(s => s.name).join(', ')}` : null,
  ].filter((l): l is string => !!l)
  const amount = result(t)
  return {
    title: withCosts ? `📊 Hoje: ${money(amount)} de lucro${delta}` : `📊 Hoje: ${money(amount)} de receita menos anúncios (sem custos)${delta}`,
    body: lines.join(' · '),
    profit: amount,
  }
}

/**
 * The summary of a portfolio view, judged exactly as the verdict of the screen
 * the push opens (summaryUrl: Todas · Hoje) — buildVerdict on the same view.
 */
export function dailySummaryOf(view: PortfolioView): DailySummary {
  const v = buildVerdict(verdictInputFromPortfolio(view))
  return summaryText(v.totals, v.comparisonTotals, view.stores, view.comparison.sameTimeOfDay)
}

export interface SummaryResult {
  sent: boolean
  /** Devices reached. */
  delivered: number
  summary: DailySummary | null
}

/**
 * Push the day's result for every active store, compared with yesterday at the
 * same time on each store's own clock — the same numbers as the phone's
 * Todas / Hoje. Once per day unless forced; `dryRun` builds it without sending.
 */
export async function sendDailySummary(opts: RunOpts = {}): Promise<SummaryResult> {
  const cfg = await getAlertConfig()
  const none: SummaryResult = { sent: false, delivered: 0, summary: null }
  if (!cfg.dailySummary.enabled && !opts.force && !opts.dryRun) return none

  const day = todayInTz(REFERENCE_TZ)
  if (!opts.dryRun) {
    if ((await pushDeviceCount()) === 0) return none
    if (!opts.force && !(await claim('daily_summary', '*', day, { hour: cfg.dailySummary.hour }))) return none
  }

  let summary: DailySummary
  let res: PushResult
  try {
    const stores = await activeStores()
    if (!stores.length) {
      if (!opts.dryRun && !opts.force) await release('daily_summary', '*', day)
      return none
    }
    const view = await buildPortfolio(stores, 'today', null, null, new Date(),
      { liveFeed: false, chargebackHealth: false, freshness: false })
    summary = dailySummaryOf(view)
    if (opts.dryRun) return { sent: false, delivered: 0, summary }

    res = await sendPushToAll({
      // The day the summary is about, on Todas' calendar: tapped after
      // midnight it opens that day, not the new and nearly empty one.
      title: summary.title, body: summary.body, url: summaryUrl(view.anchorToday), kind: 'summary',
      tag: `daily-summary-${day}`,
      data: { kind: 'daily_summary', profit: summary.profit },
    })
  } catch (err) {
    // A claim whose summary never went out must not block the day.
    if (!opts.dryRun && !opts.force) await release('daily_summary', '*', day).catch(() => {})
    throw err
  }
  // Its title too: the sheet shows the summary's own line, not only its kind.
  // One that reached nobody stays re-claimable (claim()).
  if (!opts.force) {
    await recordDelivery('daily_summary', '*', day, res, { title: summary.title })
      .catch(err => console.error('[alerts] could not record the daily summary delivery', err))
  }
  console.log(`[alerts] daily summary for ${day}: profit ${summary.profit.toFixed(2)}, ${res.sent} device(s)`)
  return { sent: res.sent > 0, delivered: res.sent, summary }
}

// ─── API shapes (GET/POST /api/mobile/alerts) ─────────────────────────────────

/**
 * What a recorded alert reached, read from its alert_events payload
 * (deliveryOf). A row is a once-a-day claim, not a receipt: production kept
 * claims while no device was subscribed (10 rows, 0 subscriptions) and the
 * sheet listed them as "Enviados".
 */
export type AlertDelivery =
  /** Accepted by `devices` devices. */
  | { state: 'delivered'; devices: number }
  /** Reached nobody: `subscribed` devices were on file (all refused, or none);
   *  `keys` false when this server had no VAPID key to send with. */
  | { state: 'not_delivered'; subscribed: number; keys: boolean }
  /** Claimed a moment ago, the push still going out. */
  | { state: 'sending' }
  /** Claimed, but the send never reported back (the process stopped). */
  | { state: 'interrupted' }
  /** Written before the count was stored: what it reached is not known. */
  | { state: 'unknown' }

/** A claim still "being sent" after this long never reported back. */
const SENDING_GRACE_MS = 10 * 60_000

/** "2026-11-18 16:29:21.37+00" (Postgres text) → a Date; null when unparseable. */
function pgTime(v: string | Date | null): Date | null {
  if (v === null) return null
  const d = v instanceof Date ? v : new Date(v.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  return Number.isNaN(d.getTime()) ? null : d
}

/** The delivery of one alert_events row, from its payload. Pure. */
export function deliveryOf(payload: unknown, sentAt: string | Date | null = null, now: Date = new Date()): AlertDelivery {
  if (!isObj(payload) || !('delivered' in payload)) return { state: 'unknown' }
  const d = payload.delivered
  if (d === null) {
    const at = pgTime(sentAt)
    return at && now.getTime() - at.getTime() > SENDING_GRACE_MS ? { state: 'interrupted' } : { state: 'sending' }
  }
  if (!finite(d) || d < 0) return { state: 'unknown' }
  if (d > 0) return { state: 'delivered', devices: d }
  return {
    state: 'not_delivered',
    subscribed: finite(payload.devices) && payload.devices >= 0 ? payload.devices : 0,
    keys: payload.keys !== false,
  }
}

export interface AlertEventRow {
  kind: string
  /** Store id, or null for the account-wide summary. */
  storeId: string | null
  store: string | null
  /** The store-day the alert was claimed for. */
  day: string
  /** When it was claimed (when taken again, the last attempt). */
  sentAt: string
  title: string | null
  /** What it reached. */
  delivery: AlertDelivery
}

/**
 * The alerts fired in the last 24 hours, newest first, each with what it
 * reached. `nameOf` names the stores (archived ones included). Empty when
 * the table does not exist yet.
 */
export async function loadRecentAlerts(nameOf: ReadonlyMap<string, string>, now: Date = new Date()): Promise<AlertEventRow[]> {
  let rows: { kind: string; tenant_id: string; day: string; sent_at: string; payload: unknown }[]
  try {
    rows = await query(
      `SELECT kind, tenant_id, day::text AS day, sent_at::text AS sent_at, payload
         FROM alert_events
        WHERE sent_at > now() - interval '24 hours'
        ORDER BY sent_at DESC
        LIMIT 30`)
  } catch {
    return [] // table not migrated yet
  }
  return rows.map(r => {
    // Scale alerts are keyed "<store>:<campaign>", the summary "*".
    const storeId = r.tenant_id === '*' ? null : r.tenant_id.split(':')[0]
    const p = isObj(r.payload) ? r.payload : {}
    return {
      kind: r.kind, storeId, store: storeId ? nameOf.get(storeId) ?? null : null,
      day: r.day, sentAt: r.sent_at, title: typeof p.title === 'string' ? p.title : null,
      delivery: deliveryOf(r.payload, r.sent_at, now),
    }
  })
}

export interface AlertsGetResponse {
  config: AlertConfig
  /** The alerts fired in the last 24 hours (once-a-day claims), newest
   *  first, each with what it reached. */
  recent: AlertEventRow[]
  /** Devices a push would reach right now; 0 means alerts cannot arrive. */
  devices: number
  /** False when this server has no VAPID key: nothing can be sent at all,
   *  and `devices` reads 0 whatever is subscribed. */
  pushKeys: boolean
}

export interface AlertsTestResponse {
  tested: true
  devices: number
  /** As in AlertsGetResponse. */
  pushKeys: boolean
  alerts: FiredAlert[]
  summary: SummaryResult
}
