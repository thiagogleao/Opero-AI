import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getActiveTenantId } from '@/lib/activeStore'
import { getJourneyPage } from '@/lib/attribution'
import type { JourneyFilter } from '@/lib/attributionModels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FILTERS: JourneyFilter[] = ['all', 'paid', 'unattributed', 'multi']

/** A page of orders and their paths, for the reader on the attribution screen. */
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!from || !to || !iso.test(from) || !iso.test(to)) {
    return NextResponse.json({ error: 'from and to are required as YYYY-MM-DD' }, { status: 400 })
  }

  const raw = searchParams.get('filter') as JourneyFilter | null
  const filter: JourneyFilter = raw && FILTERS.includes(raw) ? raw : 'all'

  let tenantId: string
  try {
    tenantId = await getActiveTenantId(userId)
  } catch {
    return NextResponse.json({ error: 'No store' }, { status: 400 })
  }

  const page = await getJourneyPage(tenantId, from, to, {
    limit:  Number(searchParams.get('limit')) || 30,
    offset: Number(searchParams.get('offset')) || 0,
    search: searchParams.get('search') ?? '',
    filter,
  })

  return NextResponse.json(page)
}
