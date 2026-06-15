import { auth } from '@clerk/nextjs/server'
import { getCurrentSyncStatus, getLastSyncDurations } from '@/lib/queries'
import { getActiveTenantId } from '@/lib/activeStore'

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = await getActiveTenantId(userId)

    const [runs, durations] = await Promise.all([
      getCurrentSyncStatus(tenantId),
      getLastSyncDurations(tenantId),
    ])

    const durationBySource: Record<string, number> = {}
    for (const d of durations) {
      durationBySource[d.source] = d.duration_seconds
    }

    const bySource: Record<string, {
      status: string
      startedAt: string | null
      finishedAt: string | null
      recordsCollected: number
      errorMessage: string | null
      estimatedDurationSeconds: number | null
    }> = {}

    for (const run of runs) {
      bySource[run.source] = {
        status: run.status,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        recordsCollected: run.records_collected,
        errorMessage: run.error_message ?? null,
        // Use the last successful run's duration as the ETA baseline.
        // Only meaningful while status = 'running'.
        estimatedDurationSeconds: durationBySource[run.source] ?? null,
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
