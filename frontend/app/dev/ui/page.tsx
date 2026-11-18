import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getPageContext, type SearchParams } from '@/lib/views/page'
import { buildPortfolio, type PortfolioView } from '@/lib/views/portfolio'
import { buildVerdict, storeStatus, verdictInputFromPortfolio } from '@/lib/views/verdict'
import { computeStorePnL } from '@/lib/engine/pnl'
import { shiftDate, todayInTz } from '@/lib/engine/dates'
import type { StoreRef } from '@/lib/access'
import { formatCount, formatMoney, formatPct, formatRangeLabel, plural } from '@/lib/format'
import {
  Avatar, Badge, Block, BreakdownBar, BreakdownLedger, Button, ButtonLink, Callout, Card, Chip, ClientTabs,
  CodePill, Count, DataTable, Delta, EmptyState, ErrorState, InfoTip, KpiCard, KpiGrid, Money, Pct, Roas,
  RoasGauge, Skeleton, SkeletonBlock, StatusDot, Tabs, VerdictCard, VerdictChips,
} from '@/components/ui'
import { DailyProfitBars, DailyProfitLegend, HorizontalBars, IntradayCurve, IntradayLegend, MiniBars, Sparkline } from '@/components/charts'
import { AppShell, PageHeader, PeriodNote } from '@/components/shell'
import { InsightsCard } from '@/components/ai/InsightsCard'
import { SegmentedDemo } from './SegmentedDemo'
import s from './page.module.css'

/**
 * /dev/ui — the styleguide. Every primitive and chart with REAL data from one
 * store (the one in ?loja, else MOKOO), plus verdicts for Todas (hoje),
 * Hibikura (dia de Tóquio) and Glooty (sem custos). Owner only: anyone else
 * gets a 404, so partners never see other stores here.
 */

export const metadata: Metadata = { title: 'Styleguide' }
export const dynamic = 'force-dynamic'

const NO_EXTRAS = { liveFeed: false, chargebackHealth: false, freshness: false } as const

