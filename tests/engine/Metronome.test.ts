import { describe, expect, it } from 'vitest'
import type { ChartGrid } from '@/types'
import { START_LEAD_S, StemPlayer } from '@/audio/StemPlayer'
import {
  ACCENT_FREQUENCY_HZ,
  BEAT_FREQUENCY_HZ,
  CLICK_DURATION_S,
  LOOKAHEAD_S,
  Metronome,
  beatsInWindow,
} from '@/engine/Metronome'
import type { FrameScheduler } from '@/engine/GameEngine'
import { FakeAudioContext, fakeBuffer } from '../fakes/FakeAudioContext'

// 120 BPM en 4/4: un beat cada 0,5 s desde 0,25 s; compás cada 4 beats
const beats = Array.from({ length: 40 }, (_, i) => 0.25 + i * 0.5)
const grid: ChartGrid = { beats, downbeats: beats.filter((_, i) => i % 4 === 0) }

describe('beatsInWindow', () => {
  it('beats con from <= t < to, en orden', () => {
    expect(beatsInWindow(grid, 0.25, 1.75).map(b => b.t)).toEqual([0.25, 0.75, 1.25])
    expect(beatsInWindow(grid, 0.26, 0.75)).toEqual([])
    expect(beatsInWindow(grid, 100, 200)).toEqual([])
  })

  it('acentúa los primeros tiempos de compás', () => {
    const window = beatsInWindow(grid, 0, 4.5)
    expect(window.filter(b => b.downbeat).map(b => b.t)).toEqual([0.25, 2.25, 4.25])
    expect(window.map(b => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('acentos tolerantes a decimales del JSON y a rejillas de tempo variable', () => {
    const g: ChartGrid = { beats: [0.1, 0.6, 1.0, 1.45, 1.9], downbeats: [0.1000000001, 1.45] }
    expect(beatsInWindow(g, 0, 2).map(b => b.downbeat)).toEqual([true, false, false, true, false])
    // ventana que empieza justo en un downbeat
    expect(beatsInWindow(g, 1.45, 2)[0]).toEqual({ index: 3, t: 1.45, downbeat: true })
  })
})

function setup() {
  const ctx = new FakeAudioContext()
  const player = new StemPlayer(ctx, [{ buffer: fakeBuffer(20), output: ctx.destination }], () => 0)
  const output = { name: 'metronome' } as unknown as AudioNode
  const scheduler: FrameScheduler = { request: () => 1, cancel: () => {} }
  const metronome = new Metronome({ ctx, clock: player.clock, grid, output, scheduler })
  /** Avanza el contexto en frames de 16 ms, con un tick del metrónomo por frame. */
  const run = (seconds: number) => {
    const end = ctx.currentTime + seconds
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(ctx.currentTime + 0.016, end)
      metronome.tick()
    }
  }
  const live = () => ctx.oscillators.filter(o => !o.cancelled)
  return { ctx, player, metronome, run, live }
}

describe('Metronome', () => {
  it('detenido no agenda nada', () => {
    const { metronome, ctx, run } = setup()
    metronome.tick()
    run(2)
    expect(ctx.oscillators).toHaveLength(0)
  })

  it('cada click suena en el instante de contexto de su beat, con acento en el compás', () => {
    const { player, run, live } = setup()
    player.play() // la posición 0 suena en ctx = START_LEAD_S
    run(2.2)
    const clicks = live()
    expect(clicks.map(o => o.startAt)).toEqual(
      [0.25, 0.75, 1.25, 1.75, 2.25].map(t => expect.closeTo(START_LEAD_S + t, 9)),
    )
    expect(clicks.map(o => o.frequency.value)).toEqual([
      ACCENT_FREQUENCY_HZ,
      BEAT_FREQUENCY_HZ,
      BEAT_FREQUENCY_HZ,
      BEAT_FREQUENCY_HZ,
      ACCENT_FREQUENCY_HZ,
    ])
    expect(clicks[0].stopAt).toBeCloseTo(START_LEAD_S + 0.25 + CLICK_DURATION_S, 9)
    expect(clicks.every(o => o.output !== null)).toBe(true)
  })

  it('solo agenda dentro del lookahead y nunca un beat dos veces', () => {
    const { ctx, player, run, live } = setup()
    player.play()
    run(1)
    for (const o of live()) expect(o.startAt!).toBeLessThan(ctx.currentTime + LOOKAHEAD_S + 1e-9)
    const starts = live().map(o => o.startAt)
    expect(new Set(starts).size).toBe(starts.length)
  })

  it('pausa cancela lo agendado; al reanudar sigue alineado al beat', () => {
    const { ctx, player, metronome, run, live } = setup()
    player.play()
    run(1.0) // ctx 1.0 → canción 0.95
    player.pause()
    metronome.tick()
    expect(metronome.pendingClicks).toBe(0)
    const pausedAt = player.clock.now()
    run(3) // en pausa: ningún click nuevo
    const before = live().length
    player.play()
    const resumeCtx = ctx.currentTime + START_LEAD_S
    run(1.2)
    const after = live().slice(before)
    // el primer beat tras la pausa (1.25) suena desplazado lo que duró la pausa
    expect(after[0].startAt).toBeCloseTo(resumeCtx + (1.25 - pausedAt), 9)
  })

  it('seek reancla: cancela los clicks pendientes y sigue desde la nueva posición', () => {
    const { ctx, player, run } = setup()
    player.play()
    run(0.7) // el click de 0.75 ya está agendado y aún no suena
    const pending = ctx.oscillators.find(o => o.startAt! > ctx.currentTime)!
    player.seek(4.25)
    const seekCtx = ctx.currentTime + START_LEAD_S
    run(0.6)
    expect(pending.cancelled).toBe(true)
    const next = ctx.oscillators.filter(o => !o.cancelled && o.startAt! >= seekCtx)
    expect(next[0].startAt).toBeCloseTo(seekCtx, 9) // 4.25 es downbeat: suena al arrancar
    expect(next[0].frequency.value).toBe(ACCENT_FREQUENCY_HZ)
    expect(next[1].startAt).toBeCloseTo(seekCtx + 0.5, 9)
  })

  it('a otra velocidad los clicks se separan según el rate', () => {
    const { player, run, live } = setup()
    player.setPlaybackRate(0.5)
    player.play()
    run(2.2)
    const starts = live().map(o => o.startAt!)
    expect(starts[1] - starts[0]).toBeCloseTo(1, 9)
  })

  it('un frame tardío salta los beats ya pasados en lugar de sonar tarde', () => {
    const { ctx, player, metronome, live } = setup()
    player.play()
    ctx.currentTime = 1.0 // primer tick después de 1 s sin frames
    metronome.tick()
    expect(live().every(o => o.startAt! >= 1.0)).toBe(true)
  })

  it('dispose cancela todo', () => {
    const { player, metronome, run } = setup()
    player.play()
    run(0.5)
    metronome.dispose()
    expect(metronome.pendingClicks).toBe(0)
  })
})
