/**
 * Compatibility surface over the profit engine (lib/engine).
 *
 * The maths no longer lives here. These functions keep the shapes older
 * callers — and the Opero Finance desktop app through /api/desktop — rely on,
 * and compute every number with lib/engine/pnl.ts, so no screen can disagree
 * with another. New code should import from '@/lib/engine' directly.
 */

import { computeStorePnL, type PnL } from './engine/pnl'
export {
  buildCogsLookups, orderSupplierCost, tierForDate, tiersForDate, tierOrderCost, unitCost,
  supplierOrderFee,
  type ProfitConfig, type CogsPriceTier, type CountryPriceList, type SupplierOrderFee,
  type CogsLookups, type OrderSupplierCost,
} from './engine/costs'

export interface ProfitSummary {
  configured: boolean
  orderCount: number
  totalRevenue: number
  totalCosts: number
  netProfit: number
  margin: number
  avgProfitPerOrder: number
  breakEvenRoas: number
  fbSpend: number
  totalCogs: number
  totalShipping: number
  totalFees: number
  totalExtraCosts: number
  totalAdditionalUnitSavings: number
  /** Per-order destination charges. Included in totalCogs. */
  totalSupplierOrderFees: number
  /** Advertising Shopify runs and bills itself (Shop Campaigns). A cost, not
   *  Meta spend: fbSpend and ROAS stay about Meta alone. */
  shopCampaignSpend: number
}

export interface DailyProfitPoint {
  date: string
  revenue: number
  profit: number
  fbSpend: number
  margin: number | null
}

export interface CountryProfit {
  country_code: string
  revenue: number
  orders: number
  fbSpend: number
  netProfit: number
  margin: number
  roas: number
  configured: boolean
}

export function toProfitSummary(t: PnL, configured: boolean): ProfitSummary {
  return {
    configured,
    orderCount: t.orders,
    totalRevenue: t.revenue,
    totalCosts: t.variableCosts + t.fixedCosts + t.metaSpend + t.shopSpend,
    netProfit: t.operatingProfit,
    margin: t.margin ?? 0,
    avgProfitPerOrder: t.profitPerOrder ?? 0,
    breakEvenRoas: t.breakEvenRoas ?? 0,
    fbSpend: t.metaSpend,
    totalCogs: t.cogs + t.supplierFees + t.packaging,
    totalShipping: t.shipping,
    totalFees: t.fees,
    totalExtraCosts: t.perOrderExtras + t.fixedCosts,
    totalAdditionalUnitSavings: t.unitSavings,
    totalSupplierOrderFees: t.supplierFees,
    shopCampaignSpend: t.shopSpend,
  }
}

export async function getProfitSummary(tenantId: string, dateFrom: string, dateTo: string): Promise<ProfitSummary> {
  const p = await computeStorePnL(tenantId, { from: dateFrom, to: dateTo })
  if (!p) return toProfitSummary(emptyPnL(), false)
  return toProfitSummary(p.totals, p.configured)
}

export async function getDailyProfitData(
  tenantId: string, dateFrom: string, dateTo: string,
): Promise<{ configured: boolean; dailyData: DailyProfitPoint[] }> {
  const p = await computeStorePnL(tenantId, { from: dateFrom, to: dateTo })
  if (!p) return { configured: false, dailyData: [] }
  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    configured: p.configured,
    // Days with no sales and no spend at all are left out, as before.
    dailyData: p.daily
      .filter(d => d.revenue > 0 || d.metaSpend > 0 || d.shopSpend > 0)
      .map(d => ({
        date: d.date,
        revenue: r2(d.revenue),
        profit: r2(d.operatingProfit),
        fbSpend: r2(d.metaSpend),
        margin: d.margin === null ? null : Math.round(d.margin * 10) / 10,
      })),
  }
}

/** Contribution per country, minus the Meta spend Meta attributes to it. */
export async function getCountryProfit(tenantId: string, dateFrom: string, dateTo: string): Promise<CountryProfit[]> {
  const p = await computeStorePnL(tenantId, { from: dateFrom, to: dateTo }, { countries: true })
  if (!p?.countries) return []
  return p.countries.filter(c => c.orders > 0).map(c => {
    const netProfit = c.contribution - c.metaSpend
    return {
      country_code: c.country, revenue: c.revenue, orders: c.orders, fbSpend: c.metaSpend,
      netProfit, margin: c.revenue > 0 ? (netProfit / c.revenue) * 100 : 0,
      roas: c.metaSpend > 0 ? c.revenue / c.metaSpend : 0,
      configured: p.configured,
    }
  })
}

function emptyPnL(): PnL {
  return {
    revenue: 0, orders: 0, units: 0, cogs: 0, packaging: 0, supplierFees: 0, unitSavings: 0,
    shipping: 0, shopifyFees: 0, paymentFees: 0, perOrderExtras: 0, fixedCosts: 0,
    metaSpend: 0, shopSpend: 0, metaPurchaseValue: 0, metaPurchases: 0,
    refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0, chargebackFees: 0, chargebackCount: 0,
    productCost: 0, fees: 0, variableCosts: 0, contribution: 0, adSpend: 0, operatingProfit: 0,
    adjustments: 0, cashResult: 0, margin: null, contributionMargin: null, breakEvenRoas: null,
    roas: null, metaRoas: null, profitPerOrder: null,
  }
}
