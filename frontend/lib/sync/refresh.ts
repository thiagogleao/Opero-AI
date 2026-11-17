import { requireStore, resolveStore, AccessError, type Viewer } from '../access'
import { isIsoDate, shiftDate, todayInTz } from '../engine/dates'
import { laneBusy, launch, syncAllowed, type LaunchResult } from './jobs'
import { backfillWindow, incrementalWindow, refreshDecision, type Lane, type SyncJob } from './plan'
import { collectable, laneHistory, loadTargets, normalizeAccount, runHistory } from './runs'

/**
 * "Atualizar": run what the viewer asked for, for stores the viewer may see,
 * and nothing else.
 *
 * The old route synced the active store in full plus every other store of the
 * account, on every click and every dashboard mount. Now a request names its
 * stores and sources; a lane already running or that succeeded under two
 * minutes ago is not started again (the answer says so); archived stores are
 * refused; a store without an ad account gets no Meta job. Explicit dates
 * (a backfill) skip the debounce.
 */

export type RefreshSource = 'shopify' | 'facebook' | 'structure'

export interface RefreshRequest {
  /** Stores to refresh; empty = the viewer's current store. */
  storeIds?: string[]
  /** Default: shopify + facebook. 'structure' = campaigns/ads + breakdowns. */
  sources?: RefreshSource[]
  /** YYYY-MM-DD, store-local. Both or neither. */
  dateFrom?: string
  dateTo?: string
  /** Meta only: just this ad account (a newly attached one). */
  account?: string
}

export interface RefreshJobResult {
  storeId: string
  storeName: string
  source: RefreshSource
  /** started/queued/merged: a job will run. running: one already is.
   *  fresh: succeeded under 2 minutes ago. skipped: nothing to collect. */
  state: LaunchResult | 'running' | 'fresh' | 'skipped'
  from: string | null
  to: string | null
  /** Why it was skipped, in Portuguese. */
  note?: string
}

export interface RefreshResponse {
  started: boolean
  jobs: RefreshJobResult[]
  // Legacy fields kept for RefreshButton until the UI phase.
  shopifyDateFrom: string | null
  facebookDateFrom: string | null
  dateTo: string | null
  storeTimezone: string | null
  otherStoresCount: number
}

export class RefreshInputError extends Error {}
/** This server does not start collectors (local run or read-only database). */
export class SyncDisabledError extends RefreshInputError {}

/** Longest backfill a click may ask for. */
const MAX_RANGE_DAYS = 400

export async function requestRefresh(viewer: Viewer, req: RefreshRequest, now: Date = new Date()): Promise<RefreshResponse> {
  if (!syncAllowed()) throw new SyncDisabledError('Sincronização desligada neste ambiente')
  const sources: RefreshSource[] = req.sources?.length ? [...new Set(req.sources)] : ['shopify', 'facebook']
  if (sources.some(s => !['shopify', 'facebook', 'structure'].includes(s))) throw new RefreshInputError('Fonte inválida')
  const explicit = req.dateFrom !== undefined || req.dateTo !== undefined
  if (explicit && !(isIsoDate(req.dateFrom) && (req.dateTo === undefined || isIsoDate(req.dateTo)))) {
    throw new RefreshInputError('Datas inválidas (use AAAA-MM-DD)')
  }

  // Which stores: each must be visible to the viewer and not archived.
  let refs
  if (req.storeIds?.length) {
    refs = await Promise.all([...new Set(req.storeIds)].map(id => requireStore(viewer, id)))
  } else {
    const { store } = await resolveStore(viewer, null)
    if (!store) throw new AccessError(404)
    refs = [store]
  }
  const archived = refs.filter(r => r.archived)
  if (archived.length) throw new RefreshInputError(`Loja arquivada não sincroniza: ${archived.map(a => a.name).join(', ')}`)

  const targets = await loadTargets(refs.map(r => r.id))
  const history = await runHistory(targets.map(t => t.id))
  const jobs: RefreshJobResult[] = []

  for (const t of targets) {
    const name = refs.find(r => r.id === t.id)?.name ?? t.name
    const today = todayInTz(t.timezone, now)
    const to = explicit ? (req.dateTo ?? today) : today
    if (explicit) {
      if (req.dateFrom! > to) throw new RefreshInputError('A data inicial é depois da final')
      if (req.dateFrom! < shiftDate(today, -MAX_RANGE_DAYS)) throw new RefreshInputError(`No máximo ${MAX_RANGE_DAYS} dias para trás`)
    }
    for (const source of sources) {
      const lane: Lane = source === 'shopify' ? 'shopify' : source === 'facebook' ? 'facebook' : 'facebook_structure'
      if (lane === 'shopify' && !t.hasShopify) {
        jobs.push({ storeId: t.id, storeName: name, source, state: 'skipped', from: null, to: null, note: 'Loja sem credenciais da Shopify' })
        continue
      }
      let account: string | undefined
      if (lane !== 'shopify') {
        const usable = t.accounts.filter(collectable)
        account = req.account ? normalizeAccount(req.account) : undefined
        if (account && !t.accounts.some(a => a.accountId === account)) {
          throw new RefreshInputError('Conta de anúncio não pertence a esta loja')
        }
        if (!usable.length || (account && !usable.some(a => a.accountId === account))) {
          jobs.push({ storeId: t.id, storeName: name, source, state: 'skipped', from: null, to: null,
            note: t.accounts.length ? 'Conta de anúncio desativada ou pausada' : 'Loja sem conta de anúncio' })
          continue
        }
      }
      const h = laneHistory(history, t.id, lane)
      const decision = refreshDecision({ busy: laneBusy(t.id, lane), lastSuccessAt: h.success, now, explicitRange: explicit })
      const lastDay = h.success ? todayInTz(t.timezone, h.success) : null
      // A lane that never succeeded is a new store (onboarding's first sync):
      // it gets the history a new store needs, not the last three days — the
      // scheduler only backfills a store it has never seen succeed, and this
      // click would otherwise be that first success.
      const firstSync = !explicit && !h.success && lane !== 'facebook_structure'
      const window = explicit ? { from: req.dateFrom!, to }
        : lane === 'facebook_structure' ? { from: shiftDate(today, -2), to: today }
        : firstSync ? backfillWindow(today, null)
        : incrementalWindow(today, lastDay)
      if (decision !== 'launch') {
        jobs.push({ storeId: t.id, storeName: name, source, state: decision, from: window.from, to: window.to })
        continue
      }
      const job: SyncJob = {
        tenantId: t.id, lane, label: t.name, account,
        mode: lane === 'shopify' ? (explicit || firstSync ? 'backfill' : 'refresh')
          : lane === 'facebook' ? (explicit || firstSync ? 'backfill' : 'quick') : 'structure',
        from: window.from, to: window.to, reason: explicit ? 'período pedido' : firstSync ? 'loja nova' : 'atualizar',
      }
      jobs.push({ storeId: t.id, storeName: name, source, state: launch(job), from: window.from, to: window.to })
    }
  }

  const first = targets[0]
  const pick = (s: RefreshSource) => jobs.find(j => j.storeId === first?.id && j.source === s)?.from ?? null
  return {
    started: jobs.some(j => j.state !== 'skipped'),
    jobs,
    shopifyDateFrom: pick('shopify'),
    facebookDateFrom: pick('facebook'),
    dateTo: jobs.find(j => j.storeId === first?.id)?.to ?? null,
    storeTimezone: first?.timezone ?? null,
    otherStoresCount: Math.max(0, targets.length - 1),
  }
}
