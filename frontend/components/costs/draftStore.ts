'use client'

/**
 * The unsaved draft of a store's cost settings, kept in sessionStorage (this
 * tab only) so that nothing typed is lost when the page is left by a route the
 * leave guard cannot stop — the store picker, the back button, a reload.
 *
 * Read through useSyncExternalStore: the server render and hydration see no
 * draft, the browser then re-renders with it, so restoring never causes a
 * hydration mismatch.
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { CostForm } from './form'

export interface StoredDraft {
  /** Version of the saved settings the draft was made on. */
  version: string
  form: CostForm
  /** ISO time of the last edit. */
  at: string
}

const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

const keyOf = (storeId: string) => `opero:custos:${storeId}`

function readRaw(storeId: string): string | null {
  try { return window.sessionStorage.getItem(keyOf(storeId)) } catch { return null }
}

export function writeDraft(storeId: string, draft: StoredDraft) {
  try {
    const next = JSON.stringify(draft)
    if (window.sessionStorage.getItem(keyOf(storeId)) === next) return
    window.sessionStorage.setItem(keyOf(storeId), next)
  } catch { /* storage full or disabled: the leave guard still warns */ }
  notify()
}

export function clearDraft(storeId: string) {
  try { window.sessionStorage.removeItem(keyOf(storeId)) } catch { /* nothing stored */ }
  notify()
}

/** The stored draft of this store, or null (always null on the server). */
export function useStoredDraft(storeId: string): StoredDraft | null {
  const raw = useSyncExternalStore(subscribe, () => readRaw(storeId), () => null)
  return useMemo(() => {
    if (!raw) return null
    try {
      const d = JSON.parse(raw) as StoredDraft
      return d && typeof d.version === 'string' && d.form && d.form.cogs ? d : null
    } catch {
      return null
    }
  }, [raw])
}
