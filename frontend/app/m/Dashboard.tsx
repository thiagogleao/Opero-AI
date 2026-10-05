'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Chart, { type Series } from './Chart'
import { unlockAudio, playChaChing } from './sound'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'mtd' | 'lastmonth' | 'custom'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today',     label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d',        label: '7 dias' },
  { key: '30d',       label: '30 dias' },
  { key: 'mtd',       label: 'Este mês' },
  { key: 'lastmonth', label: 'Mês passado' },
  { key: '90d',       label: '90 dias' },
  { key: 'custom',    label: 'Escolher' },
]

interface Store {
  id: string; name: string; domain: string | null; timezone: string
  revenue: number; profit: number; orders: number; adSpend: number
  margin: number; cogs: number; shipping: number; fees: number; aov: number; error: boolean
}
interface DailyPoint { date: string; revenue: number; profit: number; fbSpend: number; margin: number | null }
interface IntradayPoint {
  hour: number; label: string; revenue: number; orders: number
  cumRevenue: number; cumProfit: number
}
interface Intraday {
  day: string; points: IntradayPoint[]
  peak: { hour: number; profit: number } | null
  closing: number; configured: boolean
}
interface LineItem { title?: string; quantity?: number; price?: string }
interface LiveOrder {
  orderId: string; orderNumber: string | null; total: number; currency: string
  country: string | null; items: LineItem[] | null; receivedAt: string; store: string
}
interface Totals { revenue: number; profit: number; orders: number; adSpend: number; cogs: number; shipping: number; fees: number }
interface Previous {
  revenue: number; profit: number; orders: number; adSpend: number
  from: string; to: string
  /** Set when the older window was cut at this hour to match a day in progress. */
  throughHour: number | null
}
interface Adjustments {
  refundHit: number; refundGross: number; refundCount: number
  chargebackHit: number; chargebackFees: number; chargebackCount: number
  total: number; alreadyCounted: number; blindToChargebacks: boolean
}
interface Payload {
  period: Period; from: string; to: string; storeId: string
  adjustments?: Adjustments
  totals: Totals
  previous?: Previous
  stores: Store[]
  daily: DailyPoint[]
  intraday?: Intraday | null
  allStores: { id: string; name: string }[]
  lastSyncAt: string | null
  recentOrders: LiveOrder[]
}

type Tab = 'creatives' | 'products' | 'countries' | 'customers'
type Signal = 'kill' | 'scale' | 'refresh' | 'ok'
interface Creative {
  adId: string; name: string; thumbnail: string | null
  spend: number; roas: number; ctr: number; frequency: number
  purchases: number; revenue: number
  hookRate: number | null; holdRate100: number | null; isVideo: boolean
  breakEven: number; signal: Signal
}
interface Product { title: string; units: number; orders: number; revenue: number; aov: number }
interface Country { country_code: string; revenue: number; orders: number; fbSpend: number; netProfit: number; margin: number; roas: number | null }
interface Customers { newCustomers: number; returningCustomers: number; newRevenue: number; returningRevenue: number }

// Data-mark colors, validated against the #0a0f0d surface.
const C_REVENUE = '#3987e5'
const C_PROFIT  = '#059669'
const C_LOSS    = '#d03b3b'

// ─── Formatting ───────────────────────────────────────────────────────────────

