import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getTenantsByUserId } from '@/lib/tenant'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const stores = await getTenantsByUserId(userId)
  return NextResponse.json({ stores })
}
