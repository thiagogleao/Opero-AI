import { describe, expect, it } from 'vitest'
import { accountRuns, describeSyncError, sanitizeError, summarizeRuns, type SyncRun } from '../syncErrors'

// Shapes copied from production sync_runs (2026-11), tokens and ids replaced.
const FB_APPSECRET = `

  Message: Call was not successful
  Method:  GET
  Path:    https://graph.facebook.com/v20.0/act_111/insights
  Params:  {'level': 'ad', 'limit': 500}

  Status:  400
  Response:
    {
      "error": {
        "message": "Invalid appsecret_proof provided in the API argument",
        "type": "GraphMethodException",
        "code": 100,
        "fbtrace_id": "Axyz"
      }
    }
`
const FB_UNKNOWN_500 = FB_APPSECRET
  .replace('Status:  400', 'Status:  500')
  .replace('Invalid appsecret_proof provided in the API argument', 'An unknown error occurred')
  .replace('"code": 100', '"code": 1')
const FB_LIMIT = FB_APPSECRET
  .replace('Status:  400', 'Status:  403')
  .replace('Invalid appsecret_proof provided in the API argument', 'Application request limit reached')
  .replace('"code": 100', '"code": 4')
const SHOP_402 = `Response(code=402, body="b'{"errors":"Unavailable Shop"}'", headers={'Date': 'Wed, 18 Nov 2026 11:10:23 GMT', 'Content-Type': 'application/json; charset=utf-8', 'x-shopify-shop-api-call-limit': '3/40'})`
const SHOP_401 = `Response(code=401, body="b'{"errors":"[API] Invalid API key or access token (unrecognized login or wrong password)"}'", headers={'Date': 'Mon, 16 Nov 2026 08:03:17 GMT'})`
const SHOP_429 = `Response(code=429, body="b'{"errors":"Exceeded 2 calls per second for api client. Reduce request rates to resume uninterrupted service."}'", headers={})`

describe('describeSyncError — known errors in Portuguese', () => {
  it('words the Shopify errors seen in production', () => {
    expect(describeSyncError('Internal Server Error', 'shopify')).toBe('a Shopify respondeu com erro interno (HTTP 500)')
    expect(describeSyncError(SHOP_402, 'shopify')).toBe('a loja está suspensa ou sem plano na Shopify (HTTP 402)')
    expect(describeSyncError(SHOP_401, 'shopify')).toBe('a Shopify recusou a chave (HTTP 401)')
    expect(describeSyncError(SHOP_429, 'shopify')).toBe('a Shopify limitou as chamadas por um momento (HTTP 429)')
    expect(describeSyncError('[shopify] 9 pedido(s) em JPY sem cotacao aplicada. Nao vou gravar', 'shopify'))
      .toBe('pedidos em moeda estrangeira sem cotação: não foram gravados, para não entrarem como dólar')
    expect(describeSyncError('HTTPError: 503 Server Error: Service Unavailable for url: https://x.myshopify.com/admin', 'shopify'))
      .toBe('a Shopify ficou fora do ar por um momento (HTTP 503)')
  })

  it('words the Meta errors seen in production', () => {
    expect(describeSyncError(FB_APPSECRET, 'facebook')).toBe('o Meta recusou o token: ele foi emitido por outro app (appsecret_proof inválido)')
    expect(describeSyncError(FB_UNKNOWN_500, 'facebook')).toBe('o Meta falhou do lado dele, um erro temporário (HTTP 500)')
    expect(describeSyncError(FB_LIMIT, 'facebook')).toBe('o Meta limitou as chamadas por um tempo')
    expect(describeSyncError("('Connection aborted.', ConnectionResetError(104, 'Connection reset by peer'))", 'facebook'))
      .toBe('a conexão com o Meta caiu no meio da coleta')
    expect(describeSyncError('Bad data to set object data', 'facebook')).toBe('o Meta devolveu dados num formato inesperado')
  })

  it('also reads the v2 collector\'s Portuguese sentences', () => {
    expect(describeSyncError('Token da Shopify recusado (HTTP 401) — reconecte a loja', 'shopify')).toBe('a Shopify recusou a chave (HTTP 401)')
    expect(describeSyncError('Loja indisponível na Shopify (HTTP 402) — suspensa ou fechada', 'shopify')).toBe('a loja está suspensa ou sem plano na Shopify (HTTP 402)')
    expect(describeSyncError('Token do Meta emitido por outro app (appsecret_proof inválido) — reconecte a conta', 'facebook'))
      .toBe('o Meta recusou o token: ele foi emitido por outro app (appsecret_proof inválido)')
    expect(describeSyncError('Limite de chamadas do Meta atingido — a próxima rodada tenta de novo', 'facebook')).toBe('o Meta limitou as chamadas por um tempo')
    expect(describeSyncError('Meta (190): Error validating access token', 'facebook')).toBe('o token do Meta expirou ou foi revogado')
  })

  it('gives null for what it does not know (the screen quotes it instead)', () => {
    expect(describeSyncError('KeyError: total_price', 'shopify')).toBeNull()
    expect(describeSyncError(null, 'facebook')).toBeNull()
  })
})

