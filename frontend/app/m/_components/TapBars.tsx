'use client'

/**
 * The phone's charts you read by tapping one bar (spec §4.2–§4.3).
 *
 * TapBars: one thick bar per day (or per week past 62 days); TapHours: one
 * bar per hour of the running (or chosen) day, cumulative. One tap pins a
 * column; its numbers sit in a readout card ABOVE the chart, so the finger
 * never covers them. The readout is never empty: before any tap it shows the
 * default pin (the latest complete day, the latest hour). Tapping the pinned
 * column again goes back to the default; a tap elsewhere changes nothing.
 *
 * Gestures never fight the page: in fit mode the plot is `touch-action:
 * pan-y` (vertical swipes scroll the page, sideways drags do nothing — no
 * history-back); in strip mode the scroller pans either way and the browser
 * picks the axis. A pan fires pointercancel, so it never pins.
 *
 * Columns are real buttons (HTML bars, not SVG) with one roving tab stop
 * (components/charts/roving): ←/→ move and pin, Home/End jump, Enter/Space
 * pin (Enter on the pinned column → default). The readout is announced only
 * when the pin changes by the owner's hand, not on the 45-s refresh (C19).
 *
 * Pure rules live in ./tapBarsLogic (tested).
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Chip, Icon, InfoTip } from '@/components/ui'
import { rovingTarget, ROVING_KEYS } from '@/components/charts/roving'
import { formatCount, formatMoney, formatPct, plural } from '@/lib/format'
import {
  chartColumns, daySentence, defaultHourPin, defaultPin, defaultWeekPin, hourLabel, indexFromX, isTap, layoutFor, LABEL_EVERY_COL, LONG_PRESS_MS, readoutChars, TAP_SLOP,
  scaleOf, summaryLine, tapResult, type TapDay, type TapHour,
} from './tapBarsLogic'
import s from './TapBars.module.css'

export type { TapDay, TapHour } from './tapBarsLogic'

/** Bar area height (px). */
const PLOT_H = 150
/** Plot width before the first measure (the card's inner width at 390 px). */
const W0 = 326

