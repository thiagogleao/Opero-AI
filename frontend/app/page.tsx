import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getTenant, getTenantsByUserId } from '@/lib/tenant'
import { getActiveTenantId } from '@/lib/activeStore'
import StoreSwitcher from '@/components/StoreSwitcher'
import {
  getOverviewMetrics, getDailyRevenue, getDailyRoas,
  getTopCreatives, getCountryMetrics, getCustomerSplit, getLastSyncTime,
  getFunnelMetrics, getCountrySpend, getTenantTimezone,
  getBreakdownByType, getCustomerLtv,
} from '@/lib/queries'
import { getProfitSummary, getCountryProfit, getDailyProfitData } from '@/lib/profitCalc'
import TimeframeSelector from '@/components/TimeframeSelector'
import RefreshButton from '@/components/RefreshButton'
import AutoSync from '@/components/AutoSync'
import DashboardLayout from '@/components/DashboardLayout'
import Sidebar from '@/components/Sidebar'
import PartnerSplitToggle from '@/components/PartnerSplitToggle'
import { getTranslations } from '@/lib/translations'
import type { Language } from '@/contexts/SettingsContext'

export const revalidate = 0

/** Returns YYYY-MM-DD in the given IANA timezone. */
function dateInTz(d: Date, tz: string): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

interface Props {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>
}

