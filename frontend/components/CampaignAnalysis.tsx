'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { makeFmt } from '@/lib/format'
import { useSettings } from '@/contexts/SettingsContext'
import {
  VERDICT_LABEL, VERDICT_COLOR, TREND_LABEL, TREND_COLOR,
  type CampaignVerdict, type CampaignTrend,
} from '@/lib/campaignSignal'

interface DayPoint {
  date: string; spend: number; revenue: number; purchases: number
  roas: number; profit: number | null
}

interface CampaignRow {
  campaign_id: string; campaign_name: string
  objective: string | null; status: string | null
  adset_count: number; ad_count: number
  spend: number; revenue: number; purchases: number
  impressions: number; clicks: number; ctr: number; cpm: number
  cpc: number | null; aov: number | null
  roas: number; breakEven: number; contribution: number
  profit: number; profitPct: number
  cpa: number | null; contributionPerOrder: number | null
  verdict: CampaignVerdict
  trend: CampaignTrend
  recentDays: number; recentSpend: number; recentRoas: number; recentProfit: number
  baseRoas: number; lift: number | null; accelerating: boolean
  days: number; daysProfitable: number
  series: DayPoint[]
}

interface ApiResponse {
  dateFrom: string; dateTo: string
  configured: boolean; marginRate: number; breakEvenRoas: number | null
  campaigns: CampaignRow[]
  totals: {
    spend: number; revenue: number; profit: number; profitPct: number
    roas: number; count: number; losing: number; scaling: number; cooling: number
  }
  fbRevenueGap: number | null
  storeRevenue: number
}

const PRESETS = [
  { label: 'Hoje', days: 1  },
  { label: '7d',   days: 7  },
  { label: '14d',  days: 14 },
  { label: '30d',  days: 30 },
]

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgo(n: number) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n + 1); return d
}

function VerdictBadge({ v }: { v: CampaignVerdict }) {
  const color = VERDICT_COLOR[v]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color, background: `${color}1f`,
      border: `1px solid ${color}4d`, borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap',
    }}>
      {VERDICT_LABEL[v]}
    </span>
  )
}

/**
 * Which way it is moving. Carries its own numbers in the tooltip because the
 * tag is a claim, and the claim should be checkable without leaving the row.
 */
function TrendBadge({ c, fmt }: { c: CampaignRow; fmt: (n: number) => string }) {
  if (c.trend === 'curto' || c.trend === 'estavel') return null
  const color = TREND_COLOR[c.trend]
  const arrow = c.trend === 'escalar' ? '↑' : '↓'
  const title = c.trend === 'escalar'
    ? `Últimos ${c.recentDays} dias com gasto: ROAS ${c.recentRoas.toFixed(2)}x e ${fmt(c.recentProfit)} de lucro`
      + (c.baseRoas > 0 ? `, contra ${c.baseRoas.toFixed(2)}x antes disso` : ' (não há período anterior para comparar)')
      + (c.lift !== null ? ` — ${c.lift > 0 ? '+' : ''}${c.lift.toFixed(0)}%` : '')
      + (c.accelerating ? '. Os últimos 2 dias estão acima da própria semana.' : '')
    : `Últimos ${c.recentDays} dias com gasto: ROAS ${c.recentRoas.toFixed(2)}x e ${fmt(c.recentProfit)}`
      + `, contra ${c.baseRoas.toFixed(2)}x antes disso. Vinha pagando as próprias contas e parou.`
  return (
    <span title={title} style={{
      fontSize: 9.5, fontWeight: 700, color, background: `${color}1f`,
      border: `1px solid ${color}4d`, borderRadius: 5, padding: '2px 6px',
      whiteSpace: 'nowrap', cursor: 'help',
    }}>
      {arrow} {TREND_LABEL[c.trend]}
    </span>
  )
}

/** ROAS next to the bar it has to clear — the number alone says nothing. */
function RoasVsBreakEven({ roas, breakEven }: { roas: number; breakEven: number }) {
  const ok = breakEven > 0 ? roas >= breakEven : roas >= 1
  const color = breakEven > 0
    ? (roas >= breakEven * 1.2 ? '#10B981' : ok ? '#F59E0B' : '#F43F5E')
    : 'var(--text-muted)'
  return (
    <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {roas.toFixed(2)}x
      </div>
      {breakEven > 0 && (
        <div style={{ fontSize: 9.5, color: 'var(--text-ghost)', fontVariantNumeric: 'tabular-nums' }}>
          empate {breakEven.toFixed(2)}x
        </div>
      )}
    </div>
  )
}

