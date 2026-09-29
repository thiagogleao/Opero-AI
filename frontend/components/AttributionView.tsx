'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { makeFmt } from '@/lib/format'
import { useSettings } from '@/contexts/SettingsContext'
import { MODELS, type Model, type CreativeAttribution, type SourceRow, type JourneyOrder, type Coverage } from '@/lib/attributionModels'

interface Props {
  coverage: Coverage
  creatives: CreativeAttribution[]
  sources: SourceRow[]
  journeys: JourneyOrder[]
  model: Model
}

export default function AttributionView({ coverage, creatives, sources, journeys, model }: Props) {
  const { currency } = useSettings()
  const fmt = makeFmt(currency)
  const router = useRouter()
  const params = useSearchParams()

  function setModel(next: Model) {
    const p = new URLSearchParams(params.toString())
    p.set('model', next)
    router.push(`?${p.toString()}`)
  }

  const totals = creatives.reduce((a, c) => ({
    orders: a.orders + c.orders,
    revenue: a.revenue + c.revenue,
    spend: a.spend + c.spend,
    metaPurchases: a.metaPurchases + c.metaPurchases,
    metaRevenue: a.metaRevenue + c.metaRevenue,
  }), { orders: 0, revenue: 0, spend: 0, metaPurchases: 0, metaRevenue: 0 })

  const gap = totals.revenue > 0
    ? ((totals.metaRevenue - totals.revenue) / totals.revenue) * 100
    : 0

  return (
    <>
      <Coverage coverage={coverage} />

      {/* Journey against what Meta claims */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 12, marginBottom: 20,
      }}>
        <Stat label="Receita pela jornada" value={fmt(totals.revenue)} sub={`${totals.orders.toFixed(0)} pedidos`} />
        <Stat label="Receita declarada pelo Meta" value={fmt(totals.metaRevenue)} sub={`${totals.metaPurchases} compras`} />
        <Stat
          label="Diferença"
          value={`${gap >= 0 ? '+' : ''}${gap.toFixed(0)}%`}
          sub={gap >= 0 ? 'o Meta declara a mais' : 'o Meta declara a menos'}
          color={Math.abs(gap) > 25 ? '#F43F5E' : Math.abs(gap) > 10 ? '#F59E0B' : '#10B981'}
        />
        <Stat label="Gasto no período" value={fmt(totals.spend)}
          sub={`ROAS ${totals.spend > 0 ? (totals.revenue / totals.spend).toFixed(2) : '—'}× real · ${totals.spend > 0 ? (totals.metaRevenue / totals.spend).toFixed(2) : '—'}× Meta`} />
      </div>

      <Section
        title="De onde vieram as vendas"
        hint="Pelo primeiro toque registrado na jornada"
      >
        <SourceList sources={sources} fmt={fmt} />
      </Section>

      <Section
        title="Por criativo"
        hint="A coluna do Meta é o que a plataforma declara para si mesma no mesmo período"
        right={
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
            {MODELS.map(m => (
              <button
                key={m.key}
                onClick={() => setModel(m.key)}
                title={m.hint}
                style={{
                  padding: '5px 11px', borderRadius: 6, border: 'none', fontSize: 12,
                  fontWeight: 600, cursor: 'pointer',
                  background: model === m.key ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'transparent',
                  color: model === m.key ? '#fff' : 'var(--text-dim)',
                }}
              >{m.label}</button>
            ))}
          </div>
        }
      >
        <CreativeTable creatives={creatives} fmt={fmt} />
      </Section>

      <Section title="Jornadas recentes" hint="Clique num pedido para ver o caminho completo">
        <JourneyList journeys={journeys} fmt={fmt} />
      </Section>
    </>
  )
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

/** A ranking built from a fraction of the orders looks authoritative and is
 *  not, so the share actually measured is stated before any of the numbers. */
function Coverage({ coverage }: { coverage: Coverage }) {
  const good = coverage.pct >= 90
  return (
    <div style={{
      background: good ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)',
      border: `1px dashed ${good ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.35)'}`,
      borderRadius: 10, padding: '10px 16px', marginBottom: 20,
      fontSize: 12, color: good ? '#10B981' : '#F59E0B',
    }}>
      {coverage.orders === 0 ? 'Sem pedidos no período.' : (
        <>
          <b>{coverage.pct}%</b> dos {coverage.orders} pedidos do período têm a jornada coletada
          {' · '}<b>{coverage.attributablePct}%</b> dão para ligar a um criativo específico.
          {!good && ' O restante ainda está sendo coletado — os números abaixo sobem conforme isso avança.'}
        </>
      )}
    </div>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Stat({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.4px', color: color ?? 'var(--text-primary)' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '3px 0 0' }}>{sub}</p>}
    </div>
  )
}

function Section({ title, hint, right, children }: {
  title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 12, marginBottom: 20, overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h2>
          {hint && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '2px 0 0' }}>{hint}</p>}
        </div>
        {right}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </section>
  )
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const SOURCE_COLOR: Record<string, string> = {
  'Anúncio pago': '#8B5CF6',
  'Direto': '#71717A',
  'Google': '#38BDF8',
  'Instagram orgânico': '#F43F5E',
  'Facebook orgânico': '#3987E5',
  'Sem rastreio': '#52525B',
}

