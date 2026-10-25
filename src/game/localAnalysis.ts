// ─── Análisis local del worker ────────────────────────────────────────────────
// Hasta B13 (almacenamiento) se puede jugar la salida de `worker/poc/run.py`
// eligiendo los archivos de su carpeta: chart.json + drums.ogg + backing.ogg +
// peaks.json (y el MP3 original, opcional, como respaldo si fallan los stems).

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.opus', '.webm']

export interface AnalysisFiles<F> {
  chart: F
  drums: F | null
  backing: F | null
  peaks: F | null
  original: F | null
}

export type AnalysisMatch<F> = { ok: true; files: AnalysisFiles<F> } | { ok: false; error: string }

const isAudio = (name: string) => AUDIO_EXTENSIONS.some(ext => name.endsWith(ext))
const isJson = (name: string) => name.endsWith('.json')

/** Nombre sin extensión ni sufijo de copia del navegador o del sistema ("chart (1).json" → "chart"). */
function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).replace(/\s*\(\d+\)$/, '').trim()
}

/**
 * Reconoce los archivos por nombre (tolera mayúsculas y copias "chart (1).json").
 * Hace falta el chart y algún audio (stems o MP3).
 */
export function matchAnalysisFiles<F extends { name: string }>(
  files: readonly F[],
): AnalysisMatch<F> {
  const named = files.map(file => ({ file, name: file.name.toLowerCase() }))
  const find = (pred: (name: string, base: string) => boolean) =>
    named.find(({ name }) => pred(name, baseName(name)))?.file ?? null

  const peaks = find((n, base) => isJson(n) && base === 'peaks')
  // chart.json; si no, el único JSON que no es peaks
  const otherJson = named.filter(({ name, file }) => isJson(name) && file !== peaks)
  const chart =
    find((n, base) => isJson(n) && base === 'chart') ??
    (otherJson.length === 1 ? otherJson[0].file : null)
  if (!chart) {
    const received = files.map(f => f.name).join(', ') || 'ninguno'
    return { ok: false, error: `falta chart.json (se recibieron: ${received})` }
  }

  const drums = find((n, base) => isAudio(n) && base === 'drums')
  const backing = find((n, base) => isAudio(n) && base === 'backing')
  const original = find((n, base) => isAudio(n) && base !== 'drums' && base !== 'backing')

  const hasStems = drums !== null && backing !== null
  if (!hasStems && !original) {
    return { ok: false, error: 'faltan los stems (drums y backing) o el MP3 original' }
  }
  return { ok: true, files: { chart, drums, backing, peaks, original } }
}
