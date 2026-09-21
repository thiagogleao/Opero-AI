import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { getProfitSummary, getDailyProfitData } from '@/lib/profitCalc'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'

/**
 * Read-only surface for the Opero Finance desktop app.
 *
 * It exists so the desktop app does not need its own copy of the profit
 * calculation, nor database credentials. Both used to be true, and both caused
 * bugs: the app shipped a write-capable Postgres password inside the installer,
 * and its private copy of the maths silently disagreed with every other client
 * once the supplier rate card landed.
 *
 * Auth reuses MOBILE_ACCESS_TOKEN (lib/mobileAuth.ts) rather than inventing a
 * second secret: this app spans every store, exactly like the mobile PWA, so
 * the same owner-only credential is the right one and there is only one thing
 * to rotate.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const { searchParams } = new URL(req.url)
  const action   = searchParams.get('action')
  const tenantId = searchParams.get('tenantId')
  const from     = searchParams.get('from')
  const to       = searchParams.get('to')

  // ── List all tenants ───────────────────────────────────────────────────────
  if (action === 'tenants') {
    const rows = await query<{
      id: string; shopify_domain: string; shop_name: string | null; timezone: string | null
    }>(
      `SELECT id, shopify_domain, shop_name, COALESCE(timezone, 'UTC') AS timezone
       FROM tenants ORDER BY created_at`
    )
    return Response.json(rows)
  }

  // ── Profit summary for one tenant ──────────────────────────────────────────
  if (action === 'stats') {
    if (!tenantId || !from || !to) return Response.json({ error: 'Missing params' }, { status: 400 })
    return Response.json(await getProfitSummary(tenantId, from, to))
  }

  // ── Profit summary for every tenant ────────────────────────────────────────
  if (action === 'all-stats') {
    if (!from || !to) return Response.json({ error: 'Missing params' }, { status: 400 })
    const rows = await query<{ id: string }>(`SELECT id FROM tenants ORDER BY created_at`)
    // One bad store must not blank the whole dashboard, so failures are
    // reported per row instead of rejecting the batch.
    const results = await Promise.all(
      rows.map(r =>
        getProfitSummary(r.id, from, to)
          .then(s => ({ tenantId: r.id, error: false, ...s }))
          .catch(err => {
            console.error('[desktop] summary failed for', r.id, err)
            return { tenantId: r.id, error: true }
          })
      )
    )
    return Response.json(results)
  }

  // ── Daily profit series for one tenant ─────────────────────────────────────
  if (action === 'daily') {
    if (!tenantId || !from || !to) return Response.json({ error: 'Missing params' }, { status: 400 })
    return Response.json(await getDailyProfitData(tenantId, from, to))
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
