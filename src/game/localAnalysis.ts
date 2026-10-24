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
const stem = (name: string) => name.slice(0, name.lastIndexOf('.'))

/** Reconoce los archivos por nombre. Hace falta chart.json y algún audio (stems o MP3). */
export function matchAnalysisFiles<F extends { name: string }>(
  files: readonly F[],
): AnalysisMatch<F> {
  const byName = (pred: (name: string) => boolean) =>
    files.find(f => pred(f.name.toLowerCase())) ?? null

  const chart = byName(n => n === 'chart.json')
  if (!chart) return { ok: false, error: 'falta chart.json' }

  const drums = byName(n => isAudio(n) && stem(n) === 'drums')
  const backing = byName(n => isAudio(n) && stem(n) === 'backing')
  const peaks = byName(n => n === 'peaks.json')
  const original = byName(n => isAudio(n) && stem(n) !== 'drums' && stem(n) !== 'backing')

  const hasStems = drums !== null && backing !== null
  if (!hasStems && !original) {
    return { ok: false, error: 'faltan los stems (drums y backing) o el MP3 original' }
  }
  return { ok: true, files: { chart, drums, backing, peaks, original } }
}
