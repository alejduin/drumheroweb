import { describe, expect, it } from 'vitest'
import { PIECES } from '@/types'
import type { ChartNote, Piece } from '@/types'
import type { KitBuffers } from '@/audio/drumSynth'
import { START_LEAD_S, StemPlayer } from '@/audio/StemPlayer'
import type { FrameScheduler } from '@/engine/GameEngine'
import { KitPlayer, notesInWindow, velocityGain } from '@/engine/KitPlayer'
import { LOOKAHEAD_S } from '@/engine/Metronome'
import { FakeAudioContext, fakeBuffer } from '../fakes/FakeAudioContext'
import type { FakeBufferSource, FakeGainNode } from '../fakes/FakeAudioContext'

const note = (t: number, piece: Piece = 'snare', velocity = 96): ChartNote => ({
  t,
  piece,
  velocity,
  confidence: 1,
})

// Corcheas a 120 BPM con bombo y hi-hat juntos en cada tiempo
const notes: ChartNote[] = Array.from({ length: 30 }, (_, i) => i * 0.25).flatMap(t =>
  t % 0.5 === 0 ? [note(t, 'kick'), note(t, 'hihat_closed')] : [note(t, 'hihat_closed')],
)

describe('notesInWindow', () => {
  it('índices con from <= t < to, acordes incluidos', () => {
    expect(notesInWindow(notes, 0, 0.5)).toEqual([0, 1, 2])
    expect(notesInWindow(notes, 0.25, 0.26)).toEqual([2])
    expect(notesInWindow(notes, 0.26, 0.5)).toEqual([])
    expect(notesInWindow(notes, 100, 200)).toEqual([])
    expect(notesInWindow([], 0, 10)).toEqual([])
  })

  it('ventanas contiguas no repiten ni pierden notas', () => {
    const seen: number[] = []
    for (let from = 0; from < 8; from += 0.137)
      seen.push(...notesInWindow(notes, from, from + 0.137))
    expect(seen).toEqual(notes.map((_, i) => i))
  })
})

describe('velocityGain', () => {
  it('crece con la velocity y queda entre 0 y 1', () => {
    expect(velocityGain(127)).toBeCloseTo(1, 9)
    expect(velocityGain(30)).toBeLessThan(velocityGain(96))
    expect(velocityGain(0)).toBeGreaterThan(0)
    expect(velocityGain(500)).toBeCloseTo(1, 9)
  })
})

const buffers = Object.fromEntries(
  PIECES.map(p => [p, { ...fakeBuffer(0.3), name: p }]),
) as unknown as KitBuffers

function setup(chartNotes: readonly ChartNote[] = notes) {
  const ctx = new FakeAudioContext()
  const player = new StemPlayer(ctx, [{ buffer: fakeBuffer(20), output: ctx.destination }], () => 0)
  const output = { name: 'samples' } as unknown as AudioNode
  const scheduler: FrameScheduler = { request: () => 1, cancel: () => {} }
  const kit = new KitPlayer({
    ctx,
    clock: player.clock,
    buffers,
    notes: chartNotes,
    output,
    scheduler,
  })
  const run = (seconds: number) => {
    const end = ctx.currentTime + seconds
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(ctx.currentTime + 0.016, end)
      kit.tick()
    }
  }
  const hits = () =>
    ctx.sources.filter(s => (s.buffer as unknown as { name?: string } | null)?.name !== undefined)
  const live = () => hits().filter(s => !s.stopped)
  const pieceOf = (s: FakeBufferSource) => (s.buffer as unknown as { name: Piece }).name
  return { ctx, player, kit, run, hits, live, pieceOf }
}

