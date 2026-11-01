// ─── Service worker de DrumHero (PLAN_V2 D8) ──────────────────────────────────
// Plantilla: el build (pwa/plugin.ts) inyecta la lista de precache y la versión.
// - Navegación: red primero; sin red, el index.html guardado (la app abre offline).
// - Shell precacheado (JS/CSS con hash, fuentes, iconos): caché primero.
// - Otros GET del mismo origen: caché y se actualiza por detrás.
// - Supabase, YouTube y el worker local (otros orígenes) nunca pasan por aquí.
// Audio, stems y charts del usuario viven en IndexedDB, no en este caché.

const PRECACHE = self.__PRECACHE__
const VERSION = self.__VERSION__
const CACHE = `drumhero-shell-${VERSION}`
const PRECACHED = new Set(PRECACHE)

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      // Incluye los cachés del SW de V1 (cache-first que nunca se invalidaba)
      await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

async function networkFirstPage(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE)
      await cache.put('/', response.clone())
    }
    return response
  } catch {
    const cached = await caches.match('/', { cacheName: CACHE })
    return cached ?? Response.error()
  }
}

async function cacheFirst(request, path) {
  const cached = await caches.match(path, { cacheName: CACHE })
  return cached ?? fetch(request)
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(event.request)
  const refresh = fetch(event.request)
    .then(response => {
      if (response.ok) void cache.put(event.request, response.clone())
      return response
    })
    .catch(() => cached ?? Response.error())
  if (cached) {
    event.waitUntil(refresh)
    return cached
  }
  return refresh
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Rangos de audio/video (si los hubiera) van directo a la red
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request))
  } else if (PRECACHED.has(url.pathname)) {
    event.respondWith(cacheFirst(request, url.pathname))
  } else {
    event.respondWith(staleWhileRevalidate(event))
  }
})
