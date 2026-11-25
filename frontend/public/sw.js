/* Opero AI — service worker for the mobile PWA.
 * Handles web-push delivery, notification taps and subscription rotation.
 * Deliberately does NOT cache the app shell or API responses: this dashboard
 * is only useful with live data, and a stale cache would be worse than a
 * spinner. */

const VERSION = 'opero-v3'

self.addEventListener('install', () => {
  // Take over immediately so a redeploy doesn't leave an old worker handling push.
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

/** What a push is about. Senders set `kind`; the order webhook sends a sale
 *  with an orderId (and may not set kind). Anything else is not a sale. */
function kindOf(payload) {
  const data = payload.data || {}
  if (payload.kind) return payload.kind
  if (data.kind === 'sale' || (!data.kind && data.orderId)) return 'sale'
  return data.kind ? 'alert' : 'other'
}

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Opero AI', body: event.data ? event.data.text() : '' }
  }

  const kind = kindOf(payload)
  const title = payload.title || 'Opero AI'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: payload.tag || 'opero',
    // Each sale is its own event worth seeing, so don't collapse silently.
    renotify: Boolean(payload.tag),
    vibrate: [80, 40, 80],
    data: { ...(payload.data || {}), pushKind: kind, url: payload.url || '/m', version: VERSION },
    timestamp: Date.now(),
  }

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    // Tell any open tab. Only a sale is announced as one — the app plays the
    // cash-register sound for it; an alert or a summary just asks for a reload.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const message = kind === 'sale'
        ? { type: 'sale', payload: payload.data || {} }
        : { type: 'push', kind, payload: payload.data || {} }
      for (const client of clients) client.postMessage(message)
    }),
  ]))
})

/**
 * Where a tap goes. Every push carries the dates it is about
 * (lib/period notificationHref). Older scale alerts pointed at /campaigns,
 * which needs a partner login: they open the phone on the alert's store,
 * campaigns tab, as a push (origem=push). They carry no date, so the phone
 * opens them on its saved period and says so ("Notificação antiga, sem data").
 */
function targetOf(data) {
  const home = new URL('/m', self.location.origin)
  let u
  try { u = new URL(data.url || '/m', self.location.origin) } catch { return home.href }
  if (u.origin !== self.location.origin) return home.href
  if (u.pathname === '/campaigns' || u.pathname.startsWith('/campaigns/')) {
    if (data.tenantId) home.searchParams.set('loja', String(data.tenantId))
    home.searchParams.set('aba', 'campanhas')
    home.searchParams.set('origem', 'push')
    return home.href
  }
  return u.href
}

/** Same-origin path of a client URL ('' when it cannot be parsed). */
function pathOf(url) {
  try { return new URL(url).pathname } catch { return '' }
}

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data || {}
  // The payload's URL, e.g. /m?loja=<id>&aba=campanhas: the store (and tab)
  // the alert is about. Only this app's own pages are opened, whatever a
  // payload carries.
  const target = targetOf(data)

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const app = clients.find(c => {
      const p = pathOf(c.url)
      return p === '/m' || p.startsWith('/m/')
    })
    if (!app) {
      // A window of this app that is not on /m: take it there; else a new one.
      const other = clients.find(c => { try { return new URL(c.url).origin === self.location.origin } catch { return false } })
      if (other && 'navigate' in other) {
        try {
          const navigated = await other.navigate(target)
          if (navigated) return navigated.focus()
        } catch { /* not controlled by this worker */ }
      }
      return self.clients.openWindow(target)
    }
    // An open /m: ALWAYS post the URL, even when the window already shows it
    // (a re-tap of the same notification is a fresh open, lib/period R16/R17),
    // never client.navigate (a reload would read as a restore).
    app.postMessage({ type: 'navigate', url: target })
    return 'focus' in app ? app.focus() : undefined
  })())
})

/**
 * The push service rotated or dropped the subscription (browser update, key
 * change). Subscribe again with the same server key and tell the server, so
 * pushes keep arriving without the owner reopening the app. Same-origin fetch
 * carries the opero_m cookie.
 */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      let key = event.oldSubscription && event.oldSubscription.options
        ? event.oldSubscription.options.applicationServerKey
        : null
      if (!key) {
        const res = await fetch('/api/push/subscribe', { credentials: 'same-origin' })
        const info = res.ok ? await res.json() : null
        if (!info || !info.vapidPublicKey) return
        key = urlBase64ToUint8Array(info.vapidPublicKey)
      }
      const sub = event.newSubscription
        || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (event.oldSubscription && event.oldSubscription.endpoint !== sub.endpoint) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
        })
      }
    } catch (err) {
      console.error('[sw] resubscribe failed', err)
    }
  })())
})

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