describe('KitPlayer', () => {
  it('detenido no agenda nada', () => {
    const { kit, run, hits } = setup()
    kit.tick()
    run(2)
    expect(hits()).toHaveLength(0)
  })

  it('cada nota suena en su instante con el sonido de su pieza y al canal samples', () => {
    const { ctx, player, run, live, pieceOf } = setup()
    player.play()
    run(0.7)
    const sounded = live().filter(s => s.startArgs![0] <= START_LEAD_S + 0.5 + 1e-9)
    expect(sounded.map(s => s.startArgs![0])).toEqual(
      [0, 0, 0.25, 0.5, 0.5].map(t => expect.closeTo(START_LEAD_S + t, 9)),
    )
    expect(sounded.map(pieceOf)).toEqual([
      'kick',
      'hihat_closed',
      'hihat_closed',
      'kick',
      'hihat_closed',
    ])
    const gain = ctx.gains.find(
      g => g.output !== null && (g.output as { name?: string }).name === 'samples',
    ) as FakeGainNode | undefined
    expect(gain?.gain.value).toBeCloseTo(velocityGain(96), 9)
  })

  it('solo agenda dentro del lookahead y nunca una nota dos veces', () => {
    const { ctx, player, run, live } = setup()
    player.play()
    run(2)
    for (const s of live())
      expect(s.startArgs![0]).toBeLessThan(ctx.currentTime + LOOKAHEAD_S + 1e-9)
    const keys = live().map(s => `${s.startArgs![0].toFixed(6)}`)
    // dos notas por tiempo (bombo + hi-hat) y una en cada contratiempo
    const perTime = new Map<string, number>()
    for (const k of keys) perTime.set(k, (perTime.get(k) ?? 0) + 1)
    expect(Math.max(...perTime.values())).toBeLessThanOrEqual(2)
    expect(live()).toHaveLength(
      notesInWindow(notes, 0, ctx.currentTime - START_LEAD_S + LOOKAHEAD_S).length,
    )
  })

  it('seek hacia atrás cancela lo pendiente y vuelve a tocar desde ahí, sin duplicados', () => {
    const { ctx, player, kit, run, live } = setup()
    player.play()
    run(1.2)
    const pending = live().filter(s => s.startArgs![0] > ctx.currentTime)
    expect(pending.length).toBeGreaterThan(0)
    player.seek(0.5)
    const seekCtx = ctx.currentTime + START_LEAD_S
    kit.tick()
    expect(pending.every(s => s.stopped)).toBe(true)
    run(0.6)
    const after = live().filter(s => s.startArgs![0] >= seekCtx - 1e-9)
    const times = after.map(s => s.startArgs![0] - seekCtx + 0.5)
    // 0.5 (bombo + hi-hat), 0.75, 1.0 (bombo + hi-hat)…, cada una una sola vez
    expect(times.slice(0, 5)).toEqual([0.5, 0.5, 0.75, 1, 1].map(t => expect.closeTo(t, 9)))
  })

  it('pausa corta lo que suena y lo agendado', () => {
    const { player, kit, run } = setup()
    player.play()
    run(1)
    expect(kit.pendingHits).toBeGreaterThan(0)
    player.pause()
    kit.tick()
    expect(kit.pendingHits).toBe(0)
    run(1)
    expect(kit.pendingHits).toBe(0)
  })

  it('setNotes: las notas nuevas por delante del cursor suenan', () => {
    const { ctx, player, kit, run, live, pieceOf } = setup([note(0.1, 'kick')])
    player.play()
    run(0.5)
    kit.setNotes([note(0.1, 'kick'), note(1.5, 'crash')])
    run(1.5)
    const crash = live().find(s => pieceOf(s) === 'crash')
    expect(crash?.startArgs![0]).toBeCloseTo(START_LEAD_S + 1.5, 9)
    expect(live().filter(s => pieceOf(s) === 'kick')).toHaveLength(1)
    expect(ctx.currentTime).toBeGreaterThan(START_LEAD_S + 1.5)
  })

  it('dispose cancela todo', () => {
    const { player, kit, run } = setup()
    player.play()
    run(0.5)
    kit.dispose()
    expect(kit.pendingHits).toBe(0)
  })
})
