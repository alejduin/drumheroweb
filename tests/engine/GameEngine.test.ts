import { describe, expect, it, vi } from 'vitest'
import type { ChartNote, ChartV2, Judgement, MidiHit, Piece } from '@/types'
import { LEVEL_WINDOWS } from '@/constants/scoring'
import { GameEngine, MISS_GRACE_S } from '@/engine/GameEngine'
import type { FrameScheduler, TimedJudgement } from '@/engine/GameEngine'
import { FakeClock } from '../fakes/FakeClock'

const DURATION_S = 10

/** Chart de prueba: rejilla a 120 BPM, notas dadas en `full`. */
function makeChart(notes: ChartNote[]): ChartV2 {
  const beats = Array.from({ length: DURATION_S * 2 }, (_, i) => i * 0.5)
  return {
    version: 2,
    id: 'test',
    title: 'Test',
    artist: 'Test',
    bpm: 120,
    timeSignature: [4, 4],
    durationS: DURATION_S,
    audioUrl: null,
    stems: null,
    audioSha256: null,
    youtubeUrl: null,
    youtubeOffsetMs: 0,
    grid: { beats, downbeats: beats.filter((_, i) => i % 4 === 0) },
    difficulties: { basic: { notes: [] }, intermediate: { notes: [] }, full: { notes } },
    sections: [],
    source: { kind: 'builtin', createdAt: '2026-10-24T00:00:00.000Z' },
  }
}

const note = (t: number, piece: Piece = 'snare'): ChartNote => ({
  t,
  piece,
  velocity: 80,
  confidence: 1,
})

// Groove de 2 compases: bombo en 1 y 3, caja en 2 y 4, hi-hat en corcheas (simultáneos)
function groove(): ChartNote[] {
  const notes: ChartNote[] = []
  for (let i = 0; i < 16; i++) {
    const t = 1 + i * 0.25
    if (i % 2 === 0) notes.push(note(t, i % 4 === 0 ? 'kick' : 'snare'))
    notes.push(note(t, 'hihat_closed'))
  }
  return notes.sort((a, b) => a.t - b.t || (a.piece === 'hihat_closed' ? 1 : -1))
}

function manualScheduler() {
  let next: (() => void) | null = null
  const scheduler: FrameScheduler = {
    request: cb => {
      next = cb
      return 1
    },
    cancel: () => {
      next = null
    },
  }
  return {
    scheduler,
    get pending() {
      return next !== null
    },
    /** Ejecuta el frame pendiente. */
    frame() {
      const cb = next
      next = null
      cb?.()
    },
  }
}

function setup(notes: ChartNote[], latencyMs = 0) {
  const clock = new FakeClock()
  const frames = manualScheduler()
  const transport = { seek: vi.fn((t: number) => (clock.time = t)) }
  const engine = new GameEngine({ clock, transport, scheduler: frames.scheduler })
  engine.load(makeChart(notes), 'full', { level: 'intermediate', latencyMs })
  const events: TimedJudgement[] = []
  engine.onJudgement(j => events.push(j))
  engine.start()

  /**
   * Avanza el reloj en frames de 16 ms hasta `t` (o hasta que el reloj retroceda por
   * un loop), entregando los golpes en su momento.
   */
  function playUntil(t: number, hits: Array<{ t: number; piece: Piece; velocity?: number }> = []) {
    const queue = [...hits].sort((a, b) => a.t - b.t)
    while (clock.time < t && frames.pending) {
      const before = clock.time
      clock.time = Math.min(clock.time + 0.016, t)
      // Los MIDIMessageEvent llegan antes del siguiente frame
      while (queue.length && queue[0].t <= clock.time) {
        const h = queue.shift()!
        engine.handleHit(midi(clock, h.t, h.piece, h.velocity))
      }
      frames.frame()
      if (clock.time < before) return // el loop volvió a A
    }
  }
  return { clock, engine, events, frames, transport, playUntil }
}

function midi(clock: FakeClock, t: number, piece: Piece, velocity = 80): MidiHit {
  return { instrument: piece, midi: 0, velocity, timestamp: clock.perfAt(t) }
}

function counts(judgements: readonly TimedJudgement[]): Record<Judgement, number> {
  const result: Record<Judgement, number> = { perfect: 0, close: 0, miss: 0, wrong_pad: 0 }
  for (const j of judgements) result[j.judgement]++
  return result
}

// ─── Partidas completas ───────────────────────────────────────────────────────

