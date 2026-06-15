'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverlay, DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import MetricCard from '@/components/MetricCard'
import RevenueChart from '@/components/RevenueChart'
import RoasChart from '@/components/RoasChart'
import CountryChart from '@/components/CountryChart'
import CustomerChart from '@/components/CustomerChart'
import BreakdownTabs from '@/components/BreakdownTabs'
import LtvSection from '@/components/LtvSection'
import CreativesTable from '@/components/CreativesTable'
import DailyProfitChart from '@/components/DailyProfitChart'
import MarginBreakdownChart from '@/components/MarginBreakdownChart'
import AiPanel from '@/components/AiPanel'
import CampaignProfitTable from '@/components/CampaignProfitTable'
import FunnelVisual from '@/components/FunnelVisual'
import CountrySpendTable from '@/components/CountrySpendTable'

import {
  BLOCK_DEFS, BlockState, getDefaultLayout, mergeWithDefaults, getBlockDef,
} from '@/lib/dashboardBlocks'
import { makeFmt } from '@/lib/format'
import { useSettings } from '@/contexts/SettingsContext'
import type { ProfitSummary } from '@/lib/profitCalc'

// ─── Types ────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
interface DashboardLayoutProps {
  metrics: any
  revenue: any[]
  roas: any[]
  creatives: any[]
  countries: any[]
  customers: any
  profit: ProfitSummary
  funnel: any
  countrySpend: any[]
  countryProfit: any[]
  dailyProfit: any
  bdDevice: any[]
  bdPlacement: any[]
  bdAgeGender: any[]
  ltvData: any[]
  systemPrompt: string
  cacheKey: string
  dateFrom: string
  dateTo: string
  days: number
  tid: string
  tr: Record<string, string>
  abandonRate: string
  safeAbandonedValue: number
  beRoas: number
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Sortable block item (inside customizer panel) ────────────────────────────

function SortableBlockItem({
  block, onToggle, isDragActive,
}: {
  block: BlockState
  onToggle: () => void
  isDragActive: boolean
}) {
  const def = getBlockDef(block.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 1 : undefined,
  }

  if (!def) return null

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: isDragging ? 'var(--bg-hover)' : block.visible ? 'transparent' : 'rgba(255,255,255,0.02)',
        borderRadius: 8,
        border: '1px solid',
        borderColor: isDragging ? 'var(--border)' : block.visible ? 'transparent' : 'transparent',
        marginBottom: 4,
        userSelect: 'none',
      }}>
        {/* Drag handle */}
        <div
          {...listeners}
          {...attributes}
          style={{
            cursor: isDragActive ? 'grabbing' : 'grab',
            color: 'var(--text-ghost)',
            fontSize: 16,
            lineHeight: 1,
            flexShrink: 0,
            padding: '2px 4px',
          }}
          title="Arraste para reordenar"
        >
          ⣿
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: block.visible ? 'var(--text-primary)' : 'var(--text-ghost)' }}>
            {def.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {def.description}
          </div>
        </div>

        {/* Toggle visibility */}
        <button
          onClick={onToggle}
          title={block.visible ? 'Ocultar bloco' : 'Mostrar bloco'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: block.visible ? '#A78BFA' : 'var(--text-ghost)',
            fontSize: 16, padding: '2px 4px', flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {block.visible ? '◉' : '○'}
        </button>
      </div>
    </div>
  )
}

// ─── Customizer panel ─────────────────────────────────────────────────────────

