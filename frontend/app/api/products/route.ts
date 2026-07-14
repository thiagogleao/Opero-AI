import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'
import { getActiveTenantId } from '@/lib/activeStore'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getActiveTenantId(userId)

  const rows = await query<{
    product_id: string; title: string; image_url: string | null
    price_min: number; price_max: number; status: string
  }>(`
    SELECT product_id, title, image_url,
           price_min::float, price_max::float, status
    FROM shopify_products
    WHERE tenant_id = $1
      AND status = 'active'
    ORDER BY title
  `, [tenantId])
  return Response.json(rows)
}
