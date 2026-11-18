'use client'

/** Header, store chips, period bar and the status strips of the phone. */

import { useEffect, useRef } from 'react'
import { Icon, StatusDot } from '@/components/ui'
import { formatRangeLabel, formatRelativeTime } from '@/lib/format'
import type { MobileResponse, MobileStoreOption } from '@/lib/views/mobile'
import { ALL, PERIOD_MAIN, periodShort, type Selection } from '../_lib/selection'
import { refreshProgress, skippedText, SOURCE_LABEL } from '../_lib/refreshProgress'
import type { RefreshRun } from '../_lib/useMobileData'
import { SoundIcon } from './Sheet'
import { splitName } from './Home'
import s from '../m.module.css'

// ─── Header ───────────────────────────────────────────────────────────────────

export function Header({ data, now, soundOn, onSound, onRefresh, refreshing, refreshDisabled, onSettings, settingsAlert }: {
  data: MobileResponse | null
  now: number
  soundOn: boolean
  onSound: () => void
  onRefresh: () => void
  refreshing: boolean
  refreshDisabled: boolean
  onSettings: () => void
  settingsAlert: boolean
}) {
  const f = data?.freshness
  const failing = !!f?.staleStores.some(x => x.failing)
  const stale = !!f?.staleStores.length
  const state = !f ? 'unknown' : failing ? 'failing' : stale ? 'stale' : 'ok'
  const when = f?.oldestSuccessAt && now ? formatRelativeTime(f.oldestSuccessAt, new Date(now)) : null
  const title = f?.staleStores.length
    ? `Atrasadas: ${f.staleStores.map(x => x.name).join(', ')}`
    : 'Hora da sincronização mais antiga entre as lojas na tela'
  return (
    <header className={s.header}>
      <div className={s.brand}>
        <span className={s.brandMark} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="2.4" /><path d="M10 3.8a6.2 6.2 0 0 1 6.2 6.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </span>
        <span className={s.brandName}>Opero</span>
      </div>
      <div className={s.headRight}>
        {when && (
          <span className={s.fresh} title={title}>
            <StatusDot state={state}>{stale ? `atrasado · ${when}` : when}</StatusDot>
          </span>
        )}
        <button type="button" className={s.iconBtn} aria-pressed={soundOn} onClick={onSound}
          aria-label={soundOn ? 'Som de venda ligado. Desligar' : 'Som de venda desligado. Ligar'}>
          <SoundIcon on={soundOn} />
        </button>
        <button type="button" className={s.iconBtn} onClick={onRefresh} disabled={refreshing || refreshDisabled}
          aria-label={refreshDisabled ? 'Loja arquivada: não sincroniza' : refreshing ? 'Atualizando' : 'Atualizar as lojas na tela'}>
          {refreshing ? <span className={s.spin} aria-hidden="true" /> : <Icon name="refresh" size={17} />}
        </button>
        <button type="button" className={s.iconBtn} onClick={onSettings} aria-label={`Ajustes deste aparelho${settingsAlert ? ' (notificações desativadas)' : ''}`}>
          <Icon name="bell" size={17} />
          {settingsAlert && <span className={s.badgeDot} aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}

// ─── Store chips ──────────────────────────────────────────────────────────────

export function StoreChips({ stores, archived, sel, pendingKey, onPick }: {
  stores: MobileStoreOption[]
  archived: MobileStoreOption[]
  sel: Selection | null
  /** The store being loaded right now (spinner in its chip). */
  pendingKey: string | null
  onPick: (loja: string) => void
}) {
  const archivedSel = sel ? archived.find(a => a.id === sel.loja) : undefined
  const row = useRef<HTMLDivElement>(null)
  const selected = sel?.loja ?? null
  // Keep the pinned store's chip in view: opened from storage or a
  // notification, Hibikura sits past the right edge and nothing looked pinned.
  // Only the row scrolls (scrollIntoView would also move the page).
  useEffect(() => {
    const el = row.current
    const on = el?.querySelector<HTMLElement>('button[aria-pressed="true"]')
    if (!el || !on) return
    const left = on.offsetLeft // .chips is position:relative, so this is within the row
    if (left < el.scrollLeft || left + on.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, left - (el.clientWidth - on.offsetWidth) / 2), behavior: 'smooth' })
    }
  }, [selected])
  const chip = (id: string, label: React.ReactNode, extra = '') => {
    const on = sel?.loja === id
    return (
      <button key={id} type="button" className={`${s.chip}${on ? ` ${s.chipOn}` : ''}${extra}`} aria-pressed={on} onClick={() => onPick(id)}>
        {on && pendingKey === id && <span className={s.spin} aria-hidden="true" style={{ width: 11, height: 11 }} />}
        {label}
      </button>
    )
  }
  const name = sel ? (sel.loja === ALL ? 'Todas' : [...stores, ...archived].find(x => x.id === sel.loja)?.name) : null
  return (
    <>
      <div ref={row} className={s.chips} role="group" aria-label="Loja">
        {chip(ALL, 'Todas')}
        {stores.map(st => {
          const [main, code] = splitName(st.name)
          return chip(st.id, <>{main}{code && <small>{code}</small>}</>)
        })}
        {archivedSel && chip(archivedSel.id, <>{archivedSel.name}<small>arquivada</small></>, ` ${s.chipArchived}`)}
      </div>
      <p className={s.pin}>
        <Icon name="pin" size={13} />
        {name ? <span>Fixado em <b>{name}</b> até você escolher outra loja</span> : <span>Abrindo a última loja escolhida…</span>}
      </p>
    </>
  )
}

