import { describe, expect, it } from 'vitest'
import type { TimedJudgement } from '@/engine/GameEngine'
import {
  BADGE_DURATION_MS,
  GLOW_DURATION_MS,
  HitEffects,
  badgeText,
  effectProgress,
} from '@/renderer/EffectsRenderer'
import { NoteStates } from '@/renderer/noteStates'
import { createTimeline, timeToX, visibleSlice, visibleWindow } from '@/renderer/timeline'

const hit = (
  noteIndex: number,
  judgement: 'perfect' | 'close',
  timing: 'early' | 'on_time' | 'late' = 'on_time',
  dynamicBonus = 0,
): TimedJudgement => ({
  judgement,
  noteIndex,
  piece: 'snare',
  deltaMs: 0,
  timing,
  points: judgement === 'perfect' ? 100 : 50,
  dynamicBonus,
  velocity: 80,
  t: noteIndex,
})
const miss = (noteIndex: number): TimedJudgement => ({
  judgement: 'miss',
  noteIndex,
  piece: 'kick',
  t: noteIndex,
})
const wrong: TimedJudgement = {
  judgement: 'wrong_pad',
  piece: 'ride',
  expectedPiece: 'snare',
  velocity: 80,
  t: 0,
}

describe('NoteStates', () => {
  it('marca cada nota con su juicio; el pad incorrecto no cambia nada', () => {
    const states = new NoteStates(4)
    ;[hit(0, 'perfect'), hit(1, 'close', 'early'), miss(2), wrong].forEach(j => states.apply(j))
    expect([0, 1, 2, 3].map(i => states.stateOf(i))).toEqual(['perfect', 'close', 'miss', 'future'])
    expect([0, 1, 2, 3].map(i => states.timingOf(i))).toEqual(['on_time', 'early', null, null])
  })

  it('rebuild deja solo los juicios vigentes (seek)', () => {
    const states = new NoteStates(3)
    ;[hit(0, 'perfect'), hit(1, 'perfect'), miss(2)].forEach(j => states.apply(j))
    states.rebuild([hit(0, 'perfect')])
    expect([0, 1, 2].map(i => states.stateOf(i))).toEqual(['perfect', 'future', 'future'])
  })
})

describe('HitEffects', () => {
  it('badge con el texto del juicio y su puntaje', () => {
    expect(badgeText(hit(0, 'perfect'))).toBe('PERFECTO +100')
    expect(badgeText(hit(0, 'close', 'on_time', 10))).toBe('CERCA +60')
    expect(badgeText(miss(0))).toBe('FALLO')
    expect(badgeText(wrong)).toBeNull()
  })

  it('el golpe crea resplandor y badge; el Fallo solo badge; el pad incorrecto, anillo gris', () => {
    const effects = new HitEffects()
    effects.push(hit(0, 'perfect'), 150, 1000)
    effects.push(miss(1), 200, 1010)
    effects.push(wrong, 120, 1020)
    expect(effects.glows.map(g => g.kind)).toEqual(['perfect', 'wrong'])
    expect(effects.badge?.text).toBe('FALLO')
  })

  it('se apagan con el tiempo real', () => {
    const effects = new HitEffects()
    effects.push(hit(0, 'perfect'), 150, 1000)
    effects.prune(1000 + GLOW_DURATION_MS - 1)
    expect(effects.glows).toHaveLength(1)
    effects.prune(1000 + GLOW_DURATION_MS)
    expect(effects.glows).toHaveLength(0)
    expect(effects.badge).not.toBeNull()
    effects.prune(1000 + BADGE_DURATION_MS)
    expect(effects.badge).toBeNull()
    expect(effectProgress(1000, 100, 1050)).toBe(0.5)
    expect(effectProgress(1000, 100, 999)).toBeNull()
  })
})

describe('timeline', () => {
  it('línea de golpe al 17 % y 3,5 s visibles por delante', () => {
    const timeline = createTimeline(1000)
    expect(timeline.hitX).toBe(170)
    expect(timeToX(timeline, 13.5, 10)).toBeCloseTo(1000, 6)
    expect(createTimeline(1000, 2).pxPerSecond).toBeCloseTo(timeline.pxPerSecond * 2, 6)
    const { fromT, toT } = visibleWindow(timeline, 10, 0)
    expect(timeToX(timeline, fromT, 10)).toBeCloseTo(0, 6)
    expect(toT).toBeCloseTo(13.5, 6)
  })

  it('visibleSlice por búsqueda binaria', () => {
    const items = [0, 1, 2, 3, 4].map(t => ({ t }))
    expect(visibleSlice(items, 1, 3)).toEqual([1, 4])
    expect(visibleSlice(items, 5, 9)).toEqual([5, 5])
  })
})