/**
 * Profit per day as a bar strip. Bars go up from a baseline for a day that
 * made money and down for one that lost, so a campaign that turned around
 * mid-window reads as a shape instead of an average.
 */
function DailyStrip({ series, fmt }: { series: DayPoint[]; fmt: (n: number) => string }) {
  const withProfit = series.filter(d => d.profit !== null)
  if (withProfit.length === 0) {
    return <span style={{ fontSize: 10, color: 'var(--text-ghost)' }}>—</span>
  }
  const max = Math.max(...withProfit.map(d => Math.abs(d.profit as number)), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 28 }}>
      {series.map(d => {
        const p = d.profit
        if (p === null) {
          return <div key={d.date} style={{ width: 4, height: 2, background: 'var(--border)', borderRadius: 1 }} />
        }
        const h = Math.max((Math.abs(p) / max) * 12, 1.5)
        const up = p > 0
        return (
          <div
            key={d.date}
            title={`${d.date}\nlucro ${fmt(p)} · ROAS ${d.roas.toFixed(2)}x · ${d.purchases} compras · gasto ${fmt(d.spend)}`}
            style={{ width: 4, height: 28, display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'help' }}
          >
            <div style={{ height: 13, display: 'flex', alignItems: 'flex-end' }}>
              {up && <div style={{ width: '100%', height: h, background: '#10B981', borderRadius: '1px 1px 0 0' }} />}
            </div>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div style={{ height: 13 }}>
              {!up && <div style={{ width: '100%', height: h, background: '#F43F5E', borderRadius: '0 0 1px 1px' }} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const COLS = '1fr 92px 84px 70px 96px 74px 120px 94px'

export default function CampaignAnalysis() {
  const { currency } = useSettings()
  const fmt = makeFmt(currency)

  const [preset, setPreset]     = useState(7)
  const [dateFrom, setDateFrom] = useState(() => toISO(daysAgo(7)))
  const [dateTo, setDateTo]     = useState(() => toISO(new Date()))
  const [filter, setFilter]     = useState<'todas' | 'prejuizo' | 'lucro' | 'escalar'>('todas')
  const [data, setData]         = useState<ApiResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/campaigns/analysis?dateFrom=${from}&dateTo=${to}`)
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
    } catch {
      setError('Não foi possível carregar a análise por campanha.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load(dateFrom, dateTo) }, [load, dateFrom, dateTo])

  function applyPreset(days: number) {
    setPreset(days)
    setDateFrom(toISO(daysAgo(days)))
    setDateTo(toISO(new Date()))
  }

  const all  = data?.campaigns ?? []
  const rows = filter === 'todas'    ? all
             : filter === 'prejuizo' ? all.filter(c => c.verdict === 'prejuizo')
             : filter === 'escalar'  ? all.filter(c => c.trend === 'escalar')
             : all.filter(c => c.verdict === 'lucro')
  const maxSpend = Math.max(...all.map(c => c.spend), 1)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Resultado por Campanha
            </h3>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '3px 0 0' }}>
              {data?.configured
                ? <>Receita do Meta × margem de contribuição de <strong style={{ color: '#A78BFA' }}>{data.marginRate.toFixed(1)}%</strong> − gasto. Empate em <strong style={{ color: '#A78BFA' }}>{data.breakEvenRoas?.toFixed(2)}x</strong>.</>
                : 'Configure seus custos em Calculadora de Lucro para ver lucro e margem por campanha'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {PRESETS.map(p => (
              <button key={p.days} onClick={() => applyPreset(p.days)} style={{
                padding: '4px 10px', fontSize: 11, borderRadius: 6, fontWeight: 600, cursor: 'pointer',
                background: preset === p.days ? 'rgba(139,92,246,0.2)' : 'var(--bg-hover)',
                border: `1px solid ${preset === p.days ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
                color: preset === p.days ? '#A78BFA' : 'var(--text-muted)',
              }}>{p.label}</button>
            ))}
          </div>
        </div>

        {/* Period totals: the one line that answers "and overall?" */}
        {data && !loading && all.length > 0 && (
          <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {[
              { l: 'Gasto',       v: fmt(data.totals.spend),   c: '#8B5CF6' },
              { l: 'Receita Meta', v: fmt(data.totals.revenue), c: 'var(--text-secondary)' },
              { l: 'ROAS',        v: `${data.totals.roas.toFixed(2)}x`, c: 'var(--text-secondary)' },
              ...(data.configured ? [
                { l: 'Resultado', v: fmt(data.totals.profit), c: data.totals.profit >= 0 ? '#10B981' : '#F43F5E' },
                { l: 'Margem',    v: `${data.totals.profitPct.toFixed(1)}%`, c: data.totals.profitPct >= 0 ? '#10B981' : '#F43F5E' },
              ] : []),
              { l: 'Campanhas', v: `${data.totals.count}${data.totals.losing > 0 ? ` · ${data.totals.losing} no vermelho` : ''}`, c: 'var(--text-muted)' },
              ...(data.totals.scaling > 0
                ? [{ l: 'Virando p/ cima', v: `${data.totals.scaling}`, c: '#10B981' }] : []),
              ...(data.totals.cooling > 0
                ? [{ l: 'Esfriando', v: `${data.totals.cooling}`, c: '#F59E0B' }] : []),
            ].map(m => (
              <div key={m.l}>
                <span style={{ fontSize: 9.5, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>{m.l}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: m.c, fontVariantNumeric: 'tabular-nums' }}>{m.v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        {all.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {([
              ['todas',    `Todas (${all.length})`],
              ['escalar',  `↑ Escalar (${all.filter(c => c.trend === 'escalar').length})`],
              ['prejuizo', `Prejuízo (${all.filter(c => c.verdict === 'prejuizo').length})`],
              ['lucro',    `Lucro (${all.filter(c => c.verdict === 'lucro').length})`],
            ] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                background: filter === k ? 'var(--bg-hover)' : 'transparent',
                border: `1px solid ${filter === k ? 'var(--border-strong)' : 'transparent'}`,
                color: filter === k ? 'var(--text-primary)' : 'var(--text-faint)',
              }}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {error ? (
        <div style={{ padding: '36px 18px', textAlign: 'center', color: '#F43F5E', fontSize: 13 }}>{error}</div>
      ) : loading ? (
        <div style={{ padding: 14 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '10px 4px' }}>
              {Array(8).fill(0).map((_, j) => (
                <div key={j} style={{ height: 12, background: 'var(--bg-hover)', borderRadius: 4, width: j === 0 ? '70%' : '60%' }} />
              ))}
            </div>
          ))}
        </div>
      ) : all.length === 0 ? (
        <div style={{ padding: '46px 18px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>Nenhuma campanha com gasto neste período</p>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '34px 18px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>
            {filter === 'prejuizo' ? 'Nenhuma campanha no vermelho neste período.'
           : filter === 'escalar' ? 'Nenhuma campanha virando para cima neste período. A marca exige os últimos 7 dias pagando as próprias contas e melhores que o período anterior.'
           : 'Nenhuma campanha lucrativa neste período.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            {/* Column heads */}
            <div style={{
              display: 'grid', gridTemplateColumns: COLS, padding: '6px 18px',
              fontSize: 9.5, color: 'var(--text-faint)', fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              borderBottom: '1px solid var(--border)',
            }}>
              <span>Campanha</span>
              <span>Gasto</span>
              <span style={{ textAlign: 'right' }}>Receita Meta</span>
              <span style={{ textAlign: 'right' }}>ROAS</span>
              <span style={{ textAlign: 'right' }}>Resultado</span>
              <span style={{ textAlign: 'right' }}>Margem</span>
              <span style={{ textAlign: 'center' }}>Lucro por dia</span>
              <span style={{ textAlign: 'right' }}>Veredito</span>
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={`${filter}-${dateFrom}-${dateTo}`}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {rows.map((c, i) => {
                  const spendPct = (c.spend / maxSpend) * 100
                  const profitColor = c.profit >= 0 ? '#10B981' : '#F43F5E'
                  const dim = c.verdict === 'pouco_dado'
                  return (
                    <div key={c.campaign_id} style={{
                      display: 'grid', gridTemplateColumns: COLS, padding: '11px 18px',
                      alignItems: 'center', opacity: dim ? 0.55 : 1,
                      borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                    }}>
                      {/* Name */}
                      <div style={{ minWidth: 0, paddingRight: 12 }}>
                        <div style={{
                          fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }} title={c.campaign_name}>
                          {c.campaign_name}
                        </div>
                        <div style={{ display: 'flex', gap: 7, marginTop: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                          {c.status && c.status !== 'ACTIVE' && (
                            <span style={{ fontSize: 9, color: '#F59E0B', background: 'rgba(245,158,11,0.12)', borderRadius: 3, padding: '1px 4px' }}>
                              {c.status === 'PAUSED' ? 'pausada' : c.status.toLowerCase()}
                            </span>
                          )}
                          <span style={{ fontSize: 9.5, color: 'var(--text-ghost)', fontVariantNumeric: 'tabular-nums' }}>
                            {c.purchases} compras
                            {c.cpa !== null && ` · CPA ${fmt(c.cpa)}`}
                            {c.aov !== null && ` · AOV ${fmt(c.aov)}`}
                          </span>
                        </div>
                      </div>

                      {/* Spend + share bar */}
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.spend)}</div>
                        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${spendPct}%`, height: '100%', background: '#8B5CF6', borderRadius: 2 }} />
                        </div>
                      </div>

                      <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(c.revenue)}
                      </span>

                      <RoasVsBreakEven roas={c.roas} breakEven={c.breakEven} />

                      {/* The money answer */}
                      <div style={{ textAlign: 'right' }}>
                        {data?.configured ? (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 700, color: profitColor, fontVariantNumeric: 'tabular-nums' }}>
                              {c.profit >= 0 ? '+' : ''}{fmt(c.profit)}
                            </div>
                            {c.contributionPerOrder !== null && c.cpa !== null && (
                              <div style={{ fontSize: 9.5, color: 'var(--text-ghost)', fontVariantNumeric: 'tabular-nums' }}
                                title="Margem que cada pedido deixa contra o que o anúncio custou para trazê-lo">
                                {fmt(c.contributionPerOrder)} vs {fmt(c.cpa)}
                              </div>
                            )}
                          </>
                        ) : <span style={{ color: 'var(--text-ghost)', fontSize: 12 }}>—</span>}
                      </div>

                      <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: data?.configured ? profitColor : 'var(--text-ghost)', fontVariantNumeric: 'tabular-nums' }}>
                        {data?.configured ? `${c.profitPct.toFixed(1)}%` : '—'}
                      </span>

                      {/* Daily shape */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <DailyStrip series={c.series} fmt={fmt} />
                        {data?.configured && c.days > 0 && (
                          <span style={{ fontSize: 9, color: 'var(--text-ghost)', fontVariantNumeric: 'tabular-nums' }}>
                            {c.daysProfitable}/{c.days} dias no azul
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <VerdictBadge v={c.verdict} />
                        <TrendBadge c={c} fmt={fmt} />
                      </div>
                    </div>
                  )
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── Footnotes that change how the numbers should be read ─────────── */}
      {!loading && all.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {!data?.configured && (
            <div style={{ padding: '9px 18px', background: 'rgba(245,158,11,0.05)', fontSize: 11, color: '#F59E0B' }}>
              ⚠ Sem custos configurados não há como dizer se a campanha lucra. Preencha COGS, frete e taxas em Calculadora de Lucro.
            </div>
          )}
          {data?.fbRevenueGap !== null && data?.fbRevenueGap !== undefined && Math.abs(data.fbRevenueGap) >= 15 && (
            <div style={{ padding: '9px 18px', background: 'rgba(56,189,248,0.05)', fontSize: 11, color: '#38BDF8' }}>
              ℹ O Meta reivindica {data.fbRevenueGap > 0 ? '+' : ''}{data.fbRevenueGap.toFixed(0)}% a {data.fbRevenueGap > 0 ? 'mais' : 'menos'} do que a loja faturou no período
              ({fmt(data.totals.revenue)} contra {fmt(data.storeRevenue)}).
              {data.fbRevenueGap > 0 && ' Cada linha acima está otimista mais ou menos nessa proporção.'}
            </div>
          )}
          <div style={{ padding: '9px 18px', fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.65 }}>
            Receita por campanha é a que o Meta atribui — o pedido da Shopify não carrega o id da campanha nas nossas tabelas.
            O resultado aplica a margem de contribuição da loja sobre essa receita e desconta o gasto da própria campanha.
            <br />
            <strong style={{ color: '#10B981' }}>↑ Escalar</strong> marca a campanha cujos últimos 7 dias pagam as próprias contas e vêm melhores
            que o período anterior — mesmo que o total ainda esteja no vermelho. <strong style={{ color: '#F59E0B' }}>↓ Esfriando</strong> é o contrário:
            o total ainda parece bom, mas a última semana já não se paga. Passe o mouse na marca para ver os números dela.
          </div>
        </div>
      )}
    </motion.div>
  )
}
