/**
 * "Atualizar": real progress of the collectors it started, from
 * POST /api/mobile/refresh (what was launched) and GET ?since= (how each run
 * stands) — never a timer. Pure.
 */

import type { RefreshResponse, RefreshStatusResponse, RefreshSource } from '@/lib/views/refresh'

export type LaunchState = 'fila' | 'rodando' | 'ok' | 'erro'

export interface LaunchLine {
  storeId: string
  name: string
  source: RefreshSource
  state: LaunchState
}

export interface RefreshProgress {
  lines: LaunchLine[]
  total: number
  /** Finished, successfully or not. */
  done: number
  failed: LaunchLine[]
  /** Every launched run has finished. */
  finished: boolean
}

export const SOURCE_LABEL: Record<RefreshSource, string> = { shopify: 'pedidos', facebook: 'anúncios' }

export function refreshProgress(
  launched: RefreshResponse['launched'], status: RefreshStatusResponse | null,
): RefreshProgress {
  const runs = new Map((status?.runs ?? []).map(r => [`${r.storeId}:${r.source}`, r]))
  const lines = launched.map((l): LaunchLine => {
    const r = runs.get(`${l.storeId}:${l.source}`)
    const st = r?.status ?? null
    const state: LaunchState = st === null ? 'fila' : st === 'running' ? 'rodando' : st === 'error' ? 'erro' : 'ok'
    return { storeId: l.storeId, name: l.name, source: l.source, state }
  })
  const done = lines.filter(l => l.state === 'ok' || l.state === 'erro').length
  return {
    lines, total: lines.length, done,
    failed: lines.filter(l => l.state === 'erro'),
    finished: lines.length > 0 && done === lines.length,
  }
}

/** One sentence for what a refresh skipped ("MOKOO: atualizada há menos de 2 min"). */
export function skippedText(skipped: RefreshResponse['skipped']): string | null {
  const recent = [...new Set(skipped.filter(s => s.reason === 'recente').map(s => s.name))]
  if (!recent.length) return null
  const names = recent.length > 3 ? `${recent.slice(0, 3).join(', ')} e mais ${recent.length - 3}` : recent.join(', ')
  return `${names}: sincronizada${recent.length > 1 ? 's' : ''} há menos de 2 min, não precisa de novo.`
}
