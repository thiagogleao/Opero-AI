import { useCallback, useEffect, useState, useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell
} from 'recharts'
import type { StoreStats, Alert, DailyPoint, Tenant } from '../../../preload'

// ─── Cache ────────────────────────────────────────────────────────────────────

const HOME_CACHE_MS = 5 * 60 * 1000
type PeriodKey = '1d' | '7d' | '30d' | 'mtd' | '90d'
interface PeriodStats { curr: StoreStats[]; prev: StoreStats[] }
interface HomeCache {
  tenants: Tenant[]
  alerts: Alert[]
  daily: Record<string, DailyPoint[]>
  stats: Record<PeriodKey, PeriodStats>
  ts: number
}
let _cache: HomeCache | null = null

// ─── Constants ────────────────────────────────────────────────────────────────

const STORE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4']
const PERIODS: PeriodKey[] = ['1d', '7d', '30d', 'mtd', '90d']
const PERIOD_LABELS: Record<PeriodKey, string> = {
  '1d': 'Hoje', '7d': '7 dias', '30d': '30 dias', 'mtd': 'Este mês', '90d': '90 dias',
}
const FULL_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const SHORT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const DAYS_PT = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dateOf = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10)
}
const thisMonthStart = () => {
  const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10)
}
const prevMonthRange = (): [string, string] => {
  const n = new Date()
  return [
    new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString().slice(0, 10),
    new Date(n.getFullYear(), n.getMonth(), 0).toISOString().slice(0, 10),
  ]
}

function periodDates(k: PeriodKey) {
  const today = dateOf(0)
  const yest  = dateOf(-1)
  switch (k) {
    case '1d':  return { cFrom: today,       cTo: today, pFrom: yest,        pTo: yest,       chartFrom: dateOf(-13) }
    case '7d':  return { cFrom: dateOf(-6),  cTo: today, pFrom: dateOf(-13), pTo: dateOf(-7), chartFrom: dateOf(-6)  }
    case '30d': return { cFrom: dateOf(-29), cTo: today, pFrom: dateOf(-59), pTo: dateOf(-30),chartFrom: dateOf(-29) }
    case 'mtd': {
      const ms = thisMonthStart(); const [ps, pe] = prevMonthRange()
      return { cFrom: ms, cTo: today, pFrom: ps, pTo: pe, chartFrom: ms }
    }
    case '90d': return { cFrom: dateOf(-89), cTo: today, pFrom: dateOf(-179), pTo: dateOf(-90), chartFrom: dateOf(-89) }
  }
}

