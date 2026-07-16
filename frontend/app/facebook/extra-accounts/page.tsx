'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

type AdAccount = { id: string; name: string; account_status: number }

function ExtraAccountsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isManual = searchParams.get('manual') === 'true'

  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [loading, setLoading]   = useState(!isManual)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [manualId, setManualId] = useState('')

  useEffect(() => {
    if (isManual) return
    fetch('/api/facebook/extra-accounts/pending')
      .then(r => r.json())
      .then(d => { setAccounts(d.accounts || []); setLoading(false) })
      .catch(() => { setError('Erro ao carregar contas'); setLoading(false) })
  }, [isManual])

  async function select(accountId: string) {
    const id = accountId.trim().replace(/^act_/, '')
    if (!id) { setError('ID inválido'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/facebook/extra-accounts/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fb_ad_account_id: `act_${id}` }),
      })
      if (!res.ok) throw new Error('Falha ao salvar conta')
      router.push('/settings?fb_extra_connected=true')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
      setSaving(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    background: '#111318', border: '1px solid #1E2028', borderRadius: 16,
    padding: 32, width: '100%', maxWidth: 480,
  }

  if (isManual) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B0D0F', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={cardStyle}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F4F4F5', marginBottom: 6 }}>Adicionar conta extra de anúncios</h1>
            <p style={{ fontSize: 13, color: '#71717A' }}>
              Não encontramos contas vinculadas automaticamente. Cole o ID da conta do Facebook Ads abaixo (ex: <span style={{ color: '#A78BFA' }}>act_123456789</span> ou só os números).
            </p>
          </div>

          {error && <p style={{ color: '#F43F5E', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={manualId}
              onChange={e => setManualId(e.target.value)}
              placeholder="act_1234567890 ou 1234567890"
              style={{
                flex: 1, background: '#1A1D23', border: '1px solid #2A2D35', borderRadius: 8,
                padding: '10px 14px', fontSize: 13, color: '#F4F4F5', outline: 'none',
              }}
            />
            <button
              onClick={() => select(manualId)}
              disabled={saving || !manualId.trim()}
              style={{
                padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: saving || !manualId.trim() ? '#2A2D35' : '#8B5CF6',
                color: saving || !manualId.trim() ? '#52525B' : '#fff',
                border: 'none', cursor: saving || !manualId.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>

          <p style={{ fontSize: 11, color: '#52525B', marginTop: 12 }}>
            Você encontra o ID da conta no Gerenciador de Anúncios do Facebook → configurações da conta.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0B0D0F', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={cardStyle}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F4F4F5', marginBottom: 6 }}>Adicionar conta extra de anúncios</h1>
          <p style={{ fontSize: 13, color: '#71717A' }}>Escolha qual conta do Facebook Ads adicionar a esta loja.</p>
        </div>

        {loading && <p style={{ color: '#71717A', fontSize: 13 }}>Carregando contas...</p>}
        {error   && <p style={{ color: '#F43F5E', fontSize: 13 }}>{error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {accounts.map(acc => (
            <button
              key={acc.id}
              onClick={() => select(acc.id)}
              disabled={saving}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px', borderRadius: 10, border: '1px solid #2A2D35',
                background: 'transparent', cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'border-color 0.15s, background 0.15s', textAlign: 'left',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#8B5CF6'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(139,92,246,0.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2A2D35'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F5', marginBottom: 2 }}>{acc.name}</p>
                <p style={{ fontSize: 11, color: '#52525B' }}>{acc.id}</p>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
                background: acc.account_status === 1 ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
                color: acc.account_status === 1 ? '#10B981' : '#F43F5E',
                border: `1px solid ${acc.account_status === 1 ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)'}`,
              }}>
                {acc.account_status === 1 ? 'Ativa' : 'Inativa'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ExtraAccountsPickerPage() {
  return (
    <Suspense>
      <ExtraAccountsContent />
    </Suspense>
  )
}
