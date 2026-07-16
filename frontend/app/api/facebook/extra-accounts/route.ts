import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'
import { getActiveTenantId } from '@/lib/activeStore'

export interface ExtraFbAccount {
  id: number
  tenant_id: string
  fb_ad_account_id: string
  nickname: string | null
  is_active: boolean
  created_at: string
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId(userId)

  try {
    const accounts = await query<ExtraFbAccount>(
      `SELECT id, tenant_id, fb_ad_account_id, nickname, is_active, created_at
       FROM tenant_fb_accounts WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId]
    )
    return NextResponse.json({ accounts })
  } catch {
    // Table may not exist yet — return empty list
    return NextResponse.json({ accounts: [] })
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId(userId)
  const { fb_ad_account_id, fb_access_token, nickname } = await req.json()

  if (!fb_ad_account_id || !fb_access_token) {
    return NextResponse.json({ error: 'Missing fb_ad_account_id or fb_access_token' }, { status: 400 })
  }

  const [account] = await query<ExtraFbAccount>(`
    INSERT INTO tenant_fb_accounts (tenant_id, fb_ad_account_id, fb_access_token, nickname, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (tenant_id, fb_ad_account_id) DO UPDATE SET
      fb_access_token = EXCLUDED.fb_access_token,
      nickname        = COALESCE(EXCLUDED.nickname, tenant_fb_accounts.nickname),
      is_active       = true
    RETURNING id, tenant_id, fb_ad_account_id, nickname, is_active, created_at
  `, [tenantId, fb_ad_account_id, fb_access_token, nickname ?? null])

  return NextResponse.json({ account })
}
