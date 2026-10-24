// ─── Referencia de la Fase A ──────────────────────────────────────────────────
// Golpes reales de una canción, grabados con la batería (A4). El evaluador del
// worker (A5) compara el chart generado contra este archivo:
// worker/poc/references/<songId>.json

import type { Piece } from './chart'

export interface ReferenceHit {
  /** Segundos desde el inicio del audio (reloj de la canción). */
  t: number
  piece: Piece
  /** Nota MIDI original (para remapear si la calibración cambia). */
  note: number
  velocity: number
}

/** Tramo de la canción grabado de una vez: sus golpes reemplazan a los anteriores del tramo. */
export interface ReferenceTake {
  startS: number
  endS: number
}

export interface ReferenceFile {
  version: 1
  /** Mismo id que el worker deriva del nombre del archivo (song_id_from_name). */
  songId: string
  audioFile: string
  audioSha256: string | null
  durationS: number
  recordedAt: string
  device: string | null
  /** Latencia de salida del audio estimada por el navegador, informativa (A5 estima el offset global). */
  outputLatencyMs: number
  takes: ReferenceTake[]
  hits: ReferenceHit[]
}
