'use client'

/** Taxas, Embalagem, Frete and Custos extras: the short sections of the cost screen. */

import { Block, Button } from '@/components/ui'
import { dropRow, patchRow, setCogs, setShipping, setShopify, addUnique, without, type Update } from './edit'
import { newId, rowKey, type CostForm, type ExtraRow, type FrequencyKey, type RateRow } from './form'
import {
  CountryField, Msgs, NumField, ProductChips, ProductPicker, Radio, RemoveButton, SelectField, TextField, countryName,
  useMessages, usePrefixMessages, type CatalogueItem,
} from './fields'
import s from './costs.module.css'

export function FeesSection({ form, update }: { form: CostForm; update: Update }) {
  const f = form.shopify
  return (
    <Block
      id="taxas"
      title="Taxas da Shopify e do pagamento"
      howTo="Percentuais sobre o valor de cada pedido, mais o valor fixo por pedido do processador de pagamento."
      info="Taxa de transação: o que a Shopify cobra quando o pagamento não é pelo Shopify Payments (ou o plano cobra por venda). Processamento: o que o meio de pagamento cobra (ex.: 2,9% + $0,30)."
    >
      <div className={s.fieldGrid}>
        <NumField label="Taxa de transação da Shopify" suffix="%" k="shopify.transaction_fee_pct"
          value={f.transaction_fee_pct} onChange={v => update(x => setShopify(x, { transaction_fee_pct: v }))} hint="Sobre o valor do pedido." />
        <NumField label="Processamento do pagamento" suffix="%" k="shopify.payment_processing_pct"
          value={f.payment_processing_pct} onChange={v => update(x => setShopify(x, { payment_processing_pct: v }))} hint="Sobre o valor do pedido." />
        <NumField label="Valor fixo por pedido" prefix="$" k="shopify.payment_processing_fixed"
          value={f.payment_processing_fixed} onChange={v => update(x => setShopify(x, { payment_processing_fixed: v }))} hint="Cobrado uma vez em cada pedido." />
      </div>
    </Block>
  )
}

export function PackagingSection({ form, update, catalogue, nameOf }: {
  form: CostForm; update: Update; catalogue: CatalogueItem[]; nameOf: (id: string) => string
}) {
  const c = form.cogs
  const scopeMsgs = useMessages('cogs.packaging_per_unit_products')
  return (
    <Block
      id="embalagem"
      title="Embalagem"
      howTo="Um valor por pedido (a caixa do envio) e, se for o caso, um valor por unidade de alguns produtos."
      info="Entra no custo do produto, como o fornecedor cobra. Também vale sob uma tabela do fornecedor."
    >
      <div className={s.stack}>
        <div className={s.fieldGrid}>
          <NumField label="Por pedido" prefix="$" k="cogs.packaging_cost_usd" value={c.packaging_cost_usd}
            onChange={v => update(f => setCogs(f, { packaging_cost_usd: v }))} hint="Uma vez em cada pedido." />
          <NumField label="Por unidade" prefix="$" k="cogs.packaging_per_unit_usd" value={c.packaging_per_unit_usd}
            onChange={v => update(f => setCogs(f, { packaging_per_unit_usd: v }))} hint="Em cada unidade dos produtos abaixo." />
        </div>
        <div className={s.stack}>
          <span className={s.fieldLabel}>Embalagem por unidade vale para</span>
          <div className={s.radioRow}>
            <Radio name="pack-scope" value="all" current={c.packaging_scope} onChange={v => update(f => setCogs(f, { packaging_scope: v }))}>todos os produtos</Radio>
            <Radio name="pack-scope" value="some" current={c.packaging_scope} onChange={v => update(f => setCogs(f, { packaging_scope: v }))}>só os produtos escolhidos</Radio>
          </div>
          {c.packaging_scope === 'some' && (
            <>
              <ProductChips ids={c.packaging_per_unit_products} nameOf={nameOf}
                onRemove={id => update(f => setCogs(f, { packaging_per_unit_products: without(f.cogs.packaging_per_unit_products, id) }))} />
              <ProductPicker catalogue={catalogue} exclude={c.packaging_per_unit_products} placeholder="Adicionar produto com esta embalagem…"
                onPick={id => update(f => setCogs(f, { packaging_per_unit_products: addUnique(f.cogs.packaging_per_unit_products, id) }))} />
            </>
          )}
          <Msgs errors={scopeMsgs.errors} warnings={scopeMsgs.warnings} />
        </div>
      </div>
    </Block>
  )
}