function CustomizerPanel({
  blocks,
  onClose,
  onReset,
  onReorder,
  onToggle,
}: {
  blocks: BlockState[]
  onClose: () => void
  onReset: () => void
  onReorder: (blocks: BlockState[]) => void
  onToggle: (id: string) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (over && active.id !== over.id) {
      const oldIdx = blocks.findIndex(b => b.id === active.id)
      const newIdx = blocks.findIndex(b => b.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) {
        onReorder(arrayMove(blocks, oldIdx, newIdx))
      }
    }
  }

  const activeBlock = activeId ? blocks.find(b => b.id === activeId) : null
  const activeDef = activeBlock ? getBlockDef(activeBlock.id) : null

  const visibleCount = blocks.filter(b => b.visible).length

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.4)',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 360,
        background: 'var(--bg-elevated, #141414)',
        border: '1px solid var(--border)',
        borderRight: 'none',
        zIndex: 1001,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Panel header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Personalizar Dashboard
            </h2>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              Arraste para reordenar · Clique em ◉/○ para mostrar/ocultar
            </p>
            <p style={{ fontSize: 11, color: '#A78BFA', marginTop: 2 }}>
              {visibleCount}/{blocks.length} blocos visíveis
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-hover)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
              color: 'var(--text-muted)', flexShrink: 0,
            }}
          >
            Fechar
          </button>
        </div>

        {/* Block list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
              {blocks.map(block => (
                <SortableBlockItem
                  key={block.id}
                  block={block}
                  onToggle={() => onToggle(block.id)}
                  isDragActive={activeId !== null}
                />
              ))}
            </SortableContext>

            <DragOverlay>
              {activeDef && (
                <div style={{
                  padding: '10px 14px', background: 'var(--bg-elevated, #1a1a1a)',
                  border: '1px solid #8B5CF6', borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                  opacity: 0.95,
                }}>
                  {activeDef.label}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>

        {/* Panel footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={onReset}
            style={{
              width: '100%', padding: '8px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(244,63,94,0.08)',
              border: '1px solid rgba(244,63,94,0.2)',
              color: '#F87171', fontSize: 12, fontWeight: 600,
            }}
          >
            Restaurar Padrão
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Main DashboardLayout ─────────────────────────────────────────────────────

export default function DashboardLayout(props: DashboardLayoutProps) {
  const {
    metrics, revenue, roas, creatives, countries, customers, profit,
    funnel, countrySpend, countryProfit, dailyProfit,
    bdDevice, bdPlacement, bdAgeGender, ltvData,
    systemPrompt, cacheKey,
    dateFrom, dateTo, days, tid, tr, abandonRate, safeAbandonedValue, beRoas,
  } = props

  const { currency } = useSettings()
  const fmt = makeFmt(currency)

  const storageKey = `dashboard_layout_v2_${tid}`

  const [blocks, setBlocks] = useState<BlockState[]>(() => getDefaultLayout())
  const [customizing, setCustomizing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load from localStorage on mount
  useEffect(() => {
    setMounted(true)
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as BlockState[]
        setBlocks(mergeWithDefaults(parsed))
      }
    } catch { /* use defaults */ }
  }, [storageKey])

  // Persist changes to localStorage (debounced)
  const saveBlocks = useCallback((next: BlockState[]) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* noop */ }
    }, 400)
  }, [storageKey])

  function updateBlocks(next: BlockState[]) {
    setBlocks(next)
    saveBlocks(next)
  }

  function toggleVisibility(id: string) {
    updateBlocks(blocks.map(b => b.id === id ? { ...b, visible: !b.visible } : b))
  }

  function reset() {
    const defaults = getDefaultLayout()
    updateBlocks(defaults)
  }

  // ─── Block renderer ──────────────────────────────────────────────────────────

  function renderBlock(id: string) {
    switch (id) {

      case 'kpi-cards':
        return (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 12, marginBottom: 20,
          }}>
            <MetricCard title={tr.metric_revenue}      value={fmt(Number(metrics.revenue))}          sub={tr.metric_via_shopify}                                      icon="💰" gradient="linear-gradient(135deg,#10B981,#059669)" delay={0}    />
            <MetricCard title={tr.metric_orders}       value={String(metrics.orders)}                sub={`${tr.metric_avg_ticket} ${fmt(Number(metrics.aov))}`}     icon="🛒" gradient="linear-gradient(135deg,#8B5CF6,#6D28D9)" delay={0.07} />
            <MetricCard title={tr.metric_roas_real}    value={`${Number(metrics.blended_roas).toFixed(2)}x`} sub={tr.metric_revenue_shopify}                         icon="📈" gradient="linear-gradient(135deg,#38BDF8,#0284C7)" delay={0.14} />
            <MetricCard title={tr.metric_fb_spend}     value={fmt(Number(metrics.spend))}            sub={`${metrics.purchases} ${tr.creative_purchases}`}           icon="📣" gradient="linear-gradient(135deg,#F59E0B,#D97706)" delay={0.21} />
            <MetricCard title={tr.metric_new_customers} value={String(metrics.new_customers)}        sub={`${metrics.returning_customers} ${tr.metric_returning}`}   icon="👥" gradient="linear-gradient(135deg,#A78BFA,#7C3AED)" delay={0.28} />
            <MetricCard title={tr.metric_abandoned}    value={fmt(safeAbandonedValue)}               sub={`${abandonRate}% ${tr.metric_abandon_rate}`}               icon="⚠️" gradient="linear-gradient(135deg,#F43F5E,#BE123C)" delay={0.35} />
          </div>
        )

      case 'profit-banner':
        return profit.configured ? (
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
        )

      case 'profit-charts':
        if (!profit.configured) return null
        return (
          <div style={{
            display: 'grid',
            gridTemplateColumns: dailyProfit.configured && dailyProfit.dailyData.length > 1 ? '2fr 1fr' : '1fr',
            gap: 12, marginBottom: 12,
          }}>
            {dailyProfit.configured && dailyProfit.dailyData.length > 1 && (
              <DailyProfitChart data={dailyProfit.dailyData} days={days} />
            )}
            <MarginBreakdownChart profit={profit} />
          </div>
        )

      case 'funnel-visual':
        return <FunnelVisual data={funnel} days={days} fmt={fmt} />

      case 'revenue-chart':
        return (
          <div style={{ marginBottom: 12 }}>
            <RevenueChart data={revenue} days={days} />
          </div>
        )

      case 'roas-chart':
        return (
          <div style={{ marginBottom: 12 }}>
            <RoasChart data={roas} days={days} />
          </div>
        )

      case 'creatives-table':
        return (
          <div style={{ marginBottom: 12 }}>
            <CreativesTable data={creatives} days={days} breakEvenRoas={profit.configured ? profit.breakEvenRoas : 1.5} />
          </div>
        )

      case 'country-chart':
        return (
          <div style={{ marginBottom: 12 }}>
            <CountryChart data={countries} days={days} profitData={countryProfit} />
          </div>
        )

      case 'country-spend':
        return <CountrySpendTable data={countrySpend} days={days} fmt={fmt} />

      case 'customer-chart':
        return (
          <div style={{ marginBottom: 12 }}>
            <CustomerChart data={customers} days={days} />
          </div>
        )

      case 'ltv-section':
        if (ltvData.length === 0) return null
        return (
          <div style={{ marginBottom: 12 }}>
            <LtvSection data={ltvData} />
          </div>
        )

      case 'breakdown-tabs':
        return (
          <div style={{ marginBottom: 12 }}>
            <BreakdownTabs device={bdDevice} placement={bdPlacement} ageGender={bdAgeGender} days={14} />
          </div>
        )

      case 'campaign-profit':
        return <CampaignProfitTable />

      case 'ai-panel':
        return <AiPanel systemPrompt={systemPrompt} cacheKey={cacheKey} />

      case 'notes':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
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
        )

      default:
        return null
    }
  }

  // Avoid hydration mismatch — only render layout after mount (localStorage loaded)
  if (!mounted) {
    return (
      <div style={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: '#8B5CF6', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  const visibleBlocks = blocks.filter(b => b.visible)

  return (
    <>
      {/* Personalizar button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          onClick={() => setCustomizing(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
            background: 'rgba(139,92,246,0.1)',
            border: '1px solid rgba(139,92,246,0.25)',
            color: '#A78BFA',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Personalizar
        </button>
      </div>

      {/* Blocks */}
      {visibleBlocks.map(b => {
        const content = renderBlock(b.id)
        if (!content) return null
        return <div key={b.id}>{content}</div>
      })}

      {/* Customizer panel */}
      {customizing && (
        <CustomizerPanel
          blocks={blocks}
          onClose={() => setCustomizing(false)}
          onReset={reset}
          onReorder={updateBlocks}
          onToggle={toggleVisibility}
        />
      )}

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}
