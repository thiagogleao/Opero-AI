import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createStoreForUser, updateShopifyTokenByDomain } from '@/lib/tenant'
import { query } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain, accessToken } = await req.json()
  if (!domain || !accessToken) {
    return NextResponse.json({ error: 'domain e accessToken são obrigatórios' }, { status: 400 })
  }

  const cleanDomain = domain.replace(/https?:\/\//, '').replace(/\/$/, '')

  // Validate the token by calling Shopify shop endpoint
  const testRes = await fetch(`https://${cleanDomain}/admin/api/2024-01/shop.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  })

  if (!testRes.ok) {
    return NextResponse.json(
      { error: 'Token inválido ou domínio incorreto. Verifique e tente novamente.' },
      { status: 422 }
    )
  }

  const user = await currentUser()
  const email = user?.emailAddresses[0]?.emailAddress

  // Check if this domain already belongs to this user — just update the token
  const updated = await updateShopifyTokenByDomain(cleanDomain, accessToken, userId)

  let storeId: string
  if (updated > 0) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE shopify_domain = $1 AND (user_id = $2 OR (user_id IS NULL AND id = $2))`,
      [cleanDomain, userId]
    )
    storeId = rows[0]?.id ?? userId
  } else {
    storeId = crypto.randomUUID()
    await createStoreForUser(userId, storeId, {
      email,
      shopify_domain: cleanDomain,
      shopify_access_token: accessToken,
    })
  }

  const res = NextResponse.json({ ok: true, storeId })
  res.cookies.set('active_store_id', storeId, {
    httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax',
  })
  return res
}
