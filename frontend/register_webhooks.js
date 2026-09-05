/**
 * Register the `orders/create` webhook on every connected Shopify store.
 *
 * This is what makes sale notifications immediate: Shopify POSTs to us the
 * moment an order is placed, instead of waiting for the next 30-minute sync.
 *
 * Idempotent — an existing subscription pointing at our endpoint is updated
 * rather than duplicated, so it is safe to re-run after changing APP_URL.
 *
 *   node register_webhooks.js            # register / update
 *   node register_webhooks.js --list     # show what is registered
 *   node register_webhooks.js --delete   # remove ours
 *
 * Env: DATABASE_URL, APP_URL, SHOPIFY_WEBHOOK_TOKEN
 */

const { Pool } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
const APP_URL      = (process.env.APP_URL || '').replace(/\/$/, '')
const TOKEN        = process.env.SHOPIFY_WEBHOOK_TOKEN
const API_VERSION  = process.env.SHOPIFY_API_VERSION || '2024-01'
const TOPIC        = 'orders/create'

const mode = process.argv.includes('--list') ? 'list'
  : process.argv.includes('--delete') ? 'delete'
  : 'register'

if (!DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1) }
if (mode === 'register' && (!APP_URL || !TOKEN)) {
  console.error('Missing APP_URL or SHOPIFY_WEBHOOK_TOKEN')
  process.exit(1)
}

const ADDRESS = `${APP_URL}/api/webhooks/shopify/orders?token=${TOKEN}`

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function shopify(domain, token, path, options = {}) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/${path}`, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json.errors ?? json) : text.slice(0, 200)
    throw new Error(`${res.status} ${detail}`)
  }
  return json
}

async function run() {
  const { rows: stores } = await pool.query(`
    SELECT id, shopify_domain, shopify_access_token, shop_name
    FROM tenants
    WHERE shopify_domain IS NOT NULL AND shopify_access_token IS NOT NULL
    ORDER BY created_at
  `)

  console.log(`${stores.length} store(s)\n`)
  if (mode === 'register') console.log(`  endpoint: ${APP_URL}/api/webhooks/shopify/orders?token=***\n`)

  for (const s of stores) {
    const label = `${s.shop_name || s.shopify_domain}`.padEnd(22)
    try {
      const { webhooks } = await shopify(s.shopify_domain, s.shopify_access_token, 'webhooks.json?limit=250')
      const ours = webhooks.filter(w => w.topic === TOPIC && w.address.includes('/api/webhooks/shopify/orders'))

      if (mode === 'list') {
        if (!webhooks.length) console.log(`  ${label} no webhooks`)
        else webhooks.forEach(w => console.log(`  ${label} [${w.topic}] ${w.address}`))
        continue
      }

      if (mode === 'delete') {
        for (const w of ours) {
          await shopify(s.shopify_domain, s.shopify_access_token, `webhooks/${w.id}.json`, { method: 'DELETE' })
          console.log(`  ${label} deleted ${w.id}`)
        }
        if (!ours.length) console.log(`  ${label} nothing to delete`)
        continue
      }

      // register: update in place when the address drifted, else create
      const exact = ours.find(w => w.address === ADDRESS)
      if (exact) {
        console.log(`  ${label} OK (already registered)`)
        continue
      }
      if (ours.length) {
        await shopify(s.shopify_domain, s.shopify_access_token, `webhooks/${ours[0].id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ webhook: { id: ours[0].id, address: ADDRESS } }),
        })
        console.log(`  ${label} updated address`)
        // Drop any extra duplicates left over from earlier runs.
        for (const dup of ours.slice(1)) {
          await shopify(s.shopify_domain, s.shopify_access_token, `webhooks/${dup.id}.json`, { method: 'DELETE' })
        }
        continue
      }

      const created = await shopify(s.shopify_domain, s.shopify_access_token, 'webhooks.json', {
        method: 'POST',
        body: JSON.stringify({ webhook: { topic: TOPIC, address: ADDRESS, format: 'json' } }),
      })
      console.log(`  ${label} registered (id ${created.webhook.id})`)
    } catch (err) {
      console.log(`  ${label} FAILED — ${err.message}`)
    }
  }
}

run().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => pool.end())
