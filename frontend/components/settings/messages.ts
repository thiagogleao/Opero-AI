/**
 * Portuguese texts for the codes the integration routes return (JSON `code`,
 * or `shopify_error` / `fb_error` when an OAuth flow comes back to a page), and
 * a small fetch helper that never claims success the server did not confirm.
 * No server imports: safe in client components.
 */

/** Where the Facebook picker returns after linking: set by onboarding before
 *  it starts the OAuth, else Ajustes. A hint only — the store comes from the server. */
export const FB_RETURN_KEY = 'opero:fb-return'

export const SHOPIFY_ERROR: Record<string, string> = {
  invalid_state: 'O pedido de conexão expirou ou veio de outra aba. Comece de novo.',
  invalid_shop: 'Domínio inválido: use o endereço <loja>.myshopify.com.',
  not_configured: 'O app Opero da Shopify não está configurado neste servidor.',
  invalid_hmac: 'A assinatura da Shopify não confere com o app configurado no servidor. Tentar de novo não resolve: o par Client ID/Secret do servidor precisa ser corrigido.',
  access_denied: 'A autorização foi cancelada na Shopify.',
  token_exchange_failed: 'A Shopify não entregou a chave de acesso. Tente de novo.',
  shop_unreachable: 'A chave nova não conseguiu ler a loja na Shopify.',
  domain_mismatch: 'O domínio informado não é o desta loja.',
  dev_dashboard_store: 'Esta loja usa um app do Dev Dashboard: reconecte com Client ID e Client Secret, não pelo app Opero nem com token colado.',
  store_archived: 'Esta loja está arquivada. Desarquive em Ajustes → Lojas antes de reconectar.',
  account_required: 'Para adicionar uma loja, entre com a conta (login de sócio) que vai ser dona dela. O modo dono do celular não tem conta própria.',
  already_registered: 'Esta loja da Shopify já está cadastrada em outra conta.',
  save_failed: 'A conexão funcionou, mas não foi gravada. Nada mudou; tente de novo.',
  secret_in_url: 'Client ID e Secret nunca vão pela URL. Use o formulário.',
  missing_credentials: 'Informe o Client ID e o Client Secret do app.',
  secret_not_token: 'Isso é o Client Secret (shpss_), não um token de acesso. Use a opção Client ID + Secret.',
  credentials_rejected: 'A Shopify recusou o Client ID e o Secret. Confira se são do app instalado nesta loja.',
  token_rejected: 'A Shopify recusou este token.',
  not_found: 'Loja não encontrada.',
}

export const FACEBOOK_ERROR: Record<string, string> = {
  invalid_state: 'O pedido de conexão expirou ou veio de outra aba. Comece de novo.',
  access_denied: 'A conexão foi cancelada no Facebook.',
  not_configured: 'O app do Facebook não está configurado neste servidor.',
  store_archived: 'Esta loja está arquivada. Desarquive a loja antes de mexer nas contas de anúncio dela.',
  token_exchange_failed: 'O Facebook não entregou o acesso. Tente de novo.',
  long_token_failed: 'O Facebook não entregou o acesso de longa duração. Tente de novo.',
  save_failed: 'A conta não foi gravada. Nada mudou; tente de novo.',
  invalid_account: 'ID de conta de anúncio inválido (ex.: act_123456789).',
  no_token: 'Esta loja ainda não tem acesso ao Facebook. Conecte o Facebook primeiro.',
  attached_elsewhere: 'Esta conta de anúncio já está ligada a outra loja.',
  already_main: 'Esta conta já é a conta principal desta loja.',
  already_extra: 'Esta conta já é uma conta extra desta loja.',
  replaces_permanent_token: 'Isto trocaria um token que não expira por um que expira.',
  no_access: 'O acesso do Facebook usado não consegue ler esta conta de anúncio.',
  invalid_token: 'Este token do Facebook é inválido ou expirou.',
  no_pending: 'Nenhum login do Facebook aguardando. Conecte de novo.',
  facebook_error: 'O Facebook não respondeu. Tente de novo.',
  not_found: 'Loja não encontrada.',
}

export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T | null
  /** Portuguese message for a failure. */
  error: string | null
  code: string | null
  /** Extra fields of an error body (e.g. expiresAt). */
  extra: Record<string, unknown>
}

/** fetch + JSON, with failures turned into words. `ok` is true only for a 2xx
 *  answer with a JSON body: that is the only case a screen may call a success. */
export async function callApi<T>(url: string, init: RequestInit = {}, codes: Record<string, string> = {}): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      cache: 'no-store',
    })
  } catch {
    return { ok: false, status: 0, data: null, error: 'O servidor não respondeu. Nada foi alterado.', code: 'network', extra: {} }
  }
  let body: Record<string, unknown> | null = null
  try { body = (await res.json()) as Record<string, unknown> } catch { body = null }
  if (res.ok && body) return { ok: true, status: res.status, data: body as T, error: null, code: null, extra: {} }
  const code = typeof body?.code === 'string' ? body.code : null
  const rawText = typeof body?.error === 'string' ? body.error.trim() : null
  const raw = rawText ? (/[.!?]$/.test(rawText) ? rawText : `${rawText}.`) : null
  const error = (code && codes[code]) || raw
    || (res.status === 401 ? 'Sua sessão expirou. Entre de novo.' : `O servidor respondeu com erro (HTTP ${res.status}). Nada foi alterado.`)
  return { ok: false, status: res.status, data: null, error, code, extra: body ?? {} }
}

/** A failure sentence that says nothing was changed, once: callApi's own
 *  fallbacks already end with it. */
export function nothingChanged(text: string | null): string {
  const t = (text ?? 'O servidor respondeu com erro.').trim()
  return /Nada (foi alterado|mudou)/.test(t) ? t : `${t} Nada foi alterado.`
}

/** Meta's account_status in words. */
export function accountStatusText(status: number | null): { text: string; tone: 'pos' | 'neg' | 'warn' | 'mut' } {
  switch (status) {
    case 1: return { text: 'ativa no Meta', tone: 'pos' }
    case 2: return { text: 'desativada no Meta', tone: 'neg' }
    case 3: return { text: 'com pagamento pendente', tone: 'warn' }
    case 7: return { text: 'em análise de risco', tone: 'warn' }
    case 8: return { text: 'pagamento pendente de acerto', tone: 'warn' }
    case 9: return { text: 'em período de carência', tone: 'warn' }
    case 100: return { text: 'fechamento pendente', tone: 'warn' }
    case 101: return { text: 'fechada no Meta', tone: 'neg' }
    case null: return { text: 'status desconhecido', tone: 'mut' }
    default: return { text: `status ${status} no Meta`, tone: 'warn' }
  }
}

/** A collector's error as the screen quotes it: the raw text can be a whole
 *  HTTP dump (Squishy World's 402 carries every response header), so it is
 *  cut to its first line and 140 characters. */
export function shortError(text: string): string {
  const line = text.split(/\r?\n/)[0].trim()
  return line.length > 140 ? `${line.slice(0, 139).trimEnd()}…` : line
}
