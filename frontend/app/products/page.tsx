import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getActiveTenantId } from '@/lib/activeStore'
import { getProductMetrics, getTenantTimezone } from '@/lib/queries'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'

export const revalidate = 0

function dateInTz(d: Date, tz: string) {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

interface Props {
  searchParams: Promise<{ from?: string; to?: string }>
}

export default async function ProductsPage({ searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  let tenantId: string
  try { tenantId = await getActiveTenantId(userId) } catch { redirect('/onboarding') }

  const tz     = await getTenantTimezone(tenantId)
  const now    = new Date()
  const sp     = await searchParams
  const dateTo   = sp.to   ?? dateInTz(now, tz)
  const dateFrom = sp.from ?? dateInTz(new Date(now.getTime() - 29 * 86400000), tz)

  const products = await getProductMetrics(tenantId, dateFrom, dateTo)

  const maxRevenue = Math.max(...products.map(p => Number(p.revenue)), 1)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/" />
      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Link href="/" style={{ fontSize: 12, color: 'var(--text-ghost)', textDecoration: 'none' }}>← Dashboard</Link>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
              Produtos
            </h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 3 }}>
              {dateFrom} → {dateTo} · {products.length} produtos com vendas
            </p>
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 100px 90px', gap: 0, padding: '10px 20px', fontSize: 10, color: 'var(--text-ghost)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
            <span>Produto</span>
            <span style={{ textAlign: 'right' }}>Unidades</span>
            <span style={{ textAlign: 'right' }}>Pedidos</span>
            <span style={{ textAlign: 'right' }}>Receita</span>
            <span style={{ textAlign: 'right' }}>AOV</span>
          </div>

          {products.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-faint)', fontSize: 14 }}>Sem dados de produtos para este período</p>
            </div>
          ) : (
            products.map((p, i) => {
              const revenue = Number(p.revenue)
              const revPct  = maxRevenue > 0 ? (revenue / maxRevenue) * 100 : 0
              return (
                <div key={p.product_id ?? i} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 100px 90px', alignItems: 'center', padding: '12px 20px', borderBottom: i < products.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {p.image_url && (
                      <img src={p.image_url} alt="" width={36} height={36}
                        style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }}
                        onError={undefined} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.title}
                      </p>
                      {/* Revenue bar */}
                      <div style={{ marginTop: 4, width: 120, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${revPct}%`, height: '100%', background: '#10B981', borderRadius: 2 }} />
                      </div>
                    </div>
                  </div>
                  <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
                    {Number(p.units).toLocaleString()}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-muted)' }}>
                    {Number(p.orders).toLocaleString()}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#10B981' }}>
                    ${revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
                    ${Number(p.aov).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </main>
    </div>
  )
}
