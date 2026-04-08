import { query } from '@/lib/db'

export async function GET() {
  const rows = await query<{
    product_id: string; title: string; image_url: string | null
    price_min: number; price_max: number; status: string
  }>(`
    SELECT product_id, title, image_url,
           price_min::float, price_max::float, status
    FROM shopify_products
    WHERE status = 'active'
    ORDER BY title
  `)
  return Response.json(rows)
}
