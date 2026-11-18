import { hasMobileSession } from '@/lib/mobileAuth'
import { listStores, type StoreRef } from '@/lib/access'
import { toOption } from '@/lib/views/mobile'
import { REFERENCE_TZ } from '@/lib/engine/dates'
import { loadSharedPairs, SHARED_LOOKBACK_DAYS } from '@/components/portfolio/data'
import { sharedAccountBadges } from '@/components/portfolio/model'
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
  return (
    <MobileApp
      stores={active.map(toOption)}
      archived={all.filter(x => x.archived).map(toOption)}
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
  const pairs = await loadSharedPairs(active, REFERENCE_TZ, new Date())
  const lookback = `Nos últimos ${SHARED_LOOKBACK_DAYS} dias`
  const badges = Object.fromEntries(active
    .map(st => [st.id, sharedAccountBadges(st.id, pairs, lookback)] as const)
    .filter(([, b]) => b.length > 0))
  return { pairs, badges, lookbackDays: SHARED_LOOKBACK_DAYS }
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