const usd = (v: number, dec = 0) =>
  (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const sumStats = (ss: StoreStats[]) => ss.reduce(
  (a, s) => ({ profit: a.profit + s.profit, revenue: a.revenue + s.revenue, orders: a.orders + s.orders, fbSpend: a.fbSpend + s.fbSpend }),
  { profit: 0, revenue: 0, orders: 0, fbSpend: 0 }
)

const pctChange = (curr: number, prev: number): number | null =>
  prev === 0 ? null : ((curr - prev) / Math.abs(prev)) * 100

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' }

// Daily totals across all tenants for a given date
function dailyTotal(tenants: Tenant[], daily: Record<string, DailyPoint[]>, date: string, sf: number) {
  return tenants.reduce((s, t) => s + (daily[t.id]?.find(p => p.date === date)?.profit ?? 0) * sf, 0)
}

// ─── Narrative / Insights ─────────────────────────────────────────────────────

function buildBriefing(
  stats: Record<PeriodKey, PeriodStats>,
  daily: Record<string, DailyPoint[]>,
  tenants: Tenant[],
  sf: number,
): string[] {
  const lines: string[] = []
  const today   = dateOf(0)
  const yDate   = dateOf(-1)
  const yMinus7 = dateOf(-7)

  const yProfit   = dailyTotal(tenants, daily, today, sf)
  const y7Profit  = dailyTotal(tenants, daily, yMinus7, sf)
  const yOrders   = stats['1d'].curr.reduce((s, st) => s + st.orders, 0)

  const w7Curr = sumStats(stats['7d'].curr)
  const w7Prev = sumStats(stats['7d'].prev)
  const wChg   = pctChange(w7Curr.profit * sf, w7Prev.profit * sf)

  // Yesterday line
  if (yOrders === 0) {
    lines.push('Nenhum pedido registrado hoje ainda.')
  } else {
    const yChg = pctChange(yProfit, y7Profit)
    const dir  = yChg !== null ? (yChg >= 0 ? ` — ↑${yChg.toFixed(0)}% vs mesma semana passada` : ` — ↓${Math.abs(yChg).toFixed(0)}% vs mesma semana passada`) : ''
    lines.push(`Hoje: ${yOrders} pedido${yOrders !== 1 ? 's' : ''} e ${usd(yProfit, 2)} de lucro até agora${dir}.`)
  }

  // Week line
  if (w7Curr.orders > 0 && wChg !== null) {
    const dir = wChg >= 0 ? 'acima' : 'abaixo'
    lines.push(
      `Últimos 7 dias: ${usd(w7Curr.profit * sf, 0)} de lucro — ${Math.abs(wChg).toFixed(0)}% ${dir} da semana anterior.`
    )
  }

  // Best store this week
  const weekCurr = stats['7d'].curr.map(s => ({ ...s, profit: s.profit * sf })).sort((a, b) => b.profit - a.profit)
  if (weekCurr.length > 1 && weekCurr[0].profit > 0) {
    const best     = weekCurr[0]
    const bestPrev = stats['7d'].prev.find(p => p.tenantId === best.tenantId)
    const bestChg  = bestPrev ? pctChange(best.profit, bestPrev.profit * sf) : null
    const chgStr   = bestChg !== null ? ` (${bestChg >= 0 ? '↑' : '↓'}${Math.abs(bestChg).toFixed(0)}% vs semana passada)` : ''
    lines.push(`${best.displayName} liderou com ${usd(best.profit, 0)}${chgStr}.`)
  }

  // Month projection
  const mtdCurr  = sumStats(stats['mtd'].curr)
  const now      = new Date()
  const dayElaps = now.getDate() - 1
  if (dayElaps > 0 && mtdCurr.orders > 0) {
    const daysInMth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const projection = (mtdCurr.profit * sf / dayElaps) * daysInMth
    lines.push(
      `Em ${dayElaps} dias de ${SHORT_MONTHS[now.getMonth()]}, lucro acumulado: ${usd(mtdCurr.profit * sf, 0)}. Projeção para o mês: ${usd(projection, 0)}.`
    )
  }

  return lines
}

interface Insight { type: 'positive' | 'warning' | 'info'; text: string }

function generateInsights(
  stats: Record<PeriodKey, PeriodStats>,
  daily: Record<string, DailyPoint[]>,
  tenants: Tenant[],
  sf: number,
): Insight[] {
  const insights: Insight[] = []
  const now        = new Date()
  const dayElaps   = now.getDate() - 1
  const prevMoDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate()

  // 1. Store week-over-week changes
  const weekChanges = stats['7d'].curr.map(s => {
    const prev = stats['7d'].prev.find(p => p.tenantId === s.tenantId)
    return { ...s, profit: s.profit * sf, chg: prev ? pctChange(s.profit * sf, prev.profit * sf) : null }
  })
  weekChanges.sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0))

  const topGainer = weekChanges.find(s => (s.chg ?? 0) > 5)
  const topLoser  = [...weekChanges].reverse().find(s => (s.chg ?? 0) < -5)

  if (topGainer?.chg != null)
    insights.push({ type: 'positive', text: `${topGainer.displayName} cresceu ${topGainer.chg.toFixed(0)}% no lucro em relação à semana passada.` })
  if (topLoser?.chg != null)
    insights.push({ type: 'warning', text: `${topLoser.displayName} caiu ${Math.abs(topLoser.chg).toFixed(0)}% vs semana passada — vale investigar.` })

  // 2. ROAS trends
  stats['7d'].curr.forEach(s => {
    const prev = stats['7d'].prev.find(p => p.tenantId === s.tenantId)
    if (!prev || s.fbSpend === 0 || prev.fbSpend === 0) return
    const currRoas = s.revenue / s.fbSpend
    const prevRoas = prev.revenue / prev.fbSpend
    const roasChg  = pctChange(currRoas, prevRoas)
    if (roasChg !== null && roasChg < -20)
      insights.push({ type: 'warning', text: `ROAS de ${s.displayName} caiu de ${prevRoas.toFixed(1)}x para ${currRoas.toFixed(1)}x esta semana.` })
    else if (roasChg !== null && roasChg > 20)
      insights.push({ type: 'positive', text: `ROAS de ${s.displayName} subiu de ${prevRoas.toFixed(1)}x para ${currRoas.toFixed(1)}x esta semana.` })
  })

  // 3. MTD daily average vs prev month
  if (dayElaps > 1) {
    const mtdCurr    = sumStats(stats['mtd'].curr)
    const mtdPrev    = sumStats(stats['mtd'].prev)
    const currAvg    = mtdCurr.profit * sf / dayElaps
    const prevAvg    = prevMoDays > 0 ? mtdPrev.profit * sf / prevMoDays : 0
    const avgChg     = pctChange(currAvg, prevAvg)
    const prevMoName = SHORT_MONTHS[now.getMonth() === 0 ? 11 : now.getMonth() - 1]
    if (avgChg !== null && avgChg > 10)
      insights.push({ type: 'positive', text: `Média diária de ${SHORT_MONTHS[now.getMonth()]} (${usd(currAvg, 0)}/dia) está ${avgChg.toFixed(0)}% acima da média de ${prevMoName}.` })
    else if (avgChg !== null && avgChg < -10)
      insights.push({ type: 'warning', text: `Média diária está ${Math.abs(avgChg).toFixed(0)}% abaixo de ${prevMoName} — ritmo caindo.` })
  }

  // 4. Best day in last 30 days was yesterday?
  const dateFrom30 = dateOf(-30)
  const yDate = dateOf(0)
  const datesSet = new Set<string>()
  tenants.forEach(t => daily[t.id]?.filter(p => p.date >= dateFrom30).forEach(p => datesSet.add(p.date)))
  let bestDayProfit = -Infinity; let bestDayDate = ''
  datesSet.forEach(date => {
    const tot = dailyTotal(tenants, daily, date, sf)
    if (tot > bestDayProfit) { bestDayProfit = tot; bestDayDate = date }
  })
  if (bestDayDate === yDate && bestDayProfit > 0)
    insights.push({ type: 'positive', text: `Hoje já é o dia mais lucrativo dos últimos 30 dias com ${usd(bestDayProfit, 0)}.` })

  // 5. Store with no orders today
  stats['1d'].curr.filter(s => s.orders === 0).forEach(s =>
    insights.push({ type: 'warning', text: `${s.displayName}: nenhum pedido hoje ainda.` })
  )

  // 6. FB spend without profit
  stats['7d'].curr.forEach(s => {
    if (s.fbSpend > 0 && s.profit * sf < 0)
      insights.push({ type: 'warning', text: `${s.displayName} gastou ${usd(s.fbSpend, 0)} em anúncios mas teve prejuízo de ${usd(s.profit * sf, 0)} esta semana.` })
  })

  return insights.slice(0, 6)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Pill({ value, size = 'md' }: { value: number | null; size?: 'sm' | 'md' }) {
  if (value === null) return null
  const up = value >= 0
  const fs = size === 'sm' ? 10 : 11
  return (
    <span style={{ fontSize: fs, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: up ? '#22c55e22' : '#ef444422', color: up ? '#22c55e' : '#ef4444', whiteSpace: 'nowrap' }}>
      {up ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function MorningBriefing({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <div style={{
      background: 'linear-gradient(135deg, #0a1a0c 0%, #0d1118 100%)',
      border: '1px solid #22c55e22', borderRadius: 14, padding: '20px 24px', marginBottom: 14,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: '#22c55e55', marginBottom: 12 }}>
        Briefing de hoje
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lines.map((line, i) => (
          <p key={i} style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: i === 0 ? '#ccc' : '#888' }}>{line}</p>
        ))}
      </div>
    </div>
  )
}

