import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { getTenant, upsertTenant } from '@/lib/tenant'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await getTenant(userId)
  return NextResponse.json({ tenant })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { shopify_domain, shopify_access_token, fb_ad_account_id, fb_access_token, onboarded } = body

  const user = await currentUser()

  const tenant = await upsertTenant(userId, {
    email: user?.emailAddresses[0]?.emailAddress,
    shopify_domain: shopify_domain?.replace(/https?:\/\//, '').replace(/\/$/, ''),
    shopify_access_token: shopify_access_token || undefined,
    fb_ad_account_id,
    fb_access_token,
    onboarded: onboarded ?? true,
  })

  return NextResponse.json({ tenant })
}
