// ─── PWA: lista de precache del service worker (PLAN_V2 D8) ───────────────────
// Se calcula al compilar sobre dist/: el shell (index.html, JS, CSS, fuentes woff2,
// iconos, charts de ejemplo) queda disponible sin conexión. El contenido del
// usuario (audio, stems, charts) ya vive en IndexedDB.

/** Lo que no se precachea: el propio SW, mapas de fuentes y fuentes woff (basta woff2). */
const SKIP = [/^sw\.js$/, /\.map$/, /\.woff$/, /(^|\/)\./]

/** Archivos de dist/ (rutas relativas con /) → URLs a precachear, ordenadas. */
export function precacheList(files: readonly string[]): string[] {
  return files
    .map(f => f.replace(/\\/g, '/'))
    .filter(f => !SKIP.some(re => re.test(f)))
    .map(f => (f === 'index.html' ? '/' : `/${f}`))
    .sort()
}

/** El SW final: la plantilla con la lista y la versión inyectadas. */
export function serviceWorkerSource(template: string, urls: readonly string[], version: string): string {
  if (!template.includes('self.__PRECACHE__') || !template.includes('self.__VERSION__')) {
    throw new Error('plantilla del service worker sin marcadores __PRECACHE__/__VERSION__')
  }
  return template
    .replace('self.__PRECACHE__', JSON.stringify(urls))
    .replace('self.__VERSION__', JSON.stringify(version))
}
