import { hasMobileSession } from '@/lib/mobileAuth'
import { listStores } from '@/lib/access'
import { toOption } from '@/lib/views/mobile'
import MobileApp from './MobileApp'
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
  return (
    <MobileApp
      stores={all.filter(x => !x.archived).map(toOption)}
      archived={all.filter(x => x.archived).map(toOption)}
    />
  )
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
