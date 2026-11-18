'use client'

/**
 * "Preço por país" (a unit price per destination, freight baked in) and
 * "Taxa por pedido por país" (a flat supplier charge per order, from a date).
 *
 * MOKOO has 49 products × 45 countries: each product's list is collapsed to a
 * one-line summary and opened on demand, so the screen never renders two
 * thousand inputs at once.
 */

import { useState } from 'react'
import { Block, Button } from '@/components/ui'
import { formatMoney, plural } from '@/lib/format'
import { toNumber } from '@/lib/data/profitConfig'
import { dropRow, patchRow, setCogs, type Update } from './edit'
import { newId, rowKey, type CostForm, type CountryListRow, type CountryPriceRow, type OrderFeeRow } from './form'
import {
  CountryField, DateField, EditOnly, Msgs, NumField, ProductPicker, RemoveButton, TextField, countryName, useMessages, usePrefixMessages,
  type CatalogueItem,
} from './fields'
import { Icon } from '@/components/ui'
import s from './costs.module.css'

export function CountryPricesSection({ form, update, catalogue, nameOf }: {
  form: CostForm; update: Update; catalogue: CatalogueItem[]; nameOf: (id: string) => string
}) {
  const lists = form.cogs.country_prices
  const [open, setOpen] = useState<string | null>(null)
  const setList = (id: string, patch: Partial<CountryListRow>) => update(f => setCogs(f, { country_prices: patchRow(f.cogs.country_prices, id, patch) }))

  return (
    <Block
      id="por-pais"
      title="Preço por país"
      howTo="Quando o fornecedor cobra um preço diferente por destino (o frete vem embutido). País fora da lista usa o preço do produto."
      info="Vale para o produto em pedidos para aquele país, por unidade. Uma tabela do fornecedor que lista o produto, ou que vale para o pedido inteiro, tem prioridade."
    >
      <div className={s.stack}>
        {lists.length === 0 && <div className={s.empty}>Nenhum produto com preço por país.</div>}
        {lists.map(l => (
          <CountryList
            key={l._id}
            list={l}
            name={nameOf(l.product_id)}
            open={open === l._id}
            onToggle={() => setOpen(o => (o === l._id ? null : l._id))}
            onChange={p => setList(l._id, p)}
            onRemove={() => update(f => setCogs(f, { country_prices: dropRow(f.cogs.country_prices, l._id) }))}
          />
        ))}
        <ProductPicker
          catalogue={catalogue}
          exclude={lists.map(l => l.product_id)}
          placeholder="Adicionar preço por país para um produto…"
          onPick={pid => {
            const id = newId('c')
            update(f => setCogs(f, {
              country_prices: [...f.cogs.country_prices, { _id: id, product_id: pid, name: nameOf(pid), prices: [{ _id: newId('p'), country: '', price: '' }] }],
            }))
            setOpen(id)
          }}
        />
      </div>
    </Block>
  )
}

function CountryList({ list, name, open, onToggle, onChange, onRemove }: {
  list: CountryListRow; name: string; open: boolean; onToggle: () => void
  onChange: (p: Partial<CountryListRow>) => void; onRemove: () => void
}) {
  const k = rowKey('cogs.country_prices', list._id)
  const all = usePrefixMessages(k)
  const head = useMessages(k, `${k}.product_id`, `${k}.prices`)
  const nums = list.prices.map(p => toNumber(p.price)).filter((n): n is number => n !== null)
  const countries = list.prices.filter(p => p.country.trim()).length
  const range = nums.length ? (Math.min(...nums) === Math.max(...nums)
    ? formatMoney(nums[0], { cents: 'always' })
    : `${formatMoney(Math.min(...nums), { cents: 'always' })} a ${formatMoney(Math.max(...nums), { cents: 'always' })}`) : null
  const setPrice = (id: string, patch: Partial<CountryPriceRow>) => onChange({ prices: patchRow(list.prices, id, patch) })

  return (
    <div className={s.clist}>
      <div className={s.clistHead}>
        <button type="button" className="expand" onClick={onToggle} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', minWidth: 0, flex: 1 }}>
          <Icon name={open ? 'chevUp' : 'chev'} size={14} />
          <span style={{ minWidth: 0 }}>
            <b style={{ fontWeight: 500, fontSize: 13 }}>{name}</b>
            <span className="mut" style={{ fontSize: 12, marginLeft: 8 }}>
              {plural(countries, 'país', 'países')}{range ? ` · ${range}` : ''}
            </span>
            {all.errors.length > 0 && !open && (
              <span className="neg" style={{ fontSize: 12, marginLeft: 8 }}>
                <Icon name="alert" size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /> {plural(all.errors.length, 'problema', 'problemas')}
              </span>
            )}
          </span>
        </button>
        <EditOnly><Button size="sm" variant="ghost" icon="x" onClick={onRemove}>Remover lista</Button></EditOnly>
      </div>
      {open && (
        <div className={s.clistBody}>
          <div className={s.rows}>
            <div className={`${s.rowHead} ${s.colsCountry}`}><span>País</span><span /><span>Preço por unidade</span><span /></div>
            {list.prices.map(p => (
              <CountryPriceLine key={p._id} listKey={k} row={p} onChange={patch => setPrice(p._id, patch)}
                onRemove={() => onChange({ prices: dropRow(list.prices, p._id) })} />
            ))}
          </div>
          <Msgs errors={head.errors} warnings={head.warnings} />
          <EditOnly>
            <div className={s.addRow}>
              <Button size="sm" variant="ghost" onClick={() => onChange({ prices: [...list.prices, { _id: newId('p'), country: '', price: '' }] })}>Adicionar país</Button>
            </div>
          </EditOnly>
        </div>
      )}
    </div>
  )
}

