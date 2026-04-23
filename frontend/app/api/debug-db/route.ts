import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET() {
  const rows = await query<{ id: string; shopify_domain: string; shopify_access_token: string }>(
    `SELECT id, shopify_domain, LEFT(shopify_access_token, 20) as shopify_access_token FROM tenants ORDER BY created_at`
  )
  return NextResponse.json({ count: rows.length, rows })
}