interface Col {
  key: string
  value: number
  axis: string
  monthStart?: string
  partial: boolean
  /** Under the column: "hoje" / "agora". */
  under?: string
  aria: string
  dim?: boolean
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Scroll the page just enough that the readout clears the phone's sticky
 *  header (Top's <header>); nothing when it is already in view. */
function revealReadout(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const safeTop = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + 8
  const top = el.getBoundingClientRect().top
  if (top < safeTop) window.scrollBy({ top: top - safeTop, behavior: reducedMotion() ? 'auto' : 'smooth' })
}

/** Pin state keyed by the column key (C17): it survives refreshes while the key exists. */
function usePin(cols: readonly { key: string }[], fallback: number, resetKey: string) {
  const [state, setState] = useState<{ reset: string; key: string | null; said: string }>({ reset: resetKey, key: null, said: '' })
  // A new store or period resets the pin (adjusting state while rendering, the
  // React-recommended pattern for "reset on prop change").
  if (state.reset !== resetKey) setState({ reset: resetKey, key: null, said: '' })
  const keyNow = state.reset === resetKey ? state.key : null
  const found = keyNow === null ? -1 : cols.findIndex(c => c.key === keyNow)
  const pinned = found >= 0 ? found : fallback
  const set = useCallback((key: string | null, said: string) => setState(st => ({ ...st, key, said })), [])
  return { pinned, set, said: state.reset === resetKey ? state.said : '' }
}

function TapChart({ cols, fallback, pinnedIndex, onPin, readout, ariaLabel, net, reference, unitWord, readoutId }: {
  cols: Col[]
  fallback: number
  pinnedIndex: number
  onPin: (i: number) => void
  readout: ReactNode
  ariaLabel: string
  net?: boolean
  reference?: { value: number; label: string } | null
  /** "dias" / "semanas" / "horas", for the "◂ 12 dias antes" hint. */
  unitWord: [string, string]
  readoutId: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(W0)
  const n = cols.length
  const layout = layoutFor(n, width)
  const strip = layout.mode === 'strip'

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWidth(Math.max(120, Math.floor(el.clientWidth)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Strip: start at the right end (latest day), and track what is hidden.
  const [scroll, setScroll] = useState({ left: 0, max: 0 })
  const firstKey = cols[0]?.key ?? ''
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !strip) return
    el.scrollLeft = el.scrollWidth
    setScroll({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth })
    // Only when the series itself changes (store, period), not on each refresh.
  }, [strip, firstKey, n])
  const onScroll = () => {
    const el = scroller.current
    if (el) setScroll({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth })
  }

  /** Keep column i visible in the strip. */
  const reveal = useCallback((i: number) => {
    const el = scroller.current
    if (!el || !strip) return
    const x0 = i * layout.col
    const x1 = x0 + layout.col
    let to: number | null = null
    if (x0 < el.scrollLeft + 4) to = Math.max(0, x0 - layout.col)
    else if (x1 > el.scrollLeft + el.clientWidth - 4) to = x1 - el.clientWidth + layout.col
    if (to !== null) el.scrollTo({ left: to, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [strip, layout.col])

  // Whatever moved the pin (◀ ▶, keys, a refresh), keep it in view.
  useEffect(() => { reveal(pinnedIndex) }, [pinnedIndex, reveal])

  // ── Tap detection: same column, < 8 px, no pointercancel, any length ────
  // A press held still pins on its own after LONG_PRESS_MS (the old chart was
  // read by holding a finger on it); its release then does nothing more, so
  // a held press on the pinned column does not toggle it back.
  const gesture = useRef<{ id: number; x: number; y: number; t: number; i: number; cancelled: boolean; held: boolean } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null } }
  useEffect(() => stopHold, [])
  const colAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect()
    return r ? indexFromX(clientX - r.left, layout.col, n) : -1
  }
  const pinFromPointer = (i: number) => {
    onPin(i)
    // The readout sits above the bars: when the page is scrolled so that it
    // hides under the sticky header, bring it back so the tap shows its numbers.
    requestAnimationFrame(() => revealReadout(readoutId))
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), i: colAt(e.clientX), cancelled: false, held: false }
    gesture.current = g
    stopHold()
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      if (gesture.current !== g || g.cancelled || g.i < 0) return
      g.held = true
      // A press held on the pinned column keeps it (no toggle back).
      if (g.i !== pinnedIndex) pinFromPointer(g.i)
      else requestAnimationFrame(() => revealReadout(readoutId))
    }, LONG_PRESS_MS)
  }
  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId || g.held) return
    // A move past the slop is a pan: no hold, and no tap at the release.
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) >= TAP_SLOP) { g.cancelled = true; stopHold() }
  }
  const onPointerUp = (e: PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    stopHold()
    if (!g || g.id !== e.pointerId || g.held) return
    const up = colAt(e.clientX)
    if (isTap({ downIndex: g.i, upIndex: up, dx: e.clientX - g.x, dy: e.clientY - g.y, ms: performance.now() - g.t, cancelled: g.cancelled })) {
      pinFromPointer(up)
    }
  }
  const onPointerCancel = () => { gesture.current = null; stopHold() }

  // ── Keyboard: roving stop on the pinned column ──────────────────────────
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const focusCol = (i: number) => {
    reveal(i)
    requestAnimationFrame(() => buttons.current[i]?.focus({ preventScroll: true }))
  }
  const keyAt = useRef(-1e9)
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    keyAt.current = e.timeStamp
    const to = rovingTarget(e.key, i, n)
    if (to !== null) {
      e.preventDefault()
      if (to !== pinnedIndex) onPin(to)
      focusCol(to)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPin(i)
      // Enter on the pinned column went back to the default: follow it.
      if (i === pinnedIndex) focusCol(fallback)
    }
  }

  const values = cols.map(c => c.value)
  const sc = scaleOf(reference ? [...values, reference.value] : values)
  const zeroY = sc.zero * PLOT_H
  const hidden = strip ? Math.floor(scroll.left / layout.col + 0.01) : 0
  const moreRight = strip && scroll.max - scroll.left > 2
  const labelEvery = layout.col >= LABEL_EVERY_COL ? 1 : 2

  const plot = (
    <div
      ref={track}
      className={s.track}
      style={{ width: strip ? n * layout.col : '100%', gridTemplateColumns: `repeat(${n}, ${strip ? `${layout.col}px` : '1fr'})` }}
      role="group"
      aria-label={ariaLabel}
      aria-describedby={readoutId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      // A long press reads a value: no context menu or callout over the bars.
      onContextMenu={e => e.preventDefault()}
    >
      <span className={s.zero} style={{ top: zeroY }} aria-hidden="true" />
      {reference && (
        <span className={s.ref} style={{ top: (sc.hi - reference.value) / Math.max(1e-9, sc.hi - sc.lo) * PLOT_H }} aria-hidden="true" />
      )}
      {cols.map((c, i) => {
        const h = Math.max(c.value === 0 ? 0 : 2, sc.h(c.value) * PLOT_H)
        const top = c.value >= 0 ? zeroY - h : zeroY
        const tone = c.value < 0 ? s.neg : net ? s.net : s.pos
        const on = i === pinnedIndex
        const showAxis = c.axis && (i % labelEvery === 0 || on || c.monthStart)
        return (
          <button
            key={c.key}
            ref={el => { buttons.current[i] = el }}
            type="button"
            data-col={i}
            className={`${s.col}${on ? ` ${s.colOn}` : ''}${c.dim ? ` ${s.colDim}` : ''}`}
            aria-pressed={on}
            aria-label={c.aria}
            aria-keyshortcuts={ROVING_KEYS}
            tabIndex={on ? 0 : -1}
            onKeyDown={e => onKeyDown(e, i)}
            // Pointer taps are decided in onPointerUp; a click with no pointer
            // (assistive tech) pins here.
            onClick={e => { if (e.detail === 0 && e.timeStamp - keyAt.current > 700) onPin(i) }}
          >
            <span className={s.plotArea} aria-hidden="true">
              {c.value !== 0 && (
                <span
                  className={`${s.bar} ${tone}${c.partial ? ` ${s.partial}` : ''}`}
                  style={{ top, height: h, width: layout.bar }}
                />
              )}
            </span>
            <span className={s.axis} aria-hidden="true">
              <span className={on ? s.axisOn : undefined}>{showAxis ? c.axis : ''}</span>
              {c.monthStart ? <small>{c.monthStart}</small> : c.under ? <small className={s.under}>{c.under}</small> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
  // The scale (§4.2: the largest |value| at the plot's top-left) sits on the
  // frame, not on the scrolling track: in strip mode the track starts scrolled
  // to its right end, and a label on its first column was out of view.
  const scale = <>
    {sc.hi > 0 && <span className={s.scaleTop} aria-hidden="true">{formatMoney(sc.hi)}</span>}
    {sc.lo < 0 && <span className={s.scaleBottom} aria-hidden="true">{formatMoney(sc.lo)}</span>}
  </>

  return (
    <div className={s.chart}>
      {readout}
      <div ref={wrap} className={s.measure}>
        {strip ? (
          <div className={s.stripWrap}>
            <div ref={scroller} className={s.strip} onScroll={onScroll}>{plot}</div>
            {hidden > 0 && <span className={s.fadeL} aria-hidden="true" />}
            {moreRight && <span className={s.fadeR} aria-hidden="true" />}
            {hidden > 0 && (
              <span className={s.hint} aria-hidden="true">◂ {plural(hidden, unitWord[0], unitWord[1])} antes</span>
            )}
            {scale}
          </div>
        ) : (
          <div className={s.fit}>{plot}{scale}</div>
        )}
      </div>
    </div>
  )
}

/** The readout's two buttons and their wiring. */
function Steps({ i, n, onStep, words }: { i: number; n: number; onStep: (to: number) => void; words: [string, string] }) {
  return (
    <span className={s.steps}>
      <button type="button" className={s.step} aria-label={words[0]} disabled={i <= 0} onClick={() => onStep(i - 1)}>
        <Icon name="chevRight" size={18} className={s.flip} />
      </button>
      <button type="button" className={s.step} aria-label={words[1]} disabled={i >= n - 1} onClick={() => onStep(i + 1)}>
        <Icon name="chevRight" size={18} />
      </button>
    </span>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | 'mut' }) {
  return (
    <span className={s.cell}>
      <small>{label}</small>
      <b className={tone}>{value}</b>
    </span>
  )
}

/** The four cells; their values share one size, set by the longest one and
 *  the row's real width (CSS container units), so none spills into the next. */
function Cells({ cells }: { cells: { label: string; value: string; tone?: 'pos' | 'neg' | 'mut' }[] }) {
  const style = { '--chars': readoutChars(cells.map(c => c.value)) } as CSSProperties
  return (
    <div className={s.r2} style={style}>
      {cells.map(c => <Cell key={c.label} label={c.label} value={c.value} tone={c.tone} />)}
    </div>
  )
}

const signTone = (v: number): 'pos' | 'neg' | undefined => (v < 0 ? 'neg' : v > 0 ? 'pos' : undefined)

// ─── TapBars: one bar per day (or week) ───────────────────────────────────────

export function TapBars({ days, mode, partialNote, ariaLabel, resetKey, today }: {
  days: TapDay[]
  mode: 'profit' | 'net'
  partialNote?: string   // "parcial · até 13h46"
  ariaLabel: string
  /** Store + period: the pin resets only when this changes (C17). */
  resetKey: string
  today?: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const readoutId = `tap-${uid}`
  const { cols: series, unit } = useMemo(() => chartColumns(days, mode, today), [days, mode, today])
  const fallback = unit === 'week' ? defaultWeekPin(series) : defaultPin(series)
  const { pinned, set, said } = usePin(series, fallback, resetKey)
  const net = mode === 'net'
  const cols: Col[] = useMemo(() => series.map(d => ({
    key: d.key, value: d.value, axis: d.axis, monthStart: d.monthStart, partial: d.partial,
    under: d.partial ? 'hoje' : undefined, aria: daySentence(d, mode), dim: d.notYet,
  })), [series, mode])
  const pin = useCallback((i: number) => {
    const key = tapResult(series, pinned, i)
    const at = key === null ? fallback : i
    set(key, series[at] ? daySentence(series[at], mode) : '')
  }, [series, pinned, fallback, set, mode])
  const step = useCallback((to: number) => {
    if (to < 0 || to >= series.length) return
    set(to === fallback ? null : series[to].key, daySentence(series[to], mode))
  }, [series, fallback, set, mode])
  const d = series[pinned]
  if (!d) return null

  const lucro = formatMoney(d.value)
  const cells = net
    ? [{ label: 'Vendas − anúncios', value: lucro, tone: signTone(d.value) }, { label: 'Pedidos', value: formatCount(d.orders) },
      { label: 'Receita', value: formatMoney(d.revenue) }, { label: 'Anúncios', value: formatMoney(d.adSpend) }]
    : [{ label: 'Lucro', value: lucro, tone: signTone(d.value) }, { label: 'Margem', value: d.margin === null ? '—' : formatPct(d.margin), tone: d.margin === null ? 'mut' as const : undefined },
      { label: 'Receita', value: formatMoney(d.revenue) }, { label: 'Anúncios', value: formatMoney(d.adSpend) }]
  const split = d.metaSpend > 0 && d.shopSpend > 0

  const readout = (
    <div className={s.readout} id={readoutId}>
      <div className={s.r1}>
        <span className={s.rMain}>
          <span className={s.rLabel}>
            <b>{d.label}</b>{!net && !d.notYet && <> · {plural(d.orders, 'pedido', 'pedidos')}</>}
          </span>
          {d.beforeFirst && <Chip tone="neu" size="sm">antes da 1ª venda</Chip>}
          {d.partial && partialNote && <Chip tone="warn" icon="clock" size="sm">{partialNote}</Chip>}
          {d.partial && !partialNote && <Chip tone="warn" icon="clock" size="sm">parcial</Chip>}
        </span>
        <Steps i={pinned} n={series.length} onStep={step} words={unit === 'week' ? ['Semana anterior', 'Próxima semana'] : ['Dia anterior', 'Próximo dia']} />
      </div>
      {d.notYet ? (
        <p className={s.notYet}>a loja ainda não vendia</p>
      ) : (
        <>
          <Cells cells={cells} />
          {split && <p className={s.r3}>anúncios: Meta {formatMoney(d.metaSpend)} · Shopify {formatMoney(d.shopSpend)}</p>}
        </>
      )}
      <span className={s.sr} aria-live="polite">{said}</span>
    </div>
  )

  return (
    <>
      <TapChart
        cols={cols} fallback={fallback} pinnedIndex={pinned} onPin={pin} readout={readout} readoutId={readoutId}
        ariaLabel={ariaLabel} net={net} unitWord={unit === 'week' ? ['semana', 'semanas'] : ['dia', 'dias']}
      />
      {summaryLine(series, mode, unit) && <p className={s.summary}>{summaryLine(series, mode, unit)}</p>}
    </>
  )
}

// ─── TapHours: one bar per hour, cumulative ───────────────────────────────────

export function TapHours({ hours, net, ariaLabel, resetKey, cityNote, reference, outside }: {
  hours: TapHour[]
  net: boolean
  ariaLabel: string
  resetKey: string
  /** " · Tóquio" when one store runs on another clock. */
  cityNote?: string
  /** The dashed level "ontem até esta hora $X" (DayBlock's rule). */
  reference?: { value: number; label: string } | null
  /** Stores beside the curve (closed day, no costs): a "sem Hibikura" chip in
   *  the readout, so its lucro never silently contradicts the band's. */
  outside?: { label: string; info: string } | null
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const readoutId = `tap-${uid}`
  const fallback = defaultHourPin(hours)
  const { pinned, set, said } = usePin(hours, fallback, resetKey)
  const what = net ? 'vendas − anúncios acumuladas' : 'lucro acumulado'
  const sentence = useCallback((h: TapHour) =>
    `${hourLabel(h.hour)}${outside ? ` (${outside.label})` : ''}: ${what} ${formatMoney(h.value)}, vendas acumuladas ${formatMoney(h.cumRevenue)}, vendas na hora ${formatMoney(h.revenue)}, ${plural(h.orders, 'pedido', 'pedidos')} na hora${h.partial ? ' (agora)' : ''}`, [what, outside])
  const cols: Col[] = useMemo(() => hours.map(h => ({
    key: h.key, value: h.value, axis: h.axis, partial: h.partial, under: h.partial ? 'agora' : undefined, aria: sentence(h),
  })), [hours, sentence])
  const pin = useCallback((i: number) => {
    const key = tapResult(hours, pinned, i)
    const at = key === null ? fallback : i
    set(key, hours[at] ? sentence(hours[at]) : '')
  }, [hours, pinned, fallback, set, sentence])
  const step = useCallback((to: number) => {
    if (to < 0 || to >= hours.length) return
    set(to === fallback ? null : hours[to].key, sentence(hours[to]))
  }, [hours, fallback, set, sentence])
  const h = hours[pinned]
  if (!h) return null
  const cells = [
    { label: net ? 'Vendas − anúncios acumuladas' : 'Lucro acumulado', value: formatMoney(h.value), tone: signTone(h.value) },
    { label: 'Vendas acumuladas', value: formatMoney(h.cumRevenue) },
    { label: 'Vendas na hora', value: formatMoney(h.revenue) },
    { label: 'Pedidos na hora', value: formatCount(h.orders) },
  ]
  const last = pinned === hours.length - 1
  const readout = (
    <div className={s.readout} id={readoutId}>
      <div className={s.r1}>
        <span className={s.rMain}>
          <span className={s.rLabel}><b>{hourLabel(h.hour)}</b>{cityNote ?? ''}</span>
          {h.partial && <Chip tone="warn" icon="clock" size="sm">agora</Chip>}
          {outside && <InfoTip trigger={<Chip tone="info" size="sm">{outside.label}</Chip>} className={s.chipTip}>{outside.info}</InfoTip>}
        </span>
        <Steps i={pinned} n={hours.length} onStep={step} words={['Hora anterior', 'Próxima hora']} />
      </div>
      <Cells cells={cells} />
      {last && reference && <p className={s.r3}>{reference.label}: {formatMoney(reference.value)}</p>}
      <span className={s.sr} aria-live="polite">{said}</span>
    </div>
  )
  return (
    <TapChart
      cols={cols} fallback={fallback} pinnedIndex={pinned} onPin={pin} readout={readout} readoutId={readoutId}
      ariaLabel={ariaLabel} net={net} reference={reference} unitWord={['hora', 'horas']}
    />
  )
}
