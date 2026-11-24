'use client'

/**
 * The order reader: every order of the window, searchable by number and
 * filterable, each one opening into the visits Shopify recorded before it.
 *
 * The first page is rendered on the server; more pages come from
 * GET /api/journeys/orders. Rules this component keeps (attribution A4–A6, M2):
 *  - the store is always sent explicitly, and a response for another store
 *    is dropped (the route echoes storeId);
 *  - the page mounts it with key={store:from:to}, so a store or period change
 *    starts a fresh reader instead of keeping the old list;
 *  - pages are keyset-paged (nextCursor) and merged by order id, so orders
 *    arriving while you read never repeat a row;
 *  - every request aborts the one before it and a late answer is ignored, so
 *    the list always matches the chosen filter;
 *  - an error body is never treated as a page: the reader shows the error
 *    and a retry, and keeps what it already had when "carregar mais" fails;
 *  - "carregar mais" uses the search that was applied, not half-typed text;
 *  - dates and hours are the store's clock, as sent by the API (A6).
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { JourneyFilter, JourneyOrder, JourneyPage, JourneyTouch } from '@/lib/attributionModels'
import { JOURNEY_FILTERS } from '@/lib/attributionModels'
import { formatCount, plural } from '@/lib/format'
import { Badge, Button, EmptyState, ErrorState, Icon, Money, Segmented } from '@/components/ui'
import { conversionDelay, formatLocalStamp, landingPath, sourceLabel } from './model'
import s from './JourneyReader.module.css'

const PAGE_SIZE = 30

export interface JourneyReaderProps {
  storeId: string
  from: string
  to: string
  /** Today on the store's clock (adds the year to dates of another year). */
  today: string
  /** The server-rendered first page (filter "Todos"), or null if it failed. */
  initial: JourneyPage | null
}

interface ListState {
  orders: JourneyOrder[]
  total: number
  hasMore: boolean
  cursor: string | null
}

interface Request { filter: JourneyFilter; search: string; cursor: string | null }

const EMPTY_LIST: ListState = { orders: [], total: 0, hasMore: false, cursor: null }

function listOf(page: JourneyPage | null): ListState {
  return page ? { orders: page.orders, total: page.total, hasMore: page.hasMore, cursor: page.nextCursor } : EMPTY_LIST
}

type PageBody = JourneyPage & { storeId: string }

function isPage(v: unknown): v is PageBody {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return Array.isArray(p.orders) && typeof p.total === 'number' && typeof p.hasMore === 'boolean'
    && (p.nextCursor === null || typeof p.nextCursor === 'string') && typeof p.storeId === 'string'
}

function errorText(status: number, body: unknown): string {
  if (status === 401) return 'Sua sessão terminou. Entre de novo para ver os pedidos.'
  if (status === 404) return 'Esta loja não está disponível para o seu acesso.'
  const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error : null
  if (status === 400) return msg ?? 'O pedido ao servidor veio incompleto.'
  return 'O servidor não respondeu como esperado. Nada foi alterado; tente de novo.'
}

/** Append a page, keeping the first copy of any order already listed. */
function merge(a: JourneyOrder[], b: JourneyOrder[]): JourneyOrder[] {
  const seen = new Set(a.map(o => o.orderId))
  return [...a, ...b.filter(o => !seen.has(o.orderId))]
}

