'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import Sidebar from '@/components/Sidebar'

type TokenStatus = 'ok' | 'invalid' | 'missing' | 'error' | 'unreachable'

interface StoreHealth {
  id: string
  name: string
  domain: string | null
  masked: string | null
  status: TokenStatus
  httpStatus: number | null
}

const STATUS_LABEL: Record<TokenStatus, string> = {
  ok:          'Conectada',
  invalid:     'Chave revogada',
  missing:     'Sem chave',
  error:       'Erro na Shopify',
  unreachable: 'Sem resposta',
}

const STATUS_COLOR: Record<TokenStatus, { fg: string; bg: string; border: string }> = {
  ok:          { fg: '#10B981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.28)' },
  invalid:     { fg: '#F43F5E', bg: 'rgba(244,63,94,0.10)',  border: 'rgba(244,63,94,0.28)'  },
  missing:     { fg: '#F43F5E', bg: 'rgba(244,63,94,0.10)',  border: 'rgba(244,63,94,0.28)'  },
  error:       { fg: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.28)' },
  unreachable: { fg: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.28)' },
}

/** Shopify hands out several key shapes and only one of them opens the Admin
 *  API. Catching the common mix-ups here saves a round trip that would come
 *  back as a bare "token inválido" and explain nothing. */
function explainToken(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null

  // shpss_ is handled separately — it drives the OAuth flow instead.
  if (t.startsWith('shpss_')) return null

  if (t.startsWith('shpsa_') || t.startsWith('shppa_'))
    return 'Essa é uma chave do app, não o token de acesso da loja. Procure o campo Admin API access token, que começa com shpat_.'

  if (/^[0-9a-f]{32}$/i.test(t))
    return 'Isso parece o Client ID do app. Cole a Client secret (shpss_) aqui e o Client ID no campo que vai aparecer.'

  if (!t.startsWith('shpat_') && !t.startsWith('shpca_'))
    return 'O token de acesso da Shopify começa com shpat_. Confira se copiou o campo Admin API access token.'

  return null
}

function Section({ title, delay = 0, children }: { title: string; delay?: number; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(139,92,246,0.04)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{title}</p>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </motion.div>
  )
}

