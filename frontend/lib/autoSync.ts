import { getAlertConfig, hourInTz, runAlertChecks, runScaleChecks, sendDailySummary } from './alerts'
import { journeyStores, syncJourneys, refreshPendingJourneys } from './journey'
import { runBulkBackfill, storesNeedingBackfill } from './journeyBulk'
import { adjustmentStores, syncAdjustments } from './adjustments'
import { minutesIntoDay, todayInTz } from './engine/dates'
import { activeLanes, launch, syncAllowed } from './sync/jobs'
import {
  accountNeedsBackfill, backfillWindow, dueMetaPasses, incrementalWindow, shopifyRepairDue, type SyncJob,
} from './sync/plan'
import {
  accountCollection, accountRows, closeStaleRuns, collectable, laneHistory, loadTargets,
  pruneRuns, recordRun, runHistory, runsHaveV2Columns, type SyncTarget,
} from './sync/runs'

/**
 * The server's sync scheduler, started once per process by instrumentation.
 *
 * Collectors run as child processes through lib/sync/jobs.ts (one job per
 * store and lane, coalesced, capped); everything else runs in-process with an
 * in-flight guard, so a slow pass is skipped rather than stacked:
 *   shopify    every 10 min  orders since the last success (status changes
 *                            included), widened after an outage
 *   facebook   every 30 min  Meta insights of the last days
 *   planner    every 15 min  Meta structure (4 h), 7-day re-pull (nightly),
 *                            28-day re-pull (weekly), 90-day order re-read
 *                            (monthly), history for new ad accounts,
 *                            stale-run sweep, retention
 *   alerts     every 15 min
 *   journeys   every 20 min  attribution journeys + refunds and disputes
 * Archived stores are never synced. AUTO_SYNC_DISABLED=1 (local runs) or a
 * read-only database turns all of it off.
 */

const SHOPIFY_EVERY_MIN = Number(process.env.AUTO_SYNC_SHOPIFY_MIN ?? 10)
const FACEBOOK_EVERY_MIN = Number(process.env.AUTO_SYNC_FACEBOOK_MIN ?? 30)
const PLANNER_EVERY_MIN = Number(process.env.AUTO_SYNC_PLANNER_MIN ?? 15)
const ALERTS_EVERY_MIN = Number(process.env.ALERTS_EVERY_MIN ?? 15)
const JOURNEY_EVERY_MIN = Number(process.env.JOURNEY_EVERY_MIN ?? 20)
/** Refunds re-read this far back on the routine pass, and a deep pass once a
 *  day re-reads a year so dates and currencies of old rows get corrected. */
const ADJUSTMENTS_DAYS = 45
const ADJUSTMENTS_DEEP_DAYS = 400

const g = globalThis as unknown as { __operoAutoSync?: { started: boolean; lastPrune: number; lastAccountCheck: number; lastDeepAdjust: Map<string, string> } }
const state = g.__operoAutoSync ??= { started: false, lastPrune: 0, lastAccountCheck: 0, lastDeepAdjust: new Map() }

export function schedulerEnabled(): boolean {
  return syncAllowed() && process.env.AUTO_SYNC_ENABLED !== 'false'
}

/** setInterval with an in-flight guard and a first delay. */
function every(name: string, minutes: number, firstDelayMs: number, fn: () => Promise<void>) {
  let busy = false
  const tick = () => {
    if (busy) { console.warn(`[autosync] ${name}: rodada anterior ainda em andamento — pulando`); return }
    busy = true
    fn().catch(err => console.error(`[autosync] ${name} falhou:`, err)).finally(() => { busy = false })
  }
  setTimeout(tick, firstDelayMs).unref()
  setInterval(tick, minutes * 60_000).unref()
}

// ─── Collector cycles ─────────────────────────────────────────────────────────

async function shopifyCycle(): Promise<void> {
  const targets = (await loadTargets()).filter(t => t.hasShopify)
  const history = await runHistory(targets.map(t => t.id))
  for (const t of targets) {
    const today = todayInTz(t.timezone)
    const h = laneHistory(history, t.id, 'shopify')
    const job: SyncJob = h.success
      ? { tenantId: t.id, lane: 'shopify', mode: 'scheduled', ...incrementalWindow(today, todayInTz(t.timezone, h.success)), reason: 'agendado', label: t.name }
      // Never synced: bring the history a new store needs.
      : { tenantId: t.id, lane: 'shopify', mode: 'backfill', ...backfillWindow(today, null), reason: 'loja nova', label: t.name }
    launch(job)
  }
}

