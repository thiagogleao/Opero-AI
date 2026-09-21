import { useEffect, useState } from 'react'
import type { StoreStats, Alert } from '../../../preload'

type Props = { onOpenDashboard: () => void }

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function ptDate(d: Date) {
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function dateRange(daysAgo: number) {
  const to = new Date(); to.setDate(to.getDate() - 1)
  const from = new Date(); from.setDate(from.getDate() - daysAgo)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

export default function Briefing({ onOpenDashboard }: Props) {
  const [loading, setLoading] = useState(true)
  const [yesterday, setYesterday] = useState<StoreStats[]>([])
  const [month, setMonth] = useState<StoreStats[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [dbOk, setDbOk] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const ok = await window.api.testConnection()
        setDbOk(ok)
        if (!ok) { setLoading(false); return }

        const yest = dateRange(1)
        const mo = dateRange(30)

        const [y, m, a] = await Promise.all([
          window.api.getAllStoresStats(yest.to, yest.to),
          window.api.getAllStoresStats(mo.from, mo.to),
          window.api.getAlerts()
        ])

        setYesterday(y)
        setMonth(m)
        setAlerts(a)

        // Mark briefing as seen today
        await window.api.setState({ briefingDate: new Date().toISOString().slice(0, 10) })
      } catch (e) {
        console.error(e)
        setDbOk(false)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalYesterdayProfit = yesterday.reduce((s, x) => s + x.profit, 0)
  const totalMonthProfit = month.reduce((s, x) => s + x.profit, 0)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: '40px 32px', gap: 32, maxWidth: 860, margin: '0 auto'
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>
          {greeting()}, Thiago 👋
        </div>
        <div style={{ color: 'var(--muted)', marginTop: 6, textTransform: 'capitalize' }}>
          {ptDate(new Date())}
        </div>
      </div>

      {!dbOk && (
        <div className="card" style={{ background: '#2a1010', borderColor: 'var(--red)', color: 'var(--red)', textAlign: 'center' }}>
          ⚠ Sem conexão com o banco de dados. Verifique sua internet.
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div className="spin" style={{ width: 32, height: 32 }} />
          <span className="muted">Carregando dados das lojas...</span>
        </div>
      )}

      {!loading && dbOk && (
        <>
          {/* Alerts */}
          {alerts.length > 0 && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map((a, i) => (
                <div key={i} className="card" style={{
                  padding: '12px 16px',
                  background: a.level === 'error' ? '#2a1010' : '#1a1a0a',
                  borderColor: a.level === 'error' ? 'var(--red)' : 'var(--yellow)',
                  color: a.level === 'error' ? 'var(--red)' : 'var(--yellow)',
                  display: 'flex', gap: 10, alignItems: 'center', fontSize: 13
                }}>
                  {a.level === 'error' ? '🔴' : '🟡'} <strong>{a.store}:</strong> {a.message}
                </div>
              ))}
            </div>
          )}

          {/* Summary row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: '100%' }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Lucro Ontem</div>
              <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}
                className={totalYesterdayProfit >= 0 ? 'pos' : 'neg'}>
                {totalYesterdayProfit >= 0 ? '+' : ''}${fmt(totalYesterdayProfit, 2)}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {yesterday.reduce((s, x) => s + x.orders, 0)} pedidos • todas as lojas
              </div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Lucro Últimos 30d</div>
              <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}
                className={totalMonthProfit >= 0 ? 'pos' : 'neg'}>
                {totalMonthProfit >= 0 ? '+' : ''}${fmt(totalMonthProfit, 2)}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {month.reduce((s, x) => s + x.orders, 0)} pedidos • todas as lojas
              </div>
            </div>
          </div>

          {/* Per-store cards */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(yesterday.length, 3)}, 1fr)`, gap: 14, width: '100%' }}>
            {yesterday.map((store, i) => {
              const mo = month.find(m => m.tenantId === store.tenantId)
              return (
                <div key={store.tenantId} className="card" style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{store.displayName}</span>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20,
                      background: store.orders > 0 ? '#0d2a1a' : '#1a0d0d',
                      color: store.orders > 0 ? 'var(--green)' : 'var(--muted)'
                    }}>
                      {store.orders > 0 ? `${store.orders} pedidos` : 'Sem pedidos'}
                    </span>
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 11 }}>Lucro ontem</span>
                    <div style={{ fontSize: 22, fontWeight: 700 }}
                      className={store.profit >= 0 ? 'pos' : 'neg'}>
                      {store.profit >= 0 ? '+' : ''}${fmt(store.profit, 2)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <div>
                      <div className="muted" style={{ fontSize: 11 }}>Receita</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>${fmt(store.revenue, 0)}</div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 11 }}>Mês</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}
                        className={mo && mo.profit >= 0 ? 'pos' : 'neg'}>
                        {mo ? `${mo.profit >= 0 ? '+' : ''}$${fmt(mo.profit, 0)}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 11 }}>Margem</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {store.configured ? `${store.margin.toFixed(1)}%` : 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Action button */}
          <button
            onClick={onOpenDashboard}
            style={{
              padding: '14px 40px', borderRadius: 10,
              background: 'var(--green)', color: '#000',
              fontWeight: 700, fontSize: 15,
              transition: 'opacity 0.15s'
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Ver Dashboard Completo →
          </button>
        </>
      )}
    </div>
  )
}
