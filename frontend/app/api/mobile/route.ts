import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { listStores } from '@/lib/access'
import { isIsoDate, isPeriod } from '@/lib/engine/dates'
import { buildPortfolio, COMPARE_AS, PortfolioInputError } from '@/lib/views/portfolio'
import { tooEarlyRangeError } from '@/lib/views/portfolioLimits'
import {
  portfolioOnce, selectStores, StoreSelectionError, toOption, type MobileResponse,
} from '@/lib/views/mobile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The phone's home screen: GET /api/mobile?period=&store=&from=&to=
 *
 *  period  a preset from lib/engine/dates PERIODS (default 'today'); 'custom'
 *          requires from and to (YYYY-MM-DD).
 *  store   'all' (default: every active store) or one or more store ids,
 *          comma-separated.
 *  compare optional, with 'custom' only: 'mtd' or 'lastmonth' compares the
 *          dates by that preset's rule (lib/views/portfolio compareAs).
 *
 * Answers with lib/views/mobile.ts MobileResponse: the portfolio view built on
 * the profit engine, the request echoed back, and the store picker.
 *
 * Owner only (the magic-link cookie or the x-mobile-token header): this surface
 * spans every store, so a partner's Clerk session gets nothing here.
 */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const sp = new URL(req.url).searchParams
  const period = sp.get('period') ?? 'today'
  if (!isPeriod(period)) return Response.json({ error: 'Período inválido' }, { status: 400 })
  const from = sp.get('from') || null
  const to = sp.get('to') || null
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    return Response.json({ error: 'Data inválida' }, { status: 400 })
  }
  // "Escolher datas" before both dates are picked: an answer for today would
  // silently replace whatever is on screen, so say what is missing instead.
  if (period === 'custom' && !(from && to)) {
    return Response.json({ error: 'Escolha a data inicial e a final' }, { status: 400 })
  }
  // Longer or older ranges are cut by buildPortfolio (rangeNote); one that
  // ends before anything is priced has nothing to cut down to.
  const early = period === 'custom' ? tooEarlyRangeError(from, to) : null
  if (early) return Response.json({ error: early }, { status: 400 })

  // Custom dates a store row opened from "Este mês" / "Mês passado" are
  // compared by that preset's rule (app/m/_lib/selection compareAsOf).
  const compare = sp.get('compare')
  const compareAs = period === 'custom' && isPeriod(compare) && COMPARE_AS.includes(compare) ? compare : null

  try {
    const visible = await listStores({ kind: 'owner' }, { includeArchived: true })
    const { key, stores } = selectStores(sp.get('store'), visible)
    const custom = period === 'custom'
    // portfolioOnce shares in-flight answers by store and dates only: an
    // answer compared as a preset is built on its own (rare: row dates only).
    const view = compareAs
      ? await buildPortfolio(stores, period, from, to, new Date(), { compareAs })
      : await portfolioOnce(key, stores, period, custom ? from : null, custom ? to : null)
    const body: MobileResponse = {
      ...view,
      request: { store: key, period, from: custom ? from : null, to: custom ? to : null },
      storeOptions: visible.filter(s => !s.archived).map(toOption),
      archivedStores: visible.filter(s => s.archived).map(toOption),
    }
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof StoreSelectionError) return Response.json({ error: err.message }, { status: err.status })
    if (err instanceof PortfolioInputError) return Response.json({ error: err.message }, { status: 400 })
    console.error('[mobile] portfolio failed', err)
    return Response.json({ error: 'Falha ao calcular os números' }, { status: 500 })
  }
}
