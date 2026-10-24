const CACHE = 'drumhero-v1'

// Recursos del app shell que se precargan al instalar el SW
const PRECACHE = ['/', '/index.html', '/manifest.json', '/favicon.svg']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)),
  )
  // Activar inmediatamente sin esperar a que se cierren otras pestañas
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  // Borrar caches viejos
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  // Solo interceptar GET. Dejar pasar peticiones de otros orígenes (YouTube, etc.)
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  // No cachear archivos internos de Vite (HMR, módulos virtuales)
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules/.vite/')) return

  event.respondWith(
    caches.match(event.request).then(cached => {
      // Cache-first: si existe en caché lo devolvemos, si no hacemos fetch y cacheamos
      if (cached) return cached
      return fetch(event.request).then(response => {
        // Solo cachear respuestas válidas
        if (!response || response.status !== 200 || response.type !== 'basic') return response
        const clone = response.clone()
        caches.open(CACHE).then(cache => cache.put(event.request, clone))
        return response
      })
    }),
  )
})
