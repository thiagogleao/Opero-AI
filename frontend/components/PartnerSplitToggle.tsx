'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function PartnerSplitToggle({ isSplit }: { isSplit: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  function toggle() {
    setPending(true)
    if (isSplit) {
      document.cookie = 'split_50=; path=/; max-age=0'
    } else {
      document.cookie = 'split_50=true; path=/; max-age=31536000'
    }
    router.refresh()
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={isSplit ? 'Mostrando sua parte (50%) — clique para ver lucro total' : 'Clique para ver somente sua parte (50%)'}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
        border: `1px solid ${isSplit ? '#8B5CF6' : 'var(--border)'}`,
        background: isSplit ? 'rgba(139,92,246,0.15)' : 'var(--bg-surface)',
        color: isSplit ? '#A78BFA' : 'var(--text-faint)',
        cursor: pending ? 'wait' : 'pointer',
        transition: 'all 0.15s', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 14 }}>{isSplit ? '👤' : '👥'}</span>
      {isSplit ? 'Minha parte (50%)' : 'Lucro total'}
    </button>
  )
}
