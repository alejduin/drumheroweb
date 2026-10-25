import { describe, expect, it } from 'vitest'
import { START_LEAD_S } from '@/audio/StemPlayer'
import type { FrameScheduler } from '@/engine/GameEngine'
import { CALIBRATION_HITS, COUNT_IN_BEATS, MAX_HIT_DISTANCE_MS } from '@/calibration/latency'
import { LatencyCalibration } from '@/calibration/LatencyCalibration'
import type { CalibrationContext, CalibrationProgress } from '@/calibration/LatencyCalibration'
import { FakeAudioContext } from '../fakes/FakeAudioContext'

class FakeCalibrationContext extends FakeAudioContext implements CalibrationContext {
  state: AudioContextState = 'suspended'
  closed = false

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

async function setup() {
  const ctx = new FakeCalibrationContext()
  ctx.outputLatency = 0
  ctx.baseLatency = 0
  let noteOn: ((n: { timestamp: number }) => void) | null = null
  const scheduler: FrameScheduler = { request: () => 1, cancel: () => {} }
  const calibration = new LatencyCalibration({
    createContext: () => ctx,
    subscribeNoteOn: callback => {
      noteOn = callback
      return () => (noteOn = null)
    },
    scheduler,
    // performance.now() = tiempo del contexto: el golpe en perf ms cae en ese instante
    perfNow: () => ctx.currentTime * 1000,
  })
  const updates: CalibrationProgress[] = []
  calibration.subscribe(p => updates.push(p))
  await calibration.start()

  const beatCtx = (i: number) => calibration.grid.beats[i] + START_LEAD_S
  /** Golpe `offsetMs` después del click medido k. */
  const hit = (k: number, offsetMs: number) => {
    const ctxT = beatCtx(COUNT_IN_BEATS + k) + offsetMs / 1000
    ctx.currentTime = ctxT
    noteOn?.({ timestamp: ctxT * 1000 })
  }
  const advanceTo = (ctxT: number) => {
    ctx.currentTime = ctxT
    calibration.tick()
  }
  return { ctx, calibration, updates, hit, advanceTo, beatCtx, isSubscribed: () => noteOn !== null }
}

describe('LatencyCalibration', () => {
  it('arranca el contexto y agenda la pista de clicks', async () => {
    const { ctx, calibration } = await setup()
    expect(ctx.state).toBe('running')
    expect(calibration.state.phase).toBe('count-in')
    calibration.tick()
    expect(ctx.oscillators).toHaveLength(0) // el primer click todavía no entra en el lookahead
    ctx.currentTime = calibration.grid.beats[0] + START_LEAD_S - 0.1
    calibration.tick()
    expect(ctx.oscillators.filter(o => !o.cancelled).map(o => o.startAt)).toEqual([
      calibration.grid.beats[0] + START_LEAD_S,
    ])
  })

  it('mide golpe − click con el reloj de audio y termina al octavo golpe', async () => {
    const { calibration, hit, isSubscribed } = await setup()
    const offsets = [24, 26, 25, 23, 27, 25, 90, 25]
    offsets.forEach((ms, k) => hit(k, ms))
    const { phase, samples, result } = calibration.state
    expect(phase).toBe('done')
    samples.forEach((s, k) => expect(s).toBeCloseTo(offsets[k], 6))
    expect(result!.discarded).toBeCloseTo(90, 6)
    expect(result!.latencyMs).toBe(25)
    expect(isSubscribed()).toBe(false)
  })

  it('un golpe por click: rebotes, entrada y golpes lejanos no cuentan', async () => {
    const { calibration, hit, ctx } = await setup()
    hit(0, 10)
    hit(0, 30) // rebote del mismo click
    hit(1, MAX_HIT_DISTANCE_MS + 20) // demasiado lejos
    // golpe con la entrada
    ctx.currentTime = calibration.grid.beats[1] + START_LEAD_S
    calibration.handleHit(ctx.currentTime * 1000)
    expect(calibration.state.samples.filter(s => s !== null)).toHaveLength(1)
    expect(calibration.state.samples[0]).toBeCloseTo(10, 6)
  })

  it('avisa el click actual y pasa de la entrada a la medición', async () => {
    const { calibration, updates, advanceTo, beatCtx } = await setup()
    advanceTo(beatCtx(0) + 0.01)
    expect(calibration.state).toMatchObject({ beat: 0, phase: 'count-in' })
    advanceTo(beatCtx(0) + 0.02)
    const notified = updates.length
    advanceTo(beatCtx(COUNT_IN_BEATS) + 0.01)
    expect(calibration.state).toMatchObject({ beat: COUNT_IN_BEATS, phase: 'measuring' })
    expect(updates.length).toBe(notified + 1) // por click, no por frame
  })

  it('al pasar el último click termina con los golpes que haya', async () => {
    const { calibration, hit, advanceTo, beatCtx } = await setup()
    ;[20, 21, 19, 20, 22].forEach((ms, k) => hit(k, ms))
    advanceTo(beatCtx(COUNT_IN_BEATS + CALIBRATION_HITS - 1) + MAX_HIT_DISTANCE_MS / 1000 + 0.01)
    expect(calibration.state.phase).toBe('done')
    expect(calibration.state.result!.latencyMs).toBe(20)
  })

  it('con pocos golpes termina sin resultado', async () => {
    const { calibration, hit, advanceTo, beatCtx } = await setup()
    hit(0, 20)
    hit(5, 20)
    advanceTo(beatCtx(COUNT_IN_BEATS + CALIBRATION_HITS - 1) + 1)
    expect(calibration.state.phase).toBe('done')
    expect(calibration.state.result).toBeNull()
  })

  it('dispose cancela los clicks pendientes y cierra el contexto', async () => {
    const { calibration, ctx } = await setup()
    ctx.currentTime = calibration.grid.beats[0] + START_LEAD_S - 0.1
    calibration.tick()
    calibration.dispose()
    expect(ctx.oscillators.every(o => o.cancelled)).toBe(true)
    expect(ctx.closed).toBe(true)
  })
})
