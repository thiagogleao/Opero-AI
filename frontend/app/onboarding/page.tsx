'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

type Step = 'shopify' | 'facebook' | 'syncing' | 'done'

function TutorialStep({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#A78BFA', flexShrink: 0, marginTop: 1 }}>
        {n}
      </div>
      <p style={{ fontSize: 12, color: '#71717A', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: text }} />
    </div>
  )
}

function Tutorial({ title, steps, open, onToggle }: { title: string; steps: string[]; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', color: '#A78BFA', fontSize: 12, fontWeight: 600 }}>
        <span>📖 {title}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>{open ? '▲ Fechar' : '▼ Ver passo a passo'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(139,92,246,0.1)' }}>
          <div style={{ height: 10 }} />
          {steps.map((s, i) => <TutorialStep key={i} n={i + 1} text={s} />)}
        </div>
      )}
    </div>
  )
}

function OnboardingInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [step, setStep] = useState<Step>('shopify')
  const [shopifyDomain, setShopifyDomain] = useState('')
  const [storeStartDate, setStoreStartDate] = useState('')
  const [fbAccountId, setFbAccountId] = useState('')
  const [fbToken, setFbToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ shopify?: boolean; facebook?: boolean }>({})
  const [error, setError] = useState('')
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [shopifyConnected, setShopifyConnected] = useState(false)

  // Handle return from Shopify OAuth
  useEffect(() => {
    const connected = searchParams.get('shopify_connected')
    const dateParam = searchParams.get('storeStartDate')
    const errorParam = searchParams.get('error')

    if (connected === 'true') {
      setShopifyConnected(true)
      if (dateParam) setStoreStartDate(dateParam)
      setStep('facebook')
    }
    if (errorParam) {
      const messages: Record<string, string> = {
        invalid_state: 'Erro de segurança. Tente novamente.',
        invalid_hmac: 'Resposta inválida do Shopify. Tente novamente.',
        token_exchange_failed: 'Não foi possível obter o token do Shopify. Verifique o app.',
      }
      setError(messages[errorParam] || 'Erro desconhecido. Tente novamente.')
    }
  }, [searchParams])

  const startShopifyOAuth = useCallback(() => {
    const domain = shopifyDomain.replace(/https?:\/\//, '').replace(/\/$/, '')
    if (!domain) return
    const params = new URLSearchParams({ shop: domain })
    if (storeStartDate) params.set('storeStartDate', storeStartDate)
    window.location.href = `/api/shopify/auth?${params}`
  }, [shopifyDomain, storeStartDate])

  const submit = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fb_ad_account_id: fbAccountId || null,
          fb_access_token: fbToken || null,
          onboarded: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erro desconhecido'); setLoading(false); return }
      setStep('syncing')
    } catch {
      setError('Erro de conexão')
      setLoading(false)
    }
  }, [fbAccountId, fbToken])

  useEffect(() => {
    if (step !== 'syncing') return
    async function firstSync() {
      try {
        const days = storeStartDate
          ? Math.max(1, Math.ceil((Date.now() - new Date(storeStartDate).getTime()) / 86_400_000))
          : 90
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days }),
        })
        const data = await res.json()
        setSyncStatus({ shopify: data.shopify?.ok, facebook: data.facebook?.ok })
      } catch {
        setSyncStatus({ shopify: false, facebook: false })
      }
      setStep('done')
    }
    firstSync()
  }, [step, storeStartDate])

  const inputStyle = {
    width: '100%', background: '#111318', border: '1px solid #2A2D35',
    borderRadius: 8, padding: '10px 14px', fontSize: 13,
    color: '#F4F4F5', outline: 'none', boxSizing: 'border-box' as const,
  }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: '#A1A1AA', marginBottom: 6, display: 'block' as const }
  const hintStyle = { fontSize: 11, color: '#52525B', marginTop: 4 }

  const shopifySteps = [
    'Acesse <strong style="color:#A1A1AA">partners.shopify.com</strong> e faça login na sua conta de parceiro.',
    'Clique em <strong style="color:#A1A1AA">Apps</strong> no menu lateral → <strong style="color:#A1A1AA">Create app</strong>.',
    'Escolha <strong style="color:#A1A1AA">Create app manually</strong>, dê um nome (ex: "Opero AI") e confirme.',
    'Na aba <strong style="color:#A1A1AA">Configuration</strong>, em <strong style="color:#A1A1AA">URLs</strong>, adicione a URL de callback: <em>[sua URL]/api/shopify/callback</em>.',
    'Copie o <strong style="color:#A1A1AA">Client ID</strong> e o <strong style="color:#A1A1AA">Client Secret</strong> e adicione nas variáveis de ambiente <em>SHOPIFY_CLIENT_ID</em> e <em>SHOPIFY_CLIENT_SECRET</em>.',
    'Digite o domínio da sua loja abaixo (ex: <em>minhaloja.myshopify.com</em>) e clique em <strong style="color:#A1A1AA">Conectar com Shopify</strong>.',
    'Você será redirecionado para o Shopify para autorizar o app — clique em <strong style="color:#A1A1AA">Install</strong> e pronto.',
  ]

  const fbSteps = [
    'Acesse o <strong style="color:#A1A1AA">Meta Business Suite</strong> em business.facebook.com e selecione seu negócio.',
    'No menu lateral, vá em <strong style="color:#A1A1AA">Configurações</strong> → <strong style="color:#A1A1AA">Usuários do sistema</strong>.',
    'Clique em <strong style="color:#A1A1AA">Adicionar</strong>, crie um usuário com função <em>Funcionário</em> (ou Admin).',
    'Com o usuário criado, clique em <strong style="color:#A1A1AA">Gerar novo token</strong>. Selecione seu app e ative as permissões <em>ads_read</em> e <em>ads_management</em>.',
    'Copie o token gerado — ele não expira (System User Token é preferível a token pessoal).',
    'O <strong style="color:#A1A1AA">ID da conta de anúncios</strong> fica na URL do Ads Manager: <em>facebook.com/adsmanager/manage/...?act=<u>XXXXXXXXX</u></em>. Cole no campo incluindo o prefixo <em>act_</em>.',
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0B0D0F', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 540 }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: 'white', margin: '0 auto 12px' }}>O</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F4F4F5' }}>Conecte sua loja</h1>
          <p style={{ fontSize: 13, color: '#71717A', marginTop: 4 }}>Configure suas integrações para começar a analisar</p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {(['shopify', 'facebook'] as Step[]).map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: step === 'done' || step === 'syncing' || (step === 'facebook' && i === 0) || step === s ? '#8B5CF6' : '#1E2028' }} />
          ))}
        </div>

        {step === 'syncing' && (
          <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 16, animation: 'spin 2s linear infinite', display: 'inline-block' }}>⟳</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F4F4F5', marginBottom: 8 }}>Importando dados...</h2>
            <p style={{ fontSize: 13, color: '#71717A', marginBottom: 24 }}>
              {storeStartDate
                ? `Buscando dados desde ${new Date(storeStartDate).toLocaleDateString('pt-BR')}. Isso pode levar alguns minutos.`
                : 'Buscando os últimos 90 dias de dados. Isso pode levar alguns minutos.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Shopify — pedidos, produtos, clientes' },
                { label: 'Facebook Ads — campanhas, métricas' },
              ].map(({ label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#0B0D0F', borderRadius: 8, border: '1px solid #1E2028' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B5CF6' }} />
                  <span style={{ fontSize: 12, color: '#71717A' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F4F4F5', marginBottom: 8 }}>Tudo pronto!</h2>
            <p style={{ fontSize: 13, color: '#71717A', marginBottom: 20 }}>Dados importados com sucesso.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: '#0B0D0F', borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: '#71717A' }}>Shopify</span>
                <span style={{ color: syncStatus.shopify ? '#10B981' : '#F43F5E', fontWeight: 600 }}>{syncStatus.shopify ? '✓ OK' : '✗ Erro — verifique as credenciais'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: '#0B0D0F', borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: '#71717A' }}>Facebook Ads</span>
                <span style={{ color: syncStatus.facebook ? '#10B981' : '#F59E0B', fontWeight: 600 }}>{syncStatus.facebook ? '✓ OK' : fbToken ? '✗ Erro — verifique o token' : '— Não configurado'}</span>
              </div>
            </div>
            <button onClick={() => router.push('/')} style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 8, padding: '11px 28px', fontSize: 14, fontWeight: 600, color: '#fff', cursor: 'pointer', width: '100%' }}>
              Ir para o Dashboard →
            </button>
          </div>
        )}

        {(step === 'shopify' || step === 'facebook') && (
          <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 12, padding: 28 }}>

            {step === 'shopify' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(149,191,71,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🛍️</div>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F5' }}>Shopify</h2>
                    <p style={{ fontSize: 11, color: '#71717A' }}>Passo 1 de 2</p>
                  </div>
                </div>

                <Tutorial
                  title="Como configurar o app no Shopify"
                  steps={shopifySteps}
                  open={tutorialOpen}
                  onToggle={() => setTutorialOpen(o => !o)}
                />

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Domínio da loja</label>
                  <input value={shopifyDomain} onChange={e => setShopifyDomain(e.target.value)} placeholder="minhaloja.myshopify.com" style={inputStyle} />
                  <p style={hintStyle}>Sem https://, apenas o domínio. Ex: minhaloja.myshopify.com</p>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Quando a loja abriu? <span style={{ color: '#52525B', fontWeight: 400 }}>(opcional)</span></label>
                  <input
                    type="date"
                    value={storeStartDate}
                    onChange={e => setStoreStartDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    style={{ ...inputStyle, colorScheme: 'dark' }}
                  />
                  <p style={hintStyle}>Importamos dados a partir desta data. Vazio = últimos 90 dias.</p>
                </div>

                {error && <p style={{ fontSize: 12, color: '#F43F5E', marginBottom: 12 }}>{error}</p>}

                <button
                  onClick={startShopifyOAuth}
                  disabled={!shopifyDomain}
                  style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#fff', cursor: !shopifyDomain ? 'not-allowed' : 'pointer', opacity: !shopifyDomain ? 0.4 : 1, width: '100%' }}
                >
                  Conectar com Shopify →
                </button>
              </>
            )}

            {step === 'facebook' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📘</div>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F5' }}>Facebook Ads</h2>
                    <p style={{ fontSize: 11, color: '#71717A' }}>Passo 2 de 2 — opcional</p>
                  </div>
                </div>

                {shopifyConnected && (
                  <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#10B981', fontSize: 14 }}>✓</span>
                    <span style={{ fontSize: 12, color: '#10B981' }}>Shopify conectado com sucesso!</span>
                  </div>
                )}

                <Tutorial
                  title="Como gerar o token do Facebook Ads"
                  steps={fbSteps}
                  open={tutorialOpen}
                  onToggle={() => setTutorialOpen(o => !o)}
                />

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>ID da conta de anúncios</label>
                  <input value={fbAccountId} onChange={e => setFbAccountId(e.target.value)} placeholder="act_123456789" style={inputStyle} />
                  <p style={hintStyle}>Formato: <strong>act_</strong> seguido do número. Veja o tutorial acima.</p>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Access Token</label>
                  <input value={fbToken} onChange={e => setFbToken(e.target.value)} placeholder="EAAx..." type="password" style={inputStyle} />
                  <p style={hintStyle}>Use um <strong>System User Token</strong> (não expira). Veja o tutorial acima.</p>
                </div>

                <div style={{ background: '#0B0D0F', borderRadius: 8, padding: '10px 14px', marginBottom: 20, border: '1px solid #1E2028' }}>
                  <p style={{ fontSize: 11, color: '#52525B', lineHeight: 1.6 }}>
                    Sem Facebook Ads? Sem problema — clique em <strong style={{ color: '#A1A1AA' }}>Conectar e começar</strong> mesmo assim. Você pode configurar depois em <strong style={{ color: '#A1A1AA' }}>Configurações → Integrações</strong>.
                  </p>
                </div>

                {error && <p style={{ fontSize: 12, color: '#F43F5E', marginBottom: 12 }}>{error}</p>}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => { setTutorialOpen(false); setStep('shopify') }} style={{ background: 'transparent', border: '1px solid #2A2D35', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#71717A', cursor: 'pointer', flex: 1 }}>
                    ← Voltar
                  </button>
                  <button onClick={submit} disabled={loading}
                    style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.4 : 1, flex: 2 }}>
                    {loading ? 'Salvando...' : 'Conectar e começar →'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  )
}
