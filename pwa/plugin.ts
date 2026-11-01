import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { precacheList, serviceWorkerSource } from './precache'

/** Versión del caché: cambia si cambia cualquier archivo precacheado. */
function cacheVersion(entries: readonly { url: string; content: Uint8Array }[]): string {
  const hash = createHash('sha256')
  for (const { url, content } of entries) {
    hash.update(url)
    hash.update(content)
  }
  return hash.digest('hex').slice(0, 12)
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** Escribe dist/sw.js con el precache del build (solo en `vite build`). */
export function serviceWorkerPlugin(templatePath = resolve(__dirname, 'sw.js')): Plugin {
  let config: ResolvedConfig
  return {
    name: 'drumhero-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    closeBundle() {
      const outDir = resolve(config.root, config.build.outDir)
      const files = walk(outDir).map(path => relative(outDir, path))
      const urls = precacheList(files)
      const entries = urls.map(url => ({
        url,
        content: readFileSync(join(outDir, url === '/' ? 'index.html' : url.slice(1))),
      }))
      const source = serviceWorkerSource(
        readFileSync(templatePath, 'utf8'),
        urls,
        cacheVersion(entries),
      )
      writeFileSync(join(outDir, 'sw.js'), source)
    },
  }
}
