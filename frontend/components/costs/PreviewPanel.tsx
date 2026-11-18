'use client'

/**
 * The live preview next to the cost form: the store's P&L for the window at the
 * top of the page, priced by the profit engine with the settings on screen
 * (POST /api/profit), and — when something changed — the same window with the
 * saved settings, side by side. Numbers are the engine's; nothing here
 * recomputes profit.
 */

import { BreakdownLedger, Button, Callout, Card, Chip, ErrorState, Money } from '@/components/ui'
import { costLines, type ProfitPreviewResponse } from '@/lib/data/profitConfig'
import type { PnL } from '@/lib/engine/pnl'
import { formatMoney, formatPct, formatRoas, plural } from '@/lib/format'
import { SPLIT_SHARE } from '@/lib/views/verdict'
import s from './costs.module.css'

const cost = (t: PnL) => t.variableCosts + t.fixedCosts
/** What the headline judges: profit with costs, revenue − ads without. */
const headline = (t: PnL, configured: boolean) => (configured ? t.operatingProfit : t.revenue - t.adSpend)

export function PreviewPanel({ preview, busy, error, onRetry, dirty, periodLabel, partialLabel, split, onFocusProduct }: {
  preview: ProfitPreviewResponse | null
  busy: boolean
  error: string | null
  onRetry: () => void
  /** The form differs from what is saved. */
  dirty: boolean
  periodLabel: string
  /** "parcial · até 13h38" (store clock) when the preview shown is the page's window. */
  partialLabel: string | null
  split: boolean
  /** "definir custo" beside an unpriced product; omitted on a read-only screen. */
  onFocusProduct?: (id: string) => void
}) {
  if (!preview) {
    return (
      <Card pad="md">
        {error
          ? <ErrorState compact title="A prévia não carregou" action={<Button size="sm" icon="refresh" onClick={onRetry}>Tentar de novo</Button>}>{error}</ErrorState>
          : <p className={s.sub}>Calculando a prévia…</p>}
      </Card>
    )
  }

  const t = preview.totals
  const value = headline(t, preview.configured)
  // Same rule as the shared ledger: refunds or fixed costs in the window are
  // something to show even without a sale.
  const empty = t.orders === 0 && t.revenue <= 0 && t.adSpend <= 0 && t.adjustments <= 0 && t.fixedCosts <= 0
  const saved = dirty ? preview.saved : null
  const savedValue = saved ? headline(saved.totals, saved.configured) : null

  return (
    <div className={s.pv} aria-busy={busy || undefined}>
      <Card pad="md">
        <div className={s.pv}>
          <div className={s.pvHead}>
            <span className="lbl">Prévia · {periodLabel === preview.label ? <span className="num">{preview.label}</span> : <>{periodLabel} · <span className="num">{preview.label}</span></>}</span>
            <div className={s.inline}>
              {dirty
                ? <Chip tone="info" icon="sliders" size="sm">com suas alterações</Chip>
                : preview.configured
                  ? <Chip tone="neu" icon="check" size="sm">configuração salva</Chip>
                  : <Chip tone="mut" size="sm">nada salvo ainda</Chip>}
              {preview.partial && <Chip tone="info" icon="clock" size="sm">{partialLabel ?? 'inclui hoje, parcial'}</Chip>}
              {busy && <Chip tone="mut" size="sm">recalculando…</Chip>}
            </div>
          </div>

          {error && (
            <Callout tone="neg" title="A última prévia falhou">
              {error} Os números abaixo são da prévia anterior. <button type="button" className={s.linkBtn} onClick={onRetry}>Tentar de novo</button>
            </Callout>
          )}

          <div className={busy ? s.pvBusy : undefined}>
            {empty ? (
              <>
                <div className={`${s.pvBig} mut`}>Sem vendas</div>
                <div className={s.pvCap}>Nenhum pedido e nenhum anúncio neste período: não há o que precificar. Escolha um período maior no topo da página.</div>
              </>
            ) : (
              <>
                {!preview.configured && <div style={{ marginBottom: 6 }}><Chip tone="cfg" icon="sliders" size="sm">Custos não configurados</Chip></div>}
                <div className={s.pvBig}><Money value={value} /></div>
                <div className={s.pvCap}>
                  {preview.configured
                    ? <>de lucro real, depois de todos os custos{t.margin !== null ? <> · margem <b className="num">{formatPct(t.margin)}</b></> : null}</>
                    : <>vendas − anúncios: não é lucro, falta o custo dos produtos</>}
                </div>
                {split && <div className={s.pvCap}>Sua parte ({formatPct(SPLIT_SHARE * 100, { digits: 0 })}): <Money value={value * SPLIT_SHARE} /></div>}
              </>
            )}
          </div>

          {saved && savedValue !== null && !empty && (
            <div className={busy ? s.pvBusy : undefined}>
              <div className={s.compare} role="table" aria-label="Antes e depois das alterações">
                <span role="columnheader" />
                <span role="columnheader" className={s.compareHead}>Salvo</span>
                <span role="columnheader" className={s.compareHead}>Com alterações</span>
                <CompareRow label={saved.configured ? 'Lucro real' : 'Vendas − anúncios (salvo)'} a={formatMoney(savedValue)} b={formatMoney(value)} />
                <CompareRow label="Custos (sem anúncios)" a={formatMoney(cost(saved.totals))} b={formatMoney(cost(t))} />
                <CompareRow label="Margem" a={formatPct(saved.configured ? saved.totals.margin : null)} b={formatPct(preview.configured ? t.margin : null)} />
                <CompareRow label="ROAS de empate" a={formatRoas(saved.configured ? saved.totals.breakEvenRoas : null)} b={formatRoas(preview.configured ? t.breakEvenRoas : null)} />
                <CompareRow label="Lucro por pedido" a={formatMoney(saved.configured ? saved.totals.profitPerOrder : null)} b={formatMoney(preview.configured ? t.profitPerOrder : null)} />
              </div>
              <p className={s.sub} style={{ marginTop: 8 }}>
                {value - savedValue === 0
                  ? <>As alterações não mudam o resultado deste período.</>
                  : <>Com as alterações, o resultado do período fica <b className={value - savedValue > 0 ? 'pos' : 'neg'}>{formatMoney(Math.abs(value - savedValue))} {value - savedValue > 0 ? 'maior' : 'menor'}</b>.</>}
              </p>
            </div>
          )}
        </div>
      </Card>

      {!empty && (
        <Card pad="md" className={busy ? s.pvBusy : undefined}>
          {/* No sale in the window (Glooty some weeks: ads ran, nothing sold):
              there is no dollar to split, so no bar and no "de cada $1". */}
          <BreakdownLedger
            pnl={t}
            configured={preview.configured}
            split={split}
            bar={t.revenue > 0}
            title="Para onde foi cada dólar"
            sub={t.revenue > 0
              ? `De cada $1,00 vendido em ${preview.label}`
              : `Nenhuma venda em ${preview.label}: só gastos, sem dólar vendido para dividir`}
          />
        </Card>
      )}

      {!empty && preview.configured && <CostLines preview={preview} saved={saved?.configured ? saved.totals : null} busy={busy} />}

      {preview.breakdown.coverage && preview.breakdown.coverage.bySource.length > 0 && (
        <Coverage preview={preview} onFocusProduct={onFocusProduct} busy={busy} />
      )}

      {preview.issues.length > 0 && (
        <Callout tone="warn" title={`A prévia ignorou ${plural(preview.issues.length, 'campo com problema', 'campos com problema')}`}>
          Os campos marcados em vermelho ficam de fora do cálculo até serem corrigidos. Salvar fica bloqueado até lá.
        </Callout>
      )}
    </div>
  )
}

function CompareRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <>
      <span role="cell" className={s.k}>{label}</span>
      <span role="cell" className={s.v}>{a}</span>
      <span role="cell" className={s.v}>{b}</span>
    </>
  )
}

function CostLines({ preview, saved, busy }: { preview: ProfitPreviewResponse; saved: PnL | null; busy: boolean }) {
  const lines = preview.breakdown.lines.filter(l => l.amount !== 0 || (saved && costLines(saved).find(x => x.key === l.key)?.amount))
  const before = saved ? new Map(costLines(saved).map(l => [l.key, l.amount])) : null
  const total = preview.breakdown.totalCost
  return (
    <Card pad="md" className={busy ? s.pvBusy : undefined}>
      <div className={s.stack}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Custos por linha</div>
          <div className={s.sub}>{before ? 'O que cada parte da configuração custou no período, antes e depois.' : 'O que cada parte da configuração custou no período. Anúncios ficam de fora.'}</div>
        </div>
        {lines.length === 0 ? (
          <p className={s.sub}>Nenhum custo no período.</p>
        ) : (
          <table className={s.lines}>
            <thead>
              <tr>
                <th scope="col">Linha</th>
                {before ? <><th scope="col">Salvo</th><th scope="col">Agora</th><th scope="col">Diferença</th></> : <><th scope="col">Valor</th><th scope="col">% vendas</th><th scope="col">Por pedido</th></>}
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const b = before?.get(l.key) ?? 0
                const d = l.amount - b
                return (
                  <tr key={l.key}>
                    <td>{l.label}</td>
                    {before ? (
                      <>
                        <td>{formatMoney(b)}</td>
                        <td>{formatMoney(l.amount)}</td>
                        <td className={Math.abs(d) < 0.005 ? 'mut' : d > 0 ? s.diffUp : s.diffDown}>{Math.abs(d) < 0.005 ? '—' : formatMoney(d, { sign: true })}</td>
                      </>
                    ) : (
                      <>
                        <td>{formatMoney(l.amount)}</td>
                        <td>{formatPct(l.pctOfRevenue)}</td>
                        <td>{formatMoney(l.perOrder, { cents: 'always' })}</td>
                      </>
                    )}
                  </tr>
                )
              })}
              <tr className={s.total}>
                <td>Total</td>
                {before ? (
                  <>
                    <td>{formatMoney(cost(saved!))}</td>
                    <td>{formatMoney(total)}</td>
                    <td className={total - cost(saved!) > 0.005 ? s.diffUp : total - cost(saved!) < -0.005 ? s.diffDown : 'mut'}>
                      {Math.abs(total - cost(saved!)) < 0.005 ? '—' : formatMoney(total - cost(saved!), { sign: true })}
                    </td>
                  </>
                ) : (
                  <>
                    <td>{formatMoney(total)}</td>
                    <td>{formatPct(preview.totals.revenue > 0 ? (total / preview.totals.revenue) * 100 : null)}</td>
                    <td>{formatMoney(preview.totals.orders > 0 ? total / preview.totals.orders : null, { cents: 'always' })}</td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
        )}
        {before && <p className={s.sub}>Diferença em vermelho = custo maior (menos lucro); em verde = custo menor.</p>}
      </div>
    </Card>
  )
}

