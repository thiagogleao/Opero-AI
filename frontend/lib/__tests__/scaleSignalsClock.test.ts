/**
 * period-fix-r2 F24: the scale push judges the decision window of the SAME
 * instant its link's dates come from (lib/alerts runScaleChecks passes its one
 * `now`), never a second clock read per store — a run crossing Hibikura's
 * midnight (12:00 BRT) judged 18–24 nov but linked 17–23 nov.
 */

import { describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({ windows: [] as { from: string; to: string }[] }))
vi.mock('../data/campaigns', () => ({
  getCampaignReport: vi.fn(async (_store: unknown, window: { from: string; to: string }) => {
    seen.windows.push(window)
    return { campaigns: [] }
  }),
}))
vi.mock('../engine/pnl', () => ({ loadStores: vi.fn(async () => []) }))

import { getCampaignSignals, DEFAULT_SCALE_CONFIG } from '../scaleSignals'
import { decisionWindow } from '../period/decision'

describe('F24 · scale signals on the injected clock', () => {
  it('judges decisionWindow(tz, now) for the now it is given', async () => {
    // 11:59:59 BRT: Tokyo is still on 24 nov — the window ends 23 nov, as the
    // link written with the same instant does.
    const now = new Date('2026-11-24T14:59:59.000Z')
    await getCampaignSignals('hibikura', DEFAULT_SCALE_CONFIG, 'Asia/Tokyo', now)
    expect(seen.windows[0]).toEqual(decisionWindow('Asia/Tokyo', now).window)
    expect(seen.windows[0]).toEqual({ from: '2026-11-17', to: '2026-11-23' })
  })
})
