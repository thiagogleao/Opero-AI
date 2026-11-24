'use client'

/**
 * Detail tabs (campanhas, criativos, produtos, países, clientes), fetched from
 * GET /api/mobile/detail when a tab is open, refetched when the store or the
 * period changes, with loading, error-and-retry and empty states. A tab never
 * shows another selection's list as if it were this one's: the same tab's
 * answer for the previous selection is dimmed under "Carregando…"; another
 * tab's answer is never shown under this one (a skeleton is).
 */

import { useEffect, useRef, useState } from 'react'
import {
  Block, Button, Callout, Chip, EmptyState, ErrorState, Money, RoasGauge, Skeleton,
} from '@/components/ui'
import { HorizontalBars, MiniBars } from '@/components/charts'
import { formatCount, formatMoney, formatPct, formatRangeLabel, formatRelativeTime, formatRoas, formatSignedMoney, plural } from '@/lib/format'
import type { CampaignAction } from '@/lib/campaignSignal'
import { sharedLeftOutText } from '@/components/countries/sharedText'
import type {
  CampaignsDetail, CountriesDetail, CreativesDetail, CustomersDetail, DetailSection, MobileDetailResponse, ProductsDetail,
} from '@/lib/views/mobileDetail'
import { TABS, type Selection } from '../_lib/selection'
import { useDetail } from '../_lib/useMobileData'
import { campaignChip, campaignGapNotes, countriesLeftOutLine, countriesMetaSide, creativeChip, judgedWindowsText, shopAdsLine } from '../_lib/labels'
import { adsElsewhere, type SharedAds } from '../_lib/sharedAds'
import { StoreName } from './Home'
import s from '../m.module.css'

const PANEL_ID = 'm-detail-panel'
const tabButtonId = (k: DetailSection) => `m-detail-btn-${k}`

/** What a section needs beyond its own answer: the shared ad-account pairs
 *  (CAMP HALLOW on EPOCH's account), a way to open another store, and the
 *  home's "Sem dados de …: a loja está arquivada desde …" for an archived
 *  store's window after its archive day (Home frozenTitle), which an empty
 *  list says instead of "Nenhum pedido no período". */
interface SectionCtx { shared: SharedAds; onStore: (loja: string) => void; frozenTitle: string | null }