// ─── Period bar ───────────────────────────────────────────────────────────────

export function PeriodBar({ sel, today, onPick, onMore }: {
  sel: Selection | null
  today: string | undefined
  onPick: (p: Selection['periodo']) => void
  onMore: () => void
}) {
  const inMain = !!sel && (PERIOD_MAIN as string[]).includes(sel.periodo)
  const moreLabel = !sel || inMain ? 'Mais'
    : sel.periodo === 'custom' && sel.de && sel.ate ? formatRangeLabel({ from: sel.de, to: sel.ate }, today) : periodShort(sel.periodo)
  return (
    <div className={s.periods} role="group" aria-label="Período">
      {PERIOD_MAIN.map(p => (
        <button key={p} type="button" className={s.periodBtn} aria-pressed={sel?.periodo === p} onClick={() => onPick(p)}>
          {periodShort(p)}
        </button>
      ))}
      <button type="button" className={s.periodBtn} aria-pressed={!!sel && !inMain} aria-haspopup="dialog" onClick={onMore}>
        {moreLabel}<Icon name="chev" size={12} />
      </button>
    </div>
  )
}

// ─── Strips ───────────────────────────────────────────────────────────────────

export function Strip({ tone, icon, spin, children, onClose, closeLabel }: {
  tone: 'info' | 'warn' | 'neg' | 'ok'
  icon?: 'alert' | 'info' | 'check' | 'clock'
  spin?: boolean
  children: React.ReactNode
  onClose?: () => void
  closeLabel?: string
}) {
  const cls = { info: s.stripInfo, warn: s.stripWarn, neg: s.stripNeg, ok: s.stripOk }[tone]
  return (
    <div className={`${s.strip} ${cls}`} role={tone === 'neg' ? 'alert' : 'status'}>
      {spin ? <span className={`${s.spin} ${s.stripIcon}`} aria-hidden="true" /> : <span className={s.stripIcon}><Icon name={icon ?? 'info'} size={15} /></span>}
      <div>{children}</div>
      {onClose ? <button type="button" className={s.stripClose} onClick={onClose} aria-label={closeLabel ?? 'Fechar aviso'}><Icon name="x" size={14} /></button> : <span />}
    </div>
  )
}

export function RefreshStrip({ run, onClose, onRetry }: { run: RefreshRun; onClose: () => void; onRetry: () => void }) {
  if (run.phase === 'idle') return null
  if (run.phase === 'starting') return <Strip tone="info" spin>Pedindo a atualização das lojas na tela…</Strip>
  if (run.phase === 'error') {
    return (
      <Strip tone="neg" icon="alert" onClose={onClose}>
        Não deu para atualizar: {run.message}. <button type="button" className={s.linkBtn} onClick={onRetry}>Tentar de novo</button>
      </Strip>
    )
  }
  const p = refreshProgress(run.launched, run.status)
  const skipped = skippedText(run.skipped)
  const names = run.stores.length === 1 ? run.stores[0].name : `${run.stores.length} lojas`
  if (run.phase === 'running') {
    return (
      <Strip tone="info" spin>
        Atualizando {names} · {p.done} de {p.total} {p.total === 1 ? 'busca concluída' : 'buscas concluídas'}
        <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label="Progresso da atualização">
          <div className={s.barFill} style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
        </div>
        <ul className={s.lines}>
          {p.lines.map(l => (
            <li key={`${l.storeId}:${l.source}`}>
              <span>{run.stores.length > 1 ? `${l.name} · ` : ''}{SOURCE_LABEL[l.source]}</span>
              <span>{l.state === 'ok' ? '✓ pronto' : l.state === 'erro' ? 'falhou' : l.state === 'rodando' ? 'buscando…' : 'na fila'}</span>
            </li>
          ))}
        </ul>
        {skipped && <small>{skipped}</small>}
      </Strip>
    )
  }
  return (
    <Strip tone={p.failed.length ? 'warn' : 'ok'} icon={p.failed.length ? 'alert' : 'check'} onClose={onClose}>
      {p.total === 0 ? (run.message ?? 'Nada para buscar agora') : p.failed.length
        ? `Atualizado, com falha em: ${p.failed.map(l => `${l.name} (${SOURCE_LABEL[l.source]})`).join(', ')}. Os números dessas lojas podem estar atrasados.`
        : `${names} ${run.stores.length === 1 ? 'atualizada' : 'atualizadas'} · números recarregados.`}
      {run.message && p.total > 0 && <small>{run.message}</small>}
      {skipped && <small>{skipped}</small>}
    </Strip>
  )
}
