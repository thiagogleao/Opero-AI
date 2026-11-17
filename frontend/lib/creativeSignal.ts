/**
 * The verdict on a single ad: one definition for every surface (dashboard
 * table, phone, AI prompt, creative page). When the dashboard table kept its
 * own rules an ad could read "Desligar" on the desktop and "scale" on the
 * phone; the thresholds live here and nowhere else.
 *
 * An ad is judged on ROAS against the store's contribution break-even — the
 * same break-even the campaigns use (engine breakEvenRoas = revenue ÷
 * contribution; Shop Campaigns and fixed costs left out). Pure functions, safe
 * for client components.
 *
 * Two signals the old version used are gone because the stored data cannot
 * support them:
 *  - Hook rate. The collector stores Meta's video_play_actions, which counts
 *    every play start (autoplay included), not 3-second views. plays ÷
 *    impressions is ~85–97% for every real video and a fraction of a percent
 *    for image ads with stray plays, so "hook < 25%" flagged image ads as weak
 *    videos. Hook rate is reported as null until 3-second views are collected.
 *  - Fatigue by frequency. Meta reports reach per day, and reach does not add
 *    up across days: impressions ÷ Σ daily reach is the average DAILY
 *    frequency (~1.1–1.3 for every store), never the frequency over a period,
 *    so a 3.5 threshold only fired on junk rows. Refresh fires only when a real
 *    period frequency is supplied (today: single-day windows).
 */

export type Signal = 'kill' | 'scale' | 'refresh' | 'ok'

export interface CreativeVerdictInput {
  spend: number
  /** Meta purchase value ÷ spend, phantom ad-days removed; null without spend. */
  roas: number | null
  purchases: number
  /** The store's contribution break-even ROAS (engine breakEvenRoas); null
   *  when costs are not configured or no ROAS breaks even. */
  breakEven: number | null
  /** False when the store has no cost settings (changes the reason only). */
  costsConfigured?: boolean
  /** Impressions ÷ unique reach over the whole window; null when not known
   *  (any multi-day window — see the header). Never the average daily figure. */
  frequency: number | null
  /** Paused ads (or ads of paused campaigns) get no recommendation. */
  running: boolean
  /** Set when the ad's campaign may be another store's (shared ad account):
   *  the sentence to show instead of a verdict. */
  sharedNote?: string | null
}

export interface CreativeVerdict {
  /** Null when no recommendation applies (no spend, paused, shared account,
   *  no cost settings or no break-even). */
  signal: Signal | null
  reason: string
}

/** Below 80% of break-even with real money spent: money burning right now. */
const KILL_SPEND_FLOOR = 50
const KILL_ROAS_FACTOR = 0.8
/** 40% above break-even, with enough spend and sales to trust it — one sale
 *  on $30 is a coin toss, not a winner. */
const SCALE_SPEND_FLOOR = 30
const SCALE_ROAS_FACTOR = 1.4
const SCALE_MIN_PURCHASES = 3
/** Period frequency above this: the audience has seen the ad too often. */
const FATIGUE_FREQUENCY = 3.5

const x2 = (n: number) => `${n.toFixed(2)}x`

