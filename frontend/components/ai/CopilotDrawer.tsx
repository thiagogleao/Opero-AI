'use client'

/**
 * CopilotDrawer — the right-side panel of the Copilot. A view over
 * useCopilotChat (state lives in CopilotLauncher, so closing the drawer never
 * loses an answer that is still streaming).
 *
 * Non-modal: the page stays readable and usable beside it (to check a number
 * the answer cites). Esc or ✕ closes it and focus goes back to the button.
 * The message list is the only thing that scrolls, and only while the reader
 * is at its bottom: nothing here ever moves the page (AI22: the old chat
 * called scrollIntoView on every token and dragged the whole dashboard).
 */

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'
import { Button, Callout, EmptyState } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Icon } from '@/components/ui/Icon'
import { formatDate, formatRangeLabel } from '@/lib/format'
import { MAX_QUESTION_CHARS, type AssistantTurn, type ToolActivity } from './chatModel'
import { SafeMarkdown } from './SafeMarkdown'
import { cachedStores, loadStores, type StoreChoice } from './stores'
import type { ChatReset, CopilotChat } from './useCopilotChat'
import s from './Copilot.module.css'

type StoresState =
  | { status: 'idle' | 'loading' }
  | { status: 'ok'; stores: StoreChoice[] }
  | { status: 'error' }

interface Props {
  id: string
  chat: CopilotChat
  /** The store of the page; null on "Todas" (the drawer asks which store). */
  pageStoreId: string | null
  from: string
  to: string
  split: boolean
  onClose: () => void
  /** Opened by a click (focus the question box); false when it reopens by
   *  itself after a page change (focus stays where the page put it). */
  autoFocus: boolean
}

function suggestions(from: string, to: string): string[] {
  const window = from === to ? `em ${formatDate(from)}` : `de ${formatRangeLabel({ from, to })}`
  return [
    `Como foi o lucro ${window} e por quê?`,
    'Hoje está melhor que ontem até esta hora?',
    'Quais anúncios estão queimando dinheiro nos últimos 7 dias?',
    'Quais os produtos mais vendidos da semana?',
    'Quais países vendem de verdade (pedidos da Shopify)?',
  ]
}

function resetText(r: ChatReset, fromName: string | null, toName: string | null, split: boolean): string {
  const from = fromName ? ` sobre ${fromName}` : ''
  if (r.kind === 'store') {
    return `A loja mudou${toName ? ` para ${toName}` : ''}. A conversa${from} foi encerrada para não misturar os números de duas lojas.`
  }
  return `A visão de sócio (50%) foi ${split ? 'ligada' : 'desligada'}. A conversa${from} recomeçou para as respostas usarem a parte certa do lucro.`
}

const NEAR_BOTTOM_PX = 48

