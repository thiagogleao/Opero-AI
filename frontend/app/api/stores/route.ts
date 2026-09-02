import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getTenantsByUserId, upsertTenant } from '@/lib/tenant'
import crypto from 'crypto'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const stores = await getTenantsByUserId(userId)
  return NextResponse.json({ stores })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const shopify_domain = body.shopify_domain?.replace(/https?:\/\//, '').replace(/\/$/, '')
  const shopify_access_token = body.shopify_access_token

  if (!shopify_domain || !shopify_access_token)
    return NextResponse.json({ error: 'Campos obrigatórios: shopify_domain e shopify_access_token' }, { status: 400 })

  const user = await currentUser()
  const storeId = crypto.randomUUID()

  const store = await upsertTenant(storeId, {
    user_id: userId,
    email: user?.emailAddresses[0]?.emailAddress,
    shopify_domain,
    shopify_access_token,
    onboarded: true,
  })

  return NextResponse.json({ store })
}
