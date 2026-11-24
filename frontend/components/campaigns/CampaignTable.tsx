/**
 * The campaigns table: Meta's numbers for the page's window, the campaign's
 * estimated profit, the action (judged on the last 7 closed days) and the
 * trend arrow. Each campaign opens to its ad sets and their biggest ads.
 *
 * The ad sets and ads come from the creatives report of the same window (one
 * fact read for the whole store), grouped here by campaign and ad set — not a
 * query per campaign. Server component; the open/closed state lives in the
 * client ExpandableTable.
 *
 * Props: { report: CampaignReport; creatives: CreativeRow[]; hrefWith: (path) => string; rangeLabel;
 *          split?: boolean (partner view: every estimated profit is the partner's
 *            half, labelled "sua parte" — the same rule as the Resumo's campaigns
 *            block and the verdict above; spend, sales and ROAS stay whole);
 *          adsPerAdset?: number (biggest ads shown per ad set, default 6) }
 */

import type { ReactNode } from 'react'
import Link from 'next/link'
import { spentAds, type CampaignReport, type CampaignRow } from '@/lib/data/campaigns'
import type { CreativeRow } from '@/lib/data/creatives'
import { Badge, Chip, Count, EmptyState, Money } from '@/components/ui'
import { formatMoney, formatRoas, plural } from '@/lib/format'
import { SPLIT_SHARE } from '@/lib/views/verdict'
import { RoasCell } from './RoasCell'
import { WhyEmpty, type EmptyWindowText } from './emptyWhy'
import { ownAttributedRoas, sharedCampaigns } from './adsVerdict'
import { ExpandableTable, type ExpandableColumn, type ExpandableRow } from './ExpandableTable'
import { ACTION_CHIP, adVerdictChip, phantomBadge, phantomNote, ptText, trendSpec } from './text'
import s from './campaigns.module.css'

const TREND_CLASS = { pos: s.trendPos, neg: s.trendNeg, neu: s.trendNeu, mut: s.trendMut } as const

interface AdsetGroup {
  key: string
  name: string
  spend: number
  purchaseValue: number
  purchases: number
  estimatedProfit: number | null
  ads: CreativeRow[]
}

/**
 * Ad sets of one campaign from its ads, biggest spend first. An ad set's
 * estimated profit is the sum of its ads', and null as soon as one of them
 * is unpriced: on a day without sales an ad Meta credited is unpriced while
 * the others are −spend, and their sum alone would pass for the ad set's
 * estimate (the campaign row, priced on all of them, reads "—" then).
 */
export function groupAdsets(ads: CreativeRow[]): AdsetGroup[] {
  const groups = new Map<string, AdsetGroup & { unpriced: boolean }>()
  for (const a of ads) {
    const key = a.adsetId ?? ''
    const g = groups.get(key) ?? {
      key, name: a.adsetName ?? (a.adsetId ? `Conjunto ${a.adsetId}` : 'Conjunto não sincronizado'),
      spend: 0, purchaseValue: 0, purchases: 0, estimatedProfit: null, ads: [], unpriced: false,
    }
    g.spend += a.spend
    g.purchaseValue += a.purchaseValue
    g.purchases += a.purchases
    if (a.estimatedProfit === null) g.unpriced = true
    else g.estimatedProfit = (g.estimatedProfit ?? 0) + a.estimatedProfit
    g.ads.push(a)
    groups.set(key, g)
  }
  return [...groups.values()]
    .map(({ unpriced, ...g }) => ({ ...g, estimatedProfit: unpriced ? null : g.estimatedProfit, ads: g.ads.sort((x, y) => y.spend - x.spend) }))
    .sort((a, b) => b.spend - a.spend)
}

/** The ad's verdict, judged on the same closed days as the campaign's action
 *  (lib/data/creatives): its word comes from the verdict, not the row's ROAS. */
function SignalCell({ ad }: { ad: CreativeRow }) {
  const spec = adVerdictChip(ad.verdict)
  if (!spec) return <span className={s.why} title={ptText(ad.verdict.reason)}>{ad.running ? 'sem veredito' : 'pausado'}</span>
  return <span title={ptText(ad.verdict.reason)}><Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip></span>
}

/** "Lucro estimado" with "(sua parte)" on a second line: one line, the split
 *  label widened the column by ~75px and pushed the verdict column past the
 *  table's box at 1440. */
function ProfitLabel({ split }: { split: boolean }) {
  if (!split) return <>Lucro estimado</>
  return <span className={s.thStack}>Lucro estimado<span className={s.thSub}>(sua parte)</span></span>
}

