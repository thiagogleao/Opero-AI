/**
 * Every knob of the AI features in one place, so a model change or a limit
 * change is one edit and cannot drift between the Copilot and the insights.
 */

/** The insights are a one-shot analysis of a whole window: the strongest model. */
export const INSIGHTS_MODEL = 'claude-opus-5-5'
/** The Copilot answers many short questions with tool calls: fast and cheaper. */
export const CHAT_MODEL = 'claude-sonnet-5-5'

/** Opus 5.5 defaults to `medium`; the insights decide where money goes, so
 *  they get `high`. The Copilot's turns are lookups plus a short explanation
 *  over several tool calls, which is what `medium` is calibrated for. */
export const INSIGHTS_EFFORT = 'high' as const
export const CHAT_EFFORT = 'medium' as const

/** Thinking counts toward max_tokens, so these leave room for it. Both calls
 *  stream, so a large ceiling cannot hit an HTTP timeout. */
export const INSIGHTS_MAX_TOKENS = 32_000
export const CHAT_MAX_TOKENS = 32_000

/** Server-side refusal fallback (beta): on a policy decline the API re-runs
 *  the same request on a fallback model inside the same call. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Model calls in one Copilot turn (each tool round trip is one call). */
export const CHAT_MAX_MODEL_CALLS = 8
/** Re-issues of one call whose tool input arrived as unparseable JSON. */
export const CHAT_MAX_JSON_RETRIES = 2

/** What a client may send as conversation history. The history is plain text:
 *  tool calls and results never round-trip through the browser, so a client
 *  cannot plant a fake tool result, and an old turn cannot leave a tool_use
 *  without its result. */
export const CHAT_HISTORY = {
  maxMessages: 24,
  maxUserChars: 2_000,
  maxAssistantChars: 12_000,
  maxTotalChars: 60_000,
}

/** Partners split every store 50/50 with the owner. It halves money amounts
 *  only (profit, profit per order, cash result, refunds), never margins,
 *  ROAS or break-even. */
export const PARTNER_SHARE = 0.5

/** Insights for a closed window only change when a late sync or a refund
 *  lands, so six hours is fresh enough and saves an Opus call per page view. */
export const INSIGHTS_TTL_MS = 6 * 60 * 60 * 1000
export const INSIGHTS_CACHE_MAX_ENTRIES = 300
/** Bumped whenever the fact sheet or the prompt changes shape, so a cached
 *  result built from the old prompt is never served for the new one. */
export const INSIGHTS_PROMPT_VERSION = 2
/** The most cards a run may return; fewer (or none) is a valid answer. */
export const INSIGHTS_MAX_ITEMS = 6

/** Per viewer, sliding windows. Cached insights do not count. */
export const RATE_LIMITS = {
  chat: [
    { windowMs: 10 * 60_000, max: 20 },
    { windowMs: 24 * 60 * 60_000, max: 200 },
  ],
  insights: [
    { windowMs: 60 * 60_000, max: 8 },
    { windowMs: 24 * 60 * 60_000, max: 30 },
  ],
} as const

/** Longest window an insights run may cover; beyond this the daily series
 *  would be summarised away anyway. */
export const INSIGHTS_MAX_DAYS = 120