export default async function StyleguidePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getPageContext(searchParams)
  if (!ctx.isOwner) notFound()

  const byName = (n: string) => ctx.stores.find(st => st.shopName.toLowerCase() === n.toLowerCase())
  const store: StoreRef | undefined = (ctx.scope === 'store' ? ctx.store : null) ?? byName('MOKOO') ?? ctx.stores[0]
  if (!store) {
    return <AppShell ctx={ctx}><EmptyState title="Nenhuma loja para mostrar" /></AppShell>
  }
  const hib = byName('Hibikura')
  const glooty = byName('Glooty')
  const storeToday = todayInTz(store.timezone, ctx.now)

  const [main, todas, hibToday, glootyWeek, month, today, yesterday, prodPnl] = await Promise.all([
    buildPortfolio([store], ctx.period, ctx.params.de, ctx.params.ate, ctx.now, NO_EXTRAS),
    buildPortfolio(ctx.stores, 'today', null, null, ctx.now, NO_EXTRAS),
    hib ? buildPortfolio([hib], 'today', null, null, ctx.now, NO_EXTRAS) : Promise.resolve(null),
    glooty ? buildPortfolio([glooty], '7d', null, null, ctx.now, NO_EXTRAS) : Promise.resolve(null),
    computeStorePnL(store.id, { from: shiftDate(storeToday, -30), to: storeToday }, {}, ctx.now),
    computeStorePnL(store.id, { from: storeToday, to: storeToday }, {}, ctx.now),
    computeStorePnL(store.id, { from: shiftDate(storeToday, -1), to: shiftDate(storeToday, -1) }, {}, ctx.now),
    computeStorePnL(store.id, ctx.scope === 'store' && ctx.store?.id === store.id ? ctx.range : { from: shiftDate(storeToday, -7), to: shiftDate(storeToday, -1) }, { products: true, countries: true }, ctx.now),
  ])

  const v = buildVerdict(verdictInputFromPortfolio(main, { split: ctx.split }))
  const vTodas = buildVerdict(verdictInputFromPortfolio(todas, { subject: 'Suas lojas', split: ctx.split }))
  const vHib = hibToday ? buildVerdict(verdictInputFromPortfolio(hibToday, { split: ctx.split })) : null
  const vGlooty = glootyWeek ? buildVerdict(verdictInputFromPortfolio(glootyWeek, { split: ctx.split })) : null
  const t = main.totals
  const c = main.comparison.totals
  const cmpLabel = `vs ${formatRangeLabel({ from: main.comparison.from, to: main.comparison.to }, main.anchorToday)}`
  const configured = v.basis !== 'revenue_minus_ads'
  const days = main.daily

  return (
    <AppShell ctx={ctx}>
      <PageHeader ctx={ctx} title="Styleguide" code={null} sub={<>Componentes do Opero v2 com dados reais de <b>{store.name}</b> · {main.rangeLabel}</>}
        actions={<ButtonLink href={ctx.hrefWith('/')} icon="arrowRight" size="sm">Ir para o Resumo</ButtonLink>} />
      <nav className={s.toc} aria-label="Seções">
        {['tokens', 'chips', 'botoes', 'veredito', 'kpis', 'roas', 'graficos', 'tabela', 'abas', 'estados', 'celular'].map(id => <a key={id} href={`#${id}`}>{id}</a>)}
      </nav>
      <PeriodNote ctx={ctx} />

      <section id="tokens" className={s.section}>
        <h2 className={s.h2}>Tokens <code>app/globals.css</code></h2>
        <Card pad="md">
          <div className={s.swatches}>
            {['--bg', '--panel', '--card', '--card-2', '--line-2', '--tx', '--tx-2', '--tx-3', '--pos', '--neg', '--neu', '--warn', '--info', '--c-cogs', '--c-fees', '--c-shop', '--c-meta', '--c-profit', '--c-ship', '--c-fixed'].map(tk => (
              <div key={tk} className={s.sw}><i style={{ background: `var(${tk})` }} /><b>{tk}</b></div>
            ))}
          </div>
          <div className={s.type} style={{ marginTop: 18 }}>
            <div className={s.typeRow}><span className={s.serif}>A MOKOO lucrou nos últimos 7 dias.</span><span>Fraunces 500 · só o veredito</span></div>
            <div className={s.typeRow}><span className={s.bigNum}>$1.313 · −$201 · 1,95×</span><span>IBM Plex Mono · todo número</span></div>
            <div className={s.typeRow}><span>Texto de interface em IBM Plex Sans, 14px.</span><span>IBM Plex Sans</span></div>
            <div className={s.typeRow}><span className="lbl">Lucro real · 10–16 nov</span><span>.lbl · rótulo</span></div>
          </div>
        </Card>
      </section>

      <section id="chips" className={s.section}>
        <h2 className={s.h2}>Chips, badges, estado <code>components/ui/Chip</code></h2>
        <Card pad="md">
          <div className={s.row}>
            <Chip tone="pos" icon="up">No lucro</Chip>
            <Chip tone="neg" icon="down">No prejuízo</Chip>
            <Chip tone="warn" icon="diamond">Margem fina</Chip>
            <Chip tone="neu" icon="clock">Cedo demais para julgar</Chip>
            <Chip tone="cfg" icon="sliders">Custos não configurados</Chip>
            <Chip tone="neu" icon="ring">Sem vendas no período</Chip>
            <Chip tone="info" icon="clock">dia de Tóquio</Chip>
            <Chip tone="info" icon="clock" size="sm">parcial · até 13h38</Chip>
            <Chip tone="mut" size="sm">arquivada</Chip>
          </div>
          <div className={s.row} style={{ marginTop: 12 }}>
            <Badge tone="pos">▲ Escalar</Badge>
            <Badge tone="info">● Promissora</Badge>
            <Badge tone="warn" icon="alert">não configurado</Badge>
            <Badge tone="neg">▼ Abaixo do empate</Badge>
            <Badge tone="mut" upper>pausada</Badge>
            <StatusDot state="ok">atualizado há 4 min</StatusDot>
            <StatusDot state="stale">atrasada há 2 h</StatusDot>
            <StatusDot state="failing">falhando</StatusDot>
            <CodePill>6k7fjw</CodePill>
            <Avatar name={store.name} />
          </div>
        </Card>
      </section>

      <section id="botoes" className={s.section}>
        <h2 className={s.h2}>Botões, avisos, ⓘ <code>components/ui/Card · InfoTip</code></h2>
        <Card pad="md">
          <div className={s.row}>
            <Button variant="primary" icon="check">Salvar custos</Button>
            <Button icon="refresh">Atualizar</Button>
            <Button variant="ghost">Cancelar</Button>
            <Button variant="danger" icon="x">Arquivar</Button>
            <Button pending>Salvando</Button>
            <Button size="sm" icon="external">Abrir na Shopify</Button>
            <Button iconOnly icon="set" aria-label="Ajustes" />
            <span>Lucro real <InfoTip label="O que é lucro real">Receita dos pedidos pagos − produto − frete − taxas da Shopify e do pagamento − Meta Ads − Anúncios Shopify − custos fixos. Pedidos reembolsados ou cancelados não entram.</InfoTip></span>
            <span>Empate <InfoTip trigger={<span className="num">1,53×</span>}>Receita ÷ contribuição: o ROAS do Meta em que os anúncios comem toda a margem. Acima dele, cada dólar no Meta dá lucro.</InfoTip></span>
          </div>
          <div className={s.grid3} style={{ marginTop: 14 }}>
            <Callout tone="info" title="Dia de Tóquio">A Hibikura fecha o dia no fuso dela, 12 h à frente de Brasília.</Callout>
            <Callout tone="warn" title="Glooty fica fora da soma">Sem custos configurados: só dá para ver receita − anúncios.</Callout>
            <Callout tone="neu">São 7 dias fechados no horário de Belém.</Callout>
          </div>
        </Card>
      </section>

      <section id="veredito" className={s.section}>
        <h2 className={s.h2}>Veredito + para onde foi cada dólar <code>VerdictCard · BreakdownLedger · lib/views/verdict</code></h2>
        <VerdictCard
          verdict={v}
          aside={<BreakdownLedger pnl={v.totals} configured={configured} split={ctx.split}
            title="Para onde foi cada dólar" sub={`De cada $1,00 vendido em ${main.rangeLabel}`} />}
        />
        <div className={s.grid3}>
          <VerdictCard verdict={vTodas} compact roas={false} />
          {vHib && <VerdictCard verdict={vHib} compact />}
          {vGlooty && <VerdictCard verdict={vGlooty} compact />}
        </div>
        <Card pad="sm">
          <div className={s.check}>
            Conferência com o motor ({store.name}, {main.rangeLabel}): engine operatingProfit <b>{t.operatingProfit.toFixed(2)}</b> ·
            verdict.amount <b>{v.amount?.toFixed(2) ?? 'null'}</b> · receita <b>{t.revenue.toFixed(2)}</b> · pedidos <b>{t.orders}</b> ·
            Todas hoje: soma das lojas com custos <b>{vTodas.totals.operatingProfit.toFixed(2)}</b> (portfolio.totals {todas.totals.operatingProfit.toFixed(2)}, fora: {vTodas.excluded.map(e => e.name).join(', ') || 'nenhuma'})
          </div>
        </Card>
      </section>

      <section id="kpis" className={s.section}>
        <h2 className={s.h2}>KPIs <code>KpiCard · Money · Pct · Roas · Delta</code></h2>
        <KpiGrid columns={4}>
          <KpiCard label="Receita" value={<Money value={t.revenue} />}
            note={<><b>{formatCount(t.orders)}</b> pedidos · ticket <b>{formatMoney(t.orders ? t.revenue / t.orders : null)}</b></>}
            spark={<Sparkline values={days.map(d => d.revenue)} ariaLabel="Receita por dia" />}
            delta={<Delta current={t.revenue} previous={c.revenue} label={cmpLabel} goodWhen="neutral" showPrevious />}
            info="Total pago pelos clientes nos pedidos não reembolsados, impostos incluídos, no fuso da loja." />
          <KpiCard label="Lucro real" value={<Money value={ctx.part(t.operatingProfit)} tone="none" />} tone={t.operatingProfit < 0 ? 'neg' : 'pos'}
            note={<>margem <b>{formatPct(t.margin)}</b> · <b>{formatMoney(t.profitPerOrder === null ? null : ctx.part(t.profitPerOrder))}</b> por pedido</>}
            spark={<MiniBars values={days.map(d => ctx.part(d.operatingProfit))} width={0} height={34} ariaLabel="Lucro por dia" />}
            delta={<Delta current={t.operatingProfit} previous={c.operatingProfit} label={cmpLabel} showPrevious />}
            info="Receita − produto − frete − taxas − anúncios − custos fixos." />
          <KpiCard label="ROAS Meta" value={<Roas value={t.roas} />} swatch="meta"
            note={<RoasGauge roas={t.roas} breakEven={configured ? t.breakEvenRoas : null} size="mini" />}
            info="Receita da loja ÷ gasto no Meta. Conta também as vendas que o Meta não credita a nenhuma campanha." />
          <KpiCard label="Anúncios Meta" value={<Money value={t.metaSpend} />} swatch="meta"
            note={<><b>{formatPct(t.revenue ? (t.metaSpend / t.revenue) * 100 : null)}</b> da receita</>}
            spark={<Sparkline values={days.map(d => d.metaSpend)} tone="meta" ariaLabel="Gasto no Meta por dia" />}
            delta={<Delta current={t.metaSpend} previous={c.metaSpend} label={cmpLabel} goodWhen="neutral" />} />
        </KpiGrid>
        <Card pad="sm"><div className={s.row}>
          <Money value={1313.07} /> <Money value={9.8} /> <Money value={-201.18} /> <Money value={0} /> <Money value={1313.07} sign tone="pos" />
          <Pct value={12} /> <Roas value={1.9455} /> <Count value={1174} />
          <Delta current={1313} previous={1869} label="vs 3–9 nov" /> <Delta current={226} previous={93} label="vs 3–9 nov" goodWhen="down" />
          <Delta current={12} previous={9.7} kind="pct" label="vs 3–9 nov" /> <Delta current={100} previous={-40} label="vs 4–10 nov" />
        </div></Card>
      </section>

      <section id="roas" className={s.section}>
        <h2 className={s.h2}>ROAS contra o empate <code>RoasGauge</code></h2>
        <div className={s.grid3}>
          <Card pad="md"><RoasGauge roas={t.roas} breakEven={configured ? t.breakEvenRoas : null} label="ROAS da loja" /></Card>
          <Card pad="md"><RoasGauge roas={0.87} breakEven={1.26} /></Card>
          <Card pad="md"><RoasGauge roas={0.42} breakEven={null} /></Card>
        </div>
        <Card pad="md"><div className={s.row} style={{ gap: 28 }}>
          <RoasGauge roas={2.73} breakEven={1.58} size="mini" />
          <RoasGauge roas={1.45} breakEven={1.58} size="mini" paused />
          <RoasGauge roas={1.5} breakEven={1.29} size="mini" />
        </div></Card>
      </section>

      <section id="graficos" className={s.section}>
        <h2 className={s.h2}>Gráficos <code>components/charts</code></h2>
        {month && (
          <Block title="Lucro real por dia" howTo="Últimos 30 dias e hoje. Barra acima da linha do zero = dia no lucro; abaixo = dia no prejuízo."
            info="Lucro real de cada dia no fuso da loja, com Anúncios Shopify e custos fixos. Hoje aparece hachurado: ainda vai mudar."
            actions={<DailyProfitLegend />}
            footer={<>
              <span>No período: <b>{days.filter(d => d.operatingProfit > 0).length} de {days.length} dias no lucro</b></span>
              <span>30 dias: <b className="num">{formatMoney(ctx.part(month.daily.filter(d => d.date < storeToday).reduce((a, d) => a + d.operatingProfit, 0)))}</b></span>
            </>}>
            <DailyProfitBars
              days={month.daily.map(d => ({ date: d.date, profit: ctx.part(d.operatingProfit), revenue: d.revenue, metaSpend: d.metaSpend, shopSpend: d.shopSpend, orders: d.orders }))}
              selected={main.range} partialDate={storeToday} partialNote={ctx.partialLabel ?? undefined} today={storeToday}
              ariaLabel={`Lucro real por dia da ${store.name}, últimos 30 dias e hoje parcial`} />
          </Block>
        )}
        <div className={s.grid2}>
          {today && (
            <Block title="Como o dia está andando" howTo="Lucro acumulado de hoje, hora a hora; a linha tracejada é ontem inteiro."
              actions={<IntradayLegend reference="ontem" />}>
              <IntradayCurve
                points={today.hourly ?? []}
                nowMinutes={today.partial ? today.minutesCovered : null}
                reference={yesterday?.hourly ? { points: yesterday.hourly, label: 'ontem' } : null}
                ariaLabel={`Lucro acumulado de hoje na ${store.name}`} />
            </Block>
          )}
          <Block title="O que mais vendeu" howTo="Receita das linhas de produto no período (o total do pedido rateado pelos itens).">
            <HorizontalBars ariaLabel="Produtos por receita" items={(prodPnl?.products ?? []).slice(0, 6).map(p => ({
              key: p.key, label: p.title, sub: `${plural(p.units, 'unidade', 'unidades')} · ${plural(p.orders, 'pedido', 'pedidos')}`,
              value: p.revenue, note: prodPnl && prodPnl.totals.revenue ? formatPct((p.revenue / prodPnl.totals.revenue) * 100) : undefined,
            }))} />
          </Block>
        </div>
        <Card pad="md"><div className={s.row} style={{ gap: 24 }}>
          <div style={{ width: 200 }}><Sparkline values={days.map(d => d.revenue)} ariaLabel="Receita" /></div>
          <div style={{ width: 200 }}><Sparkline values={days.map(d => d.metaSpend)} tone="meta" ariaLabel="Meta" /></div>
          <MiniBars values={(month?.daily ?? []).map(d => d.operatingProfit)} highlightLast={7} ariaLabel="Lucro de 30 dias" tip={{ title: 'Lucro diário · 30 dias', rows: [['soma', formatMoney((month?.daily ?? []).reduce((a, d) => a + d.operatingProfit, 0))]] }} />
          <MiniBars values={(month?.daily ?? []).map(d => d.shopSpend)} color="shop" ariaLabel="Anúncios Shopify por dia" />
        </div></Card>
      </section>

      <section id="tabela" className={s.section}>
        <h2 className={s.h2}>Tabela <code>DataTable</code></h2>
        <Block title="Países" howTo="Endereço dos pedidos reais da Shopify, não a atribuição do Meta. Porto Rico e territórios chegam como US." flush>
          <DataTable
            caption={`Países dos pedidos da ${store.name}`}
            initialSort={{ key: 'revenue', dir: 'desc' }}
            maxHeight={320}
            columns={[
              { key: 'country', label: 'País' },
              { key: 'orders', label: 'Pedidos', numeric: true, sortable: true },
              { key: 'revenue', label: 'Receita', numeric: true, sortable: true },
              { key: 'contribution', label: 'Margem antes dos anúncios', numeric: true, sortable: true, info: 'Receita − custos variáveis dos pedidos desse país (produto, frete, taxas).' },
              { key: 'meta', label: 'Meta atribui', numeric: true, sortable: true, info: 'O que o Meta diz ter gasto no país. Não confiável para decidir: compare com os pedidos.' },
            ]}
            rows={(prodPnl?.countries ?? []).filter(x => x.orders > 0).map(x => ({
              key: x.country,
              cells: {
                country: <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><CodePill>{x.country}</CodePill>{x.orders < 5 && <Badge tone="mut">n&lt;5</Badge>}</span>,
                orders: formatCount(x.orders), revenue: <Money value={x.revenue} />, contribution: <Money value={x.contribution} />,
                meta: <Money value={x.metaSpend} tone="mut" />,
              },
              sort: { orders: x.orders, revenue: x.revenue, contribution: x.contribution, meta: x.metaSpend },
            }))}
            empty={<EmptyState compact title="Sem pedidos no período" />}
          />
        </Block>
      </section>

      <section id="abas" className={s.section}>
        <h2 className={s.h2}>Abas <code>Tabs · SegmentedLinks · Segmented · ClientTabs</code></h2>
        <Card pad="md">
          <Tabs ariaLabel="Exemplo" active="a" items={[
            { key: 'a', label: 'Campanhas', href: ctx.hrefWith('/dev/ui#abas'), count: 6 },
            { key: 'b', label: 'Criativos', href: ctx.hrefWith('/dev/ui#abas'), count: 158 },
            { key: 'c', label: 'Conjuntos', href: ctx.hrefWith('/dev/ui#abas') },
          ]} />
          <div style={{ marginTop: 14 }}><SegmentedDemo /></div>
          <div style={{ marginTop: 14 }}>
            <ClientTabs ariaLabel="Detalhe" tabs={[
              { key: 'dia', label: 'Por dia', content: <p className="sec2">{days.length} dias no período.</p> },
              { key: 'loja', label: 'Por loja', content: <div className={s.row}>{todas.stores.map(r => <VerdictChips key={r.id} chips={[storeStatus(r)]} size="sm" />)}</div> },
            ]} />
          </div>
        </Card>
      </section>

      <section id="estados" className={s.section}>
        <h2 className={s.h2}>Vazio, erro, carregando <code>EmptyState · ErrorState · Skeleton</code></h2>
        <div className={s.grid3}>
          <Card><EmptyState icon="ring" title="Sem vendas no período">Nenhum pedido entre {main.rangeLabel}. Não é erro de coleta.</EmptyState></Card>
          <Card><ErrorState action={<Button size="sm" icon="refresh">Tentar de novo</Button>} /></Card>
          <SkeletonBlock height={90} lines={2} />
        </div>
        <Card pad="md"><div style={{ display: 'grid', gap: 8 }}><Skeleton width="40%" /><Skeleton width="70%" height={11} /><Skeleton height={60} radius={10} /></div></Card>
        <InsightsCard storeId={store.id} from={main.range.from} to={main.range.to} split={ctx.split} />
      </section>

      <section id="celular" className={s.section}>
        <h2 className={s.h2}>Celular (390px) <code>VerdictCard compact · BreakdownBar thin · storeStatus</code></h2>
        <div className={s.phone}>
          <VerdictCard verdict={vTodas} compact roas={false} />
          <Card pad="md">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 9 }}>Para onde foi cada dólar hoje</div>
            <BreakdownBar pnl={vTodas.totals} size="thin" />
          </Card>
          {today && (
            <Card pad="md">
              <div style={{ fontSize: 15, fontWeight: 600 }}>Como o dia está andando</div>
              <IntradayCurve points={today.hourly ?? []} nowMinutes={today.partial ? today.minutesCovered : null} width={340} height={200} ariaLabel="Lucro acumulado de hoje" />
            </Card>
          )}
          {month && (
            <Card pad="md">
              <div style={{ fontSize: 15, fontWeight: 600 }}>Últimos 30 dias</div>
              <DailyProfitBars width={340} height={190} annotate={false}
                days={month.daily.map(d => ({ date: d.date, profit: ctx.part(d.operatingProfit), revenue: d.revenue, metaSpend: d.metaSpend, shopSpend: d.shopSpend, orders: d.orders }))}
                selected={main.range} selectedLabel="7 dias" partialDate={storeToday} today={storeToday} ariaLabel="Lucro por dia, 30 dias" />
            </Card>
          )}
          <PhoneStores view={todas} />
        </div>
      </section>
    </AppShell>
  )
}

function PhoneStores({ view }: { view: PortfolioView }) {
  return (
    <Card>
      {view.stores.map(r => {
        const chip = storeStatus(r)
        const t = r.totals
        const noSales = t.orders === 0 && t.revenue <= 0
        return (
          <div key={r.id} className={s.phoneRow}>
            <Avatar name={r.name} />
            <div>
              <b>{r.name}</b>
              <small>{noSales ? 'nenhuma venda hoje ainda' : `${plural(t.orders, 'pedido', 'pedidos')} · vendas ${formatMoney(t.revenue)}`}</small>
              {r.dayClosed && <small>dia de {r.timezone === 'Asia/Tokyo' ? 'Tóquio' : r.timezone}, já fechado</small>}
            </div>
            <div className={s.phoneVal}>
              {noSales || !r.configured ? <b className="num mut">—</b> : <Money value={t.operatingProfit} sign tone="auto" className="num" />}
              <VerdictChips chips={[chip]} size="sm" />
            </div>
          </div>
        )
      })}
    </Card>
  )
}

