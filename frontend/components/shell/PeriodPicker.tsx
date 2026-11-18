'use client'

/**
 * PeriodPicker — Hoje · Ontem · 7 dias · 30 dias, a "Mais" menu (14 dias, Este
 * mês, Mês passado, Escolher datas) and the resolved range ("10–16 nov",
 * "parcial · até 13h38"). It writes ?periodo= (and ?de/?ate for custom) and
 * navigates in a transition with a spinner. Dates are never computed here:
 * every preset's URL and the range label come from the server
 * (lib/views/page.ts, resolved in the store's timezone), so the browser's clock
 * cannot shift a Tokyo store's "hoje".
 *
 * Props (built by AppShell):
 *   main       { key: Period; label: string; query: string }[]  — the four buttons
 *   more       { key: Period; label: string; query: string }[]  — menu items
 *   current    Period
 *   customBase string — ctx.hrefWith('', { periodo: null }); the client adds periodo=custom&de&ate
 *   today      'YYYY-MM-DD' in the anchor timezone (max date of the custom inputs)
 *   range      { from; to } — the resolved window (custom inputs' defaults)
 *   rangeLabel "10–16 nov"
 *   partialLabel "parcial · até 13h38" | null
 *   tzNote     "dia de Tóquio" | null — shown when the window is on another calendar
 */

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react'
import { PERIODS, type Period } from '@/lib/engine/dates'
import { Icon } from '@/components/ui/Icon'
import { Chip } from '@/components/ui/Chip'
import { hrefFor, mergeQuery } from './url'
import s from './shell.module.css'

export interface PeriodOption { key: Period; label: string; query: string }

export interface PeriodPickerProps {
  main: PeriodOption[]
  more: PeriodOption[]
  current: Period
  customBase: string
  today: string
  range: { from: string; to: string }
  rangeLabel: string
  partialLabel: string | null
  tzNote?: string | null
}

export function PeriodPicker({ main, more, current, customBase, today, range, rangeLabel, partialLabel, tzNote }: PeriodPickerProps) {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const [pending, startTransition] = useTransition()
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

  const go = (query: string) => {
    setOpen(false)
    startTransition(() => { router.push(hrefFor(pathname, query)) })
  }

  function applyCustom(e: FormEvent) {
    e.preventDefault()
    if (!from || !to) { setErr('Escolha as duas datas.'); return }
    const [a, b] = from <= to ? [from, to] : [to, from]
    if (b > today) { setErr('A data final não pode passar de hoje.'); return }
    setErr(null)
    const base = new URLSearchParams(customBase.startsWith('?') ? customBase.slice(1) : customBase)
    base.set('periodo', 'custom'); base.set('de', a); base.set('ate', b)
    go(mergeQuery(`?${base.toString()}`, ''))
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
          <button key={p.key} type="button" className={s.pBtn} aria-pressed={p.key === current} onClick={() => p.key !== current && go(p.query)}>
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
            <button key={p.key} type="button" aria-pressed={p.key === current} className={s.menuItem} onClick={() => go(p.query)}>
              {p.label}
              {p.key === current && <Icon name="check" size={13} />}
            </button>
          ))}
          <form className={s.custom} onSubmit={applyCustom} aria-label="Escolher datas">
            <label>De<input className={s.dateInput} type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} required /></label>
            <label>Até<input className={s.dateInput} type="date" value={to} max={today} onChange={e => setTo(e.target.value)} required /></label>
            {err && <span className={s.customErr} role="alert">{err}</span>}
            <button type="submit" className={s.apply}>
              Aplicar datas
            </button>
          </form>
        </div>
      )}
      <span className={s.rangeText} aria-live="polite">{pending ? 'carregando…' : rangeLabel}</span>
      {pending && <span className={s.spin} aria-hidden="true" />}
      {!pending && partialLabel && <Chip tone="info" icon="clock" size="sm">{partialLabel}</Chip>}
      {!pending && tzNote && <Chip tone="info" size="sm">{tzNote}</Chip>}
    </div>
  )
}
