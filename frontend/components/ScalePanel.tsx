'use client'
import { makeFmt } from '@/lib/format'
import { useSettings } from '@/contexts/SettingsContext'
import type { CampaignSignal, Verdict } from '@/lib/scaleSignals'

const LOOK: Record<Verdict, { label: string; color: string; bg: string; border: string }> = {
  scale:        { label: 'ESCALAR',   color: '#34d399', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.35)' },
  cut:          { label: 'CORTAR',    color: '#ff6b6b', bg: 'rgba(244,63,94,0.10)',  border: 'rgba(244,63,94,0.35)' },
  watch:        { label: 'OBSERVAR',  color: '#fbbf24', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.28)' },
  hold:         { label: 'SEGURAR',   color: '#A1A1AA', bg: 'rgba(255,255,255,0.03)', border: 'var(--border)' },
  insufficient: { label: 'SEM VOLUME', color: '#52525B', bg: 'transparent',          border: 'var(--border)' },
}

/**
 * Campaign verdicts, loudest first.
 *
 * Campaign level because that is what can actually be funded here — a verdict
 * about a single creative would be advice nobody can act on.
 */
export default function ScalePanel({ signals, minMargin }: {
  signals: CampaignSignal[]
  minMargin: number
}) {
  const { currency } = useSettings()
  const fmt = makeFmt(currency)

  const actionable = signals.filter(s => s.verdict === 'scale' || s.verdict === 'cut')
  const rest = signals.filter(s => s.verdict !== 'scale' && s.verdict !== 'cut')

  if (!signals.length) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
        Sem campanhas julgáveis. Isso acontece quando os custos da loja não estão
        configurados — sem eles não há margem para calcular.
      </p>
    )
  }

  return (
    <>
      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '0 0 14px', lineHeight: 1.6 }}>
        Margem = receita que o Meta atribui à campanha, menos os custos reais da sua
        loja, menos o gasto dela. Julga os <b>últimos 7 dias fechados</b> — o dia de
        hoje fica de fora porque gasto e venda ainda estão entrando.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[...actionable, ...rest].map(s => {
          const look = LOOK[s.verdict]
          const dias = s.days.slice(-7).filter(d => d.spend > 0)
          return (
            <div key={s.campaignId} style={{
              background: look.bg, border: `1px solid ${look.border}`,
              borderRadius: 11, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', flexShrink: 0,
                  color: look.color, background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '3px 6px',
                }}>{look.label}</span>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{s.name}</span>
                {s.status && s.status !== 'ACTIVE' && (
                  <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>pausada</span>
                )}
                <span style={{
                  fontSize: 15, fontWeight: 700, flexShrink: 0,
                  color: s.margin >= minMargin ? '#34d399' : s.margin >= 0 ? '#fbbf24' : '#ff6b6b',
                }}>{s.margin.toFixed(0)}%</span>
              </div>

              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 6px', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(s.spend)} gastos · {s.orders} pedidos · {fmt(s.revenue)} receita
                {s.cpa !== null && <> · CPA {fmt(s.cpa)}</>}
                {s.roas !== null && <> · ROAS {s.roas.toFixed(2)}×</>}
              </p>

              {/* Margin per day, as a strip: the shape matters as much as the total. */}
              {dias.length > 0 && (
                <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
                  {dias.map(d => (
                    <span
                      key={d.date}
                      title={`${d.date}: ${d.margin?.toFixed(0) ?? '—'}% · ${fmt(d.spend)}`}
                      style={{
                        flex: 1, height: 5, borderRadius: 2,
                        background: d.margin === null ? 'rgba(255,255,255,0.06)'
                          : d.margin >= minMargin ? '#059669'
                          : d.margin >= 0 ? '#F59E0B' : '#d03b3b',
                        opacity: 0.85,
                      }}
                    />
                  ))}
                </div>
              )}

              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {s.reasons.map((r, i) => (
                  <li key={i} style={{ fontSize: 11.5, color: i === 0 ? 'var(--text-secondary)' : 'var(--text-dim)' }}>
                    {i === 0 ? '' : '· '}{r}
                  </li>
                ))}
              </ul>

              {s.journeyOrders > 0 && (
                <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
                  Nossa jornada enxerga {s.journeyOrders} desses pedidos
                  {s.orders > 0 && ` (${Math.round((s.journeyOrders / s.orders) * 100)}% do que o Meta declara)`}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
