import type { Difficulty, Level } from '@/types'
import type { PracticeLayer } from '@/chart/layers'

// ─── Historial, racha, meta semanal e insignias (PLAN_V2 D7) ──────────────────
// Todo se deriva de la lista de partidas: la racha, los minutos de la semana y las
// insignias (con la fecha en que se ganaron). Así basta con sincronizar `plays`
// para que sobrevivan a reinstalar. Los días son del calendario local del usuario.

/** Práctica mínima para guardar una partida que no llegó al final. */
export const MIN_PLAY_S = 15
/** Notas evaluadas mínimas para que un 100 % cuente como insignia. */
export const PERFECT_MIN_NOTES = 16
export const DEFAULT_WEEKLY_GOAL_MIN = 120
export const WEEKLY_GOAL_OPTIONS = [30, 60, 120, 180, 300] as const
/** Partidas que se guardan en el navegador (las más nuevas). */
export const MAX_LOCAL_PLAYS = 2000

/** Una partida o rato de práctica sobre una canción. */
export interface PlayEntry {
  /** uuid generado en el navegador: guardar o sincronizar dos veces no duplica. */
  id: string
  songId: string
  title: string
  difficulty: Difficulty
  level: Level
  tempo: number
  layer: PracticeLayer
  waitMode: boolean
  /** Llegó al final de la canción (Resultados). */
  completed: boolean
  score: number
  precision: number | null
  /** Notas evaluadas (Perfecto + Cerca + Fallo). */
  evaluated: number
  /** Tiempo real tocando (sin pausas), en segundos. */
  durationS: number
  playedAt: number // Date.now()
}

export interface PlayInput {
  songId: string
  title: string
  difficulty: Difficulty
  level: Level
  tempo: number
  layer: PracticeLayer
  waitMode: boolean
  completed: boolean
  score: number
  precision: number | null
  counts: { perfect: number; close: number; miss: number }
  durationS: number
}

/** Entrada del historial al terminar o dejar una partida. */
export function playEntry(input: PlayInput, id: string, playedAt: number): PlayEntry {
  const { counts, ...rest } = input
  return { ...rest, id, evaluated: counts.perfect + counts.close + counts.miss, playedAt }
}

// ─── Días del calendario local ────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatters.set(key, f)
  }
  return f
}

/** Número de día (días desde 1970-01-01) del calendario en `timeZone` (por defecto, el local). */
export function dayNumber(ms: number, timeZone?: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value)
  return Math.round(Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000)
}

/** Lunes de la semana del día `day` (1970-01-01 fue jueves). */
function mondayOf(day: number): number {
  return day - ((day + 3) % 7)
}

// ─── Racha ────────────────────────────────────────────────────────────────────

export interface Streak {
  /** Días seguidos con práctica hasta hoy (o hasta ayer, si hoy aún no tocó). */
  days: number
  /** Ya practicó hoy. */
  today: boolean
}

export function currentStreak(
  plays: readonly Pick<PlayEntry, 'playedAt'>[],
  now: number,
  timeZone?: string,
): Streak {
  const days = new Set(plays.map(p => dayNumber(p.playedAt, timeZone)))
  const today = dayNumber(now, timeZone)
  const playedToday = days.has(today)
  let day = playedToday ? today : today - 1
  let count = 0
  while (days.has(day)) {
    count++
    day--
  }
  return { days: count, today: playedToday }
}

// ─── Meta semanal ─────────────────────────────────────────────────────────────

/** Minutos practicados en la semana (lunes a domingo) que contiene `now`. */
export function weekMinutes(
  plays: readonly Pick<PlayEntry, 'playedAt' | 'durationS'>[],
  now: number,
  timeZone?: string,
): number {
  const monday = mondayOf(dayNumber(now, timeZone))
  let seconds = 0
  for (const p of plays) {
    const day = dayNumber(p.playedAt, timeZone)
    if (day >= monday && day < monday + 7) seconds += p.durationS
  }
  return Math.floor(seconds / 60)
}

// ─── Insignias ────────────────────────────────────────────────────────────────

export const BADGES = [
  'first_complete',
  'first_perfect',
  'streak_7',
  'streak_30',
  'hours_10',
] as const
export type BadgeId = (typeof BADGES)[number]

