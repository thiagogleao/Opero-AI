import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getActiveTenantId } from '@/lib/activeStore'
import { getCampaignMetrics, getTenantTimezone } from '@/lib/queries'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'

export const revalidate = 0

function dateInTz(d: Date, tz: string) {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

interface Props {
  searchParams: Promise<{ from?: string; to?: string }>
}

function RoasBadge({ roas }: { roas: number }) {
  const color = roas >= 3 ? '#10B981' : roas >= 1.5 ? '#F59E0B' : '#F43F5E'
  const bg    = roas >= 3 ? 'rgba(16,185,129,0.12)' : roas >= 1.5 ? 'rgba(245,158,11,0.12)' : 'rgba(244,63,94,0.12)'
  return (
    <span style={{ background: bg, color, fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6 }}>
      {roas.toFixed(2)}x
    </span>
  )
}

function fmt(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

export default async function CampaignsPage({ searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  let tenantId: string
  try { tenantId = await getActiveTenantId(userId) } catch { redirect('/onboarding') }

  const tz      = await getTenantTimezone(tenantId)
  const now     = new Date()
  const sp      = await searchParams
  const dateTo   = sp.to   ?? dateInTz(now, tz)
  const dateFrom = sp.from ?? dateInTz(new Date(now.getTime() - 29 * 86400000), tz)

  const campaigns = await getCampaignMetrics(tenantId, dateFrom, dateTo)
  const totalSpend = campaigns.reduce((s, c) => s + Number(c.spend), 0)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/" />
      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Link href="/" style={{ fontSize: 12, color: 'var(--text-ghost)', textDecoration: 'none' }}>← Dashboard</Link>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
            Campanhas Facebook
          </h1>
          <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 3 }}>
            {dateFrom} → {dateTo} · {campaigns.length} campanhas · ${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
          </p>
        </div>

        {campaigns.length === 0 ? (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '60px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-faint)', fontSize: 14 }}>Sem dados de campanhas para este período</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {campaigns.map((camp) => {
              const spend    = Number(camp.spend)
              const spendPct = totalSpend > 0 ? (spend / totalSpend) * 100 : 0
              return (
                <div key={camp.campaign_id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ minWidth: 0, flex: 1, marginRight: 16 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                        {camp.campaign_name}
                      </p>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {camp.objective && (
                          <span style={{ fontSize: 10, color: 'var(--text-ghost)', background: 'var(--bg)', borderRadius: 4, padding: '2px 6px', border: '1px solid var(--border)' }}>
                            {camp.objective}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--text-ghost)' }}>
                          {Number(camp.adset_count)} ad sets · {Number(camp.ad_count)} anúncios
                        </span>
                      </div>
                    </div>
                    <RoasBadge roas={Number(camp.roas)} />
                  </div>

                  {/* Spend bar */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${spendPct}%`, height: '100%', background: '#8B5CF6', borderRadius: 2 }} />
                    </div>
                  </div>

                  {/* Metrics row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Gasto',       value: fmt(spend),                     color: '#8B5CF6' },
                      { label: 'Receita FB',   value: fmt(Number(camp.revenue)),       color: '#10B981' },
                      { label: 'Compras',      value: String(Number(camp.purchases)),  color: 'var(--text-secondary)' },
                      { label: 'Impressões',   value: Number(camp.impressions) >= 1000 ? `${(Number(camp.impressions)/1000).toFixed(0)}k` : String(Number(camp.impressions)), color: 'var(--text-secondary)' },
                      { label: 'Cliques',      value: Number(camp.clicks) >= 1000 ? `${(Number(camp.clicks)/1000).toFixed(1)}k` : String(Number(camp.clicks)), color: 'var(--text-secondary)' },
                      { label: 'CTR',          value: `${Number(camp.ctr).toFixed(2)}%`, color: 'var(--text-secondary)' },
                      { label: 'CPM',          value: `$${Number(camp.cpm).toFixed(2)}`, color: 'var(--text-secondary)' },
                    ].map(m => (
                      <div key={m.label}>
                        <p style={{ fontSize: 10, color: 'var(--text-ghost)', marginBottom: 2 }}>{m.label}</p>
                        <p style={{ fontSize: 14, fontWeight: 600, color: m.color }}>{m.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
