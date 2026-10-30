/**
 * Savera Paradise - Advanced Background Service Worker
 * Handles:
 * 1. PWA Offline Caching & App Shell
 * 2. Background Notifications even when website/browser tabs are closed
 * 3. Web Push Events & OS Notification Click routing
 * 4. Background Supabase Order Polling & Sync Channel
 */

const CACHE_NAME = 'crispy-pwa-v23';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/admin.html',
  '/delivery.html',
  '/owner.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/icon-192.svg',
  '/icon-512.svg'
];

// Install Event - Pre-cache App Shell & immediately take over
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[SW] Pre-caching asset failed (ignorable):', err);
      });
    })
  );
});

// Activate Event - Purge All Outdated Caches Immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network First with Cache Fallback for PWA reliability
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Only handle same-origin requests in the service worker
  // Let the browser manage cross-origin CDNs, tile servers, and APIs natively
  if (url.origin !== self.location.origin) {
    return;
  }

  // Avoid caching Supabase REST, live APIs, Cloudflare storage, or tokens
  if (url.origin.includes('supabase.co') || 
      url.origin.includes('cloudflarestorage.com') || 
      url.pathname.startsWith('/api/') ||
      url.searchParams.has('tracking_token') ||
      url.searchParams.has('access_token')) {
    return;
  }

  // For HTML navigation, always fetch fresh from network when online to guarantee instant updates
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (url.pathname.startsWith('/admin')) return caches.match('/admin.html');
          if (url.pathname.startsWith('/delivery')) return caches.match('/delivery.html');
          if (url.pathname.startsWith('/owner')) return caches.match('/owner.html');
          return caches.match('/index.html');
        }))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push Event - Receives Web Push when app is closed
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Savera Paradise Alert', body: event.data ? event.data.text() : 'New order update!' };
  }

  const title = data.title || '🔔 Savera Paradise Order Update';
  const options = {
    body: data.body || 'Your order status has updated!',
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    tag: data.tag || 'quickbite-order',
    data: {
      url: data.url || '/',
      orderId: data.orderId || ''
    },
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: 'open_order', title: '👀 View Details' },
      { action: 'dismiss', title: '✕ Dismiss' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification Click Event - Focus or Open App Window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Find matching client that has the targetUrl path
      const targetPath = new URL(targetUrl, self.location.origin).pathname;
      for (const client of windowClients) {
        if ('focus' in client) {
          const clientPath = new URL(client.url).pathname;
          if (clientPath === targetPath) {
            return client.focus();
          }
        }
      }
      // If not already open, open a fresh window to the target portal
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Message Listener from Web Pages (Allows background tabs to trigger notifications)
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const defaultIcon = options?.icon || '/icon-192.svg';
    self.registration.showNotification(title, {
      icon: defaultIcon,
      badge: defaultIcon,
      renotify: true,
      vibrate: [180, 90, 180, 90, 240],
      actions: [
        { action: 'open_app', title: '📍 Open App' },
        { action: 'dismiss', title: '✕ Dismiss' }
      ],
      ...options
    });
  }
});