function money(v: number, compact = true): string {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (compact && a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`
  if (compact && a >= 10_000)    return `${sign}$${(a / 1_000).toFixed(1)}K`
  return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function moneyExact(v: number, currency: string): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v) }
  catch { return `${currency} ${v.toFixed(2)}` }
}
/** Percentage change, or null when there is no baseline to divide by. */
function pctDelta(now: number, before: number): number | null {
  if (!before) return null
  return ((now - before) / Math.abs(before)) * 100
}
function timeAgo(iso: string): string {
  const ms = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}
const flag = (cc: string) => /^[A-Z]{2}$/.test(cc)
  ? String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
  : '🌐'

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('today')
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [store, setStore] = useState('all')
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [sound, setSound] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const first = useRef(true)
  // Order ids already seen, so the chime fires once per genuinely new sale
  // rather than on every poll that returns the same feed.
  const seen = useRef<Set<string> | null>(null)
  // Set when the service worker already chimed for this sale, so the refresh it
  // triggers does not chime a second time for the same order.
  const chimed = useRef(false)

  const qs = useCallback(() => {
    const p = new URLSearchParams({ period, store })
    if (period === 'custom' && custom.from && custom.to) {
      p.set('from', custom.from); p.set('to', custom.to)
    }
    return p.toString()
  }, [period, store, custom])

  const load = useCallback(async () => {
    if (period === 'custom' && (!custom.from || !custom.to)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/mobile?${qs()}`)
      if (!res.ok) throw new Error(String(res.status))
      const payload: Payload = await res.json()

      const ids = new Set(payload.recentOrders.map(o => `${o.store}|${o.orderId}`))
      // The first response seeds the baseline — otherwise opening the app would
      // chime for every sale already in the feed.
      if (seen.current) {
        const fresh = [...ids].filter(id => !seen.current!.has(id)).length
        if (fresh > 0 && !chimed.current) playChaChing()
      }
      chimed.current = false
      seen.current = ids

      setData(payload); setErr('')
    } catch { setErr('Falha ao carregar') }
    finally { setBusy(false); first.current = false }
  }, [qs, period, custom])

  useEffect(() => { load() }, [load])

  // Restore the sound preference. iOS starts every AudioContext suspended and
  // only a gesture can resume it, so when sound is already on we arm a one-shot
  // listener and unlock on whatever the user touches first.
  useEffect(() => {
    let on = false
    try { on = localStorage.getItem('opero_sound') === '1' } catch { /* private mode */ }
    if (!on) return
    setSound(true)
    const arm = () => { unlockAudio(); window.removeEventListener('pointerdown', arm) }
    window.addEventListener('pointerdown', arm, { once: true })
    return () => window.removeEventListener('pointerdown', arm)
  }, [])

  function toggleSound() {
    const next = !sound
    setSound(next)
    try { localStorage.setItem('opero_sound', next ? '1' : '0') } catch { /* private mode */ }
    if (next && unlockAudio()) {
      // Confirm audibly, and prove the context really resumed.
      setTimeout(playChaChing, 60)
    }
  }

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = setInterval(tick, 45_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  // The service worker relays the push the moment it arrives, so an open app
  // chimes together with the notification instead of on the next poll.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'sale') return
      chimed.current = true
      playChaChing()
      load()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [load])

  /** Force a sync, then poll a few times while the collectors catch up. */
  async function refresh() {
    setSyncing(true)
    try {
      await fetch('/api/mobile/refresh', { method: 'POST' })
      for (const wait of [8000, 12000, 20000, 30000]) {
        await new Promise(r => setTimeout(r, wait))
        await load()
      }
    } catch { /* the periodic poll will catch up anyway */ }
    finally { setSyncing(false) }
  }

  if (!data && first.current) {
    return <><Header syncing={false} onRefresh={() => {}} lastSyncAt={null} sound={sound} onSound={toggleSound} onAlerts={() => setAlertsOpen(true)} /><p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Carregando…</p></>
  }

  const t = data?.totals ?? { revenue: 0, profit: 0, orders: 0, adSpend: 0, cogs: 0, shipping: 0, fees: 0 }
  const daily = data?.daily ?? []
  const roas = t.adSpend > 0 ? t.revenue / t.adSpend : null
  const aov = t.orders > 0 ? t.revenue / t.orders : 0
  const multiDay = daily.length > 1
  const prev = data?.previous
  const adj = data?.adjustments
  const profitDelta = prev ? pctDelta(t.profit, prev.profit) : null
  // When today is only half over, the comparison window was cut at the same
  // hour — say so, otherwise the number looks like a full-day comparison.
  const upTo = prev?.throughHour != null ? ` até ${String(prev.throughHour).padStart(2, '0')}h` : ''
  const periodLabel = period === 'today' ? `vs ontem${upTo}`
    : period === 'yesterday' ? 'vs anteontem'
    : `vs período anterior${upTo}`

  return (
    <>
      <Header
        syncing={syncing} onRefresh={refresh} lastSyncAt={data?.lastSyncAt ?? null}
        sound={sound} onSound={toggleSound} onAlerts={() => setAlertsOpen(true)}
      />

      {alertsOpen && <AlertsSheet onClose={() => setAlertsOpen(false)} />}

      <StoreChips
        stores={data?.allStores ?? []} value={store} onChange={setStore}
      />

      <PeriodPicker
        period={period} onPeriod={setPeriod}
        custom={custom} onCustom={setCustom}
        range={data ? { from: data.from, to: data.to } : null}
      />

      {err && (
        <p style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 14 }}>
          {err} · <button onClick={load} style={{ background: 'none', border: 'none', textDecoration: 'underline', padding: 0, cursor: 'pointer' }}>tentar de novo</button>
        </p>
      )}

      {/* Hero figure — exactly one per view. */}
      <section style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 2px' }}>Lucro líquido</p>
        <p style={{
          fontSize: 50, lineHeight: 1.05, fontWeight: 680, margin: 0, letterSpacing: '-0.035em',
          color: t.profit < 0 ? 'var(--bad)' : 'var(--ink)',
        }}>{money(t.profit)}</p>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '6px 0 0' }}>
          {t.orders} {t.orders === 1 ? 'pedido' : 'pedidos'}
          {roas !== null && <> · ROAS {roas.toFixed(2)}×</>}
          {(busy || syncing) && <> · {syncing ? 'sincronizando…' : 'atualizando…'}</>}
        </p>
        {profitDelta != null && (
          <p style={{ margin: '4px 0 0' }}>
            <Delta pct={profitDelta} suffix={periodLabel} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}> · antes {money(prev!.profit)}</span>
          </p>
        )}
      </section>

      {adj && adj.total > 0 && (
        <section style={{
          border: '1px solid var(--hairline)', borderRadius: 11,
          padding: '10px 12px', marginBottom: 18,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>Ajustes que chegaram</span>
            <span style={{ fontSize: 15, fontWeight: 640, color: 'var(--bad)' }}>−{money(adj.total)}</span>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '3px 0 0' }}>
            {adj.refundCount > 0 && `${adj.refundCount} estorno${adj.refundCount === 1 ? '' : 's'}`}
            {adj.refundCount > 0 && adj.chargebackCount > 0 && ' · '}
            {adj.chargebackCount > 0 && `${adj.chargebackCount} chargeback${adj.chargebackCount === 1 ? '' : 's'} (+${money(adj.chargebackFees)} taxas)`}
            {' · de pedidos de outros dias também'}
          </p>
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginTop: 7,
            paddingTop: 7, borderTop: '1px solid var(--hairline)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--ink-3)' }}>Resultado de caixa</span>
            <span style={{ fontWeight: 640, color: t.profit - adj.total >= 0 ? 'var(--ink)' : 'var(--bad)' }}>
              {money(t.profit - adj.total)}
            </span>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7, marginBottom: 22 }}>
        <Tile label="Receita"  value={money(t.revenue)} delta={prev ? pctDelta(t.revenue, prev.revenue) : null} />
        <Tile label="Anúncios" value={money(t.adSpend)} delta={prev ? pctDelta(t.adSpend, prev.adSpend) : null} neutral />
        <Tile label="Margem"   value={t.revenue > 0 ? `${((t.profit / t.revenue) * 100).toFixed(0)}%` : '—'} />
        <Tile label="Ticket"   value={aov > 0 ? money(aov) : '—'} />
      </div>

      {!multiDay && data?.intraday && <IntradayChart data={data.intraday} />}

      {multiDay && (
        <>
          <Section title="Receita e lucro por dia">
            <Chart
              labels={daily.map(d => d.date)}
              format={v => money(v)}
              zeroLine
              series={[
                { key: 'rev', label: 'Receita', color: C_REVENUE, area: true, values: daily.map(d => d.revenue) },
                { key: 'pro', label: 'Lucro',   color: C_PROFIT,               values: daily.map(d => d.profit) },
              ] as Series[]}
            />
          </Section>

          {/* Margin is a percentage: it never shares an axis with the money
              series, so it gets its own chart rather than a second y-scale. */}
          <Section title="Margem por dia">
            <Chart
              labels={daily.map(d => d.date)}
              height={100}
              format={v => `${v.toFixed(0)}%`}
              zeroLine
              series={[
                { key: 'mar', label: 'Margem', color: C_PROFIT, values: daily.map(d => d.margin) },
              ] as Series[]}
            />
          </Section>
        </>
      )}

      <CostBreakdown totals={t} />

      {store === 'all' && <StoreBars stores={data?.stores ?? []} />}

      <DetailTabs qs={qs()} />

      <SalesFeed orders={data?.recentOrders ?? []} />
    </>
  )
}

