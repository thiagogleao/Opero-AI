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
 *          adsPerAdset?: number (biggest ads shown per ad set, default 6) }
 */

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { CampaignReport, CampaignRow } from '@/lib/data/campaigns'
import type { CreativeRow } from '@/lib/data/creatives'
import { Badge, Chip, Count, EmptyState, Money } from '@/components/ui'
import { formatMoney, formatRoas, plural } from '@/lib/format'
import { RoasCell } from './RoasCell'
import { ExpandableTable, type ExpandableColumn, type ExpandableRow } from './ExpandableTable'
import { ACTION_CHIP, adSignalChip, ptText, trendSpec } from './text'
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

/** Ad sets of one campaign from its ads, biggest spend first. */
export function groupAdsets(ads: CreativeRow[]): AdsetGroup[] {
  const groups = new Map<string, AdsetGroup>()
  for (const a of ads) {
    const key = a.adsetId ?? ''
    const g = groups.get(key) ?? {
      key, name: a.adsetName ?? (a.adsetId ? `Conjunto ${a.adsetId}` : 'Conjunto não sincronizado'),
      spend: 0, purchaseValue: 0, purchases: 0, estimatedProfit: null, ads: [],
    }
    g.spend += a.spend
    g.purchaseValue += a.purchaseValue
    g.purchases += a.purchases
    if (a.estimatedProfit !== null) g.estimatedProfit = (g.estimatedProfit ?? 0) + a.estimatedProfit
    g.ads.push(a)
    groups.set(key, g)
  }
  for (const g of groups.values()) g.ads.sort((x, y) => y.spend - x.spend)
  return [...groups.values()].sort((a, b) => b.spend - a.spend)
}

function SignalCell({ ad, breakEven }: { ad: CreativeRow; breakEven: number | null }) {
  const sig = ad.verdict.signal
  if (!sig) return <span className={s.why} title={ptText(ad.verdict.reason)}>{ad.running ? 'sem veredito' : 'pausado'}</span>
  const spec = adSignalChip(sig, ad.roas, breakEven)
  return <span title={ptText(ad.verdict.reason)}><Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip></span>
}

