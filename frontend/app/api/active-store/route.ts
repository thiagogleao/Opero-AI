import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getTenantsByUserId } from '@/lib/tenant'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { storeId } = await req.json()
  if (!storeId) return NextResponse.json({ error: 'Missing storeId' }, { status: 400 })

  // Verify this store belongs to the authenticated user
  const stores = await getTenantsByUserId(userId)
  if (!stores.find(s => s.id === storeId)) {
    return NextResponse.json({ error: 'Store not found' }, { status: 403 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('active_store_id', storeId, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  return res
}
