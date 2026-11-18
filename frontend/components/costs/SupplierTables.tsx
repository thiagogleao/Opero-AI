'use client'

/**
 * "Tabelas do fornecedor": price lists quoted per ORDER by unit count, each in
 * force from a date. Every card is keyed by its stable id and every price box
 * is controlled, so deleting one card can never leave its prices in another
 * (PE17 / L3). A card either prices the whole order (and then the engine
 * ignores product costs, country prices and the unit discount) or only the
 * products it lists — the old screen said "pedido inteiro" for Hibikura's card,
 * which lists one product.
 */

import { Badge, Block, Button, Callout } from '@/components/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { toNumber } from '@/lib/data/profitConfig'
import { addUnique, dropRow, patchRow, setCogs, without, type Update } from './edit'
import { newId, rowKey, type CostForm, type StepRow, type TierRow } from './form'
import {
  DateField, EditOnly, Msgs, NumField, ProductChips, ProductPicker, Radio, RemoveButton, TextField, useMessages, usePrefixMessages,
  type CatalogueItem,
} from './fields'
import s from './costs.module.css'

export function SupplierTablesSection({ form, update, catalogue, nameOf, today }: {
  form: CostForm; update: Update; catalogue: CatalogueItem[]; nameOf: (id: string) => string; today: string
}) {
  const tiers = form.cogs.price_tiers
  const setTier = (id: string, patch: Partial<TierRow>) => update(f => setCogs(f, { price_tiers: patchRow(f.cogs.price_tiers, id, patch) }))
  const { errors } = useMessages('cogs.price_tiers')

  return (
    <Block
      id="tabelas"
      title="Tabelas do fornecedor"
      howTo="Preço por pedido conforme o número de unidades — do pedido inteiro ou só dos produtos da tabela —, valendo a partir de uma data. Pedidos anteriores à data não mudam."
      info={
        <>
          Uma tabela <b>para o pedido inteiro</b> preça todos os itens pela curva de unidades e ignora o custo por produto,
          o preço por país, a taxa por pedido e o desconto por unidade. Uma tabela <b>só para alguns produtos</b> preça
          esses produtos pela própria curva; o resto do pedido volta a ser item a item. Duas tabelas para os mesmos
          produtos: vale a mais recente já em vigor.
        </>
      }
    >
      <div className={s.cards}>
        {tiers.length === 0 && <div className={s.empty}>Nenhuma tabela. Os produtos são precificados item a item.</div>}
        {tiers.map(t => (
          <TierCard
            key={t._id}
            tier={t}
            today={today}
            catalogue={catalogue}
            nameOf={nameOf}
            onChange={patch => setTier(t._id, patch)}
            onRemove={() => update(f => setCogs(f, { price_tiers: dropRow(f.cogs.price_tiers, t._id) }))}
          />
        ))}
        <Msgs errors={errors} />
        <EditOnly>
        <div className={s.addRow}>
          <Button size="sm" onClick={() => update(f => setCogs(f, {
            price_tiers: [...f.cogs.price_tiers, {
              _id: newId('t'), label: '', effective_from: today,
              // A new card starts limited to chosen products: a whole-order card
              // overrides every other cost, so that has to be a deliberate choice.
              scope: 'some', product_ids: [],
              steps: [1, 2, 3].map(u => ({ _id: newId('s'), units: String(u), price: '' })),
              extra_unit_usd: '',
            }],
          }))}>Adicionar tabela</Button>
        </div>
        </EditOnly>
      </div>
    </Block>
  )
}

