'use client'

/**
 * DataTable — compact rows, right-aligned mono numbers, sticky header,
 * optional sorting, a designed empty state. A client component that receives
 * PRE-RENDERED cells, so server pages keep doing all the formatting:
 *
 *   <DataTable
 *     caption="Campanhas da MOKOO nos últimos 7 dias"
 *     columns={[
 *       { key: 'name', label: 'Campanha' },
 *       { key: 'spend', label: 'Gasto', numeric: true, sortable: true },
 *       { key: 'roas', label: 'ROAS × empate', info: 'Receita atribuída ÷ gasto, contra o empate da loja.' },
 *     ]}
 *     rows={campaigns.map(c => ({
 *       key: c.id,
 *       cells: { name: c.name, spend: <Money value={c.spend} />, roas: <RoasGauge size="mini" … /> },
 *       sort: { spend: c.spend },
 *     }))}
 *     initialSort={{ key: 'spend', dir: 'desc' }}
 *     empty={<EmptyState title="Nenhuma campanha com gasto" />} />
 *
 * Props:
 *   columns       DataColumn[] — { key; label: ReactNode; align?: 'left'|'right'|'center';
 *                 numeric?: boolean (mono + right-aligned); sortable?: boolean; width?: string|number;
 *                 info?: ReactNode (ⓘ in the header) }
 *   rows          DataRow[] — { key: string; cells: Record<columnKey, ReactNode>;
 *                 sort?: Record<columnKey, number|string|null> (sort values; null sorts last);
 *                 tone?: 'mut' (greyed row, e.g. paused); href?: string (the first cell becomes
 *                 a link, and a click anywhere on the row follows it; build it with ctx.hrefWith) }
 *   caption       string — read by screen readers (visually hidden).
 *   initialSort?  { key; dir: 'asc'|'desc' }
 *   empty?        ReactNode shown instead of the body when rows is empty
 *                 (default: "Nada para mostrar neste período").
 *   footer?       Record<columnKey, ReactNode> — a totals row (tfoot).
 *   maxHeight?    number (px) — scroll inside the table; the header sticks.
 *   dense?        boolean — tighter rows.
 *   stickyHeader? boolean (default true).
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { InfoTip } from './InfoTip'
import { EmptyState } from './Card'
import s from './DataTable.module.css'

export interface DataColumn {
  key: string
  label: ReactNode
  align?: 'left' | 'right' | 'center'
  numeric?: boolean
  sortable?: boolean
  width?: string | number
  info?: ReactNode
}

export interface DataRow {
  key: string
  cells: Record<string, ReactNode>
  sort?: Record<string, number | string | null>
  tone?: 'mut'
  href?: string
}

export interface DataTableProps {
  columns: DataColumn[]
  rows: DataRow[]
  caption: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  empty?: ReactNode
  footer?: Record<string, ReactNode>
  maxHeight?: number
  dense?: boolean
  stickyHeader?: boolean
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function DataTable({ columns, rows, caption, initialSort, empty, footer, maxHeight, dense, stickyHeader = true }: DataTableProps) {
  const router = useRouter()
  const [sort, setSort] = useState(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = a.sort?.[sort.key] ?? null
      const vb = b.sort?.[sort.key] ?? null
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR') * dir
    })
  }, [rows, sort])

  const alignOf = (c: DataColumn) => c.align ?? (c.numeric ? 'right' : 'left')
  const toggle = (key: string) => setSort(cur => (cur?.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  if (!rows.length) {
    return <div className={s.empty}>{empty ?? <EmptyState compact title="Nada para mostrar neste período" />}</div>
  }

  return (
    <div className={s.wrap} style={maxHeight ? { maxHeight } : undefined}>
      <table className={cx(s.table, stickyHeader && s.sticky, dense && s.dense)}>
        <caption className={s.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map(c => {
              const a = alignOf(c)
              const active = sort?.key === c.key
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={cx(s.th, a === 'right' && s.right, a === 'center' && s.center, active && s.sorted)}
                  style={c.width !== undefined ? { width: c.width } : undefined}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}
                >
                  <span className={s.thInner}>
                    {c.sortable ? (
                      <button type="button" className={s.sortBtn} onClick={() => toggle(c.key)}>
                        {c.label}
                        <Icon name={active && sort!.dir === 'asc' ? 'chevUp' : 'chev'} size={11} className={s.sortIcon} />
                      </button>
                    ) : c.label}
                    {c.info && <InfoTip label="Como é calculado">{c.info}</InfoTip>}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className={s.tbody}>
          {sorted.map(r => (
            <tr
              key={r.key}
              className={cx(s.tr, r.tone === 'mut' && s.mut, r.href && s.link)}
              // The first cell holds the real link (keyboard, middle-click);
              // a click anywhere else on the row follows it too.
              onClick={r.href ? e => {
                if ((e.target as Element).closest('a, button, input, select, textarea, label')) return
                router.push(r.href!)
              } : undefined}
            >
              {columns.map((c, i) => {
                const a = alignOf(c)
                const content = r.cells[c.key] ?? null
                return (
                  <td key={c.key} className={cx(s.td, a === 'right' && s.right, a === 'center' && s.center, c.numeric && s.num)}>
                    {r.href && i === 0 ? <Link href={r.href}>{content}</Link> : content}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot className={s.tfoot}>
            <tr>
              {columns.map(c => {
                const a = alignOf(c)
                return <td key={c.key} className={cx(s.td, a === 'right' && s.right, a === 'center' && s.center, c.numeric && s.num)}>{footer[c.key] ?? null}</td>
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