function SourceList({ sources, fmt }: { sources: SourceRow[]; fmt: (n: number) => string }) {
  if (!sources.length) return <Empty>Nada no período.</Empty>
  const total = sources.reduce((s, r) => s + r.revenue, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {sources.map(s => {
        const pct = total > 0 ? (s.revenue / total) * 100 : 0
        return (
          <div key={s.source}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-primary)', flex: 1 }}>{s.source}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(s.revenue)}</span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 96, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {s.orders} ped · {pct.toFixed(0)}%
              </span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
              <div style={{
                width: `${Math.max(pct, 0.5)}%`, height: '100%', borderRadius: 3,
                background: SOURCE_COLOR[s.source] ?? '#A78BFA', opacity: 0.85,
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Creatives ────────────────────────────────────────────────────────────────

function CreativeTable({ creatives, fmt }: { creatives: CreativeAttribution[]; fmt: (n: number) => string }) {
  if (!creatives.length) return <Empty>Nenhum anúncio com gasto ou venda no período.</Empty>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <th style={{ textAlign: 'left',  padding: '8px 4px', fontWeight: 600 }}>Criativo</th>
            <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 600 }}>Gasto</th>
            <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 600 }}>Pedidos</th>
            <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 600 }}>Receita</th>
            <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 600 }}>ROAS real</th>
            <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 600, color: '#3987E5' }}>Meta diz</th>
            <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 600 }}>Diferença</th>
          </tr>
        </thead>
        <tbody>
          {creatives.map(c => {
            // A creative Meta credits far beyond what the journey saw is the
            // one most likely being scaled on conversions that did not happen.
            const gap = c.revenue > 0 ? ((c.metaRevenue - c.revenue) / c.revenue) * 100
              : c.metaRevenue > 0 ? Infinity : 0
            const loud = gap === Infinity || Math.abs(gap) > 50
            return (
              <tr key={c.adId} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 4px', maxWidth: 260 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {c.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail} alt="" width={28} height={28}
                        style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{
                        margin: 0, color: 'var(--text-primary)', fontWeight: 500,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{c.name ?? c.adId}</p>
                      {c.campaignName && (
                        <p style={{
                          margin: 0, fontSize: 10, color: 'var(--text-faint)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{c.campaignName}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(c.spend)}</td>
                <td style={{ padding: '10px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{c.orders.toFixed(c.orders % 1 ? 1 : 0)}</td>
                <td style={{ padding: '10px 4px', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{fmt(c.revenue)}</td>
                <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: (c.roasJourney ?? 0) >= 2 ? '#10B981' : (c.roasJourney ?? 0) >= 1 ? '#F59E0B' : '#F43F5E' }}>
                  {c.roasJourney != null ? `${c.roasJourney.toFixed(2)}×` : '—'}
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', color: '#3987E5' }}>
                  {fmt(c.metaRevenue)}
                  <span style={{ display: 'block', fontSize: 10, opacity: 0.7 }}>{c.metaPurchases} compras</span>
                </td>
                <td style={{
                  padding: '10px 4px', textAlign: 'right', fontWeight: 600,
                  color: loud ? '#F43F5E' : 'var(--text-dim)',
                }}>
                  {gap === Infinity ? 'só o Meta vê'
                    : gap === 0 ? '—'
                    : `${gap > 0 ? '+' : ''}${gap.toFixed(0)}%`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Journeys ─────────────────────────────────────────────────────────────────

function JourneyList({ journeys, fmt }: { journeys: JourneyOrder[]; fmt: (n: number) => string }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!journeys.length) return <Empty>Sem pedidos no período.</Empty>

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {journeys.map(j => {
        const isOpen = open === j.orderId
        return (
          <div key={j.orderId} style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setOpen(isOpen ? null : j.orderId)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                background: 'transparent', border: 'none', padding: '10px 2px',
                cursor: 'pointer', textAlign: 'left', color: 'inherit',
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--text-faint)', width: 12 }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600, width: 70 }}>
                #{j.orderNumber ?? '—'}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', width: 80 }}>{fmt(j.total)}</span>
              <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-dim)' }}>
                {j.touches.length === 0
                  ? 'sem toques registrados'
                  : `${j.momentsCount ?? j.touches.length} toque${(j.momentsCount ?? j.touches.length) === 1 ? '' : 's'}`}
                {j.daysToConversion != null && ` · ${j.daysToConversion} dia${j.daysToConversion === 1 ? '' : 's'} até comprar`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {j.createdAt.slice(0, 10).split('-').reverse().join('/')}
              </span>
            </button>

            {isOpen && (
              <ol style={{ listStyle: 'none', margin: '0 0 12px', padding: '0 0 0 34px' }}>
                {j.touches.length === 0 && (
                  <li style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                    A Shopify não registrou nenhuma visita antes deste pedido.
                  </li>
                )}
                {j.touches.map(t => (
                  <li key={t.seq} style={{
                    position: 'relative', padding: '7px 0 7px 16px',
                    borderLeft: '1px solid var(--border)',
                  }}>
                    <span style={{
                      position: 'absolute', left: -4, top: 12, width: 7, height: 7, borderRadius: '50%',
                      background: t.adId ? '#8B5CF6' : 'var(--text-ghost)',
                    }} />
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>
                      {t.adName ?? (t.adId ? `anúncio ${t.adId}` : t.source ?? 'origem desconhecida')}
                      {t.utmMedium === 'paid' && !t.adId && (
                        <span style={{ color: '#F59E0B', fontSize: 10, marginLeft: 6 }}>pago, sem identificação</span>
                      )}
                    </p>
                    <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'var(--text-faint)' }}>
                      {t.occurredAt ? new Date(t.occurredAt).toLocaleString('pt-BR') : '—'}
                      {t.source && ` · ${t.source}`}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: 0 }}>{children}</p>
}