describe('sanitizeError — one safe line to quote', () => {
  it('keeps the message line and strips credentials', () => {
    const raw = "\n\n  Message: Call was not successful\n  Method:  GET\n  Path:    https://graph.facebook.com/v20.0/act_1/insights?access_token=EAAB123"
    expect(sanitizeError(raw)).toBe('Call was not successful')
    expect(sanitizeError('bad token EAABwzLixnjYBO1234567890abcdefghij here')).toBe('bad token [token] here')
  })

  it('quotes the provider\'s own message and status instead of a whole dump', () => {
    expect(sanitizeError(FB_APPSECRET)).toBe('HTTP 400 · Invalid appsecret_proof provided in the API argument')
    expect(sanitizeError(SHOP_402)).toBe('HTTP 402 · Unavailable Shop')
  })
})

const run = (status: string, at: string, error_message: string | null = null, account_id: string | null = null): SyncRun =>
  ({ status, at, error_message, account_id })
const NOW = Date.parse('2026-11-18T12:00:00Z')

describe('summarizeRuns — are the errors still standing?', () => {
  it('a success after the error settles it (the MOKOO case: one 500 at night, fine since)', () => {
    const s = summarizeRuns([
      run('success', '2026-11-18T11:50:00.000Z'),
      run('success', '2026-11-18T03:30:00.000Z'),
      run('error', '2026-11-18T02:54:00.000Z', 'Internal Server Error'),
      run('success', '2026-11-18T02:20:00.000Z'),
    ], 'shopify', NOW)!
    expect(s.errors24h).toBe(1)
    expect(s.errorsResolved).toBe(true)
    expect(s.lastErrorText).toBe('a Shopify respondeu com erro interno (HTTP 500)')
    expect(s.lastErrorAt).toBe('2026-11-18T02:54:00.000Z')
  })

  it('an error as the latest run is not settled', () => {
    const s = summarizeRuns([
      run('error', '2026-11-18T11:10:00.000Z', SHOP_402),
      run('success', '2026-11-17T09:00:00.000Z'),
    ], 'shopify', NOW)!
    expect(s.status).toBe('error')
    expect(s.errorsResolved).toBe(false)
    expect(s.lastError).toBe('HTTP 402 · Unavailable Shop')
  })

  it('errors older than 24 h are not counted', () => {
    const s = summarizeRuns([run('success', '2026-11-18T11:00:00.000Z'), run('error', '2026-11-16T11:00:00.000Z', 'x')], 'shopify', NOW)!
    expect(s.errors24h).toBe(0)
    expect(s.lastError).toBeNull()
    expect(s.errorsResolved).toBe(false)
  })

  it('no runs → null', () => {
    expect(summarizeRuns([], 'facebook', NOW)).toBeNull()
  })
})

describe('accountRuns — which runs are this ad account\'s', () => {
  const runs = [
    run('success', '2026-11-18T11:30:00.000Z'),
    run('error', '2026-11-18T11:00:00.000Z', FB_APPSECRET),
    run('error', '2026-11-18T10:30:00.000Z', "('Connection aborted.', ConnectionResetError(104, 'Connection reset by peer'))"),
  ]

  it('a single collected account owns every run of the store', () => {
    const s = summarizeRuns(accountRuns(runs, 'act_111', 1), 'facebook', NOW)!
    expect(s.errors24h).toBe(2)
    expect(s.errorsResolved).toBe(true)
  })

  it('with several accounts and no account_id, a success cannot be credited to anyone', () => {
    const mine = summarizeRuns(accountRuns(runs, 'act_111', 2), 'facebook', NOW)!
    expect(mine.errors24h).toBe(1)
    expect(mine.errorsResolved).toBe(false)
    expect(summarizeRuns(accountRuns(runs, 'act_222', 2), 'facebook', NOW)).toBeNull()
  })

  it('with account_id (v2 migration), each account\'s own success settles its own errors', () => {
    const tagged = [
      run('success', '2026-11-18T11:30:00.000Z', null, 'act_222'),
      run('error', '2026-11-18T11:00:00.000Z', 'Meta (2): x', 'act_111'),
      run('success', '2026-11-18T10:00:00.000Z', null, 'act_111'),
    ]
    expect(summarizeRuns(accountRuns(tagged, 'act_111', 2), 'facebook', NOW)!.errorsResolved).toBe(false)
    expect(summarizeRuns(accountRuns(tagged, 'act_222', 2), 'facebook', NOW)!.errors24h).toBe(0)
  })
})
