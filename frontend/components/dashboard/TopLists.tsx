/**
 * TopProducts and TopCountries — the five biggest products and countries of the
 * period, from the same engine pass as the verdict (lib/views/store), with
 * captions that say what the numbers are and are not. Server components.
 * An empty window that is not "no sales" (before the first sale, or after an
 * archived store's archive day: `empty`, ./emptyWindow) says why instead of
 * "Nenhum pedido no período".
 */

import Link from 'next/link'
import type { PageContext } from '@/lib/views/page'
import type { StoreSummary } from '@/lib/views/store'
import { countryName, SMALL_SAMPLE, TERRITORIES_NOTE } from '@/lib/data/countries'
import { formatCount, formatMoney, formatPct, plural } from '@/lib/format'
import { Badge, Block, EmptyState, Icon, Money, initials } from '@/components/ui'
import { emptyWindowText, type EmptyWindow } from './emptyWindow'
import s from './dashboard.module.css'

/** The empty list's state: the verdict's reason when it has one. */
function EmptyList({ ctx, empty, icon, title, text }: {
  ctx: PageContext; empty: EmptyWindow | null; icon: 'box' | 'globe'; title: string; text: string
}) {
  const t = empty ? emptyWindowText(empty, ctx.rangeLabel) : null
  return <EmptyState compact icon={t ? 'clock' : icon} title={t ? t.title : title}>{t ? t.text : text}</EmptyState>
}

function Share({ pct }: { pct: number | null }) {
  return (
    <div className={s.shareTrack} aria-hidden="true">
      <span className={s.shareFill} style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
    </div>
  )
}

export function TopProducts({ ctx, summary, empty = null }: { ctx: PageContext; summary: StoreSummary; empty?: EmptyWindow | null }) {
  const list = summary.products
  const configured = summary.pnl.configured
  const link = <Link className={s.link} href={ctx.hrefWith('/products')}>Ver todos os produtos <Icon name="arrowRight" size={12} /></Link>
  return (
    <Block
      title="O que mais vendeu"
      howTo={`${list.rows.length === 1 ? 'O produto' : `Os ${list.rows.length || 5} produtos`} com mais receita em ${ctx.rangeLabel}. A receita de cada pedido é dividida entre os itens pelo preço deles, com frete e imposto juntos — por isso os produtos somam a receita da loja.`}
      info={configured
        ? 'Margem antes dos anúncios = receita do item − custo do produto, do frete e das taxas que cabem a ele. Os anúncios não são rateados por produto aqui: veja a página Produtos.'
        : 'Sem custos configurados, a margem de cada produto não é conhecida: só a receita aparece.'}
      actions={link}
      footer={list.rows.length ? (
        <div className={s.footLinks}>
          <span>
            {/* One decimal near the top: "somam 100%" next to "Mais 2 produtos: $15,97" (Hibikura) contradicted itself. */}
            {list.topShare !== null && <>{list.rows.length === 1 ? 'Este produto soma' : `Estes ${list.rows.length} somam`} <b>{formatPct(list.topShare, { digits: list.rest.count > 0 && list.topShare >= 99.5 ? 1 : 0 })}</b> da receita.</>}
            {list.rest.count > 0 && <> Mais {plural(list.rest.count, 'produto', 'produtos')}: <b>{formatMoney(list.rest.revenue)}</b>.</>}
          </span>
        </div>
      ) : undefined}
    >
      {list.rows.length === 0 ? (
        <EmptyList ctx={ctx} empty={empty} icon="box" title="Nenhum produto vendido no período" text={`Sem pedidos em ${ctx.rangeLabel}.`} />
      ) : (
        <div className={s.rank}>
          {list.rows.map(p => (
            <div key={p.key} className={s.rankRow}>
              <span className={s.code} aria-hidden="true">{initials(p.title)}</span>
              <div style={{ minWidth: 0 }}>
                <div className={s.rankName} title={p.title}>{p.title}</div>
                <div className={s.rankMeta}>
                  <span><b>{formatCount(p.units)}</b> {p.units === 1 ? 'unidade' : 'unidades'} · {plural(p.orders, 'pedido', 'pedidos')}</span>
                  {configured && p.contributionMargin !== null && (
                    <span>margem antes dos anúncios <b className={p.contribution < 0 ? 'neg' : undefined}>{formatPct(p.contributionMargin, { digits: 0 })}</b></span>
                  )}
                </div>
                <Share pct={p.share} />
              </div>
              <div className={s.rankVal}>
                <Money value={p.revenue} />
                <span className={s.rankShare}>{formatPct(p.share)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Block>
  )
}

export function TopCountries({ ctx, summary, empty = null }: { ctx: PageContext; summary: StoreSummary; empty?: EmptyWindow | null }) {
  const list = summary.countries
  const hasUs = list.rows.some(r => r.country === 'US')
  return (
    <Block
      title="Onde estão os compradores"
      eyebrow="pedidos reais da Shopify"
      // A caveat: kept visible on one line, the whole sentence in the ⓘ.
      howTo="Endereço de entrega — não a divisão por país do Meta"
      howToVisible
      info={<>Endereço de entrega dos pedidos reais da Shopify em {ctx.rangeLabel} — não a divisão por país do Meta, que não serve para decidir geografia. {TERRITORIES_NOTE} Com menos de {SMALL_SAMPLE} pedidos um país é amostra pequena: não decida por ele sozinho.</>}
      actions={<Link className={s.link} href={ctx.hrefWith('/countries')}>Ver países e clientes <Icon name="arrowRight" size={12} /></Link>}
      footer={list.rows.length ? (
        <div className={s.footLinks}>
          <span>
            {list.rest.count > 0
              ? <>Mais {plural(list.rest.count, 'país', 'países')}: <b>{formatMoney(list.rest.revenue)}</b> em {plural(list.rest.orders, 'pedido', 'pedidos')}.</>
              : <>Todos os países com pedidos estão na lista.</>}
            {hasUs && ' EUA inclui Porto Rico e outros territórios.'}
          </span>
        </div>
      ) : undefined}
    >
      {list.rows.length === 0 ? (
        <EmptyList ctx={ctx} empty={empty} icon="globe" title="Nenhum pedido no período" text={`Sem endereços de entrega em ${ctx.rangeLabel}.`} />
      ) : (
        <div className={s.rank}>
          {list.rows.map(c => (
            <div key={c.country} className={s.rankRow}>
              <span className={s.code} aria-hidden="true">{c.country === '??' ? '··' : c.country}</span>
              <div style={{ minWidth: 0 }}>
                <div className={s.rankName}>{c.country === '??' ? 'País não informado' : countryName(c.country)}</div>
                <div className={s.rankMeta}>
                  <span>{plural(c.orders, 'pedido', 'pedidos')} · ticket <b>{formatMoney(c.aov)}</b></span>
                  {c.orders < SMALL_SAMPLE && <Badge tone="mut" title={`Menos de ${SMALL_SAMPLE} pedidos: pouca amostra para decidir`}>amostra pequena</Badge>}
                </div>
                <Share pct={c.share} />
              </div>
              <div className={s.rankVal}>
                <Money value={c.revenue} />
                <span className={s.rankShare}>{formatPct(c.share)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Block>
  )
}