export function JourneyReader({ storeId, from, to, today, initial }: JourneyReaderProps) {
  const [list, setList] = useState<ListState>(() => listOf(initial))
  const [filter, setFilter] = useState<JourneyFilter>('all')
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [busy, setBusy] = useState<'list' | 'more' | null>(null)
  // `list` errors replace the list (it would not match the filter);
  // `more` errors keep it and offer a retry under it.
  const [error, setError] = useState<{ where: 'list' | 'more'; text: string } | null>(
    initial ? null : { where: 'list', text: 'Os pedidos deste período não chegaram. Nada foi alterado; tente de novo.' },
  )
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const seq = useRef(0)
  const ctrl = useRef<AbortController | null>(null)
  const last = useRef<Request>({ filter: 'all', search: '', cursor: null })
  useEffect(() => () => ctrl.current?.abort(), [])

  // Keyboard focus across "Carregar mais". The button is disabled while the
  // page loads (the browser drops focus from it) and unmounts after the last
  // page, so focus fell to <body> and a keyboard or screen-reader user lost
  // their place in a long list. Once the page lands focus goes back to the
  // button while there are more pages, else to the first order the page
  // added (or the count line), or to "Tentar de novo" when it failed.
  const root = useRef<HTMLDivElement>(null)
  const focusAfterMore = useRef<number | null>(null)
  useEffect(() => {
    const firstNew = focusAfterMore.current
    if (firstNew === null || busy !== null) return
    focusAfterMore.current = null
    const el = root.current
    if (!el) return
    const target = error?.where === 'more'
      ? el.querySelector<HTMLElement>('[data-retry-more]')
      : list.hasMore && !error
        ? el.querySelector<HTMLElement>('[data-load-more]')
        : el.querySelectorAll<HTMLElement>('[data-order-btn]')[firstNew] ?? el.querySelector<HTMLElement>('[data-count]')
    target?.focus()
  }, [busy, error, list])

  function loadMore() {
    focusAfterMore.current = list.orders.length
    void load({ filter, search: applied, cursor: list.cursor })
  }

  async function load(req: Request) {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    const id = ++seq.current
    last.current = req
    const where = req.cursor ? 'more' : 'list'
    // A new list (filter, search) replaces a "carregar mais" in flight: its
    // focus move must not land on the new list.
    if (where === 'list') focusAfterMore.current = null
    setBusy(where)
    setError(null)
    try {
      const qs = new URLSearchParams({ store: storeId, from, to, filter: req.filter, limit: String(PAGE_SIZE) })
      if (req.search) qs.set('search', req.search)
      if (req.cursor) qs.set('cursor', req.cursor)
      const r = await fetch(`/api/journeys/orders?${qs}`, { signal: c.signal, cache: 'no-store' })
      const body: unknown = await r.json().catch(() => null)
      if (id !== seq.current) return
      if (!r.ok || !isPage(body) || body.storeId !== storeId) {
        if (where === 'list') setList(EMPTY_LIST)
        setError({ where, text: errorText(r.ok ? 500 : r.status, body) })
        return
      }
      setList(prev => ({
        orders: req.cursor ? merge(prev.orders, body.orders) : body.orders,
        total: body.total,
        hasMore: body.hasMore,
        cursor: body.nextCursor,
      }))
      if (!req.cursor) setOpen(new Set())
    } catch (e) {
      if (id !== seq.current || (e instanceof DOMException && e.name === 'AbortError')) return
      if (where === 'list') setList(EMPTY_LIST)
      setError({ where, text: 'Sem resposta do servidor. Confira a conexão e tente de novo.' })
    } finally {
      if (id === seq.current) setBusy(null)
    }
  }

  function chooseFilter(next: string) {
    const f = JOURNEY_FILTERS.find(x => x.key === next)?.key ?? 'all'
    setFilter(f)
    void load({ filter: f, search: applied, cursor: null })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const digits = input.replace(/\D/g, '')
    setInput(digits)
    setApplied(digits)
    void load({ filter, search: digits, cursor: null })
  }

  function clearSearch() {
    setInput('')
    setApplied('')
    void load({ filter, search: '', cursor: null })
  }

  function toggle(id: string) {
    setOpen(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const filterLabel = JOURNEY_FILTERS.find(f => f.key === filter)?.label.toLowerCase()
  const typedNonDigits = /\D/.test(input)

  return (
    <div className={s.reader} ref={root}>
      <div className={s.toolbar}>
        <Segmented
          ariaLabel="Filtrar pedidos"
          size="sm"
          value={filter}
          onChange={chooseFilter}
          options={JOURNEY_FILTERS.map(f => ({ value: f.key, label: f.label }))}
        />
        <form className={s.search} onSubmit={submit} role="search">
          <label htmlFor={`busca-${storeId}`} className="sr-only">Número do pedido</label>
          <span className={s.searchBox}>
            <Icon name="search" size={14} />
            <input
              id={`busca-${storeId}`}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="nº do pedido"
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              aria-describedby={typedNonDigits ? `busca-dica-${storeId}` : undefined}
            />
            {applied && (
              <button type="button" className={s.clear} onClick={clearSearch} aria-label="Limpar busca">
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
          <Button type="submit" size="sm" disabled={busy === 'list'}>Buscar</Button>
        </form>
      </div>
      {typedNonDigits && <p id={`busca-dica-${storeId}`} className={s.hint}>Só o número conta: letras e símbolos são ignorados na busca.</p>}

      {error?.where !== 'list' && <p className={s.count} aria-live="polite" tabIndex={-1} data-count>
        {busy === 'list' ? 'Carregando pedidos…'
          : <>
            <b className="num">{formatCount(list.total)}</b> {list.total === 1 ? 'pedido' : 'pedidos'}
            {filter !== 'all' ? <> · {filterLabel}</> : null}
            {applied ? <> · número com “{applied}”</> : null}
          </>}
      </p>}

      {error?.where === 'list' ? (
        <ErrorState compact title="Não foi possível carregar os pedidos"
          action={<Button size="sm" icon="refresh" onClick={() => load(last.current)}>Tentar de novo</Button>}>
          {error.text}
        </ErrorState>
      ) : list.orders.length === 0 && busy !== 'list' ? (
        <EmptyState compact icon="ring" title={applied ? `Nenhum pedido com “${applied}” no número` : filter !== 'all' ? 'Nenhum pedido com esse filtro' : 'Nenhum pedido neste período'}>
          {applied ? 'Confira o número ou limpe a busca.'
            : filter !== 'all' ? 'Troque o filtro para ver os outros pedidos do período.'
            : 'A loja não teve pedidos nestas datas; quando tiver, o caminho de cada um aparece aqui.'}
        </EmptyState>
      ) : (
        <ul className={s.list} aria-busy={busy === 'list' || undefined} data-dim={busy === 'list' || undefined}>
          {list.orders.map(o => (
            <OrderRow key={o.orderId} order={o} today={today} isOpen={open.has(o.orderId)} onToggle={() => toggle(o.orderId)} />
          ))}
        </ul>
      )}

      {error?.where === 'more' && (
        <div className={s.moreError} role="alert">
          <Icon name="alert" size={14} />
          <span>{error.text}</span>
          <Button size="sm" variant="ghost" icon="refresh" data-retry-more onClick={() => { focusAfterMore.current = list.orders.length; void load(last.current) }}>Tentar de novo</Button>
        </div>
      )}

      {list.hasMore && !error && busy !== 'list' && (
        <Button className={s.more} pending={busy === 'more'} data-load-more onClick={loadMore}>
          {busy === 'more' ? 'Carregando…' : `Carregar mais · ${formatCount(list.orders.length)} de ${formatCount(list.total)}`}
        </Button>
      )}
    </div>
  )
}

function OrderRow({ order: o, today, isOpen, onToggle }: { order: JourneyOrder; today: string; isOpen: boolean; onToggle: () => void }) {
  const visits = o.momentsCount ?? o.touches.length
  const firstAd = o.touches.find(t => t.adId)
  const delay = conversionDelay(o)
  const panelId = `jornada-${o.orderId}`
  return (
    <li className={s.order}>
      <button type="button" className={s.orderBtn} onClick={onToggle} aria-expanded={isOpen} aria-controls={panelId} data-order-btn>
        <Icon name={isOpen ? 'chev' : 'chevRight'} size={12} className={s.chev} />
        <span className={s.orderNo}>#{o.orderNumber ?? '—'}</span>
        <span className={s.orderTotal}><Money value={o.total} tone="none" /></span>
        <span className={s.orderPath}>
          {visits === 0 ? <span className="mut">sem visitas registradas</span> : plural(visits, 'visita', 'visitas')}
          {delay && visits > 0 ? ` · ${delay}` : ''}
          {firstAd && <span className={s.viaAd}><i aria-hidden="true" />{firstAd.adName ?? 'anúncio de conta não conectada'}</span>}
        </span>
        <span className={s.orderWhen}>{formatLocalStamp(o.createdAt, today)}</span>
      </button>
      {isOpen && (
        <div id={panelId} className={s.panel}>
          {o.touches.length === 0 ? (
            <p className={s.noTouch}>A Shopify não registrou nenhuma visita antes deste pedido (app, link direto de checkout ou navegador que bloqueia).</p>
          ) : (
            <ol className={s.touches}>
              {o.touches.map(t => <TouchRow key={t.seq} t={t} today={today} />)}
            </ol>
          )}
          {o.momentsCount != null && o.momentsCount > o.touches.length && o.touches.length > 0 && (
            <p className={s.partialPath}>Mostrando {formatCount(o.touches.length)} de {formatCount(o.momentsCount)} visitas que a Shopify contou para este pedido.</p>
          )}
        </div>
      )}
    </li>
  )
}

function TouchRow({ t, today }: { t: JourneyTouch; today: string }) {
  const paidNoId = !t.adId && t.utmMedium === 'paid'
  const path = landingPath(t.landingPage)
  return (
    <li className={s.touch} data-kind={t.adId ? 'ad' : paidNoId ? 'paid' : 'other'}>
      <span className={s.dot} aria-hidden="true" />
      <div className={s.touchText}>
        <span className={s.touchTitle}>
          {t.adId ? (t.adName ?? `Anúncio ${t.adId}`) : sourceLabel(t.source)}
          {t.adId && !t.adName && <Badge tone="mut">conta não conectada</Badge>}
          {paidNoId && <Badge tone="warn" icon="alert">pago, sem identificar o anúncio</Badge>}
        </span>
        <span className={s.touchMeta}>
          <span className="num">{formatLocalStamp(t.occurredAtLocal, today)}</span>
          {t.adId && t.source ? ` · ${sourceLabel(t.source)}` : ''}
          {path ? <> · <span className={s.path}>{path}</span></> : null}
        </span>
      </div>
    </li>
  )
}