function Coverage({ preview, onFocusProduct, busy }: { preview: ProfitPreviewResponse; onFocusProduct?: (id: string) => void; busy: boolean }) {
  const cov = preview.breakdown.coverage!
  return (
    <Card pad="md" className={busy ? s.pvBusy : undefined}>
      <div className={s.stack}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Como as unidades foram precificadas</div>
          <div className={s.sub}>Regra que precificou cada unidade vendida no período, pela configuração na tela.</div>
        </div>
        <div className={s.coverage}>
          {cov.bySource.map(b => (
            <div key={b.source} className={s.covRow}>
              <span className={b.source === 'default' ? 'warn' : undefined}>{b.label}</span>
              <span>{plural(b.units, 'unid.', 'unid.')} · {plural(b.products, 'produto', 'produtos')}</span>
            </div>
          ))}
        </div>
        {cov.unpricedUnits > 0 && (
          <Callout tone="warn" title={`${plural(cov.unpricedUnits, 'unidade caiu', 'unidades caíram')} no custo padrão (${formatMoney(cov.defaultCostUsd, { cents: 'always' })})`}>
            Produtos vendidos sem preço próprio.{onFocusProduct ? ' Se o custo real for outro, defina o preço deles:' : ''}
            <ul className={s.issueList} style={{ listStyle: 'none', marginLeft: 0 }}>
              {cov.unpriced.slice(0, 6).map(u => (
                <li key={u.key} className={s.inline} style={{ justifyContent: 'space-between' }}>
                  <span>{u.title} <span className="num mut">· {u.units} un.</span></span>
                  {u.productId && onFocusProduct && <button type="button" className={s.linkBtn} onClick={() => onFocusProduct(u.productId!)}>definir custo</button>}
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {cov.cardChanges.length > 0 && (
          <p className={s.sub}>
            {cov.cardChanges.map(c => `“${c.label}” começa em ${c.effectiveFrom.slice(8, 10)}/${c.effectiveFrom.slice(5, 7)}`).join('; ')}, dentro do
            período: antes dessa data valia a regra anterior.
          </p>
        )}
      </div>
    </Card>
  )
}