export function DetailTabs({ sel, aba, onTab, forceSignal, pollSignal, homeRange, now, scopeName, shared, onStore, frozen = false, frozenTitle = null }: {
  sel: Selection
  aba: DetailSection | null
  onTab: (t: DetailSection | null) => void
  forceSignal: number
  pollSignal: number
  /** "from|to" of the home answer on screen, only when it answers this selection. */
  homeRange: string | null
  now: number
  scopeName: string
  shared: SharedAds
  onStore: (loja: string) => void
  /** An archived store: not synced, so a window ending today is not "parcial"
   *  (nothing more will arrive), as the verdict above says. */
  frozen?: boolean
  /** Home frozenTitle of the home answer on screen, only when it answers this
   *  selection: nothing was read in the window, so an empty list says that. */
  frozenTitle?: string | null
}) {
  const ctx: SectionCtx = { shared, onStore, frozenTitle }
  const d = useDetail(aba, sel, forceSignal, pollSignal, homeRange)
  const current = d.data && d.dataKey === d.key ? d.data : null
  // Only this tab's list for the previous store or period is "da seleção
  // anterior"; the Clientes block under Campanhas was neither.
  const stale = d.data && d.dataKey !== d.key && d.data.section === aba ? d.data : null
  const error = d.error && d.errorKey === d.key ? d.error : null
  const loading = d.loadingKey === d.key && d.key !== null
  const label = TABS.find(t => t.key === aba)?.label

  return (
    <section aria-label="Detalhes" className={s.stack}>
      <div className={s.secLabel}>Detalhes<span>{aba ? `${label} · ${scopeName}` : 'toque numa aba para abrir'}</span></div>
      <TabRow aba={aba}>
        {/* Toggle buttons, not ARIA tabs: tapping the open one closes it (no
            section selected), which the tabs pattern cannot express, and each
            stays its own Tab stop as a plain button should. */}
        {TABS.map(t => (
          <button key={t.key} id={tabButtonId(t.key)} type="button" className={s.tab} aria-expanded={aba === t.key}
            aria-controls={aba === t.key ? PANEL_ID : undefined}
            onClick={() => onTab(aba === t.key ? null : t.key)}>
            {t.label}
          </button>
        ))}
      </TabRow>
      {aba && (
        <div id={PANEL_ID} role="region" aria-labelledby={tabButtonId(aba)} aria-busy={loading || undefined} className={s.stack}>
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
                <span>{current.rangeLabel}{current.partial && !frozen ? ' · parcial' : ''}</span>
                <span>{loading ? 'atualizando…' : d.fetchedAt && now ? `atualizado ${formatRelativeTime(new Date(d.fetchedAt), new Date(now))}` : ''}</span>
              </div>
              {error && <Callout tone="warn" title="Não atualizou">{error.message}. Mostrando a lista anterior. <button type="button" className={s.linkBtn} onClick={d.reload}>Tentar de novo</button></Callout>}
              <Section data={current} ctx={ctx} />
            </>
          ) : (
            <div className={s.stack}>
              <div className={s.strip + ' ' + s.stripInfo} role="status" style={{ margin: 0 }}>
                <span className={`${s.spin} ${s.stripIcon}`} aria-hidden="true" />
                <span>Carregando {label?.toLowerCase()} de {scopeName}…{stale && <small>A lista abaixo ainda é da seleção anterior.</small>}</span>
                <span />
              </div>
              {stale ? <div className={s.dim} aria-hidden="true" inert><Section data={stale} ctx={ctx} /></div> : <TabSkeleton />}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * The tab row. On a phone too narrow for the five tabs it scrolls; data-more
 * says which edge still hides tabs (the CSS fades that edge) and the open tab
 * is scrolled into view.
 */
function TabRow({ aba, children }: { aba: DetailSection | null; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const left = el.scrollLeft > 2
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      el.dataset.more = left && right ? 'both' : left ? 'left' : right ? 'right' : 'none'
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', update); ro?.disconnect() }
  }, [])
  useEffect(() => {
    const el = ref.current
    const on = el?.querySelector<HTMLElement>('[aria-expanded="true"]')
    if (!el || !on || el.scrollWidth <= el.clientWidth) return
    const l = on.offsetLeft - el.offsetLeft
    if (l < el.scrollLeft || l + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollTo({ left: l - 24, behavior: 'smooth' })
  }, [aba])
  return <div ref={ref} className={s.tabs} role="group" aria-label="Seções de detalhes" data-more="none">{children}</div>
}

/** "Mostrar todos (25)" only when the list is the whole thing; a list the
 *  server cut at DETAIL_LIMIT says how many it shows and of how many. */
function MoreButton({ more, shown, total, female, onlyNote }: {
  more: ReturnType<typeof useMore>; shown: number; total: number; female?: boolean; onlyNote: string
}) {
  const cut = total > shown
  return (
    <>
      {more.needed && (
        <button type="button" className={s.moreBtn} onClick={more.toggle}>
          {more.all ? 'Mostrar menos' : cut ? `Mostrar ${female ? 'as' : 'os'} ${shown} primeir${female ? 'as' : 'os'}` : `Mostrar tod${female ? 'as' : 'os'} (${shown})`}
        </button>
      )}
      {cut && (!more.needed || more.all) && <p className={s.note} style={{ padding: '0 16px 12px' }}>{onlyNote}</p>}
    </>
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

function Section({ data, ctx }: { data: MobileDetailResponse; ctx: SectionCtx }) {
  return (
    <>
      <FailedStores data={data} />
      {data.section === 'campanhas' && <Campaigns d={data} ctx={ctx} />}
      {data.section === 'criativos' && <Creatives d={data} ctx={ctx} />}
      {data.section === 'produtos' && <Products d={data} frozen={ctx.frozenTitle} />}
      {data.section === 'paises' && <Countries d={data} frozen={ctx.frozenTitle} />}
      {data.section === 'clientes' && <Customers d={data} frozen={ctx.frozenTitle} />}
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

function ChipOf({ spec }: { spec: ReturnType<typeof creativeChip> }) {
  return <Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip>
}

function useMore(total: number, first = 10) {
  const [all, setAll] = useState(false)
  return { limit: all ? total : first, all, toggle: () => setAll(v => !v), needed: total > first }
}

/**
 * The empty Campanhas / Criativos of one store. A store whose ads run on
 * another store's account (CAMP HALLOW on EPOCH's) says where they are, with
 * a way there: a bare "Nenhuma campanha com gasto no período" read as "this
 * store runs no ads" while its sales came from EPOCH's campaigns.
 */
function NoAds({ d, ctx, what }: { d: CampaignsDetail | CreativesDetail; ctx: SectionCtx; what: 'campanhas' | 'anuncios' }) {
  if (ctx.frozenTitle) return <FrozenEmpty title={ctx.frozenTitle} />
  const one = d.request.store !== 'all' && d.stores.length === 1 ? d.stores[0].id : null
  const elsewhere = one ? adsElsewhere(ctx.shared, one, what) : null
  if (!elsewhere) {
    return <EmptyState compact icon="camp" title={what === 'campanhas' ? 'Nenhuma campanha com gasto no período' : 'Nenhum anúncio com gasto no período'} />
  }
  return (
    <EmptyState compact icon="swap" title={elsewhere.title}
      action={<Button size="sm" variant="ghost" icon="arrowRight" onClick={() => ctx.onStore(elsewhere.adStoreId)}>Abrir {elsewhere.adStoreName}</Button>}>
      {elsewhere.body}
    </EmptyState>
  )
}

/** An archived store's window after its archive day: nothing was read, so
 *  not "nenhum pedido" (the Squishy World tabs said so right above the
 *  refunds block's "Sem dados de 17–23 nov: a loja está arquivada desde 10 nov"). */
function FrozenEmpty({ title }: { title: string }) {
  return <EmptyState compact icon="clock" title={title} />
}

// ─── Campanhas ────────────────────────────────────────────────────────────────

/** A paused campaign can still be credited purchases from clicks made before
 *  the window: "Gasto $0 · 2 compras" read like sales it bought for free.
 *  Say where they came from (its CPA is already null: lib/data/campaigns). */
function lateConversionsNote(c: { spend: number; purchases: number }): string {
  if (c.spend > 0 || c.purchases <= 0) return ''
  return c.purchases === 1 ? ' atribuída (de cliques anteriores)' : ' atribuídas (de cliques anteriores)'
}

function Campaigns({ d, ctx }: { d: CampaignsDetail; ctx: SectionCtx }) {
  const more = useMore(d.campaigns.length)
  const several = d.stores.length > 1
  const t = d.totals
  // Only stores whose ads run on Meta: a store selling through Shop
  // Campaigns is not Meta's to credit (labels campaignGapNotes).
  const gaps = campaignGapNotes(d.storeNotes)
  // The list and its "Gasto" are Meta's: Shopify ad spend is named beside it.
  // An older answer (cached on the phone) has no shopSpend.
  const shopSpend = t.shopSpend ?? 0
  const shopLine = shopAdsLine(shopSpend, d.storeNotes.map(n => ({ store: n.store, shopSpend: n.shopSpend ?? 0 })), several)
  const bucket = (
    <>
      <UnsyncedLine u={d.unsynced} several={several} total={t.spend} />
      {shopLine && <p className={s.note} style={{ padding: '0 16px 12px' }}>{shopLine}</p>}
    </>
  )
  return (
    <Block
      title={`Campanhas · ${formatCount(d.totalCampaigns)}`}
      howTo={judgedWindowsText(d.decisionWindows)}
      info={<><p>{d.formula}</p>{(['cortar', 'escalar', 'manter', 'observar'] as CampaignAction[]).map(a => <p key={a} style={{ marginTop: 6 }}><b>{a[0].toUpperCase() + a.slice(1)}:</b> {d.rules[a]}</p>)}</>}
      infoLabel="Como cada ação é decidida"
      flush={d.campaigns.length > 0}
      footer={gaps.length ? gaps.join(' ') : undefined}
    >
      {d.campaigns.length === 0 ? (
        <>
          <NoAds d={d} ctx={ctx} what="campanhas" />
          {bucket}
        </>
      ) : (
        <>
          <div style={{ padding: '0 16px 12px' }} className={s.metrics}>
            <span>Gasto{shopSpend > 0 ? ' no Meta' : ''} <b>{formatMoney(t.spend)}</b></span>
            <span>Receita pelo Meta <b>{formatMoney(t.purchaseValue)}</b></span>
            <span>Lucro estimado <b><Money value={t.estimatedProfit} tone="auto" /></b></span>
            {t.unpricedSpend > 0 && <span>Sem margem para estimar <b>{formatMoney(t.unpricedSpend)}</b></span>}
          </div>
          {bucket}
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
                  {c.spend > 0 && c.roas !== null && (() => {
                    // The store's revenue too: a store that sold nothing reads "sem empate → loja
                    // sem vendas" on every row, as the verdict above says, not "nada sobra antes
                    // dos anúncios" (costs set) or "custos não configurados" (Glooty).
                    const note = d.storeNotes.find(n => n.storeId === c.storeId)
                    return (
                      <div style={{ marginTop: 6 }}>
                        <RoasGauge roas={c.roas} breakEven={c.breakEvenRoas} configured={note?.configured} revenue={note?.revenue}
                          reason={c.shared ? 'other_store' : null} size="mini" paused={!c.running} />
                      </div>
                    )
                  })()}
                  <span className={s.metrics}>
                    <span>Gasto <b>{formatMoney(c.spend)}</b></span>
                    <span>{plural(c.purchases, 'compra', 'compras')}{lateConversionsNote(c)}</span>
                    {c.cpa !== null && <span>CPA <b>{formatMoney(c.cpa)}</b></span>}
                  </span>
                </span>
                <span className={s.rowVal}>
                  {c.action
                    ? <ChipOf spec={campaignChip(c.action, c.actionLabel)} />
                    : <Chip tone="mut" size="sm">sem ação</Chip>}
                  {c.estimatedProfit !== null
                    ? <><b><Money value={c.estimatedProfit} sign /></b><small>lucro estimado</small></>
                    : <small>{c.shared ? 'conta compartilhada' : d.storeNotes.find(n => n.storeId === c.storeId)?.configured === false ? 'custos não configurados' : 'sem margem'}</small>}
                  {c.days.length > 1 && c.days.some(x => x.estimatedProfit !== null) && (
                    <MiniBars values={c.days.map(x => x.estimatedProfit)} width={84} height={22} ariaLabel={`Lucro estimado por dia de ${c.name}`} />
                  )}
                </span>
              </li>
            ))}
          </ul>
          <MoreButton more={more} shown={d.campaigns.length} total={d.totalCampaigns} female
            onlyNote={`Mostrando as ${d.campaigns.length} primeiras de ${formatCount(d.totalCampaigns)}: as que pedem ação e as de maior gasto. Os totais acima incluem todas.`} />
        </>
      )}
    </Block>
  )
}

/**
 * Ads the sync has not tied to a campaign yet: one line, never a campaign row
 * (no "ativa/pausada", no ROAS gauge, not in the count). The desktop table
 * calls the same bucket "sem campanha". Its Meta revenue and estimated profit
 * are in the header too, so the line names them: the header read $138 and
 * $42 better than the rows with only "o gasto já está no total" to say why.
 */
function UnsyncedLine({ u, several, total }: { u: CampaignsDetail['unsynced']; several: boolean; total: number }) {
  // An older answer (cached on the phone) has no purchaseValue.
  const pv = u.purchaseValue ?? 0
  const profit = u.estimatedProfit ?? null
  if (!(u.spend >= 0.005) && !(pv >= 0.005)) return null
  const share = total > 0 ? (u.spend / total) * 100 : null
  const inTotal = [
    `o gasto (${formatMoney(u.spend)})`,
    pv >= 0.005 ? `a receita pelo Meta (${formatMoney(pv)})` : null,
    profit !== null && Math.abs(profit) >= 0.005 ? `o lucro estimado (${formatSignedMoney(profit)})` : null,
  ].filter((x): x is string => x !== null)
  const listed = inTotal.length > 1 ? `${inTotal.slice(0, -1).join(', ')} e ${inTotal[inTotal.length - 1]}` : inTotal[0]
  return (
    <p className={s.note} style={{ padding: '0 16px 12px' }}>
      <b>{formatMoney(u.spend)}</b> em anúncios ainda não ligados a uma campanha
      {share !== null && share >= 10 ? ` (${formatPct(share, { digits: 0 })} do gasto)` : ''}
      {several && u.stores.length > 0 ? `: ${u.stores.map(b => `${b.store} ${formatMoney(b.spend)}`).join(', ')}` : ''}.
      {' '}A sincronização com o Meta ainda não trouxe o nome nem a campanha {u.ads === 1 ? 'desse anúncio' : 'desses anúncios'}.
      {' '}{inTotal.length > 1 ? `${listed.charAt(0).toUpperCase()}${listed.slice(1)} desses anúncios já estão nos totais acima, mas em nenhuma linha.` : 'O gasto já está no total.'}
    </p>
  )
}

// ─── Criativos ────────────────────────────────────────────────────────────────

function Creatives({ d, ctx }: { d: CreativesDetail; ctx: SectionCtx }) {
  const more = useMore(d.creatives.length)
  const several = d.stores.length > 1
  return (
    <Block
      title={`Criativos · ${formatCount(d.totalCreatives)}`}
      // Two break-evens can sit on one row: the reason's is the 7 closed days',
      // the line under it the period's. Each says which it is.
      howTo="Primeiro o que queima dinheiro (Desligar), depois o que pode crescer. O veredito de cada anúncio (e o empate citado nele) olha os últimos 7 dias fechados, como o das campanhas; gasto, ROAS e o empate da linha de baixo são do período escolhido."
      info={<><p>{d.formula}</p><p style={{ marginTop: 6 }}>{d.notes.hookRate}</p>{d.notes.frequency && <p style={{ marginTop: 6 }}>{d.notes.frequency}</p>}</>}
      flush={d.creatives.length > 0}
    >
      {d.creatives.length === 0 ? (
        <NoAds d={d} ctx={ctx} what="anuncios" />
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
                    <span>ROAS <b>{formatRoas(c.roas)}</b>{c.breakEvenRoas !== null && <> · empate do período <b>{formatRoas(c.breakEvenRoas)}</b></>}</span>
                    {c.ctr !== null && <span>CTR <b>{formatPct(c.ctr)}</b></span>}
                    {c.video?.retention25 != null && <span>Viram 25% <b>{formatPct(c.video.retention25, { digits: 0 })}</b></span>}
                  </span>
                </span>
                <span className={s.rowVal}>
                  {c.signal
                    ? <ChipOf spec={creativeChip(c.signal, c.signalLabel)} />
                    : <Chip tone="mut" size="sm">sem veredito</Chip>}
                  {c.estimatedProfit !== null && <><b><Money value={c.estimatedProfit} sign /></b><small>lucro estimado</small></>}
                </span>
              </li>
            ))}
          </ul>
          <MoreButton more={more} shown={d.creatives.length} total={d.totalCreatives}
            onlyNote={`Mostrando os ${d.creatives.length} primeiros de ${formatCount(d.totalCreatives)}: primeiro os que pedem ação, depois os de maior gasto.`} />
        </>
      )}
    </Block>
  )
}

// ─── Produtos ─────────────────────────────────────────────────────────────────

function Products({ d, frozen }: { d: ProductsDetail; frozen: string | null }) {
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
        frozen ? <FrozenEmpty title={frozen} /> : <EmptyState compact icon="box" title="Nenhum produto vendido no período" />
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
          <MoreButton more={more} shown={d.products.length} total={d.totalProducts}
            onlyNote={`Mostrando os ${d.products.length} que mais venderam, de ${formatCount(d.totalProducts)} produtos com venda no período.`} />
        </>
      )}
    </Block>
  )
}

