import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getActiveTenantId } from '@/lib/activeStore'
import { getCreativeDetail, getTenantTimezone } from '@/lib/queries'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'
import CreativeDetailCharts from '@/components/CreativeDetailCharts'

export const revalidate = 0

function dateInTz(d: Date, tz: string) {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}

export default async function CreativeDetailPage({ params, searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  let tenantId: string
  try { tenantId = await getActiveTenantId(userId) } catch { redirect('/onboarding') }

  const { id }  = await params
  const tz      = await getTenantTimezone(tenantId)
  const now     = new Date()
  const sp      = await searchParams
  const dateTo   = sp.to   ?? dateInTz(now, tz)
  const dateFrom = sp.from ?? dateInTz(new Date(now.getTime() - 29 * 86400000), tz)

  const { summary, daily } = await getCreativeDetail(tenantId, id, dateFrom, dateTo)

  if (!summary) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
        <Sidebar active="/" />
        <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
          <Link href="/" style={{ fontSize: 12, color: 'var(--text-ghost)', textDecoration: 'none' }}>← Dashboard</Link>
          <p style={{ color: 'var(--text-faint)', marginTop: 40, textAlign: 'center' }}>Criativo não encontrado</p>
        </main>
      </div>
    )
  }

  const s = summary
  const isVideo = (s.video_plays ?? 0) > 0

  const videoSteps = isVideo ? [
    { label: 'Hook', desc: '% que assistiu', value: s.hook_rate },
    { label: 'P25', desc: '25% do vídeo', value: s.hold_rate_25 },
    { label: 'P50', desc: '50% do vídeo', value: s.hold_rate_50 },
    { label: 'P75', desc: '75% do vídeo', value: s.hold_rate_75 },
    { label: 'P100', desc: 'Completou', value: s.hold_rate_100 },
  ].filter(step => step.value !== null) : []

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/" />
      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, fontSize: 12, color: 'var(--text-ghost)' }}>
          <Link href="/" style={{ color: 'var(--text-ghost)', textDecoration: 'none' }}>Dashboard</Link>
          <span>›</span>
          <span style={{ color: 'var(--text-dim)' }}>Criativo #{id}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Left: creative preview + summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Creative preview */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {(s.thumbnail_url || s.creative_url) ? (
                <img
                  src={s.thumbnail_url ?? s.creative_url ?? ''}
                  alt={s.name}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 32, opacity: 0.3 }}>{isVideo ? '▶' : '🖼'}</span>
                </div>
              )}
              <div style={{ padding: '12px 14px' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{s.name}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-ghost)', fontFamily: 'monospace', background: 'var(--bg)', borderRadius: 3, padding: '1px 5px', border: '1px solid var(--border)' }}>{id}</span>
                  {isVideo && <span style={{ fontSize: 10, color: '#3B82F6', background: 'rgba(59,130,246,0.12)', borderRadius: 3, padding: '1px 5px' }}>▶ Vídeo</span>}
                  <span style={{ fontSize: 10, color: s.status === 'ACTIVE' ? '#10B981' : 'var(--text-ghost)', background: s.status === 'ACTIVE' ? 'rgba(16,185,129,0.12)' : 'var(--bg)', borderRadius: 3, padding: '1px 5px' }}>{s.status}</span>
                </div>
                {s.landing_url && (
                  <a href={s.landing_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', marginTop: 8, fontSize: 10, color: '#3B82F6', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.landing_url}
                  </a>
                )}
              </div>
            </div>

            {/* KPIs */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Período: {dateFrom} → {dateTo}</p>
              {[
                { label: 'Gasto', value: `$${Number(s.spend).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: '#8B5CF6' },
                { label: 'Receita FB', value: `$${Number(s.revenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: '#10B981' },
                { label: 'ROAS', value: `${Number(s.roas).toFixed(2)}x`, color: Number(s.roas) >= 3 ? '#10B981' : Number(s.roas) >= 1.5 ? '#F59E0B' : '#F43F5E' },
                { label: 'Compras', value: String(Number(s.purchases)), color: 'var(--text-secondary)' },
                { label: 'CTR', value: `${Number(s.ctr).toFixed(2)}%`, color: 'var(--text-secondary)' },
                { label: 'Frequência', value: Number(s.frequency).toFixed(2), color: Number(s.frequency) > 3.5 ? '#F59E0B' : 'var(--text-secondary)' },
              ].map(m => (
                <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{m.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>

            {/* Video funnel */}
            {videoSteps.length > 0 && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Funil de Vídeo</p>
                <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 10 }}>
                  {Number(s.video_plays ?? 0).toLocaleString()} plays
                </p>
                {videoSteps.map((step, i) => {
                  const v = Number(step.value)
                  const color = v >= 30 ? '#10B981' : v >= 15 ? '#F59E0B' : '#F43F5E'
                  return (
                    <div key={step.label} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{step.label} <span style={{ color: 'var(--text-ghost)', fontSize: 10 }}>({step.desc})</span></span>
                        <span style={{ fontSize: 12, fontWeight: 600, color }}>{v.toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(v, 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right: daily charts */}
          <CreativeDetailCharts daily={daily} />
        </div>
      </main>
    </div>
  )
}
