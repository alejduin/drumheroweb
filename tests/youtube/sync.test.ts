import { describe, expect, it } from 'vitest'
import {
  CORRECTION_COOLDOWN_MS,
  DRIFT_CONFIRM_FRAMES,
  DRIFT_CORRECT_MS,
  DriftCorrector,
  VideoTimeEstimator,
  computeDrift,
  mapPlayerState,
  videoTimeFor,
} from '@/youtube/sync'

describe('computeDrift', () => {
  it('video − (canción + offset), en ms', () => {
    expect(computeDrift(10.05, 10, 0)).toBeCloseTo(50)
    expect(computeDrift(9.98, 10, 0)).toBeCloseTo(-20)
    // video con 2 s de intro: en el segundo 10 de la canción debería ir por el 12
    expect(videoTimeFor(10, 2000)).toBe(12)
    expect(computeDrift(12, 10, 2000)).toBeCloseTo(0)
    expect(computeDrift(12.1, 10, 2000)).toBeCloseTo(100)
  })
})

describe('mapPlayerState', () => {
  it('YT.PlayerState → estado propio', () => {
    expect([-1, 0, 1, 2, 3, 5, 99].map(mapPlayerState)).toEqual([
      'unstarted',
      'ended',
      'playing',
      'paused',
      'buffering',
      'cued',
      'unstarted',
    ])
  })
})

describe('VideoTimeEstimator', () => {
  it('interpola entre valores crudos y re-ancla con cada valor nuevo', () => {
    const e = new VideoTimeEstimator()
    expect(e.sample(5, 1000, true, 1)).toBe(5)
    expect(e.sample(5, 1100, true, 1)).toBeCloseTo(5.1) // el valor crudo no cambió
    expect(e.sample(5, 1200, true, 0.5)).toBeCloseTo(5.1) // a media velocidad
    expect(e.sample(5.25, 1250, true, 1)).toBe(5.25) // nuevo ancla
  })

  it('en pausa no interpola', () => {
    const e = new VideoTimeEstimator()
    e.sample(5, 1000, false, 1)
    expect(e.sample(5, 2000, false, 1)).toBe(5)
  })
})

describe('DriftCorrector (histéresis)', () => {
  const over = DRIFT_CORRECT_MS + 1

  it('corrige solo tras DRIFT_CONFIRM_FRAMES frames seguidos por encima del umbral', () => {
    const c = new DriftCorrector()
    const results = Array.from({ length: DRIFT_CONFIRM_FRAMES }, (_, i) =>
      c.shouldCorrect(over, i * 16),
    )
    expect(results).toEqual([...Array(DRIFT_CONFIRM_FRAMES - 1).fill(false), true])
  })

  it('un frame por debajo reinicia la cuenta; el umbral exacto no corrige', () => {
    const c = new DriftCorrector()
    c.shouldCorrect(over, 0)
    c.shouldCorrect(over, 16)
    expect(c.shouldCorrect(DRIFT_CORRECT_MS, 32)).toBe(false)
    expect(c.shouldCorrect(-over, 48)).toBe(false)
    expect(c.shouldCorrect(-over, 64)).toBe(false)
    expect(c.shouldCorrect(-over, 80)).toBe(true) // también hacia atrás
  })

  it('tras corregir espera el enfriamiento', () => {
    const c = new DriftCorrector()
    for (let i = 0; i < DRIFT_CONFIRM_FRAMES; i++) c.shouldCorrect(over, i)
    let t = DRIFT_CONFIRM_FRAMES
    for (; t < CORRECTION_COOLDOWN_MS; t += 16) expect(c.shouldCorrect(500, t)).toBe(false)
    const after = [0, 1, 2].map(i => c.shouldCorrect(500, CORRECTION_COOLDOWN_MS + 100 + i))
    expect(after.at(-1)).toBe(true)
  })

  it('una corrección forzada (seek) también cuenta para el enfriamiento', () => {
    const c = new DriftCorrector()
    c.corrected(0)
    for (let t = 0; t < CORRECTION_COOLDOWN_MS; t += 16) expect(c.shouldCorrect(500, t)).toBe(false)
  })
})
