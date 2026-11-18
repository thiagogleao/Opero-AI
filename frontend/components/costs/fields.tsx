'use client'

/**
 * Inputs of the cost screen. Controlled only (value + onChange): nothing here
 * keeps its own copy of a value, so a row that moves or is deleted can never
 * leave a stale value on screen.
 *
 * Field messages come from MessagesContext, keyed by the stable field keys of
 * form.ts ("cogs.price_tiers#t3.order_prices.2"), so a message follows its row.
 *
 * ReadOnlyContext turns the whole screen into a view (an archived store is for
 * consultation only): values stay visible and searchable, inputs cannot
 * change, and the controls that only add or remove (pickers, ×, "Adicionar…")
 * are not rendered.
 */

import { createContext, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui'
import s from './costs.module.css'

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface Messages {
  errors: Map<string, string[]>
  warnings: Map<string, string[]>
}

const EMPTY: Messages = { errors: new Map(), warnings: new Map() }
export const MessagesContext = createContext<Messages>(EMPTY)

export function useMessages(...keys: string[]): { errors: string[]; warnings: string[] } {
  const m = useContext(MessagesContext)
  return {
    errors: keys.flatMap(k => m.errors.get(k) ?? []),
    warnings: keys.flatMap(k => m.warnings.get(k) ?? []),
  }
}

/** Every message whose key starts with `prefix` (a whole row or card). */
export function usePrefixMessages(prefix: string): { errors: string[]; warnings: string[] } {
  const m = useContext(MessagesContext)
  const pick = (map: Map<string, string[]>) => [...map.entries()].filter(([k]) => k === prefix || k.startsWith(`${prefix}.`)).flatMap(([, v]) => v)
  return { errors: pick(m.errors), warnings: pick(m.warnings) }
}

export function Msgs({ errors, warnings, id }: { errors: string[]; warnings?: string[]; id?: string }) {
  if (!errors.length && !warnings?.length) return null
  return (
    <div id={id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {errors.map((e, i) => <span key={`e${i}`} className={`${s.msg} ${s.msgErr}`} role="alert"><Icon name="alert" size={12} />{e}</span>)}
      {warnings?.map((w, i) => <span key={`w${i}`} className={`${s.msg} ${s.msgWarn}`}><Icon name="alert" size={12} />{w}</span>)}
    </div>
  )
}

// ─── Read-only (archived store) ─────────────────────────────────────────────

export const ReadOnlyContext = createContext(false)

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext)
}

