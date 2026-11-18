'use client'

/**
 * Detail tabs (campanhas, criativos, produtos, países, clientes), fetched from
 * GET /api/mobile/detail when a tab is open, refetched when the store or the
 * period changes, with loading, error-and-retry and empty states. A tab never
 * shows another selection's list as if it were this one's: an answer for an
 * old selection is dimmed under "Carregando…".
 */

import { useState } from 'react'
import {
  Block, Button, Callout, Chip, EmptyState, ErrorState, Money, RoasGauge, Skeleton,
} from '@/components/ui'
import { HorizontalBars, MiniBars } from '@/components/charts'
import { formatCount, formatMoney, formatPct, formatRangeLabel, formatRelativeTime, formatRoas, plural } from '@/lib/format'
import type { CampaignAction } from '@/lib/campaignSignal'
import type { Signal } from '@/lib/creativeSignal'
import type {
  CampaignsDetail, CountriesDetail, CreativesDetail, CustomersDetail, DetailSection, MobileDetailResponse, ProductsDetail,
} from '@/lib/views/mobileDetail'
import { TABS, type Selection } from '../_lib/selection'
import { useDetail } from '../_lib/useMobileData'
import { StoreName } from './Home'
import s from '../m.module.css'

const ACTION_CHIP: Record<CampaignAction, { tone: 'pos' | 'neg' | 'neu' | 'info'; icon: 'up' | 'down' | 'ring' | 'clock' }> = {
  escalar: { tone: 'pos', icon: 'up' }, cortar: { tone: 'neg', icon: 'down' }, manter: { tone: 'neu', icon: 'ring' }, observar: { tone: 'info', icon: 'clock' },
}
const SIGNAL_CHIP: Record<Signal, { tone: 'pos' | 'neg' | 'neu' | 'warn'; icon: 'up' | 'down' | 'ring' | 'swap' }> = {
  scale: { tone: 'pos', icon: 'up' }, kill: { tone: 'neg', icon: 'down' }, refresh: { tone: 'warn', icon: 'swap' }, ok: { tone: 'neu', icon: 'ring' },
}

