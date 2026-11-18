/**
 * What a collector's error means, in words, and whether it still matters.
 *
 * sync_runs.error_message holds whatever the collector caught. Until the v2
 * collector is deployed that is raw English ("Internal Server Error", a whole
 * FacebookRequestError dump, a Shopify response with every header); after it,
 * short Portuguese sentences ("Token da Shopify recusado (HTTP 401) — …").
 * Ajustes used to quote the raw text in red next to a green "funcionando",
 * even when the next collection had already worked. Here:
 *  - sanitizeError: one safe line to quote (credentials stripped; for a
 *    request dump, the HTTP status and the provider's own message);
 *  - describeSyncError: the known errors of both formats, in Portuguese;
 *  - summarizeRuns: count, last error and whether a later success settled it.
 *
 * Pure (no server imports): safe in client components and unit tests.
 */

export type SyncSource = 'shopify' | 'facebook'

/** One sync_runs row, newest first in every list below. */
export interface SyncRun {
  status: string
  /** ISO-8601 UTC. */
  at: string
  error_message: string | null
  /** sync_runs.account_id once the v2 migration adds it; null before. */
  account_id: string | null
}

export interface RunSummary {
  /** Latest run's status and time. */
  status: string
  at: string
  /** Last success in the window read (7 days). */
  lastSuccessAt: string | null
  /** Error runs in the last 24 h. */
  errors24h: number
  /** Short, sanitized text of the latest error in the last 24 h (to quote). */
  lastError: string | null
  /** The same error in Portuguese, when it is a known one; else null. */
  lastErrorText: string | null
  lastErrorAt: string | null
  /** Every error of the last 24 h was followed by a successful collection. */
  errorsResolved: boolean
}