function KpiCard({ label, value, chg, color, sub }: { label: string; value: string; chg?: number | null; color?: string; sub?: string }) {
  return (
    <div style={{ background: '#13131c', border: '1px solid #1e1e2a', borderRadius: 12, padding: '14px 16px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color ?? '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {chg !== undefined && <Pill value={chg ?? null} size="sm" />}
        {sub && <span style={{ fontSize: 10, color: '#3a3a4a' }}>{sub}</span>}
      </div>
    </div>
  )
}

function ProfitChart({ tenants, daily, period, sf }: {
  tenants: Tenant[]; daily: Record<string, DailyPoint[]>; period: PeriodKey; sf: number
}) {
  const { chartFrom } = periodDates(period)
  const data = useMemo(() => {
    const dateSet = new Set<string>()
    tenants.forEach(t => daily[t.id]?.filter(p => p.date >= chartFrom).forEach(p => dateSet.add(p.date)))
    return Array.from(dateSet).sort().map(date => {
      const row: Record<string, number | string> = { date: date.slice(5).replace('-', '/') }
      let total = 0
      tenants.forEach(t => {
        const v = (daily[t.id]?.find(p => p.date === date)?.profit ?? 0) * sf
        row[t.display_name] = v
        total += v
      })
      row._total = total
      return row
    })
  }, [tenants, daily, chartFrom, sf])

  if (!data.length) return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 13 }}>Sem dados</div>

  const fmtY  = (v: number) => `$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)}`
  const isSingle = tenants.length === 1
  const mainKey = isSingle ? tenants[0].display_name : '_total'

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: '#444', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: '#444', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtY} width={40} />
        <ReferenceLine y={0} stroke="#2a2a3a" />
        <Tooltip
          contentStyle={{ background: '#141417', border: '1px solid #222', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#555' }}
          formatter={(v: number, name: string) => [usd(v, 2), isSingle ? 'Lucro' : name === '_total' ? 'Total' : name]}
        />
        <Area type="monotone" dataKey={mainKey} stroke="#22c55e" strokeWidth={2.5} fill="url(#pg)" dot={false} activeDot={{ r: 3 }} />
        {!isSingle && tenants.map((t, i) => (
          <Line key={t.id} type="monotone" dataKey={t.display_name}
            stroke={STORE_COLORS[i % STORE_COLORS.length]} strokeWidth={1.5}
            dot={false} activeDot={{ r: 2 }} strokeOpacity={0.7}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function StoreRanking({ stores, prevStores, period, sf }: {
  stores: StoreStats[]; prevStores: StoreStats[]; period: PeriodKey; sf: number
}) {
  const rows = [...stores]
    .map(s => {
      const prev = prevStores.find(p => p.tenantId === s.tenantId)
      return { ...s, profit: s.profit * sf, chg: prev ? pctChange(s.profit * sf, prev.profit * sf) : null }
    })
    .sort((a, b) => b.profit - a.profit)

  const maxAbs   = Math.max(...rows.map(r => Math.abs(r.profit)), 1)
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((s, i) => {
        const positive = s.profit >= 0
        const barW     = (Math.abs(s.profit) / maxAbs) * 100
        const revShare = totalRev > 0 ? (s.revenue / totalRev * 100) : 0
        const margin   = s.revenue > 0 ? (s.profit / s.revenue * 100) : 0
        const color    = STORE_COLORS[i % STORE_COLORS.length]
        return (
          <div key={s.tenantId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#000', flexShrink: 0 }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>{s.displayName}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill value={s.chg} size="sm" />
                <span style={{ fontSize: 15, fontWeight: 700, color: positive ? '#22c55e' : '#ef4444' }}>
                  {positive ? '+' : ''}{usd(s.profit, 0)}
                </span>
              </div>
            </div>
            <div style={{ height: 4, background: '#1a1a26', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', background: positive ? color : '#ef4444', borderRadius: 2, width: `${barW}%`, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#444' }}>
              <span>Receita {usd(s.revenue, 0)}</span>
              {s.configured && <span>Margem {margin.toFixed(1)}%</span>}
              {revShare > 0 && <span>{revShare.toFixed(0)}% do total</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StoreCard({ store, prev, color, daily, sf }: {
  store: StoreStats; prev?: StoreStats; color: string
  daily: DailyPoint[]; sf: number
}) {
  const profit   = store.profit * sf
  const prevProfit = prev ? prev.profit * sf : 0
  const chg      = prev ? pctChange(profit, prevProfit) : null
  const roas     = store.fbSpend > 0 ? store.revenue / store.fbSpend : null
  const prevRoas = prev && prev.fbSpend > 0 ? prev.revenue / prev.fbSpend : null
  const roasChg  = roas !== null && prevRoas !== null ? pctChange(roas, prevRoas) : null
  const margin   = store.revenue > 0 ? (profit / store.revenue * 100) : 0
  const revChg   = prev ? pctChange(store.revenue, prev.revenue) : null

  // Mini sparkline: last 7 days of profit
  const yDate = dateOf(-1)
  const sparkData = useMemo(() => {
    const days: { d: string; v: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = dateOf(-(i + 1))
      const v = (daily.find(p => p.date === d)?.profit ?? 0) * sf
      days.push({ d: d.slice(8), v })
    }
    return days
  }, [daily, sf])

  const positive = profit >= 0

  return (
    <div style={{
      background: '#13131c', border: `1px solid ${color}22`, borderRadius: 14,
      padding: '18px 20px', flex: 1, minWidth: 240,
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: color, letterSpacing: 0.5, marginBottom: 2 }}>{store.displayName}</div>
          {!store.configured && <div style={{ fontSize: 10, color: '#555' }}>Sem configuração de custo</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: positive ? '#22c55e' : '#ef4444', lineHeight: 1 }}>
            {positive ? '+' : ''}{usd(profit, 0)}
          </div>
          <div style={{ marginTop: 3 }}><Pill value={chg} size="sm" /></div>
        </div>
      </div>

      {/* Sparkline */}
      <div style={{ marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={50}>
          <AreaChart data={sparkData} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
            <defs>
              <linearGradient id={`sg-${store.tenantId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <ReferenceLine y={0} stroke="#2a2a3a" />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
              fill={`url(#sg-${store.tenantId})`} dot={false} />
            <Tooltip
              contentStyle={{ background: '#141417', border: '1px solid #222', borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: '#555' }}
              formatter={(v: number) => [usd(v, 2), 'Lucro']}
              labelFormatter={(l) => `Dia ${l}`}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 10, color: '#333', textAlign: 'center', marginTop: 2 }}>últimos 7 dias</div>
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
        {[
          { label: 'Receita', value: usd(store.revenue, 0), chg: revChg, color: '#ddd' },
          { label: 'Pedidos', value: String(store.orders), color: '#ddd' },
          {
            label: 'ROAS',
            value: roas !== null ? `${roas.toFixed(2)}×` : '—',
            chg: roasChg,
            color: roas === null ? '#555' : roas >= 2 ? '#22c55e' : roas >= 1 ? '#f59e0b' : '#ef4444',
          },
          {
            label: 'Margem',
            value: store.configured ? `${margin.toFixed(1)}%` : 'N/C',
            color: margin >= 15 ? '#22c55e' : margin >= 5 ? '#f59e0b' : '#ef4444',
          },
          { label: 'FB Spend', value: usd(store.fbSpend, 0), color: '#3b82f6' },
        ].map(m => (
          <div key={m.label}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 2 }}>{m.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: m.color }}>{m.value}</span>
              {(m as any).chg !== undefined && <Pill value={(m as any).chg} size="sm" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightsPanel({ items }: { items: Insight[] }) {
  if (!items.length) return null
  const icons = { positive: '✅', warning: '⚠️', info: 'ℹ️' }
  const colors = { positive: '#22c55e', warning: '#eab308', info: '#3b82f6' }
  return (
    <div style={{ background: '#0f0f18', border: '1px solid #1e1e2a', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 12 }}>
        ⚡ Insights
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((ins, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1.5 }}>{icons[ins.type]}</span>
            <span style={{ fontSize: 13, color: colors[ins.type], lineHeight: 1.6 }}>{ins.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const hit = _cache && Date.now() - _cache.ts < HOME_CACHE_MS ? _cache : null

  const [loading, setLoading] = useState(!hit)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<HomeCache | null>(hit)
  const [period, setPeriod]   = useState<PeriodKey>('7d')
  const [split, setSplit]     = useState(false)

  const [refreshing, setRefreshing] = useState(false)
  const [refreshErr, setRefreshErr] = useState<string | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    // This page keeps its own five-minute copy on top of the main process
    // cache, so a refresh has to drop both or the button does nothing.
    if (isRefresh) {
      _cache = null
      setRefreshing(true)
      await window.api.refreshCache().catch(() => null)
    } else {
      setLoading(true)
    }

    const periodEntries = PERIODS.map(k => [k, periodDates(k)] as [PeriodKey, ReturnType<typeof periodDates>])
    try {
      const tenants = await window.api.getTenants()
      const results = await Promise.all([
        window.api.getAlerts(),
        ...tenants.map(t => window.api.getDailyData(t.id, 90)),
        ...periodEntries.flatMap(([, d]) => [
          window.api.getAllStoresStats(d.cFrom, d.cTo),
          window.api.getAllStoresStats(d.pFrom, d.pTo),
        ]),
      ])

      const alerts = results[0] as Alert[]
      const daily: Record<string, DailyPoint[]> = {}
      tenants.forEach((t, i) => { daily[t.id] = results[1 + i] as DailyPoint[] })

      const statsFlat = results.slice(1 + tenants.length) as StoreStats[][]
      const stats: Record<PeriodKey, PeriodStats> = {} as any
      periodEntries.forEach(([k], i) => {
        stats[k] = { curr: statsFlat[i * 2] ?? [], prev: statsFlat[i * 2 + 1] ?? [] }
      })

      const c: HomeCache = { tenants, alerts, daily, stats, ts: Date.now() }
      _cache = c
      setData(c)
      setRefreshErr(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar dados'
      // A failed refresh must not throw away numbers already on screen — it
      // just marks the button, so you can see the figures are the old ones.
      if (isRefresh) setRefreshErr(msg)
      else setError(msg)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    window.api.getState().then(s => { if (s.split50) setSplit(true) }).catch(() => null)
    if (!hit) load()
  }, [])

  function toggleSplit() {
    const next = !split
    setSplit(next)
    window.api.setState({ split50: next }).catch(() => null)
  }

  if (loading || error || !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
        {error ? (
          <>
            <span style={{ color: '#ef4444', fontSize: 14 }}>Erro ao conectar ao banco de dados</span>
            <span style={{ color: '#555', fontSize: 12 }}>{error}</span>
            <button onClick={() => { _cache = null; setError(null); load() }}
              style={{ marginTop: 8, padding: '6px 16px', borderRadius: 6, background: '#1e1e2a', color: '#aaa', fontSize: 12, cursor: 'pointer', border: '1px solid #2a2a3a' }}>
              Tentar novamente
            </button>
          </>
        ) : (
          <>
            <div className="spin" style={{ width: 36, height: 36 }} />
            <span style={{ color: '#555', fontSize: 13 }}>Carregando briefing...</span>
          </>
        )}
      </div>
    )
  }

  const { tenants, alerts, daily, stats } = data
  const sf      = split ? 0.5 : 1
  const pd      = stats[period]
  const rawCurr = sumStats(pd.curr)
  const rawPrev = sumStats(pd.prev)
  const curr    = { ...rawCurr, profit: rawCurr.profit * sf }
  const chgPct  = pctChange(curr.profit, rawPrev.profit * sf)
  const roas    = curr.fbSpend > 0 ? curr.revenue / curr.fbSpend : null
  const prevRoas = rawPrev.fbSpend > 0 ? rawPrev.revenue / rawPrev.fbSpend : null
  const roasChg = roas !== null && prevRoas !== null ? pctChange(roas, prevRoas) : null
  const margin  = curr.revenue > 0 ? (curr.profit / curr.revenue * 100) : 0
  const revChg  = pctChange(curr.revenue, rawPrev.revenue)
  const ordChg  = pctChange(curr.orders, rawPrev.orders)

  const briefing = buildBriefing(stats, daily, tenants, sf)
  const insights = generateInsights(stats, daily, tenants, sf)

  const now = new Date()
  const todayStr = `${DAYS_PT[now.getDay()]}, ${now.getDate()} de ${FULL_MONTHS[now.getMonth()]}`

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px 40px', boxSizing: 'border-box' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>
            {greeting()}, Thiago 👋
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{todayStr}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => load(true)} disabled={refreshing}
            title={refreshErr
              ? `Falha ao atualizar: ${refreshErr}`
              : `Dados de ${new Date(data.ts).toLocaleTimeString('pt-BR')}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px',
              borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: `1px solid ${refreshErr ? '#ef4444' : '#1e1e2a'}`,
              background: '#0e0e16',
              color: refreshErr ? '#ef4444' : '#555',
              cursor: refreshing ? 'default' : 'pointer', whiteSpace: 'nowrap',
              opacity: refreshing ? 0.6 : 1,
            }}>
            <span style={{
              fontSize: 13, lineHeight: 1,
              animation: refreshing ? 'spin 0.7s linear infinite' : undefined,
            }}>⟳</span>
            {refreshing ? 'Atualizando...' : 'Atualizar'}
          </button>
          <button onClick={toggleSplit} title={split ? 'Ver lucro total' : 'Ver apenas sua parte (50%)'} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px',
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: `1px solid ${split ? '#8B5CF6' : '#1e1e2a'}`,
            background: split ? 'rgba(139,92,246,0.15)' : '#0e0e16',
            color: split ? '#A78BFA' : '#555', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: 13 }}>{split ? '👤' : '👥'}</span>
            {split ? 'Minha parte (50%)' : 'Lucro total'}
          </button>
          <div style={{ display: 'flex', gap: 3, background: '#0e0e16', border: '1px solid #1e1e2a', borderRadius: 9, padding: 3 }}>
            {PERIODS.map(k => (
              <button key={k} onClick={() => setPeriod(k)} style={{
                padding: '4px 11px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: period === k ? '#22c55e' : 'transparent',
                color: period === k ? '#000' : '#555',
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {PERIOD_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Morning briefing ────────────────────────────────────────────────── */}
      <MorningBriefing lines={briefing} />

      {/* ── Hero profit + KPIs ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'stretch' }}>
        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg, #0c1a0f 0%, #0f1318 70%)',
          border: '1px solid #22c55e1a', borderRadius: 14, padding: '18px 22px',
          minWidth: 200, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: '#22c55e55', marginBottom: 6 }}>
            Lucro · {PERIOD_LABELS[period]}
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: -1.5, lineHeight: 1, color: curr.profit >= 0 ? '#22c55e' : '#ef4444', marginBottom: 8 }}>
            {curr.profit >= 0 ? '+' : ''}{usd(curr.profit, 0)}
          </div>
          <Pill value={chgPct} />
          {chgPct !== null && <div style={{ fontSize: 10, color: '#333', marginTop: 4 }}>vs período anterior</div>}
        </div>

        {/* KPI cards */}
        <div style={{ display: 'flex', gap: 10, flex: 1 }}>
          <KpiCard label="Receita"    value={usd(curr.revenue, 0)}  chg={revChg} />
          <KpiCard label="Pedidos"    value={String(curr.orders)}    chg={ordChg} />
          <KpiCard label="FB Spend"   value={usd(curr.fbSpend, 0)}  color="#3b82f6" />
          <KpiCard
            label="ROAS"
            value={roas !== null ? `${roas.toFixed(2)}×` : '—'}
            chg={roasChg}
            color={roas === null ? '#555' : roas >= 2 ? '#22c55e' : roas >= 1 ? '#f59e0b' : '#ef4444'}
            sub="receita ÷ spend"
          />
          <KpiCard
            label="Margem"
            value={`${margin.toFixed(1)}%`}
            color={margin >= 15 ? '#22c55e' : margin >= 5 ? '#f59e0b' : '#ef4444'}
          />
        </div>
      </div>

      {/* ── Chart + Ranking (2 columns) ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 12, marginBottom: 14 }}>
        <div style={{ background: '#13131c', border: '1px solid #1e1e2a', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 12 }}>
            Lucro por dia — {PERIOD_LABELS[period]}
          </div>
          <ProfitChart tenants={tenants} daily={daily} period={period} sf={sf} />
        </div>

        <div style={{ background: '#13131c', border: '1px solid #1e1e2a', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 14 }}>
            Ranking · {PERIOD_LABELS[period]}
          </div>
          <StoreRanking stores={pd.curr} prevStores={pd.prev} period={period} sf={sf} />
        </div>
      </div>

      {/* ── Per-store deep-dive ─────────────────────────────────────────────── */}
      {tenants.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 10 }}>
            Lojas — {PERIOD_LABELS[period]}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {pd.curr.map((s, i) => (
              <StoreCard
                key={s.tenantId}
                store={s}
                prev={pd.prev.find(p => p.tenantId === s.tenantId)}
                color={STORE_COLORS[i % STORE_COLORS.length]}
                daily={daily[s.tenantId] ?? []}
                sf={sf}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Insights ────────────────────────────────────────────────────────── */}
      <InsightsPanel items={insights} />

      {/* ── Alerts ──────────────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 12,
              background: a.level === 'error' ? '#1a0000' : '#1a1200',
              border: `1px solid ${a.level === 'error' ? '#ef444422' : '#eab30822'}`,
              color: a.level === 'error' ? '#ef4444' : '#eab308',
            }}>
              {a.level === 'error' ? '🔴' : '⚠️'} <strong>{a.store}</strong> — {a.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
