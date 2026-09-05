'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Store {
  id: string; name: string; domain: string | null; timezone: string
  revenue: number; profit: number; orders: number; adSpend: number
  margin: number; error: boolean
}
interface LineItem { title?: string; quantity?: number; price?: string }
interface LiveOrder {
  orderId: string; orderNumber: string | null; total: number; currency: string
  country: string | null; items: LineItem[] | null; receivedAt: string; store: string
}
interface Payload {
  period: Period
  totals: { revenue: number; profit: number; orders: number; adSpend: number }
  stores: Store[]
  recentOrders: LiveOrder[]
}
type Period = 'today' | '7d' | '30d'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7d',    label: '7 dias' },
  { key: '30d',   label: '30 dias' },
]

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Compact money for tiles: $1,284 / $12.9K / $4.2M. Sign always explicit. */
function money(v: number, compact = true): string {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (compact && a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`
  if (compact && a >= 10_000)    return `${sign}$${(a / 1_000).toFixed(1)}K`
  return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function moneyExact(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
  } catch { return `${currency} ${v.toFixed(2)}` }
}

function timeAgo(iso: string): string {
  // Postgres returns a naive UTC timestamp; mark it as UTC before diffing.
  const ms = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  const secs = Math.max(0, (Date.now() - ms) / 1000)
  if (secs < 60) return 'agora'
  if (secs < 3600) return `${Math.floor(secs / 60)}min`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('today')
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const firstLoad = useRef(true)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      // Session cookie rides along automatically (same-origin).
      const res = await fetch(`/api/mobile?period=${period}`)
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json()); setErr('')
    } catch {
      setErr('Falha ao carregar')
    } finally {
      setRefreshing(false); firstLoad.current = false
    }
  }, [period])

  useEffect(() => { load() }, [load])

  // Keep the view live without hammering the API: poll while visible only.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = setInterval(tick, 45_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  if (!data && firstLoad.current) {
    return <><Header /><p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Carregando…</p></>
  }

  const t = data?.totals ?? { revenue: 0, profit: 0, orders: 0, adSpend: 0 }
  const roas = t.adSpend > 0 ? t.revenue / t.adSpend : null

  return (
    <>
      <Header />

      {/* Filters sit in one row above the data. */}
      <div role="tablist" aria-label="Período" style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {PERIODS.map(p => {
          const on = p.key === period
          return (
            <button
              key={p.key} role="tab" aria-selected={on} onClick={() => setPeriod(p.key)}
              style={{
                flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13,
                fontWeight: on ? 650 : 450,
                background: on ? 'rgba(16,185,129,0.14)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--ink-3)',
                border: `1px solid ${on ? 'rgba(16,185,129,0.28)' : 'var(--hairline)'}`,
                cursor: 'pointer',
              }}
            >{p.label}</button>
          )
        })}
      </div>

      {err && (
        <p style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 16 }}>
          {err} ·{' '}
          <button onClick={load} style={{ background: 'none', border: 'none', textDecoration: 'underline', padding: 0, cursor: 'pointer' }}>
            tentar de novo
          </button>
        </p>
      )}

      {/* Hero figure — exactly one per view. */}
      <section style={{ marginBottom: 22 }}>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 2px', letterSpacing: '0.02em' }}>Lucro líquido</p>
        <p style={{
          fontSize: 52, lineHeight: 1.05, fontWeight: 680, margin: 0, letterSpacing: '-0.035em',
          color: t.profit < 0 ? 'var(--bad)' : 'var(--ink)',
        }}>{money(t.profit)}</p>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '6px 0 0' }}>
          {t.orders} {t.orders === 1 ? 'pedido' : 'pedidos'}
          {roas !== null && <> · ROAS {roas.toFixed(2)}×</>}
          {refreshing && <> · atualizando…</>}
        </p>
      </section>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 26 }}>
        <Tile label="Receita"  value={money(t.revenue)} />
        <Tile label="Anúncios" value={money(t.adSpend)} />
        <Tile label="Margem"   value={t.revenue > 0 ? `${((t.profit / t.revenue) * 100).toFixed(0)}%` : '—'} />
      </div>

      <StoreBars stores={data?.stores ?? []} />
      <SalesFeed orders={data?.recentOrders ?? []} />
    </>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
      <Logo size={26} />
      <span style={{ fontSize: 17, fontWeight: 680, letterSpacing: '-0.03em' }}>opero</span>
      <div style={{ flex: 1 }} />
      <NotificationToggle />
    </header>
  )
}

function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M12 33 C14 26 28 14 37 16 L37 34 L12 34 Z" fill="rgba(16,185,129,0.12)" />
      <circle cx="24" cy="24" r="19" stroke="#10b981" strokeWidth="2.6" fill="none" />
      <path d="M12 33 C14 26 28 14 37 16" stroke="#10b981" strokeWidth="2.3" strokeLinecap="round" fill="none" />
      <circle cx="37" cy="16" r="2.8" fill="#10b981" />
    </svg>
  )
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--hairline)',
      borderRadius: 12, padding: '11px 12px',
    }}>
      <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 19, fontWeight: 640, margin: 0, letterSpacing: '-0.02em' }}>{value}</p>
    </div>
  )
}

// ─── Per-store comparison ─────────────────────────────────────────────────────

/**
 * Ranked horizontal bars, one measure (profit), so a single hue carries it and
 * the sign picks good/bad. Every bar is directly labeled with its store and
 * value — that is the secondary encoding the red/green pair requires, and with
 * a handful of stores it is a ranked list, not a flooded chart.
 */
function StoreBars({ stores }: { stores: Store[] }) {
  if (stores.length === 0) return null
  const sorted = [...stores].sort((a, b) => b.profit - a.profit)

  const maxPos = Math.max(0, ...sorted.map(s => s.profit))
  const maxNeg = Math.min(0, ...sorted.map(s => s.profit))
  const span = maxPos + Math.abs(maxNeg)
  const zeroPct = span === 0 ? 0 : (Math.abs(maxNeg) / span) * 100

  return (
    <section style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: 13, fontWeight: 620, color: 'var(--ink-2)', margin: '0 0 12px' }}>
        Lucro por loja
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sorted.map(s => {
          const pct = span === 0 ? 0 : (Math.abs(s.profit) / span) * 100
          const neg = s.profit < 0
          return (
            <div key={s.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                <span style={{
                  fontSize: 13, fontWeight: 520, color: 'var(--ink)', flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.name}
                </span>
                <span style={{ fontSize: 13, fontWeight: 640, color: neg ? 'var(--bad)' : 'var(--ink)' }}>
                  {money(s.profit)}
                </span>
                <span style={{
                  fontSize: 11, color: 'var(--ink-3)', width: 54, textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {s.orders} ped.
                </span>
              </div>

              {/* Track carries the zero baseline; the bar grows from it. */}
              <div style={{ position: 'relative', height: 10, background: 'rgba(255,255,255,0.045)', borderRadius: 3 }}>
                <div
                  style={{
                    position: 'absolute', top: 0, height: '100%',
                    width: `${pct}%`,
                    ...(neg
                      ? { right: `${100 - zeroPct}%`, background: 'var(--bad)', borderRadius: '4px 0 0 4px' }
                      : { left: `${zeroPct}%`,        background: 'var(--good)', borderRadius: '0 4px 4px 0' }),
                  }}
                />
                {zeroPct > 0 && (
                  <div style={{
                    position: 'absolute', left: `${zeroPct}%`, top: -2, bottom: -2,
                    width: 1, background: 'rgba(255,255,255,0.22)',
                  }} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Live sales feed ──────────────────────────────────────────────────────────

function SalesFeed({ orders }: { orders: LiveOrder[] }) {
  return (
    <section>
      <h2 style={{ fontSize: 13, fontWeight: 620, color: 'var(--ink-2)', margin: '0 0 12px' }}>
        Vendas ao vivo
      </h2>

      {orders.length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: 0, lineHeight: 1.6 }}>
          Nenhuma venda registrada ainda. Assim que o webhook da Shopify estiver
          ativo, cada pedido aparece aqui em segundos.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {orders.map(o => {
            const items = Array.isArray(o.items) ? o.items : []
            const units = items.reduce((s, i) => s + Number(i.quantity ?? 0), 0)
            const first = items[0]?.title ?? 'Pedido'
            return (
              <li key={`${o.store}-${o.orderId}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '1px solid var(--hairline)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: 13.5, fontWeight: 560, margin: 0, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {units > 1 ? `${units}× ` : ''}{first}
                    {items.length > 1 && <span style={{ color: 'var(--ink-3)' }}> +{items.length - 1}</span>}
                  </p>
                  <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '2px 0 0' }}>
                    {o.store}{o.country ? ` · ${o.country}` : ''} · {timeAgo(o.receivedAt)}
                  </p>
                </div>
                <span style={{
                  fontSize: 14, fontWeight: 640, color: 'var(--good)',
                  fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                }}>
                  {moneyExact(o.total, o.currency)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ─── Notification toggle ──────────────────────────────────────────────────────

type NotifState = 'unsupported' | 'default' | 'granted' | 'denied' | 'working'

function NotificationToggle() {
  const [state, setState] = useState<NotifState>('default')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported'); return
    }
    setState(Notification.permission as NotifState)
  }, [])

  async function enable() {
    setState('working')
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setState(permission as NotifState); return }

      const meta = await fetch('/api/push/subscribe').then(r => r.json())
      if (!meta.vapidPublicKey) {
        alert('VAPID_PUBLIC_KEY não configurada no servidor.')
        setState('default'); return
      }

      // Reuse an existing subscription when present; keys can't change per origin.
      const sub = await reg.pushManager.getSubscription()
        ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(meta.vapidPublicKey) as BufferSource,
        })

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      await fetch('/api/push/test', { method: 'POST' })
      setState('granted')
    } catch (err) {
      console.error(err)
      alert('Não foi possível ativar: ' + (err as Error).message)
      setState('default')
    }
  }

  if (state === 'unsupported') return null

  const on = state === 'granted'
  return (
    <button
      onClick={on ? undefined : enable}
      disabled={on || state === 'working' || state === 'denied'}
      aria-label={on ? 'Notificações ativas' : 'Ativar notificações'}
      title={state === 'denied' ? 'Permissão negada nas configurações do navegador' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: on ? 'rgba(5,150,105,0.16)' : 'transparent',
        border: `1px solid ${on ? 'rgba(5,150,105,0.35)' : 'var(--hairline)'}`,
        borderRadius: 8, padding: '6px 9px', fontSize: 11.5,
        color: on ? 'var(--accent)' : 'var(--ink-3)',
        cursor: on ? 'default' : 'pointer',
      }}
    >
      <span aria-hidden="true">{on ? '🔔' : '🔕'}</span>
      {state === 'working' ? 'Ativando…' : on ? 'Ativas' : state === 'denied' ? 'Bloqueada' : 'Ativar'}
    </button>
  )
}
