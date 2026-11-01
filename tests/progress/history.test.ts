import { describe, expect, it } from 'vitest'
import {
  MIN_PLAY_S,
  PERFECT_MIN_NOTES,
  badgesFrom,
  currentStreak,
  dayLabel,
  dayNumber,
  earnedBadges,
  isPerfectPlay,
  playEntry,
  progressLine,
  progressSummary,
  weekMinutes,
} from '@/progress/history'
import type { PlayEntry } from '@/progress/history'

const MADRID = 'Europe/Madrid'
const BOGOTA = 'America/Bogota'
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Mediodía UTC del día `d` de noviembre de 2026 (1 = domingo... 2 = lunes). */
const nov = (d: number, hourUtc = 12) => Date.UTC(2026, 10, d, hourUtc)

let seq = 0
function play(playedAt: number, over: Partial<PlayEntry> = {}): PlayEntry {
  return {
    id: `p${seq++}`,
    songId: 's',
    title: 'Canción',
    difficulty: 'full',
    level: 'intermediate',
    tempo: 1,
    layer: 'full',
    waitMode: false,
    completed: false,
    score: 1000,
    precision: 0.9,
    evaluated: 100,
    durationS: 600,
    playedAt,
    ...over,
  }
}

describe('dayNumber', () => {
  it('el día depende de la zona horaria', () => {
    // 23:30 UTC del 3 de noviembre: en Madrid ya es día 4, en Bogotá sigue el 3
    const t = nov(3, 23) + 30 * 60_000
    expect(dayNumber(t, MADRID) - dayNumber(t, BOGOTA)).toBe(1)
    expect(dayNumber(nov(3), 'UTC')).toBe(Date.UTC(2026, 10, 3) / DAY)
  })
})

describe('currentStreak', () => {
  it('cuenta días seguidos hasta hoy; varias partidas el mismo día son un día', () => {
    const plays = [play(nov(2)), play(nov(3)), play(nov(4)), play(nov(4) + HOUR)]
    expect(currentStreak(plays, nov(4, 20), 'UTC')).toEqual({ days: 3, today: true })
  })

  it('si hoy aún no tocó, la racha de ayer sigue viva', () => {
    expect(currentStreak([play(nov(2)), play(nov(3))], nov(4), 'UTC')).toEqual({
      days: 2,
      today: false,
    })
  })

  it('un día saltado la corta', () => {
    expect(currentStreak([play(nov(1)), play(nov(2)), play(nov(4))], nov(4), 'UTC').days).toBe(1)
    expect(currentStreak([play(nov(1)), play(nov(2))], nov(4), 'UTC').days).toBe(0)
    expect(currentStreak([], nov(4), 'UTC')).toEqual({ days: 0, today: false })
  })

  it('usa el calendario local: tocar a las 23:30 y a las 00:30 son dos días', () => {
    // Bogotá = UTC−5: 04:30 UTC del 4 = 23:30 del 3 allí; 05:30 UTC = 00:30 del 4
    const plays = [play(nov(4, 4) + 30 * 60_000), play(nov(4, 5) + 30 * 60_000)]
    expect(currentStreak(plays, nov(4, 12), BOGOTA).days).toBe(2)
    expect(currentStreak(plays, nov(4, 12), 'UTC').days).toBe(1)
  })
})

describe('weekMinutes', () => {
  it('suma la semana de lunes a domingo de `now`', () => {
    // 2 de noviembre de 2026 es lunes
    const plays = [
      play(nov(1), { durationS: 3000 }), // domingo anterior: no cuenta
      play(nov(2), { durationS: 600 }),
      play(nov(5), { durationS: 1230 }),
      play(nov(8), { durationS: 600 }), // domingo: cuenta
      play(nov(9), { durationS: 600 }), // lunes siguiente: no
    ]
    expect(weekMinutes(plays, nov(6), 'UTC')).toBe(40) // 2430 s → 40 min
    expect(weekMinutes(plays, nov(9), 'UTC')).toBe(10)
  })

  it('el corte del lunes sigue la zona horaria', () => {
    // 03:00 UTC del lunes 2 = domingo 1 a las 22:00 en Bogotá
    const plays = [play(nov(2, 3), { durationS: 600 })]
    expect(weekMinutes(plays, nov(3), 'UTC')).toBe(10)
    expect(weekMinutes(plays, nov(3), BOGOTA)).toBe(0)
  })
})

