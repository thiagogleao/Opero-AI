import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getTenant } from '@/lib/tenant'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await getTenant(userId)
  if (!tenant?.fb_access_token) return NextResponse.json({ error: 'No Facebook token' }, { status: 400 })

  const res = await fetch(
    `https://graph.facebook.com/me/adaccounts?fields=id,name,account_status&limit=50&access_token=${tenant.fb_access_token}`
  )
  if (!res.ok) return NextResponse.json({ error: 'Facebook API error' }, { status: 502 })

  const data = await res.json()
  return NextResponse.json({ accounts: data.data || [] })
}
