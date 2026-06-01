'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Store {
  id: string
  shopify_domain: string | null
}

interface Props {
  stores: Store[]
  activeStoreId: string
}

export default function StoreSwitcher({ stores, activeStoreId }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const active = stores.find(s => s.id === activeStoreId)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function switchStore(storeId: string) {
    if (storeId === activeStoreId) { setOpen(false); return }
    setLoading(true)
    setOpen(false)
    await fetch('/api/active-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    })
    router.refresh()
    setLoading(false)
  }

  const badgeBase: React.CSSProperties = {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '6px 14px', fontSize: 12, color: 'var(--text-muted)',
    display: 'flex', alignItems: 'center', gap: 6,
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        style={{
          ...badgeBase,
          cursor: loading ? 'wait' : 'pointer',
          border: open ? '1px solid rgba(139,92,246,0.5)' : '1px solid var(--border)',
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
        {loading ? 'Trocando...' : (active?.shopify_domain ?? 'Loja conectada')}
        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 6, minWidth: 220,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {stores.length > 0 && (
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 8px 6px' }}>
              Suas lojas
            </p>
          )}
          {stores.map(store => (
            <button
              key={store.id}
              onClick={() => switchStore(store.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: store.id === activeStoreId ? 'rgba(139,92,246,0.1)' : 'transparent',
                border: 'none', borderRadius: 6, padding: '8px 10px', cursor: 'pointer',
                color: store.id === activeStoreId ? '#A78BFA' : 'var(--text-primary)',
                fontSize: 12, fontWeight: store.id === activeStoreId ? 600 : 400, textAlign: 'left',
              }}
            >
              <span style={{
                width: 16, height: 16, borderRadius: 4, background: 'rgba(139,92,246,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, flexShrink: 0,
              }}>
                {store.id === activeStoreId ? '✓' : ''}
              </span>
              {store.shopify_domain ?? 'Loja sem domínio'}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
            <a
              href="/onboarding?addStore=true"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 10px', borderRadius: 6, fontSize: 12,
                color: '#8B5CF6', textDecoration: 'none', fontWeight: 500,
              }}
            >
              <span style={{
                width: 16, height: 16, borderRadius: 4, background: 'rgba(139,92,246,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0,
              }}>+</span>
              Adicionar nova loja
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
