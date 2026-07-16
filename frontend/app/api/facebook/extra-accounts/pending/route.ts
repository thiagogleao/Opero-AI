import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'

type PendingData = { tenantId: string; token: string }

function parsePending(req: NextRequest): PendingData | null {
  const raw = req.cookies.get('fb_extra_pending')?.value
  if (!raw) return null
  try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) } catch { return null }
}

// Returns the list of ad accounts from the stored token so the picker page can display them.
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pending = parsePending(req)
  if (!pending) return NextResponse.json({ error: 'No pending data' }, { status: 400 })

  const res = await fetch(
    `https://graph.facebook.com/me/adaccounts?fields=id,name,account_status&limit=50&access_token=${pending.token}`
  )
  if (!res.ok) return NextResponse.json({ error: 'Facebook API error' }, { status: 502 })

  const data = await res.json()
  return NextResponse.json({ accounts: data.data || [] })
}

// Saves the chosen account to tenant_fb_accounts and clears the pending cookie.
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pending = parsePending(req)
  if (!pending) return NextResponse.json({ error: 'No pending data' }, { status: 400 })

  const { fb_ad_account_id } = await req.json()
  if (!fb_ad_account_id) return NextResponse.json({ error: 'Missing fb_ad_account_id' }, { status: 400 })

  await query(`
    INSERT INTO tenant_fb_accounts (tenant_id, fb_ad_account_id, fb_access_token, is_active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (tenant_id, fb_ad_account_id) DO UPDATE SET
      fb_access_token = EXCLUDED.fb_access_token,
      is_active       = true
  `, [pending.tenantId, fb_ad_account_id, pending.token])

  const response = NextResponse.json({ ok: true })
  response.cookies.delete('fb_extra_pending')
  return response
}