export function DetailTabs({ sel, aba, onTab, forceSignal, pollSignal, homeRange, now, scopeName }: {
  sel: Selection
  aba: DetailSection | null
  onTab: (t: DetailSection | null) => void
  forceSignal: number
  pollSignal: number
  /** "from|to" of the home answer on screen, only when it answers this selection. */
  homeRange: string | null
  now: number
  scopeName: string
}) {
  const d = useDetail(aba, sel, forceSignal, pollSignal, homeRange)
  const current = d.data && d.dataKey === d.key ? d.data : null
  const stale = d.data && d.dataKey !== d.key ? d.data : null
  const error = d.error && d.errorKey === d.key ? d.error : null
  const loading = d.loadingKey === d.key && d.key !== null
  const label = TABS.find(t => t.key === aba)?.label

  return (
    <section aria-label="Detalhes" className={s.stack}>
      <div className={s.secLabel}>Detalhes<span>{aba ? `${label} · ${scopeName}` : 'toque numa aba para abrir'}</span></div>
      <div className={s.tabs} role="tablist" aria-label="Detalhes">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" className={s.tab} aria-selected={aba === t.key} aria-controls="m-detail-panel"
            onClick={() => onTab(aba === t.key ? null : t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {aba && (
        <div id="m-detail-panel" role="tabpanel" aria-busy={loading || undefined} className={s.stack}>
          {error && !current ? (
            <Block title={label ?? ''}>
              <ErrorState
                compact
                title={error.kind === 'session' ? 'Sessão expirada neste aparelho' : `Não foi possível carregar ${label?.toLowerCase()}`}
                action={error.kind === 'session' ? undefined : <Button icon="refresh" onClick={d.reload}>Tentar de novo</Button>}
              >
                {error.kind === 'session' ? 'Abra o link de acesso de novo neste aparelho.' : error.message}
              </ErrorState>
            </Block>
          ) : current ? (
            <>
              <div className={s.tabMeta}>
                <span>{current.rangeLabel}{current.partial ? ' · parcial' : ''}</span>
                <span>{loading ? 'atualizando…' : d.fetchedAt && now ? `atualizado ${formatRelativeTime(new Date(d.fetchedAt), new Date(now))}` : ''}</span>
              </div>
              {error && <Callout tone="warn" title="Não atualizou">{error.message}. Mostrando a lista anterior. <button type="button" className={s.linkBtn} onClick={d.reload}>Tentar de novo</button></Callout>}
              <Section data={current} />
            </>
          ) : (
            <div className={s.stack}>
              <div className={s.strip + ' ' + s.stripInfo} role="status" style={{ margin: 0 }}>
                <span className={`${s.spin} ${s.stripIcon}`} aria-hidden="true" />
                <span>Carregando {label?.toLowerCase()} de {scopeName}…{stale && <small>A lista abaixo ainda é da seleção anterior.</small>}</span>
                <span />
              </div>
              {stale ? <div className={s.dim} aria-hidden="true" inert><Section data={stale} /></div> : <TabSkeleton />}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function TabSkeleton() {
  return (
    <Block title={<Skeleton width={140} height={14} />}>
      <div style={{ display: 'grid', gap: 12 }}>
        {[0, 1, 2, 3].map(i => <div key={i} style={{ display: 'grid', gap: 6 }}><Skeleton width="70%" height={13} /><Skeleton width="45%" height={11} /></div>)}
      </div>
    </Block>
  )
}

function FailedStores({ data }: { data: MobileDetailResponse }) {
  if (!data.failedStores.length) return null
  return (
    <Callout tone="warn" title="Faltam lojas nesta lista">
      {data.failedStores.map(f => f.name).join(', ')} não {data.failedStores.length > 1 ? 'responderam' : 'respondeu'}: os números abaixo não as incluem.
    </Callout>
  )
}

function Section({ data }: { data: MobileDetailResponse }) {
  return (
    <>
      <FailedStores data={data} />
      {data.section === 'campanhas' && <Campaigns d={data} />}
      {data.section === 'criativos' && <Creatives d={data} />}
      {data.section === 'produtos' && <Products d={data} />}
      {data.section === 'paises' && <Countries d={data} />}
      {data.section === 'clientes' && <Customers d={data} />}
    </>
  )
}

/**
 * A list thumbnail. Meta's thumbnail URLs are signed and expire (403 a few
 * days later): a failed one falls back to the empty tile instead of the
 * browser's broken-image icon.
 */
function Thumb({ src, noReferrer }: { src: string | null; noReferrer?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <span className={s.thumb} aria-hidden="true" />
  // eslint-disable-next-line @next/next/no-img-element -- Meta/Shopify CDN images, not in next/image's allow-list
  return <img src={src} alt="" className={s.thumb} loading="lazy" referrerPolicy={noReferrer ? 'no-referrer' : undefined} onError={() => setFailed(src)} />
}

function useMore(total: number, first = 10) {
  const [all, setAll] = useState(false)
  return { limit: all ? total : first, all, toggle: () => setAll(v => !v), needed: total > first }
}

// ─── Campanhas ────────────────────────────────────────────────────────────────

function Campaigns({ d }: { d: CampaignsDetail }) {
  const more = useMore(d.campaigns.length)
  const several = d.stores.length > 1
  const t = d.totals
  const windows = d.decisionWindows.map(w => `${w.label}${d.decisionWindows.length > 1 ? ` (${w.stores.join(', ')})` : ''}`).join('; ')
  const gaps = d.storeNotes.filter(n => n.metaVsStoreRevenueGap !== null && Math.abs(n.metaVsStoreRevenueGap) >= 10)
  return (
    <Block
      title={`Campanhas · ${formatCount(d.totalCampaigns)}`}
      howTo={`A ação é julgada nos últimos 7 dias fechados (${windows}); o dinheiro, no período escolhido.`}
      info={<><p>{d.formula}</p>{(['cortar', 'escalar', 'manter', 'observar'] as CampaignAction[]).map(a => <p key={a} style={{ marginTop: 6 }}><b>{a[0].toUpperCase() + a.slice(1)}:</b> {d.rules[a]}</p>)}</>}
      infoLabel="Como cada ação é decidida"
      flush={d.campaigns.length > 0}
      footer={gaps.length ? gaps.map(g => `${g.store}: o Meta credita ${formatPct(Math.abs(g.metaVsStoreRevenueGap!), { digits: 0 })} ${g.metaVsStoreRevenueGap! > 0 ? 'mais' : 'menos'} vendas do que a loja registrou.`).join(' ') : undefined}
    >
      {d.campaigns.length === 0 ? (
        <EmptyState compact icon="camp" title="Nenhuma campanha com gasto no período" />
      ) : (
        <>
          <div style={{ padding: '0 16px 12px' }} className={s.metrics}>
            <span>Gasto <b>{formatMoney(t.spend)}</b></span>
            <span>Receita pelo Meta <b>{formatMoney(t.purchaseValue)}</b></span>
            <span>Lucro estimado <b><Money value={t.estimatedProfit} tone="auto" /></b></span>
            {t.unpricedSpend > 0 && <span>Sem margem para estimar <b>{formatMoney(t.unpricedSpend)}</b></span>}
          </div>
          <ul className={s.list} style={{ borderTop: '1px solid var(--line)' }}>
            {d.campaigns.slice(0, more.limit).map(c => (
              <li key={c.key} className={`${s.row} ${s.rowNoAvatar}`}>
                <span style={{ minWidth: 0 }}>
                  <span className={s.rowName}>{c.name}</span>
                  <span className={s.rowSub} style={{ display: 'block' }}>
                    {several && <><StoreName name={c.store} /> · </>}{c.running ? 'ativa' : 'pausada'}
                    {c.trendLabel && c.trend !== 'estavel' ? ` · ${c.trendLabel.toLowerCase()}${c.trendChange !== null ? ` (${formatPct(c.trendChange, { digits: 0, sign: true })} no ROAS)` : ''}` : ''}
                  </span>
                  <p className={s.reason}>{c.shared ?? c.reason}</p>
                  {c.spend > 0 && c.roas !== null && <div style={{ marginTop: 6 }}><RoasGauge roas={c.roas} breakEven={c.breakEvenRoas} size="mini" paused={!c.running} /></div>}
                  <span className={s.metrics}>
                    <span>Gasto <b>{formatMoney(c.spend)}</b></span>
                    <span>{plural(c.purchases, 'compra', 'compras')}</span>
                    {c.cpa !== null && <span>CPA <b>{formatMoney(c.cpa)}</b></span>}
                  </span>
                </span>
                <span className={s.rowVal}>
                  {c.action
                    ? <Chip tone={ACTION_CHIP[c.action].tone} icon={ACTION_CHIP[c.action].icon} size="sm">{c.actionLabel}</Chip>
                    : <Chip tone="mut" size="sm">sem ação</Chip>}
                  {c.estimatedProfit !== null
                    ? <><b><Money value={c.estimatedProfit} sign /></b><small>lucro estimado</small></>
                    : <small>{c.shared ? 'conta compartilhada' : 'sem margem'}</small>}
                  {c.days.length > 1 && c.days.some(x => x.estimatedProfit !== null) && (
                    <MiniBars values={c.days.map(x => x.estimatedProfit)} width={84} height={22} ariaLabel={`Lucro estimado por dia de ${c.name}`} />
                  )}
                </span>
              </li>
            ))}
          </ul>
          {more.needed && <button type="button" className={s.moreBtn} onClick={more.toggle}>{more.all ? 'Mostrar menos' : `Mostrar todas (${d.campaigns.length})`}</button>}
          {d.totalCampaigns > d.campaigns.length && <p className={s.note} style={{ padding: '0 16px 12px' }}>Mostrando as {d.campaigns.length} primeiras de {d.totalCampaigns}; os totais acima incluem todas.</p>}
        </>
      )}
    </Block>
  )
}

// ─── Criativos ────────────────────────────────────────────────────────────────

function Creatives({ d }: { d: CreativesDetail }) {
  const more = useMore(d.creatives.length)
  const several = d.stores.length > 1
  return (
    <Block
      title={`Criativos · ${formatCount(d.totalCreatives)}`}
      howTo="Primeiro o que queima dinheiro (Desligar), depois o que pode crescer. Cada anúncio contra o empate da sua loja."
      info={<><p>{d.formula}</p><p style={{ marginTop: 6 }}>{d.notes.hookRate}</p>{d.notes.frequency && <p style={{ marginTop: 6 }}>{d.notes.frequency}</p>}</>}
      flush={d.creatives.length > 0}
    >
      {d.creatives.length === 0 ? (
        <EmptyState compact icon="camp" title="Nenhum anúncio com gasto no período" />
      ) : (
        <>
          <ul className={s.list}>
            {d.creatives.slice(0, more.limit).map(c => (
              <li key={c.key} className={`${s.row} ${s.rowThumb}`}>
                <Thumb src={c.thumbnailUrl} noReferrer />
                <span style={{ minWidth: 0 }}>
                  <span className={s.rowName}>{c.name}</span>
                  <span className={s.rowSub} style={{ display: 'block' }}>
                    {several && <><StoreName name={c.store} /> · </>}{c.campaignName ?? 'campanha desconhecida'}{c.running ? '' : ' · pausado'}
                  </span>
                  <p className={s.reason}>{c.shared ?? c.reason}</p>
                  <span className={s.metrics}>
                    <span>Gasto <b>{formatMoney(c.spend)}</b></span>
                    <span>ROAS <b>{formatRoas(c.roas)}</b>{c.breakEvenRoas !== null && <> · empate <b>{formatRoas(c.breakEvenRoas)}</b></>}</span>
                    {c.ctr !== null && <span>CTR <b>{formatPct(c.ctr)}</b></span>}
                    {c.video?.retention25 != null && <span>Viram 25% <b>{formatPct(c.video.retention25, { digits: 0 })}</b></span>}
                  </span>
                </span>
                <span className={s.rowVal}>
                  {c.signal
                    ? <Chip tone={SIGNAL_CHIP[c.signal].tone} icon={SIGNAL_CHIP[c.signal].icon} size="sm">{c.signalLabel}</Chip>
                    : <Chip tone="mut" size="sm">sem veredito</Chip>}
                  {c.estimatedProfit !== null && <><b><Money value={c.estimatedProfit} sign /></b><small>lucro estimado</small></>}
                </span>
              </li>
            ))}
          </ul>
          {more.needed && <button type="button" className={s.moreBtn} onClick={more.toggle}>{more.all ? 'Mostrar menos' : `Mostrar todos (${d.creatives.length})`}</button>}
        </>
      )}
    </Block>
  )
}

// ─── Produtos ─────────────────────────────────────────────────────────────────

function Products({ d }: { d: ProductsDetail }) {
  const more = useMore(d.products.length)
  const several = d.stores.length > 1
  return (
    <Block
      title={`Produtos · ${formatCount(d.totalProducts)}`}
      howTo="O que vendeu e quanto sobrou de cada venda antes dos anúncios (contribuição)."
      info={<><p>A receita de cada pedido é dividida entre os produtos pelo valor de cada linha, então a soma dá a receita da loja. Contribuição = receita − custo do produto, fornecedor, frete e taxas.</p><p style={{ marginTop: 6 }}><b>{d.attribution.label}:</b> {d.attribution.note}</p></>}
      flush={d.products.length > 0}
      footer={d.unconfiguredStores.length ? `${d.unconfiguredStores.join(', ')} sem custos configurados: a contribuição dos produtos ${d.unconfiguredStores.length > 1 ? 'delas' : 'dela'} não aparece.` : undefined}
    >
      {d.products.length === 0 ? (
        <EmptyState compact icon="box" title="Nenhum produto vendido no período" />
      ) : (
        <>
          <ul className={s.list}>
            {d.products.slice(0, more.limit).map(p => (
              <li key={p.key} className={`${s.row} ${s.rowThumb}`}>
                <Thumb src={p.imageUrl} />
                <span style={{ minWidth: 0 }}>
                  <span className={s.rowName}>{p.title}</span>
                  <span className={s.rowSub} style={{ display: 'block' }}>
                    {plural(p.units, 'unidade', 'unidades')} · {plural(p.orders, 'pedido', 'pedidos')}
                    {several && p.stores.length > 0 && <> · {p.stores.length > 1 ? `${p.stores.length} lojas` : p.stores[0]}</>}
                  </span>
                  <span className={s.metrics}>
                    {p.contribution !== null
                      ? <span>Contribuição <b>{formatMoney(p.contribution)}</b> ({formatPct(p.contributionMargin)})</span>
                      : <span>Contribuição: custos não configurados</span>}
                    {p.attributedSpend > 0 && <span>Meta pela jornada <b>{formatMoney(p.attributedSpend)}</b></span>}
                  </span>
                </span>
                <span className={s.rowVal}>
                  <b>{formatMoney(p.revenue)}</b>
                  <small>{formatPct(p.revenueShare)} das vendas</small>
                </span>
              </li>
            ))}
          </ul>
          {more.needed && <button type="button" className={s.moreBtn} onClick={more.toggle}>{more.all ? 'Mostrar menos' : `Mostrar todos (${d.products.length})`}</button>}
        </>
      )}
    </Block>
  )
}

// ─── Países ───────────────────────────────────────────────────────────────────

function Countries({ d }: { d: CountriesDetail }) {
  return (
    <Block
      title="Países"
      howTo="Pedidos reais da Shopify por país. A coluna do Meta é a atribuição dele, só para comparar."
      info={<>{d.notes.map((n, i) => <p key={i} style={{ marginTop: i ? 6 : 0 }}>{n}</p>)}</>}
      flush={d.countries.length > 0}
      // The Meta caveat is about comparing columns: noise under "Nenhum pedido".
      footer={d.countries.length === 0 ? undefined : `${d.meta.caveat}${d.meta.coveragePct !== null && d.meta.coveragePct < 95 ? ` A divisão do Meta cobre ${formatPct(d.meta.coveragePct, { digits: 0 })} do gasto.` : ''}`}
    >
      {d.countries.length === 0 ? (
        <EmptyState compact icon="globe" title="Nenhum pedido no período" />
      ) : (
        <ul className={s.list}>
          {d.countries.map(c => (
            <li key={c.country} className={`${s.row} ${s.rowNoAvatar}`}>
              <span style={{ minWidth: 0 }}>
                <span className={s.rowName}>{c.name}</span>
                <span className={s.rowSub} style={{ display: 'block' }}>
                  {plural(c.orders, 'pedido', 'pedidos')} · {formatPct(c.revenueShare)} das vendas
                  {c.contribution !== null ? <> · contribuição {formatMoney(c.contribution)} ({formatPct(c.contributionMargin)})</> : ' · sem custos'}
                </span>
                {(c.meta.spend > 0 || c.meta.purchases > 0) && (
                  <span className={s.rowSub} style={{ display: 'block' }}>
                    Meta: {formatMoney(c.meta.spend)} · {plural(c.meta.purchases, 'compra atribuída', 'compras atribuídas')}
                    {c.meta.capturePct !== null && ` (${formatPct(c.meta.capturePct, { digits: 0 })} dos pedidos reais)`}
                  </span>
                )}
                {c.smallSample && c.country !== 'outros' && <span className={s.rowTags}><Chip tone="neu" icon="ring" size="sm">poucos pedidos para julgar</Chip></span>}
              </span>
              <span className={s.rowVal}><b>{formatMoney(c.revenue)}</b></span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}

// ─── Clientes ─────────────────────────────────────────────────────────────────

function Customers({ d }: { d: CustomersDetail }) {
  const sp = d.split
  const total = sp.newOrders + sp.returningOrders + sp.guestOrders
  const w = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`
  return (
    <Block
      title="Clientes"
      howTo="Pedidos de clientes novos (primeira compra) e de quem já tinha comprado antes."
      info={`Primeira compra contada sobre todo o histórico desde ${sp.historyStart ? formatRangeLabel({ from: sp.historyStart, to: sp.historyStart }) : 'o início dos dados'}, não só dentro do período.${d.perStoreCustomers ? ' Com várias lojas, quem comprou em duas conta duas vezes.' : ''}`}
    >
      {sp.orders === 0 ? (
        <EmptyState compact icon="user" title="Nenhum pedido no período" />
      ) : (
        <div className={s.stack}>
          <div className={s.kpis}>
            <div className={s.pairCell}><small>Pedidos de clientes novos</small><b>{formatCount(sp.newOrders)}</b><em>{formatMoney(sp.newRevenue)}</em></div>
            <div className={s.pairCell}><small>Pedidos de recorrentes</small><b>{formatCount(sp.returningOrders)}</b><em>{formatMoney(sp.returningRevenue)} · {formatPct(sp.repeatOrderPct)}</em></div>
          </div>
          <div>
            <div className={s.split} aria-hidden="true">
              <span className={s.swNew} style={{ width: w(sp.newOrders) }} />
              <span className={s.swRet} style={{ width: w(sp.returningOrders) }} />
              <span className={s.swGuest} style={{ width: w(sp.guestOrders) }} />
            </div>
            <div className={s.legend}>
              <span><i className={s.swNew} />novos {formatCount(sp.newOrders)}</span>
              <span><i className={s.swRet} />recorrentes {formatCount(sp.returningOrders)}</span>
              {sp.guestOrders > 0 && <span><i className={s.swGuest} />sem cadastro {formatCount(sp.guestOrders)}</span>}
            </div>
          </div>
          <p className={s.note}>
            {plural(sp.customers, 'cliente comprou', 'clientes compraram')} no período: {formatCount(sp.newCustomers)} pela primeira vez.
            {sp.repeatOrdersOfNewCustomers > 0 && ` Os novos já voltaram ${plural(sp.repeatOrdersOfNewCustomers, 'vez', 'vezes')} dentro do período.`}
          </p>
          {d.ltv && d.ltv.customers > 0 && (
            <div>
              <div className={s.secLabel} style={{ padding: '6px 0 6px' }}>Histórico completo<span>{formatCount(d.ltv.customers)} clientes</span></div>
              <div className={s.kpis}>
                <div className={s.pairCell}><small>Valor médio por cliente</small><b>{formatMoney(d.ltv.avgLtv)}</b><em>{d.ltv.avgOrders !== null ? `${d.ltv.avgOrders.toFixed(2).replace('.', ',')} pedidos em média` : ''}</em></div>
                <div className={s.pairCell}><small>Compraram mais de uma vez</small><b>{formatPct(d.ltv.repeatCustomerPct)}</b><em>{formatCount(d.ltv.repeatCustomers)} clientes</em></div>
              </div>
              <div style={{ marginTop: 10 }}>
                <HorizontalBars
                  items={d.ltv.buckets.map(b => ({ key: b.segment, label: b.segment, value: b.customers, display: formatCount(b.customers), note: b.avgLtv !== null ? `${formatMoney(b.avgLtv)} por cliente` : undefined }))}
                  ariaLabel="Clientes por número de pedidos no histórico"
                />
              </div>
            </div>
          )}
          {!d.ltv && <p className={s.note}>O histórico completo não carregou agora.</p>}
        </div>
      )}
    </Block>
  )
}