describe('insignias', () => {
  it('primera canción completa y primer 100 % con fecha', () => {
    const plays = [
      play(nov(2), { completed: true }),
      play(nov(3), { precision: 1, evaluated: PERFECT_MIN_NOTES }),
    ]
    expect(earnedBadges(plays, 'UTC')).toEqual({ first_complete: nov(2), first_perfect: nov(3) })
  })

  it('un 100 % con pocas notas o en modo espera no cuenta', () => {
    expect(isPerfectPlay({ precision: 1, evaluated: PERFECT_MIN_NOTES - 1, waitMode: false })).toBe(
      false,
    )
    expect(isPerfectPlay({ precision: 1, evaluated: 50, waitMode: true })).toBe(false)
    expect(isPerfectPlay({ precision: 0.99, evaluated: 50, waitMode: false })).toBe(false)
  })

  it('7 días seguidos: se gana el séptimo día, y un hueco reinicia la cuenta', () => {
    const days = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11]
    const plays = days.map(d => play(nov(d)))
    expect(earnedBadges(plays, 'UTC').streak_7).toBe(nov(11))
    expect(earnedBadges(plays.slice(0, -1), 'UTC').streak_7).toBeUndefined()
  })

  it('10 horas acumuladas', () => {
    const plays = Array.from({ length: 10 }, (_, i) => play(nov(1) + i * HOUR, { durationS: 3600 }))
    expect(earnedBadges(plays, 'UTC').hours_10).toBe(nov(1) + 9 * HOUR)
  })

  it('badgesFrom dice qué insignias dio una partida', () => {
    const first = play(nov(2), { completed: true })
    const second = play(nov(3), { completed: true })
    expect(badgesFrom([second, first], first.id, 'UTC')).toEqual(['first_complete'])
    expect(badgesFrom([second, first], second.id, 'UTC')).toEqual([])
    expect(badgesFrom([], 'x')).toEqual([])
  })
})

describe('resumen y textos', () => {
  it('progressSummary y la línea de Resultados', () => {
    const plays = [play(nov(2), { durationS: 1800 }), play(nov(3), { durationS: 3300 })]
    const s = progressSummary(plays, nov(3), 120, 'UTC')
    expect(s.streak).toEqual({ days: 2, today: true })
    expect(s.weekMin).toBe(85)
    expect(s.recent.map(p => p.playedAt)).toEqual([nov(3), nov(2)])
    expect(progressLine(s.streak, s.weekMin, s.goalMin)).toBe(
      'Racha: 2 días · meta semanal 85 / 120 min',
    )
    expect(progressLine({ days: 1, today: true }, 0, 60)).toBe(
      'Racha: 1 día · meta semanal 0 / 60 min',
    )
  })

  it('dayLabel', () => {
    expect(dayLabel(nov(4), nov(4, 20), 'UTC')).toBe('hoy')
    expect(dayLabel(nov(3), nov(4), 'UTC')).toBe('ayer')
    expect(dayLabel(nov(1), nov(4), 'UTC')).toBe('hace 3 días')
    expect(dayLabel(Date.UTC(2026, 9, 20, 12), nov(4), 'UTC')).toMatch(/20/)
  })

  it('playEntry cuenta las notas evaluadas', () => {
    const entry = playEntry(
      {
        songId: 's',
        title: 'T',
        difficulty: 'basic',
        level: 'expert',
        tempo: 0.75,
        layer: 'hihat',
        waitMode: false,
        completed: true,
        score: 10,
        precision: 0.5,
        counts: { perfect: 3, close: 2, miss: 5 },
        durationS: MIN_PLAY_S,
      },
      'id',
      nov(1),
    )
    expect(entry).toMatchObject({ id: 'id', evaluated: 10, playedAt: nov(1), layer: 'hihat' })
    expect(entry).not.toHaveProperty('counts')
  })
})