export default async function Dashboard({ searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  let tenantId: string | null = null
  let tenant = null
  try {
    tenantId = await getActiveTenantId(userId!)
    tenant = await getTenant(tenantId)
  } catch {
    redirect('/onboarding')
  }
  if (!tenant?.onboarded) redirect('/onboarding')
  const tid = tenantId as string

  let stores: Awaited<ReturnType<typeof getTenantsByUserId>> = []
  let storeTimezone = 'UTC'
  try {
    stores = await getTenantsByUserId(userId!)
    storeTimezone = await getTenantTimezone(tid)
  } catch { /* use defaults */ }

  const sp = await searchParams
  const cookieStore = await cookies()
  const isSplit = cookieStore.get('split_50')?.value === 'true'
  const lang = (cookieStore.get('opero_lang')?.value ?? 'pt') as Language
  const tr = getTranslations(lang)
  const now = new Date()
  const todayISO = dateInTz(now, storeTimezone)

  let dateFrom: string
  let dateTo: string

  if (sp.from && sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) {
    dateFrom = sp.from
    dateTo   = sp.to
  } else {
    // Legacy ?days= or default 30 days
    const days = Math.min(Math.max(Number(sp.days) || 30, 1), 730)
    const fromDate = new Date(now.getTime() - (days - 1) * 86400000)
    dateFrom = dateInTz(fromDate, storeTimezone)
    dateTo   = todayISO
  }

  // Days count for display and AI prompt
  const fromMs = new Date(dateFrom).getTime()
  const toMs   = new Date(dateTo).getTime()
  const days   = Math.round((toMs - fromMs) / 86400000) + 1

  // Breakdowns always use last 14 days (limited by FB API)
  const bd14From = dateInTz(new Date(now.getTime() - 13 * 86400000), storeTimezone)

  // DEBUG: run each query individually to identify which one fails
  const queryNames = [
    'getOverviewMetrics', 'getDailyRevenue', 'getDailyRoas', 'getTopCreatives',
    'getCountryMetrics', 'getCustomerSplit', 'getLastSyncTime', 'getProfitSummary',
    'getFunnelMetrics', 'getCountrySpend', 'getCountryProfit', 'getDailyProfitData',
    'getBreakdownByType(device)', 'getBreakdownByType(placement)', 'getBreakdownByType(age_gender)',
    'getCustomerLtv',
  ]
  const queryFns = [
    () => getOverviewMetrics(tid, dateFrom, dateTo),
    () => getDailyRevenue(tid, dateFrom, dateTo),
    () => getDailyRoas(tid, dateFrom, dateTo),
    () => getTopCreatives(tid, dateFrom, dateTo),
    () => getCountryMetrics(tid, dateFrom, dateTo),
    () => getCustomerSplit(tid, dateFrom, dateTo),
    () => getLastSyncTime(tid),
    () => getProfitSummary(tid, dateFrom, dateTo),
    () => getFunnelMetrics(tid, dateFrom, dateTo),
    () => getCountrySpend(tid, dateFrom, dateTo),
    () => getCountryProfit(tid, dateFrom, dateTo),
    () => getDailyProfitData(tid, dateFrom, dateTo),
    () => getBreakdownByType(tid, bd14From, todayISO, 'device'),
    () => getBreakdownByType(tid, bd14From, todayISO, 'placement'),
    () => getBreakdownByType(tid, bd14From, todayISO, 'age_gender'),
    () => getCustomerLtv(tid),
  ]
  const debugResults: { name: string; ok: boolean; error?: string }[] = []
  for (let i = 0; i < queryFns.length; i++) {
    try { await queryFns[i](); debugResults.push({ name: queryNames[i], ok: true }) }
    catch (e: unknown) { debugResults.push({ name: queryNames[i], ok: false, error: e instanceof Error ? e.message : String(e) }) }
  }
  const hasError = debugResults.some(r => !r.ok)
  if (hasError) {
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', background: '#0a0a0a', color: '#e5e5e5', minHeight: '100vh' }}>
        <h2 style={{ color: '#f43f5e', marginBottom: 24 }}>Dashboard Debug — Query Errors</h2>
        <p style={{ color: '#71717a', marginBottom: 24 }}>tenantId: <b style={{color:'#a1a1aa'}}>{tid}</b> | from: {dateFrom} to: {dateTo}</p>
        {debugResults.map((r, i) => (
          <div key={i} style={{ marginBottom: 12, padding: '10px 14px', background: r.ok ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.12)', borderRadius: 8, border: `1px solid ${r.ok ? '#10b981' : '#f43f5e'}40` }}>
            <span style={{ color: r.ok ? '#10b981' : '#f43f5e', fontWeight: 700 }}>{r.ok ? '✓' : '✗'} {r.name}</span>
            {r.error && <pre style={{ color: '#fca5a5', marginTop: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.error}</pre>}
          </div>
        ))}
      </div>
    )
  }

  let queryResult
  try {
    queryResult = await Promise.all([
      getOverviewMetrics(tid, dateFrom, dateTo),
      getDailyRevenue(tid, dateFrom, dateTo),
      getDailyRoas(tid, dateFrom, dateTo),
      getTopCreatives(tid, dateFrom, dateTo),
      getCountryMetrics(tid, dateFrom, dateTo),
      getCustomerSplit(tid, dateFrom, dateTo),
      getLastSyncTime(tid),
      getProfitSummary(tid, dateFrom, dateTo),
      getFunnelMetrics(tid, dateFrom, dateTo),
      getCountrySpend(tid, dateFrom, dateTo),
      getCountryProfit(tid, dateFrom, dateTo),
      getDailyProfitData(tid, dateFrom, dateTo),
      getBreakdownByType(tid, bd14From, todayISO, 'device').catch(() => [] as Awaited<ReturnType<typeof getBreakdownByType>>),
      getBreakdownByType(tid, bd14From, todayISO, 'placement').catch(() => [] as Awaited<ReturnType<typeof getBreakdownByType>>),
      getBreakdownByType(tid, bd14From, todayISO, 'age_gender').catch(() => [] as Awaited<ReturnType<typeof getBreakdownByType>>),
      getCustomerLtv(tid).catch(() => [] as Awaited<ReturnType<typeof getCustomerLtv>>),
    ])
  } catch {
    redirect('/onboarding')
  }
  const [metrics, revenue, roas, creatives, countries, customers, syncs, profitRaw, funnel, countrySpend, countryProfitRaw, dailyProfitRaw, bdDevice, bdPlacement, bdAgeGender, ltvData] = queryResult

  const splitFactor = isSplit ? 0.5 : 1
  const profit = {
    ...profitRaw,
    netProfit:          profitRaw.netProfit          * splitFactor,
    avgProfitPerOrder:  profitRaw.avgProfitPerOrder  * splitFactor,
    margin:             profitRaw.margin             * splitFactor,
  }
  const dailyProfit = {
    ...dailyProfitRaw,
    dailyData: dailyProfitRaw.dailyData.map(d => ({
      ...d,
      profit: d.profit * splitFactor,
      margin: d.margin != null ? d.margin * splitFactor : null,
    })),
  }
  const countryProfit = countryProfitRaw.map(c => ({
    ...c,
    netProfit: c.netProfit * splitFactor,
    margin:    c.margin    * splitFactor,
  }))

  const lastSyncIso = syncs[0]?.finished_at ?? null
  const lastSync = lastSyncIso
    ? new Date(lastSyncIso).toLocaleString('pt-BR', { timeZone: storeTimezone })
    : 'Nunca'

  const totalTried = Number(metrics.orders) + Number(metrics.abandoned_count)
  const abandonRate = totalTried > 0
    ? ((Number(metrics.abandoned_count) / totalTried) * 100).toFixed(1)
    : '0'

  const abandonedValue = Number(metrics.abandoned_value)
  const revenue30 = Number(metrics.revenue)
  const safeAbandonedValue = abandonedValue > revenue30 * 10 ? 0 : abandonedValue


  const beRoas = profit.configured ? profit.breakEvenRoas : 1.5

  // Rich creative data: signal diagnosis + video funnel per ad
  const creativesVideoText = creatives.slice(0, 8).map((c, i) => {
    const spend    = Number(c.spend)
    const roas     = Number(c.roas)
    const freq     = Number(c.frequency)
    const ctr      = Number(c.ctr)
    const hookRate = c.hook_rate != null ? Number(c.hook_rate) : null
    const isVideo  = (c.video_plays ?? 0) > 0

    let signal: string
    if (spend >= 50 && roas < beRoas * 0.8)                         signal = '⏹ KILL'
    else if (roas >= beRoas * 1.4 && spend >= 30)                    signal = '↑ SCALE'
    else if (freq > 3.5 || (hookRate !== null && hookRate < 25))     signal = '⚠ REFRESH'
    else                                                              signal = '✓ OK'

    const vf = isVideo && hookRate !== null
      ? ` | Hook:${hookRate.toFixed(1)}% P25:${c.hold_rate_25 != null ? Number(c.hold_rate_25).toFixed(1) : '?'}% P50:${c.hold_rate_50 != null ? Number(c.hold_rate_50).toFixed(1) : '?'}% P100:${c.hold_rate_100 != null ? Number(c.hold_rate_100).toFixed(1) : '?'}%`
      : hookRate != null ? ` | Hook:${hookRate.toFixed(1)}%` : ''

    return `  ${signal} "${c.name.slice(0, 52)}" | $${spend.toFixed(0)} gasto | ROAS ${roas.toFixed(2)}x (BE ${beRoas.toFixed(2)}x) | CTR ${ctr.toFixed(2)}% | Freq ${freq.toFixed(1)}x${vf}`
  }).join('\n')

  const countriesText = countries.slice(0, 8).map((c, i) =>
    `  ${i + 1}. ${c.country_code} | Receita: $${Number(c.revenue).toFixed(2)} | Pedidos: ${c.orders}`
  ).join('\n')

  const recentRevenue = revenue.slice(-7).map(r =>
    `  ${r.date}: receita $${Number(r.revenue).toFixed(2)}, gasto $${Number(r.spend).toFixed(2)}`
  ).join('\n')

  const recentRoas = roas.slice(-7).map(r =>
    `  ${r.date}: ROAS ${Number(r.blended_roas).toFixed(2)}x`
  ).join('\n')

  const profitLine = profit.configured
    ? `Lucro Líquido: $${profit.netProfit.toFixed(2)} | Margem: ${profit.margin.toFixed(1)}% | Lucro/Pedido: $${profit.avgProfitPerOrder.toFixed(2)} | Break-even ROAS: ${profit.breakEvenRoas.toFixed(2)}x
Custos: COGS $${profit.totalCogs.toFixed(2)} | Frete $${profit.totalShipping.toFixed(2)} | Taxas $${profit.totalFees.toFixed(2)} | Extras $${profit.totalExtraCosts.toFixed(2)}`
    : 'Lucro: não configurado (acesse /profit para configurar)'

  const f = funnel
  const impToClick   = f.impressions > 0 ? (f.link_clicks / f.impressions * 100).toFixed(2) : '0'
  const clickToCart  = f.link_clicks > 0 ? (f.add_to_cart / f.link_clicks * 100).toFixed(1) : '0'
  const cartToCheck  = f.add_to_cart > 0 ? (f.initiate_checkout / f.add_to_cart * 100).toFixed(1) : '0'
  const checkToBuy   = f.initiate_checkout > 0 ? (f.purchases / f.initiate_checkout * 100).toFixed(1) : '0'
  const clickToBuy   = f.link_clicks > 0 ? (f.purchases / f.link_clicks * 100).toFixed(2) : '0'
  const funnelHasData = f.add_to_cart > 0 || f.initiate_checkout > 0

  const countrySpendText = countrySpend.length > 0
    ? countrySpend.map(c =>
        `  ${c.country}: gasto $${Number(c.spend).toFixed(2)} | receita FB $${Number(c.revenue).toFixed(2)} | ROAS FB ${Number(c.roas).toFixed(2)}x | ${c.purchases} compras | CPC $${Number(c.cpc).toFixed(3)}`
      ).join('\n')
    : 'Sem dados de breakdown (disponível após próxima coleta)'

  // FB ad breakdowns (device, placement, age_gender) — sorted best→worst by ROAS
  const bdText = (() => {
    const parts: string[] = []
    if (bdDevice.length > 0) {
      const sorted = [...bdDevice].sort((a, b) => Number(b.roas) - Number(a.roas))
      parts.push('Device: ' + sorted.slice(0, 4).map(r => `${r.label}(${Number(r.roas).toFixed(2)}x/$${Number(r.spend).toFixed(0)})`).join(' | '))
    }
    if (bdPlacement.length > 0) {
      const sorted = [...bdPlacement].sort((a, b) => Number(b.roas) - Number(a.roas))
      parts.push('Placement: ' + sorted.slice(0, 5).map(r => `${r.label}(${Number(r.roas).toFixed(2)}x/$${Number(r.spend).toFixed(0)})`).join(' | '))
    }
    if (bdAgeGender.length > 0) {
      const sorted = [...bdAgeGender].sort((a, b) => Number(b.roas) - Number(a.roas))
      const top  = sorted.slice(0, 3).map(r => `${r.label} ${Number(r.roas).toFixed(2)}x`).join(', ')
      const bot  = sorted.slice(-2).map(r => `${r.label} ${Number(r.roas).toFixed(2)}x/$${Number(r.spend).toFixed(0)}`).join(', ')
      parts.push(`Idade/Gênero — TOP: ${top} | PIORES: ${bot}`)
    }
    return parts.join('\n') || 'Sem dados de breakdown por segmento ainda'
  })()

  // LTV segments
  const ltvPromptText = ltvData.length > 0
    ? ltvData.map(d => `  ${d.segment}: ${d.customers}cls(${Number(d.pct).toFixed(0)}%) LTV=$${Number(d.avg_ltv).toFixed(0)} AOV=$${Number(d.avg_aov).toFixed(0)} ~${Number(d.avg_orders).toFixed(1)} pedidos`).join('\n')
    : '  Sem dados LTV ainda'

  const funnelText = funnelHasData
    ? `Impressões: ${f.impressions.toLocaleString()} | CTR: ${impToClick}% | CPM: $${Number(f.cpm).toFixed(2)} | CPC: $${Number(f.cpc).toFixed(3)}
Cliques: ${f.link_clicks.toLocaleString()} → Carrinho: ${f.add_to_cart.toLocaleString()} (${clickToCart}% dos cliques | custo/ATC: $${Number(f.cost_per_atc).toFixed(2)}) → Checkout: ${f.initiate_checkout.toLocaleString()} (${cartToCheck}% do carrinho | custo/checkout: $${Number(f.cost_per_checkout).toFixed(2)}) → Compras FB atribuídas: ${f.purchases.toLocaleString()} (${checkToBuy}% do checkout)
Taxa clique→compra FB: ${clickToBuy}% | Shopify: ${f.shopify_orders} pedidos reais | ${f.shopify_abandoned} abandonados (${f.shopify_orders + f.shopify_abandoned > 0 ? ((f.shopify_abandoned / (f.shopify_orders + f.shopify_abandoned)) * 100).toFixed(1) : 0}% abandono)`
    : `Cliques: ${f.link_clicks.toLocaleString()} | CPM: $${Number(f.cpm).toFixed(2)} | CPC: $${Number(f.cpc).toFixed(3)} | Shopify: ${f.shopify_orders} pedidos | ${f.shopify_abandoned} abandonados`

  const realCac = Number(metrics.orders) > 0
    ? (Number(metrics.spend) / Number(metrics.orders)).toFixed(2)
    : '0'

  // ── Expert knowledge encoded from top Meta Ads practitioners (2026) ────────
  // Sources: Andrew Foxwell (Foxwell Founders, $500M/mês), Barry Hott,
  // Sam Tomlinson (Andromeda #137), Taylor Holiday (CTC), Jon Loomer, Depesh Mandalia
  const expertContext = `=== META ADS 2026 — ANDROMEDA + ELITE FRAMEWORKS ===
ALGORITMO ANDROMEDA (out.2025): O CRIATIVO determina o PÚBLICO — não o targeting. 30 variações do mesmo conceito = 1 ad para o algoritmo (Sam Tomlinson). Broad targeting bate interesse em 2026 (Jon Loomer). ASC+ = 70-80% do budget. Consolidação: 1 campanha a $500/dia > 5 a $100/dia. Learning phase = 50 conv em 7 dias (CPAs 2-3x altos são normais nessa fase).
ESCALA: +20% budget a cada 48-72h máx. Nunca edite budget, creative ou targeting durante learning phase.

BENCHMARKS ECOMMERCE META 2026 (WebFX, Triple Whale, 27five, Sovran, AdStellar):
Hook Rate (plays/impressões): <20%=CRÍTICO | 20-25%=RUIM | 25-30%=FRACO | 30-40%=BOM | >40%=EXCELENTE
Hold Rate P25 (viewers que continuam): <40%=FRACO | 40-50%=MÉDIO | >50%=FORTE
CTR (link clicks): <1%=CRÍTICO | 1-1.5%=FRACO | 1.5-2%=MÉDIO | >2%=BOM | >3%=EXCELENTE
Frequência (prospecção): <2.5=SAUDÁVEL | 2.5-3.5=ATENÇÃO | >3.5=FADIGA | >4=CRÍTICO
CPM: <$12=ÓTIMO | $12-17=MÉDIO | >$20=ALTO | >$25=PICO SAZONAL
ROAS vs break-even: <0.8x=ELIMINAR | 0.8-1x=REVISAR | 1-1.3x=MONITORAR | 1.5x+=CANDIDATO A ESCALAR

FRAMEWORK DE DECISÃO (aplicar a todos os dados):
⏹ KILL: ROAS < break-even E spend >$50 E 10+ dias ativos | OU frequência >4 com CTR caindo
↑ SCALE: ROAS 20%+ acima meta por 3 dias consecutivos → +20% budget (regra 48-72h)
⚠ REFRESH criativo: frequência >3.5 | OU hook rate <25% por 3 dias | OU CTR caiu 20%+ em 2 semanas
🔍 LP ISSUE: CTR >2% + ROAS fraco = problema de landing page, NÃO de criativo
🎯 DIAGNÓSTICO VÍDEO: Hook<25%=abertura/thumbnail ruim | P25<40%=conteúdo cai após hook | P100>30%=muito engajador, teste versão mais longa
📊 CREATIVE FATIGUE: ads com 3+ semanas sem refresh costumam ter CPM 29% mais alto e CTR 35% menor (Meta benchmarks)
💰 CAC REAL = gasto FB ÷ pedidos Shopify (não usar CPP do funil FB como CPA real)

REGRAS DE PLACEMENT (CRÍTICO):
- mobile_web e desktop_web têm ROAS estruturalmente menor que mobile_app — isso é COMPLETAMENTE NORMAL. O público está navegando, não comprando. Nunca reporte isso como problema.
- Só considere um placement problemático se: spend >$50 E purchases = 0 (zero absoluto) naquele placement.
- messenger_inbox, audience_network também são naturalmente menores — ignore se não há spend relevante.

REGRAS DE AÇÃO ESPECÍFICA (CRÍTICO — sempre que recomendar pausar/excluir):
- País numa campanha BROAD/ASC+: "Não é possível excluir país individualmente em ASC+. Para reduzir [PAÍS], crie uma campanha separada excluindo [PAÍS] e reduza o orçamento da campanha atual em X%."
- País numa campanha de interesse/manual: "Em Ads Manager → [campanha] → [ad set] → editar → Locations → mude de 'Include' para 'Exclude' para [PAÍS]."
- Placement num ad set: "Em Ads Manager → [campanha] → [ad set] → editar → Placements → troque para Manual Placements e desmarque [PLACEMENT]."
- Nunca diga apenas "desative" ou "pause o país" sem especificar o mecanismo exato.
- Se a CAMPANHA no geral é lucrativa mas um país/placement específico tem ROAS baixo, o insight deve dizer se deve excluir o segmento ou apenas monitorar — nunca sugira pausar a campanha inteira por causa de um segmento ruim dentro dela.`

  // Language-specific labels (data section)
  const promptLang = {
    pt: {
      intro: `Você é um analista-chefe de Meta Ads de elite. Ticket médio real ~$${Number(metrics.aov).toFixed(0)}, margem ${profit.configured ? profit.margin.toFixed(1)+'%' : 'não configurada'}, break-even ROAS ${beRoas.toFixed(2)}x.`,
      dataHeader: `DADOS DA CONTA — ${dateFrom} a ${dateTo} (${days} dias):`,
      revenueLabel: 'Receita Shopify', ordersLabel: 'Pedidos reais', ticketLabel: 'AOV',
      spendLabel: 'Gasto FB', roasLabel: 'ROAS Real (receita Shopify ÷ gasto FB)',
      newLabel: 'Novos clientes', returningLabel: 'Recorrentes',
      profitHeader: 'LUCRATIVIDADE:', funnelHeader: 'FUNIL FB (mesmo período):',
      countrySpendHeader: 'GASTO FB POR PAÍS:', countriesHeader: 'TOP PAÍSES (Shopify):',
      creativesHeader: 'TOP CRIATIVOS + DIAGNÓSTICO (⏹KILL ↑SCALE ⚠REFRESH ✓OK):', recentHeader: 'ÚLTIMOS 7 DIAS:', noData: 'Sem dados',
      breakdownHeader: 'BREAKDOWNS FB (últimos 14 dias — device/placement/idade-gênero):',
      ltvHeader: 'LTV / RETENÇÃO DE CLIENTES:',
      rules: `REGRAS INVIOLÁVEIS:
1. NUNCA conclua "ROAS baixo" ou "margem baixa" sem identificar a causa raiz específica nos dados.
2. SEMPRE cite o número exato fora do benchmark e o benchmark de referência (ex: "Hook 14% vs benchmark mínimo 25%").
3. NUNCA sugira "otimize anúncios" — especifique QUAL criativo, placement ou segmento com qual ação.
4. Diferença FB purchases vs Shopify orders = NORMAL (atribuição multi-touch). Nunca trate como bug.
5. ROAS FB sempre maior que ROAS Real — esperado. Use ROAS Real para todas as decisões de budget.
6. CAC Real = gasto FB ÷ pedidos Shopify. Nunca use CPP do funil como CPA real.
7. Lucro Líquido e Lucro/Pedido JÁ incluem gasto FB. Nunca compare CPP/CAC contra lucro como custo separado.
8. Dados reais de vendas/carrinhos = sempre Shopify. Funil FB = apenas CTR/CPM/CPC e comparação de atribuição.
9. SEMPRE aplique os benchmarks do framework Andromeda 2026: hook<25%=CRÍTICO, freq>3.5=FADIGA, etc.
10. Para criativos com sinais ⏹ e ↑ nos dados: mencione o nome exato do ad e o número que justifica.
11. Responda sempre em português brasileiro, direto, com os números reais dos dados.`,
      formatNote: `FORMATO DE RESPOSTA — INSIGHTS (retorne APENAS o array JSON, sem texto antes ou depois):
[{"type":"kill"|"scale"|"creative"|"warning"|"opportunity"|"tip","title":"máx 5 palavras","detail":"nome EXATO do criativo/segmento + métrica real VS benchmark + causa raiz (2 frases)","action":"verbo + nome exato + número + prazo"}]

TIPOS DE INSIGHT:
"kill" = budget sendo desperdiçado agora (ROAS < break-even com spend relevante e 10+ dias)
"scale" = winner comprovado pronto para escalar (ROAS 20%+ acima da meta, 3+ dias)
"creative" = sinal de fadiga (freq>3.5), hook fraco (<25%), ou funil de vídeo problemático
"warning" = tendência negativa real com número exato (CPM subindo, CTR caindo, etc.)
"opportunity" = alto ROAS subinvestido (país, placement, segmento) ou LP opportunity
"tip" = estrutura de campanha, consolidação ASC+, ou teste estratégico com ação específica

GERE EXATAMENTE 8 INSIGHTS nesta ordem de prioridade:
1. kill — maior desperdício de budget ativo (nome do ad, ROAS vs break-even, spend total)
2. scale — melhor performer pronto para escalar (nome do ad, ROAS, dias acima da meta)
3. creative — sinal de fadiga mais crítico (nome do ad, freq ou hook rate exatos)
4. creative — análise de funil de vídeo se dados disponíveis (hook→P25→P100 waterfall)
5. warning — breakdown problemático (device/placement/segmento com ROAS abaixo do break-even)
6. opportunity — país ou segmento com ROAS alto e budget subinvestido
7. opportunity — LTV/retenção: segmento mais valioso e oportunidade de recompra
8. tip — estrutura de campanha, consolidação, ou teste estratégico com ação específica

PROIBIDO: números inventados, "considere", "pode ser", "possível", insights sem nome específico de ad/segmento/país.
Para o CHAT, responda em português de forma natural e analítica, sem JSON.`,
    },
    en: {
      intro: `You are an elite Meta Ads chief analyst. Real AOV ~$${Number(metrics.aov).toFixed(0)}, margin ${profit.configured ? profit.margin.toFixed(1)+'%' : 'not configured'}, break-even ROAS ${beRoas.toFixed(2)}x.`,
      dataHeader: `ACCOUNT DATA — ${dateFrom} to ${dateTo} (${days} days):`,
      revenueLabel: 'Shopify Revenue', ordersLabel: 'Real orders', ticketLabel: 'AOV',
      spendLabel: 'FB Spend', roasLabel: 'Real ROAS (Shopify revenue ÷ FB spend)',
      newLabel: 'New customers', returningLabel: 'Returning',
      profitHeader: 'PROFITABILITY:', funnelHeader: 'FB FUNNEL (same period):',
      countrySpendHeader: 'FB SPEND BY COUNTRY:', countriesHeader: 'TOP COUNTRIES (Shopify):',
      creativesHeader: 'TOP CREATIVES + DIAGNOSIS (⏹KILL ↑SCALE ⚠REFRESH ✓OK):', recentHeader: 'LAST 7 DAYS:', noData: 'No data',
      breakdownHeader: 'FB BREAKDOWNS (last 14 days — device/placement/age-gender):',
      ltvHeader: 'CUSTOMER LTV / RETENTION:',
      rules: `INVIOLABLE RULES:
1. NEVER conclude "ROAS is low" without identifying the specific root cause in the data.
2. ALWAYS cite the exact number vs the benchmark (e.g., "Hook 14% vs minimum benchmark 25%").
3. NEVER suggest "optimize ads" — specify WHICH creative, placement, or segment and what action.
4. FB purchases vs Shopify orders difference = NORMAL (multi-touch attribution). Never treat as bug.
5. FB ROAS always higher than Real ROAS — expected. Use Real ROAS for all budget decisions.
6. Real CAC = FB spend ÷ Shopify orders. Never use funnel CPP as real CPA.
7. Net Profit and Profit/Order ALREADY include FB spend. Never compare CPP/CAC against profit as separate costs.
8. Real sales/cart data = always Shopify. FB funnel = only CTR/CPM/CPC and attribution comparison.
9. ALWAYS apply Andromeda 2026 benchmarks: hook<25%=CRITICAL, freq>3.5=FATIGUE, etc.
10. For creatives with ⏹ and ↑ signals: mention exact ad name and the justifying number.
11. Always respond in English, directly, with real numbers from data.`,
      formatNote: `RESPONSE FORMAT — INSIGHTS (return ONLY the JSON array, no text before or after):
[{"type":"kill"|"scale"|"creative"|"warning"|"opportunity"|"tip","title":"max 5 words","detail":"EXACT creative/segment name + real metric VS benchmark + root cause (2 sentences)","action":"verb + exact name + number + timeline"}]

TYPES: kill=budget burning now | scale=proven winner ready to scale | creative=fatigue/hook/video signal | warning=real negative trend | opportunity=underinvested high-ROAS | tip=structure/strategy

GENERATE EXACTLY 8 INSIGHTS in this priority order:
1. kill — largest active budget waste (ad name, ROAS vs break-even, total spend)
2. scale — best performer ready to scale (ad name, ROAS, days above target)
3. creative — most critical fatigue signal (ad name, exact freq or hook rate)
4. creative — video funnel analysis if data available (hook→P25→P100 waterfall)
5. warning — problematic breakdown (device/placement/segment with ROAS below break-even)
6. opportunity — country or segment with high ROAS and underinvested budget
7. opportunity — LTV/retention: most valuable segment and repurchase opportunity
8. tip — campaign structure, ASC+ consolidation, or strategic test with specific action

FORBIDDEN: invented numbers, "consider", "might", "possibly", insights without specific ad/segment/country name.
For CHAT, respond in English analytically and naturally, without JSON.`,
    },
    es: {
      intro: `Eres un analista jefe de Meta Ads de élite. AOV real ~$${Number(metrics.aov).toFixed(0)}, margen ${profit.configured ? profit.margin.toFixed(1)+'%' : 'no configurado'}, break-even ROAS ${beRoas.toFixed(2)}x.`,
      dataHeader: `DATOS DE LA CUENTA — ${dateFrom} a ${dateTo} (${days} días):`,
      revenueLabel: 'Ingresos Shopify', ordersLabel: 'Pedidos reales', ticketLabel: 'AOV',
      spendLabel: 'Gasto FB', roasLabel: 'ROAS Real (Shopify ÷ gasto FB)',
      newLabel: 'Nuevos clientes', returningLabel: 'Recurrentes',
      profitHeader: 'RENTABILIDAD:', funnelHeader: 'EMBUDO FB (mismo período):',
      countrySpendHeader: 'GASTO FB POR PAÍS:', countriesHeader: 'PRINCIPALES PAÍSES (Shopify):',
      creativesHeader: 'PRINCIPALES CREATIVOS + DIAGNÓSTICO (⏹KILL ↑SCALE ⚠REFRESH ✓OK):', recentHeader: 'ÚLTIMOS 7 DÍAS:', noData: 'Sin datos',
      breakdownHeader: 'BREAKDOWNS FB (últimos 14 días — device/placement/edad-género):',
      ltvHeader: 'LTV / RETENCIÓN DE CLIENTES:',
      rules: `REGLAS INVIOLABLES:
1. NUNCA concluyas "ROAS bajo" sin identificar la causa raíz específica en los datos.
2. SIEMPRE cita el número exacto fuera de benchmark y el benchmark de referencia.
3. NUNCA sugieras "optimiza anuncios" — especifica QUÉ creativo, placement o segmento y qué acción.
4. Diferencia FB compras vs pedidos Shopify = NORMAL (atribución multi-touch). Nunca tratar como bug.
5. ROAS FB siempre mayor que ROAS Real — esperado. Usa ROAS Real para todas las decisiones.
6. CAC Real = gasto FB ÷ pedidos Shopify. Nunca uses CPP del embudo como CPA real.
7. Beneficio Neto y Beneficio/Pedido YA incluyen gasto FB. Nunca compares CPP/CAC contra beneficio.
8. Datos reales = siempre Shopify. Embudo FB = solo CTR/CPM/CPC y comparación de atribución.
9. SIEMPRE aplica benchmarks Andromeda 2026: hook<25%=CRÍTICO, freq>3.5=FATIGA, etc.
10. Para creativos con señales ⏹ y ↑: menciona el nombre exacto del ad y el número que lo justifica.
11. Responde siempre en español, directo, con los números reales de los datos.`,
      formatNote: `FORMATO DE RESPUESTA — INSIGHTS (devuelve SOLO el array JSON, sin texto antes ni después):
[{"type":"kill"|"scale"|"creative"|"warning"|"opportunity"|"tip","title":"máx 5 palabras","detail":"nombre EXACTO del creativo/segmento + métrica real VS benchmark + causa raíz (2 frases)","action":"verbo + nombre exacto + número + plazo"}]

TIPOS: kill=budget quemándose ahora | scale=winner listo para escalar | creative=fatiga/hook/video | warning=tendencia negativa real | opportunity=alto ROAS subinvertido | tip=estructura/estrategia

GENERA EXACTAMENTE 8 INSIGHTS en este orden de prioridad:
1. kill — mayor desperdicio de budget activo (nombre del ad, ROAS vs break-even, spend total)
2. scale — mejor performer listo para escalar (nombre del ad, ROAS, días sobre la meta)
3. creative — señal de fatiga más crítica (nombre del ad, freq o hook rate exactos)
4. creative — análisis de embudo de video si hay datos (hook→P25→P100 waterfall)
5. warning — breakdown problemático (device/placement/segmento con ROAS bajo el break-even)
6. opportunity — país o segmento con alto ROAS y budget subinvertido
7. opportunity — LTV/retención: segmento más valioso y oportunidad de recompra
8. tip — estructura de campaña, consolidación ASC+, o prueba estratégica con acción específica

PROHIBIDO: números inventados, "considera", "podría", "posiblemente", insights sin nombre específico de ad/segmento/país.
Para el CHAT, responde en español de forma natural y analítica, sin JSON.`,
    },
  }[lang] ?? (() => { throw new Error('unreachable') })()

  const systemPrompt = `${expertContext}

${promptLang.intro}

${promptLang.dataHeader}
${promptLang.revenueLabel}: $${Number(metrics.revenue).toLocaleString('en-US', {minimumFractionDigits: 2})} | ${promptLang.ordersLabel}: ${metrics.orders} | ${promptLang.ticketLabel}: $${Number(metrics.aov).toFixed(2)}
${promptLang.spendLabel}: $${Number(metrics.spend).toLocaleString('en-US', {minimumFractionDigits: 2})} | ${promptLang.roasLabel}: ${Number(metrics.blended_roas).toFixed(2)}x | CAC Real: $${realCac}
${promptLang.newLabel}: ${metrics.new_customers} | ${promptLang.returningLabel}: ${metrics.returning_customers}
Carrinho abandonado: $${safeAbandonedValue.toFixed(2)} (${abandonRate}% taxa)

${promptLang.profitHeader}
${profitLine}

${promptLang.funnelHeader}
${funnelText}

${promptLang.countrySpendHeader}
${countrySpendText}

${promptLang.countriesHeader}
${countriesText || promptLang.noData}

${promptLang.creativesHeader}
${creativesVideoText || promptLang.noData}

${promptLang.breakdownHeader}
${bdText}

${promptLang.ltvHeader}
${ltvPromptText}

${promptLang.recentHeader}
${recentRevenue}
${recentRoas}

${promptLang.rules}

${promptLang.formatNote}`

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>

      <Sidebar active="/" />

      {/* Main */}
      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
              {tr.dashboard_title}
            </h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 3 }}>
              {dateFrom} → {dateTo} · {days} {tr.days} · {tr.last_sync}: {lastSync}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <PartnerSplitToggle isSplit={isSplit} />
            <AutoSync lastSyncIso={lastSyncIso} />
            <RefreshButton />
            <Suspense>
              <TimeframeSelector from={dateFrom} to={dateTo} />
            </Suspense>
            <StoreSwitcher stores={stores} activeStoreId={tid} />
          </div>
        </div>

        <DashboardLayout
          metrics={metrics}
          revenue={revenue}
          roas={roas}
          creatives={creatives}
          countries={countries}
          customers={customers}
          profit={profit}
          funnel={funnel}
          countrySpend={countrySpend}
          countryProfit={countryProfit}
          dailyProfit={dailyProfit}
          bdDevice={bdDevice}
          bdPlacement={bdPlacement}
          bdAgeGender={bdAgeGender}
          ltvData={ltvData}
          systemPrompt={systemPrompt}
          cacheKey={`${tid}:${dateFrom}:${dateTo}`}
          dateFrom={dateFrom}
          dateTo={dateTo}
          days={days}
          tid={tid}
          tr={tr as Record<string, string>}
          abandonRate={abandonRate}
          safeAbandonedValue={safeAbandonedValue}
          beRoas={beRoas}
        />
      </main>
    </div>
  )
}