const hasMeta = (t: SyncTarget) => t.accounts.some(collectable)

async function facebookCycle(): Promise<void> {
  const targets = (await loadTargets()).filter(hasMeta)
  const history = await runHistory(targets.map(t => t.id))
  for (const t of targets) {
    const today = todayInTz(t.timezone)
    const h = laneHistory(history, t.id, 'facebook')
    launch({
      tenantId: t.id, lane: 'facebook', mode: 'quick', label: t.name, reason: 'agendado',
      ...incrementalWindow(today, h.success ? todayInTz(t.timezone, h.success) : null),
    })
  }
}

async function plannerCycle(): Promise<void> {
  const closed = await closeStaleRuns(activeLanes())
  if (closed) console.log(`[autosync] ${closed} execução(ões) presas em 'running' encerradas`)
  if (Date.now() - state.lastPrune > 20 * 3_600_000) {
    state.lastPrune = Date.now()
    const n = await pruneRuns()
    if (n) console.log(`[autosync] retenção: ${n} execuções com mais de 30 dias apagadas`)
  }

  const all = await loadTargets()
  const now = new Date()
  const history = await runHistory(all.map(t => t.id))

  // Re-pulls, the monthly re-read and account backfills are told apart by
  // sync_runs.mode/account_id. Before the migration adds them every such pass
  // would look never done and be relaunched each cycle; only structure (its
  // own source) is planned then.
  const v2 = await runsHaveV2Columns()
  if (!v2) console.warn('[autosync] sync_runs sem mode/account_id (rode frontend/migrate.js) — só a estrutura do Meta é planejada')

  // Monthly 90-day re-read of orders (status repair + new columns).
  for (const t of v2 ? all.filter(s => s.hasShopify) : []) {
    const due = shopifyRepairDue({
      now, localHour: Math.floor(minutesIntoDay(t.timezone, now) / 60),
      backfill: laneHistory(history, t.id, 'shopify', ['backfill']),
    })
    if (due) launch({ tenantId: t.id, lane: 'shopify', mode: 'backfill', label: t.name, reason: 'revisão 90 dias', ...backfillWindow(todayInTz(t.timezone, now), null) })
  }

  const targets = all.filter(hasMeta)
  if (!targets.length) return
  for (const t of targets) {
    const today = todayInTz(t.timezone, now)
    const passes = dueMetaPasses({
      now, today, localHour: Math.floor(minutesIntoDay(t.timezone, now) / 60),
      dayOf: d => todayInTz(t.timezone, d),
      structure: laneHistory(history, t.id, 'facebook_structure'),
      repull7: laneHistory(history, t.id, 'facebook', ['repull7']),
      repull28: laneHistory(history, t.id, 'facebook', ['repull28']),
    })
    for (const p of passes) {
      if (!v2 && p.lane !== 'facebook_structure') continue
      launch({ tenantId: t.id, label: t.name, ...p })
    }
  }

  // History for ad accounts attached since the last look (hourly is plenty).
  if (!v2 || Date.now() - state.lastAccountCheck < 3_600_000) return
  state.lastAccountCheck = Date.now()
  const rows = await accountRows(targets.map(t => t.id))
  for (const t of targets) {
    const r = rows.get(t.id)
    const today = todayInTz(t.timezone, now)
    for (const a of t.accounts.filter(collectable)) {
      const need = accountNeedsBackfill({
        primary: a.primary,
        firstTaggedDay: r?.firstDay.get(a.accountId) ?? null,
        tenantHasUntaggedRows: r?.untagged ?? false,
        continuesUntagged: r?.continuing.has(a.accountId) ?? false,
        ...accountCollection(history, t.id, a.accountId),
        collectFrom: a.collectFrom, today, now,
      })
      if (!need) continue
      launch({
        tenantId: t.id, lane: 'facebook', mode: 'backfill', account: a.accountId, label: t.name,
        reason: 'conta nova', ...backfillWindow(today, a.collectFrom),
      })
    }
  }
}

// ─── In-process passes ────────────────────────────────────────────────────────

