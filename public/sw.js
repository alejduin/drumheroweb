// Service worker de retiro. El de V1 era cache-first con un caché que nunca se
// invalidaba: seguía sirviendo el JS y las canciones de V1 tras actualizar. Este
// borra los cachés y se da de baja: la siguiente recarga ya va a la red.
// La PWA real (shell + IndexedDB) llega en PLAN_V2 D8.

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
      await self.registration.unregister()
    })(),
  )
})