export function creativeVerdict(a: CreativeVerdictInput): CreativeVerdict {
  const spend = Math.max(0, Number(a.spend) || 0)
  if (spend <= 0 || a.roas === null) return { signal: null, reason: 'Sem gasto no período' }
  if (!a.running) return { signal: null, reason: 'Pausado — sem recomendação' }
  if (a.sharedNote) return { signal: null, reason: a.sharedNote }
  if (a.breakEven === null || !(a.breakEven > 0)) {
    return { signal: null, reason: a.costsConfigured === false
      ? 'Custos da loja não configurados — sem ponto de empate para comparar'
      : 'Sem ponto de empate no período: a loja não vendeu, ou cada venda já perde dinheiro antes do anúncio' }
  }
  const be = a.breakEven
  if (spend >= KILL_SPEND_FLOOR && a.roas < be * KILL_ROAS_FACTOR) {
    return { signal: 'kill', reason: `ROAS ${x2(a.roas)} com $${spend.toFixed(0)} gastos — abaixo de 80% do empate (${x2(be)})` }
  }
  if (spend >= SCALE_SPEND_FLOOR && a.purchases >= SCALE_MIN_PURCHASES && a.roas >= be * SCALE_ROAS_FACTOR) {
    return { signal: 'scale', reason: `ROAS ${x2(a.roas)} — 40% ou mais acima do empate (${x2(be)}) com ${a.purchases.toFixed(0)} vendas` }
  }
  if (a.frequency !== null && a.frequency > FATIGUE_FREQUENCY) {
    return { signal: 'refresh', reason: `Frequência ${a.frequency.toFixed(1)} no período — o público já viu demais` }
  }
  if (a.roas >= be) return { signal: 'ok', reason: `Acima do empate (${x2(be)})` }
  return {
    signal: 'ok',
    reason: spend >= KILL_SPEND_FLOOR
      ? `Abaixo do empate (${x2(be)}), mas acima da linha de corte (${x2(be * KILL_ROAS_FACTOR)})`
      : `Abaixo do empate (${x2(be)}), ainda com pouco gasto para cortar ($${spend.toFixed(0)} de $${KILL_SPEND_FLOOR})`,
  }
}

/** Ordering for a list that should lead with what needs a decision. */
export const SIGNAL_RANK: Record<Signal, number> = { kill: 0, scale: 1, refresh: 2, ok: 3 }

export function signalRank(s: Signal | null): number {
  return s === null ? 4 : SIGNAL_RANK[s]
}

export const SIGNAL_LABEL: Record<Signal, string> = {
  kill: 'Desligar', scale: 'Escalar', refresh: 'Trocar criativo', ok: 'OK',
}

/** Why hook rate is null everywhere, for a tooltip. */
export const HOOK_RATE_UNAVAILABLE =
  'Hook rate é visualizações de 3 segundos ÷ impressões. O coletor guarda só o início de reprodução (o autoplay conta), então o número não pode ser calculado.'

/** Why a multi-day frequency is null, for a tooltip. */
export const FREQUENCY_UNAVAILABLE =
  'O Meta entrega o alcance por dia, e alcance não se soma entre dias. A frequência do período precisa do alcance do período inteiro, que não é coletado.'

/**
 * Is this a video ad? creative_type is empty on every stored ad, so it is read
 * from the plays: real videos start playing on most impressions (85–97%),
 * image ads only get stray plays (MOKOO: 2–31 plays on 11k–118k impressions).
 */
export function isVideoAd(videoPlays: number, impressions: number): boolean {
  return impressions > 0 && videoPlays / impressions >= 0.05
}

// ─── Legacy surface ───────────────────────────────────────────────────────────

/** @deprecated Use CreativeVerdictInput / creativeVerdict. */
export interface SignalInput {
  spend: number
  roas: number
  frequency: number
  hookRate: number | null
  breakEven: number
}

/**
 * @deprecated Use creativeVerdict. Kept for app/page.tsx and
 * app/api/mobile/detail/route.ts. The frequency and hook-rate arguments are
 * ignored: every caller passes impressions ÷ Σ daily reach and plays ÷
 * impressions, which are not frequency and hook rate (see the header).
 */
export function creativeSignal(a: SignalInput): Signal {
  const spend = Number(a.spend) || 0
  // profitCalc reports breakEvenRoas 0 when no ROAS breaks even (configured
  // store with no sales, or every sale losing money before ads); against 0
  // every ad with $30 spent would read "scale".
  if (!(a.breakEven > 0)) return 'ok'
  if (spend >= KILL_SPEND_FLOOR && a.roas < a.breakEven * KILL_ROAS_FACTOR) return 'kill'
  if (a.roas >= a.breakEven * SCALE_ROAS_FACTOR && spend >= SCALE_SPEND_FLOOR) return 'scale'
  return 'ok'
}

/** @deprecated A store without cost settings gets no ad verdict (creativeVerdict
 *  returns null); this fallback only feeds the legacy callers. */
export const FALLBACK_BREAK_EVEN = 1.5
