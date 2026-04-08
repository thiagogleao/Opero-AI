'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'shopify' | 'facebook' | 'done'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('shopify')
  const [shopifyDomain, setShopifyDomain] = useState('')
  const [shopifyToken, setShopifyToken] = useState('')
  const [fbAccountId, setFbAccountId] = useState('')
  const [fbToken, setFbToken] = useState('')
  const [claimLegacy, setClaimLegacy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopify_domain: shopifyDomain,
          shopify_access_token: shopifyToken,
          fb_ad_account_id: fbAccountId,
          fb_access_token: fbToken,
          claimLegacy,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erro desconhecido'); setLoading(false); return }
      setStep('done')
    } catch (e) {
      setError('Erro de conexão')
    }
    setLoading(false)
  }

  const inputStyle = {
    width: '100%', background: '#111318', border: '1px solid #2A2D35',
    borderRadius: 8, padding: '10px 14px', fontSize: 13,
    color: '#F4F4F5', outline: 'none', boxSizing: 'border-box' as const,
  }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: '#A1A1AA', marginBottom: 6, display: 'block' as const }
  const hintStyle = { fontSize: 11, color: '#52525B', marginTop: 4 }

  return (
    <div style={{ minHeight: '100vh', background: '#0B0D0F', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 520 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: 'white', margin: '0 auto 12px' }}>O</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F4F4F5' }}>Conecte sua loja</h1>
          <p style={{ fontSize: 13, color: '#71717A', marginTop: 4 }}>Configure suas integrações para começar a analisar</p>
        </div>

        {/* Steps indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {(['shopify', 'facebook'] as Step[]).map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: step === 'done' || (step === 'facebook' && i === 0) || step === s ? '#8B5CF6' : '#1E2028' }} />
          ))}
        </div>

        {step === 'done' ? (
          <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F4F4F5', marginBottom: 8 }}>Tudo pronto!</h2>
            <p style={{ fontSize: 13, color: '#71717A', marginBottom: 24 }}>Suas integrações foram salvas. Agora execute o coletor para importar os dados históricos.</p>
            <button onClick={() => router.push('/')} style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 8, padding: '11px 28px', fontSize: 14, fontWeight: 600, color: '#fff', cursor: 'pointer', width: '100%' }}>
              Ir para o Dashboard →
            </button>
          </div>
        ) : (
          <div style={{ background: '#111318', border: '1px solid #1E2028', borderRadius: 12, padding: 28 }}>

            {step === 'shopify' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(149,191,71,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🛍️</div>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F5' }}>Shopify</h2>
                    <p style={{ fontSize: 11, color: '#71717A' }}>Passo 1 de 2</p>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Domínio da loja</label>
                  <input value={shopifyDomain} onChange={e => setShopifyDomain(e.target.value)} placeholder="minhaloja.myshopify.com" style={inputStyle} />
                  <p style={hintStyle}>Sem https://, apenas o domínio</p>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Access Token</label>
                  <input value={shopifyToken} onChange={e => setShopifyToken(e.target.value)} placeholder="shpat_..." type="password" style={inputStyle} />
                  <p style={hintStyle}>
                    Shopify Admin → Configurações → Aplicativos → Desenvolver apps → Criar app → API credentials → Admin API access token
                  </p>
                </div>

                <div style={{ background: '#0B0D0F', borderRadius: 8, padding: '12px 14px', marginBottom: 20, border: '1px solid #1E2028' }}>
                  <p style={{ fontSize: 11, color: '#71717A', lineHeight: 1.6 }}>
                    <strong style={{ color: '#A1A1AA' }}>Permissões necessárias:</strong> read_orders, read_products, read_customers, read_checkouts, read_analytics
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 14px', background: 'rgba(139,92,246,0.06)', borderRadius: 8, border: '1px solid rgba(139,92,246,0.15)', cursor: 'pointer' }} onClick={() => setClaimLegacy(!claimLegacy)}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${claimLegacy ? '#8B5CF6' : '#3F3F46'}`, background: claimLegacy ? '#8B5CF6' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {claimLegacy && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                  </div>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#A78BFA' }}>Migrar dados existentes</p>
                    <p style={{ fontSize: 11, color: '#52525B' }}>Vincular dados históricos já no banco a este tenant</p>
                  </div>
                </div>

                {error && <p style={{ fontSize: 12, color: '#F43F5E', marginBottom: 12 }}>{error}</p>}

                <button onClick={() => setStep('facebook')} disabled={!shopifyDomain || !shopifyToken}
                  style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#fff', cursor: !shopifyDomain || !shopifyToken ? 'not-allowed' : 'pointer', opacity: !shopifyDomain || !shopifyToken ? 0.4 : 1, width: '100%' }}>
                  Próximo →
                </button>
              </>
            )}

            {step === 'facebook' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📘</div>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F5' }}>Facebook Ads</h2>
                    <p style={{ fontSize: 11, color: '#71717A' }}>Passo 2 de 2</p>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>ID da conta de anúncios</label>
                  <input value={fbAccountId} onChange={e => setFbAccountId(e.target.value)} placeholder="act_123456789" style={inputStyle} />
                  <p style={hintStyle}>Facebook Ads Manager → URL contém act_XXXXXXXXX</p>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Access Token</label>
                  <input value={fbToken} onChange={e => setFbToken(e.target.value)} placeholder="EAAx..." type="password" style={inputStyle} />
                  <p style={hintStyle}>
                    Meta Business Suite → Configurações → Usuários do sistema → Gerar token (ads_read, ads_management)
                  </p>
                </div>

                <div style={{ background: '#0B0D0F', borderRadius: 8, padding: '12px 14px', marginBottom: 20, border: '1px solid #1E2028' }}>
                  <p style={{ fontSize: 11, color: '#71717A', lineHeight: 1.6 }}>
                    <strong style={{ color: '#A1A1AA' }}>Dica:</strong> Use um System User Token (não expira) em vez de um token pessoal para evitar desconexões.
                  </p>
                </div>

                {error && <p style={{ fontSize: 12, color: '#F43F5E', marginBottom: 12 }}>{error}</p>}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setStep('shopify')} style={{ background: 'transparent', border: '1px solid #2A2D35', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#71717A', cursor: 'pointer', flex: 1 }}>
                    ← Voltar
                  </button>
                  <button onClick={submit} disabled={loading || !fbAccountId || !fbToken}
                    style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#fff', cursor: loading || !fbAccountId || !fbToken ? 'not-allowed' : 'pointer', opacity: loading || !fbAccountId || !fbToken ? 0.4 : 1, flex: 2 }}>
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
