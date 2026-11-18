'use client'

/**
 * The cost screen's editor: the store's settings as sections, a live preview
 * priced by the engine (POST /api/profit with the draft), and a save that
 * shows success only when the server confirmed it (PUT with baseVersion).
 *
 * Bugs this replaces (the old ProfitModule):
 *  - PE16/M8: no error handling — a failed request spun forever or crashed the
 *    page. Every request here checks res.ok, reads errors as JSON or says the
 *    server did not answer, and only the latest request may update the screen.
 *  - PE18/M7: a period change refetched the settings and threw edits away. The
 *    settings are loaded once per store (by the server page); a period change
 *    only re-runs the preview with the draft. The draft also lives in
 *    sessionStorage and a leave guard warns before leaving.
 *  - M9: saves went to whatever store was active at save time. The store id
 *    travels with every request, and this component is keyed by it.
 *  - PE17/L3: index keys and uncontrolled inputs (see form.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Callout } from '@/components/ui'
import {
  canonicalJson, isEmptyConfig, parseProfitConfig,
  type ConfigIssue, type ProfitApiError, type ProfitConfig, type ProfitPreviewResponse, type ProfitSaveResponse,
} from '@/lib/data/profitConfig'
import { PERIODS, type Period } from '@/lib/engine/dates'
import { formatMoney, formatTimeInTz, plural } from '@/lib/format'
import type { PnL } from '@/lib/engine/pnl'
import { CountryPricesSection, OrderFeesSection } from './CountryCosts'
import { clearDraft, useStoredDraft, writeDraft } from './draftStore'
import { MessagesContext, type CatalogueItem } from './fields'
import {
  changedSections, clientIssues, joinPt, messagesByField, ptMessage, toForm, toPayload, type CostForm, type PayloadIndex,
} from './form'
import { PreviewPanel } from './PreviewPanel'
import { ProductCostsSection, ZeroCostSection, type ProductFocus } from './ProductCosts'
import { ExtrasSection, FeesSection, PackagingSection, ShippingSection } from './SimpleSections'
import { SupplierTablesSection } from './SupplierTables'
import { leaveWithoutAsking, useLeaveGuard } from './useLeaveGuard'
import s from './costs.module.css'

export interface CostsEditorProps {
  store: { id: string; name: string; timezone: string; archived: boolean; currency: string | null }
  window: { period: Period; from: string; to: string; periodLabel: string; /** "parcial · até 13h38" when the window includes today. */ partialLabel: string | null }
  today: string
  saved: { config: ProfitConfig; version: string; configured: boolean; issues: ConfigIssue[]; warnings: ConfigIssue[] }
  /** The saved settings priced for the window, by the server render. */
  initialPreview: ProfitPreviewResponse | null
  initialPreviewError: string | null
  catalogue: CatalogueItem[]
  split: boolean
}

interface Notice {
  tone: 'pos' | 'neg' | 'warn'
  title: string
  body?: string
  list?: string[]
  conflictVersion?: string
}

interface PreviewResult { key: string; attempt: number; data: ProfitPreviewResponse | null; error: string | null }

const SECTIONS: { id: string; label: string; prefixes: string[] }[] = [
  { id: 'taxas', label: 'Taxas', prefixes: ['shopify'] },
  { id: 'produtos', label: 'Produtos', prefixes: ['cogs.default_cost_usd', 'cogs.additional_unit_discount_usd', 'cogs.volume_discounts', 'cogs.products'] },
  { id: 'sem-custo', label: 'Sem custo', prefixes: ['cogs.zero_cost_products'] },
  { id: 'tabelas', label: 'Tabelas do fornecedor', prefixes: ['cogs.price_tiers'] },
  { id: 'por-pais', label: 'Preço por país', prefixes: ['cogs.country_prices'] },
  { id: 'taxa-pedido', label: 'Taxa por país', prefixes: ['cogs.order_fees'] },
  { id: 'embalagem', label: 'Embalagem', prefixes: ['cogs.packaging'] },
  { id: 'frete', label: 'Frete', prefixes: ['shipping'] },
  { id: 'extras', label: 'Custos extras', prefixes: ['extra_costs'] },
]

