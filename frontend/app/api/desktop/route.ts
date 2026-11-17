import { query } from '@/lib/db'
import { getProfitSummary, getDailyProfitData, toProfitSummary } from '@/lib/profitCalc'
import { computePnL } from '@/lib/engine/pnl'
import { isIsoDate } from '@/lib/engine/dates'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'

/**
 * Read-only surface for the Opero Finance desktop app.
 *
 * It exists so the desktop app does not need its own copy of the profit
 * calculation, nor database credentials. Both used to be true, and both caused
 * bugs: the app shipped a write-capable Postgres password inside the installer,
 * and its private copy of the maths silently disagreed with every other client.
 *
 * THE RESPONSE SHAPES ARE A CONTRACT: the installed desktop app parses them and
 * is out of scope for changes. Numbers come from the profit engine through the
 * lib/profitCalc compatibility shapes (ProfitSummary, DailyProfitPoint).
 *
 * Auth reuses MOBILE_ACCESS_TOKEN (lib/mobileAuth.ts): this app spans every
 * store, exactly like the phone, so the same owner-only credential applies.
 * Archived stores are left out of `tenants` and `all-stats` (the owner's
 * decision: out of every store list and total); `stats` and `daily` still
 * answer for one by id, which is history, not a list.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bad = () => Response.json({ error: 'Missing params' }, { status: 400 })

async function activeTenants() {
  return query<{ id: string; shopify_domain: string; shop_name: string | null; timezone: string }>(
    `SELECT id, shopify_domain, shop_name, COALESCE(timezone, 'UTC') AS timezone
       FROM tenants
      WHERE archived_at IS NULL AND shopify_domain IS NOT NULL
      ORDER BY created_at`,
  )
}

export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const tenantId = searchParams.get('tenantId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  // Dates are validated before they reach SQL, where a typo used to be a 500.
  const datesOk = isIsoDate(from) && isIsoDate(to)

  try {
    // ── Active tenants: [{ id, shopify_domain, shop_name, timezone }] ────────
    if (action === 'tenants') {
      return Response.json(await activeTenants())
    }

    // ── ProfitSummary for one tenant ─────────────────────────────────────────
    if (action === 'stats') {
      if (!tenantId || !datesOk) return bad()
      return Response.json(await getProfitSummary(tenantId, from, to))
    }

    // ── [{ tenantId, error, ...ProfitSummary }] for every active tenant ──────
    if (action === 'all-stats') {
      if (!datesOk) return bad()
      const rows = await activeTenants()
      const ids = rows.map(r => r.id)
      try {
        // One engine pass prices every store (five queries, not five per store).
        const pnl = await computePnL(ids, { from, to })
        return Response.json(rows.map(r => {
          const p = pnl.get(r.id)
          return p
            ? { tenantId: r.id, error: false, ...toProfitSummary(p.totals, p.configured) }
            : { tenantId: r.id, error: true }
        }))
      } catch (err) {
        // The batch failed: fall back to one store at a time, so one bad
        // store cannot blank the whole dashboard.
        console.error('[desktop] all-stats batch failed, retrying per store', err)
        return Response.json(await Promise.all(rows.map(r =>
          getProfitSummary(r.id, from, to)
            .then(s => ({ tenantId: r.id, error: false, ...s }))
            .catch(e => {
              console.error('[desktop] summary failed for', r.id, e)
              return { tenantId: r.id, error: true }
            }),
        )))
      }
    }

    // ── { configured, dailyData: DailyProfitPoint[] } for one tenant ─────────
    if (action === 'daily') {
      if (!tenantId || !datesOk) return bad()
      return Response.json(await getDailyProfitData(tenantId, from, to))
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error(`[desktop] ${action} failed`, err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