/**
 * Attribution journeys, then refunds and disputes, then one store's journey
 * history through a bulk operation (a shop allows one at a time).
 */
async function journeyCycle(): Promise<void> {
  for (const store of await journeyStores()) {
    try {
      const recent = await syncJourneys(store, { maxOrders: 60, stopAfterKnown: 15 })
      const refreshed = await refreshPendingJourneys(store, { maxOrders: 25 })
      if (recent.saved || refreshed.nowReady) {
        console.log(`[journey] ${store.shopify_domain}: novos ${recent.saved}, prontos agora ${refreshed.nowReady}`)
      }
    } catch (err) {
      console.error('[journey] falhou para', store.id, err)
    }
  }

  for (const store of await adjustmentStores()) {
    const startedAt = new Date()
    const today = todayInTz(store.timezone)
    const deep = state.lastDeepAdjust.get(store.id) !== today
    try {
      const r = await syncAdjustments(store, { sinceDays: deep ? ADJUSTMENTS_DEEP_DAYS : ADJUSTMENTS_DAYS })
      if (deep && !r.error) state.lastDeepAdjust.set(store.id, today)
      const notes = [r.skipped, r.unconverted ? `${r.unconverted} sem conversão para USD` : null].filter(Boolean).join(' · ')
      await recordRun({
        tenantId: store.id, source: 'adjustments', status: r.error ? 'error' : 'success', startedAt,
        records: r.refunds + r.disputes, mode: deep ? 'deep' : 'scheduled',
        message: [r.error, notes].filter(Boolean).join(' · ') || null,
      })
      if (r.refunds || r.disputes || r.error) {
        console.log(`[adjustments] ${store.shopify_domain}: ${r.refunds} estornos, ${r.disputes} disputas${notes ? ` · ${notes}` : ''}${r.error ? ` · ERRO ${r.error}` : ''}`)
      }
    } catch (err) {
      console.error('[adjustments] falhou para', store.id, err)
    }
  }

  const stores = await journeyStores()
  const pending = await storesNeedingBackfill(stores)
  if (pending.length > 0) {
    const r = await runBulkBackfill(pending[0])
    console.log(
      `[journey] histórico ${pending[0].shopify_domain}: ${r.orders} pedidos, ` +
      `${r.touches} toques em ${r.seconds}s${r.error ? ` · ERRO ${r.error}` : ''} ` +
      `(faltam ${pending.length - 1} lojas)`
    )
  }
}

/** Alert rules, and the daily summary once its hour has passed (late still
 *  sends: a summary missed during a redeploy beats no summary). */
async function alertCycle(): Promise<void> {
  const cfg = await getAlertConfig()
  await runAlertChecks()
  if (hourInTz() >= cfg.fromHour) await runScaleChecks()
  if (cfg.dailySummary.enabled && hourInTz() >= cfg.dailySummary.hour) await sendDailySummary()
}

/** Start the scheduler. Safe to call more than once. */
export function startAutoSync(): void {
  if (state.started) return
  if (!schedulerEnabled()) {
    console.log('[autosync] desligado (AUTO_SYNC_DISABLED=1, AUTO_SYNC_ENABLED=false ou banco somente leitura)')
    return
  }
  state.started = true
  console.log(`[autosync] shopify/${SHOPIFY_EVERY_MIN}min facebook/${FACEBOOK_EVERY_MIN}min planejador/${PLANNER_EVERY_MIN}min`)

  // Staggered first runs so a boot does not fire everything at once.
  every('shopify', SHOPIFY_EVERY_MIN, 60_000, shopifyCycle)
  every('facebook', FACEBOOK_EVERY_MIN, 150_000, facebookCycle)
  every('planner', PLANNER_EVERY_MIN, 45_000, plannerCycle)

  if (process.env.ALERTS_ENABLED !== 'false') {
    every('alerts', ALERTS_EVERY_MIN, 240_000, alertCycle)
  } else {
    console.log('[alerts] desligado via ALERTS_ENABLED=false')
  }
  if (process.env.JOURNEY_SYNC_ENABLED !== 'false') {
    every('journey', JOURNEY_EVERY_MIN, 330_000, journeyCycle)
  } else {
    console.log('[journey] desligado via JOURNEY_SYNC_ENABLED=false')
  }
}