export function CopilotDrawer({ id, chat, pageStoreId, from, to, split, onClose, autoFocus }: Props) {
  const titleId = useId()
  const inputId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Follow new text only while the reader is at the bottom of the list.
  const stick = useRef(true)
  const [draft, setDraft] = useState('')
  const [stores, setStores] = useState<StoresState>(() => {
    const c = cachedStores()
    return c ? { status: 'ok', stores: c } : { status: 'loading' }
  })
  const fetchStores = (force: boolean) => loadStores(force).then(
    list => setStores({ status: 'ok', stores: list }),
    () => setStores({ status: 'error' }),
  )
  // Names for the header and the chooser on "Todas" (cached for the page load).
  useEffect(() => { void fetchStores(false) }, [])

  const list = stores.status === 'ok' ? stores.stores : []
  const storeName = list.find(x => x.id === chat.storeId)?.name ?? chat.storeName ?? null
  const turns = chat.turns
  const last = turns[turns.length - 1]

  useEffect(() => {
    if (!autoFocus) return
    // The question box, or on "Todas" without a store yet, the store chooser.
    // The chooser is disabled while the store list loads, and a disabled
    // control takes no focus: then the panel itself takes it, so a keyboard
    // user is inside the Copilot, not left on the page.
    const select = rootRef.current?.querySelector('select')
    const target: HTMLElement | null | undefined = inputRef.current && !inputRef.current.disabled
      ? inputRef.current
      : select && !select.disabled ? select : rootRef.current
    target?.focus({ preventScroll: true })
    // Only when the drawer mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc closes while the reader is in the Copilot (or nowhere in particular),
  // unless something inside (a tooltip, the store list) used it. Esc in the
  // page — a period menu, a tooltip there — belongs to the page.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const at = document.activeElement
      const inside = !at || at === document.body || rootRef.current?.contains(at) || at.getAttribute('aria-controls') === id
      if (inside) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, id])

  useIsomorphicLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const onScroll = () => {
    const el = listRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }

  const ask = (q: string) => {
    if (!q.trim() || chat.busy || !chat.storeId) return
    stick.current = true
    void chat.send(q)
    setDraft('')
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); ask(draft) }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(draft) }
  }

  // One polite announcement per state change of the last answer (the
  // streamed tokens themselves are not announced: too chatty).
  const announcement = last?.role !== 'assistant' ? ''
    : last.status === 'waiting' || last.status === 'streaming' ? 'O Copiloto está respondendo.'
    : last.status === 'done' ? 'Resposta pronta.'
    : last.status === 'stopped' ? 'Resposta interrompida.'
    : last.error ? `${last.error.title}. ${last.error.message}` : ''

  const needStore = !chat.storeId
  const tooLong = draft.length > MAX_QUESTION_CHARS * 0.9

  return (
    <div ref={rootRef} className={s.drawer} id={id} role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}>
      <header className={s.head}>
        <div className={s.headTop}>
          <span className={s.mark} aria-hidden="true"><Icon name="sparkle" size={15} /></span>
          <h2 id={titleId} className={s.title}>Copiloto</h2>
          <Chip tone="mut" icon="lock" size="sm" title="Lê os números do Opero. Não altera nada na Shopify nem no Meta.">só leitura</Chip>
          <div className={s.headActions}>
            <Button size="sm" variant="ghost" icon="refresh" onClick={chat.clear} disabled={turns.length === 0}>Nova conversa</Button>
            <Button size="sm" variant="ghost" icon="x" iconOnly aria-label="Fechar o Copiloto" onClick={onClose} />
          </div>
        </div>
        <div className={s.scope}>
          {pageStoreId ? (
            <span className={s.scopeText}>Sobre <b>{storeName ?? 'esta loja'}</b></span>
          ) : (
            <StoreSelect stores={stores} value={chat.chosen} onChange={chat.choose} onRetry={() => { setStores({ status: 'loading' }); void fetchStores(true) }} disabled={chat.busy} />
          )}
          {split && <Chip tone="info" icon="split" size="sm" title="Lucro, lucro por pedido, caixa e reembolsos vêm com a sua parte (50%). Margens e ROAS não se dividem.">sua parte (50%)</Chip>}
        </div>
      </header>

      {/* A plain region, not role=log: a log is a live region, and every
          streamed token would be read aloud. State changes are announced once
          (below); tabIndex lets a keyboard reader scroll the conversation. */}
      <div ref={listRef} className={s.log} role="region" aria-label="Conversa com o Copiloto" aria-busy={chat.busy} tabIndex={0} onScroll={onScroll}>
        {chat.reset && (
          <Callout tone="info" title="Conversa reiniciada">
            {resetText(chat.reset, list.find(x => x.id === chat.reset?.fromId)?.name ?? chat.reset.fromName, storeName, split)}{' '}
            <button type="button" className={s.textBtn} onClick={chat.dismissReset}>Entendi</button>
          </Callout>
        )}

        {turns.length === 0 && needStore && (
          <EmptyState compact icon="store" title="Escolha uma loja">
            O Copiloto lê os números de uma loja por vez. Escolha a loja acima para começar.
          </EmptyState>
        )}

        {turns.length === 0 && !needStore && (
          <div className={s.intro}>
            <EmptyState compact icon="sparkle" title={`Pergunte sobre ${storeName ?? 'esta loja'}`}>
              As respostas usam os números do Opero — o mesmo cálculo de lucro desta tela, no fuso da loja.
              O Copiloto só lê: não muda nada na Shopify nem no Meta.
            </EmptyState>
            <ul className={s.suggest} aria-label="Sugestões de pergunta">
              {suggestions(from, to).map(q => (
                <li key={q}>
                  <button type="button" className={s.suggestBtn} onClick={() => ask(q)}>
                    <Icon name="arrowRight" size={13} />{q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {turns.map((t, i) => t.role === 'user'
          ? <div key={t.id} className={s.user}><p>{t.text}</p></div>
          : <Answer key={t.id} turn={t} storeId={chat.storeId} canRetry={i === turns.length - 1 && !chat.busy} onRetry={() => { stick.current = true; chat.retry(t.id) }} />)}
      </div>

      <form className={s.composer} onSubmit={onSubmit}>
        <label htmlFor={inputId} className="sr-only">Pergunta para o Copiloto</label>
        <textarea
          id={inputId}
          ref={inputRef}
          className={s.input}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={needStore ? 'Escolha uma loja para perguntar' : 'Pergunte sobre lucro, anúncios, produtos, países…'}
          maxLength={MAX_QUESTION_CHARS}
          rows={2}
          disabled={needStore}
        />
        <div className={s.composerRow}>
          <span className={s.hint}>
            {tooLong
              ? <span className="num">{draft.length.toLocaleString('pt-BR')}/{MAX_QUESTION_CHARS.toLocaleString('pt-BR')}</span>
              : 'Enter envia · Shift+Enter quebra a linha'}
          </span>
          {chat.busy
            ? <Button variant="secondary" icon="x" onClick={chat.stop}>Parar</Button>
            : <Button type="submit" variant="primary" icon="arrowRight" disabled={!draft.trim() || needStore}>Enviar</Button>}
        </div>
      </form>

      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  )
}

function StoreSelect({ stores, value, onChange, onRetry, disabled }: {
  stores: StoresState; value: string | null; onChange: (id: string) => void; onRetry: () => void; disabled: boolean
}) {
  const id = useId()
  if (stores.status === 'error') {
    return (
      <span className={s.scopeText}>
        Não consegui listar as lojas.{' '}
        <button type="button" className={s.textBtn} onClick={onRetry}>Tentar de novo</button>
      </span>
    )
  }
  const list = stores.status === 'ok' ? stores.stores : []
  return (
    <span className={s.selectWrap}>
      <label htmlFor={id} className={s.scopeText}>Sobre</label>
      <select
        id={id}
        className={s.select}
        value={value ?? ''}
        onChange={e => { if (e.target.value) onChange(e.target.value) }}
        disabled={disabled || stores.status !== 'ok'}
      >
        <option value="" disabled>{stores.status === 'ok' ? 'Escolha a loja' : 'Carregando lojas…'}</option>
        {list.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </span>
  )
}

const TOOLS_SHOWN = 4

function Tools({ tools }: { tools: ToolActivity[] }) {
  const [all, setAll] = useState(false)
  const running = tools.some(t => t.status === 'running')
  const shown = all || running || tools.length <= TOOLS_SHOWN ? tools : tools.slice(0, TOOLS_SHOWN - 1)
  const hidden = tools.length - shown.length
  return (
    <ul className={s.tools} aria-label="Consultas feitas pelo Copiloto">
      {shown.map(t => (
        <li key={t.id}>
          <Chip
            size="sm"
            tone={t.status === 'running' ? 'info' : t.status === 'error' ? 'warn' : 'mut'}
            icon={t.status === 'running' ? 'clock' : t.status === 'error' ? 'alert' : 'check'}
            title={t.status === 'running' ? 'Consultando…' : t.status === 'error' ? 'Esta consulta falhou' : 'Consulta feita'}
          >
            {t.label}
          </Chip>
        </li>
      ))}
      {hidden > 0 && (
        <li>
          <button type="button" className={s.textBtn} onClick={() => setAll(true)}>+{hidden} consultas</button>
        </li>
      )}
    </ul>
  )
}

function Answer({ turn, storeId, canRetry, onRetry }: { turn: AssistantTurn; storeId: string | null; canRetry: boolean; onRetry: () => void }) {
  const open = turn.status === 'waiting' || turn.status === 'streaming'
  const runningTool = turn.tools.find(t => t.status === 'running')
  return (
    <div className={s.answer}>
      {turn.tools.length > 0 && <Tools tools={turn.tools} />}
      {turn.text
        ? <SafeMarkdown storeId={storeId}>{turn.text}</SafeMarkdown>
        : open && (
            <p className={s.thinking}>
              <span className={s.spin} aria-hidden="true" />
              {runningTool ? `Consultando ${runningTool.label}…` : turn.status === 'waiting' ? 'Enviando…' : 'Pensando…'}
            </p>
          )}
      {turn.status === 'stopped' && !turn.notice && (
        <p className={s.meta}>{turn.text ? 'Você interrompeu a resposta.' : 'Você interrompeu antes da resposta começar.'}</p>
      )}
      {turn.notice && <Callout tone="warn">{turn.notice}</Callout>}
      {turn.error && (
        <Callout tone="neg" title={turn.error.title}>
          {turn.error.message}
          {turn.error.retry && canRetry && (
            <div className={s.retry}><Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>Tentar de novo</Button></div>
          )}
        </Callout>
      )}
    </div>
  )
}