// ─── Chrome ───────────────────────────────────────────────────────────────────

function Header({ syncing, onRefresh, lastSyncAt, sound, onSound, onAlerts }: {
  syncing: boolean; onRefresh: () => void; lastSyncAt: string | null
  sound: boolean; onSound: () => void; onAlerts: () => void
}) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
      <Logo size={24} />
      <span style={{ fontSize: 16, fontWeight: 680, letterSpacing: '-0.03em' }}>opero</span>
      {lastSyncAt && (
        <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>· {timeAgo(lastSyncAt)}</span>
      )}
      <div style={{ flex: 1 }} />
      <button
        onClick={onAlerts}
        aria-label="Configurar alertas"
        title="Alertas e resumo do dia"
        style={{
          background: 'transparent', border: '1px solid var(--hairline)',
          borderRadius: 8, padding: '6px 8px', fontSize: 13, lineHeight: 1, cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">⚙️</span>
      </button>
      <button
        onClick={onSound}
        aria-label={sound ? 'Desligar som de venda' : 'Ligar som de venda'}
        aria-pressed={sound}
        title="Toca um cha-ching quando entra venda com o app aberto"
        style={{
          background: sound ? 'rgba(16,185,129,0.14)' : 'transparent',
          border: `1px solid ${sound ? 'rgba(16,185,129,0.3)' : 'var(--hairline)'}`,
          borderRadius: 8, padding: '6px 8px', fontSize: 13,
          lineHeight: 1, cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">{sound ? '🔊' : '🔇'}</span>
      </button>
      <button
        onClick={onRefresh} disabled={syncing} aria-label="Atualizar dados"
        style={{
          display: 'flex', alignItems: 'center', gap: 5, background: 'transparent',
          border: '1px solid var(--hairline)', borderRadius: 8, padding: '6px 9px',
          fontSize: 11.5, color: syncing ? 'var(--accent)' : 'var(--ink-3)',
          cursor: syncing ? 'wait' : 'pointer',
        }}
      >
        <span aria-hidden="true" style={{
          display: 'inline-block',
          animation: syncing ? 'opspin 1s linear infinite' : undefined,
        }}>↻</span>
        {syncing ? 'Sincronizando' : 'Atualizar'}
      </button>
      <NotificationToggle />
      <style>{`@keyframes opspin{to{transform:rotate(360deg)}}`}</style>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 12.5, fontWeight: 620, color: 'var(--ink-2)', margin: '0 0 8px' }}>{title}</h2>
      {children}
    </section>
  )
}