/** "44 anúncios com gasto": the unsynced bucket counted as the Resumo counts
 *  it (lib/data/campaigns spentAds); a bucket with no spend at all says so. */
function unsyncedCount(ads: readonly { spend: number }[]): string {
  const n = spentAds(ads).length
  return n > 0 ? plural(n, 'anúncio com gasto', 'anúncios com gasto') : plural(ads.length, 'anúncio sem gasto', 'anúncios sem gasto')
}

/** The partner's half of an estimated profit (null stays null). */
const share = (v: number | null, k: number) => (v === null ? null : v * k)

function CampaignDetail({ row, ads, hrefWith, adsPerAdset, k, days }: {
  row: CampaignRow; ads: CreativeRow[]; hrefWith: (path: string) => string; adsPerAdset: number
  /** SPLIT_SHARE in the partner view, else 1. */
  k: number
  /** Closed days the campaign's action and its ads' verdicts are judged on. */
  days: number
}) {
  const notes: ReactNode[] = []
  if (row.shared) notes.push(<p key="shared" className={s.detailNote}><b>Conta compartilhada.</b> {row.shared.note} O gasto continua nesta loja.</p>)
  if (row.phantomValueDropped > 0) notes.push(<p key="ph" className={s.detailNote}>{formatMoney(row.phantomValueDropped)} de compras impossíveis reportadas pelo Meta foram descartadas desta campanha.</p>)

  if (row.unsynced) {
    // Ads that the catalog does not know often show up with a cent or nothing:
    // listing dozens of "$0" lines hides the few that carry the spend.
    const spent = spentAds(row.unsyncedAds)
    const idle = row.unsyncedAds.length - spent.length
    return (
      <div>
        <p className={s.detailNote}>Gasto de anúncios que a sincronização com o Meta ainda não descreveu: sem nome, conjunto ou campanha. Ele continua na conta da loja e no total.</p>
        <table className={s.nested}>
          <thead><tr><th>Anúncio</th><th className={s.nr}>Gasto</th></tr></thead>
          <tbody>
            {spent.map(a => (
              <tr key={a.adId} className={s.adRow}><td>{a.name}</td><td className={s.nr}>{formatMoney(a.spend)}</td></tr>
            ))}
            {idle > 0 && (
              <tr className={s.moreRow}><td colSpan={2}>e mais {plural(idle, 'anúncio', 'anúncios')} sem gasto no período</td></tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  const adsets = groupAdsets(ads)
  if (!adsets.length) {
    return <>{notes}<p className={s.detailNote}>Nenhum anúncio desta campanha teve gasto ou venda no período.</p></>
  }
  const creativesHref = row.campaignId ? hrefWith(`/campaigns?aba=criativos&campanha=${encodeURIComponent(row.campaignId)}`) : null
  return (
    <div>
      {notes}
      <table className={s.nested}>
        <thead>
          <tr>
            <th>Conjunto · anúncio</th>
            <th className={s.nr}>Gasto</th>
            <th className={s.nr}>Compras</th>
            <th className={s.nr}>ROAS</th>
            <th className={s.nr}><ProfitLabel split={k !== 1} /></th>
            <th title={`Julgado nos últimos ${days} dias fechados, como a campanha, seja qual for o período da tabela.`}>Veredito do anúncio · {days} dias</th>
          </tr>
        </thead>
        <tbody>
          {adsets.map(g => {
            const shown = g.ads.slice(0, adsPerAdset)
            const rest = g.ads.slice(adsPerAdset)
            const restSpend = rest.reduce((t, a) => t + a.spend, 0)
            return [
              <tr key={`set:${g.key}`} className={s.adsetRow}>
                <td>{g.name} <span className={s.muted}>· {plural(g.ads.length, 'anúncio', 'anúncios')}</span></td>
                <td className={s.nr}>{formatMoney(g.spend)}</td>
                <td className={s.nr}>{g.purchases}</td>
                <td className={s.nr}>{formatRoas(g.spend > 0 ? g.purchaseValue / g.spend : null)}</td>
                <td className={`${s.nr} ${g.estimatedProfit !== null && g.estimatedProfit < 0 ? s.neg : ''}`}>{formatMoney(share(g.estimatedProfit, k))}</td>
                <td />
              </tr>,
              ...shown.map(a => (
                <tr key={`ad:${a.adId}`} className={s.adRow}>
                  <td><Link className={s.adLink} href={hrefWith(`/creatives/${encodeURIComponent(a.adId)}`)}>{a.name}</Link></td>
                  <td className={s.nr}>{formatMoney(a.spend)}</td>
                  <td className={s.nr}>{a.purchases}</td>
                  <td className={s.nr}>{formatRoas(a.roas)}</td>
                  <td className={`${s.nr} ${a.estimatedProfit !== null && a.estimatedProfit < 0 ? s.neg : ''}`}>{formatMoney(share(a.estimatedProfit, k))}</td>
                  <td><SignalCell ad={a} /></td>
                </tr>
              )),
              rest.length > 0 ? (
                <tr key={`more:${g.key}`} className={s.moreRow}>
                  <td colSpan={6}>
                    e mais {plural(rest.length, 'anúncio menor', 'anúncios menores')} ({formatMoney(restSpend)} de gasto)
                    {creativesHref && <> · <Link className={s.adLink} href={creativesHref}>ver todos os anúncios da campanha</Link></>}
                  </td>
                </tr>
              ) : null,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

export function CampaignTable({ report, creatives, hrefWith, rangeLabel, split = false, adsPerAdset = 6, why = null }: {
  report: CampaignReport; creatives: CreativeRow[]; hrefWith: (path: string) => string; rangeLabel: string; split?: boolean; adsPerAdset?: number
  /** The verdict's reason the window is empty (./emptyWhy), for the empty table. */
  why?: EmptyWindowText | null
}) {
  const be = report.breakEvenRoas
  const k = split ? SPLIT_SHARE : 1
  const byCampaign = new Map<string, CreativeRow[]>()
  for (const c of creatives) {
    if (!c.campaignId) continue
    const list = byCampaign.get(c.campaignId) ?? []
    list.push(c)
    byCampaign.set(c.campaignId, list)
  }
  const days = report.thresholds.windowDays

  const columns: ExpandableColumn[] = [
    { key: 'name', label: 'Campanha' },
    { key: 'spend', label: 'Gasto', numeric: true },
    { key: 'purchases', label: 'Compras', numeric: true, info: 'Compras que o Meta atribui à campanha (pixel), não pedidos da Shopify.' },
    { key: 'pv', label: 'Vendas atribuídas', numeric: true, info: 'O que o Meta credita à campanha. Compras impossíveis (acima de $20.000 num dia de um anúncio) já foram descartadas.' },
    { key: 'roas', label: be !== null ? `ROAS × empate ${formatRoas(be)}` : 'ROAS', info: 'Vendas atribuídas ÷ gasto, contra o empate da loja no mesmo período (receita ÷ contribuição). Abaixo do empate, cada dólar gasto vira prejuízo.' },
    { key: 'est', label: <ProfitLabel split={split} />, numeric: true, info: split ? `${ptText(report.formula)} Na visão de sócio, cada valor é a sua parte (50%).` : ptText(report.formula) },
    // Under ~1100px of table box the column hides and the same verdict shows
    // under the campaign name (campaigns.module.css, container query): at
    // 1024 and 1280 it used to start off-screen behind a thin scrollbar.
    { key: 'verdict', label: `Veredito · ${days} dias`, width: 240, className: s.colVerdict, info: `Veredito e tendência dos últimos ${days} dias fechados. A ação é julgada sempre nos últimos ${days} dias fechados, seja qual for o período da tabela; a regra está no bloco "Onde há folga para escalar". A tendência compara o ROAS desses ${days} dias com o dos ${days} anteriores, e só aparece quando os dois períodos tiveram gasto de verdade.` },
  ]

  const rows: ExpandableRow[] = report.campaigns.map(c => {
    const d = c.decision
    const spec = d.action ? ACTION_CHIP[d.action] : null
    const trend = trendSpec(d.trend, d.trendChange, days)
    const ads = c.campaignId ? byCampaign.get(c.campaignId) ?? [] : []
    const subParts: ReactNode[] = [
      <span key="st"><i className={`${s.dot} ${c.running ? s.dotOn : ''}`} aria-hidden="true" /> {c.unsynced ? 'sem campanha' : c.running ? 'ativa' : 'pausada'}</span>,
    ]
    if (!c.unsynced) subParts.push(<span key="n">{plural(c.adsets, 'conjunto', 'conjuntos')} · {plural(c.ads, 'anúncio', 'anúncios')}</span>)
    // The ads that spent, as the Resumo counts this bucket; the ones without
    // spend are named only inside it ("e mais 15 anúncios sem gasto").
    else subParts.push(<span key="n">{unsyncedCount(c.unsyncedAds)}</span>)
    if (c.shared) subParts.push(<Badge key="sh" tone="warn" icon="alert" title={c.shared.note}>conta compartilhada</Badge>)
    // In words, no minus sign: next to the money columns "−$183.000" read as
    // a loss. The amount is what Meta reported and was thrown away.
    if (c.phantomValueDropped > 0) subParts.push(<Badge key="ph" tone="mut" title={phantomNote(c.phantomValueDropped)}>{phantomBadge(c.phantomValueDropped)}</Badge>)
    const verdictTop = (
      <span className={s.verdictTop}>
        {spec ? <Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip> : null}
        <span className={`${s.trend} ${TREND_CLASS[trend.tone]}`} title={trend.title}>{trend.text}<span className="sr-only"> — {trend.title}</span></span>
      </span>
    )
    return {
      key: c.campaignId ?? `unsynced:${c.accountId ?? ''}`,
      tone: c.running ? undefined : 'mut',
      toggleLabel: c.unsynced ? 'os anúncios sem nome' : 'conjuntos e anúncios',
      detail: <CampaignDetail row={c} ads={ads} hrefWith={hrefWith} adsPerAdset={adsPerAdset} k={k} days={days} />,
      cells: {
        name: (
          <>
            <span className={s.cName}>{c.name}</span><span className={s.cSub}>{subParts}</span>
            <span className={s.inlineVerdict}>
              <span className={s.inlineVerdictLabel}>Veredito · {days} dias</span>
              {verdictTop}
              <span className={s.why}>{ptText(d.reason)}</span>
            </span>
          </>
        ),
        spend: <Money value={c.spend} />,
        purchases: <Count value={c.purchases} />,
        pv: <Money value={c.purchaseValue} />,
        // Unsynced spend has no campaign to judge (and no known status): its
        // ROAS is shown without "no prejuízo" or "pausada".
        roas: c.shared
          ? <span className={s.why}>{formatRoas(c.roas)} · sem empate (conta compartilhada)</span>
          : c.unsynced
            ? <span className={s.why}>{formatRoas(c.roas)} · sem campanha para julgar</span>
            : <RoasCell roas={c.roas} breakEven={be} paused={!c.running}
                configured={report.configured} revenue={report.storeRevenue} contribution={report.contributionRate} />,
        est: c.estimatedProfit === null ? <span className={s.muted}>—</span> : <Money value={c.estimatedProfit * k} />,
        verdict: (
          <span className={s.verdictCell}>
            {verdictTop}
            <span className={s.why}>{ptText(d.reason)}</span>
          </span>
        ),
      },
    }
  })

  const t = report.totals
  // The Total row's ROAS atribuído is the verdict's: the store's own campaigns
  // only. Over every row, EPOCH's October read 1,56× (CAMP HALLOW's sales on
  // the shared account counted) under the verdict's 1,35×, same label.
  const own = ownAttributedRoas(report)
  const sharedOut = sharedCampaigns(report)
  return (
    <ExpandableTable
      // A new store or window starts with every row closed (no open state
      // carried over from the previous list on client navigation).
      key={`${report.storeId}:${report.range.from}:${report.range.to}`}
      caption={`Campanhas da loja em ${rangeLabel}`}
      columns={columns}
      rows={rows}
      empty={why ? <WhyEmpty why={why} compact={false} /> : <EmptyState title="Nenhuma campanha com gasto no período">O Meta não registrou gasto nem venda atribuída nestas datas.</EmptyState>}
      footer={{
        // Only the unsynced bucket (Glooty, 12 nov): "Total · 0 campanhas"
        // over $138 of spend named nothing.
        name: <span>Total · {t.campaigns === 0 && rows.length > 0 ? 'anúncios ainda não sincronizados' : plural(t.campaigns, 'campanha', 'campanhas')}</span>,
        spend: <Money value={t.spend} />,
        purchases: <Count value={t.purchases} />,
        pv: <Money value={t.purchaseValue} />,
        roas: (
          <span className={s.why}>
            ROAS atribuído {formatRoas(own.roas)}{be !== null ? ` · empate ${formatRoas(be)}` : ''}
            {sharedOut.spend > 0 && <span className={s.whyBlock}>só as campanhas desta loja: sem {formatMoney(sharedOut.spend)} de conta compartilhada</span>}
          </span>
        ),
        est: t.estimatedProfit === null ? <span className={s.muted}>—</span> : <Money value={t.estimatedProfit * k} />,
      }}
    />
  )
}
