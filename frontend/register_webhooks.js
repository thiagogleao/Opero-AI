/**
 * Register the order webhooks on every ACTIVE store (not archived, with a
 * Shopify domain and credentials): orders/create, orders/updated, orders/paid,
 * all pointing at /api/webhooks/shopify/orders.
 *
 * orders/create drives the sale push and the live feed; orders/updated and
 * orders/paid move shopify_orders the moment a payment, refund, cancellation
 * or fulfilment happens, instead of at the next ten-minute sync.
 *
 * Idempotent: a subscription already pointing at our address is left alone,
 * one pointing at an old address is updated, duplicates are removed.
 *
 *   node register_webhooks.js --dry-run   # show what would change, change nothing
 *   node register_webhooks.js             # register / update
 *   node register_webhooks.js --list      # what is registered on each store
 *   node register_webhooks.js --delete    # remove ours
 *
 * Env: DATABASE_URL, APP_URL, SHOPIFY_WEBHOOK_TOKEN.
 *
 * Stores on a Dev Dashboard app (24 h token: Hibikura, Glooty) use the token
 * the collector keeps fresh in tenants; if it has expired, a new one is
 * minted with the store's client credentials and saved, as the collector does.
 * The token itself is never printed.
 */

const { Pool } = require('pg')

// Same version as frontend/lib/sync/shopifyApi.ts and app/collectors/shopify_client.py.
const API_VERSION = '2026-10'
const TOPICS = ['orders/create', 'orders/updated', 'orders/paid']
const PATH = '/api/webhooks/shopify/orders'

const DATABASE_URL = process.env.DATABASE_URL
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '')
const TOKEN = process.env.SHOPIFY_WEBHOOK_TOKEN

const mode = process.argv.includes('--list') ? 'list'
  : process.argv.includes('--delete') ? 'delete'
  : process.argv.includes('--dry-run') ? 'dry-run'
  : 'register'

if (!DATABASE_URL) { console.error('Falta DATABASE_URL'); process.exit(1) }
if ((mode === 'register' || mode === 'dry-run') && (!APP_URL || !TOKEN)) {
  console.error('Falta APP_URL ou SHOPIFY_WEBHOOK_TOKEN')
  process.exit(1)
}

const ADDRESS = `${APP_URL}${PATH}?token=${TOKEN}`
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function shopify(domain, token, path, options = {}) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/${path}`, {
    ...options,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(`${res.status} ${json ? JSON.stringify(json.errors ?? json).slice(0, 200) : text.slice(0, 200)}`)
  return json
}

/** A usable Admin token: the stored one, or a fresh one for a Dev Dashboard
 *  store whose 24 h token has expired (client credentials grant). */
async function tokenFor(s) {
  const expiring = s.shopify_token_expires_at && new Date(s.shopify_token_expires_at).getTime() < Date.now() + 5 * 60_000
  if (s.shopify_access_token && !expiring) return s.shopify_access_token
  if (!s.shopify_client_id || !s.shopify_client_secret) return s.shopify_access_token
  if (mode === 'dry-run' || mode === 'list') return s.shopify_access_token
  const res = await fetch(`https://${s.shopify_domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: s.shopify_client_id, client_secret: s.shopify_client_secret }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`token não renovado (HTTP ${res.status})`)
  const expires = new Date(Date.now() + (Number(body.expires_in) || 86399) * 1000)
  await pool.query(
    `UPDATE tenants SET shopify_access_token = $1, shopify_token_expires_at = $2, updated_at = now() WHERE id = $3`,
    [body.access_token, expires, s.id])
  return body.access_token
}

async function run() {
  const { rows: stores } = await pool.query(`
    SELECT id, shopify_domain, shopify_access_token, shop_name, shopify_client_id, shopify_client_secret,
           shopify_token_expires_at
      FROM tenants
     WHERE shopify_domain IS NOT NULL AND archived_at IS NULL
       AND (shopify_access_token IS NOT NULL OR (shopify_client_id IS NOT NULL AND shopify_client_secret IS NOT NULL))
     ORDER BY created_at`)

  console.log(`${stores.length} loja(s) ativa(s) · modo ${mode}`)
  if (mode !== 'list' && mode !== 'delete') console.log(`  endereço: ${APP_URL}${PATH}?token=***\n`)

  let failures = 0
  for (const s of stores) {
    const label = `${s.shop_name || s.shopify_domain}`.padEnd(22)
    try {
      const token = await tokenFor(s)
      if (!token) throw new Error('sem token')
      const { webhooks } = await shopify(s.shopify_domain, token, 'webhooks.json?limit=250')
      const ours = webhooks.filter(w => w.address.includes(PATH))

      if (mode === 'list') {
        if (!webhooks.length) console.log(`  ${label} nenhum webhook`)
        for (const w of webhooks) console.log(`  ${label} [${w.topic}] ${w.address.replace(/token=[^&]+/, 'token=***')}`)
        continue
      }
      if (mode === 'delete') {
        for (const w of ours) {
          await shopify(s.shopify_domain, token, `webhooks/${w.id}.json`, { method: 'DELETE' })
          console.log(`  ${label} removido ${w.topic}`)
        }
        if (!ours.length) console.log(`  ${label} nada a remover`)
        continue
      }

      for (const topic of TOPICS) {
        const mine = ours.filter(w => w.topic === topic)
        const exact = mine.find(w => w.address === ADDRESS)
        const extras = mine.filter(w => w !== (exact ?? mine[0]))
        if (exact) {
          console.log(`  ${label} ${topic.padEnd(15)} ok`)
        } else if (mine.length) {
          console.log(`  ${label} ${topic.padEnd(15)} ${mode === 'dry-run' ? 'atualizaria' : 'atualizado'} o endereço`)
          if (mode === 'register') {
            await shopify(s.shopify_domain, token, `webhooks/${mine[0].id}.json`, {
              method: 'PUT', body: JSON.stringify({ webhook: { id: mine[0].id, address: ADDRESS } }),
            })
          }
        } else {
          console.log(`  ${label} ${topic.padEnd(15)} ${mode === 'dry-run' ? 'registraria' : 'registrado'}`)
          if (mode === 'register') {
            await shopify(s.shopify_domain, token, 'webhooks.json', {
              method: 'POST', body: JSON.stringify({ webhook: { topic, address: ADDRESS, format: 'json' } }),
            })
          }
        }
        for (const dup of extras) {
          console.log(`  ${label} ${topic.padEnd(15)} ${mode === 'dry-run' ? 'removeria' : 'removido'} duplicado`)
          if (mode === 'register') await shopify(s.shopify_domain, token, `webhooks/${dup.id}.json`, { method: 'DELETE' })
        }
      }
    } catch (err) {
      failures++
      console.log(`  ${label} FALHOU — ${err.message}`)
    }
  }
  if (failures) process.exitCode = 1
}

run().catch(e => { console.error(e.message); process.exitCode = 1 }).finally(() => pool.end())
