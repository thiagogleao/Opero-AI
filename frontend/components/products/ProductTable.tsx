'use client'

/**
 * ProductTable — the shared DataTable with a search box in front of it. Rows
 * arrive pre-rendered from the server (cells and sort values); only the query
 * lives here. The search matches the product title (and the store name in
 * "Todas"), ignoring accents and case.
 *
 * Props: DataTable's props, plus rows[].search (the text to match) and
 *   noun: [one, many] ("produto", "produtos") for the count line.
 */

import { useDeferredValue, useMemo, useState } from 'react'
import { DataTable, type DataTableProps, type DataRow } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import s from './products.module.css'

export type SearchableRow = DataRow & { search: string }

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function ProductTable({ rows, noun, ...table }: Omit<DataTableProps, 'rows'> & { rows: SearchableRow[]; noun: [string, string] }) {
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query)
  const folded = useMemo(() => rows.map(r => ({ row: r, text: fold(r.search) })), [rows])
  const shown = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean)
    if (!words.length) return rows
    return folded.filter(r => words.every(w => r.text.includes(w))).map(r => r.row)
  }, [folded, rows, q])
  const n = (k: number) => `${k.toLocaleString('pt-BR')} ${k === 1 ? noun[0] : noun[1]}`

  return (
    <div>
      <div className={s.searchBar}>
        <label className={s.search}>
          <Icon name="search" size={14} />
          <span className="sr-only">Buscar {noun[0]}</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Buscar ${noun[0]}…`}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <span className={s.count} aria-live="polite">
          {q.trim() ? `${n(shown.length)} de ${rows.length.toLocaleString('pt-BR')}` : n(rows.length)}
        </span>
      </div>
      <DataTable
        {...table}
        rows={shown}
        empty={q.trim()
          ? <EmptyState compact icon="search" title={`Nenhum ${noun[0]} com "${q.trim()}"`}>Tente outra palavra do nome.</EmptyState>
          : table.empty}
      />
    </div>
  )
}
