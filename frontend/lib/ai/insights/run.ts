import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { INSIGHTS_EFFORT, INSIGHTS_MAX_TOKENS, INSIGHTS_MODEL } from '../config'
import { logUsage, messageText, type AiErrorCode, type OpenStream } from '../claude'
import type { Send } from '../sse'
import type { InsightsWindow } from '../window'
import { factSheetText, type InsightsFacts } from './facts'
import { INSIGHTS_SCHEMA, insightsSystemPrompt, insightsUserMessage } from './prompt'
import { numberIndex, parseInsights, type InsightCard } from './result'

// ─── Contract (GET and POST /api/ai) ──────────────────────────────────────────

export interface InsightsWindowInfo {
  from: string
  to: string
  /** "18 out – 16 nov". */
  label: string
  days: number
  /** The requested period ran into today and was cut at yesterday. */
  cutAtYesterday: boolean
  /** The requested period was longer than the maximum and was shortened. */
  shortened: boolean
}

/** The engine's headline numbers the cards were written from, for the header
 *  of the panel. Whole-store money; `partnerProfit` only with the split. */
export interface InsightsHeadline {
  configured: boolean
  revenue: number | null
  orders: number
  operatingProfit: number | null
  partnerProfit: number | null
  margin: number | null
  metaSpend: number | null
  shopSpend: number | null
  roas: number | null
  metaRoas: number | null
  breakEvenRoas: number | null
}

export interface InsightsResult {
  storeId: string
  storeName: string
  window: InsightsWindowInfo
  split: boolean
  model: string
  generatedAt: string
  expiresAt: string
  headline: InsightsHeadline
  summary: string
  /** 0 to 6 cards, most money at stake first. */
  insights: InsightCard[]
  dataGaps: string[]
}

export type InsightsErrorCode = AiErrorCode | 'refused' | 'truncated' | 'invalid_output' | 'no_closed_days'

export type InsightsEvent =
  | { type: 'start'; store: { id: string; name: string }; window: InsightsWindowInfo; split: boolean; model: string }
  /** reading = building the fact sheet; thinking/writing = the model's phases;
   *  waiting = another request is already generating this same analysis. */
  | { type: 'status'; phase: 'reading' | 'thinking' | 'writing' | 'waiting' }
  /** Raw JSON as the model writes it: progress only, not for display. */
  | { type: 'delta'; text: string }
  | { type: 'done'; result: InsightsResult; cached: boolean }
  | { type: 'error'; code: InsightsErrorCode; message: string }

export class InsightsFailure extends Error {
  constructor(public code: InsightsErrorCode, message: string) { super(message) }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

export function windowInfo(w: InsightsWindow): InsightsWindowInfo {
  return { from: w.from, to: w.to, label: w.label, days: w.days, cutAtYesterday: w.cutAtYesterday, shortened: w.shortened }
}

export function headlineOf(f: InsightsFacts): InsightsHeadline {
  const t = f.totals
  return {
    configured: f.configured, revenue: t.revenue, orders: t.orders, operatingProfit: t.operatingProfit,
    partnerProfit: f.partnerShare ? f.partnerShare.operatingProfit : null,
    margin: t.margin, metaSpend: t.metaSpend, shopSpend: t.shopSpend, roas: t.roas, metaRoas: t.metaRoas,
    breakEvenRoas: f.configured ? t.breakEvenRoas : null,
  }
}

/** Everything sent to the model, built from the facts alone. Exposed so the
 *  dry run can show exactly what the model would read. */
export function insightsRequest(f: InsightsFacts) {
  const sheet = factSheetText(f)
  return {
    sheet,
    params: {
      model: INSIGHTS_MODEL,
      max_tokens: INSIGHTS_MAX_TOKENS,
      system: insightsSystemPrompt(f.split),
      messages: [{ role: 'user' as const, content: insightsUserMessage(sheet) }],
      thinking: { type: 'adaptive' as const },
      output_config: { effort: INSIGHTS_EFFORT, format: { type: 'json_schema' as const, schema: INSIGHTS_SCHEMA } },
    },
  }
}

/**
 * One Opus call over the fact sheet, streamed. Resolves with the validated
 * result; throws InsightsFailure for a refusal, a cut-off answer or unusable
 * output (none of which is ever cached), and the SDK's own errors otherwise.
 */
export async function generateInsights(
  f: InsightsFacts, send: Send<InsightsEvent>, signal: AbortSignal, open: OpenStream,
  opts: { viewerKey: string; ttlMs: number; now?: Date },
): Promise<InsightsResult> {
  const { sheet, params } = insightsRequest(f)
  const startedAt = Date.now()
  const stream = open(params, signal)
  let phase: 'thinking' | 'writing' | null = null
  stream.onBlockStart(type => {
    const next = type === 'text' ? 'writing' : type === 'thinking' || type === 'redacted_thinking' ? 'thinking' : null
    if (next && next !== phase) { phase = next; send({ type: 'status', phase: next }) }
  })
  stream.onText(delta => send({ type: 'delta', text: delta }))
  const msg: BetaMessage = await stream.finalMessage()
  logUsage('insights', opts.viewerKey, f.ctx.id, msg, startedAt)

  if (msg.stop_reason === 'refusal') {
    throw new InsightsFailure('refused', 'A IA não conseguiu analisar este período. Tente outro período ou tente de novo mais tarde.')
  }
  if (msg.stop_reason === 'max_tokens') {
    throw new InsightsFailure('truncated', 'A análise ficou longa demais e foi cortada. Tente um período menor.')
  }
  const parsed = parseInsights(messageText(msg.content), numberIndex(sheet))
  if (!parsed) {
    console.error('[ai.insights] resposta fora do formato', msg.stop_reason, messageText(msg.content).slice(0, 300))
    throw new InsightsFailure('invalid_output', 'A IA devolveu uma resposta fora do formato. Tente de novo.')
  }
  const now = opts.now ?? new Date()
  return {
    storeId: f.ctx.id,
    storeName: f.ctx.name,
    window: windowInfo(f.window),
    split: f.split,
    model: msg.model,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + opts.ttlMs).toISOString(),
    headline: headlineOf(f),
    summary: parsed.summary,
    insights: parsed.insights,
    dataGaps: parsed.dataGaps,
  }
}