function Tile({ label, value, delta, neutral }: {
  label: string; value: string; delta?: number | null; neutral?: boolean
}) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--hairline)', borderRadius: 11, padding: '9px 9px' }}>
      <p style={{ fontSize: 10, color: 'var(--ink-3)', margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 16, fontWeight: 640, margin: 0, letterSpacing: '-0.02em' }}>{value}</p>
      {delta != null && <Delta pct={delta} neutral={neutral} size={10} />}
    </div>
  )
}

/**
 * Change against the previous window of the same length.
 *
 * Ad spend is shown without a verdict colour: spending more is only bad if the
 * return did not follow, and that judgement belongs to profit, not to this row.
 */
function Delta({ pct, neutral, size = 11.5, suffix }: {
  pct: number; neutral?: boolean; size?: number; suffix?: string
}) {
  const up = pct >= 0
  const color = neutral ? 'var(--ink-3)' : up ? 'var(--good)' : 'var(--bad)'
  // A jump from near-zero is arithmetically true and practically meaningless.
  const shown = Math.abs(pct) >= 999 ? '999+' : Math.abs(pct).toFixed(0)
  return (
    <span style={{ fontSize: size, color, margin: 0, display: 'inline-block', marginTop: 2 }}>
      {up ? '↑' : '↓'} {shown}%{suffix ? ` ${suffix}` : ''}
    </span>
  )
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function StoreChips({ stores, value, onChange }: {
  stores: { id: string; name: string }[]; value: string; onChange: (v: string) => void
}) {
  if (stores.length < 2) return null
  const opts = [{ id: 'all', name: 'Todas' }, ...stores]
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
      {opts.map(o => {
        const on = o.id === value
        return (
          <button
            key={o.id} onClick={() => onChange(o.id)}
            style={{
              flexShrink: 0, padding: '6px 11px', borderRadius: 999, fontSize: 12,
              fontWeight: on ? 640 : 450, whiteSpace: 'nowrap',
              background: on ? 'rgba(16,185,129,0.14)' : 'transparent',
              color: on ? 'var(--accent)' : 'var(--ink-3)',
              border: `1px solid ${on ? 'rgba(16,185,129,0.3)' : 'var(--hairline)'}`,
              cursor: 'pointer',
            }}
          >{o.name}</button>
        )
      })}
    </div>
  )
}

function PeriodPicker({ period, onPeriod, custom, onCustom, range }: {
  period: Period; onPeriod: (p: Period) => void
  custom: { from: string; to: string }; onCustom: (c: { from: string; to: string }) => void
  range: { from: string; to: string } | null
}) {
  const br = (d: string) => d ? d.split('-').reverse().join('/') : ''
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 8 }}>
        {PERIODS.map(p => {
          const on = p.key === period
          return (
            <button
              key={p.key} onClick={() => onPeriod(p.key)}
              style={{
                flexShrink: 0, padding: '7px 11px', borderRadius: 8, fontSize: 12,
                fontWeight: on ? 640 : 450, whiteSpace: 'nowrap',
                background: on ? 'rgba(16,185,129,0.14)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--ink-3)',
                border: `1px solid ${on ? 'rgba(16,185,129,0.28)' : 'var(--hairline)'}`,
                cursor: 'pointer',
              }}
            >{p.label}</button>
          )
        })}
      </div>

      {period === 'custom' ? (
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8 }}>
          <input
            type="date" value={custom.from} max={custom.to || undefined}
            onChange={e => onCustom({ ...custom, from: e.target.value })}
            style={dateInput}
          />
          <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>até</span>
          <input
            type="date" value={custom.to} min={custom.from || undefined}
            onChange={e => onCustom({ ...custom, to: e.target.value })}
            style={dateInput}
          />
        </div>
      ) : range && (
        <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '2px 0 0' }}>
          {br(range.from)}{range.from !== range.to && ` – ${br(range.to)}`}
        </p>
      )}
    </div>
  )
}

const dateInput: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'var(--card)', border: '1px solid var(--hairline)',
  borderRadius: 9, padding: '9px 10px', fontSize: 13, color: 'var(--ink)',
  colorScheme: 'dark',
}

