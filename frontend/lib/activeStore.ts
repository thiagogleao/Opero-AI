import { cookies } from 'next/headers'
import { query } from './db'

/** Returns the active store's tenant ID from cookie, falling back to userId.
 *  If neither the cookie nor a direct id=userId row exists, finds the most
 *  recently created store owned by this user (handles UUID-keyed stores). */
export async function getActiveTenantId(userId: string): Promise<string> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get('active_store_id')?.value
  if (fromCookie) return fromCookie

  // Check if a primary store with id=userId exists
  const direct = await query<{ id: string }>(
    'SELECT id FROM tenants WHERE id = $1 LIMIT 1',
    [userId]
  )
  if (direct.length > 0) return userId

  // Fall back to most recent store owned by this user (UUID-keyed stores)
  const byUser = await query<{ id: string }>(
    'SELECT id FROM tenants WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  )
  return byUser[0]?.id ?? userId
}
