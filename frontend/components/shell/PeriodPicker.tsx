'use client'

/**
 * PeriodPicker — Hoje · Ontem · 7 dias · 30 dias, a "Mais" menu (14 dias, Este
 * mês, Mês passado, Escolher datas) and the resolved range ("10–16 nov",
 * "parcial · até 13h38"). It writes ?periodo= (and ?de/?ate for custom) and
 * navigates in a transition with a spinner. Dates are never computed here:
 * every preset's URL and the range label come from the server
 * (lib/views/page.ts, resolved in the store's timezone), so the browser's clock
 * cannot shift a Tokyo store's "hoje". A period picked while another choice is
 * still loading (a store picked a moment before) is laid on top of the URL
 * being opened (./url onTopOfInFlight), so both choices stick.
 *
 * A custom period names its range once, on the "Mais" button (the range text
 * beside it is then only for screen readers).
 *
 * Leaving with unsaved work: before navigating, the picker dispatches a
 * cancelable `window` CustomEvent 'opero:before-period-change'
 * (BEFORE_PERIOD_CHANGE) with detail { from, to, href } — the current and the
 * chosen Period keys ('custom' for picked dates) and the URL it is about to
 * open. If any listener calls preventDefault() (synchronously), it stays put;
 * the page can ask and open detail.href itself. Same contract as StorePicker's
 * 'opero:before-store-change'.
 *
 * Props (built by AppShell):
 *   main       { key: Period; label: string; query: string }[]  — the four buttons
 *   more       { key: Period; label: string; query: string }[]  — menu items
 *   current    Period
 *   customBase string — ctx.hrefWith('', { periodo: null }); the client adds periodo=custom&de&ate
 *   today      'YYYY-MM-DD' in the anchor timezone (max date of the custom inputs)
 *   minDate    'YYYY-MM-DD' — earliest date a page accepts (lib/views/page MIN_PAGE_DATE)
 *   maxDays    longest custom window in days (lib/views/page MAX_WINDOW_DAYS); the
 *              server cuts longer ranges anyway, this only says so before leaving
 *   range      { from; to } — the resolved window (custom inputs' defaults)
 *   rangeLabel "10–16 nov"
 *   partialLabel "parcial · até 13h38" | null
 *   tzNote     "dia de Tóquio" | null — shown when the window is on another calendar
 */

import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { PERIODS, type Period } from '@/lib/engine/dates'
import { Icon } from '@/components/ui/Icon'
import { Chip } from '@/components/ui/Chip'
import { formatDate } from '@/lib/format'
import { hrefFor, inFlightParam, mergeQuery, NAV_LAYER, onTopOfInFlight } from './url'
import { useShellNavigation } from './useShellNavigation'
import s from './shell.module.css'

export interface PeriodOption { key: Period; label: string; query: string }

/** Cancelable window event sent before the picker opens another period. */
export const BEFORE_PERIOD_CHANGE = 'opero:before-period-change'

export interface BeforePeriodChangeDetail {
  /** The period shown now. */
  from: Period
  /** The period about to open ('custom' for picked dates). */
  to: Period
  /** The path + query the picker would open. */
  href: string
}

export interface PeriodPickerProps {
  main: PeriodOption[]
  more: PeriodOption[]
  current: Period
  customBase: string
  today: string
  minDate: string
  maxDays: number
  range: { from: string; to: string }
  rangeLabel: string
  partialLabel: string | null
  tzNote?: string | null
}

