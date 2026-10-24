import type { Measure, NoteEvent, Section, SongData } from '@/types'

// ─── Tipos del JSON crudo (antes de parsear) ──────────────────────────────────

interface RawNote {
  beat: number
  subdivision: number
  instrument: string
  midi: number
}

interface RawMeasure {
  number: number
  notes: RawNote[]
}

interface RawSection {
  name: string
  startMeasure: number
  endMeasure: number
}

interface RawSong {
  id: string
  title: string
  artist?: string
  difficulty?: string
  bpm: number
  timeSignature?: [number, number]
  youtubeUrl?: string | null
  youtubeOffsetMs?: number
  measures: RawMeasure[]
  sections?: RawSection[]
}

// ─── Cálculo de tiempo absoluto ───────────────────────────────────────────────

/**
 * Convierte una posición en la canción a milisegundos desde el inicio.
 *
 * @param measure    Número de compás (base 1)
 * @param beat       Número de beat dentro del compás (base 1)
 * @param subdivision  Fracción dentro del beat (0=beat, 0.5=corchea, etc.)
 * @param bpm        Tempo en beats por minuto
 * @param beatsPerMeasure  Numerador del compás (4 en 4/4)
 */
export function positionToMs(
  measure: number,
  beat: number,
  subdivision: number,
  bpm: number,
  beatsPerMeasure: number,
): number {
  const msPerBeat = 60_000 / bpm
  const completedMeasures = measure - 1
  const completedBeats = beat - 1 + subdivision
  return (completedMeasures * beatsPerMeasure + completedBeats) * msPerBeat
}

// ─── Parser principal ─────────────────────────────────────────────────────────

/**
 * Parsea un objeto JSON crudo a SongData tipado.
 * Calcula absoluteTimeMs para cada nota.
 * Lanza si el JSON no tiene los campos mínimos requeridos.
 */
export function parseSong(raw: unknown): SongData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('parseSong: el argumento debe ser un objeto')
  }

  const r = raw as RawSong

  if (!r.id || !r.title || typeof r.bpm !== 'number' || !Array.isArray(r.measures)) {
    throw new Error('parseSong: faltan campos requeridos (id, title, bpm, measures)')
  }

  if (r.bpm <= 0) {
    throw new Error(`parseSong: bpm inválido (${r.bpm})`)
  }

  const timeSignature: [number, number] = r.timeSignature ?? [4, 4]
  const beatsPerMeasure = timeSignature[0]

  const measures: Measure[] = r.measures.map(rawMeasure => {
    const notes: NoteEvent[] = rawMeasure.notes.map(rawNote => ({
      beat: rawNote.beat,
      subdivision: rawNote.subdivision,
      instrument: rawNote.instrument as NoteEvent['instrument'],
      midi: rawNote.midi,
      absoluteTimeMs: positionToMs(
        rawMeasure.number,
        rawNote.beat,
        rawNote.subdivision,
        r.bpm,
        beatsPerMeasure,
      ),
    }))

    return { number: rawMeasure.number, notes }
  })

  const sections: Section[] = (r.sections ?? []).map(s => ({
    name: s.name,
    startMeasure: s.startMeasure,
    endMeasure: s.endMeasure,
  }))

  return {
    id: r.id,
    title: r.title,
    artist: r.artist ?? 'Desconocido',
    difficulty: (r.difficulty as SongData['difficulty']) ?? 'beginner',
    bpm: r.bpm,
    timeSignature,
    youtubeUrl: r.youtubeUrl ?? null,
    youtubeOffsetMs: r.youtubeOffsetMs ?? 0,
    measures,
    sections,
  }
}

/**
 * Aplana todos los NoteEvents de una canción en un array ordenado por absoluteTimeMs.
 * Usado por GameEngine para iterar notas en orden cronológico.
 */
export function flattenNotes(song: SongData): NoteEvent[] {
  return song.measures.flatMap(m => m.notes).sort((a, b) => a.absoluteTimeMs - b.absoluteTimeMs)
}