function CampaignDetail({ row, ads, hrefWith, adsPerAdset, breakEven }: {
  row: CampaignRow; ads: CreativeRow[]; hrefWith: (path: string) => string; adsPerAdset: number; breakEven: number | null
}) {
  const notes: ReactNode[] = []
  if (row.shared) notes.push(<p key="shared" className={s.detailNote}><b>Conta compartilhada.</b> {row.shared.note} O gasto continua nesta loja.</p>)
  if (row.phantomValueDropped > 0) notes.push(<p key="ph" className={s.detailNote}>{formatMoney(row.phantomValueDropped)} de compras impossíveis reportadas pelo Meta foram descartadas desta campanha.</p>)

  if (row.unsynced) {
    // Ads that the catalog does not know often show up with a cent or nothing:
    // listing dozens of "$0" lines hides the few that carry the spend.
    const spent = row.unsyncedAds.filter(a => a.spend >= 0.005)
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
            <th className={s.nr}>Lucro estimado</th>
            <th>Veredito do anúncio</th>
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
                <td className={`${s.nr} ${g.estimatedProfit !== null && g.estimatedProfit < 0 ? s.neg : ''}`}>{formatMoney(g.estimatedProfit)}</td>
                <td />
              </tr>,
              ...shown.map(a => (
                <tr key={`ad:${a.adId}`} className={s.adRow}>
                  <td><Link className={s.adLink} href={hrefWith(`/creatives/${encodeURIComponent(a.adId)}`)}>{a.name}</Link></td>
                  <td className={s.nr}>{formatMoney(a.spend)}</td>
                  <td className={s.nr}>{a.purchases}</td>
                  <td className={s.nr}>{formatRoas(a.roas)}</td>
                  <td className={`${s.nr} ${a.estimatedProfit !== null && a.estimatedProfit < 0 ? s.neg : ''}`}>{formatMoney(a.estimatedProfit)}</td>
                  <td><SignalCell ad={a} breakEven={breakEven} /></td>
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

export function CampaignTable({ report, creatives, hrefWith, rangeLabel, adsPerAdset = 6 }: {
  report: CampaignReport; creatives: CreativeRow[]; hrefWith: (path: string) => string; rangeLabel: string; adsPerAdset?: number
}) {
  const be = report.breakEvenRoas
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
    { key: 'est', label: 'Lucro estimado', numeric: true, info: ptText(report.formula) },
    { key: 'verdict', label: `Veredito · ${days} dias`, width: 240, info: `Veredito e tendência dos últimos ${days} dias fechados. A ação é julgada sempre nos últimos ${days} dias fechados, seja qual for o período da tabela; a regra está no bloco "Onde há folga para escalar". A tendência compara o ROAS desses ${days} dias com o dos ${days} anteriores, e só aparece quando os dois períodos tiveram gasto de verdade.` },
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
    else subParts.push(<span key="n">{plural(c.unsyncedAds.length, 'anúncio', 'anúncios')}</span>)
    if (c.shared) subParts.push(<Badge key="sh" tone="warn" icon="alert" title={c.shared.note}>conta compartilhada</Badge>)
    if (c.phantomValueDropped > 0) subParts.push(<Badge key="ph" tone="mut" title="Compras impossíveis descartadas">−{formatMoney(c.phantomValueDropped)} fantasma</Badge>)
    return {
      key: c.campaignId ?? `unsynced:${c.accountId ?? ''}`,
      tone: c.running ? undefined : 'mut',
      toggleLabel: c.unsynced ? 'os anúncios sem nome' : 'conjuntos e anúncios',
      detail: <CampaignDetail row={c} ads={ads} hrefWith={hrefWith} adsPerAdset={adsPerAdset} breakEven={be} />,
      cells: {
        name: <><span className={s.cName}>{c.name}</span><span className={s.cSub}>{subParts}</span></>,
        spend: <Money value={c.spend} />,
        purchases: <Count value={c.purchases} />,
        pv: <Money value={c.purchaseValue} />,
        // Unsynced spend has no campaign to judge (and no known status): its
        // ROAS is shown without "no prejuízo" or "pausada".
        roas: c.shared
          ? <span className={s.why}>{formatRoas(c.roas)} · sem empate (conta compartilhada)</span>
          : c.unsynced
            ? <span className={s.why}>{formatRoas(c.roas)} · sem campanha para julgar</span>
            : <RoasCell roas={c.roas} breakEven={be} paused={!c.running} />,
        est: c.estimatedProfit === null ? <span className={s.muted}>—</span> : <Money value={c.estimatedProfit} />,
        verdict: (
          <span className={s.verdictCell}>
            <span className={s.verdictTop}>
              {spec ? <Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip> : null}
              <span className={`${s.trend} ${TREND_CLASS[trend.tone]}`} title={trend.title}>{trend.text}<span className="sr-only"> — {trend.title}</span></span>
            </span>
            <span className={s.why}>{ptText(d.reason)}</span>
          </span>
        ),
      },
    }
  })

  const t = report.totals
  return (
    <ExpandableTable
      // A new store or window starts with every row closed (no open state
      // carried over from the previous list on client navigation).
      key={`${report.storeId}:${report.range.from}:${report.range.to}`}
      caption={`Campanhas da loja em ${rangeLabel}`}
      columns={columns}
      rows={rows}
      empty={<EmptyState title="Nenhuma campanha com gasto no período">O Meta não registrou gasto nem venda atribuída nestas datas.</EmptyState>}
      footer={{
        name: <span>Total · {plural(t.campaigns, 'campanha', 'campanhas')}</span>,
        spend: <Money value={t.spend} />,
        purchases: <Count value={t.purchases} />,
        pv: <Money value={t.purchaseValue} />,
        roas: <span className={s.why}>ROAS atribuído {formatRoas(t.roas)}{be !== null ? ` · empate ${formatRoas(be)}` : ''}</span>,
        est: t.estimatedProfit === null ? <span className={s.muted}>—</span> : <Money value={t.estimatedProfit} />,
      }}
    />
  )
}
