// Loads mokoo_rate_card.json (transcribed from the DSers x Shopify cost report)
// into MOKOO's profit settings: per-country table prices, the US price as each
// product's base, and the EU's flat per-order fee.
//
//   node --env-file=.env apply_mokoo_rate_card.mjs [--dry]
import { readFileSync } from 'node:fs'
import pg from 'pg'

const TENANT = process.env.MOKOO_TENANT_ID || 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
const dry = process.argv.includes('--dry')
const card = JSON.parse(readFileSync(new URL('./mokoo_rate_card.json', import.meta.url), 'utf8'))

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
})

const { rows } = await pool.query('SELECT settings FROM profit_settings WHERE tenant_id = $1', [TENANT])
if (!rows[0]) throw new Error(`no profit_settings row for ${TENANT}`)
const cfg = rows[0].settings

// One entry per Shopify product id; several ids can share a rate-card row
// (every t-shirt is priced the same, as is every loose block).
const country_prices = card.products.flatMap(p =>
  p.product_ids.map(id => ({ product_id: id, name: p.name, prices: p.prices })))

const order_fees = [
  ...Object.entries(card.order_fees.countries).map(([country_code, name]) => ({
    country_code, name,
    amount_usd: card.order_fees.amount_usd,
    effective_from: card.order_fees.effective_from,
  })),
  ...Object.entries(card.order_fees.exceptions).map(([country_code, e]) => ({
    country_code, name: e.note?.split(':')[0] ?? country_code, amount_usd: e.amount_usd,
  })),
]

// The base price is what the supplier charges to the US, which is where the
// large majority of orders go and the sensible fallback for a destination the
// rate card has never seen.
const usPrice = new Map()
for (const p of card.products)
  for (const id of p.product_ids)
    if (p.prices.US !== undefined) usPrice.set(id, p.prices.US)

const changed = []
const products = [...(cfg.cogs.products ?? [])].map(p => {
  const next = usPrice.get(p.product_id)
  if (next === undefined || next === p.cost_usd) return p
  changed.push(`${p.name}: $${p.cost_usd} -> $${next}`)
  return { ...p, cost_usd: next }
})

// A product the catalogue sync never picked up (Meowgical World, the influencer
// card) has no base price to fall back on, so an order to a country the rate
// card does not list would quietly cost the $9 default. Add it with its US price.
const known = new Set(products.map(p => p.product_id))
const added = []
for (const p of card.products) {
  if (p.prices.US === undefined) continue
  for (const id of p.product_ids) {
    if (known.has(id)) continue
    known.add(id)
    products.push({ product_id: id, name: p.name, cost_usd: p.prices.US })
    added.push(`${p.name} ($${p.prices.US})`)
  }
}

// Boxes and cards are bought in bulk and spread over the units they ship with.
// The rate card is the supplier's price alone; this rides on top of every unit.
const packaging_per_unit_usd = card.packaging_per_unit_usd ?? cfg.cogs.packaging_per_unit_usd ?? 0

const updated = { ...cfg, cogs: { ...cfg.cogs, products, country_prices, order_fees, packaging_per_unit_usd } }

console.log(`${country_prices.length} tabelas de preço por país, ${order_fees.length} países com taxa fixa`)
console.log(`embalagem: $${packaging_per_unit_usd.toFixed(2)} por unidade`)
console.log(`${changed.length} preços base alterados:`)
for (const c of changed) console.log('  ' + c)
console.log(`${added.length} produtos acrescentados ao catálogo: ${added.join(', ') || '-'}`)

if (dry) { console.log('\n--dry: nada gravado'); await pool.end(); process.exit(0) }
await pool.query('UPDATE profit_settings SET settings = $2 WHERE tenant_id = $1', [TENANT, updated])
console.log('\ngravado')
await pool.end()
