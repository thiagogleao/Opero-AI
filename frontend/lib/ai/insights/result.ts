import { INSIGHTS_MAX_ITEMS } from '../config'
import { CONFIDENCES, INSIGHT_KINDS, TARGET_TYPES } from './prompt'

/**
 * Turning the model's JSON into cards the UI can trust.
 *
 * Structured outputs guarantee the shape, but not that a number is real. Each
 * evidence value is checked against the numbers printed on the fact sheet: a
 * value whose numbers are not on the sheet is kept but marked unverified, so
 * the screen can flag it instead of presenting it as fact.
 */

export type InsightKind = (typeof INSIGHT_KINDS)[number]
export type Confidence = (typeof CONFIDENCES)[number]
export type TargetType = (typeof TARGET_TYPES)[number]

export interface Evidence {
  label: string
  value: string
  /** True when every number in `value` is printed on the fact sheet. */
  verified: boolean
}

export interface InsightCard {
  kind: InsightKind
  title: string
  detail: string
  action: string | null
  confidence: Confidence
  /** The sample the claim rests on, in words ("312 pedidos", "$558 em 21 dias"). */
  sample: string
  evidence: Evidence[]
  target: { type: TargetType; id: string | null; name: string | null }
  /** False when any evidence value could not be matched to the fact sheet. */
  verified: boolean
}

export interface ParsedInsights {
  summary: string
  insights: InsightCard[]
  dataGaps: string[]
}

// ─── Numbers on the sheet ─────────────────────────────────────────────────────

export interface NumberIndex { has(key: string): boolean }

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g

/** Every number in a text, as absolute values with the decimals it was written with. */
function numbersIn(text: string): { value: number; decimals: number }[] {
  const out: { value: number; decimals: number }[] = []
  for (const m of text.replace(/\$/g, ' ').matchAll(NUM_RE)) {
    const raw = m[0].replace(/,/g, '')
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    const dot = raw.indexOf('.')
    out.push({ value, decimals: dot < 0 ? 0 : raw.length - dot - 1 })
  }
  return out
}

/** Index of the sheet's numbers at 0, 1 and 2 decimals, so "$558" matches a
 *  printed "$558.36" and "12%" matches "12.3%" — rounding a sheet number is
 *  allowed, inventing one is not. */
export function numberIndex(sheet: string): NumberIndex {
  const keys = new Set<string>()
  for (const { value } of numbersIn(sheet)) {
    for (const d of [0, 1, 2]) keys.add(value.toFixed(d))
  }
  return { has: k => keys.has(k) }
}

export function valueVerified(value: string, idx: NumberIndex): boolean {
  return numbersIn(value).every(n => idx.has(n.value.toFixed(Math.min(n.decimals, 2))))
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null

function card(raw: unknown, idx: NumberIndex): InsightCard | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = pick(r.kind, INSIGHT_KINDS)
  const title = text(r.title, 160)
  const detail = text(r.detail, 1200)
  const confidence = pick(r.confidence, CONFIDENCES) ?? 'baixa'
  if (!kind || !title || !detail) return null
  const evidence: Evidence[] = Array.isArray(r.evidence)
    ? r.evidence.flatMap(e => {
        if (!e || typeof e !== 'object') return []
        const label = text((e as Record<string, unknown>).label, 120)
        const value = text((e as Record<string, unknown>).value, 120)
        return label && value ? [{ label, value, verified: valueVerified(value, idx) }] : []
      }).slice(0, 8)
    : []
  const t = (r.target && typeof r.target === 'object' ? r.target : {}) as Record<string, unknown>
  return {
    kind, title, detail,
    action: text(r.action, 400),
    confidence,
    sample: text(r.sample, 160) ?? 'amostra não informada',
    evidence,
    target: { type: pick(t.type, TARGET_TYPES) ?? 'loja', id: text(t.id, 80), name: text(t.name, 200) },
    verified: evidence.every(e => e.verified),
  }
}

/** Null when the text is not the expected JSON object at all. */
export function parseInsights(json: string, idx: NumberIndex): ParsedInsights | null {
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return null }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const summary = text(r.summary, 800)
  if (!summary || !Array.isArray(r.insights)) return null
  return {
    summary,
    insights: r.insights.map(x => card(x, idx)).filter((x): x is InsightCard => x !== null).slice(0, INSIGHTS_MAX_ITEMS),
    dataGaps: Array.isArray(r.dataGaps)
      ? r.dataGaps.map(g => text(g, 300)).filter((g): g is string => g !== null).slice(0, 8)
      : [],
  }
}