function TierCard({ tier, today, catalogue, nameOf, onChange, onRemove }: {
  tier: TierRow; today: string; catalogue: CatalogueItem[]; nameOf: (id: string) => string
  onChange: (patch: Partial<TierRow>) => void; onRemove: () => void
}) {
  const k = rowKey('cogs.price_tiers', tier._id)
  const scope = usePrefixMessages(`${k}.product_ids`)
  const general = useMessages(`${k}.order_prices`, k)
  const setStep = (id: string, patch: Partial<StepRow>) => onChange({ steps: patchRow(tier.steps, id, patch) })
  const future = tier.effective_from > today
  const sorted = [...tier.steps].sort((a, b) => (toNumber(a.units) ?? 1e9) - (toNumber(b.units) ?? 1e9))
  const top = sorted.filter(x => x.units.trim()).pop()

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div className={s.cardTitle}>
          {tier.label.trim() || 'Tabela sem nome'}
          {tier.scope === 'all'
            ? <Badge tone="warn" icon="alert">pedido inteiro</Badge>
            : <Badge tone="info">{tier.product_ids.length} {tier.product_ids.length === 1 ? 'produto' : 'produtos'}</Badge>}
          {/^\d{4}-\d{2}-\d{2}$/.test(tier.effective_from) && (
            <Badge tone={future ? 'neu' : 'mut'}>{future ? 'começa' : 'desde'} {formatDate(tier.effective_from, today)}</Badge>
          )}
        </div>
        <EditOnly><Button size="sm" variant="ghost" icon="x" onClick={onRemove}>Remover tabela</Button></EditOnly>
      </div>

      <div className={s.fieldGrid}>
        <TextField label="Nome" placeholder="ex.: Squishies (tudo exceto o Needoh Advent)" k={`${k}.label`} value={tier.label} onChange={v => onChange({ label: v })} />
        <DateField label="Vale a partir de" k={`${k}.effective_from`} value={tier.effective_from} onChange={v => onChange({ effective_from: v })}
          hint="Pedidos dessa data em diante, no fuso da loja." />
      </div>

      <div className={s.stack}>
        <span className={s.fieldLabel}>Vale para</span>
        <div className={s.radioRow}>
          <Radio name={`${k}-scope`} value="some" current={tier.scope} onChange={v => onChange({ scope: v })}>só os produtos escolhidos</Radio>
          <Radio name={`${k}-scope`} value="all" current={tier.scope} onChange={v => onChange({ scope: v })}>o pedido inteiro (todos os produtos)</Radio>
        </div>
        {tier.scope === 'all' ? (
          <Callout tone="warn" title="Esta tabela substitui todos os outros custos de produto">
            Desde a data acima, todo pedido é precificado só por esta curva: custo por produto, preço por país, taxa por
            pedido e desconto por unidade deixam de valer.
          </Callout>
        ) : (
          <>
            <ProductChips ids={tier.product_ids} nameOf={nameOf} onRemove={id => onChange({ product_ids: without(tier.product_ids, id) })} />
            <ProductPicker catalogue={catalogue} exclude={tier.product_ids} placeholder="Adicionar produto a esta tabela…"
              onPick={id => onChange({ product_ids: addUnique(tier.product_ids, id) })} />
          </>
        )}
        <Msgs errors={scope.errors} warnings={scope.warnings} />
      </div>

      <div className={s.stack}>
        <span className={s.fieldLabel}>Preço do pedido por número de unidades</span>
        <div className={s.steps}>
          {tier.steps.map(st => <StepInput key={st._id} tierKey={k} step={st} onChange={p => setStep(st._id, p)} onRemove={() => onChange({ steps: dropRow(tier.steps, st._id) })} />)}
        </div>
        <Msgs errors={general.errors} warnings={general.warnings} />
        <EditOnly>
        <div className={s.inline}>
          <Button size="sm" variant="ghost" onClick={() => {
            const next = Math.max(0, ...tier.steps.map(x => toNumber(x.units) ?? 0)) + 1
            onChange({ steps: [...tier.steps, { _id: newId('s'), units: String(next), price: '' }] })
          }}>Adicionar faixa</Button>
        </div>
        </EditOnly>
      </div>

      <div className={s.fieldGrid}>
        <NumField
          label={`Cada unidade além de ${top ? `${top.units} unid.` : 'última faixa'}`}
          prefix="$" k={`${k}.extra_unit_usd`} value={tier.extra_unit_usd} onChange={v => onChange({ extra_unit_usd: v })}
          hint={top && toNumber(top.price) !== null
            ? `Ex.: ${Number(top.units) + 1} unidades = ${formatMoney((toNumber(top.price) ?? 0) + (toNumber(tier.extra_unit_usd) ?? 0), { cents: 'always' })}`
            : 'Somado ao preço da maior faixa, por unidade extra.'}
        />
      </div>
    </div>
  )
}

function StepInput({ tierKey, step, onChange, onRemove }: {
  tierKey: string; step: StepRow; onChange: (p: Partial<StepRow>) => void; onRemove: () => void
}) {
  const u = step.units.trim()
  const m = useMessages(`${tierKey}.order_prices.${u}`, `${tierKey}.step#${step._id}`)
  // An empty box says "Informe o preço…" and a bad value "Preço inválido…",
  // straight from the validator (lib/data/profitConfig.ts).
  const errors = m.errors
  const unitsLabel = `Unidades no pedido (faixa)`
  return (
    <div className={s.step}>
      <NumField small suffix="un" ariaLabel={unitsLabel} value={step.units} onChange={v => onChange({ units: v.replace(/[^\d]/g, '') })} />
      <NumField small prefix="$" ariaLabel={`Preço do pedido com ${u || '?'} unidade(s)`} value={step.price} onChange={v => onChange({ price: v })} />
      <RemoveButton label={`Tirar a faixa de ${u || '?'} unidade(s)`} onClick={onRemove} />
      <div className={s.stepMsgs}><Msgs errors={errors} warnings={m.warnings} /></div>
    </div>
  )
}
