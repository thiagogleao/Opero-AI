'use client'
import { motion } from 'framer-motion'

interface FunnelData {
  impressions: number
  link_clicks: number
  add_to_cart: number
  initiate_checkout: number
  purchases: number
  shopify_orders: number
  shopify_abandoned: number
  cpm: number | string
  cpc: number | string
  cost_per_atc: number | string
  cost_per_checkout: number | string
}

interface Props {
  data: FunnelData
  days: number
  fmt: (n: number) => string
}

export default function FunnelVisual({ data: f, days, fmt }: Props) {
  const cpm = Number(f.cpm)
  const cpc = Number(f.cpc)
  const costAtc = Number(f.cost_per_atc)
  const costCheckout = Number(f.cost_per_checkout)

  const steps = [
    { label: 'Impressões',        value: f.impressions,       color: '#8B5CF6', costLabel: `CPM ${fmt(cpm)}`,          costValue: cpm },
    { label: 'Cliques no Link',   value: f.link_clicks,       color: '#38BDF8', costLabel: `CPC ${fmt(cpc)}`,          costValue: cpc },
    { label: 'Adicionou ao Carrinho', value: f.add_to_cart,   color: '#10B981', costLabel: `Custo/ATC ${fmt(costAtc)}`, costValue: costAtc },
    { label: 'Iniciou Checkout',  value: f.initiate_checkout, color: '#F59E0B', costLabel: `Custo/Checkout ${fmt(costCheckout)}`, costValue: costCheckout },
    { label: 'Compras FB',        value: f.purchases,         color: '#A78BFA', costLabel: null,                       costValue: 0 },
    { label: 'Pedidos Shopify',   value: f.shopify_orders,    color: '#34D399', costLabel: null,                       costValue: 0 },
  ]

  const hasAnyData = steps.some(s => s.value > 0)
  if (!hasAnyData) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '40px 24px', marginBottom: 12, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}
      >
        Sem dados de funil no período selecionado
      </motion.div>
    )
  }

  const maxValue = steps.find(s => s.value > 0)?.value ?? 1

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}
    >
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Funil de Conversão</h3>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Últimos {days} dias · Dados FB atribuídos</p>
        </div>
        {/* Quick stats */}
        <div style={{ display: 'flex', gap: 20 }}>
          {[
            { label: 'CPM',  value: fmt(cpm),  show: cpm > 0 },
            { label: 'CTR',  value: `${f.link_clicks > 0 && f.impressions > 0 ? (f.link_clicks / f.impressions * 100).toFixed(2) : '0'}%`, show: f.impressions > 0 },
            { label: 'CPC',  value: fmt(cpc),  show: cpc > 0 },
          ].filter(s => s.show).map(s => (
            <div key={s.label} style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Funnel steps */}
      <div style={{ padding: '20px 24px' }}>
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1].value : null
          const convRate = prev !== null && prev > 0 && step.value > 0
            ? (step.value / prev * 100).toFixed(1)
            : null
          const barPct = maxValue > 0 ? Math.max(step.value / maxValue * 100, 2) : 2
          if (step.value === 0) return null

          return (
            <div key={step.label}>
              {/* Conversion rate connector */}
              {convRate !== null && (
                <div style={{ display: 'flex', alignItems: 'center', margin: '4px 0', paddingLeft: 8 }}>
                  <div style={{ width: 1, height: 12, background: 'var(--border)', marginRight: 8, marginLeft: 11 }} />
                  <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>
                    {convRate}% de conversão
                  </span>
                </div>
              )}

              {/* Step row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                {/* Colored dot */}
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: step.color, flexShrink: 0 }} />

                {/* Label */}
                <div style={{ width: 170, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{step.label}</div>

                {/* Bar */}
                <div style={{ flex: 1, background: 'var(--bg-hover)', borderRadius: 4, height: 28, overflow: 'hidden' }}>
                  <div style={{
                    width: `${barPct}%`,
                    background: step.color,
                    height: '100%',
                    borderRadius: 4,
                    opacity: 0.8,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 8,
                  }}>
                    {barPct > 15 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>
                        {step.value.toLocaleString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Value (if bar is too narrow) */}
                {barPct <= 15 && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', width: 70, textAlign: 'right', flexShrink: 0 }}>
                    {step.value.toLocaleString('pt-BR')}
                  </div>
                )}
                {barPct > 15 && (
                  <div style={{ width: 70, flexShrink: 0 }} />
                )}

                {/* Cost label */}
                {step.costLabel && step.costValue > 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', width: 140, textAlign: 'right', flexShrink: 0 }}>{step.costLabel}</div>
                ) : (
                  <div style={{ width: 140, flexShrink: 0 }} />
                )}
              </div>
            </div>
          )
        })}

        {/* Shopify abandoned note */}
        {f.shopify_abandoned > 0 && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(244,63,94,0.06)', borderRadius: 8, border: '1px solid rgba(244,63,94,0.15)', fontSize: 11, color: '#F87171' }}>
            {f.shopify_abandoned} carrinhos abandonados na Shopify ({
              f.shopify_orders + f.shopify_abandoned > 0
                ? ((f.shopify_abandoned / (f.shopify_orders + f.shopify_abandoned)) * 100).toFixed(1)
                : 0
            }% taxa de abandono)
          </div>
        )}
      </div>
    </motion.div>
  )
}
