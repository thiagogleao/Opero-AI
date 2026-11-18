'use client'

/**
 * ExpandableTable — a compact table whose rows open to show detail rendered
 * on the server (the campaign's ad sets and ads). Only the open/closed state
 * lives here; every cell and every detail arrives pre-rendered, so the page
 * keeps doing all the data work and formatting.
 *
 * Props:
 *   columns  { key; label: ReactNode; numeric?: boolean; width?: string|number; info?: ReactNode }[]
 *   rows     { key; cells: Record<key, ReactNode>; detail?: ReactNode (when set, the
 *            first cell becomes a toggle button); toggleLabel?: string (screen readers);
 *            tone?: 'mut' }[]
 *   caption  string (screen readers)
 *   footer?  Record<key, ReactNode>
 *   empty?   ReactNode (shown instead of the table when rows is empty)
 */

import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { InfoTip } from '@/components/ui/InfoTip'
import s from './campaigns.module.css'

export interface ExpandableColumn {
  key: string
  label: ReactNode
  numeric?: boolean
  width?: string | number
  info?: ReactNode
}

export interface ExpandableRow {
  key: string
  cells: Record<string, ReactNode>
  detail?: ReactNode
  toggleLabel?: string
  tone?: 'mut'
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
const domId = (key: string) => `row-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`

export function ExpandableTable({ columns, rows, caption, footer, empty }: {
  columns: ExpandableColumn[]; rows: ExpandableRow[]; caption: string; footer?: Record<string, ReactNode>; empty?: ReactNode
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setOpen(cur => {
    const next = new Set(cur)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  if (!rows.length) return <>{empty ?? null}</>

  return (
    <div className={s.wrap}>
      <table className={s.table}>
        <caption className={s.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} scope="col" className={cx(s.th, c.numeric && s.right)} style={c.width !== undefined ? { width: c.width } : undefined}>
                <span className={s.thInner}>
                  {c.label}
                  {c.info && <InfoTip label="Como é calculado">{c.info}</InfoTip>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isOpen = open.has(r.key)
            const id = domId(r.key)
            return [
              <tr key={r.key} className={cx(s.row, r.tone === 'mut' && s.rowMut, isOpen && s.rowOpen)}>
                {columns.map((c, i) => {
                  const content = r.cells[c.key] ?? null
                  return (
                    <td key={c.key} className={cx(s.td, c.numeric && s.right, c.numeric && s.tdNum)}>
                      {i === 0 && r.detail ? (
                        <button
                          type="button"
                          className={s.toggle}
                          aria-expanded={isOpen}
                          aria-controls={id}
                          onClick={() => toggle(r.key)}
                        >
                          <Icon name="chev" size={13} className={s.toggleIcon} />
                          <span>
                            {content}
                            <span className="sr-only">{isOpen ? ' — fechar' : ` — abrir ${r.toggleLabel ?? 'detalhes'}`}</span>
                          </span>
                        </button>
                      ) : content}
                    </td>
                  )
                })}
              </tr>,
              // Kept in the DOM while closed so aria-controls always points at
              // a real element; `hidden` takes it out of view and of the
              // accessibility tree.
              r.detail ? (
                <tr key={`${r.key}:detail`} id={id} hidden={!isOpen}>
                  <td colSpan={columns.length} className={s.detailCell}>{r.detail}</td>
                </tr>
              ) : null,
            ]
          })}
        </tbody>
        {footer && (
          <tfoot className={s.tfoot}>
            <tr>
              {columns.map(c => (
                <td key={c.key} className={cx(s.td, c.numeric && s.right, c.numeric && s.tdNum)}>{footer[c.key] ?? null}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
