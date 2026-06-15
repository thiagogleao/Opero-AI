import { auth } from '@clerk/nextjs/server'
import { getCurrentSyncStatus } from '@/lib/queries'
import { getActiveTenantId } from '@/lib/activeStore'

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = await getActiveTenantId(userId)
    const runs = await getCurrentSyncStatus(tenantId)

    const bySource: Record<string, {
      status: string
      startedAt: string | null
      finishedAt: string | null
      recordsCollected: number
      errorMessage: string | null
    }> = {}

    for (const run of runs) {
      bySource[run.source] = {
        status: run.status,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        recordsCollected: run.records_collected,
        errorMessage: run.error_message ?? null,
      }
    }

    // lastSync: most recent successful finish across all sources (for AutoSync compatibility)
    const lastSync = runs
      .filter(r => r.status === 'success' && r.finished_at)
      .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))[0]
      ?.finished_at ?? null

    return Response.json({
      shopify:  bySource['shopify']  ?? null,
      facebook: bySource['facebook'] ?? null,
      lastSync,
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