/** Renders its children only when the screen can be edited (add/remove controls). */
export function EditOnly({ children }: { children: ReactNode }) {
  const ro = useContext(ReadOnlyContext)
  return ro ? null : <>{children}</>
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

interface BaseProps {
  /** Field key(s) whose messages belong to this input. */
  k?: string | string[]
  label?: ReactNode
  hint?: ReactNode
  /** Accessible name when there is no visible label (rows). */
  ariaLabel?: string
  small?: boolean
  /** Mark the box red but leave the messages to the row (one list per row). */
  quiet?: boolean
}

const keysOf = (k?: string | string[]) => (k === undefined ? [] : Array.isArray(k) ? k : [k])

function Shell({ id, label, hint, msgsId, errors, warnings, quiet, children }: {
  id: string; label?: ReactNode; hint?: ReactNode; msgsId: string; errors: string[]; warnings: string[]; quiet?: boolean; children: ReactNode
}) {
  return (
    <div className={s.field}>
      {label && <label htmlFor={id} className={s.fieldLabel}>{label}</label>}
      {children}
      {hint && !errors.length && <span className={s.fieldHint}>{hint}</span>}
      {!quiet && <Msgs id={msgsId} errors={errors} warnings={warnings} />}
    </div>
  )
}

/** A number typed as text ("2,9"), with a $ or % or unit beside it. */
export function NumField({ value, onChange, prefix, suffix, placeholder, k, label, hint, ariaLabel, small, width, quiet }: BaseProps & {
  value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; placeholder?: string; width?: number | string
}) {
  const id = useId()
  const ro = useReadOnly()
  const { errors, warnings } = useMessages(...keysOf(k))
  return (
    <Shell id={id} label={label} hint={hint} msgsId={`${id}-m`} errors={errors} warnings={warnings} quiet={quiet}>
      <div className={`${s.box} ${errors.length ? s.boxErr : ''} ${small ? s.boxSm : ''}`} style={width ? { width } : undefined}>
        {prefix && <span className={s.affix} aria-hidden="true">{prefix}</span>}
        <input
          id={id}
          className={`${s.input} ${s.num}`}
          inputMode="decimal"
          autoComplete="off"
          readOnly={ro}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={errors.length ? true : undefined}
          aria-describedby={errors.length || warnings.length ? `${id}-m` : undefined}
          onChange={e => onChange(e.target.value)}
        />
        {suffix && <span className={`${s.affix} ${s.affixR}`} aria-hidden="true">{suffix}</span>}
      </div>
    </Shell>
  )
}

export function TextField({ value, onChange, placeholder, k, label, hint, ariaLabel, small, maxLength, upper, mono, quiet }: BaseProps & {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; upper?: boolean; mono?: boolean
}) {
  const id = useId()
  const ro = useReadOnly()
  const { errors, warnings } = useMessages(...keysOf(k))
  return (
    <Shell id={id} label={label} hint={hint} msgsId={`${id}-m`} errors={errors} warnings={warnings} quiet={quiet}>
      <div className={`${s.box} ${errors.length ? s.boxErr : ''} ${small ? s.boxSm : ''}`}>
        <input
          id={id}
          className={s.input}
          style={mono ? { fontFamily: 'var(--mono)' } : undefined}
          readOnly={ro}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={errors.length ? true : undefined}
          aria-describedby={errors.length || warnings.length ? `${id}-m` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={e => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
        />
      </div>
    </Shell>
  )
}

export function DateField({ value, onChange, k, label, hint, ariaLabel, small, quiet }: BaseProps & { value: string; onChange: (v: string) => void }) {
  const id = useId()
  const ro = useReadOnly()
  const { errors, warnings } = useMessages(...keysOf(k))
  return (
    <Shell id={id} label={label} hint={hint} msgsId={`${id}-m`} errors={errors} warnings={warnings} quiet={quiet}>
      <div className={`${s.box} ${errors.length ? s.boxErr : ''} ${small ? s.boxSm : ''}`}>
        <input
          id={id}
          type="date"
          className={`${s.input} ${s.date}`}
          readOnly={ro}
          value={value}
          aria-label={ariaLabel}
          aria-invalid={errors.length ? true : undefined}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </Shell>
  )
}

export function SelectField<T extends string>({ value, onChange, options, k, label, ariaLabel, small, quiet }: BaseProps & {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  const id = useId()
  const ro = useReadOnly()
  const { errors, warnings } = useMessages(...keysOf(k))
  return (
    <Shell id={id} label={label} msgsId={`${id}-m`} errors={errors} warnings={warnings} quiet={quiet}>
      <div className={`${s.box} ${errors.length ? s.boxErr : ''} ${small ? s.boxSm : ''}`}>
        <span className={s.selectWrap}>
          <select id={id} className={s.select} value={value} disabled={ro} aria-label={ariaLabel} onChange={e => onChange(e.target.value as T)}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Icon name="chev" size={13} />
        </span>
      </div>
    </Shell>
  )
}

// ─── Countries ────────────────────────────────────────────────────────────────

let regionNames: Intl.DisplayNames | null | undefined
/** "DE" → "Alemanha"; null for an incomplete or unknown code. */
export function countryName(code: string): string | null {
  const cc = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return null
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' }) } catch { regionNames = null }
  }
  try {
    const n = regionNames?.of(cc)
    return n && n !== cc ? n : null
  } catch {
    return null
  }
}

/** Two-letter code input with the country's name beside it. */
export function CountryField({ value, onChange, k, ariaLabel, small }: BaseProps & { value: string; onChange: (v: string) => void }) {
  const id = useId()
  const ro = useReadOnly()
  const { errors } = useMessages(...keysOf(k))
  return (
    <div className={s.field}>
      <div className={`${s.box} ${errors.length ? s.boxErr : ''} ${small ? s.boxSm : ''}`} title={countryName(value) ?? undefined}>
        <input
          id={id}
          className={s.input}
          style={{ fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.04em' }}
          value={value}
          maxLength={2}
          readOnly={ro}
          placeholder="US"
          aria-label={ariaLabel ?? 'País (2 letras)'}
          aria-invalid={errors.length ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={e => onChange(e.target.value.toUpperCase())}
        />
      </div>
    </div>
  )
}

// ─── Products ─────────────────────────────────────────────────────────────────

export interface CatalogueItem {
  id: string
  title: string
  /** Shopify status ('active', 'draft', 'archived'), or null for a product
   *  that is only in the saved settings. */
  status: string | null
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Search the catalogue by title or id, ignoring accents and case. */
export function searchCatalogue(items: CatalogueItem[], q: string, exclude: Set<string> = new Set(), limit = 8): CatalogueItem[] {
  const t = norm(q.trim())
  const pool = items.filter(i => !exclude.has(i.id))
  if (!t) return pool.slice(0, limit)
  return pool.filter(i => norm(i.title).includes(t) || i.id.includes(t)).slice(0, limit)
}

/** A search box that adds a product: type, pick with ↑/↓ and Enter, or click. */
export function ProductPicker({ catalogue, exclude, onPick, placeholder = 'Buscar produto pelo nome ou ID…', ariaLabel }: {
  catalogue: CatalogueItem[]; exclude?: string[]; onPick: (id: string) => void; placeholder?: string; ariaLabel?: string
}) {
  const id = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const ex = useMemo(() => new Set(exclude ?? []), [exclude])
  const results = useMemo(() => searchCatalogue(catalogue, q, ex), [catalogue, q, ex])
  const pick = (pid: string) => { onPick(pid); setQ(''); setActive(0) }
  const ro = useReadOnly()

  // Its only job is adding a product.
  if (ro) return null
  return (
    <div
      className={s.picker}
      ref={box}
      onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
    >
      <div className={`${s.box} ${s.boxSm}`}>
        <span className={s.affix} aria-hidden="true"><Icon name="search" size={13} /></span>
        <input
          className={s.input}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-label={ariaLabel ?? placeholder}
          aria-activedescendant={open && results[active] ? `${id}-o-${results[active].id}` : undefined}
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) pick(results[active].id) }
            else if (e.key === 'Escape') { setOpen(false) }
          }}
        />
      </div>
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className={s.pickList}>
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${id}-o-${r.id}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              className={s.pickItem}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(r.id)}
            >
              <span>{r.title}{r.status && r.status !== 'active' ? ' · fora de venda' : ''}</span>
              <small>{r.id}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Removable product chips. */
export function ProductChips({ ids, nameOf, onRemove, empty }: {
  ids: string[]; nameOf: (id: string) => string; onRemove: (id: string) => void; empty?: ReactNode
}) {
  const ro = useReadOnly()
  if (!ids.length) return empty ? <div className={s.empty}>{empty}</div> : null
  return (
    <div className={s.chips}>
      {ids.map(id => (
        <span key={id} className={s.pchip} title={id}>
          <span>{nameOf(id)}</span>
          {!ro && <button type="button" aria-label={`Tirar ${nameOf(id)}`} onClick={() => onRemove(id)}><Icon name="x" size={11} /></button>}
        </span>
      ))}
    </div>
  )
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  const ro = useReadOnly()
  // An empty cell keeps the row grid aligned.
  if (ro) return <span aria-hidden="true" />
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={s.remove}
    >
      <Icon name="x" size={13} />
    </button>
  )
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const ro = useReadOnly()
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} disabled={ro} onChange={e => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

export function Radio<T extends string>({ name, value, current, onChange, children }: {
  name: string; value: T; current: T; onChange: (v: T) => void; children: ReactNode
}) {
  const ro = useReadOnly()
  return (
    <label className={s.check}>
      <input type="radio" name={name} checked={current === value} disabled={ro} onChange={() => onChange(value)} />
      {children}
    </label>
  )
}
