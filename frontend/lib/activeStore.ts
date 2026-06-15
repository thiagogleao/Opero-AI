import { cookies } from 'next/headers'
import { query } from './db'

/** Returns the active store's tenant ID from cookie, falling back to userId.
 *  If neither the cookie nor a direct id=userId row exists, finds the most
 *  recently created store owned by this user (handles UUID-keyed stores). */
export async function getActiveTenantId(userId: string): Promise<string> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get('active_store_id')?.value

  // Validate the cookie value actually belongs to this user before trusting it
  if (fromCookie) {
    const valid = await query<{ id: string }>(
      'SELECT id FROM tenants WHERE id = $1 AND (user_id = $2 OR id = $2) LIMIT 1',
      [fromCookie, userId]
    )
    if (valid.length > 0) return fromCookie
    // Cookie is stale/invalid — fall through to lookup
  }

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