function CountryPriceLine({ listKey, row, onChange, onRemove }: {
  listKey: string; row: CountryPriceRow; onChange: (p: Partial<CountryPriceRow>) => void; onRemove: () => void
}) {
  const raw = row.country.trim()
  // The typed code and its upper case are usually the same key: read it once.
  const m = useMessages(...new Set([`${listKey}.prices.${raw}`, `${listKey}.prices.${raw.toUpperCase()}`, `${listKey}.price#${row._id}`]))
  const errors = m.errors
  return (
    <div className={`${s.row} ${s.colsCountry}`}>
      <CountryField small value={row.country} onChange={v => onChange({ country: v })} k={`${listKey}.prices.${raw}`} />
      <span className={s.cellNote}>{countryName(row.country) ?? ''}</span>
      <NumField small prefix="$" ariaLabel={`Preço por unidade para ${raw || 'o país'}`} value={row.price} onChange={v => onChange({ price: v })} />
      <RemoveButton label={`Tirar ${raw || 'este país'}`} onClick={onRemove} />
      <div className={s.rowMsgs}><Msgs errors={errors} warnings={m.warnings} /></div>
    </div>
  )
}

export function OrderFeesSection({ form, update }: { form: CostForm; update: Update }) {
  const rows = form.cogs.order_fees
  const set = (id: string, patch: Partial<OrderFeeRow>) => update(f => setCogs(f, { order_fees: patchRow(f.cogs.order_fees, id, patch) }))
  return (
    <Block
      id="taxa-pedido"
      title="Taxa fixa do fornecedor por país"
      howTo="Um valor cobrado uma vez por pedido para aquele destino, a partir de uma data (ex.: a taxa de manuseio da UE). Negativo = abatimento."
      info="Cobrada uma vez por pedido, qualquer que seja o número de unidades. Sem data, vale para todos os pedidos. Não se aplica quando uma tabela do fornecedor preça o pedido inteiro."
    >
      <div className={s.rows}>
        {rows.length === 0 && <div className={s.empty}>Nenhuma taxa por pedido.</div>}
        {rows.length > 0 && (
          <div className={`${s.rowHead} ${s.colsFee}`}><span>País</span><span>Descrição</span><span>Por pedido</span><span>A partir de</span><span /></div>
        )}
        {rows.map(r => <OrderFeeLine key={r._id} row={r} onChange={p => set(r._id, p)} onRemove={() => update(f => setCogs(f, { order_fees: dropRow(f.cogs.order_fees, r._id) }))} />)}
      </div>
      <EditOnly>
        <div className={s.addRow}>
          <Button size="sm" onClick={() => update(f => setCogs(f, {
            order_fees: [...f.cogs.order_fees, { _id: newId('f'), country_code: '', name: '', amount_usd: '', effective_from: '' }],
          }))}>Adicionar taxa</Button>
        </div>
      </EditOnly>
    </Block>
  )
}

function OrderFeeLine({ row, onChange, onRemove }: { row: OrderFeeRow; onChange: (p: Partial<OrderFeeRow>) => void; onRemove: () => void }) {
  const k = rowKey('cogs.order_fees', row._id)
  const m = usePrefixMessages(k)
  return (
    <div className={`${s.row} ${s.colsFee}`}>
      <CountryField small value={row.country_code} onChange={v => onChange({ country_code: v })} k={`${k}.country_code`} />
      <TextField small quiet ariaLabel="Descrição da taxa" placeholder={countryName(row.country_code) ?? 'Descrição (opcional)'} value={row.name} onChange={v => onChange({ name: v })} />
      <NumField small quiet prefix="$" ariaLabel="Valor por pedido" value={row.amount_usd} onChange={v => onChange({ amount_usd: v })} k={`${k}.amount_usd`} />
      <DateField small quiet ariaLabel="A partir de (opcional)" value={row.effective_from} onChange={v => onChange({ effective_from: v })} k={`${k}.effective_from`} />
      <RemoveButton label={`Tirar a taxa de ${row.country_code || 'este país'}`} onClick={onRemove} />
      <div className={s.rowMsgs}><Msgs errors={m.errors} warnings={m.warnings} /></div>
    </div>
  )
}
