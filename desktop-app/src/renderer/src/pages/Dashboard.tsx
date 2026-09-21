import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend
} from 'recharts'
import type { StoreStats, Tenant, DailyPoint } from '../../../preload'

type Period = '7d' | '30d' | '90d' | 'all'

// Module-level cache survives tab switches (component unmount/remount)
const DASH_CACHE_MS = 5 * 60 * 1000
const _dashCache = new Map<Period, {
  tenants: Tenant[]; stats: StoreStats[]
  dailyByTenant: Record<string, DailyPoint[]>; ts: number
}>()

const STORE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4']

function fmt(n: number, dec = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtY(v: number) {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`
  return `$${v.toFixed(0)}`
}

function dateRange(period: Period): { from: string; to: string } {
  const to = new Date()
  to.setDate(to.getDate() - 1)
  const from = new Date()
  if (period === '7d') from.setDate(from.getDate() - 7)
  else if (period === '30d') from.setDate(from.getDate() - 30)
  else if (period === '90d') from.setDate(from.getDate() - 90)
  else from.setFullYear(from.getFullYear() - 2)
  const d = (x: Date) => x.toISOString().slice(0, 10)
  return { from: d(from), to: d(to) }
}

function periodDays(p: Period) { return p === '7d' ? 7 : p === '30d' ? 30 : p === '90d' ? 90 : 730 }

function KPI({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 140 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: color ?? 'var(--text)' }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function AllStoresChart({ tenants, dailyByTenant, period }: {
  tenants: Tenant[]
  dailyByTenant: Record<string, DailyPoint[]>
  period: Period
}) {
  const data = useMemo(() => {
    const dateSet = new Set<string>()
    Object.values(dailyByTenant).forEach(pts => pts.forEach(p => dateSet.add(p.date)))
    const dates = Array.from(dateSet).sort()
    return dates.map(date => {
      const row: Record<string, any> = { date: date.slice(5) }
      let total = 0
      tenants.forEach(t => {
        const pt = dailyByTenant[t.id]?.find(p => p.date === date)
        const v = pt?.profit ?? 0
        row[t.display_name] = v
        total += v
      })
      row['Total'] = total
      return row
    })
  }, [tenants, dailyByTenant])

  if (!data.length) return null

  return (
    <div className="card" style={{ padding: '20px 20px 10px' }}>
      <div style={{ fontWeight: 600, marginBottom: 16 }}>
        Lucro Diário — {period === 'all' ? 'Histórico' : `Últimos ${period}`}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ left: 10, right: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtY} />
          <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{ background: '#141417', border: '1px solid #222228', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#666' }}
            formatter={(v: number, name: string) => [`$${fmt(v, 2)}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
          {tenants.map((t, i) => (
            <Line
              key={t.id}
              type="monotone"
              dataKey={t.display_name}
              stroke={STORE_COLORS[i % STORE_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
          {tenants.length > 1 && (
            <Line
              type="monotone"
              dataKey="Total"
              stroke="#ffffff"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 3 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function StoreChart({ daily, period, color = '#22c55e' }: {
  daily: DailyPoint[]
  period: Period
  color?: string
}) {
  const data = daily.map(d => ({ date: d.date.slice(5), Lucro: d.profit }))
  if (!data.length) return null

  const gradId = `gProfit_${color.replace('#', '')}`

  return (
    <div className="card" style={{ padding: '20px 20px 10px' }}>
      <div style={{ fontWeight: 600, marginBottom: 16 }}>
        Lucro Diário — {period === 'all' ? 'Histórico' : `Últimos ${period}`}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ left: 10, right: 10 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtY} />
          <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{ background: '#141417', border: '1px solid #222228', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#666' }}
            formatter={(v: number) => [`$${fmt(v, 2)}`, 'Lucro']}
          />
          <Area type="monotone" dataKey="Lucro" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('30d')

  const getCached = (p: Period) => {
    const c = _dashCache.get(p)
    return c && Date.now() - c.ts < DASH_CACHE_MS ? c : null
  }

  const initCache = getCached('30d')

  const [tenants, setTenants]               = useState<Tenant[]>(initCache?.tenants ?? [])
  const [activeTenant, setActiveTenant]     = useState<string>('__all__')
  const [stats, setStats]                   = useState<StoreStats[]>(initCache?.stats ?? [])
  const [dailyByTenant, setDailyByTenant]   = useState<Record<string, DailyPoint[]>>(initCache?.dailyByTenant ?? {})
  const [loading, setLoading]               = useState(!initCache)
  const [refreshing, setRefreshing]         = useState(false)
  const [lastUpdated, setLastUpdated]       = useState<string | null>(initCache ? new Date(initCache.ts).toLocaleTimeString('pt-BR') : null)

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) {
      const c = getCached(period)
      if (c) {
        setTenants(c.tenants); setStats(c.stats); setDailyByTenant(c.dailyByTenant)
        setLastUpdated(new Date(c.ts).toLocaleTimeString('pt-BR'))
        setLoading(false)
        return
      }
    }

    if (isRefresh) { setRefreshing(true); _dashCache.clear(); await window.api.refreshCache() }
    else setLoading(true)
    try {
      const ts = await window.api.getTenants()
      setTenants(ts)

      const { from, to } = dateRange(period)
      const days = periodDays(period)

      const [allStats, ...allDaily] = await Promise.all([
        window.api.getAllStoresStats(from, to),
        ...ts.map(t => window.api.getDailyData(t.id, days))
      ])

      const byTenant: Record<string, DailyPoint[]> = {}
      ts.forEach((t, i) => { byTenant[t.id] = allDaily[i] as DailyPoint[] })

      setStats(allStats as StoreStats[])
      setDailyByTenant(byTenant)

      _dashCache.set(period, { tenants: ts, stats: allStats as StoreStats[], dailyByTenant: byTenant, ts: Date.now() })
      setLastUpdated(new Date().toLocaleTimeString('pt-BR'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const displayed = activeTenant === '__all__' ? stats : stats.filter(s => s.tenantId === activeTenant)
  const activeStore = tenants.find(t => t.id === activeTenant)
  const activeStoreIndex = tenants.findIndex(t => t.id === activeTenant)

  const totals = displayed.reduce(
    (acc, s) => ({
      revenue: acc.revenue + s.revenue,
      profit: acc.profit + s.profit,
      orders: acc.orders + s.orders,
      fbSpend: acc.fbSpend + s.fbSpend,
      cogs: acc.cogs + s.cogs,
      fees: acc.fees + s.fees
    }),
    { revenue: 0, profit: 0, orders: 0, fbSpend: 0, cogs: 0, fees: 0 }
  )
  const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  const roas = totals.fbSpend > 0 ? totals.revenue / totals.fbSpend : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        padding: '0 20px', height: 50, display: 'flex', alignItems: 'center',
        gap: 16, borderBottom: '1px solid var(--border)', background: 'var(--bg)',
        WebkitAppRegion: 'drag' as never, flexShrink: 0
      }}>
        <div style={{ flex: 1 }} />

        {/* Store selector */}
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' as never }}>
          <TabBtn active={activeTenant === '__all__'} onClick={() => setActiveTenant('__all__')}>Todas</TabBtn>
          {tenants.map((t, i) => (
            <TabBtn
              key={t.id}
              active={activeTenant === t.id}
              onClick={() => setActiveTenant(t.id)}
              color={STORE_COLORS[i % STORE_COLORS.length]}
            >
              {t.display_name}
            </TabBtn>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {/* Period selector */}
        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' as never }}>
          {(['7d', '30d', '90d', 'all'] as Period[]).map(p => (
            <TabBtn key={p} active={period === p} onClick={() => setPeriod(p)}>
              {p === 'all' ? 'Tudo' : p}
            </TabBtn>
          ))}
        </div>

        <button
          onClick={() => load(true)}
          style={{ padding: '4px 12px', borderRadius: 6, background: 'var(--surface2)', color: 'var(--muted)', fontSize: 12, WebkitAppRegion: 'no-drag' as never }}
        >
          {refreshing ? '⟳ Atualizando...' : '⟳ Atualizar'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60%', gap: 12, flexDirection: 'column' }}>
            <div className="spin" style={{ width: 36, height: 36 }} />
            <span className="muted">Carregando dados...</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* KPI row */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <KPI label="Lucro Líquido" value={`$${fmt(totals.profit, 2)}`}
                color={totals.profit >= 0 ? 'var(--green)' : 'var(--red)'}
                sub={`${totalMargin.toFixed(1)}% margem`} />
              <KPI label="Receita" value={`$${fmt(totals.revenue, 0)}`}
                sub={`${totals.orders} pedidos`} />
              <KPI label="FB Ads" value={`$${fmt(totals.fbSpend, 0)}`}
                sub={`ROAS ${roas.toFixed(2)}x`} />
              <KPI label="COGS" value={`$${fmt(totals.cogs, 0)}`}
                sub={totals.orders > 0 ? `$${fmt(totals.cogs / totals.orders, 2)}/pedido` : undefined} />
              <KPI label="Taxas Shopify" value={`$${fmt(totals.fees, 0)}`} />
            </div>

            {/* Store cards */}
            {displayed.length > 1 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${displayed.length}, 1fr)`, gap: 14 }}>
                {displayed.map((s, i) => (
                  <StoreCard key={s.tenantId} stats={s} color={STORE_COLORS[i % STORE_COLORS.length]} />
                ))}
              </div>
            )}
            {displayed.length === 1 && (
              <StoreCard stats={displayed[0]} expanded color={STORE_COLORS[activeStoreIndex >= 0 ? activeStoreIndex % STORE_COLORS.length : 0]} />
            )}

            {/* Chart */}
            {activeTenant === '__all__' ? (
              <AllStoresChart tenants={tenants} dailyByTenant={dailyByTenant} period={period} />
            ) : (
              <StoreChart
                daily={dailyByTenant[activeTenant] ?? []}
                period={period}
                color={STORE_COLORS[activeStoreIndex >= 0 ? activeStoreIndex % STORE_COLORS.length : 0]}
              />
            )}

            {lastUpdated && (
              <div className="muted" style={{ fontSize: 11, textAlign: 'right', marginTop: -8 }}>
                Última atualização: {lastUpdated}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TabBtn({ children, active, onClick, color }: { children: React.ReactNode; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: active ? 600 : 400,
        background: active ? 'var(--surface2)' : 'transparent',
        color: active ? (color ?? 'var(--text)') : 'var(--muted)',
        border: active ? `1px solid ${color ?? 'var(--border)'}` : '1px solid transparent',
        transition: 'all 0.1s'
      }}
    >
      {children}
    </button>
  )
}

function StoreCard({ stats: s, expanded, color = '#22c55e' }: { stats: StoreStats; expanded?: boolean; color?: string }) {
  return (
    <div className="card" style={{ borderColor: `${color}22` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontWeight: 600, fontSize: 15, color }}>{s.displayName}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.domain}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: expanded ? 'repeat(5,1fr)' : '1fr 1fr', gap: 12 }}>
        <Metric label="Lucro" value={`${s.profit >= 0 ? '+' : ''}$${fmt(s.profit, 2)}`} color={s.profit >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Metric label="Receita" value={`$${fmt(s.revenue, 0)}`} />
        <Metric label="Pedidos" value={String(s.orders)} />
        <Metric label="FB Ads" value={`$${fmt(s.fbSpend, 0)}`} />
        <Metric label="Margem" value={s.configured ? `${s.margin.toFixed(1)}%` : 'N/C'} />
      </div>
      {!s.configured && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--yellow)', background: '#1a1400', padding: '6px 10px', borderRadius: 6 }}>
          ⚠ Configure os custos no Opero AI para ver lucro real
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  )
}
