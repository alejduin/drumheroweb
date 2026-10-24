import type { ChartV2, WaveformPeaks } from '@/types'
import type { SongAudioSources } from '@/audio/loadSongAudio'
import { matchAnalysisFiles } from '@/game/localAnalysis'
import type { SongBundle } from '@/game/GameSession'

// URLs que el navegador puede descargar; storage:// e idb:// las resuelve B13
const isFetchable = (url: string) => /^(https?:|blob:|\/)/.test(url)

/** Nombre del archivo de una URL ("storage://songs/Mi canción.mp3" → "Mi canción.mp3"). */
export function fileNameOf(url: string | null): string | null {
  if (!url) return null
  const name = url.split(/[/\\]/).pop()
  return name ? decodeURIComponent(name) : null
}

/** Canción incluida: usa su audio si el chart trae URLs descargables; si no, pista silenciosa. */
export function builtinBundle(chart: ChartV2): SongBundle {
  const stems =
    chart.stems && isFetchable(chart.stems.drums) && isFetchable(chart.stems.backing)
      ? chart.stems
      : null
  const original = chart.audioUrl && isFetchable(chart.audioUrl) ? chart.audioUrl : null
  const audio: SongAudioSources | null = stems || original ? { stems, original } : null
  return { chart, audio, peaks: null, fileName: audio ? fileNameOf(chart.audioUrl) : null }
}

function isPeaks(raw: unknown): raw is WaveformPeaks {
  const p = raw as WaveformPeaks
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.samplesPerPeak === 'number' &&
    typeof p.sampleRate === 'number' &&
    Array.isArray(p.peaks)
  )
}

/** Salida local del worker (chart.json + stems + peaks.json [+ MP3]) elegida por el usuario. */
export async function localAnalysisBundle(files: readonly File[]): Promise<SongBundle> {
  const match = matchAnalysisFiles(files)
  if (!match.ok) throw new Error(`Análisis incompleto: ${match.error}`)
  const { chart: chartFile, drums, backing, peaks: peaksFile, original } = match.files

  const { parseChart } = await import('@/chart/ChartParser')
  const chart = parseChart(JSON.parse(await chartFile.text()))
  let peaks: WaveformPeaks | null = null
  if (peaksFile) {
    const raw: unknown = JSON.parse(await peaksFile.text())
    peaks = isPeaks(raw) ? raw : null
  }

  return {
    chart,
    audio: { stems: drums && backing ? { drums, backing } : null, original },
    peaks,
    fileName: original?.name ?? fileNameOf(chart.audioUrl),
  }
}
