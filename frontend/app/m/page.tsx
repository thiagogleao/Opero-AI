import { hasMobileSession } from '@/lib/mobileAuth'
import { listStores, type StoreRef } from '@/lib/access'
import { toOption } from '@/lib/views/mobile'
import { REFERENCE_TZ } from '@/lib/engine/dates'
import { loadSharedPairs, SHARED_LOOKBACK_DAYS } from '@/components/portfolio/data'
import { sharedAccountBadges } from '@/components/portfolio/model'
import { loadFirstOrderDates } from '@/lib/views/portfolio'
import { viewerStoresOf } from '@/lib/views/periodFacts'
import MobileApp from './MobileApp'
import type { SharedAds } from './_lib/sharedAds'
import s from './m.module.css'

// Auth is per request (cookie): never cached or prerendered.
export const dynamic = 'force-dynamic'

/**
 * /m — Opero Mobile, the owner's phone. The page only checks the session and
 * hands the client the store list (so the chips draw at once); the numbers
 * come from GET /api/mobile, polled by the client, because the selection
 * lives on the phone (URL + localStorage) and the server cannot know it.
 */
export default async function MobilePage() {
  if (!(await hasMobileSession())) return <Denied />
  const all = await listStores({ kind: 'owner' }, { includeArchived: true })
  const active = all.filter(x => !x.archived)
  // The store facts the period rules resolve with (archive instants, first
  // dates): the phone labels a pick while it loads and schedules its turns
  // with them (lib/period R19). The page reads no searchParams.
  const facts = await viewerStoresOf(all)
  return (
    <MobileApp
      stores={active.map(toOption)}
      archived={all.filter(x => x.archived).map(toOption)}
      facts={facts}
      // Not awaited: the chips draw at once and the pairing arrives after.
      sharedAds={loadSharedAds(active)}
    />
  )
}

/**
 * Stores that sell on ads billed to another store (CAMP HALLOW on EPOCH's
 * account): the same 90-day pairs, threshold and badge words as "Todas as
 * lojas" on the desktop (components/portfolio). A property of the stores, not
 * of the window, so it is read once per visit. Never rejects: a failed read
 * is no pair (loadSharedPairs logs it).
 */
async function loadSharedAds(active: StoreRef[]): Promise<SharedAds> {
  const pairs = await loadSharedPairs(active, REFERENCE_TZ, new Date()) // clock-ok: server render instant
  const lookback = `Nos últimos ${SHARED_LOOKBACK_DAYS} dias`
  const badges = Object.fromEntries(active
    .map(st => [st.id, sharedAccountBadges(st.id, pairs, lookback)] as const)
    .filter(([, b]) => b.length > 0))
  // The sales stores' first sale: a window before it (CAMP HALLOW before
  // 24 jul 2026) was not mixed, and there is no "antes" to add up. A failed
  // read keeps the 90-day wording.
  const firstSales = Object.fromEntries(await loadFirstOrderDates([...new Set(pairs.map(p => p.salesStoreId))])
    .catch(err => { console.error('[m] first sales', err); return new Map<string, string>() }))
  return { pairs, badges, lookbackDays: SHARED_LOOKBACK_DAYS, firstSales }
}

/**
 * Anyone without the session cookie. Says nothing about what this is or which
 * stores exist: the only way in is the magic link, which the owner has.
 */
function Denied() {
  return (
    <div className={s.root}>
      <div className={s.gate}>
        <p>Acesso restrito</p>
        <p>Abra o link de acesso neste aparelho.</p>
      </div>
    </div>
  )
}
