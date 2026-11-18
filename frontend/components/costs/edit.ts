/**
 * Immutable updates of the cost form, so sections stay one-liners and every
 * change produces a new object (React re-renders only what changed).
 */

import type { CostForm } from './form'

export type Update = (fn: (f: CostForm) => CostForm) => void

export const setShopify = (f: CostForm, patch: Partial<CostForm['shopify']>): CostForm =>
  ({ ...f, shopify: { ...f.shopify, ...patch } })

export const setCogs = (f: CostForm, patch: Partial<CostForm['cogs']>): CostForm =>
  ({ ...f, cogs: { ...f.cogs, ...patch } })

export const setShipping = (f: CostForm, patch: Partial<CostForm['shipping']>): CostForm =>
  ({ ...f, shipping: { ...f.shipping, ...patch } })

/** Replace the row with this id (by stable id, never by position). */
export function patchRow<T extends { _id: string }>(rows: T[], id: string, patch: Partial<T>): T[] {
  return rows.map(r => (r._id === id ? { ...r, ...patch } : r))
}

export const dropRow = <T extends { _id: string }>(rows: T[], id: string): T[] => rows.filter(r => r._id !== id)

export const addUnique = (ids: string[], id: string): string[] => (ids.includes(id) ? ids : [...ids, id])
export const without = (ids: string[], id: string): string[] => ids.filter(x => x !== id)
