'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSettings } from '@/contexts/SettingsContext'

interface Props {
  lastSyncIso: string | null
}

export default function AutoSync({ lastSyncIso }: Props) {
  const router = useRouter()
  const { autoRefreshInterval } = useSettings()
  const [syncing, setSyncing] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const triggeredRef    = useRef(false)
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  function clearPoll() {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
    if (pollTimeoutRef.current)  { clearTimeout(pollTimeoutRef.current);   pollTimeoutRef.current  = null }
  }

  async function triggerAndPoll() {
    if (syncing) return
    setSyncing(true)
    const triggerTime = Date.now()
    try {
      await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    } catch {
      setSyncing(false)
      return
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/sync-status')
        const { lastSync } = await res.json()
        if (lastSync && new Date(lastSync).getTime() > triggerTime) {
          clearPoll()
          setSyncing(false)
          router.refresh()
        }
      } catch { /* keep polling */ }
    }, 5000)

    pollTimeoutRef.current = setTimeout(() => {
      clearPoll()
      setSyncing(false)
      router.refresh()
    }, 180_000)
  }

  // On mount: sync if > 5 min since last sync
  useEffect(() => {
    if (triggeredRef.current) return
    triggeredRef.current = true
    const lastMs = lastSyncIso ? new Date(lastSyncIso).getTime() : 0
    if ((Date.now() - lastMs) / 60000 > 5) triggerAndPoll()
    return () => clearPoll()
  }, [])

  // Periodic auto-refresh based on settings
  useEffect(() => {
    if (syncIntervalRef.current) { clearInterval(syncIntervalRef.current); syncIntervalRef.current = null }
    if (countdownRef.current)    { clearInterval(countdownRef.current);    countdownRef.current    = null }
    if (autoRefreshInterval <= 0) { setCountdown(0); return }

    const intervalMs = autoRefreshInterval * 60 * 1000
    setCountdown(autoRefreshInterval * 60)

    // Countdown ticker (every second)
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) return autoRefreshInterval * 60
        return c - 1
      })
    }, 1000)

    // Sync trigger
    syncIntervalRef.current = setInterval(() => {
      triggerAndPoll()
    }, intervalMs)

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
      if (countdownRef.current)    clearInterval(countdownRef.current)
    }
  }, [autoRefreshInterval])

  if (!syncing && autoRefreshInterval <= 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 200,
      background: 'rgba(17,19,24,0.95)', border: `1px solid ${syncing ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 10, padding: '9px 16px', fontSize: 12,
      color: syncing ? '#A78BFA' : 'var(--text-faint, #71717A)',
      display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600,
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      backdropFilter: 'blur(8px)',
      transition: 'border-color 0.3s, color 0.3s',
    }}>
      {syncing ? (
        <>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: '#A78BFA',
            display: 'inline-block', flexShrink: 0,
            animation: 'autosync-pulse 1.1s ease-in-out infinite alternate',
          }} />
          <style>{`@keyframes autosync-pulse { from { opacity: 0.3; transform: scale(0.85) } to { opacity: 1; transform: scale(1) } }`}</style>
          Atualizando dados de hoje...
        </>
      ) : (
        <>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-faint, #71717A)', display: 'inline-block', flexShrink: 0, opacity: 0.5 }} />
          Próx. atualização em {countdown >= 60 ? `${Math.floor(countdown / 60)}min` : `${countdown}s`}
        </>
      )}
    </div>
  )
}