/** What the preview headline judges: profit with costs, revenue − ads without. */
const headlineOf = (t: PnL, configured: boolean) => (configured ? t.operatingProfit : t.revenue - t.adSpend)

/** A JSON body, or null when the server answered something else (an HTML 500). */
async function readBody<T>(res: Response): Promise<T | null> {
  try { return (await res.json()) as T } catch { return null }
}

/** A sentence (ends with a period) for a failed request. */
function failure(res: Response, body: ProfitApiError | null): string {
  if (body?.error) return /[.!?]$/.test(body.error.trim()) ? body.error.trim() : `${body.error.trim()}.`
  if (res.status === 401) return 'Sua sessão expirou. Entre de novo.'
  return `O servidor respondeu com erro (HTTP ${res.status}).`
}

export function CostsEditor(props: CostsEditorProps) {
  const { store, window: win, today, catalogue, split } = props
  const router = useRouter()

  const [saved, setSaved] = useState(props.saved)
  const baseForm = useMemo(() => toForm(saved.config), [saved.config])
  const stored = useStoredDraft(store.id)
  const restorable = stored && stored.version === saved.version ? stored.form : null
  const staleDraft = stored && stored.version !== saved.version ? stored : null
  // The form on screen: the user's edits, else a draft restored from this tab,
  // else the saved settings.
  const [edits, setEdits] = useState<CostForm | null>(null)
  const form = edits ?? restorable ?? baseForm
  const update = useCallback((fn: (f: CostForm) => CostForm) => setEdits(prev => fn(prev ?? form)), [form])

  const catalogueNames = useMemo(() => Object.fromEntries(catalogue.map(c => [c.id, c.title])), [catalogue])
  const productNames = form.cogs.productNames
  const nameOf = useCallback((id: string) => productNames[id] || catalogueNames[id] || `Produto ${id}`, [productNames, catalogueNames])

  const payload = useMemo(() => toPayload(form, catalogueNames), [form, catalogueNames])
  const payloadJson = useMemo(() => canonicalJson(payload.config), [payload])
  const savedPayload = useMemo(() => toPayload(baseForm, catalogueNames).config, [baseForm, catalogueNames])
  const savedJson = useMemo(() => canonicalJson(savedPayload), [savedPayload])
  const dirty = payloadJson !== savedJson
  const changed = useMemo(() => (dirty ? changedSections(payload.config, savedPayload) : []), [dirty, payload, savedPayload])

  // The same checks the server runs, in the browser, for instant messages.
  const parsed = useMemo(() => parseProfitConfig(payload.config, saved.config), [payload, saved.config])
  const local = useMemo(() => clientIssues(form), [form])
  const [serverIssues, setServerIssues] = useState<{ issues: ConfigIssue[]; index: PayloadIndex; json: string } | null>(null)
  const messages = useMemo(() => {
    const m = messagesByField([...parsed.issues, ...local], parsed.warnings, payload.index)
    // A refusal from the server stays on screen until the form changes.
    if (serverIssues && serverIssues.json === payloadJson) {
      const sm = messagesByField(serverIssues.issues, [], serverIssues.index)
      for (const [k, v] of sm.errors) m.errors.set(k, [...new Set([...(m.errors.get(k) ?? []), ...v])])
    }
    return m
  }, [parsed, local, payload.index, serverIssues, payloadJson])
  const blocking = parsed.issues.length + local.length
  const wouldBeEmpty = isEmptyConfig(parsed.config)

  // ── Draft kept in this tab ──
  useEffect(() => {
    if (edits === null) return
    const t = setTimeout(() => {
      if (canonicalJson(toPayload(edits, catalogueNames).config) === savedJson) clearDraft(store.id)
      else writeDraft(store.id, { version: saved.version, form: edits, at: new Date().toISOString() })
    }, 300)
    return () => clearTimeout(t)
  }, [edits, savedJson, saved.version, store.id, catalogueNames])

  useLeaveGuard(dirty, `Há alterações não salvas nos custos de ${store.name}. Sair mesmo assim? Elas ficam guardadas nesta aba até você voltar.`)

  // ── Live preview of the draft ──
  const periodKey = `${win.period}|${win.from}|${win.to}`
  const previewKey = `${payloadJson}|${periodKey}`
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [lastGood, setLastGood] = useState<ProfitPreviewResponse | null>(null)
  const [attempt, setAttempt] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    if (!dirty) return
    const ctrl = new AbortController()
    const mine = ++seq.current
    const key = `${payloadJson}|${periodKey}`
    const t = setTimeout(async () => {
      const body = JSON.stringify({
        storeId: store.id,
        config: JSON.parse(payloadJson),
        period: win.period,
        ...(win.period === 'custom' ? { from: win.from, to: win.to } : {}),
      })
      try {
        const res = await fetch('/api/profit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal })
        const data = await readBody<ProfitPreviewResponse & ProfitApiError>(res)
        if (mine !== seq.current) return
        if (!res.ok || !data || !data.totals) {
          setResult({ key, attempt, data: null, error: failure(res, data) })
          return
        }
        setResult({ key, attempt, data, error: null })
        setLastGood(data)
      } catch {
        if (ctrl.signal.aborted || mine !== seq.current) return
        setResult({ key, attempt, data: null, error: 'O servidor não respondeu.' })
      }
    }, 450)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [dirty, payloadJson, periodKey, win.period, win.from, win.to, store.id, attempt])

  const current = result && result.key === previewKey && result.attempt === attempt ? result : null
  const busy = dirty && !current
  const previewError = dirty ? current?.error ?? null : props.initialPreviewError

  // ── Save ──
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [justSaved, setJustSaved] = useState<ProfitPreviewResponse | null>(null)

  async function save(baseVersion = saved.version) {
    if (saving) return
    setSaving(true)
    setNotice(null)
    const sentIndex = payload.index
    const sentJson = payloadJson
    try {
      const res = await fetch('/api/profit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: store.id, baseVersion, config: JSON.parse(sentJson) }),
      })
      const body = await readBody<ProfitSaveResponse & ProfitApiError>(res)
      if (res.ok && body?.ok) {
        // The preview of exactly what was saved stays on screen until the
        // page's own render of the saved settings arrives.
        setJustSaved(current?.data ?? null)
        setLastGood(null)
        setSaved({ config: body.config, version: body.version, configured: true, issues: [], warnings: body.warnings })
        setEdits(null)
        setServerIssues(null)
        clearDraft(store.id)
        setNotice(body.changed
          ? { tone: 'pos', title: `Salvo às ${formatTimeInTz(new Date(), store.timezone)} (horário da loja)`, body: 'O servidor confirmou a gravação. Todas as telas já usam estes custos.' }
          : { tone: 'pos', title: 'Nada mudou', body: 'A configuração salva já era exatamente esta; nada foi gravado.' })
        router.refresh()
        return
      }
      if (res.status === 422 && body) {
        setServerIssues({ issues: body.issues ?? [], index: sentIndex, json: sentJson })
        setNotice({ tone: 'neg', title: body.error || 'A configuração foi recusada.', list: (body.issues ?? []).map(i => ptMessage(i.message)).slice(0, 8) })
        return
      }
      if (res.status === 409) {
        setNotice({
          tone: 'warn',
          title: 'Os custos desta loja foram salvos por outra pessoa enquanto você editava',
          body: 'Nada foi gravado e suas alterações continuam na tela. Você pode recarregar para ver a versão atual (as suas ficam guardadas nesta aba) ou salvar as suas por cima da versão da outra pessoa.',
          conflictVersion: body?.version,
        })
        return
      }
      setNotice({ tone: 'neg', title: 'Não foi salvo', body: `${failure(res, body)} Nada foi gravado; suas alterações continuam na tela.` })
    } catch {
      setNotice({ tone: 'neg', title: 'Não foi salvo', body: 'O servidor não respondeu. Nada foi gravado; suas alterações continuam na tela.' })
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setEdits(null)
    setServerIssues(null)
    setNotice(null)
    // The next edit must not show this draft's numbers while its own preview loads.
    setLastGood(null)
    clearDraft(store.id)
  }

  // ── What the preview panel shows ──
  const initial = props.initialPreview
  const displayed = dirty
    ? current?.data ?? lastGood ?? initial
    : justSaved && initial?.version !== saved.version ? justSaved : initial

  const shownIsCurrent = !!displayed && displayed.period === win.period && displayed.range.from === win.from && displayed.range.to === win.to

  const unpricedUnits = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of displayed?.breakdown.coverage?.unpriced ?? []) if (u.productId) m.set(u.productId, u.units)
    return m
  }, [displayed])

  const [focus, setFocus] = useState<ProductFocus | null>(null)
  const focusProduct = useCallback((id: string) => setFocus(f => ({ id, n: (f?.n ?? 0) + 1 })), [])

  const sectionHasError = (prefixes: string[]) =>
    [...messages.errors.keys()].some(k => prefixes.some(p => k === p || k.startsWith(`${p}.`) || k.startsWith(`${p}#`) || k.startsWith(`${p}@`) || k.startsWith(`${p}[`)))
  const savedIssues = props.saved.issues

  return (
    <MessagesContext.Provider value={messages}>
      <div className={s.layout}>
        <div className={s.main}>
          {!saved.configured && (
            <Callout tone="warn" title="Custos não configurados">
              Hoje {store.name} aparece em todas as telas como <b>vendas − anúncios</b>, que não é lucro. Preencha ao menos o
              custo padrão por produto e as taxas, confira a prévia e salve.
            </Callout>
          )}
          {store.currency && store.currency !== 'USD' && (
            <Callout tone="info" title={`A loja vende em ${store.currency}`}>
              Os pedidos chegam convertidos em dólar. Preencha todos os custos em <b>US$</b>.
            </Callout>
          )}
          {store.archived && (
            <Callout tone="neu" title="Loja arquivada">
              Ela não sincroniza mais. Alterar os custos muda os números do histórico dela.
            </Callout>
          )}
          {savedIssues.length > 0 && (
            <Callout tone="warn" title={`A configuração salva tem ${plural(savedIssues.length, 'entrada inválida', 'entradas inválidas')}`}>
              Elas foram deixadas de fora desta tela e da prévia. Ao salvar, saem da configuração de vez:
              <ul className={s.issueList}>{savedIssues.slice(0, 6).map((i, k) => <li key={k}><code>{i.path}</code>: {ptMessage(i.message)}</li>)}</ul>
            </Callout>
          )}
          {restorable && edits === null && dirty && stored && (
            <Callout tone="info" title="Restauramos alterações que você não tinha salvado">
              Feitas às {formatTimeInTz(stored.at, store.timezone)} nesta aba. Elas ainda não estão gravadas.{' '}
              <button type="button" className={s.linkBtn} onClick={discard}>Descartar e voltar ao salvo</button>
            </Callout>
          )}
          {staleDraft && (
            <Callout tone="warn" title="Havia alterações não salvas, feitas sobre uma versão anterior">
              Desde então os custos desta loja foram salvos de novo, então elas não foram aplicadas.{' '}
              <button type="button" className={s.linkBtn} onClick={() => clearDraft(store.id)}>Descartar</button>
              {' · '}
              <button type="button" className={s.linkBtn} onClick={() => { setEdits(staleDraft.form); clearDraft(store.id) }}>Aplicar mesmo assim</button>
            </Callout>
          )}
          {notice && (
            <Callout tone={notice.tone === 'pos' ? 'info' : notice.tone} icon={notice.tone === 'pos' ? 'check' : undefined} title={notice.title}>
              {notice.body}
              {notice.list && notice.list.length > 0 && <ul className={s.issueList}>{notice.list.map((m, i) => <li key={i}>{m}</li>)}</ul>}
              {notice.conflictVersion && (
                <div className={s.inline} style={{ marginTop: 8 }}>
                  <Button size="sm" onClick={() => { leaveWithoutAsking(); window.location.reload() }}>Recarregar a versão atual</Button>
                  <Button size="sm" variant="danger" onClick={() => save(notice.conflictVersion)}>Salvar as minhas por cima</Button>
                </div>
              )}
            </Callout>
          )}

          <nav className={s.toc} aria-label="Seções dos custos">
            {SECTIONS.map(sec => (
              <a key={sec.id} href={`#${sec.id}`}>
                {sectionHasError(sec.prefixes) && <><i className={`${s.tocDot} ${s.tocErr}`} aria-hidden="true" /><span className="sr-only">tem campo com problema: </span></>}
                {sec.label}
              </a>
            ))}
          </nav>

          <FeesSection form={form} update={update} />
          <ProductCostsSection
            form={form} update={update} catalogue={catalogue} nameOf={nameOf}
            draft={parsed.config} asOf={win.to} unpricedUnits={unpricedUnits}
            unpricedTotal={displayed?.breakdown.coverage?.unpricedUnits ?? 0} focus={focus}
          />
          <ZeroCostSection form={form} update={update} catalogue={catalogue} nameOf={nameOf} />
          <SupplierTablesSection form={form} update={update} catalogue={catalogue} nameOf={nameOf} today={today} />
          <CountryPricesSection form={form} update={update} catalogue={catalogue} nameOf={nameOf} />
          <OrderFeesSection form={form} update={update} />
          <PackagingSection form={form} update={update} catalogue={catalogue} nameOf={nameOf} />
          <ShippingSection form={form} update={update} />
          <ExtrasSection form={form} update={update} />

          {(dirty || saving) && (
            <div className={s.saveBar} role="region" aria-label="Alterações não salvas">
              <div className={s.saveText}>
                <b>Alterações não salvas em {store.name}</b>
                <span>
                  {blocking > 0
                    ? <span className="neg">{plural(blocking, 'campo com problema', 'campos com problema')}: corrija para salvar.</span>
                    : wouldBeEmpty
                      ? <span className="neg">A configuração ficaria sem nenhum custo; preencha pelo menos um.</span>
                      : <>Alterado: {joinPt(changed)}.</>}
                </span>
                {/* The result in one line, for when the preview is out of sight
                    (below the form on narrower screens). */}
                {current?.data?.saved && (
                  <span>
                    {win.periodLabel}: <b className="num">{formatMoney(headlineOf(current.data.totals, current.data.configured))}</b> com as
                    alterações · <span className="num">{formatMoney(headlineOf(current.data.saved.totals, current.data.saved.configured))}</span> salvo
                  </span>
                )}
                {busy && <span className="mut">recalculando a prévia…</span>}
              </div>
              <div className={s.saveActions}>
                <Button variant="ghost" onClick={discard} disabled={saving}>Descartar</Button>
                <Button variant="primary" icon="check" pending={saving} disabled={blocking > 0 || wouldBeEmpty} onClick={() => save()}>
                  Salvar custos
                </Button>
              </div>
            </div>
          )}
        </div>

        <aside className={s.aside} aria-label="Prévia do resultado">
          <PreviewPanel
            preview={displayed}
            busy={busy}
            error={previewError}
            onRetry={() => (dirty ? setAttempt(a => a + 1) : router.refresh())}
            // Until the first preview of the draft arrives, the panel shows the
            // saved settings' numbers and must say so, not "com suas alterações".
            dirty={dirty && displayed !== initial}
            // The panel may still show the previous window while the new one is
            // priced: label it with its own window, never the one just picked.
            periodLabel={!displayed || shownIsCurrent
              ? win.periodLabel
              : displayed.period === 'custom' ? displayed.label : PERIODS.find(p => p.key === displayed.period)?.label ?? displayed.label}
            partialLabel={shownIsCurrent ? win.partialLabel : null}
            split={split}
            onFocusProduct={focusProduct}
          />
        </aside>
      </div>
    </MessagesContext.Provider>
  )
}
