import { describe, expect, it } from 'vitest'
import {
  accountNeedsBackfill, backfillWindow, cliArgs, dueMetaPasses, incrementalWindow, jobTimeoutMs,
  mergeJobs, refreshDecision, shopifyRepairDue, staleness, type SyncJob,
} from '../plan'

const H = 3_600_000
const job = (o: Partial<SyncJob>): SyncJob => ({
  tenantId: 't', lane: 'facebook', mode: 'quick', from: '2026-11-15', to: '2026-11-17', reason: 'agendado', ...o,
})

describe('windows', () => {
  it('routine pass covers today and two days back', () => {
    expect(incrementalWindow('2026-11-17', '2026-11-17')).toEqual({ from: '2026-11-15', to: '2026-11-17' })
  })
  it('widens back to the day before the last success after an outage', () => {
    expect(incrementalWindow('2026-11-17', '2026-11-12')).toEqual({ from: '2026-11-11', to: '2026-11-17' })
  })
  it('caps catch-up at 30 days', () => {
    expect(incrementalWindow('2026-11-17', '2026-08-01').from).toBe('2026-10-18')
  })
  it('backfill stops at the account cut', () => {
    expect(backfillWindow('2026-11-17', '2026-11-04')).toEqual({ from: '2026-11-04', to: '2026-11-17' })
    expect(backfillWindow('2026-11-17', null).from).toBe('2026-08-20')
    expect(backfillWindow('2026-11-17', '2025-01-01').from).toBe('2026-08-20')
  })
})

describe('mergeJobs', () => {
  it('keeps one job with the wider window and stronger mode', () => {
    const m = mergeJobs(job({}), job({ mode: 'repull28', from: '2026-10-20', to: '2026-11-16', reason: '28 dias' }))
    expect(m).toMatchObject({ mode: 'repull28', from: '2026-10-20', to: '2026-11-17', reason: 'agendado + 28 dias' })
  })
  it('collects every account unless both asked for the same one', () => {
    expect(mergeJobs(job({ account: 'act_1' }), job({ account: 'act_1' })).account).toBe('act_1')
    expect(mergeJobs(job({ account: 'act_1' }), job({})).account).toBeUndefined()
  })
  it('ranks shopify modes', () => {
    const s = (mode: SyncJob['mode']) => job({ lane: 'shopify', mode })
    expect(mergeJobs(s('scheduled'), s('backfill')).mode).toBe('backfill')
    expect(mergeJobs(s('refresh'), s('scheduled')).mode).toBe('refresh')
  })
  it('refuses to merge different lanes', () => {
    expect(() => mergeJobs(job({}), job({ lane: 'shopify' }))).toThrow()
  })
})

describe('cliArgs and timeouts', () => {
  it('maps lanes to collector arguments', () => {
    expect(cliArgs(job({ lane: 'facebook_structure', mode: 'structure', account: 'act_9' })))
      .toEqual(['--tenant', 't', '--source', 'facebook', '--mode', 'structure', '--date-from', '2026-11-15', '--date-to', '2026-11-17', '--account', 'act_9'])
    expect(cliArgs(job({ lane: 'shopify', mode: 'scheduled', account: 'act_9' }))).not.toContain('--account')
  })
  it('gives long backfills more time, within an hour', () => {
    expect(jobTimeoutMs(job({}))).toBe(10 * 60_000)
    expect(jobTimeoutMs(job({ mode: 'backfill', from: '2026-08-20' }))).toBeGreaterThan(40 * 60_000)
    expect(jobTimeoutMs(job({ mode: 'backfill', from: '2025-01-01' }))).toBe(60 * 60_000)
  })
})

describe('dueMetaPasses', () => {
  const now = new Date('2026-11-17T12:00:00Z')
  const base = {
    now, today: '2026-11-17', localHour: 9, dayOf: (d: Date) => d.toISOString().slice(0, 10),
    structure: { success: new Date(now.getTime() - H), attempt: new Date(now.getTime() - H) },
    repull7: { success: new Date('2026-11-17T07:00:00Z'), attempt: new Date('2026-11-17T07:00:00Z') },
    repull28: { success: new Date('2026-11-14T07:00:00Z'), attempt: new Date('2026-11-14T07:00:00Z') },
  }
  it('nothing due when everything is recent', () => {
    expect(dueMetaPasses(base)).toEqual([])
  })
  it('structure every 4 hours', () => {
    const p = dueMetaPasses({ ...base, structure: { success: new Date(now.getTime() - 5 * H), attempt: new Date(now.getTime() - 5 * H) } })
    expect(p).toEqual([{ lane: 'facebook_structure', mode: 'structure', from: '2026-11-15', to: '2026-11-17', reason: 'estrutura' }])
  })
  it('does not hammer a failing structure pass', () => {
    const p = dueMetaPasses({ ...base, structure: { success: null, attempt: new Date(now.getTime() - 10 * 60_000) } })
    expect(p).toEqual([])
  })
  it('nightly 7-day re-pull of complete days, after 03:00 local', () => {
    const y = { ...base, repull7: { success: new Date('2026-11-16T07:00:00Z'), attempt: new Date('2026-11-16T07:00:00Z') } }
    expect(dueMetaPasses(y)).toEqual([{ lane: 'facebook', mode: 'repull7', from: '2026-11-10', to: '2026-11-16', reason: '7 dias' }])
    expect(dueMetaPasses({ ...y, localHour: 2 })).toEqual([])
  })
  it('weekly 28-day re-pull replaces the nightly one', () => {
    const w = { ...base, repull28: { success: new Date('2026-11-09T07:00:00Z'), attempt: new Date('2026-11-09T07:00:00Z') } }
    expect(dueMetaPasses(w)).toEqual([{ lane: 'facebook', mode: 'repull28', from: '2026-10-20', to: '2026-11-16', reason: '28 dias' }])
  })
  it('a fresh store with no history gets structure and the weekly re-pull', () => {
    const none = { success: null, attempt: null }
    const p = dueMetaPasses({ ...base, structure: none, repull7: none, repull28: none })
    expect(p.map(x => x.mode)).toEqual(['structure', 'repull28'])
  })
})

