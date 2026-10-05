// Fills shopify_orders.browser_ip / user_agent / accept_language from Shopify.
//
// Visa's Compelling Evidence 3.0 shifts liability on a 10.4 fraud dispute when
// two prior undisputed orders, 120 to 365 days before the dispute, match the
// disputed one on purchase IP or device. The IP therefore has to already be on
// record long before a dispute exists. Going back and fetching it now is what
// makes the defence usable this year instead of next.
//
//   node --env-file=../.env backfill_order_ip.mjs [--days 400] [--store <domain>] [--dry]
import pg from 'pg'

const API = '2026-01'
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const DAYS = Number(arg('days', 400))
const ONLY = arg('store', null)
const DRY = process.argv.includes('--dry')

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
})

const since = new Date(Date.now() - DAYS * 86400_000).toISOString()

const { rows: tenants } = await pool.query(
  `SELECT id, shopify_domain, COALESCE(shop_name, shopify_domain) AS name, shopify_access_token AS tok
     FROM tenants WHERE shopify_access_token IS NOT NULL ORDER BY created_at`
)

let grandSeen = 0, grandFilled = 0

for (const t of tenants) {
  if (ONLY && !t.shopify_domain.includes(ONLY)) continue

  // Only ask for what we need: the payload is otherwise enormous and slow.
  let url = `https://${t.shopify_domain}/admin/api/${API}/orders.json`
    + `?status=any&limit=250&created_at_min=${encodeURIComponent(since)}`
    + `&fields=id,created_at,browser_ip,client_details`

  let seen = 0, withIp = 0, written = 0, pages = 0, oldest = null

  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': t.tok } })

    if (res.status === 429) {
      // Shopify's leaky bucket. Wait exactly as long as it says, then retry the
      // same page rather than skipping it.
      const wait = Number(res.headers.get('Retry-After') ?? 2)
      await new Promise(r => setTimeout(r, wait * 1000))
      continue
    }
    if (!res.ok) {
      console.error(`  ${t.name}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`)
      break
    }

    const { orders = [] } = await res.json()
    pages++
    seen += orders.length

    const updates = []
    for (const o of orders) {
      if (o.created_at && (!oldest || o.created_at < oldest)) oldest = o.created_at
      const ip = o.browser_ip || o.client_details?.browser_ip || null
      const ua = o.client_details?.user_agent || null
      const lang = o.client_details?.accept_language || null
      if (!ip && !ua && !lang) continue
      withIp++
      updates.push([String(o.id), ip, ua, lang])
    }

    if (updates.length && !DRY) {
      // One statement per page. unnest keeps it to a single round trip, and the
      // COALESCE means a null from Shopify never erases something already held.
      const r = await pool.query(
        `UPDATE shopify_orders o
            SET browser_ip      = COALESCE(u.ip,   o.browser_ip),
                user_agent      = COALESCE(u.ua,   o.user_agent),
                accept_language = COALESCE(u.lang, o.accept_language)
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
                AS u(order_id, ip, ua, lang)
          WHERE o.order_id = u.order_id AND o.tenant_id = $5`,
        [updates.map(u => u[0]), updates.map(u => u[1]),
         updates.map(u => u[2]), updates.map(u => u[3]), t.id]
      )
      written += r.rowCount
    }

    // Cursor pagination: the next page only exists in the Link header.
    const link = res.headers.get('link') ?? ''
    const next = link.split(',').find(p => p.includes('rel="next"'))
    url = next ? next.slice(next.indexOf('<') + 1, next.indexOf('>')) : null

    await new Promise(r => setTimeout(r, 250))   // stay under 2 req/s
  }

  grandSeen += seen
  grandFilled += written
  console.log(
    `${t.name.slice(0, 22).padEnd(22)} ${String(seen).padStart(6)} pedidos · `
    + `${String(withIp).padStart(6)} com dado · ${String(written).padStart(6)} gravados · `
    + `${pages} páginas · mais antigo ${oldest?.slice(0, 10) ?? '-'}`
  )
}

console.log(`\n${grandSeen} pedidos lidos, ${grandFilled} atualizados${DRY ? ' (--dry: nada gravado)' : ''}`)
await pool.end()