describe('partida completa', () => {
  it('todo perfecto: cada nota acertada una vez y fin por durationS', () => {
    const notes = groove()
    const { engine, events, playUntil } = setup(notes)
    const onEnd = vi.fn()
    engine.onEnd(onEnd)
    playUntil(DURATION_S, notes)
    expect(counts(events)).toEqual({ perfect: notes.length, close: 0, miss: 0, wrong_pad: 0 })
    expect(new Set(events.map(e => 'noteIndex' in e && e.noteIndex)).size).toBe(notes.length)
    expect(engine.phase).toBe('ended')
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd.mock.calls[0][0]).toHaveLength(notes.length)
  })

  it('todo fallo: cada nota expira en orden, una sola vez', () => {
    const notes = groove()
    const { events, playUntil } = setup(notes)
    playUntil(DURATION_S)
    expect(counts(events)).toEqual({ perfect: 0, close: 0, miss: notes.length, wrong_pad: 0 })
    const times = events.map(e => e.t)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('mezcla: las estadísticas coinciden con el cálculo esperado', () => {
    const notes = groove()
    const { perfectMs, closeMs } = LEVEL_WINDOWS.intermediate
    // Desfase por nota (ms) en ciclo: perfecto, temprano cerca, tarde cerca, fallo, pad incorrecto
    const plan = [0, -50, 70, null, 'wrong'] as const
    const hits: Array<{ t: number; piece: Piece }> = []
    const expected = { perfect: 0, close: 0, miss: 0, wrong_pad: 0 }
    notes.forEach((n, i) => {
      const step = plan[i % plan.length]
      if (step === null) {
        expected.miss++
      } else if (step === 'wrong') {
        hits.push({ t: n.t, piece: 'ride' })
        expected.wrong_pad++
        expected.miss++ // la nota nadie la toca
      } else {
        hits.push({ t: n.t + step / 1000, piece: n.piece })
        expected[
          Math.abs(step) <= perfectMs ? 'perfect' : Math.abs(step) <= closeMs ? 'close' : 'miss'
        ]++
      }
    })
    const { events, playUntil } = setup(notes)
    playUntil(DURATION_S, hits)
    expect(counts(events)).toEqual(expected)
    const early = events.filter(e => e.judgement === 'close' && e.timing === 'early')
    expect(early.length).toBeGreaterThan(0)
  })

  it('notas simultáneas kick + hihat se aciertan por separado', () => {
    const notes = [note(2, 'kick'), note(2, 'hihat_closed')]
    const { events, playUntil } = setup(notes)
    playUntil(3, [
      { t: 2.004, piece: 'hihat_closed' },
      { t: 1.998, piece: 'kick' },
    ])
    // Llegan en orden de tiempo: el bombo (1.998) antes que el hi-hat (2.004)
    expect(events.map(e => [e.judgement, e.piece])).toEqual([
      ['perfect', 'kick'],
      ['perfect', 'hihat_closed'],
    ])
  })

  it('resta la latencia del kit configurada', () => {
    const { events, playUntil } = setup([note(2)], 40)
    playUntil(3, [{ t: 2.04, piece: 'snare' }])
    expect(events[0]).toMatchObject({ judgement: 'perfect' })
  })
})

// ─── Expiración ───────────────────────────────────────────────────────────────

describe('Fallos al expirar', () => {
  it('espera la ventana Cerca más el margen antes de marcar Fallo', () => {
    const closeS = LEVEL_WINDOWS.intermediate.closeMs / 1000
    const { events, playUntil } = setup([note(1)])
    playUntil(1 + closeS + MISS_GRACE_S - 0.005)
    expect(events).toEqual([])
    playUntil(1 + closeS + MISS_GRACE_S + 0.02)
    expect(events).toEqual([{ judgement: 'miss', noteIndex: 0, piece: 'snare', t: 1 }])
  })

  it('un golpe que llega tarde al hilo pero con timestamp a tiempo todavía acierta', () => {
    const { clock, engine, events, frames } = setup([note(1)])
    clock.time = 1.1 // el frame aún no corrió con este tiempo
    engine.handleHit(midi(clock, 1.075, 'snare'))
    frames.frame()
    expect(events.map(e => e.judgement)).toEqual(['close'])
  })
})

// ─── Seek ─────────────────────────────────────────────────────────────────────

describe('seek', () => {
  it('hacia atrás descarta los juicios desde ese punto y permite volver a tocar', () => {
    const notes = [note(1), note(2), note(3), note(4)]
    const { engine, events, playUntil, clock } = setup(notes)
    const onReset = vi.fn()
    engine.onReset(onReset)
    playUntil(3.5, [
      { t: 1, piece: 'snare' },
      { t: 2.05, piece: 'snare' },
    ]) // 1 perfecto, 2 cerca, 3 fallo
    expect(counts(engine.judgements)).toMatchObject({ perfect: 1, close: 1, miss: 1 })

    clock.time = 1.5
    engine.seek(1.5)
    expect(engine.judgements.map(j => j.t)).toEqual([1])
    expect(onReset).toHaveBeenCalledWith(engine.judgements)

    playUntil(DURATION_S, [
      { t: 2, piece: 'snare' },
      { t: 3, piece: 'snare' },
      { t: 4, piece: 'snare' },
    ])
    expect(counts(engine.judgements)).toEqual({ perfect: 4, close: 0, miss: 0, wrong_pad: 0 })
    expect(events.length).toBe(3 + 3) // 3 antes del seek + 3 después
  })

  it('hacia adelante las notas saltadas no cuentan', () => {
    const { engine, clock, playUntil } = setup([note(1), note(5)])
    clock.time = 4
    engine.seek(4)
    playUntil(DURATION_S, [{ t: 5, piece: 'snare' }])
    expect(engine.judgements.map(j => [j.judgement, j.t])).toEqual([['perfect', 5]])
  })

  it('tras el fin, start() vuelve a empezar desde 0', () => {
    const { engine, clock, frames, playUntil } = setup([note(1)])
    playUntil(DURATION_S)
    expect(engine.phase).toBe('ended')
    expect(frames.pending).toBe(false)
    clock.time = 0
    engine.start()
    expect(engine.phase).toBe('running')
    expect(engine.judgements).toEqual([])
  })
})

// ─── Loop A–B ─────────────────────────────────────────────────────────────────

describe('loop A–B', () => {
  it('al llegar a B vuelve a A, informa la vuelta y reabre las notas', () => {
    const notes = [note(1), note(2), note(3), note(4)]
    const { engine, transport, playUntil, clock } = setup(notes)
    const laps: Array<{ lap: number; judgements: readonly TimedJudgement[] }> = []
    engine.onLoop(l => laps.push(l))
    engine.setLoop({ startS: 1.5, endS: 3.5 })

    playUntil(3.6, [{ t: 2, piece: 'snare' }]) // vuelta 1: 2 perfecto, 3 fallo
    expect(transport.seek).toHaveBeenCalledWith(1.5)
    expect(clock.time).toBe(1.5)
    expect(laps).toHaveLength(1)
    expect(laps[0].lap).toBe(1)
    expect(laps[0].judgements.map(j => [j.judgement, j.t])).toEqual([
      ['perfect', 2],
      ['miss', 3],
    ])

    playUntil(3.6, [
      { t: 2, piece: 'snare' },
      { t: 3, piece: 'snare' },
    ]) // vuelta 2: todo perfecto
    expect(laps[1].lap).toBe(2)
    expect(counts(laps[1].judgements)).toMatchObject({ perfect: 2, miss: 0 })
    expect(engine.phase).toBe('running') // el loop evita el fin
  })

  it('rechaza un rango vacío o invertido', () => {
    const { engine } = setup([])
    expect(() => engine.setLoop({ startS: 2, endS: 2 })).toThrow(RangeError)
    expect(() => engine.setLoop(null)).not.toThrow()
  })
})

// ─── Estados ──────────────────────────────────────────────────────────────────

describe('estados', () => {
  it('ignora golpes con el reloj en pausa, el bucle detenido o fuera de la canción', () => {
    const { engine, clock, playUntil } = setup([note(1)])
    clock.playing = false
    expect(engine.handleHit(midi(clock, 1, 'snare'))).toBeNull()
    clock.playing = true
    expect(engine.handleHit(midi(clock, -0.5, 'snare'))).toBeNull()
    expect(engine.handleHit(midi(clock, DURATION_S + 1, 'snare'))).toBeNull()
    engine.stop()
    expect(engine.phase).toBe('idle')
    expect(engine.handleHit(midi(clock, 1, 'snare'))).toBeNull()
    engine.start()
    playUntil(2, [{ t: 1, piece: 'snare' }])
    expect(engine.judgements.map(j => j.judgement)).toEqual(['perfect'])
  })

  it('stop cancela el frame pendiente y conserva el estado', () => {
    const { engine, frames, playUntil } = setup([note(1), note(3)])
    playUntil(1.5, [{ t: 1, piece: 'snare' }])
    engine.stop()
    expect(frames.pending).toBe(false)
    expect(engine.judgements).toHaveLength(1)
  })

  it('load reinicia la partida con otra dificultad', () => {
    const { engine } = setup([note(1)])
    const chart = makeChart([note(1)])
    chart.difficulties.basic.notes = [note(1), note(2)]
    engine.load(chart, 'basic', { level: 'expert' })
    expect(engine.phase).toBe('idle')
    expect(engine.chartNotes).toHaveLength(2)
    expect(engine.judgements).toEqual([])
  })
})
