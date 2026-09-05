/* Opero AI — service worker for the mobile PWA.
 * Handles web-push delivery and notification taps. Deliberately does NOT
 * cache app shell or API responses: this dashboard is only useful with live
 * data, and a stale cache would be worse than a spinner. */

const VERSION = 'opero-v1'

self.addEventListener('install', () => {
  // Take over immediately so a redeploy doesn't leave an old worker handling push.
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Opero AI', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Opero AI'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: payload.tag || 'opero',
    // Each sale is its own event worth seeing, so don't collapse silently.
    renotify: Boolean(payload.tag),
    vibrate: [80, 40, 80],
    data: { url: payload.url || '/m', ...(payload.data || {}) },
    timestamp: Date.now(),
  }

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    // Tell any open tab a sale landed, so it can chime and refresh right away
    // instead of waiting up to a full poll interval to notice.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        client.postMessage({ type: 'sale', payload: payload.data || {} })
      }
    }),
  ]))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/m'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus an already-open tab rather than stacking new ones.
      for (const client of clients) {
        if (client.url.includes('/m') && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(target)
    })
  )
})