const scrub = (s: string) => s
  .replace(/EA[A-Za-z0-9]{20,}/g, '[token]')
  .replace(/shp(at|ca|pa|ss|ua)_[A-Za-z0-9]+/g, '[token]')
  .replace(/access_token=[^&\s'"]+/gi, 'access_token=[token]')
  .replace(/client_secret=[^&\s'"]+/gi, 'client_secret=[secret]')

/** The HTTP status a collector error carries, in any of the formats seen. */
function httpStatus(t: string): number | null {
  const m = /Status:\s*(\d{3})\b/.exec(t)          // FacebookRequestError dump
    ?? /Response\(code=(\d{3})\b/.exec(t)          // Shopify client (old collector)
    ?? /\bHTTP (\d{3})\b/.exec(t)                  // v2 collector sentences
    ?? /\b(\d{3}) (?:Client|Server) Error\b/.exec(t) // requests' HTTPError
  return m ? Number(m[1]) : null
}

/** The provider's own message inside a dump: Graph's error.message, Shopify's "errors" string. */
function providerMessage(t: string): string | null {
  const m = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(t) ?? /"errors":\s*"((?:[^"\\]|\\.)*)"/.exec(t)
  return m ? m[1].replace(/\\"/g, '"').trim() || null : null
}

/** Graph API error code: from the dump's JSON or the v2 "Meta (code): …" text. */
function graphCode(t: string): number | null {
  const m = /"code":\s*(\d+)/.exec(t) ?? /\bMeta \((\d+)\)/.exec(t)
  return m ? Number(m[1]) : null
}

/** Strip anything credential-shaped and keep one useful line to quote. */
export function sanitizeError(msg: string | null | undefined): string | null {
  if (!msg) return null
  const provider = providerMessage(msg)
  let line: string
  if (provider) {
    const status = httpStatus(msg)
    line = status ? `HTTP ${status} · ${provider}` : provider
  } else {
    const m = /Message:\s*(.+)/.exec(msg)
    line = (m ? m[1] : msg).trim().split('\n')[0]
  }
  return scrub(line).slice(0, 200) || null
}

// Meta's throttling codes (app, user, page, calls, ads insights) — the same
// set the collector retries.
const GRAPH_THROTTLE = new Set([4, 17, 32, 613, ...Array.from({ length: 15 }, (_, i) => 80000 + i)])

/**
 * A known collector error in Portuguese, written to follow "· " on screen
 * (lower-case start), saying what happened — never what to do, since the
 * screen may be showing an error that a later collection already settled.
 * Unknown errors give null: the screen quotes sanitizeError instead.
 */
export function describeSyncError(raw: string | null | undefined, source: SyncSource): string | null {
  if (!raw) return null
  const t = raw
  const status = httpStatus(t)
  const who = source === 'shopify' ? 'a Shopify' : 'o Meta'

  if (/Connection (?:aborted|reset|refused)|ConnectionResetError|ConnectionError|RemoteDisconnected|ECONNRESET/i.test(t)) {
    return `a conexão com ${who} caiu no meio da coleta`
  }
  if (/\btimed? ?out\b|Timeout/i.test(t)) return `${who} demorou demais para responder`

  if (source === 'facebook') {
    const code = graphCode(t)
    if (/appsecret_proof/i.test(t)) return 'o Meta recusou o token: ele foi emitido por outro app (appsecret_proof inválido)'
    if (code === 190 || /Error validating access token|Session has expired|Token do Meta expirado/i.test(t)) {
      return 'o token do Meta expirou ou foi revogado'
    }
    if ((code !== null && GRAPH_THROTTLE.has(code)) || /request limit|Limite de chamadas/i.test(t)) {
      return 'o Meta limitou as chamadas por um tempo'
    }
    if ((code !== null && (code === 10 || (code >= 200 && code < 300))) || /Sem permissão/i.test(t)) {
      return 'o token não tem permissão nesta conta de anúncio'
    }
    if (code === 1 || code === 2 || (status !== null && status >= 500)
      || /unknown error|temporarily unavailable|unexpected error/i.test(t)) {
      return `o Meta falhou do lado dele, um erro temporário${status ? ` (HTTP ${status})` : ''}`
    }
    if (/Bad data to set object data/i.test(t)) return 'o Meta devolveu dados num formato inesperado'
    return null
  }

  if (/sem cota[cç][aã]o/i.test(t)) return 'pedidos em moeda estrangeira sem cotação: não foram gravados, para não entrarem como dólar'
  if (/renova[cç][aã]o falhou/i.test(t)) return 'a renovação do token de 24 h falhou'
  if (status === 401 || /Invalid API key or access token|Token da Shopify recusado/i.test(t)) return 'a Shopify recusou a chave (HTTP 401)'
  if (status === 402 || /Unavailable Shop|Loja indisponível/i.test(t)) return 'a loja está suspensa ou sem plano na Shopify (HTTP 402)'
  if (status === 403) return 'a Shopify negou o acesso (HTTP 403)'
  if (status === 404) return 'a Shopify não encontrou a loja (HTTP 404)'
  if (status === 429 || /calls per second|Too Many Requests/i.test(t)) return 'a Shopify limitou as chamadas por um momento (HTTP 429)'
  if (status === 500 || /^Internal Server Error\b/i.test(t.trim())) return 'a Shopify respondeu com erro interno (HTTP 500)'
  if ((status !== null && status >= 502 && status <= 504) || /Bad Gateway|Service Unavailable|Gateway Time-?out/i.test(t)) {
    return `a Shopify ficou fora do ar por um momento${status ? ` (HTTP ${status})` : ''}`
  }
  return null
}

/** Status, 24 h errors and whether they were settled, for one lane of runs (newest first). */
export function summarizeRuns(runs: SyncRun[], source: SyncSource, now: number = Date.now()): RunSummary | null {
  if (runs.length === 0) return null
  const dayAgo = now - 86_400_000
  const lastSuccess = runs.find(r => r.status === 'success') ?? null
  const errors = runs.filter(r => r.status === 'error' && Date.parse(r.at) > dayAgo)
  const last = errors[0] ?? null
  return {
    status: runs[0].status,
    at: runs[0].at,
    lastSuccessAt: lastSuccess?.at ?? null,
    errors24h: errors.length,
    lastError: sanitizeError(last?.error_message),
    lastErrorText: describeSyncError(last?.error_message, source),
    lastErrorAt: last?.at ?? null,
    errorsResolved: !!last && !!lastSuccess && Date.parse(lastSuccess.at) > Date.parse(last.at),
  }
}

/**
 * The runs that belong to one ad account of a store. The Meta collector runs
 * once per account, but before the v2 migration sync_runs has no account_id:
 * an error is then attributed by the account id its text names, and a
 * success (which names nothing) only when the store has a single account —
 * otherwise it could be another account's, and an error is never called
 * settled on someone else's success.
 */
export function accountRuns(runs: SyncRun[], accountId: string, accountCount: number): SyncRun[] {
  if (runs.some(r => r.account_id)) {
    return runs.filter(r => r.account_id === accountId || (!r.account_id && !!r.error_message?.includes(accountId)))
  }
  if (accountCount === 1) return runs
  return runs.filter(r => r.status !== 'success' && !!r.error_message?.includes(accountId))
}