export function PeriodPicker({ main, more, current, customBase, today, minDate, maxDays, range, rangeLabel, partialLabel, tzNote }: PeriodPickerProps) {
  const pathname = usePathname() || '/'
  const nav = useShellNavigation()
  const pending = nav.pending
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  const [err, setErr] = useState<string | null>(null)
  const menuId = useId()
  const moreBtn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // A new window from the server resets the custom inputs (derived during render).
  const [shownRange, setShownRange] = useState(`${range.from}|${range.to}`)
  if (shownRange !== `${range.from}|${range.to}`) { setShownRange(`${range.from}|${range.to}`); setFrom(range.from); setTo(range.to) }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !moreBtn.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); moreBtn.current?.focus() } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    menu.current?.querySelector<HTMLElement>('button')?.focus()
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const go = (to: Period, query: string) => {
    setOpen(false)
    const href = onTopOfInFlight(hrefFor(pathname, query), NAV_LAYER.period)
    const detail: BeforePeriodChangeDetail = { from: current, to, href }
    if (!window.dispatchEvent(new CustomEvent(BEFORE_PERIOD_CHANGE, { detail, cancelable: true }))) return
    nav.push(href)
  }

  // The period already chosen: the one on screen or, while another choice is
  // loading, the one being opened (clicking the period still on screen then
  // takes the choice back). Compared on the server-built query's periodo
  // (absent = the default period, as in the URL).
  const isChosen = (p: PeriodOption) => {
    const opening = inFlightParam('periodo')
    if (opening === undefined) return p.key === current
    return new URLSearchParams(p.query.startsWith('?') ? p.query.slice(1) : p.query).get('periodo') === opening
  }

  function applyCustom(e: FormEvent) {
    e.preventDefault()
    if (!from || !to) { setErr('Escolha as duas datas.'); return }
    const [a, b] = from <= to ? [from, to] : [to, from]
    if (b > today) { setErr('A data final não pode passar de hoje.'); return }
    if (a < minDate) { setErr(`Escolha uma data a partir de ${formatDate(minDate, today)}.`); return }
    // Same day count as lib/engine/dates daysBetween (inclusive, UTC dates).
    const days = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1
    if (days > maxDays) { setErr(`No máximo ${maxDays} dias por vez.`); return }
    setErr(null)
    const base = new URLSearchParams(customBase.startsWith('?') ? customBase.slice(1) : customBase)
    base.set('periodo', 'custom'); base.set('de', a); base.set('ate', b)
    go('custom', mergeQuery(`?${base.toString()}`, ''))
  }

  const inMore = more.find(m => m.key === current)
  // A period only a link can carry (?periodo=90d) still names itself here.
  const offMenu = !inMore && current !== 'custom' && !main.some(m => m.key === current)
    ? PERIODS.find(p => p.key === current)?.short ?? null
    : null
  const moreLabel = current === 'custom' ? rangeLabel : inMore ? inMore.label : offMenu ?? 'Mais'

  return (
    <div className={s.period}>
      <div className={s.periodSeg} role="group" aria-label="Período">
        {main.map(p => (
          <button key={p.key} type="button" className={s.pBtn} aria-pressed={p.key === current} onClick={() => !isChosen(p) && go(p.key, p.query)}>
            {p.label}
          </button>
        ))}
        <button
          ref={moreBtn}
          type="button"
          className={s.pBtn}
          aria-pressed={!!inMore || !!offMenu || current === 'custom'}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(o => !o)}
        >
          {current === 'custom' && <Icon name="calendar" size={13} />}
          {moreLabel}
          <Icon name="chev" size={12} />
        </button>
      </div>
      {open && (
        // A dialog, not role=menu: it holds a date form, which a menu may not.
        <div ref={menu} id={menuId} role="dialog" aria-label="Mais períodos" className={s.menu}>
          {more.map(p => (
            <button key={p.key} type="button" aria-pressed={p.key === current} className={s.menuItem} onClick={() => go(p.key, p.query)}>
              {p.label}
              {p.key === current && <Icon name="check" size={13} />}
            </button>
          ))}
          <form className={s.custom} onSubmit={applyCustom} aria-label="Escolher datas">
            <label>De<input className={s.dateInput} type="date" value={from} min={minDate} max={today} onChange={e => setFrom(e.target.value)} required /></label>
            <label>Até<input className={s.dateInput} type="date" value={to} min={minDate} max={today} onChange={e => setTo(e.target.value)} required /></label>
            {err && <span className={s.customErr} role="alert">{err}</span>}
            <button type="submit" className={s.apply}>
              Aplicar datas
            </button>
          </form>
        </div>
      )}
      {/* A custom period's label IS its range, already on the "Mais" button:
          printing it again beside it read "[28 out – 3 nov] 28 out – 3 nov". */}
      <span className={current === 'custom' && !pending ? `${s.rangeText} sr-only` : s.rangeText} aria-live="polite">{pending ? 'carregando…' : rangeLabel}</span>
      {pending && <span className={s.spin} aria-hidden="true" />}
      {!pending && partialLabel && <Chip tone="info" icon="clock" size="sm">{partialLabel}</Chip>}
      {!pending && tzNote && <Chip tone="info" size="sm">{tzNote}</Chip>}
    </div>
  )
}
