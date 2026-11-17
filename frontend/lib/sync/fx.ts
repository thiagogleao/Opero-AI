import { query } from '../db'
import { shiftDate } from '../engine/dates'

/**
 * USD per unit of `currency` on `day`, from the fx_rates table the Python
 * collector fills (Frankfurter/ECB). Weekends and holidays inherit the last
 * published rate, exactly like the collector, so the webhook and the
 * collector convert the same order to the same dollars.
 *
 * With `fetchMissing`, a currency the table lacks (a dispute in rupees on a
 * dollar store) is fetched from Frankfurter and cached in fx_rates. Null when
 * no rate is known — the caller must then refuse, never guess.
 */
export async function usdRate(
  currency: string | null | undefined, day: string, opts: { fetchMissing?: boolean } = {},
): Promise<number | null> {
  const cur = (currency || 'USD').toUpperCase()
  if (cur === 'USD') return 1
  const fromDb = await storedRate(cur, day)
  if (fromDb !== null || !opts.fetchMissing) return fromDb
  await fetchFrankfurter(cur, shiftDate(day, -10), day)
  return storedRate(cur, day)
}

async function storedRate(cur: string, day: string): Promise<number | null> {
  const rows = await query<{ usd_rate: string }>(
    `SELECT usd_rate::text FROM fx_rates
      WHERE currency = $1 AND date <= $2::date AND date > $2::date - 10
      ORDER BY date DESC LIMIT 1`,
    [cur, day],
  )
  const r = Number(rows[0]?.usd_rate)
  return Number.isFinite(r) && r > 0 ? r : null
}

/** Same source and table as app/collectors/fx.py. ECB currencies only. */
async function fetchFrankfurter(cur: string, from: string, to: string): Promise<void> {
  try {
    const res = await fetch(`https://api.frankfurter.app/${from}..${to}?from=${encodeURIComponent(cur)}&to=USD`,
      { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return
    const body = await res.json() as { rates?: Record<string, { USD?: number }> }
    const rows = Object.entries(body.rates ?? {}).filter(([, v]) => v?.USD && v.USD > 0)
    for (const [d, v] of rows) {
      await query(
        `INSERT INTO fx_rates (date, currency, usd_rate, source) VALUES ($1::date, $2, $3, 'frankfurter')
         ON CONFLICT (date, currency) DO NOTHING`,
        [d, cur, v.USD],
      )
    }
  } catch (err) {
    console.warn(`[fx] ${cur}: cotação indisponível —`, (err as Error).message)
  }
}
