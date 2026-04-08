import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { getTenant, upsertTenant, claimLegacyData } from '@/lib/tenant'

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
  const { shopify_domain, shopify_access_token, fb_ad_account_id, fb_access_token, claimLegacy } = body

  const user = await currentUser()

  // Validate Shopify credentials
  if (shopify_domain && shopify_access_token) {
    try {
      const domain = shopify_domain.replace(/https?:\/\//, '').replace(/\/$/, '')
      const testRes = await fetch(
        `https://${domain}/admin/api/2024-01/shop.json`,
        { headers: { 'X-Shopify-Access-Token': shopify_access_token } }
      )
      if (!testRes.ok) {
        return NextResponse.json({ error: 'Shopify credentials invalid. Check domain and token.' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Could not reach Shopify. Check the domain.' }, { status: 400 })
    }
  }

  const tenant = await upsertTenant(userId, {
    email: user?.emailAddresses[0]?.emailAddress,
    shopify_domain: shopify_domain?.replace(/https?:\/\//, '').replace(/\/$/, ''),
    shopify_access_token,
    fb_ad_account_id,
    fb_access_token,
    onboarded: true,
  })

  if (claimLegacy) {
    await claimLegacyData(userId)
  }

  return NextResponse.json({ tenant })
}
