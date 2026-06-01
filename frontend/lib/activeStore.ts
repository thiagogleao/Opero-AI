import { cookies } from 'next/headers'

/** Returns the active store's tenant ID from cookie, falling back to userId. */
export async function getActiveTenantId(userId: string): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('active_store_id')?.value ?? userId
}