// ─── Intraday curve ───────────────────────────────────────────────────────────

/**
 * Profit accumulating hour by hour, so a day that was ahead at noon and gave it
 * back reads differently from a day that was never ahead. The line crossing
 * zero is the hour the day started paying for itself.
 */
function IntradayChart({ data }: { data: Intraday }) {
  const pts = data.points
  if (pts.length < 2) return null

  const peak = data.peak
  // Only worth pointing out when the day actually came off its high, and by
  // enough that it is not just the next hour's flat share of ad spend.
  const gaveBack = peak && peak.profit > 0 && peak.profit - data.closing > Math.abs(peak.profit) * 0.1
    ? peak.profit - data.closing
    : null
  const turned = pts.find(p => p.cumProfit >= 0)

  return (
    <Section title="Lucro acumulado no dia">
      <Chart
        labels={pts.map(p => p.label)}
        formatLabel={l => l}
        format={v => money(v)}
        height={148}
        zeroLine
        series={[
          { key: 'rev', label: 'Receita acumulada', color: C_REVENUE, area: true, values: pts.map(p => p.cumRevenue) },
          { key: 'pro', label: 'Lucro acumulado',   color: C_PROFIT,               values: pts.map(p => p.cumProfit) },
        ] as Series[]}
      />
      <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '8px 0 0', lineHeight: 1.5 }}>
        {gaveBack
          ? <>Pico de <b style={{ color: 'var(--ink-2)' }}>{money(peak!.profit)}</b> às {String(peak!.hour).padStart(2, '0')}h, {money(gaveBack)} devolvidos desde então.</>
          : turned
            ? <>No azul desde as {String(turned.hour).padStart(2, '0')}h.</>
            : <>Ainda não cobriu o gasto do dia.</>}
        {' '}O gasto com anúncios é diário e foi distribuído por igual entre as horas; a receita é exata.
      </p>
    </Section>
  )
}

// ─── Cost breakdown ───────────────────────────────────────────────────────────

