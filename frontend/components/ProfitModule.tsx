'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import TimeframeSelector from './TimeframeSelector'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VolumeDiscount {
  min_units: number
  discount_type: 'pct' | 'abs'
  discount_value: number
}

interface ShippingRate { country_code: string; name: string; cost_usd: number }
interface ExtraCost    { name: string; amount_usd: number; frequency: 'monthly' | 'per_order' | 'annual' }
interface ProductCogs  { product_id: string; name: string; cost_usd: number }

interface ProfitConfig {
  shopify: { transaction_fee_pct: number; payment_processing_pct: number; payment_processing_fixed: number }
  cogs: { default_cost_usd: number; packaging_cost_usd: number; additional_unit_discount_usd: number; volume_discounts: VolumeDiscount[]; products: ProductCogs[] }
  shipping: { default_rate_usd: number; rates: ShippingRate[] }
  extra_costs: ExtraCost[]
}

interface DailyPoint { date: string; revenue: number; costs: number; profit: number }

interface ProfitResult {
  days: number; dateFrom: string; dateTo: string
  orderCount: number; totalRevenue: number
  totalShopifyFees: number; totalPaymentFees: number
  totalCogs: number; totalPackaging: number; totalShipping: number
  fbSpend: number; totalExtraCosts: number; totalAdditionalUnitSavings: number
  netProfit: number; margin: number
  avgRevenuePerOrder: number; avgProfitPerOrder: number; breakEvenRoas: number
  dailyData: DailyPoint[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const $fmt = (n: number) => `$${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct  = (n: number, decimals = 1) => `${n.toFixed(decimals)}%`

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const EMPTY_CONFIG: ProfitConfig = {
  shopify: { transaction_fee_pct: 0, payment_processing_pct: 0, payment_processing_fixed: 0 },
  cogs:    { default_cost_usd: 0, packaging_cost_usd: 0, additional_unit_discount_usd: 0, volume_discounts: [], products: [] },
  shipping:{ default_rate_usd: 0, rates: [] },
  extra_costs: [],
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid #1E2028', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', padding: '12px 16px', background: '#0F1115',
        border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        cursor: 'pointer', color: '#F4F4F5', fontSize: 13, fontWeight: 600,
      }}>
        {title}
        <span style={{ color: '#52525B', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '14px 16px', background: '#111318' }}>{children}</div>}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: '#71717A', fontWeight: 500, marginBottom: 4 }}>
        {label} {hint && <span style={{ color: '#3F3F46' }}>— {hint}</span>}
      </label>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, prefix, suffix, step = 0.01, width = 90 }: {
  value: number; onChange: (v: number) => void
  prefix?: string; suffix?: string; step?: number; width?: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {prefix && <span style={{ color: '#71717A', fontSize: 12 }}>{prefix}</span>}
      <input
        type="number" value={value} step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{
          background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6,
          padding: '6px 10px', color: '#E4E4E7', fontSize: 13, width, outline: 'none',
        }}
      />
      {suffix && <span style={{ color: '#71717A', fontSize: 12 }}>{suffix}</span>}
    </div>
  )
}

// ─── Waterfall Bar ──────────────────────────────────────────────────────────────

function WaterfallBar({ label, value, total, color, pctOfRevenue }: {
  label: string; value: number; total: number; color: string; pctOfRevenue: number
}) {
  const width = total > 0 ? Math.max((Math.abs(value) / total) * 100, 0.5) : 0
  const isProfit = label === 'Lucro Líquido'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 90px 60px', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: '#A1A1AA', textAlign: 'right' }}>{label}</span>
      <div style={{ background: '#0B0D0F', borderRadius: 4, height: 20, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ height: '100%', background: color, borderRadius: 4 }}
        />
      </div>
      <span style={{ fontSize: 12, color: isProfit ? color : '#D4D4D8', fontWeight: isProfit ? 700 : 400, textAlign: 'right' }}>
        {value >= 0 ? $fmt(value) : `-${$fmt(Math.abs(value))}`}
      </span>
      <span style={{ fontSize: 11, color: '#52525B', textAlign: 'right' }}>
        {pct(Math.abs(pctOfRevenue))}
      </span>
    </div>
  )
}

// ─── Chart Tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#111318', border: '1px solid #2A2D38', borderRadius: 8,
      padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ color: '#71717A', marginBottom: 6 }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600, marginBottom: 2 }}>
          {p.name}: {$fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

// ─── Inner component ───────────────────────────────────────────────────────────

function ProfitModuleInner() {
  const searchParams = useSearchParams()

  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)
  const todayISO  = toISO(todayDate)
  const thirtyAgo = new Date(todayDate)
  thirtyAgo.setDate(thirtyAgo.getDate() - 29)

  const fromParam = searchParams.get('from')
  const toParam   = searchParams.get('to')
  const dateFrom  = (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) ? fromParam : toISO(thirtyAgo)
  const dateTo    = (toParam   && /^\d{4}-\d{2}-\d{2}$/.test(toParam))   ? toParam   : todayISO

  const [config, setConfig]           = useState<ProfitConfig>(EMPTY_CONFIG)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [result, setResult]           = useState<ProfitResult | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [shopifyProducts, setShopifyProducts] = useState<{ product_id: string; title: string; image_url: string | null; price_min: number }[]>([])

  const calculate = useCallback(async (cfg: ProfitConfig, from: string, to: string) => {
    setCalculating(true)
    const res = await fetch('/api/profit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'calculate', config: cfg, dateFrom: from, dateTo: to }),
    })
    const data = await res.json()
    setResult(data)
    setCalculating(false)
  }, [])

  // Load config + products once — then immediately calculate
  useEffect(() => {
    Promise.all([
      fetch('/api/profit').then(r => r.json()),
      fetch('/api/products').then(r => r.json()),
    ]).then(([profitData, products]) => {
      const cfg = (profitData.config && Object.keys(profitData.config).length > 0)
        ? profitData.config
        : EMPTY_CONFIG

      // Merge product list into config.cogs.products — keep existing costs, add new products
      if (Array.isArray(products) && products.length > 0) {
        type ProductCost = { product_id: string; name: string; cost_usd: number }
        const existingById = new Map<string, ProductCost>((cfg.cogs.products ?? []).map((p: ProductCost) => [p.product_id, p]))
        cfg.cogs.products = products.map((p: { product_id: string; title: string }) => ({
          product_id: p.product_id,
          name: p.title,
          cost_usd: existingById.get(p.product_id)?.cost_usd ?? 0,
        }))
        setShopifyProducts(products)
      }

      setConfig(cfg)
      setConfigLoaded(true)
      calculate(cfg, dateFrom, dateTo)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  async function saveAndCalculate() {
    setSaving(true)
    await fetch('/api/profit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', config }),
    })
    await calculate(config, dateFrom, dateTo)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const upd = (path: string, value: unknown) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      const keys = path.split('.')
      let obj: Record<string, unknown> = next
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]] as Record<string, unknown>
      obj[keys[keys.length - 1]] = value
      return next
    })
  }

  const addShippingRate = () =>
    setConfig(p => ({ ...p, shipping: { ...p.shipping, rates: [...p.shipping.rates, { country_code: '', name: '', cost_usd: 0 }] } }))
  const removeShippingRate = (i: number) =>
    setConfig(p => ({ ...p, shipping: { ...p.shipping, rates: p.shipping.rates.filter((_, j) => j !== i) } }))

  const addVolumeDiscount = () =>
    setConfig(p => ({ ...p, cogs: { ...p.cogs, volume_discounts: [
      ...p.cogs.volume_discounts,
      { min_units: 2, discount_type: 'pct' as const, discount_value: 0 },
    ]} }))
  const removeVolumeDiscount = (i: number) =>
    setConfig(p => ({ ...p, cogs: { ...p.cogs, volume_discounts: p.cogs.volume_discounts.filter((_, j) => j !== i) } }))

  const addExtra = () =>
    setConfig(p => ({ ...p, extra_costs: [...p.extra_costs, { name: '', amount_usd: 0, frequency: 'monthly' as const }] }))
  const removeExtra = (i: number) =>
    setConfig(p => ({ ...p, extra_costs: p.extra_costs.filter((_, j) => j !== i) }))

  const total = result?.totalRevenue ?? 1

  return (
    <div>
      {/* Header with TimeframeSelector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <p style={{ color: '#52525B', fontSize: 13 }}>
          {dateFrom} → {dateTo}
          {result && ` · ${result.orderCount} pedidos`}
        </p>
        <TimeframeSelector from={dateFrom} to={dateTo} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16, alignItems: 'start' }}>

        {/* ── Settings Panel ── */}
        <div>
          <Section title="💳 Shopify & Pagamento">
            <Field label="Taxa de transação Shopify" hint="% em gateways de terceiros">
              <NumInput value={config.shopify.transaction_fee_pct} onChange={v => upd('shopify.transaction_fee_pct', v)} suffix="%" />
            </Field>
            <Field label="Taxa de processamento de pagamento" hint="% por transação">
              <NumInput value={config.shopify.payment_processing_pct} onChange={v => upd('shopify.payment_processing_pct', v)} suffix="%" />
            </Field>
            <Field label="Taxa fixa por transação" hint="USD fixo por pedido">
              <NumInput value={config.shopify.payment_processing_fixed} onChange={v => upd('shopify.payment_processing_fixed', v)} prefix="$" />
            </Field>
          </Section>

          <Section title="📦 COGS — Custo do Produto">
            <Field label="Custo padrão por unidade">
              <NumInput value={config.cogs.default_cost_usd} onChange={v => upd('cogs.default_cost_usd', v)} prefix="$" />
            </Field>
            <Field label="Custo de embalagem por pedido">
              <NumInput value={config.cogs.packaging_cost_usd} onChange={v => upd('cogs.packaging_cost_usd', v)} prefix="$" />
            </Field>

            <Field
              label="Desconto por unidade adicional"
              hint="redução total (produto+embalagem+frete) para cada unidade além da 1ª no mesmo pedido"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <NumInput
                  value={config.cogs.additional_unit_discount_usd ?? 0}
                  onChange={v => upd('cogs.additional_unit_discount_usd', v)}
                  prefix="−$"
                />
                {(config.cogs.additional_unit_discount_usd ?? 0) > 0 && (
                  <p style={{ fontSize: 11, color: '#52525B' }}>
                    Ex: pedido de 2 itens →
                    <span style={{ color: '#A1A1AA' }}> 1ª unidade</span> custo normal,
                    <span style={{ color: '#10B981' }}> 2ª unidade</span> −${(config.cogs.additional_unit_discount_usd).toFixed(2)} mais barata
                  </p>
                )}
              </div>
            </Field>

            {/* Volume discounts */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#71717A', fontWeight: 500 }}>
                Desconto de volume <span style={{ color: '#3F3F46' }}>— reduz custo por unidade em pedidos múltiplos</span>
              </label>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 1fr 24px', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#52525B' }}>Mín. unid.</span>
                  <span style={{ fontSize: 10, color: '#52525B' }}>Tipo</span>
                  <span style={{ fontSize: 10, color: '#52525B' }}>Desconto</span>
                  <span />
                </div>
                {config.cogs.volume_discounts.map((vd, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 80px 1fr 24px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    {/* Min units */}
                    <input type="number" value={vd.min_units} min={1}
                      onChange={e => {
                        const n = [...config.cogs.volume_discounts]
                        n[i] = { ...n[i], min_units: parseInt(e.target.value) || 1 }
                        upd('cogs.volume_discounts', n)
                      }}
                      style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none' }}
                    />
                    {/* Type toggle */}
                    <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #2A2D38' }}>
                      {(['pct', 'abs'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => {
                            const n = [...config.cogs.volume_discounts]
                            n[i] = { ...n[i], discount_type: t }
                            upd('cogs.volume_discounts', n)
                          }}
                          style={{
                            flex: 1, border: 'none', padding: '5px 0', fontSize: 11, fontWeight: 600,
                            cursor: 'pointer',
                            background: vd.discount_type === t ? 'rgba(139,92,246,0.25)' : '#0B0D0F',
                            color: vd.discount_type === t ? '#A78BFA' : '#52525B',
                          }}
                        >{t === 'pct' ? '%' : '$'}</button>
                      ))}
                    </div>
                    {/* Value */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11, color: '#52525B' }}>
                        {vd.discount_type === 'pct' ? '−' : '−$'}
                      </span>
                      <input type="number" value={vd.discount_value} min={0} step="0.01"
                        onChange={e => {
                          const n = [...config.cogs.volume_discounts]
                          n[i] = { ...n[i], discount_value: parseFloat(e.target.value) || 0 }
                          upd('cogs.volume_discounts', n)
                        }}
                        style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none', flex: 1 }}
                      />
                      <span style={{ fontSize: 11, color: '#52525B', minWidth: 16 }}>
                        {vd.discount_type === 'pct' ? '%' : ''}
                      </span>
                    </div>
                    <button onClick={() => removeVolumeDiscount(i)}
                      style={{ background: 'none', border: 'none', color: '#52525B', cursor: 'pointer', fontSize: 14 }}>×</button>
                  </div>
                ))}
                <button onClick={addVolumeDiscount} style={{
                  background: 'rgba(139,92,246,0.08)', border: '1px dashed rgba(139,92,246,0.3)',
                  borderRadius: 6, padding: '5px 12px', fontSize: 11, color: '#A78BFA', cursor: 'pointer', width: '100%', marginTop: 4,
                }}>+ Adicionar faixa</button>
              </div>
            </div>
          </Section>

          {/* Per-product COGS */}
          {shopifyProducts.length > 0 && (
            <Section title="🏷️ COGS por Produto" defaultOpen={false}>
              <p style={{ fontSize: 11, color: '#52525B', marginBottom: 12 }}>
                Defina custo específico por produto. Substitui o custo padrão quando configurado.
                Deixe em $0 para usar o custo padrão.
              </p>
              {config.cogs.products.map((p, i) => {
                const shopifyProd = shopifyProducts.find(sp => sp.product_id === p.product_id)
                return (
                  <div key={p.product_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    {shopifyProd?.image_url && (
                      <img src={shopifyProd.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, color: '#E4E4E7', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </p>
                      {shopifyProd && (
                        <p style={{ fontSize: 10, color: '#52525B' }}>Preço venda: ${shopifyProd.price_min}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: '#71717A' }}>$</span>
                      <input
                        type="number" value={p.cost_usd} step="0.01" min="0"
                        placeholder="0.00"
                        onChange={e => {
                          const n = [...config.cogs.products]
                          n[i] = { ...n[i], cost_usd: parseFloat(e.target.value) || 0 }
                          upd('cogs.products', n)
                        }}
                        style={{
                          background: '#0B0D0F', border: `1px solid ${p.cost_usd > 0 ? 'rgba(139,92,246,0.4)' : '#2A2D38'}`,
                          borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, width: 80, outline: 'none',
                        }}
                      />
                    </div>
                    {p.cost_usd > 0 && shopifyProd && (
                      <span style={{ fontSize: 10, color: shopifyProd.price_min - p.cost_usd > 0 ? '#10B981' : '#F43F5E', minWidth: 50, textAlign: 'right' }}>
                        {((1 - p.cost_usd / shopifyProd.price_min) * 100).toFixed(0)}% margem bruta
                      </span>
                    )}
                  </div>
                )
              })}
            </Section>
          )}

          <Section title="🚚 Frete por País">
            <Field label="Taxa padrão" hint="para países não listados">
              <NumInput value={config.shipping.default_rate_usd} onChange={v => upd('shipping.default_rate_usd', v)} prefix="$" />
            </Field>
            <div>
              <label style={{ fontSize: 11, color: '#71717A', fontWeight: 500 }}>Taxas por país</label>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 80px 24px', gap: 6, marginTop: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: '#52525B' }}>Código</span>
                <span style={{ fontSize: 10, color: '#52525B' }}>País</span>
                <span style={{ fontSize: 10, color: '#52525B' }}>USD</span>
                <span />
              </div>
              {config.shipping.rates.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 80px 24px', gap: 6, marginBottom: 6 }}>
                  <input value={r.country_code} placeholder="US"
                    onChange={e => { const n = [...config.shipping.rates]; n[i] = { ...n[i], country_code: e.target.value.toUpperCase() }; upd('shipping.rates', n) }}
                    style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none', textTransform: 'uppercase' }}
                  />
                  <input value={r.name} placeholder="Nome do país"
                    onChange={e => { const n = [...config.shipping.rates]; n[i] = { ...n[i], name: e.target.value }; upd('shipping.rates', n) }}
                    style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none' }}
                  />
                  <input type="number" value={r.cost_usd} step="0.01"
                    onChange={e => { const n = [...config.shipping.rates]; n[i] = { ...n[i], cost_usd: parseFloat(e.target.value)||0 }; upd('shipping.rates', n) }}
                    style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none' }}
                  />
                  <button onClick={() => removeShippingRate(i)}
                    style={{ background: 'none', border: 'none', color: '#52525B', cursor: 'pointer', fontSize: 14 }}>×</button>
                </div>
              ))}
              <button onClick={addShippingRate} style={{
                background: 'rgba(139,92,246,0.08)', border: '1px dashed rgba(139,92,246,0.3)',
                borderRadius: 6, padding: '5px 12px', fontSize: 11, color: '#A78BFA', cursor: 'pointer', width: '100%', marginTop: 4,
              }}>+ Adicionar país</button>
            </div>
          </Section>

          <Section title="➕ Custos Extras" defaultOpen={false}>
            <p style={{ fontSize: 11, color: '#52525B', marginBottom: 10 }}>
              Armazenagem, funcionários, marketing offline, etc.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 24px', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#52525B' }}>Descrição</span>
              <span style={{ fontSize: 10, color: '#52525B' }}>Valor USD</span>
              <span style={{ fontSize: 10, color: '#52525B' }}>Frequência</span>
              <span />
            </div>
            {config.extra_costs.map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 24px', gap: 6, marginBottom: 6 }}>
                <input value={e.name} placeholder="Ex: Armazenagem"
                  onChange={ev => { const n = [...config.extra_costs]; n[i] = { ...n[i], name: ev.target.value }; upd('extra_costs', n) }}
                  style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none' }}
                />
                <input type="number" value={e.amount_usd} step="0.01"
                  onChange={ev => { const n = [...config.extra_costs]; n[i] = { ...n[i], amount_usd: parseFloat(ev.target.value)||0 }; upd('extra_costs', n) }}
                  style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none' }}
                />
                <select value={e.frequency}
                  onChange={ev => { const n = [...config.extra_costs]; n[i] = { ...n[i], frequency: ev.target.value as ExtraCost['frequency'] }; upd('extra_costs', n) }}
                  style={{ background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 6, padding: '5px 8px', color: '#E4E4E7', fontSize: 12, outline: 'none' }}
                >
                  <option value="monthly">Mensal</option>
                  <option value="per_order">Por pedido</option>
                  <option value="annual">Anual</option>
                </select>
                <button onClick={() => removeExtra(i)}
                  style={{ background: 'none', border: 'none', color: '#52525B', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            ))}
            <button onClick={addExtra} style={{
              background: 'rgba(139,92,246,0.08)', border: '1px dashed rgba(139,92,246,0.3)',
              borderRadius: 6, padding: '5px 12px', fontSize: 11, color: '#A78BFA', cursor: 'pointer', width: '100%', marginTop: 4,
            }}>+ Adicionar custo</button>
          </Section>

          <button onClick={saveAndCalculate} disabled={saving} style={{
            width: '100%', padding: '11px', borderRadius: 8, border: 'none',
            background: saved ? 'rgba(16,185,129,0.2)' : 'linear-gradient(135deg,#8B5CF6,#6D28D9)',
            color: saved ? '#10B981' : '#fff', fontSize: 13, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
          }}>
            {saving ? 'Salvando…' : saved ? '✓ Salvo!' : 'Salvar e Calcular'}
          </button>
        </div>

        {/* ── Results Panel ── */}
        <div>
          {calculating ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
              <div style={{ color: '#52525B', fontSize: 14 }}>Calculando…</div>
            </div>
          ) : result ? (
            <>
              {/* ── Summary cards (4 cards) ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                {/* Lucro Líquido */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  style={{
                    background: result.netProfit >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)',
                    border: `1px solid ${result.netProfit >= 0 ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)'}`,
                    borderRadius: 10, padding: '14px 16px',
                  }}>
                  <p style={{ fontSize: 11, color: '#71717A', marginBottom: 6 }}>Lucro Líquido</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: result.netProfit >= 0 ? '#10B981' : '#F43F5E' }}>
                    {$fmt(result.netProfit)}
                  </p>
                  <p style={{ fontSize: 11, color: '#52525B', marginTop: 3 }}>
                    {result.orderCount} pedidos
                  </p>
                </motion.div>

                {/* Margem % — DESTAQUE */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                  style={{
                    background: result.margin >= 20
                      ? 'rgba(16,185,129,0.1)'
                      : result.margin >= 10
                        ? 'rgba(245,158,11,0.1)'
                        : 'rgba(244,63,94,0.1)',
                    border: `2px solid ${result.margin >= 20 ? '#10B981' : result.margin >= 10 ? '#F59E0B' : '#F43F5E'}`,
                    borderRadius: 10, padding: '14px 16px', position: 'relative', overflow: 'hidden',
                  }}>
                  <p style={{ fontSize: 11, color: '#71717A', marginBottom: 4 }}>Margem Líquida</p>
                  <p style={{
                    fontSize: 32, fontWeight: 800, letterSpacing: '-1px',
                    color: result.margin >= 20 ? '#10B981' : result.margin >= 10 ? '#F59E0B' : '#F43F5E',
                    lineHeight: 1,
                  }}>
                    {pct(result.margin, 1)}
                  </p>
                  <p style={{ fontSize: 10, color: '#52525B', marginTop: 5 }}>
                    {result.margin >= 20 ? 'Excelente' : result.margin >= 10 ? 'Aceitável' : result.margin >= 0 ? 'Baixa' : 'Negativa'}
                  </p>
                </motion.div>

                {/* Lucro por Pedido */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                  style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ fontSize: 11, color: '#71717A', marginBottom: 6 }}>Lucro / Pedido</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: '#8B5CF6' }}>{$fmt(result.avgProfitPerOrder)}</p>
                  <p style={{ fontSize: 11, color: '#52525B', marginTop: 3 }}>
                    Receita média {$fmt(result.avgRevenuePerOrder)}
                  </p>
                </motion.div>

                {/* ROAS Break-even */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ fontSize: 11, color: '#71717A', marginBottom: 6 }}>ROAS Break-even</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: '#F59E0B' }}>{result.breakEvenRoas.toFixed(2)}x</p>
                  <p style={{ fontSize: 11, color: '#52525B', marginTop: 3 }}>Para cobrir todos os custos</p>
                </motion.div>
              </div>

              {/* Daily chart */}
              {result.dailyData.length > 1 && (
                <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 10, padding: 20, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F5', marginBottom: 4 }}>
                    Receita & Lucro Diário
                  </h3>
                  <p style={{ fontSize: 11, color: '#52525B', marginBottom: 16 }}>
                    Barras = receita · Linha = lucro estimado por dia
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={result.dailyData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1A1D25" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#52525B' }}
                        tickLine={false} axisLine={false}
                        tickFormatter={d => d.slice(5)}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#52525B' }}
                        tickLine={false} axisLine={false}
                        tickFormatter={v => `$${Math.abs(v) >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0)}`}
                        width={52}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={0} stroke="#2A2D38" strokeDasharray="4 4" />
                      <Bar dataKey="revenue" name="Receita" fill="rgba(139,92,246,0.25)" radius={[2,2,0,0]} maxBarSize={24} />
                      <Line type="monotone" dataKey="profit" name="Lucro" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#10B981' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Waterfall */}
              <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 10, padding: 20, marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F5', marginBottom: 4 }}>Decomposição da Receita</h3>
                <p style={{ fontSize: 11, color: '#52525B', marginBottom: 20 }}>
                  {result.orderCount} pedidos · {result.dateFrom} → {result.dateTo}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 90px 60px', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: '#3F3F46', textAlign: 'right' }}>Item</span>
                  <span />
                  <span style={{ fontSize: 10, color: '#3F3F46', textAlign: 'right' }}>Valor</span>
                  <span style={{ fontSize: 10, color: '#3F3F46', textAlign: 'right' }}>% Receita</span>
                </div>
                <WaterfallBar label="Receita Bruta"   value={result.totalRevenue}      total={total} color="#10B981" pctOfRevenue={100} />
                <WaterfallBar label="Taxa Shopify"     value={-result.totalShopifyFees} total={total} color="#F43F5E" pctOfRevenue={result.totalRevenue > 0 ? (result.totalShopifyFees/result.totalRevenue)*100:0} />
                <WaterfallBar label="Taxa Pagamento"   value={-result.totalPaymentFees} total={total} color="#F43F5E" pctOfRevenue={result.totalRevenue > 0 ? (result.totalPaymentFees/result.totalRevenue)*100:0} />
                <WaterfallBar label="COGS (produto)"   value={-result.totalCogs}        total={total} color="#F59E0B" pctOfRevenue={result.totalRevenue > 0 ? (result.totalCogs/result.totalRevenue)*100:0} />
                <WaterfallBar label="Embalagem"        value={-result.totalPackaging}   total={total} color="#F59E0B" pctOfRevenue={result.totalRevenue > 0 ? (result.totalPackaging/result.totalRevenue)*100:0} />
                <WaterfallBar label="Frete"            value={-result.totalShipping}    total={total} color="#38BDF8" pctOfRevenue={result.totalRevenue > 0 ? (result.totalShipping/result.totalRevenue)*100:0} />
                <WaterfallBar label="Facebook Ads"     value={-result.fbSpend}          total={total} color="#8B5CF6" pctOfRevenue={result.totalRevenue > 0 ? (result.fbSpend/result.totalRevenue)*100:0} />
                {result.totalExtraCosts > 0 && (
                  <WaterfallBar label="Custos Extras"  value={-result.totalExtraCosts}  total={total} color="#71717A" pctOfRevenue={result.totalRevenue > 0 ? (result.totalExtraCosts/result.totalRevenue)*100:0} />
                )}
                {result.totalAdditionalUnitSavings > 0 && (
                  <WaterfallBar label="Desc. Unid. Extra" value={result.totalAdditionalUnitSavings} total={total} color="#10B981" pctOfRevenue={result.totalRevenue > 0 ? (result.totalAdditionalUnitSavings/result.totalRevenue)*100:0} />
                )}
                <div style={{ borderTop: '1px solid #1E2028', marginTop: 10, paddingTop: 10 }}>
                  <WaterfallBar
                    label="Lucro Líquido"
                    value={result.netProfit}
                    total={total}
                    color={result.netProfit >= 0 ? '#10B981' : '#F43F5E'}
                    pctOfRevenue={result.margin}
                  />
                </div>
              </div>

              {/* Per-order economics */}
              <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 10, padding: 20 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F5', marginBottom: 16 }}>Economia por Pedido (média)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    { label: 'Receita', value: $fmt(result.avgRevenuePerOrder), color: '#10B981' },
                    { label: 'COGS + Embalagem', value: $fmt(result.orderCount > 0 ? (result.totalCogs + result.totalPackaging) / result.orderCount : 0), color: '#F59E0B' },
                    { label: 'Frete', value: $fmt(result.orderCount > 0 ? result.totalShipping / result.orderCount : 0), color: '#38BDF8' },
                    { label: 'Lucro', value: $fmt(result.avgProfitPerOrder), color: result.avgProfitPerOrder >= 0 ? '#10B981' : '#F43F5E' },
                  ].map(item => (
                    <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                      <p style={{ fontSize: 10, color: '#52525B', marginBottom: 6 }}>{item.label}</p>
                      <p style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : !calculating && configLoaded ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: 300, gap: 12, color: '#52525B',
            }}>
              <p style={{ fontSize: 14 }}>Configure seus custos ao lado e clique em <strong style={{ color: '#A78BFA' }}>Salvar e Calcular</strong></p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function ProfitModule() {
  return (
    <Suspense fallback={<div style={{ color: '#52525B', padding: 40 }}>Carregando…</div>}>
      <ProfitModuleInner />
    </Suspense>
  )
}
