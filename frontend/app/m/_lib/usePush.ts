'use client'

/**
 * This device's push notifications, with a status the owner can trust.
 *
 * Production ran for days with zero subscriptions while the old button hid
 * itself as soon as the browser permission said "granted". The status here is
 * the subscription itself, checked against the server (`known`) and against
 * the server's current key: a device subscribed with an old key, or pruned on
 * the server, is repaired silently when permission allows, else shown as
 * "não inscrito".
 */

import { useCallback, useEffect, useState } from 'react'
import { sameServerKey, urlBase64ToUint8Array } from './pushKeys'

export type PushStatus =
  | 'verificando'
  | 'sem_suporte'      // no service worker / Push API
  | 'instalar'         // iPhone: push only works from the home-screen app
  | 'sem_chave'        // the server has no VAPID key configured
  | 'bloqueado'        // permission denied in the system settings
  | 'nao_inscrito'
  | 'inscrito'

export interface PushState {
  status: PushStatus
  /** Devices the server would push to. */
  devices: number | null
  busy: boolean
  /** The last action's outcome, in words. */
  note: string | null
  error: string | null
}

interface ServerInfo { devices: number; vapidPublicKey: string | null; known: boolean | null }

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

async function serverInfo(endpoint?: string): Promise<ServerInfo> {
  const q = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''
  const res = await fetch(`/api/push/subscribe${q}`, { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) throw new Error(res.status === 404 ? 'Sessão expirada neste aparelho' : `Servidor respondeu ${res.status}`)
  return res.json() as Promise<ServerInfo>
}

async function postSubscription(sub: PushSubscription): Promise<number> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
  if (!res.ok) throw new Error(`O servidor recusou a inscrição (${res.status})`)
  const body = await res.json() as { devices?: number }
  return body.devices ?? 0
}

async function deleteEndpoint(endpoint: string) {
  await fetch('/api/push/subscribe', {
    method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {})
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

async function subscribeFresh(reg: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
}

export function usePush() {
  const [st, setSt] = useState<PushState>({ status: 'verificando', devices: null, busy: false, note: null, error: null })
  const patch = useCallback((p: Partial<PushState>) => setSt(s => ({ ...s, ...p })), [])

  /** Look at the device and the server; repair what can be repaired silently. */
  const check = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
      patch({ status: isIos() && !standalone() ? 'instalar' : 'sem_suporte' })
      return
    }
    try {
      const reg = await registration()
      let sub = await reg.pushManager.getSubscription()
      const info = await serverInfo(sub?.endpoint)
      if (!info.vapidPublicKey) { patch({ status: 'sem_chave', devices: info.devices }); return }
      if (Notification.permission === 'denied') { patch({ status: 'bloqueado', devices: info.devices }); return }
      if (!sub) { patch({ status: 'nao_inscrito', devices: info.devices }); return }

      let devices = info.devices
      let repaired: string | null = null
      if (sameServerKey(sub.options.applicationServerKey, info.vapidPublicKey) === false) {
        // Subscribed with a key the server no longer signs with: every push
        // to it would be refused. Permission is already granted, so no prompt.
        const old = sub.endpoint
        await sub.unsubscribe().catch(() => false)
        sub = await subscribeFresh(reg, info.vapidPublicKey)
        devices = await postSubscription(sub)
        if (old !== sub.endpoint) await deleteEndpoint(old)
        repaired = 'Inscrição refeita com a chave atual do servidor.'
      } else if (info.known === false) {
        // Pruned on the server (or never saved) while the device kept it.
        devices = await postSubscription(sub)
        repaired = 'Inscrição deste aparelho registrada de novo no servidor.'
      }
      patch({ status: 'inscrito', devices, note: repaired, error: null })
    } catch (err) {
      patch({ status: 'nao_inscrito', error: (err as Error).message })
    }
  }, [patch])

  useEffect(() => {
    // Defer one tick: the check is async and must not run during render.
    const t = setTimeout(() => { void check() }, 0)
    return () => clearTimeout(t)
  }, [check])

  /** Ask permission (must start from the tap) and subscribe. */
  const enable = useCallback(async () => {
    if (!('Notification' in window)) return
    patch({ busy: true, error: null, note: null })
    try {
      // First thing in the tap: iOS refuses the prompt after an await.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        patch({ busy: false, status: permission === 'denied' ? 'bloqueado' : 'nao_inscrito', note: permission === 'denied' ? null : 'Permissão não concedida.' })
        return
      }
      const reg = await registration()
      const info = await serverInfo()
      if (!info.vapidPublicKey) { patch({ busy: false, status: 'sem_chave' }); return }
      let sub = await reg.pushManager.getSubscription()
      if (sub && sameServerKey(sub.options.applicationServerKey, info.vapidPublicKey) === false) {
        const old = sub.endpoint
        await sub.unsubscribe().catch(() => false)
        await deleteEndpoint(old)
        sub = null
      }
      sub ??= await subscribeFresh(reg, info.vapidPublicKey)
      const devices = await postSubscription(sub)
      patch({ busy: false, status: 'inscrito', devices, note: 'Notificações ativadas neste aparelho.' })
    } catch (err) {
      patch({ busy: false, error: (err as Error).message })
    }
  }, [patch])

  const disable = useCallback(async () => {
    patch({ busy: true, error: null, note: null })
    try {
      const reg = await registration()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await deleteEndpoint(sub.endpoint)
        await sub.unsubscribe()
      }
      const info = await serverInfo().catch(() => null)
      patch({ busy: false, status: 'nao_inscrito', devices: info?.devices ?? null, note: 'Este aparelho não recebe mais notificações.' })
    } catch (err) {
      patch({ busy: false, error: (err as Error).message })
    }
  }, [patch])

  /** POST /api/push/test: says how many devices it actually reached. */
  const test = useCallback(async () => {
    patch({ busy: true, error: null, note: null })
    try {
      const res = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin' })
      if (!res.ok) throw new Error(`O servidor respondeu ${res.status}`)
      const r = await res.json() as { sent: number; failed: number; rejected: number; devices: number }
      const parts = [`Enviado para ${r.sent} de ${r.devices} ${r.devices === 1 ? 'aparelho' : 'aparelhos'}.`]
      if (r.rejected > 0) parts.push(`${r.rejected} recusou a chave do servidor: abra o app nesse aparelho para refazer a inscrição.`)
      else if (r.failed > 0) parts.push(`${r.failed} falhou.`)
      patch({ busy: false, devices: r.devices, note: parts.join(' ') })
    } catch (err) {
      patch({ busy: false, error: (err as Error).message })
    }
  }, [patch])

  return { ...st, enable, disable, test, recheck: check }
}