describe('account backfill', () => {
  const now = new Date('2026-11-17T12:00:00Z')
  const fresh = {
    primary: false, firstTaggedDay: null, tenantHasUntaggedRows: true, continuesUntagged: false,
    earliestCollectedFrom: null, lastBackfillAttempt: null, collectFrom: null, today: '2026-11-17', now,
  }
  it('a new extra account is backfilled even after the routine pass already collected it', () => {
    expect(accountNeedsBackfill(fresh)).toBe(true)
    // The 30-minute pass ran first: rows and a successful run for the last 3 days only.
    expect(accountNeedsBackfill({ ...fresh, firstTaggedDay: '2026-11-15', earliestCollectedFrom: '2026-11-15' })).toBe(true)
  })
  it('stops once history reaches the floor or the cut', () => {
    expect(accountNeedsBackfill({ ...fresh, earliestCollectedFrom: '2026-08-20' })).toBe(false)
    expect(accountNeedsBackfill({ ...fresh, collectFrom: '2026-11-04', earliestCollectedFrom: '2026-11-04' })).toBe(false)
  })
  it('an account with older tagged rows is not new (Dumpling extra since June, EPOCH extra since its cut)', () => {
    expect(accountNeedsBackfill({ ...fresh, firstTaggedDay: '2026-06-18' })).toBe(false)
    expect(accountNeedsBackfill({ ...fresh, collectFrom: '2026-11-15', firstTaggedDay: '2026-11-15' })).toBe(false)
  })
  it('a main account continuing untagged history is not new; a switched one is', () => {
    const main = { ...fresh, primary: true }
    expect(accountNeedsBackfill(main)).toBe(false) // no tagged rows yet: wait
    expect(accountNeedsBackfill({ ...main, firstTaggedDay: '2026-11-15', continuesUntagged: true })).toBe(false)
    expect(accountNeedsBackfill({ ...main, firstTaggedDay: '2026-11-15', continuesUntagged: false })).toBe(true)
    expect(accountNeedsBackfill({ ...main, tenantHasUntaggedRows: false })).toBe(true) // a new store
  })
  it('does not retry a failing backfill every hour', () => {
    expect(accountNeedsBackfill({ ...fresh, lastBackfillAttempt: new Date(now.getTime() - 2 * H) })).toBe(false)
    expect(accountNeedsBackfill({ ...fresh, lastBackfillAttempt: new Date(now.getTime() - 7 * H) })).toBe(true)
  })
})

describe('refresh debounce and staleness', () => {
  const now = new Date('2026-11-17T12:00:00Z')
  it('does not relaunch a busy or just-finished lane, unless a period was asked', () => {
    expect(refreshDecision({ busy: true, lastSuccessAt: null, now, explicitRange: false })).toBe('running')
    expect(refreshDecision({ busy: false, lastSuccessAt: new Date(now.getTime() - 60_000), now, explicitRange: false })).toBe('fresh')
    expect(refreshDecision({ busy: false, lastSuccessAt: new Date(now.getTime() - 60_000), now, explicitRange: true })).toBe('launch')
    expect(refreshDecision({ busy: false, lastSuccessAt: new Date(now.getTime() - 5 * 60_000), now, explicitRange: false })).toBe('launch')
  })
  it('colours freshness per lane', () => {
    expect(staleness('shopify', new Date(now.getTime() - 10 * 60_000), now)).toBe('ok')
    expect(staleness('shopify', new Date(now.getTime() - 30 * 60_000), now)).toBe('amber')
    expect(staleness('shopify', new Date(now.getTime() - 2 * H), now)).toBe('red')
    expect(staleness('facebook', new Date(now.getTime() - 30 * 60_000), now)).toBe('ok')
    expect(staleness('shopify', null, now)).toBe('unknown')
  })
})

describe('shopify monthly repair', () => {
  const now = new Date('2026-11-17T12:00:00Z')
  it('runs at night when no 90-day re-read happened in 30 days', () => {
    expect(shopifyRepairDue({ now, localHour: 4, backfill: { success: null, attempt: null } })).toBe(true)
    expect(shopifyRepairDue({ now, localHour: 1, backfill: { success: null, attempt: null } })).toBe(false)
    expect(shopifyRepairDue({ now, localHour: 4, backfill: { success: new Date('2026-11-01T00:00:00Z'), attempt: new Date('2026-11-01T00:00:00Z') } })).toBe(false)
    expect(shopifyRepairDue({ now, localHour: 4, backfill: { success: null, attempt: new Date(now.getTime() - 10 * 60_000) } })).toBe(false)
  })
})