export function ShippingSection({ form, update }: { form: CostForm; update: Update }) {
  const sh = form.shipping
  const set = (id: string, patch: Partial<RateRow>) => update(f => setShipping(f, { rates: patchRow(f.shipping.rates, id, patch) }))
  return (
    <Block
      id="frete"
      title="Frete"
      howTo="O que você paga de envio por pedido, quando o fornecedor não o embute no preço. País fora da lista usa o valor padrão."
      info="Custo de envio por pedido. Não confunda com o frete que o cliente paga: esse já está dentro das vendas."
    >
      <div className={s.stack}>
        <div className={s.fieldGrid}>
          <NumField label="Frete padrão por pedido" prefix="$" k="shipping.default_rate_usd" value={sh.default_rate_usd}
            onChange={v => update(f => setShipping(f, { default_rate_usd: v }))} hint="0 quando o frete vem no preço do fornecedor." />
        </div>
        <div className={s.rows}>
          {sh.rates.length > 0 && (
            <div className={`${s.rowHead} ${s.colsRate}`}><span>País</span><span>Descrição</span><span>Por pedido</span><span /></div>
          )}
          {sh.rates.map(r => <RateLine key={r._id} row={r} onChange={p => set(r._id, p)} onRemove={() => update(f => setShipping(f, { rates: dropRow(f.shipping.rates, r._id) }))} />)}
        </div>
        <div className={s.addRow}>
          <Button size="sm" onClick={() => update(f => setShipping(f, {
            rates: [...f.shipping.rates, { _id: newId('r'), country_code: '', name: '', cost_usd: '' }],
          }))}>Adicionar frete por país</Button>
        </div>
      </div>
    </Block>
  )
}

function RateLine({ row, onChange, onRemove }: { row: RateRow; onChange: (p: Partial<RateRow>) => void; onRemove: () => void }) {
  const k = rowKey('shipping.rates', row._id)
  const m = usePrefixMessages(k)
  return (
    <div className={`${s.row} ${s.colsRate}`}>
      <CountryField small value={row.country_code} onChange={v => onChange({ country_code: v })} k={`${k}.country_code`} />
      <TextField small quiet ariaLabel="Descrição" placeholder={countryName(row.country_code) ?? 'Descrição (opcional)'} value={row.name} onChange={v => onChange({ name: v })} />
      <NumField small quiet prefix="$" ariaLabel="Frete por pedido" value={row.cost_usd} onChange={v => onChange({ cost_usd: v })} k={`${k}.cost_usd`} />
      <RemoveButton label={`Tirar o frete de ${row.country_code || 'este país'}`} onClick={onRemove} />
      <div className={s.rowMsgs}><Msgs errors={m.errors} warnings={m.warnings} /></div>
    </div>
  )
}

const FREQ: { value: FrequencyKey; label: string }[] = [
  { value: 'monthly', label: 'por mês' },
  { value: 'annual', label: 'por ano' },
  { value: 'per_order', label: 'por pedido' },
]

export function ExtrasSection({ form, update }: { form: CostForm; update: Update }) {
  const rows = form.extra_costs
  const set = (id: string, patch: Partial<ExtraRow>) => update(f => ({ ...f, extra_costs: patchRow(f.extra_costs, id, patch) }))
  return (
    <Block
      id="extras"
      title="Custos extras"
      howTo="Apps, equipe e ferramentas. Mensais e anuais viram custo fixo, rateado por dia; por pedido entra em cada pedido."
      info="Um custo mensal é dividido pelos dias do mês; um anual, pelos dias do ano. O dia de hoje recebe só a parte já decorrida."
    >
      <div className={s.rows}>
        {rows.length === 0 && <div className={s.empty}>Nenhum custo extra.</div>}
        {rows.length > 0 && (
          <div className={`${s.rowHead} ${s.colsExtra}`}><span>Nome</span><span>Valor</span><span>Frequência</span><span /></div>
        )}
        {rows.map(r => <ExtraLine key={r._id} row={r} onChange={p => set(r._id, p)} onRemove={() => update(f => ({ ...f, extra_costs: dropRow(f.extra_costs, r._id) }))} />)}
      </div>
      <div className={s.addRow}>
        <Button size="sm" onClick={() => update(f => ({
          ...f, extra_costs: [...f.extra_costs, { _id: newId('e'), name: '', amount_usd: '', frequency: 'monthly' }],
        }))}>Adicionar custo</Button>
      </div>
    </Block>
  )
}

function ExtraLine({ row, onChange, onRemove }: { row: ExtraRow; onChange: (p: Partial<ExtraRow>) => void; onRemove: () => void }) {
  const k = rowKey('extra_costs', row._id)
  const m = usePrefixMessages(k)
  return (
    <div className={`${s.row} ${s.colsExtra}`}>
      <TextField small quiet ariaLabel="Nome do custo" placeholder="ex.: plano da Shopify" value={row.name} onChange={v => onChange({ name: v })} k={`${k}.name`} />
      <NumField small quiet prefix="$" ariaLabel="Valor" value={row.amount_usd} onChange={v => onChange({ amount_usd: v })} k={`${k}.amount_usd`} />
      <SelectField small quiet ariaLabel="Frequência" value={row.frequency} onChange={v => onChange({ frequency: v })} options={FREQ} k={`${k}.frequency`} />
      <RemoveButton label={`Tirar ${row.name || 'este custo'}`} onClick={onRemove} />
      <div className={s.rowMsgs}><Msgs errors={m.errors} warnings={m.warnings} /></div>
    </div>
  )
}
