import { auth } from '@clerk/nextjs/server'
import { getLastSyncTime } from '@/lib/queries'
import { getActiveTenantId } from '@/lib/activeStore'

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = await getActiveTenantId(userId)
    const syncs = await getLastSyncTime(tenantId)
    return Response.json({ lastSync: syncs[0]?.finished_at ?? null })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
