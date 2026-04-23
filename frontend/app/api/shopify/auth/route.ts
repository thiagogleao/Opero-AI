import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const SCOPES = [
  'read_orders','write_orders','read_analytics',
  'read_draft_orders','write_draft_orders',
  'read_products','write_products',
  'read_customers','write_customers',
  'read_checkouts','write_checkouts',
  'read_inventory','write_inventory',
  'read_locations','write_locations',
  'read_content','write_content',
  'read_online_store_pages','write_online_store_pages',
  'read_themes','write_themes','write_theme_code',
  'read_price_rules','write_price_rules',
  'read_discounts','write_discounts',
  'read_fulfillments','write_fulfillments',
  'read_returns','write_returns',
  'read_shipping','write_shipping',
  'read_reports','write_reports',
  'read_marketing_events','write_marketing_events',
  'read_files','write_files',
  'read_metaobjects','write_metaobjects',
  'read_script_tags','write_script_tags',
  'read_translations','write_translations',
].join(',')

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const shop = searchParams.get('shop')?.replace(/https?:\/\//, '').replace(/\/$/, '')
  const storeStartDate = searchParams.get('storeStartDate') || ''

  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 })

  const clientId = process.env.SHOPIFY_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'SHOPIFY_CLIENT_ID not configured' }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin
  const reconnect = searchParams.get('reconnect') === '1'
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = `${nonce}:${encodeURIComponent(storeStartDate)}:${reconnect ? '1' : '0'}`
  const redirectUri = `${appUrl}/api/shopify/callback`

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)

  const res = NextResponse.redirect(authUrl.toString())
  res.cookies.set('shopify_oauth_state', state, {
    httpOnly: true, maxAge: 600, path: '/', sameSite: 'lax',
  })
  return res
}
