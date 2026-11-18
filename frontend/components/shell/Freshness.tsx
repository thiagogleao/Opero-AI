/**
 * Freshness — "● atualizado há 4 min", per store, amber when a source is late,
 * coral when the last attempt failed. Server component (async): reads
 * lib/sync/status getFreshness() for the stores in view. A store's age is its
 * OLDEST source (orders and Meta), because a number is only as fresh as its
 * oldest input; another store's fresh sync never makes this one look current.
 * With several stores: "6 de 7 em dia" and the per-store list in the ⓘ.
 *
 *   <Suspense fallback={<FreshnessFallback />}><Freshness stores={ctx.selected} /></Suspense>
 *   (AppShell already does this in the top bar.)
 *
 * Props: { stores: { id: string; name: string; archived?: boolean }[]; now?: Date }
 * Thresholds are lib/sync/plan STALE_AFTER_MIN (orders amber 20 min / red 60;
 * Meta amber 45 / red 120). Archived stores are skipped: they are not synced.
 */

import 'server-only'
import { getFreshness, type LaneFreshness } from '@/lib/sync/status'
// The same thresholds getFreshness() judges with, so the words cannot drift.
import { STALE_AFTER_MIN } from '@/lib/sync/plan'
import { formatRelativeTime } from '@/lib/format'
import { StatusDot } from '@/components/ui/Chip'
import { InfoTip } from '@/components/ui/InfoTip'

type State = 'ok' | 'stale' | 'failing' | 'unknown'

interface StoreAge {
  id: string
  name: string
  state: State
  oldest: string | null
  orders: LaneFreshness | null
  meta: LaneFreshness | null
}

function laneState(l: LaneFreshness | null): State | null {
  if (!l) return null
  if (l.staleness === 'unknown') return 'unknown'
  if (l.staleness === 'red' && (l.lastStatus === 'error' || l.lastStatus === 'partial')) return 'failing'
  return l.staleness === 'ok' ? 'ok' : 'stale'
}

const RANK: Record<State, number> = { ok: 0, unknown: 1, stale: 2, failing: 3 }

function ageOf(f: { storeId: string; shopify: LaneFreshness | null; facebook: LaneFreshness | null }, name: string): StoreAge {
  const lanes = [f.shopify, f.facebook].filter((l): l is LaneFreshness => !!l)
  const states = [laneState(f.shopify), laneState(f.facebook)].filter((x): x is State => !!x)
  const state = states.reduce<State>((w, x) => (RANK[x] > RANK[w] ? x : w), states.length ? 'ok' : 'unknown')
  const times = lanes.map(l => l.lastSuccessAt).filter((x): x is string => !!x).sort()
  return { id: f.storeId, name, state, oldest: lanes.some(l => !l.lastSuccessAt) ? null : times[0] ?? null, orders: f.shopify, meta: f.facebook }
}

export async function Freshness({ stores, now = new Date() }: { stores: { id: string; name: string; archived?: boolean }[]; now?: Date }) {
  const live = stores.filter(s => !s.archived)
  if (!live.length) return null
  let ages: StoreAge[]
  try {
    const rows = await getFreshness(live.map(s => s.id), now)
    const nameOf = new Map(live.map(s => [s.id, s.name]))
    ages = rows.map(r => ageOf(r, nameOf.get(r.storeId) ?? r.storeId))
  } catch (err) {
    console.error('[shell] freshness', err)
    return <StatusDot state="unknown">atualização desconhecida</StatusDot>
  }
  if (!ages.length) return <StatusDot state="unknown">sem sincronização</StatusDot>

  const worst = ages.reduce<State>((w, a) => (RANK[a.state] > RANK[w] ? a.state : w), 'ok')
  const late = ages.filter(a => a.state === 'stale' || a.state === 'failing')
  const oldest = ages.map(a => a.oldest).filter((x): x is string => !!x).sort()[0] ?? null
  const single = ages.length === 1

  const label = single
    ? worst === 'failing' ? `falhando · ${formatRelativeTime(oldest, now)}`
      : oldest ? `atualizado ${formatRelativeTime(oldest, now)}` : 'sem atualização recente'
    : late.length ? `${ages.length - late.length} de ${ages.length} em dia`
      : oldest ? `atualizado ${formatRelativeTime(oldest, now)}` : 'sem atualização recente'

  const lane = (name: string, l: LaneFreshness | null) =>
    l ? `${name} ${l.lastSuccessAt ? formatRelativeTime(l.lastSuccessAt, now) : 'nunca'}${l.lastStatus === 'error' ? ' (última tentativa falhou)' : ''}` : null

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <StatusDot state={worst}>{label}</StatusDot>
      <InfoTip label="De quando são os números">
        <b>Última leitura de cada fonte</b>
        {ages.map(a => (
          <span key={a.id} style={{ display: 'block', marginTop: 4 }}>
            <b>{a.name}</b>{a.state === 'stale' ? ' · atrasada' : a.state === 'failing' ? ' · falhando' : ''}<br />
            {[lane('pedidos', a.orders), lane('Meta', a.meta)].filter(Boolean).join(' · ') || 'sem fontes sincronizadas'}
          </span>
        ))}
        <span style={{ display: 'block', marginTop: 6, color: 'var(--tx-3)' }}>
          Pedidos atrasam a partir de {STALE_AFTER_MIN.shopify[0]} min sem leitura; Meta a partir de {STALE_AFTER_MIN.facebook[0]} min.
        </span>
      </InfoTip>
    </span>
  )
}

export function FreshnessFallback() {
  return <StatusDot state="unknown">verificando atualização…</StatusDot>
}
