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

const listNames = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}` : names.join(', '))

/** What a refresh skipped, in words ("MOKOO: sincronizada há menos de 2 min…"). */
export function skippedText(skipped: RefreshResponse['skipped']): string | null {
  const names = (reason: RefreshResponse['skipped'][number]['reason']) => [...new Set(skipped.filter(s => s.reason === reason).map(s => s.name))]
  const recent = names('recente')
  const running = names('em_andamento').filter(n => !recent.includes(n))
  const out: string[] = []
  if (recent.length) out.push(`${listNames(recent)}: sincronizada${recent.length > 1 ? 's' : ''} há menos de 2 min, não precisa de novo.`)
  if (running.length) out.push(`${listNames(running)}: já ${running.length > 1 ? 'estão' : 'está'} sincronizando agora.`)
  return out.length ? out.join(' ') : null
}

export interface RefreshOutcome {
  tone: 'ok' | 'warn'
  text: string
  /** Only a refresh that really finished, without failures, may vanish by itself. */
  autoDismiss: boolean
}

/**
 * The closing sentence of a refresh. "atualizada · números recarregados" only
 * when every launched run finished; when the phone stopped watching first
 * (`gaveUpAfterMin`), it says how far the runs got, so a server that never
 * started the collectors is not reported as a successful refresh.
 */
export function refreshOutcome(p: RefreshProgress, storeNames: string, storeCount: number, gaveUpAfterMin: number | null): RefreshOutcome {
  const failedText = p.failed.length
    ? `Falhou: ${p.failed.map(l => `${l.name} (${SOURCE_LABEL[l.source]})`).join(', ')}.`
    : ''
  if (!p.finished && gaveUpAfterMin !== null && p.total > 0) {
    const started = p.lines.filter(l => l.state !== 'fila').length
    if (started === 0) {
      return {
        tone: 'warn', autoDismiss: false,
        text: `${p.total === 1 ? 'A busca não começou' : `0 de ${p.total} buscas começaram`} em ${gaveUpAfterMin} min: os números não foram atualizados.`,
      }
    }
    const left = p.total - p.done
    return {
      tone: 'warn', autoDismiss: false,
      text: [`${p.done} de ${p.total} ${p.total === 1 ? 'busca concluída' : 'buscas concluídas'} em ${gaveUpAfterMin} min; ${left === 1 ? 'a outra ainda roda' : `${left} ainda rodam`} em segundo plano e os números podem mudar.`, failedText].filter(Boolean).join(' '),
    }
  }
  if (p.failed.length) {
    return { tone: 'warn', autoDismiss: false, text: `Atualizado, com falha em: ${p.failed.map(l => `${l.name} (${SOURCE_LABEL[l.source]})`).join(', ')}. Os números dessas lojas podem estar atrasados.` }
  }
  return { tone: 'ok', autoDismiss: true, text: `${storeNames} ${storeCount === 1 ? 'atualizada' : 'atualizadas'} · números recarregados.` }
}

// ─── Watching the runs ────────────────────────────────────────────────────────

/** Collectors are killed after 10 min; the phone stops watching a little before. */
export const STATUS_GIVE_UP_MS = 8 * 60_000
/** Progress reads that fail in a row (a 500 from a statement timeout, say)
 *  before the phone stops watching. ~20 s at one read every 4 s. */
export const STATUS_MAX_FAILURES = 5

/** How a progress read failed (useMobileData errorOf: 'session' is the auth
 *  guard's plain 404, 'store' a JSON 404 for a store that is gone). */
export type StatusFailureKind = 'session' | 'store' | 'bad' | 'server'

export type WatchStep =
  /** Read again in a few seconds. */
  | { do: 'wait' }
  /** Out of time: close as the timeout after a good read does (gaveUpAfterMin). */
  | { do: 'giveUp' }
  /** Stop watching with this message; `retryable` when tapping again can help. */
  | { do: 'fail'; message: string; retryable: boolean }

/**
 * What the "Atualizar" watcher does after a failed progress read. A failed read
 * used to `continue` before the time check, so a status GET that kept failing
 * (cookie gone after "sair" on the desktop, a store archived meanwhile, a 500)
 * spun forever with the button disabled and the strip impossible to close.
 * Elapsed time is now judged whatever the read returned; a lost session or a
 * store that is gone stops at once with its own words, since asking again
 * cannot answer differently. Pure.
 */
export function afterFailedStatus(
  kind: StatusFailureKind, message: string, consecutiveFailures: number, elapsedMs: number,
): WatchStep {
  const keepsRunning = 'As buscas já pedidas continuam no servidor'
  if (kind === 'session') {
    return { do: 'fail', retryable: false, message: `a sessão deste aparelho expirou e o progresso não pode mais ser lido. ${keepsRunning}; abra o link de acesso de novo para ver os números` }
  }
  if (kind === 'store') {
    return { do: 'fail', retryable: false, message: `${message}: uma das lojas na tela não está mais disponível. ${keepsRunning}; recarregue a tela` }
  }
  if (elapsedMs > STATUS_GIVE_UP_MS) return { do: 'giveUp' }
  if (consecutiveFailures >= STATUS_MAX_FAILURES) {
    return { do: 'fail', retryable: true, message: `o progresso falhou ${consecutiveFailures} vezes seguidas (${message}). ${keepsRunning} e os números atualizam sozinhos a cada 45 s` }
  }
  return { do: 'wait' }
}
