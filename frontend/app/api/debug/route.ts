import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET() {
  const result: Record<string, unknown> = {}

  try {
    const { userId } = await auth()
    result.userId = userId ?? null
    result.authOk = !!userId

    const cookieStore = await cookies()
    result.active_store_id_cookie = cookieStore.get('active_store_id')?.value ?? null

    if (userId) {
      // Check direct tenant (userId == tenant id)
      const direct = await query<{ id: string; onboarded: boolean; shopify_domain: string }>(
        'SELECT id, onboarded, shopify_domain FROM tenants WHERE id = $1',
        [userId]
      ).catch(e => { result.directError = String(e); return [] })
      result.directTenant = direct

      // Check by user_id
      const byUser = await query<{ id: string; onboarded: boolean; shopify_domain: string }>(
        'SELECT id, onboarded, shopify_domain FROM tenants WHERE user_id = $1 OR (user_id IS NULL AND id = $1)',
        [userId]
      ).catch(e => { result.byUserError = String(e); return [] })
      result.byUserTenants = byUser

      // Check DB connectivity
      const ping = await query<{ now: string }>('SELECT NOW()::text AS now').catch(e => { result.dbError = String(e); return [] })
      result.dbNow = ping[0]?.now ?? null

      // Check fb_ad_daily_metrics columns
      const cols = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'fb_ad_daily_metrics'
         ORDER BY ordinal_position`,
        []
      ).catch(e => { result.colError = String(e); return [] })
      result.fb_daily_columns = cols.map(c => c.column_name)
    }
  } catch (e: unknown) {
    result.topLevelError = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json(result, { status: 200 })
}