function CostBreakdown({ totals }: {
  totals: { revenue: number; profit: number; adSpend: number; cogs: number; shipping: number; fees: number }
}) {
  const rows = [
    { label: 'Produto (COGS)', v: totals.cogs },
    { label: 'Anúncios',       v: totals.adSpend },
    { label: 'Frete',          v: totals.shipping },
    { label: 'Taxas',          v: totals.fees },
  ].filter(r => r.v > 0)
  if (!rows.length || totals.revenue <= 0) return null
  const max = Math.max(...rows.map(r => r.v))

  return (
    <Section title="Para onde vai a receita">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {rows.map(r => (
          <div key={r.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{r.label}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 560 }}>
                {money(r.v)}
                <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {((r.v / totals.revenue) * 100).toFixed(0)}%</span>
              </span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.045)', borderRadius: 3 }}>
              <div style={{ width: `${(r.v / max) * 100}%`, height: '100%', background: C_REVENUE, borderRadius: '0 3px 3px 0', opacity: 0.75 }} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Per-store comparison ─────────────────────────────────────────────────────

function StoreBars({ stores }: { stores: Store[] }) {
  if (stores.length < 2) return null
  const sorted = [...stores].sort((a, b) => b.profit - a.profit)
  const maxPos = Math.max(0, ...sorted.map(s => s.profit))
  const maxNeg = Math.min(0, ...sorted.map(s => s.profit))
  const span = maxPos + Math.abs(maxNeg)
  const zero = span === 0 ? 0 : (Math.abs(maxNeg) / span) * 100

  return (
    <Section title="Lucro por loja">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {sorted.map(s => {
          const pct = span === 0 ? 0 : (Math.abs(s.profit) / span) * 100
          const neg = s.profit < 0
          return (
            <div key={s.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ fontSize: 12.5, fontWeight: 640, color: neg ? 'var(--bad)' : 'var(--ink)' }}>{money(s.profit)}</span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-3)', width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.orders} ped.</span>
              </div>
              <div style={{ position: 'relative', height: 9, background: 'rgba(255,255,255,0.045)', borderRadius: 3 }}>
                <div style={{
                  position: 'absolute', top: 0, height: '100%', width: `${pct}%`,
                  ...(neg
                    ? { right: `${100 - zero}%`, background: C_LOSS,   borderRadius: '4px 0 0 4px' }
                    : { left: `${zero}%`,        background: C_PROFIT, borderRadius: '0 4px 4px 0' }),
                }} />
                {zero > 0 && <div style={{ position: 'absolute', left: `${zero}%`, top: -2, bottom: -2, width: 1, background: 'rgba(255,255,255,0.22)' }} />}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ─── Detail tabs ──────────────────────────────────────────────────────────────

function DetailTabs({ qs }: { qs: string }) {
  const [tab, setTab] = useState<Tab>('products')
  const [cache, setCache] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const cacheKey = `${tab}|${qs}`

  useEffect(() => {
    if (cache[cacheKey]) return
    let alive = true
    setLoading(true)
    fetch(`/api/mobile/detail?section=${tab}&${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d) setCache(c => ({ ...c, [cacheKey]: d })) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [cacheKey, tab, qs, cache])

  const d = cache[cacheKey] as {
    products?: Product[]; countries?: Country[]; customers?: Customers; creatives?: Creative[]
  } | undefined
  const tabs: { key: Tab; label: string }[] = [
    { key: 'creatives', label: 'Criativos' },
    { key: 'products',  label: 'Produtos' },
    { key: 'countries', label: 'Países' },
    { key: 'customers', label: 'Clientes' },
  ]

  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 11 }}>
        {tabs.map(x => {
          const on = x.key === tab
          return (
            <button
              key={x.key} onClick={() => setTab(x.key)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12,
                fontWeight: on ? 640 : 450,
                background: on ? 'rgba(16,185,129,0.12)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--ink-3)',
                border: `1px solid ${on ? 'rgba(16,185,129,0.26)' : 'var(--hairline)'}`,
                cursor: 'pointer',
              }}
            >{x.label}</button>
          )
        })}
      </div>

      {loading && !d && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Carregando…</p>}

      {tab === 'creatives' && d?.creatives && <CreativeList creatives={d.creatives} />}
      {tab === 'products'  && d?.products  && <ProductList products={d.products} />}
      {tab === 'countries' && d?.countries && <CountryList countries={d.countries} />}
      {tab === 'customers' && d?.customers && <CustomerSplit c={d.customers} />}
    </section>
  )
}

const SIGNAL: Record<Signal, { label: string; color: string; bg: string }> = {
  kill:    { label: 'CORTAR',   color: '#ff6b6b', bg: 'rgba(208,59,59,0.16)' },
  scale:   { label: 'ESCALAR',  color: '#34d399', bg: 'rgba(5,150,105,0.18)' },
  refresh: { label: 'TROCAR',   color: '#fbbf24', bg: 'rgba(245,158,11,0.16)' },
  ok:      { label: 'OK',       color: 'var(--ink-3)', bg: 'rgba(255,255,255,0.05)' },
}

/**
 * Ads ranked by what needs a decision, not by what performed best. The verdict
 * is the same one the web dashboard computes, against each store's own
 * break-even ROAS.
 */
function CreativeList({ creatives }: { creatives: Creative[] }) {
  if (!creatives.length) return <Empty>Sem anúncios com gasto no período.</Empty>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {creatives.map(c => {
        const sig = SIGNAL[c.signal] ?? SIGNAL.ok
        const beating = c.roas >= c.breakEven
        return (
          <div key={c.adId} style={{
            background: 'var(--card)', border: '1px solid var(--hairline)',
            borderRadius: 11, padding: '10px 11px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              {c.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnail} alt="" width={38} height={38}
                  style={{ borderRadius: 7, objectFit: 'cover', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                    color: sig.color, background: sig.bg, borderRadius: 4, padding: '2px 5px', flexShrink: 0,
                  }}>{sig.label}</span>
                  <span style={{
                    fontSize: 12, color: 'var(--ink)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{c.name}</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {money(c.spend)} gasto ·{' '}
                  <span style={{ color: beating ? 'var(--good)' : 'var(--bad)', fontWeight: 600 }}>
                    {c.roas.toFixed(2)}×
                  </span>
                  {' '}(break-even {c.breakEven.toFixed(2)}×) · {c.purchases} compras
                </p>
                <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '2px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                  CTR {c.ctr.toFixed(2)}% · Freq {c.frequency.toFixed(1)}×
                  {c.hookRate != null && <> · Hook {c.hookRate.toFixed(0)}%</>}
                  {c.isVideo && c.holdRate100 != null && <> · Até o fim {c.holdRate100.toFixed(0)}%</>}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ProductList({ products }: { products: Product[] }) {
  if (!products.length) return <Empty>Nenhum produto vendido no período.</Empty>
  const max = Math.max(...products.map(p => p.revenue))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {products.slice(0, 15).map(p => (
        <div key={p.title}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
            <span style={{ fontSize: 12.5, fontWeight: 620 }}>{money(p.revenue)}</span>
            <span style={{ fontSize: 10.5, color: 'var(--ink-3)', width: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.units} un.</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.045)', borderRadius: 3 }}>
            <div style={{ width: `${(p.revenue / max) * 100}%`, height: '100%', background: C_REVENUE, borderRadius: '0 3px 3px 0', opacity: 0.8 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function CountryList({ countries }: { countries: Country[] }) {
  if (!countries.length) return <Empty>Sem vendas por país no período.</Empty>
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {countries.slice(0, 15).map(c => (
        <li key={c.country_code} style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '9px 0', borderBottom: '1px solid var(--hairline)',
        }}>
          <span aria-hidden="true" style={{ fontSize: 16 }}>{flag(c.country_code)}</span>
          <span style={{ fontSize: 12.5, width: 30, color: 'var(--ink-2)' }}>{c.country_code}</span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
            {c.orders} ped.{c.roas !== null && ` · ${c.roas.toFixed(1)}×`}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(c.revenue)}</span>
          <span style={{
            fontSize: 11.5, width: 62, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
            color: c.netProfit < 0 ? 'var(--bad)' : 'var(--good)',
          }}>{money(c.netProfit)}</span>
        </li>
      ))}
    </ul>
  )
}

function CustomerSplit({ c }: { c: Customers }) {
  const total = c.newCustomers + c.returningCustomers
  if (!total) return <Empty>Sem pedidos no período.</Empty>
  const pctNew = (c.newCustomers / total) * 100
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${pctNew}%`, background: C_REVENUE }} />
        {/* 2px surface gap separates the two segments. */}
        <div style={{ width: 2, background: 'var(--surface)' }} />
        <div style={{ flex: 1, background: C_PROFIT }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--hairline)', borderRadius: 11, padding: '10px 11px' }}>
          <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '0 0 3px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: C_REVENUE }} /> Novos
          </p>
          <p style={{ fontSize: 18, fontWeight: 640, margin: 0 }}>{c.newCustomers}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '2px 0 0' }}>{money(c.newRevenue)} · {pctNew.toFixed(0)}%</p>
        </div>
        <div style={{ background: 'var(--card)', border: '1px solid var(--hairline)', borderRadius: 11, padding: '10px 11px' }}>
          <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '0 0 3px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: C_PROFIT }} /> Recorrentes
          </p>
          <p style={{ fontSize: 18, fontWeight: 640, margin: 0 }}>{c.returningCustomers}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '2px 0 0' }}>{money(c.returningRevenue)} · {(100 - pctNew).toFixed(0)}%</p>
        </div>
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: 0 }}>{children}</p>
}

// ─── Live sales feed ──────────────────────────────────────────────────────────

function SalesFeed({ orders }: { orders: LiveOrder[] }) {
  return (
    <Section title="Vendas ao vivo">
      {orders.length === 0 ? (
        <Empty>Nenhuma venda registrada ainda. Cada pedido novo aparece aqui em segundos.</Empty>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {orders.map(o => {
            const items = Array.isArray(o.items) ? o.items : []
            const units = items.reduce((s, i) => s + Number(i.quantity ?? 0), 0)
            return (
              <li key={`${o.store}-${o.orderId}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '1px solid var(--hairline)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 560, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {units > 1 ? `${units}× ` : ''}{items[0]?.title ?? 'Pedido'}
                    {items.length > 1 && <span style={{ color: 'var(--ink-3)' }}> +{items.length - 1}</span>}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '2px 0 0' }}>
                    {o.orderNumber ? `${o.orderNumber} · ` : ''}{o.store}{o.country ? ` · ${o.country}` : ''} · {timeAgo(o.receivedAt)}
                  </p>
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 640, color: C_PROFIT, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {moneyExact(o.total, o.currency)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

interface Rule { enabled: boolean; threshold: number }
interface AlertConfig {
  roasDrop: Rule; spendSpike: Rule; marginDrop: Rule
  dailySummary: { enabled: boolean; hour: number }
  minSpend: number; fromHour: number
}

/**
 * Thresholds for the push alerts. They are saved on the server, not in this
 * browser: what evaluates them is a scheduler that runs whether or not any
 * phone is awake.
 */
function AlertsSheet({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AlertConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    fetch('/api/mobile/alerts')
      .then(r => r.json())
      .then(d => setCfg(d.config))
      .catch(() => setNote('Não foi possível carregar'))
  }, [])

  async function save(next: AlertConfig) {
    setCfg(next)
    setSaving(true)
    try {
      await fetch('/api/mobile/alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: next }),
      })
      setNote('Salvo')
    } catch { setNote('Falha ao salvar') }
    finally { setSaving(false); setTimeout(() => setNote(''), 2000) }
  }

  async function test() {
    setNote('Enviando…')
    try {
      const r = await fetch('/api/mobile/alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      }).then(x => x.json())
      setNote(`Enviado: ${r.fired} alerta(s) + resumo`)
    } catch { setNote('Falha no teste') }
    setTimeout(() => setNote(''), 4000)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--hairline)',
          borderRadius: '16px 16px 0 0', padding: '16px 16px calc(env(safe-area-inset-bottom) + 20px)',
          width: '100%', maxWidth: 640, maxHeight: '88dvh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 680, margin: 0, flex: 1 }}>Alertas</h2>
          {note && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginRight: 10 }}>{note}</span>}
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--hairline)', borderRadius: 8,
            padding: '5px 11px', fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer',
          }}>Fechar</button>
        </div>

        {!cfg ? <Empty>Carregando…</Empty> : (
          <>
            <RuleRow
              label="ROAS abaixo de" unit="×" step={0.1}
              rule={cfg.roasDrop}
              onChange={r => save({ ...cfg, roasDrop: r })}
            />
            <RuleRow
              label="Margem abaixo de" unit="%" step={1}
              rule={cfg.marginDrop}
              onChange={r => save({ ...cfg, marginDrop: r })}
            />
            <RuleRow
              label="Gasto acima de" unit="% da média de 7d" step={10}
              rule={cfg.spendSpike}
              onChange={r => save({ ...cfg, spendSpike: r })}
            />

            <div style={rowStyle}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12.5, margin: 0 }}>Resumo do dia</p>
                <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '2px 0 0' }}>
                  Um push com o resultado da conta
                </p>
              </div>
              <input
                type="number" min={0} max={23} value={cfg.dailySummary.hour}
                onChange={e => save({ ...cfg, dailySummary: { ...cfg.dailySummary, hour: Number(e.target.value) } })}
                style={numStyle}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-3)', width: 16 }}>h</span>
              <Switch
                on={cfg.dailySummary.enabled}
                onChange={v => save({ ...cfg, dailySummary: { ...cfg.dailySummary, enabled: v } })}
              />
            </div>

            <div style={rowStyle}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12.5, margin: 0 }}>Gasto mínimo para avaliar</p>
                <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '2px 0 0' }}>
                  Loja que gastou menos que isso hoje não dispara alerta
                </p>
              </div>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>$</span>
              <input
                type="number" min={0} step={10} value={cfg.minSpend}
                onChange={e => save({ ...cfg, minSpend: Number(e.target.value) })}
                style={numStyle}
              />
            </div>

            <div style={{ ...rowStyle, borderBottom: 'none' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12.5, margin: 0 }}>Não alertar antes das</p>
                <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '2px 0 0' }}>
                  De manhã o gasto já entrou e as vendas ainda não
                </p>
              </div>
              <input
                type="number" min={0} max={23} value={cfg.fromHour}
                onChange={e => save({ ...cfg, fromHour: Number(e.target.value) })}
                style={numStyle}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-3)', width: 16 }}>h</span>
            </div>

            <button
              onClick={test} disabled={saving}
              style={{
                width: '100%', marginTop: 14, padding: '11px 0', borderRadius: 10,
                background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.3)',
                color: 'var(--accent)', fontSize: 13, fontWeight: 620, cursor: 'pointer',
              }}
            >
              Testar agora
            </button>
            <p style={{ fontSize: 10.5, color: 'var(--ink-3)', margin: '8px 0 0', textAlign: 'center' }}>
              O teste avalia as lojas e envia o que estiver fora do limite, ignorando o envio único do dia.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '11px 0', borderBottom: '1px solid var(--hairline)',
}
const numStyle: React.CSSProperties = {
  width: 62, background: 'var(--card)', border: '1px solid var(--hairline)',
  borderRadius: 8, padding: '7px 8px', fontSize: 13, color: 'var(--ink)',
  textAlign: 'right', colorScheme: 'dark',
}

function RuleRow({ label, unit, step, rule, onChange }: {
  label: string; unit: string; step: number
  rule: Rule; onChange: (r: Rule) => void
}) {
  return (
    <div style={rowStyle}>
      <p style={{ fontSize: 12.5, margin: 0, flex: 1 }}>{label}</p>
      <input
        type="number" step={step} min={0} value={rule.threshold}
        onChange={e => onChange({ ...rule, threshold: Number(e.target.value) })}
        style={numStyle}
      />
      <span style={{ fontSize: 10.5, color: 'var(--ink-3)', width: 80 }}>{unit}</span>
      <Switch on={rule.enabled} onChange={v => onChange({ ...rule, enabled: v })} />
    </div>
  )
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)} role="switch" aria-checked={on}
      style={{
        width: 40, height: 23, borderRadius: 999, flexShrink: 0, cursor: 'pointer',
        background: on ? 'var(--good)' : 'rgba(255,255,255,0.12)',
        border: 'none', padding: 2, display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background 0.15s',
      }}
    >
      <span style={{ width: 19, height: 19, borderRadius: '50%', background: '#fff', display: 'block' }} />
    </button>
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
      if (!meta.vapidPublicKey) { alert('VAPID não configurada no servidor.'); setState('default'); return }

      const sub = await reg.pushManager.getSubscription()
        ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(meta.vapidPublicKey) as BufferSource,
        })
      await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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

  if (state === 'unsupported' || state === 'granted') return null

  return (
    <button
      onClick={enable} disabled={state === 'working' || state === 'denied'}
      aria-label="Ativar notificações"
      style={{
        background: 'transparent', border: '1px solid var(--hairline)', borderRadius: 8,
        padding: '6px 9px', fontSize: 11.5, color: 'var(--ink-3)', cursor: 'pointer',
      }}
    >
      {state === 'working' ? '…' : state === 'denied' ? '🔕' : '🔔 Ativar'}
    </button>
  )
}