function StatusPill({ status }: { status: TokenStatus }) {
  const c = STATUS_COLOR[status]
  return (
    <span style={{
      padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6,
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`, whiteSpace: 'nowrap',
    }}>
      {status === 'ok' ? '✓' : status === 'invalid' || status === 'missing' ? '✗' : '⚠'} {STATUS_LABEL[status]}
    </span>
  )
}

export default function KeysPage() {
  const [stores,   setStores]   = useState<StoreHealth[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [drafts,   setDrafts]   = useState<Record<string, string>>({})
  const [apiKeys,  setApiKeys]  = useState<Record<string, string>>({})
  const [saving,   setSaving]   = useState<string | null>(null)
  const [result,   setResult]   = useState<Record<string, { ok: boolean; msg: string }>>({})

  /** A shpss_ secret can't authenticate a request, but it is exactly what the
   *  OAuth exchange needs to be signed with. Hand it to /api/shopify/auth,
   *  which carries the pair through to the callback in a cookie, and let
   *  Shopify mint a real access token at the end. */
  function connectViaOAuth(store: StoreHealth) {
    const secret = (drafts[store.id] ?? '').trim()
    const key    = (apiKeys[store.id] ?? '').trim()
    if (!store.domain || !secret || !key) return

    const url = new URL('/api/shopify/auth', window.location.origin)
    url.searchParams.set('shop', store.domain)
    url.searchParams.set('reconnect', '1')
    url.searchParams.set('clientId', key)
    url.searchParams.set('clientSecret', secret)
    window.location.href = url.toString()
  }

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const res  = await fetch('/api/shopify/token-health', { cache: 'no-store' })
      const data = await res.json()
      setStores(data.stores ?? [])
    } catch {
      setStores([])
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { check() }, [check])

  async function save(store: StoreHealth) {
    const token = (drafts[store.id] ?? '').trim()
    if (!token || !store.domain) return

    setSaving(store.id)
    setResult(r => ({ ...r, [store.id]: { ok: false, msg: '' } }))

    try {
      const res  = await fetch('/api/shopify/connect-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: store.domain, accessToken: token }),
      })
      const data = await res.json()

      if (res.ok) {
        setResult(r => ({ ...r, [store.id]: { ok: true, msg: 'Chave validada e salva.' } }))
        setDrafts(d => ({ ...d, [store.id]: '' }))
        check()
      } else {
        setResult(r => ({ ...r, [store.id]: { ok: false, msg: data.error || 'Falha ao salvar.' } }))
      }
    } catch {
      setResult(r => ({ ...r, [store.id]: { ok: false, msg: 'Erro de conexão.' } }))
    } finally {
      setSaving(null)
    }
  }

  const broken = stores?.filter(s => s.status === 'invalid' || s.status === 'missing') ?? []

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/settings" />

      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px', maxWidth: 860 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Link href="/settings" style={{ fontSize: 12, color: 'var(--text-faint)', textDecoration: 'none' }}>
              ← Configurações
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px', marginTop: 6 }}>
              Atualizar chaves
            </h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 3 }}>
              Cada chave é testada na Shopify agora, não apenas conferida no banco.
            </p>
          </div>

          <button onClick={check} disabled={checking}
            style={{
              padding: '7px 13px', fontSize: 12, fontWeight: 600, borderRadius: 8,
              border: '1px solid var(--border-strong)', background: 'var(--bg-input)',
              color: 'var(--text-muted)', cursor: checking ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}>
            {checking ? 'Testando…' : '↻ Testar novamente'}
          </button>
        </div>

        {/* Alert when something is broken */}
        {broken.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{
              background: 'rgba(244,63,94,0.07)', border: '1px solid rgba(244,63,94,0.22)',
              borderRadius: 10, padding: '14px 18px', marginBottom: 16,
            }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#F43F5E', margin: 0 }}>
              {broken.length === 1
                ? '1 loja parou de sincronizar'
                : `${broken.length} lojas pararam de sincronizar`}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.55 }}>
              A chave de acesso da Shopify não expira sozinha. Um 401 significa que ela foi
              revogada — é o que acontece quando o app é reinstalado, os escopos mudam, ou as
              credenciais são rotacionadas. Gere uma nova e cole abaixo.
            </p>
          </motion.div>
        )}

        {/* Stores */}
        <Section title="Shopify — chave de acesso por loja">
          {stores === null ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>Testando as chaves…</p>
          ) : stores.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>Nenhuma loja conectada.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {stores.map(store => {
                const needs = store.status === 'invalid' || store.status === 'missing'
                const res   = result[store.id]
                const draft    = (drafts[store.id] ?? '').trim()
                const isSecret = draft.startsWith('shpss_')
                const hint     = explainToken(draft)
                const ready    = draft.length > 0 && !hint && !isSecret
                const keyDraft = (apiKeys[store.id] ?? '').trim()
                return (
                  <div key={store.id}
                    style={{
                      border: `1px solid ${needs ? 'rgba(244,63,94,0.22)' : 'var(--border)'}`,
                      borderRadius: 10, padding: 16,
                      background: needs ? 'rgba(244,63,94,0.03)' : 'transparent',
                    }}>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                          {store.name}
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '2px 0 0', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                          {store.domain || 'sem domínio'}
                          {store.masked && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {store.masked}</span>}
                        </p>
                      </div>
                      <StatusPill status={store.status} />
                    </div>

                    {store.status === 'error' && store.httpStatus && (
                      <p style={{ fontSize: 11.5, color: '#F59E0B', margin: '8px 0 0' }}>
                        A Shopify respondeu HTTP {store.httpStatus}. Se persistir, a loja pode estar
                        suspensa ou o domínio mudou.
                      </p>
                    )}

                    {store.domain && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <input
                          id={`token-${store.id}`}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="shpss_… ou shpat_…"
                          value={drafts[store.id] ?? ''}
                          onChange={e => setDrafts(d => ({ ...d, [store.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && ready) save(store) }}
                          style={{
                            flex: '1 1 220px', minWidth: 0, background: 'var(--bg-input)',
                            border: `1px solid ${hint ? 'rgba(245,158,11,0.45)' : 'var(--border-strong)'}`,
                            borderRadius: 7,
                            padding: '7px 10px', fontSize: 12.5, color: 'var(--text-primary)',
                            outline: 'none', fontFamily: 'ui-monospace, monospace',
                          }} />
                        <button
                          onClick={() => save(store)}
                          disabled={saving === store.id || !ready}
                          style={{
                            padding: '7px 15px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none',
                            background: ready ? 'rgba(16,185,129,0.15)' : 'var(--bg-input)',
                            color: ready ? '#10B981' : 'var(--text-faint)',
                            cursor: saving === store.id ? 'wait' : ready ? 'pointer' : 'not-allowed',
                            whiteSpace: 'nowrap',
                          }}>
                          {saving === store.id ? 'Validando…' : 'Salvar chave'}
                        </button>
                      </div>
                    )}

                    {hint && (
                      <p style={{ fontSize: 12, margin: '8px 0 0', color: '#F59E0B', lineHeight: 1.55 }}>
                        {hint}
                      </p>
                    )}

                    {/* shpss_ path — sign the OAuth exchange with the app secret */}
                    {isSecret && store.domain && (
                      <div style={{
                        marginTop: 10, padding: 14, borderRadius: 8,
                        background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.22)',
                      }}>
                        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                          Essa é a <strong style={{ color: 'var(--text-primary)' }}>Client secret</strong> do app. Ela não
                          autentica chamadas sozinha, mas assina a autorização — informe o <strong style={{ color: 'var(--text-primary)' }}>Client ID</strong> do
                          mesmo app e a Shopify emite o token de acesso no fim.
                        </p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <input
                            id={`apikey-${store.id}`}
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Client ID"
                            value={apiKeys[store.id] ?? ''}
                            onChange={e => setApiKeys(k => ({ ...k, [store.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter' && keyDraft) connectViaOAuth(store) }}
                            style={{
                              flex: '1 1 200px', minWidth: 0, background: 'var(--bg-input)',
                              border: '1px solid var(--border-strong)', borderRadius: 7,
                              padding: '7px 10px', fontSize: 12.5, color: 'var(--text-primary)',
                              outline: 'none', fontFamily: 'ui-monospace, monospace',
                            }} />
                          <button
                            onClick={() => connectViaOAuth(store)}
                            disabled={!keyDraft}
                            style={{
                              padding: '7px 15px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none',
                              background: keyDraft ? 'rgba(139,92,246,0.18)' : 'var(--bg-input)',
                              color: keyDraft ? '#A78BFA' : 'var(--text-faint)',
                              cursor: keyDraft ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
                            }}>
                            Autorizar na Shopify
                          </button>
                        </div>
                        <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '9px 0 0', lineHeight: 1.55 }}>
                          O Client ID fica logo acima da Client secret, na mesma tela do app. Você vai para
                          a Shopify autorizar e volta com a loja reconectada.
                        </p>
                      </div>
                    )}

                    {res?.msg && (
                      <p style={{ fontSize: 12, margin: '8px 0 0', color: res.ok ? '#10B981' : '#F43F5E' }}>
                        {res.ok ? '✓ ' : '✗ '}{res.msg}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* Where to find it */}
        <Section title="Onde gerar a chave" delay={0.06}>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.85 }}>
            <li>No admin da loja: <strong style={{ color: 'var(--text-primary)' }}>Settings → Apps and sales channels → Develop apps</strong></li>
            <li>Abra o app do Opero, ou <strong style={{ color: 'var(--text-primary)' }}>Create an app</strong> se ainda não existir nessa loja</li>
            <li>Em <strong style={{ color: 'var(--text-primary)' }}>Configure Admin API scopes</strong>, marque ao menos <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>read_orders</code>, <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>read_products</code>, <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>read_customers</code>, <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>read_analytics</code>, <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>read_reports</code>, <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>read_fulfillments</code> → <strong style={{ color: 'var(--text-primary)' }}>Save</strong></li>
            <li><strong style={{ color: 'var(--text-primary)' }}>Install app</strong></li>
            <li>Aba <strong style={{ color: 'var(--text-primary)' }}>API credentials</strong> e copie o que estiver lá</li>
            <li>Cole aqui, na loja correspondente</li>
          </ol>
          <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '14px 0 0', lineHeight: 1.6 }}>
            Você vai encontrar uma de duas coisas, e a página aceita as duas:
          </p>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12.5, color: 'var(--text-faint)', lineHeight: 1.7 }}>
            <li>
              <strong style={{ color: 'var(--text-muted)' }}>Admin API access token</strong> (<code style={{ fontFamily: 'ui-monospace, monospace' }}>shpat_</code>) —
              é gravado direto. Só aparece uma vez; se já foi revelado e ninguém copiou, reinstale o app.
            </li>
            <li>
              <strong style={{ color: 'var(--text-muted)' }}>Client ID e Client secret</strong> (<code style={{ fontFamily: 'ui-monospace, monospace' }}>shpss_</code>) —
              cole a secret e a página pede o Client ID, depois a Shopify emite o token pra você.
            </li>
          </ul>
          <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '10px 0 0', lineHeight: 1.6 }}>
            Um app por loja mantém as credenciais isoladas: rotacionar ou reinstalar numa loja não
            derruba as outras.
          </p>
        </Section>

        {/* After reconnecting */}
        <Section title="Depois de reconectar" delay={0.12}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>
            Os pedidos que chegaram enquanto a chave estava revogada <strong style={{ color: 'var(--text-primary)' }}>não
            entram sozinhos</strong> — o coletor não volta em pedidos já processados. No painel, use a seta
            ao lado do botão de atualizar e escolha <strong style={{ color: 'var(--text-primary)' }}>Re-sincronizar
            período</strong>, com pelo menos 7 dias, para preencher o intervalo.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '12px 0 0', lineHeight: 1.6 }}>
            Rotacionar as credenciais também troca o <code style={{ fontFamily: 'ui-monospace, monospace' }}>SHOPIFY_CLIENT_SECRET</code>,
            usado só para conectar lojas novas pelo fluxo automático. A coleta de dados não depende
            dele, mas vale atualizar no ambiente para não travar o próximo cadastro.
          </p>
        </Section>

      </main>
    </div>
  )
}
