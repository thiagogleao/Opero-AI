'use client'

/**
 * Reconnect one store's Shopify with typed credentials, by POST (the secret
 * never goes in a URL — the old page put the Client Secret in the query string).
 *
 *  - Dev Dashboard app (Glooty, Hibikura): Client ID + Client Secret. The
 *    server mints a token on the spot to prove the pair, stores the pair, and
 *    the collector re-mints the 24h token from then on (A6).
 *  - Legacy custom app: the Admin API token (shpat_…), which does not expire.
 *
 * Success is shown only when the server answered ok; then the page re-tests
 * the key (router.refresh) and the orders are re-read from the last success.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Callout, Segmented } from '@/components/ui'
import type { ShopifyConnection } from '@/lib/integrations/types'
import { SHOPIFY_ERROR, callApi, nothingChanged } from './messages'
import s from './settings.module.css'

/** The usual mix-ups between Shopify's key shapes, caught before a round trip. */
export function explainShopifyKey(raw: string, kind: 'token' | 'secret' | 'id'): string | null {
  const t = raw.trim()
  if (!t) return null
  if (kind === 'token') {
    if (t.startsWith('shpss_')) return 'Isso é o Client Secret (shpss_), não o token. Use a opção “Client ID + Secret”.'
    if (/^[0-9a-f]{32}$/i.test(t)) return 'Isso parece um Client ID. Use a opção “Client ID + Secret”.'
    if (!t.startsWith('shpat_') && !t.startsWith('shpca_')) return 'O token de acesso começa com shpat_. Confira se copiou o “Admin API access token”.'
  }
  if (kind === 'secret' && t.startsWith('shpat_')) return 'Isso é um token de acesso (shpat_), não o Client Secret. Use a opção “Token do app”.'
  if (kind === 'id' && t.startsWith('shp')) return 'O Client ID é um código de letras e números sem prefixo; isso parece uma chave.'
  return null
}

type Kind = 'dev' | 'token'

export function ShopifyKeyForm({ storeId, storeName, domain, connection, archived }: {
  storeId: string; storeName: string; domain: string | null; connection: ShopifyConnection; archived: boolean
}) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>(connection === 'token' ? 'token' : 'dev')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  if (archived) return <p className={s.sub}>Loja arquivada, só para consulta: a chave não pode ser trocada. Para reconectar, desarquive em Ajustes → Lojas.</p>
  if (!domain) return <p className={s.sub}>Loja sem domínio da Shopify.</p>

  const hints = kind === 'dev'
    ? [explainShopifyKey(clientId, 'id'), explainShopifyKey(secret, 'secret')].filter(Boolean) as string[]
    : [explainShopifyKey(token, 'token')].filter(Boolean) as string[]
  const ready = kind === 'dev' ? !!clientId.trim() && !!secret.trim() : !!token.trim() && hints.length === 0

  async function submit() {
    setPending(true)
    setResult(null)
    const body = kind === 'dev'
      ? { storeId, clientId: clientId.trim(), clientSecret: secret.trim() }
      : { storeId, accessToken: token.trim() }
    const r = await callApi('/api/shopify/connect', { method: 'POST', body: JSON.stringify(body) }, SHOPIFY_ERROR)
    if (!r.ok) {
      setPending(false)
      setResult({ ok: false, text: nothingChanged(r.error) })
      return
    }
    setClientId(''); setSecret(''); setToken('')
    // Re-read the orders from the last successful collection: the days the key
    // was broken are inside that window.
    const sync = await callApi<{ jobs: { source: string; state: string; from: string | null; note?: string }[] }>('/api/refresh', {
      method: 'POST', body: JSON.stringify({ storeId, sources: ['shopify'] }),
    })
    const job = sync.ok ? sync.data?.jobs.find(j => j.source === 'shopify') : null
    const syncText = !sync.ok
      ? `A coleta dos pedidos não começou agora (${sync.error}); a sincronização agendada vai buscá-los.`
      : job && ['started', 'queued', 'merged', 'running'].includes(job.state)
        ? `Coleta dos pedidos${job.from ? ` desde ${job.from.slice(8, 10)}/${job.from.slice(5, 7)}` : ''} iniciada.`
        : job?.note ? `Coleta dos pedidos: ${job.note}.` : ''
    setPending(false)
    setResult({
      ok: true,
      text: `A Shopify aceitou ${kind === 'dev' ? 'o Client ID e o Secret' : 'o token'} e ${storeName} foi reconectada. ${syncText}`.trim(),
    })
    router.refresh()
  }

  return (
    <div className={s.form}>
      <div className={s.inline} style={{ justifyContent: 'space-between' }}>
        <span className={s.label}>Reconectar {storeName} com uma chave</span>
        {connection !== 'dev_dashboard' && (
          <Segmented
            size="sm"
            ariaLabel="Tipo de chave"
            value={kind}
            onChange={v => { setKind(v as Kind); setResult(null) }}
            options={[{ value: 'dev', label: 'Client ID + Secret' }, { value: 'token', label: 'Token do app (shpat_)' }]}
          />
        )}
      </div>
      {connection === 'dev_dashboard' && (
        <p className={s.sub}>Esta loja usa um app do Dev Dashboard: só reconecta com o Client ID e o Client Secret do app. Token colado ou o app Opero não servem.</p>
      )}
      <div className={s.fields}>
        {kind === 'dev' ? (
          <>
            <label className={s.field}>
              <span className={s.label}>Client ID</span>
              <input className={`${s.input} ${s.inputMono}`} autoComplete="off" spellCheck={false} value={clientId} onChange={e => setClientId(e.target.value)} placeholder="ex.: 2da05587a6046cd…" />
            </label>
            <label className={s.field}>
              <span className={s.label}>Client Secret</span>
              <input className={`${s.input} ${s.inputMono}`} type="password" autoComplete="off" spellCheck={false} value={secret} onChange={e => setSecret(e.target.value)} placeholder="shpss_…" />
            </label>
          </>
        ) : (
          <label className={s.field}>
            <span className={s.label}>Admin API access token</span>
            <input className={`${s.input} ${s.inputMono}`} type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} placeholder="shpat_…" />
          </label>
        )}
      </div>
      {hints.map((h, i) => <div key={i} className={s.warnText}>{h}</div>)}
      {result && <Callout tone={result.ok ? 'info' : 'neg'} icon={result.ok ? 'check' : undefined}>{result.text}</Callout>}
      <div className={s.inline}>
        <Button size="sm" variant="primary" pending={pending} disabled={!ready} onClick={submit}>Testar e salvar</Button>
        <span className={s.sub}>A chave é testada na Shopify antes de ser gravada, e nunca é mostrada de volta.</span>
      </div>
    </div>
  )
}
