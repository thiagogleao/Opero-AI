import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getTenant } from '@/lib/tenant'
import {
  getOverviewMetrics, getDailyRevenue, getDailyRoas,
  getTopCreatives, getCountryMetrics, getCustomerSplit, getLastSyncTime,
  getFunnelMetrics, getCountrySpend,
} from '@/lib/queries'
import { getProfitSummary, getCountryProfit } from '@/lib/profitCalc'
import RevenueChart from '@/components/RevenueChart'
import RoasChart from '@/components/RoasChart'
import CountryChart from '@/components/CountryChart'
import CustomerChart from '@/components/CustomerChart'
import CreativesTable from '@/components/CreativesTable'
import MetricCard from '@/components/MetricCard'
import TimeframeSelector from '@/components/TimeframeSelector'
import RefreshButton from '@/components/RefreshButton'
import AiPanel from '@/components/AiPanel'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'
import { getTranslations } from '@/lib/translations'
import type { Language } from '@/contexts/SettingsContext'

export const revalidate = 0

function fmt(n: number, prefix = '$') {
  return `${prefix}${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>
}

export default async function Dashboard({ searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const tenant = await getTenant(userId)
  if (!tenant?.onboarded) redirect('/onboarding')

  const tenantId = userId

  const sp = await searchParams
  const cookieStore = await cookies()
  const lang = (cookieStore.get('opero_lang')?.value ?? 'pt') as Language
  const tr = getTranslations(lang)

  // Resolve date range: support legacy ?days=N as fallback
  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)
  const todayISO = toISO(todayDate)

  let dateFrom: string
  let dateTo: string

  if (sp.from && sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) {
    dateFrom = sp.from
    dateTo   = sp.to
  } else {
    // Legacy ?days= or default 30 days
    const days = Math.min(Math.max(Number(sp.days) || 30, 1), 730)
    const fromDate = new Date(todayDate)
    fromDate.setDate(fromDate.getDate() - (days - 1))
    dateFrom = toISO(fromDate)
    dateTo   = todayISO
  }

  // Days count for display and AI prompt
  const fromMs = new Date(dateFrom).getTime()
  const toMs   = new Date(dateTo).getTime()
  const days   = Math.round((toMs - fromMs) / 86400000) + 1

  const [metrics, revenue, roas, creatives, countries, customers, syncs, profit, funnel, countrySpend, countryProfit] = await Promise.all([
    getOverviewMetrics(tenantId, dateFrom, dateTo),
    getDailyRevenue(tenantId, dateFrom, dateTo),
    getDailyRoas(tenantId, dateFrom, dateTo),
    getTopCreatives(tenantId, dateFrom, dateTo),
    getCountryMetrics(tenantId, dateFrom, dateTo),
    getCustomerSplit(tenantId, dateFrom, dateTo),
    getLastSyncTime(tenantId),
    getProfitSummary(tenantId, dateFrom, dateTo),
    getFunnelMetrics(tenantId, dateFrom, dateTo),
    getCountrySpend(tenantId, dateFrom, dateTo),
    getCountryProfit(tenantId, dateFrom, dateTo),
  ])

  const lastSync = syncs[0]?.finished_at
    ? new Date(syncs[0].finished_at).toLocaleString('pt-BR')
    : 'Nunca'

  const totalTried = Number(metrics.orders) + Number(metrics.abandoned_count)
  const abandonRate = totalTried > 0
    ? ((Number(metrics.abandoned_count) / totalTried) * 100).toFixed(1)
    : '0'

  const abandonedValue = Number(metrics.abandoned_value)
  const revenue30 = Number(metrics.revenue)
  const safeAbandonedValue = abandonedValue > revenue30 * 10 ? 0 : abandonedValue


  const beRoas = profit.configured ? profit.breakEvenRoas : 1.5
  const creativesText = creatives.slice(0, 10).map((c, i) => {
    const spend = Number(c.spend), roas = Number(c.roas), score = Number(c.score)
    let verdict = ''
    if (spend >= 15) {
      if (score < 0 || roas < 1)                              verdict = ' ⏹DESLIGAR'
      else if (roas < beRoas && spend >= 30)                   verdict = ' ⚠REVISAR'
      else if (score > 0 && roas >= beRoas * 1.5 && spend >= 30) verdict = ' ↑ESCALAR'
    } else if (spend < 15) {
      verdict = ' (dados insuficientes)'
    }
    return `  ${i + 1}. ${c.name}${verdict} | Gasto: $${spend.toFixed(2)} | Receita: $${Number(c.revenue).toFixed(2)} | ROAS: ${roas.toFixed(2)}x | Score: ${score.toFixed(0)} | CTR: ${Number(c.ctr).toFixed(2)}% | Compras: ${c.purchases}`
  }).join('\n')

  const countriesText = countries.slice(0, 8).map((c, i) =>
    `  ${i + 1}. ${c.country_code} | Receita: $${Number(c.revenue).toFixed(2)} | Pedidos: ${c.orders}`
  ).join('\n')

  const recentRevenue = revenue.slice(-7).map(r =>
    `  ${r.date}: receita $${Number(r.revenue).toFixed(2)}, gasto $${Number(r.spend).toFixed(2)}`
  ).join('\n')

  const recentRoas = roas.slice(-7).map(r =>
    `  ${r.date}: ROAS FB ${Number(r.fb_roas).toFixed(2)}x, ROAS Real ${Number(r.blended_roas).toFixed(2)}x`
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

  const funnelText = funnelHasData
    ? `Impressões: ${f.impressions.toLocaleString()} | CTR: ${impToClick}% | CPM: $${Number(f.cpm).toFixed(2)} | CPC: $${Number(f.cpc).toFixed(3)}
Cliques: ${f.link_clicks.toLocaleString()} → Carrinho: ${f.add_to_cart.toLocaleString()} (${clickToCart}% dos cliques | custo/ATC: $${Number(f.cost_per_atc).toFixed(2)}) → Checkout: ${f.initiate_checkout.toLocaleString()} (${cartToCheck}% do carrinho | custo/checkout: $${Number(f.cost_per_checkout).toFixed(2)}) → Compras FB atribuídas: ${f.purchases.toLocaleString()} (${checkToBuy}% do checkout)
Taxa clique→compra FB: ${clickToBuy}% | Shopify: ${f.shopify_orders} pedidos reais | ${f.shopify_abandoned} abandonados (${f.shopify_orders + f.shopify_abandoned > 0 ? ((f.shopify_abandoned / (f.shopify_orders + f.shopify_abandoned)) * 100).toFixed(1) : 0}% abandono)`
    : `Cliques: ${f.link_clicks.toLocaleString()} | CPM: $${Number(f.cpm).toFixed(2)} | CPC: $${Number(f.cpc).toFixed(3)} | Shopify: ${f.shopify_orders} pedidos | ${f.shopify_abandoned} abandonados`

  const realCac = Number(metrics.orders) > 0
    ? (Number(metrics.spend) / Number(metrics.orders)).toFixed(2)
    : '0'

  // Language-specific prompt instructions
  const promptLang = {
    pt: {
      intro: `Você é o analista de e-commerce pessoal. Ticket médio real ~$${Number(metrics.aov).toFixed(0)}, margem ${profit.configured ? profit.margin.toFixed(1)+'%' : 'não configurada'}.`,
      dataHeader: `DADOS — ${dateFrom} a ${dateTo} (${days} dias):`,
      revenueLabel: 'Receita', ordersLabel: 'Pedidos Shopify reais', ticketLabel: 'Ticket médio',
      spendLabel: 'Gasto FB', roasLabel: 'ROAS Real',
      cacNote: '(= gasto FB ÷ pedidos Shopify — use ESTE para análises de custo de aquisição)',
      newLabel: 'Novos clientes', returningLabel: 'Recorrentes', abandonLabel: 'valor recuperável', abandonRate: 'taxa',
      profitHeader: 'LUCRATIVIDADE:', funnelHeader: 'FUNIL FB ADS (mesmo período):',
      countrySpendHeader: 'GASTO FB POR PAÍS:', countriesHeader: 'TOP PAÍSES (receita Shopify):',
      creativesHeader: 'TOP CRIATIVOS:', recentHeader: 'ÚLTIMOS 7 DIAS:', noData: 'Sem dados',
      rules: `REGRAS OBRIGATÓRIAS — violar qualquer uma invalida a resposta:
1. NUNCA diga apenas "ROAS está baixo" ou "margem está baixa" como conclusão — isso é sintoma, não causa. Sempre identifique a causa raiz específica nos dados.
2. Para cada problema: cite o número exato fora do padrão e o ideal.
3. Nunca sugira "otimize seus anúncios" sem especificar qual criativo, país, métrica.
4. A diferença FB purchases vs Shopify orders é NORMAL (atribuição multi-touch). Nunca trate como bug.
5. O ROAS do FB é sempre maior que o ROAS Real — esperado. Use ROAS Real para decisões.
6. CRÍTICO — Use sempre o CAC Real (gasto FB ÷ pedidos Shopify) para análise de aquisição. Nunca cite CPP do funil como CPA real.
7. CRÍTICO — Lucro/Pedido e Lucro Líquido JÁ INCLUEM gasto FB. Nunca compare CPP/CAC contra lucro como custos separados.
8. CRÍTICO — Números reais de vendas/carrinhos vêm SEMPRE da Shopify. Dados do funil FB são apenas para comparação de rastreamento ou métricas exclusivas do FB (CTR, CPM, CPC).
9. Responda sempre em português brasileiro direto, com números reais dos dados.`,
      formatNote: `FORMATO DE RESPOSTA (retorne APENAS o JSON, sem texto antes ou depois):
[{"type":"urgent"|"warning"|"opportunity"|"tip","title":"título curto (máx 5 palavras)","detail":"2 frases: problema com número exato + causa raiz nos dados","action":"1 frase com número e criativo/país específico"}]
Gere exatamente 6 insights: (1) budget desperdiçado, (2) gargalo de funil, (3) criativo pausar/escalar, (4) país ROAS alto subinvestido, (5) retenção, (6) oportunidade rápida. PROIBIDO: frases genéricas.
Para o CHAT, responda em português de forma natural, sem JSON.`,
    },
    en: {
      intro: `You are a personal e-commerce analyst. Real avg order value ~$${Number(metrics.aov).toFixed(0)}, margin ${profit.configured ? profit.margin.toFixed(1)+'%' : 'not configured'}.`,
      dataHeader: `DATA — ${dateFrom} to ${dateTo} (${days} days):`,
      revenueLabel: 'Revenue', ordersLabel: 'Real Shopify orders', ticketLabel: 'Avg order value',
      spendLabel: 'FB Spend', roasLabel: 'Real ROAS',
      cacNote: '(= FB spend ÷ Shopify orders — use THIS for acquisition cost analysis)',
      newLabel: 'New customers', returningLabel: 'Returning', abandonLabel: 'recoverable value', abandonRate: 'rate',
      profitHeader: 'PROFITABILITY:', funnelHeader: 'FB ADS FUNNEL (same period):',
      countrySpendHeader: 'FB SPEND BY COUNTRY:', countriesHeader: 'TOP COUNTRIES (Shopify revenue):',
      creativesHeader: 'TOP CREATIVES:', recentHeader: 'LAST 7 DAYS:', noData: 'No data',
      rules: `MANDATORY RULES — violating any one invalidates the response:
1. NEVER say just "ROAS is low" or "margin is low" as a conclusion — that's a symptom, not a cause. Always identify the specific root cause in the data.
2. For each problem: cite the exact number out of range and what it should be.
3. Never suggest "optimize your ads" without specifying which creative, country, metric.
4. The difference between FB purchases and Shopify orders is NORMAL (multi-touch attribution). Never treat as a bug.
5. FB ROAS is always higher than Real ROAS — expected. Use Real ROAS for decisions.
6. CRITICAL — Always use Real CAC (FB spend ÷ Shopify orders) for acquisition analysis. Never cite funnel CPP as the real CPA.
7. CRITICAL — Profit/Order and Net Profit ALREADY INCLUDE FB spend as a deducted cost. Never compare CPP/CAC against profit as separate costs.
8. CRITICAL — Real sales/cart numbers ALWAYS come from Shopify. FB funnel data is only for tracking comparison or FB-exclusive metrics (CTR, CPM, CPC).
9. Always respond in English, directly, with real numbers from the data.`,
      formatNote: `RESPONSE FORMAT (return ONLY the JSON, no text before or after):
[{"type":"urgent"|"warning"|"opportunity"|"tip","title":"short title (max 5 words)","detail":"2 sentences: problem with exact number + specific root cause in data","action":"1 sentence with specific number and creative/country"}]
Generate exactly 6 insights prioritizing: (1) budget being wasted now, (2) funnel bottleneck with exact %, (3) creative to pause/scale, (4) high-ROAS underinvested country, (5) retention, (6) quick win. FORBIDDEN: generic phrases.
For CHAT, respond in English naturally, without JSON.`,
    },
    es: {
      intro: `Eres el analista de e-commerce personal. Ticket promedio real ~$${Number(metrics.aov).toFixed(0)}, margen ${profit.configured ? profit.margin.toFixed(1)+'%' : 'no configurado'}.`,
      dataHeader: `DATOS — ${dateFrom} a ${dateTo} (${days} días):`,
      revenueLabel: 'Ingresos', ordersLabel: 'Pedidos reales Shopify', ticketLabel: 'Ticket promedio',
      spendLabel: 'Gasto FB', roasLabel: 'ROAS Real',
      cacNote: '(= gasto FB ÷ pedidos Shopify — usa ESTE para análisis de costo de adquisición)',
      newLabel: 'Nuevos clientes', returningLabel: 'Recurrentes', abandonLabel: 'valor recuperable', abandonRate: 'tasa',
      profitHeader: 'RENTABILIDAD:', funnelHeader: 'EMBUDO FB ADS (mismo período):',
      countrySpendHeader: 'GASTO FB POR PAÍS:', countriesHeader: 'PRINCIPALES PAÍSES (ingresos Shopify):',
      creativesHeader: 'PRINCIPALES CREATIVOS:', recentHeader: 'ÚLTIMOS 7 DÍAS:', noData: 'Sin datos',
      rules: `REGLAS OBLIGATORIAS — violar cualquiera invalida la respuesta:
1. NUNCA digas solo "el ROAS está bajo" o "el margen está bajo" como conclusión — eso es síntoma, no causa. Siempre identifica la causa raíz específica en los datos.
2. Para cada problema: cita el número exacto fuera de rango y cuál debería ser.
3. Nunca sugieras "optimiza tus anuncios" sin especificar qué creativo, país, métrica.
4. La diferencia entre compras FB y pedidos Shopify es NORMAL (atribución multi-touch). Nunca tratar como bug.
5. El ROAS de FB siempre es mayor que el ROAS Real — esperado. Usa ROAS Real para decisiones.
6. CRÍTICO — Usa siempre el CAC Real (gasto FB ÷ pedidos Shopify) para análisis de adquisición. Nunca cites el CPP del embudo como CPA real.
7. CRÍTICO — Beneficio/Pedido y Beneficio Neto YA INCLUYEN el gasto FB como costo deducido. Nunca compares CPP/CAC contra beneficio como costos separados.
8. CRÍTICO — Los números reales de ventas/carritos SIEMPRE vienen de Shopify. Los datos del embudo FB son solo para comparación de seguimiento o métricas exclusivas de FB (CTR, CPM, CPC).
9. Responde siempre en español directo, con números reales de los datos.`,
      formatNote: `FORMATO DE RESPUESTA (devuelve SOLO el JSON, sin texto antes ni después):
[{"type":"urgent"|"warning"|"opportunity"|"tip","title":"título corto (máx 5 palabras)","detail":"2 frases: problema con número exacto + causa raíz específica en datos","action":"1 frase con número y creativo/país específico"}]
Genera exactamente 6 insights priorizando: (1) presupuesto desperdiciado ahora, (2) embudo con % exacto, (3) creativo pausar/escalar, (4) país ROAS alto con poco presupuesto, (5) retención, (6) oportunidad rápida. PROHIBIDO: frases genéricas.
Para el CHAT, responde en español de forma natural, sin JSON.`,
    },
  }[lang] ?? (() => { throw new Error('unreachable') })()

  const systemPrompt = `${promptLang.intro}

${promptLang.dataHeader}
${promptLang.revenueLabel}: $${Number(metrics.revenue).toLocaleString('en-US', {minimumFractionDigits: 2})} | ${promptLang.ordersLabel}: ${metrics.orders} | ${promptLang.ticketLabel}: $${Number(metrics.aov).toFixed(2)}
${promptLang.spendLabel}: $${Number(metrics.spend).toLocaleString('en-US', {minimumFractionDigits: 2})} | ${promptLang.roasLabel}: ${Number(metrics.blended_roas).toFixed(2)}x
Real CAC: $${realCac} ${promptLang.cacNote}
${promptLang.newLabel}: ${metrics.new_customers} | ${promptLang.returningLabel}: ${metrics.returning_customers}
Abandoned: $${safeAbandonedValue.toFixed(2)} ${promptLang.abandonLabel} (${abandonRate}% ${promptLang.abandonRate})

${promptLang.profitHeader}
${profitLine}

${promptLang.funnelHeader}
${funnelText}

${promptLang.countrySpendHeader}
${countrySpendText}

${promptLang.countriesHeader}
${countriesText || promptLang.noData}

${promptLang.creativesHeader}
${creativesText || promptLang.noData}

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
            <RefreshButton />
            <Suspense>
              <TimeframeSelector from={dateFrom} to={dateTo} />
            </Suspense>
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '6px 14px', fontSize: 12, color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
              {tenant.shopify_domain ?? 'Loja conectada'}
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12, marginBottom: 20,
        }}>
          <MetricCard
            title={tr.metric_revenue} value={fmt(Number(metrics.revenue))}
            sub={tr.metric_via_shopify} icon="💰"
            gradient="linear-gradient(135deg,#10B981,#059669)" delay={0}
          />
          <MetricCard
            title={tr.metric_orders} value={String(metrics.orders)}
            sub={`${tr.metric_avg_ticket} ${fmt(Number(metrics.aov))}`} icon="🛒"
            gradient="linear-gradient(135deg,#8B5CF6,#6D28D9)" delay={0.07}
          />
          <MetricCard
            title={tr.metric_roas_real} value={`${Number(metrics.blended_roas).toFixed(2)}x`}
            sub={tr.metric_revenue_shopify} icon="📈"
            gradient="linear-gradient(135deg,#38BDF8,#0284C7)" delay={0.14}
          />
          <MetricCard
            title={tr.metric_fb_spend} value={fmt(Number(metrics.spend))}
            sub={`${tr.metric_roas_fb}: ${Number(metrics.roas).toFixed(2)}x`} icon="📣"
            gradient="linear-gradient(135deg,#F59E0B,#D97706)" delay={0.21}
          />
          <MetricCard
            title={tr.metric_new_customers} value={String(metrics.new_customers)}
            sub={`${metrics.returning_customers} ${tr.metric_returning}`} icon="👥"
            gradient="linear-gradient(135deg,#A78BFA,#7C3AED)" delay={0.28}
          />
          <MetricCard
            title={tr.metric_abandoned} value={fmt(safeAbandonedValue)}
            sub={`${abandonRate}% ${tr.metric_abandon_rate}`} icon="⚠️"
            gradient="linear-gradient(135deg,#F43F5E,#BE123C)" delay={0.35}
          />
        </div>

        {/* Profit Banner */}
        {profit.configured ? (
          <div style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(139,92,246,0.08) 100%)',
            border: '1px solid rgba(16,185,129,0.25)',
            borderRadius: 12, padding: '16px 20px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 0,
          }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', paddingRight: 20 }}>
              <span style={{ fontSize: 20 }}>💵</span>
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>{tr.profit_net}</p>
                <p style={{ fontSize: 24, fontWeight: 700, color: profit.netProfit >= 0 ? '#10B981' : '#F43F5E', letterSpacing: '-0.5px' }}>
                  {fmt(profit.netProfit)}
                </p>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', paddingLeft: 20, paddingRight: 20 }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>{tr.profit_margin}</p>
                <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: profit.margin >= 20 ? '#10B981' : profit.margin >= 10 ? '#F59E0B' : '#F43F5E' }}>
                  {profit.margin.toFixed(1)}%
                </p>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', paddingLeft: 20, paddingRight: 20 }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>{tr.profit_per_order}</p>
                <p style={{ fontSize: 24, fontWeight: 700, color: profit.avgProfitPerOrder >= 0 ? '#A78BFA' : '#F43F5E', letterSpacing: '-0.5px' }}>
                  {fmt(profit.avgProfitPerOrder)}
                </p>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 20 }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>{tr.profit_breakeven}</p>
                <p style={{ fontSize: 24, fontWeight: 700, color: '#38BDF8', letterSpacing: '-0.5px' }}>
                  {profit.breakEvenRoas > 0 ? `${profit.breakEvenRoas.toFixed(2)}x` : '—'}
                </p>
              </div>
            </div>
            <Link href="/profit" style={{ textDecoration: 'none', marginLeft: 16, flexShrink: 0 }}>
              <div style={{
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 8, padding: '6px 12px', fontSize: 11, color: '#A78BFA',
                fontWeight: 600, whiteSpace: 'nowrap',
              }}>{tr.profit_details}</div>
            </Link>
          </div>
        ) : (
          <Link href="/profit" style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'rgba(245,158,11,0.06)', border: '1px dashed rgba(245,158,11,0.3)',
              borderRadius: 12, padding: '14px 20px', marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: 18 }}>⚙️</span>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>{tr.profit_setup_title}</p>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{tr.profit_setup_desc}</p>
              </div>
            </div>
          </Link>
        )}

        {/* Charts row 1 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <RevenueChart data={revenue} days={days} />
          <RoasChart data={roas} days={days} />
        </div>

        {/* Charts row 2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <CreativesTable data={creatives} days={days} breakEvenRoas={profit.configured ? profit.breakEvenRoas : 1.5} />
          <CountryChart data={countries} days={days} profitData={countryProfit} />
        </div>

        {/* Charts row 3 */}
        <div style={{ marginBottom: 24 }}>
          <CustomerChart data={customers} days={days} />
        </div>

        {/* AI Panel */}
        <AiPanel systemPrompt={systemPrompt} />

        {/* Notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 10, padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>{tr.note_roas_title}</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.6 }}>{tr.note_roas_body}</p>
            </div>
          </div>
          <div style={{
            background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 10, padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 18 }}>ℹ️</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#818CF8' }}>{tr.note_divergence_title}</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.6 }}>{tr.note_divergence_body}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