// ─── Países ───────────────────────────────────────────────────────────────────

/** "20% dos pedidos reais", or, when the capture leaves orders out (stores
 *  whose Meta spend has no country split, or days it covers only in part),
 *  its own two figures, as the desktop's "154 ÷ 177": "87%: 154 compras ÷ 177
 *  pedidos com divisão do Meta" — never purchases over orders Meta could not
 *  credit by country. Without the figures, "46 compras atribuídas (88% de 41
 *  pedidos …)" read as a contradiction. */
export function captureText(c: Pick<CountriesDetail['countries'][number], 'orders' | 'meta'>): string {
  const pct = formatPct(c.meta.capturePct, { digits: 0 })
  // An older answer (cached on the phone) has neither figure.
  const n = c.meta.captureOrders ?? c.orders
  const bought = Math.round(c.meta.capturePurchases ?? c.meta.purchases)
  return n === c.orders && bought === Math.round(c.meta.purchases)
    ? `${pct} dos pedidos reais`
    : `${pct}: ${plural(bought, 'compra', 'compras')} ÷ ${plural(n, 'pedido', 'pedidos')} com divisão do Meta`
}

function Countries({ d, frozen }: { d: CountriesDetail; frozen: string | null }) {
  // No Meta line on any row — no Meta money in the window (Squishy World), or
  // spend Meta sent without a country split (MOKOO: 0% covered): the caveat
  // about Meta's own split would point at a column that is not there.
  const side = countriesMetaSide(d)
  // Stores without costs left out of the rows of a sum with priced ones
  // (mobileDetail mergeCountries leftOut): said in visible text, as the
  // desktop's "Fora da soma por país", never only in the ⓘ.
  const leftOutLine = countriesLeftOutLine(d.leftOut ?? [])
  const lede = (d.leftOut ?? []).some(x => x.revenue >= 0.005) ? 'Pedidos reais da Shopify por país, das lojas com custos.' : 'Pedidos reais da Shopify por país.'
  return (
    <Block
      title="Países"
      howTo={side === 'split' ? `${lede} A linha do Meta traz o gasto dele no país e as compras que ele se atribui, só para comparar.` : lede}
      info={<>{d.notes.map((n, i) => <p key={i} style={{ marginTop: i ? 6 : 0 }}>{n}</p>)}</>}
      flush={d.countries.length > 0}
      // The Meta caveat is about comparing columns: noise under "Nenhum pedido".
      footer={d.countries.length === 0 ? (leftOutLine ? <span>{leftOutLine}</span> : undefined) : <>
        {leftOutLine && <span>{leftOutLine}</span>}
        {side === 'none'
          ? <span>Sem gasto no Meta no período: não há atribuição do Meta para comparar.</span>
          : side === 'no_split'
            ? <span>O Meta não mandou a divisão por país deste período ({formatMoney(d.meta.totalSpend)} de gasto sem país): não há atribuição para comparar.</span>
            : <span>{d.meta.caveat}{d.meta.coveragePct !== null && d.meta.coveragePct < 95 ? ` A divisão do Meta cobre ${formatPct(d.meta.coveragePct, { digits: 0 })} do gasto.` : ''}</span>}
        {/* CAMP HALLOW's campaigns on EPOCH's account are out of EPOCH's Meta
            columns (lib/data/countries): said with the amounts, as the
            desktop says it, so a lower "dos pedidos reais" is not a mystery. */}
        {(d.sharedLeftOut ?? []).map(lo => (
          <span key={lo.storeId}>
            {d.stores.length > 1 && <b>{lo.store}: </b>}
            {sharedLeftOutText(lo, id => lo.salesStores.find(x => x.id === id)?.name ?? null, 'das colunas do Meta e da captura')}
          </span>
        ))}
      </>}
    >
      {d.countries.length === 0 ? (
        frozen ? <FrozenEmpty title={frozen} /> : <EmptyState compact icon="globe" title="Nenhum pedido no período" />
      ) : (
        <ul className={s.list}>
          {d.countries.map(c => {
            // Only Meta spent there (the "N países só com gasto do Meta" row):
            // no "0 pedidos · 0,0% · contribuição $0 (—)", no small-sample chip.
            const noSale = c.orders === 0 && Math.abs(c.revenue) < 0.005
            return (
            <li key={c.country} className={`${s.row} ${s.rowNoAvatar}`}>
              <span style={{ minWidth: 0 }}>
                <span className={s.rowName}>{c.name}</span>
                <span className={s.rowSub} style={{ display: 'block' }}>
                  {noSale ? 'Nenhum pedido na Shopify' : <>
                    {plural(c.orders, 'pedido', 'pedidos')} · {formatPct(c.revenueShare)} das vendas
                    {c.contribution !== null ? <> · contribuição {formatMoney(c.contribution)} ({formatPct(c.contributionMargin)})</> : ' · sem custos'}
                  </>}
                </span>
                {(c.meta.spend > 0 || c.meta.purchases > 0) && (
                  <span className={s.rowSub} style={{ display: 'block' }}>
                    {/* The figure named: "Meta: $5.720" beside $9.415 of sales read as
                        sales Meta credited, under a lede about its attribution. */}
                    Meta: gasto {formatMoney(c.meta.spend)} · {plural(c.meta.purchases, 'compra atribuída', 'compras atribuídas')}
                    {c.meta.capturePct !== null && ` (${captureText(c)})`}
                  </span>
                )}
                {c.smallSample && c.country !== 'outros' && !noSale && <span className={s.rowTags}><Chip tone="neu" icon="ring" size="sm">poucos pedidos para julgar</Chip></span>}
              </span>
              <span className={s.rowVal}>{noSale ? <><b className="mut">—</b><small>gasto sem venda</small></> : <b>{formatMoney(c.revenue)}</b>}</span>
            </li>
            )
          })}
        </ul>
      )}
    </Block>
  )
}

// ─── Clientes ─────────────────────────────────────────────────────────────────

function Customers({ d, frozen }: { d: CustomersDetail; frozen: string | null }) {
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
        frozen ? <FrozenEmpty title={frozen} /> : <EmptyState compact icon="user" title="Nenhum pedido no período" />
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
              <div className={s.secLabel} style={{ padding: '6px 0 6px' }}>Histórico completo<span>{plural(d.ltv.customers, 'cliente', 'clientes')}</span></div>
              <div className={s.kpis}>
                <div className={s.pairCell}><small>Valor médio por cliente</small><b>{formatMoney(d.ltv.avgLtv)}</b><em>{d.ltv.avgOrders !== null ? `${d.ltv.avgOrders.toFixed(2).replace('.', ',')} pedidos em média` : ''}</em></div>
                <div className={s.pairCell}><small>Compraram mais de uma vez</small><b>{formatPct(d.ltv.repeatCustomerPct)}</b><em>{plural(d.ltv.repeatCustomers, 'cliente', 'clientes')}</em></div>
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

