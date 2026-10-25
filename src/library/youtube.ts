// ─── URL de YouTube (opcional, solo para ver el video silenciado) ────────────

const ID = /^[A-Za-z0-9_-]{11}$/
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])

/** Id del video (11 caracteres) o null si la URL no es de un video de YouTube. */
export function parseYouTubeId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  let id: string | null = null
  if (url.hostname === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0]
  } else if (HOSTS.has(url.hostname)) {
    const [, first, second] = url.pathname.split('/')
    if (first === 'watch') id = url.searchParams.get('v')
    else if (first === 'shorts' || first === 'embed' || first === 'live') id = second ?? null
  }
  return id && ID.test(id) ? id : null
}

/** URL canónica para guardar en el chart. */
export const youTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
