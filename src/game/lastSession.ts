import type { ChartGrid, ChartSection, ChartV2, Difficulty } from '@/types'
import { measureAt } from '@/chart/grid'
import { sectionIndexAt, sectionStartS } from './sections'

// ─── Última sesión (B15: "Continuar" en la portada) ───────────────────────────

/** De dónde se vuelve a cargar la canción. El análisis local (archivos sueltos) no se guarda. */
export type SongRef = { kind: 'builtin'; id: string } | { kind: 'library'; id: string }

export interface LastSession {
  song: SongRef
  title: string
  artist: string
  /** Sección donde se dejó la partida; null = desde el principio. */
  section: { name: string; startMeasure: number } | null
  /** Hoy siempre 'full' y 1: el reductor y el control de tempo llegan en la Fase D. */
  difficulty: Difficulty
  tempo: number
  updatedAt: number // Date.now()
}

export interface SessionSnapshotInput {
  song: SongRef
  chart: Pick<ChartV2, 'title' | 'artist' | 'grid'>
  sections: readonly ChartSection[]
  /** Posición del reloj al guardar; null = partida terminada (se vuelve a empezar). */
  positionS: number | null
  difficulty: Difficulty
  tempo: number
  now: number
}

/** Foto de la sesión: se guarda la sección que contiene la posición actual. */
export function sessionSnapshot(input: SessionSnapshotInput): LastSession {
  const { song, chart, sections, positionS, difficulty, tempo, now } = input
  const index = positionS === null ? -1 : sectionIndexAt(sections, measureAt(chart.grid, positionS))
  const section = index >= 0 ? sections[index] : null
  return {
    song,
    title: chart.title,
    artist: chart.artist,
    section: section ? { name: section.name, startMeasure: section.startMeasure } : null,
    difficulty,
    tempo,
    updatedAt: now,
  }
}

/**
 * Segundo en el que retomar: el inicio de la sección guardada. Si el chart cambió y la
 * sección ya no existe (otro nombre o compás), se empieza desde el principio.
 */
export function resumePositionS(
  session: Pick<LastSession, 'section'>,
  grid: ChartGrid,
  sections: readonly ChartSection[],
): number {
  const saved = session.section
  if (!saved) return 0
  const section = sections.find(s => s.name === saved.name && s.startMeasure === saved.startMeasure)
  return section ? sectionStartS(grid, section) : 0
}

export function sameSong(a: SongRef, b: SongRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

/** "Coro 1 · Completo · tempo 100%" (tarjeta Continuar de la portada). */
export function sessionSummary(
  session: Pick<LastSession, 'section' | 'difficulty' | 'tempo'>,
  difficultyLabel: string,
): string {
  return [
    session.section ? session.section.name : 'Desde el principio',
    difficultyLabel,
    `tempo ${Math.round(session.tempo * 100)}%`,
  ].join(' · ')
}
