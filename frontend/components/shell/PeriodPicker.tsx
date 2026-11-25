'use client'

/**
 * PeriodPicker — the one menu of lib/period (MENU, R7): Hoje · Ontem · 7 dias ·
 * 30 dias, and "Mais" with 14 dias, 90 dias, Este mês, Mês passado and
 * Escolher datas, plus the resolved range ("10–16 nov", "parcial · até
 * 13h38"). A preset travels as a preset: no dates are computed here, the
 * server resolves them on the screen's clock. A pick is laid over the latest
 * requested URL at click time (lib/period layer, R13), so a store picked a
 * moment before is kept. The date form refuses invalid input with the same
 * check as the phone (lib/period checkPickedDates).
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
 * Props (built by AppShell from ctx.resolution):
 *   current    PeriodValue — the selection's period, AS ASKED (a fitted dates
 *              value still presses "Mais" with its own dates, R7)
 *   today      'YYYY-MM-DD' — the shown clock's today (max of the date inputs)
 *   range      { from; to } — the window shown (date inputs' defaults)
 *   rangeLabel "10–16 nov"
 *   partialLabel "parcial · até 13h38" | null
 *   tzNote     "dia de Tóquio" | null
 *   archivedIds the viewer's archived stores (lib/period layer)
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { checkPickedDates, datesButton, datesButtonYear, MENU, periodKey, pickerDates, presetInfo, preset, samePeriod, selectionFromUrl, type PeriodValue, type Preset } from '@/lib/period'
import { Icon } from '@/components/ui/Icon'
import { Chip } from '@/components/ui/Chip'
import { inFlightParam, latestHref, layered } from './url'
import { useShellNavigation } from './useShellNavigation'
import s from './shell.module.css'

/** Cancelable window event sent before the picker opens another period. */
export const BEFORE_PERIOD_CHANGE = 'opero:before-period-change'

export interface BeforePeriodChangeDetail {
  /** The period shown now ('custom' for dates). */
  from: string
  /** The period about to open ('custom' for picked dates). */
  to: string
  /** The path + query the picker would open. */
  href: string
}

export interface PeriodPickerProps {
  current: PeriodValue
  today: string
  range: { from: string; to: string }
  rangeLabel: string
  partialLabel: string | null
  tzNote?: string | null
  archivedIds?: readonly string[]
}

const keyOf = (v: PeriodValue) => (v.kind === 'preset' ? v.preset : 'custom')
export function PeriodPicker({ current, today, range, rangeLabel, partialLabel, tzNote, archivedIds = [] }: PeriodPickerProps) {
  const nav = useShellNavigation()
  const pending = nav.pending
  const [open, setOpen] = useState(false)
  // The form starts from what was ASKED (R7: header, picker and note never
  // disagree): a dates value keeps its own end even when the screen shows it
  // cut to today (future_end); a preset starts from the window shown.
  const start = pickerDates(current, range, today)
  const [from, setFrom] = useState(start.from)
  const [to, setTo] = useState(start.to)
  const [err, setErr] = useState<string | null>(null)
  const menuId = useId()
  const moreBtn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // A new selection or window from the server resets the custom inputs (derived during render).
  const shownKey = `${periodKey(current)}|${range.from}|${range.to}|${today}`
  const [shownRange, setShownRange] = useState(shownKey)
  if (shownRange !== shownKey) { setShownRange(shownKey); setFrom(start.from); setTo(start.to) }

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

  // Laid over the latest REQUESTED URL at click time (R13).
  const go = (period: PeriodValue) => {
    setOpen(false)
    const href = layered({ kind: 'period', period }, archivedIds)
    const detail: BeforePeriodChangeDetail = { from: keyOf(current), to: keyOf(period), href }
    if (!window.dispatchEvent(new CustomEvent(BEFORE_PERIOD_CHANGE, { detail, cancelable: true }))) return
    nav.push(href)
  }

  // The period already chosen: the one on screen or, while another choice is
  // loading, the one being opened (clicking the period on screen then takes
  // the choice back).
  const chosen = (): PeriodValue => (inFlightParam('loja') === undefined ? current : selectionFromUrl(latestHref()).selection?.period ?? current)
  const isChosen = (p: Preset) => samePeriod(chosen(), preset(p))

  function applyCustom(e: FormEvent) {
    e.preventDefault()
    const r = checkPickedDates(from, to, start.max)
    if (!r.ok) { setErr(r.error); return }
    setErr(null)
    go(r.value)
  }

  const inMore = current.kind === 'preset' && MENU.more.includes(current.preset)
  const isMain = (p: Preset) => current.kind === 'preset' && current.preset === p
  const moreLabel = current.kind === 'dates' ? datesButton(current) : inMore ? presetInfo((current as { preset: Preset }).preset).label : 'Mais'
  // R7: the year of a dates value, when needed, on a second line (the same
  // function resolve() names buttonYear with): "30/12–30/12" over "2025–26".
  const moreYear = current.kind === 'dates' ? datesButtonYear(current, today) : null

  return (
    <div className={s.period}>
      <div className={s.periodSeg} role="group" aria-label="Período">
        {MENU.main.map(p => (
          <button key={p} type="button" className={s.pBtn} aria-pressed={isMain(p)} onClick={() => !isChosen(p) && go(preset(p))}>
            {presetInfo(p).button}
          </button>
        ))}
        <button
          ref={moreBtn}
          type="button"
          className={s.pBtn}
          aria-pressed={inMore || current.kind === 'dates'}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(o => !o)}
        >
          {current.kind === 'dates' && <Icon name="calendar" size={13} />}
          {moreYear
            ? <span className={s.pBtnStack}><span>{moreLabel}</span><span className={s.pBtnYear}>{moreYear}</span></span>
            : moreLabel}
          <Icon name="chev" size={12} />
        </button>
      </div>
      {open && (
        // A dialog, not role=menu: it holds a date form, which a menu may not.
        <div ref={menu} id={menuId} role="dialog" aria-label="Mais períodos" className={s.menu}>
          {MENU.more.map(p => (
            <button key={p} type="button" aria-pressed={isMain(p)} className={s.menuItem} onClick={() => go(preset(p))}>
              {presetInfo(p).label}
              {isMain(p) && <Icon name="check" size={13} />}
            </button>
          ))}
          <form className={s.custom} onSubmit={applyCustom} aria-label="Escolher datas">
            <label>De<input className={s.dateInput} type="date" value={from} min="2000-01-01" max={start.max} onChange={e => setFrom(e.target.value)} required /></label>
            <label>Até<input className={s.dateInput} type="date" value={to} min="2000-01-01" max={start.max} onChange={e => setTo(e.target.value)} required /></label>
            {err && <span className={s.customErr} role="alert">{err}</span>}
            <button type="submit" className={s.apply}>
              Aplicar datas
            </button>
          </form>
        </div>
      )}
      {/* A dates period names its range on the "Mais" button already. */}
      <span className={current.kind === 'dates' && !pending ? `${s.rangeText} sr-only` : s.rangeText} aria-live="polite">{pending ? 'carregando…' : rangeLabel}</span>
      {pending && <span className={s.spin} aria-hidden="true" />}
      {!pending && partialLabel && <Chip tone="info" icon="clock" size="sm">{partialLabel}</Chip>}
      {!pending && tzNote && <Chip tone="info" size="sm">{tzNote}</Chip>}
    </div>
  )
}
