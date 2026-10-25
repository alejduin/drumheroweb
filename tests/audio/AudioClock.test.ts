import { describe, expect, it } from 'vitest'
import { AudioClock } from '@/audio/AudioClock'
import { FakeAudioContext } from '../fakes/FakeAudioContext'

function setup() {
  const ctx = new FakeAudioContext()
  let perf = 10_000 // ms
  const clock = new AudioClock(ctx, () => perf)
  const advance = (seconds: number) => {
    ctx.currentTime += seconds
    perf += seconds * 1000
  }
  return { ctx, clock, advance, perf: () => perf }
}

describe('AudioClock', () => {
  it('convierte entre canción y contexto con el rate; epoch cambia con cada ancla', () => {
    const { clock } = setup()
    const epochs = [clock.epoch]
    expect(clock.songToCtx(5)).toBeNull()
    clock.start(2, 10, 0.5) // la posición 10 s suena en ctx = 2, a media velocidad
    epochs.push(clock.epoch)
    expect(clock.songToCtx(11)).toBeCloseTo(4)
    expect(clock.songAtCtx(4)).toBeCloseTo(11)
    expect(clock.songAtCtx(1.5)).toBe(10) // antes del arranque agendado
    clock.seek(3)
    epochs.push(clock.epoch)
    clock.pause()
    epochs.push(clock.epoch)
    expect(clock.songAtCtx(100)).toBe(clock.now())
    expect(new Set(epochs).size).toBe(4)
  })

  it('detenido devuelve la posición fija', () => {
    const { clock, advance } = setup()
    expect(clock.isPlaying).toBe(false)
    expect(clock.now()).toBe(0)
    clock.seek(12.5)
    advance(3)
    expect(clock.now()).toBe(12.5)
    expect(clock.perfToSong(99_999)).toBe(12.5)
  })

  it('sin getOutputTimestamp resta outputLatency al tiempo del contexto', () => {
    const { ctx, clock, advance } = setup()
    ctx.currentTime = 1
    clock.start(1, 30) // la posición 30 s suena en ctx = 1
    advance(2)
    expect(clock.now()).toBeCloseTo(30 + 2 - 0.02, 9)
  })

  it('usa baseLatency si no hay outputLatency', () => {
    const { ctx, clock, advance } = setup()
    ctx.outputLatency = undefined
    clock.start(0, 0)
    advance(1)
    expect(clock.now()).toBeCloseTo(1 - 0.01, 9)
    expect(clock.outputLatencyS()).toBe(0.01)
  })

  it('perfToSong traduce un timestamp MIDI con getOutputTimestamp', () => {
    const { ctx, clock, advance, perf } = setup()
    clock.start(0, 10)
    advance(5)
    // El DAC está sacando el audio del contexto 4.97 s en el instante perf() - 1 ms
    ctx.outputTimestamp = { contextTime: 4.97, performanceTime: perf() - 1 }
    const hitPerf = perf() - 101 // golpe 100 ms antes de esa marca
    expect(clock.perfToSong(hitPerf)).toBeCloseTo(10 + 4.97 - 0.1, 9)
  })

  it('perfToSong sin getOutputTimestamp usa el desfase respecto a performance.now()', () => {
    const { clock, advance, perf } = setup()
    clock.start(0, 0)
    advance(2)
    expect(clock.perfToSong(perf() - 250)).toBeCloseTo(2 - 0.02 - 0.25, 9)
  })

  it('ignora un getOutputTimestamp vacío (antes de que arranque la salida)', () => {
    const { ctx, clock, advance } = setup()
    ctx.outputTimestamp = { contextTime: 0, performanceTime: 0 }
    clock.start(0, 0)
    advance(1)
    expect(clock.now()).toBeCloseTo(1 - 0.02, 9)
  })

  it('aplica la velocidad de reproducción', () => {
    const { clock, advance } = setup()
    clock.start(0, 20, 0.5)
    advance(4)
    expect(clock.playbackRate).toBe(0.5)
    expect(clock.now()).toBeCloseTo(20 + (4 - 0.02) * 0.5, 9)
  })

  it('pause fija la posición programada y la reanudación continúa desde ahí', () => {
    const { ctx, clock, advance } = setup()
    clock.start(0, 0)
    advance(3)
    expect(clock.pause()).toBeCloseTo(3, 9)
    expect(clock.isPlaying).toBe(false)
    advance(10)
    expect(clock.now()).toBeCloseTo(3, 9)
    clock.start(ctx.currentTime, clock.now())
    advance(1)
    expect(clock.now()).toBeCloseTo(4 - 0.02, 9)
  })

  it('now() es monótono aunque getOutputTimestamp retroceda', () => {
    const { ctx, clock, advance, perf } = setup()
    clock.start(0, 0)
    advance(1)
    ctx.outputTimestamp = { contextTime: 0.98, performanceTime: perf() }
    const first = clock.now()
    ctx.outputTimestamp = { contextTime: 0.975, performanceTime: perf() }
    expect(clock.now()).toBe(first)
    advance(0.5)
    ctx.outputTimestamp = { contextTime: 1.48, performanceTime: perf() }
    expect(clock.now()).toBeGreaterThan(first)
  })
})
