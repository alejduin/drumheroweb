// ─── PWA: registro del service worker (PLAN_V2 D8) ────────────────────────────
// Solo en producción: en `npm run dev` un SW cachearía módulos de Vite y estorbaría
// el HMR. El SW (pwa/sw.js → dist/sw.js) guarda el shell; el contenido está en IDB.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // Tras la carga: no compite con el arranque de la app por la red
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('No se pudo registrar el service worker', err)
    })
  })
}
