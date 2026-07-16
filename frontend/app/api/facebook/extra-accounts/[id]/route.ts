import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'
import { getActiveTenantId } from '@/lib/activeStore'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId(userId)
  const { id } = await params
  const { is_active, nickname } = await req.json()

  const sets: string[] = []
  const vals: unknown[] = [tenantId, id]
  if (is_active !== undefined) { sets.push(`is_active = $${vals.push(is_active)}`); }
  if (nickname  !== undefined) { sets.push(`nickname = $${vals.push(nickname)}`); }
  if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const [account] = await query(
    `UPDATE tenant_fb_accounts SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING id, tenant_id, fb_ad_account_id, nickname, is_active, created_at`,
    vals
  )
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ account })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId(userId)
  const { id } = await params

  await query(
    `DELETE FROM tenant_fb_accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  )
  return NextResponse.json({ ok: true })
}