export const BADGE_INFO: Record<BadgeId, { label: string; hint: string }> = {
  first_complete: { label: 'Primera canción', hint: 'Toca una canción hasta el final' },
  first_perfect: {
    label: 'Primer 100 %',
    hint: `100 % de precisión con al menos ${PERFECT_MIN_NOTES} notas (sin modo espera)`,
  },
  streak_7: { label: '7 días seguidos', hint: 'Practica 7 días seguidos' },
  streak_30: { label: '30 días seguidos', hint: 'Practica 30 días seguidos' },
  hours_10: { label: '10 horas', hint: 'Suma 10 horas de práctica' },
}

/** 100 % que cuenta como hito: suficientes notas y con timing real (sin modo espera). */
export function isPerfectPlay(p: Pick<PlayEntry, 'precision' | 'evaluated' | 'waitMode'>): boolean {
  return p.precision === 1 && p.evaluated >= PERFECT_MIN_NOTES && !p.waitMode
}

/** Insignias ganadas y cuándo (la partida que la dio), recorriendo el historial en orden. */
export function earnedBadges(
  plays: readonly PlayEntry[],
  timeZone?: string,
): Partial<Record<BadgeId, number>> {
  const earned: Partial<Record<BadgeId, number>> = {}
  const give = (id: BadgeId, at: number) => {
    if (earned[id] === undefined) earned[id] = at
  }
  let lastDay: number | null = null
  let streak = 0
  let seconds = 0
  for (const p of [...plays].sort((a, b) => a.playedAt - b.playedAt)) {
    if (p.completed) give('first_complete', p.playedAt)
    if (isPerfectPlay(p)) give('first_perfect', p.playedAt)
    const day = dayNumber(p.playedAt, timeZone)
    if (day !== lastDay) {
      streak = lastDay !== null && day === lastDay + 1 ? streak + 1 : 1
      lastDay = day
    }
    if (streak >= 7) give('streak_7', p.playedAt)
    if (streak >= 30) give('streak_30', p.playedAt)
    seconds += p.durationS
    if (seconds >= 10 * 3600) give('hours_10', p.playedAt)
  }
  return earned
}

/** Insignias que dio esta partida (para avisar en Resultados). */
export function badgesFrom(
  plays: readonly PlayEntry[],
  playId: string,
  timeZone?: string,
): BadgeId[] {
  const play = plays.find(p => p.id === playId)
  if (!play) return []
  const earned = earnedBadges(plays, timeZone)
  return BADGES.filter(id => earned[id] === play.playedAt)
}

/** "Racha: 6 días · meta semanal 85 / 120 min" (pie de Resultados). */
export function progressLine(streak: Streak, minutes: number, goalMin: number): string {
  const days = streak.days === 1 ? '1 día' : `${streak.days} días`
  return `Racha: ${days} · meta semanal ${minutes} / ${goalMin} min`
}

// ─── Resumen para la portada ──────────────────────────────────────────────────

export interface ProgressSummary {
  streak: Streak
  weekMin: number
  goalMin: number
  badges: Partial<Record<BadgeId, number>>
  /** Últimas partidas, las más nuevas primero. */
  recent: PlayEntry[]
}

export const RECENT_PLAYS = 3

export function progressSummary(
  plays: readonly PlayEntry[],
  now: number,
  goalMin: number,
  timeZone?: string,
): ProgressSummary {
  return {
    streak: currentStreak(plays, now, timeZone),
    weekMin: weekMinutes(plays, now, timeZone),
    goalMin,
    badges: earnedBadges(plays, timeZone),
    recent: [...plays].sort((a, b) => b.playedAt - a.playedAt).slice(0, RECENT_PLAYS),
  }
}

/** "hoy", "ayer", "hace 3 días" o la fecha (historial de la portada). */
export function dayLabel(ms: number, now: number, timeZone?: string): string {
  const diff = dayNumber(now, timeZone) - dayNumber(ms, timeZone)
  if (diff <= 0) return 'hoy'
  if (diff === 1) return 'ayer'
  if (diff < 7) return `hace ${diff} días`
  return new Intl.DateTimeFormat('es', { timeZone, day: 'numeric', month: 'short' }).format(ms)
}
