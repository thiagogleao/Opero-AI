'use client'

/**
 * "Custo dos produtos" and "Produtos sem custo".
 *
 * The rule this section has to make obvious (CLAUDE.md, engine costs.ts):
 * a product with cost 0 — or no cost — is NOT free. It is "not priced yet" and
 * falls back to the default cost. A product that really costs nothing (a gift,
 * a warranty) goes in the zero-cost list. MOKOO has 283 products at 0 and
 * depends on exactly that fallback.
 *
 * Each row says, live, which rule prices that product with the settings on
 * screen (pricingSource, the engine's own order of precedence), so the effect
 * of a supplier card or a country list is visible before saving.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Block, Button, Callout, Segmented, type ChipTone } from '@/components/ui'
import { buildCogsLookups } from '@/lib/engine/costs'
import { pricingSource, toNumber, type PricingSource, type ProfitConfig } from '@/lib/data/profitConfig'
import { formatMoney, plural } from '@/lib/format'
import { addUnique, dropRow, patchRow, setCogs, without, type Update } from './edit'
import { productKey, rowKey, newId, type CostForm } from './form'
import {
  Check, EditOnly, Msgs, NumField, ProductChips, ProductPicker, RemoveButton, SelectField, searchCatalogue, useMessages, useReadOnly,
  type CatalogueItem,
} from './fields'
import s from './costs.module.css'

const PAGE = 40

type Filter = 'all' | 'default' | 'priced' | 'card' | 'country' | 'free'

const SOURCE_BADGE: Record<PricingSource, { tone: ChipTone; text: (d: number) => string }> = {
  whole_order_card: { tone: 'info', text: () => 'tabela (pedido inteiro)' },
  product_card: { tone: 'info', text: () => 'tabela do fornecedor' },
  free: { tone: 'mut', text: () => 'sem custo' },
  country_price: { tone: 'neu', text: () => 'preço por país' },
  product_price: { tone: 'pos', text: () => 'preço próprio' },
  title_price: { tone: 'neu', text: () => 'preço pelo nome' },
  default: { tone: 'warn', text: d => `cai no padrão (${formatMoney(d, { cents: 'always' })})` },
}

const FILTER_OF: Record<PricingSource, Filter> = {
  whole_order_card: 'card', product_card: 'card', free: 'free', country_price: 'country',
  product_price: 'priced', title_price: 'priced', default: 'default',
}

export interface ProductFocus { id: string; n: number }

export function ProductCostsSection({ form, update, catalogue, nameOf, draft, asOf, unpricedUnits, unpricedTotal, focus }: {
  form: CostForm
  update: Update
  catalogue: CatalogueItem[]
  nameOf: (id: string) => string
  /** The settings on screen, parsed: what pricingSource reads. */
  draft: ProfitConfig
  /** Day the rules are read at (the preview window's last day). */
  asOf: string
  /** Units that fell to the default cost in the preview window, by product id (top 25). */
  unpricedUnits: Map<string, number>
  /** All units that fell to the default cost in the window. */
  unpricedTotal: number
  focus: ProductFocus | null
}) {
  const c = form.cogs
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(PAGE)
  const [flash, setFlash] = useState<string | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const defaultCost = toNumber(c.default_cost_usd) ?? 0

  // Every product the screen knows: the catalogue, plus saved prices whose
  // product is no longer in it (archived and deleted products still price old
  // orders by title).
  const items = useMemo(() => {
    const known = new Set(catalogue.map(p => p.id))
    const extra: CatalogueItem[] = c.productOrder.filter(id => !known.has(id)).map(id => ({ id, title: nameOf(id), status: null }))
    return [...catalogue, ...extra]
  }, [catalogue, c.productOrder, nameOf])

  const lookups = useMemo(() => buildCogsLookups(draft), [draft])
  const sourceOf = useMemo(() => {
    const m = new Map<string, PricingSource>()
    for (const p of items) m.set(p.id, pricingSource({ productId: p.id, title: p.title }, draft, asOf, lookups))
    return m
  }, [items, draft, asOf, lookups])

  const counts = useMemo(() => {
    const n: Record<Filter, number> = { all: items.length, default: 0, priced: 0, card: 0, country: 0, free: 0 }
    for (const src of sourceOf.values()) n[FILTER_OF[src]] += 1
    return n
  }, [items, sourceOf])

  const visible = useMemo(() => {
    const pool = filter === 'all' ? items : items.filter(p => FILTER_OF[sourceOf.get(p.id) ?? 'default'] === filter)
    const found = q.trim() ? searchCatalogue(pool, q, new Set(), pool.length) : pool
    // Products that fell to the default cost in the window first: they are
    // what is costing money right now.
    return [...found].sort((a, b) => (unpricedUnits.get(b.id) ?? 0) - (unpricedUnits.get(a.id) ?? 0) || a.title.localeCompare(b.title, 'pt-BR'))
  }, [items, filter, q, sourceOf, unpricedUnits])

  // "Definir custo" from the preview: show that product and flash its row.
  // (Adjusting state while rendering, the React way to follow a prop change.)
  const [seenFocus, setSeenFocus] = useState(0)
  if (focus && focus.n !== seenFocus) {
    setSeenFocus(focus.n)
    setFilter('all')
    setQ(nameOf(focus.id))
    setFlash(focus.id)
  }
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => {
      const row = document.getElementById(`prow-${focus.id}`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row?.querySelector('input')?.focus({ preventScroll: true })
    }, 60)
    const t2 = setTimeout(() => setFlash(null), 1800)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [focus])

  const zero = new Set(c.zero_cost_products)
  const setCost = (id: string, v: string) => update(f => setCogs(f, { products: { ...f.cogs.products, [id]: v } }))
  const setFree = (id: string, free: boolean) =>
    update(f => setCogs(f, { zero_cost_products: free ? addUnique(f.cogs.zero_cost_products, id) : without(f.cogs.zero_cost_products, id) }))


  return (
    <Block
      id="produtos"
      title="Custo dos produtos"
      howTo="Quanto o fornecedor cobra por unidade de cada produto. O que não tem preço próprio usa o custo padrão."
      info={
        <>
          Ordem em que um produto é precificado num pedido:
          <ol style={{ margin: '6px 0 0 16px' }}>
            <li>tabela do fornecedor que vale para o pedido inteiro (ignora o resto);</li>
            <li>tabela do fornecedor que lista o produto;</li>
            <li>produto declarado sem custo;</li>
            <li>preço do país de destino, depois o preço próprio do produto;</li>
            <li>custo padrão.</li>
          </ol>
        </>
      }
    >
      <div className={s.stack}>
        <Callout tone="info" title="Custo 0 não é grátis">
          Deixar o custo vazio ou em 0 quer dizer <b>“ainda não precificado”</b>: o produto passa a custar o
          custo padrão ({formatMoney(defaultCost, { cents: 'always' })} por unidade). Se um produto não custa nada de verdade —
          brinde, garantia, cartão digital — marque <b>sem custo</b>.
        </Callout>

        <div className={s.fieldGrid}>
          <NumField
            label="Custo padrão por unidade"
            prefix="$" k="cogs.default_cost_usd"
            value={c.default_cost_usd}
            onChange={v => update(f => setCogs(f, { default_cost_usd: v }))}
            hint="Usado por todo produto sem preço próprio."
          />
          <NumField
            label="Desconto por unidade adicional"
            prefix="$" suffix="por unidade" k="cogs.additional_unit_discount_usd"
            value={c.additional_unit_discount_usd}
            onChange={v => update(f => setCogs(f, { additional_unit_discount_usd: v }))}
            hint="Abatido de cada unidade depois da primeira no mesmo pedido. Não vale para unidades precificadas por uma tabela do fornecedor nem para produtos sem custo."
          />
        </div>

        <VolumeDiscounts form={form} update={update} />

        <div className={s.toolbar}>
          <div className={s.search}>
            <div className={`${s.box} ${s.boxSm}`}>
              <input
                className={s.input}
                value={q}
                placeholder="Buscar produto pelo nome ou ID…"
                aria-label="Buscar produto"
                onChange={e => { setQ(e.target.value); setShown(PAGE) }}
              />
            </div>
          </div>
          {/* Up to six filters: on a phone they scroll sideways instead of
              pushing the whole page wider than the screen. */}
          <div className={s.segWrap}>
            <Segmented
              ariaLabel="Mostrar produtos"
              size="sm"
              value={filter}
              onChange={v => { setFilter(v as Filter); setShown(PAGE) }}
              options={[
                { value: 'all', label: `Todos ${counts.all}` },
                { value: 'default', label: `Sem preço ${counts.default}` },
                { value: 'priced', label: `Com preço ${counts.priced}` },
                ...(counts.card ? [{ value: 'card', label: `Tabela ${counts.card}` }] : []),
                ...(counts.country ? [{ value: 'country', label: `Por país ${counts.country}` }] : []),
                ...(counts.free ? [{ value: 'free', label: `Sem custo ${counts.free}` }] : []),
              ]}
            />
          </div>
        </div>
        {unpricedTotal > 0 && (
          <p className={s.sub}>
            No período da prévia, <b><span className="num">{unpricedTotal}</span> {unpricedTotal === 1 ? 'unidade vendida caiu' : 'unidades vendidas caíram'}</b> no
            custo padrão. Os produtos que mais venderam assim aparecem primeiro na lista.
          </p>
        )}

        <div className={s.tableWrap} ref={tableRef}>
          <table className={s.ptable}>
            <caption className="sr-only">Custo por produto</caption>
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Como é precificado</th>
                <th scope="col" className={s.pcost}>Custo por unidade</th>
                <th scope="col" className={s.pfree}>Sem custo</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, shown).map(p => (
                <ProductRow
                  key={p.id}
                  item={p}
                  value={c.products[p.id] ?? ''}
                  source={sourceOf.get(p.id) ?? 'default'}
                  defaultCost={defaultCost}
                  units={unpricedUnits.get(p.id) ?? 0}
                  free={zero.has(p.id)}
                  flash={flash === p.id}
                  onCost={v => setCost(p.id, v)}
                  onFree={v => setFree(p.id, v)}
                />
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={4} className={s.empty}>Nenhum produto com esse filtro.</td></tr>
              )}
            </tbody>
          </table>
          {visible.length > shown && (
            <div className={s.more}>
              <Button size="sm" variant="ghost" onClick={() => setShown(n => n + PAGE)}>
                {visible.length - shown > PAGE
                  ? `Mostrar mais ${PAGE} (faltam ${visible.length - shown})`
                  : visible.length - shown === 1 ? 'Mostrar o último produto' : `Mostrar os últimos ${visible.length - shown} produtos`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Block>
  )
}

function ProductRow({ item, value, source, defaultCost, units, free, flash, onCost, onFree }: {
  item: CatalogueItem; value: string; source: PricingSource; defaultCost: number; units: number; free: boolean; flash: boolean
  onCost: (v: string) => void; onFree: (v: boolean) => void
}) {
  const badge = SOURCE_BADGE[source]
  return (
    <tr id={`prow-${item.id}`} data-flash={flash || undefined}>
      <td>
        <div className={s.pname}>
          <b>{item.title}</b>
          <small>
            {item.id}
            {item.status === null ? ' · fora do catálogo' : item.status !== 'active' ? ' · fora de venda' : ''}
          </small>
        </div>
      </td>
      <td>
        <div className={s.inline}>
          <Badge tone={badge.tone} icon={source === 'default' ? 'alert' : undefined}>{badge.text(defaultCost)}</Badge>
          {units > 0 && <span className="mut num" style={{ fontSize: 11.5 }}>{plural(units, 'unidade', 'unidades')} no período</span>}
        </div>
      </td>
      <td className={s.pcost}>
        <NumField
          small prefix="$" ariaLabel={`Custo por unidade de ${item.title}`}
          k={[`${productKey(item.id)}.cost_usd`, `${productKey(item.id)}.product_id`]}
          value={value}
          placeholder={`padrão ${formatMoney(defaultCost, { cents: 'always' })}`}
          onChange={onCost}
        />
      </td>
      <td className={s.pfree}>
        <Check checked={free} onChange={onFree}><span className="sr-only">{item.title} </span>sem custo</Check>
      </td>
    </tr>
  )
}

function VolumeDiscounts({ form, update }: { form: CostForm; update: Update }) {
  const rows = form.cogs.volume_discounts
  const [open, setOpen] = useState(rows.length > 0)
  const ro = useReadOnly()
  // Read-only with no discount: there is nothing to show behind the link.
  if (!open && ro) return null
  if (!open) {
    return (
      <div>
        <button type="button" className={s.linkBtn} onClick={() => setOpen(true)}>Desconto por volume (avançado)</button>
      </div>
    )
  }
  const set = (id: string, patch: Partial<CostForm['cogs']['volume_discounts'][number]>) =>
    update(f => setCogs(f, { volume_discounts: patchRow(f.cogs.volume_discounts, id, patch) }))
  return (
    <div className={s.stack}>
      <p className={s.sub}>
        <b>Desconto por volume</b> no custo padrão, a partir de um número de unidades no pedido. Só vale para lojas
        sem preço por produto, por país ou tabela do fornecedor.
      </p>
      <div className={s.rows}>
        {rows.length > 0 && (
          <div className={`${s.rowHead} ${s.colsVolume}`}><span>A partir de</span><span>Tipo</span><span>Desconto</span><span /></div>
        )}
        {rows.map(r => {
          const k = rowKey('cogs.volume_discounts', r._id)
          return (
            <div key={r._id} className={`${s.row} ${s.colsVolume}`}>
              <NumField small suffix="unid." ariaLabel="A partir de quantas unidades" k={`${k}.min_units`} value={r.min_units} onChange={v => set(r._id, { min_units: v })} />
              <SelectField small ariaLabel="Tipo de desconto" k={`${k}.discount_type`} value={r.discount_type}
                onChange={v => set(r._id, { discount_type: v })}
                options={[{ value: 'pct', label: 'percentual' }, { value: 'abs', label: 'valor por unidade' }]} />
              <NumField small prefix={r.discount_type === 'abs' ? '$' : undefined} suffix={r.discount_type === 'pct' ? '%' : undefined}
                ariaLabel="Desconto" k={`${k}.discount_value`} value={r.discount_value} onChange={v => set(r._id, { discount_value: v })} />
              <RemoveButton label="Tirar este desconto" onClick={() => update(f => setCogs(f, { volume_discounts: dropRow(f.cogs.volume_discounts, r._id) }))} />
            </div>
          )
        })}
      </div>
      <EditOnly>
      <div className={s.addRow}>
        <Button size="sm" onClick={() => update(f => setCogs(f, {
          volume_discounts: [...f.cogs.volume_discounts, { _id: newId('v'), min_units: '', discount_type: 'pct', discount_value: '' }],
        }))}>Adicionar faixa</Button>
      </div>
      </EditOnly>
    </div>
  )
}

export function ZeroCostSection({ form, update, catalogue, nameOf }: {
  form: CostForm; update: Update; catalogue: CatalogueItem[]; nameOf: (id: string) => string
}) {
  const ids = form.cogs.zero_cost_products
  const { errors, warnings } = useMessages('cogs.zero_cost_products')
  return (
    <Block
      id="sem-custo"
      title="Produtos sem custo"
      howTo="Brindes, garantias e cartões digitais: custam zero de verdade e não entram no desconto por unidade."
      info="Diferente de deixar o custo em 0, que significa “ainda não precificado” e usa o custo padrão."
    >
      <div className={s.stack}>
        <ProductChips
          ids={ids}
          nameOf={nameOf}
          onRemove={id => update(f => setCogs(f, { zero_cost_products: without(f.cogs.zero_cost_products, id) }))}
          empty="Nenhum produto declarado sem custo."
        />
        <ProductPicker
          catalogue={catalogue}
          exclude={ids}
          placeholder="Adicionar produto sem custo…"
          onPick={id => update(f => setCogs(f, { zero_cost_products: addUnique(f.cogs.zero_cost_products, id) }))}
        />
        <Msgs errors={errors} warnings={warnings} />
      </div>
    </Block>
  )
}
