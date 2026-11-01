import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartNote, ChartV2, MidiHit } from '@/types'
import { DEFAULT_MIX } from '@/audio/Mixer'
import type { FrameScheduler } from '@/engine/GameEngine'
import { GameSession, SILENT_SAMPLE_RATE } from '@/game/GameSession'
import type { SessionContext, SessionDeps, SessionOptions, SongBundle } from '@/game/GameSession'
import { stretchChannels } from '@/audio/timeStretch'
import type { StretchFn } from '@/audio/tempo'
import { useGameStore } from '@/store/gameStore'
import { FakeAudioContext } from '../fakes/FakeAudioContext'

const DURATION_S = 8
const BYTES = new ArrayBuffer(4)

/** AudioContext falso con lo que añade la sesión: buffers, decode, resume y close. */
class FakeSessionContext extends FakeAudioContext implements SessionContext {
  state: AudioContextState = 'suspended'
  closed = false
  decodedDuration = DURATION_S - 2

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length)
    return {
      duration: length / sampleRate,
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: () => data,
    } as unknown as AudioBuffer
  }

  async decodeAudioData(): Promise<AudioBuffer> {
    return this.createBuffer(1, this.decodedDuration * 100, 100)
  }

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

function chart(notes: ChartNote[]): ChartV2 {
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

const OPTIONS: SessionOptions = {
  difficulty: 'full',
  level: 'intermediate',
  latencyMs: 0,
  dynamicsBonus: false,
  mix: DEFAULT_MIX,
}

const NOTES: ChartNote[] = [1, 2, 3].map(t => ({ t, piece: 'snare', velocity: 80, confidence: 1 }))

async function open(bundle: Partial<SongBundle> = {}, deps: Partial<SessionDeps> = {}) {
  const ctx = new FakeSessionContext()
  const hits = new Set<(hit: MidiHit) => void>()
  const scheduler: FrameScheduler = { request: () => 1, cancel: () => {} }
  const session = await GameSession.open(
    { chart: chart(NOTES), audio: null, peaks: null, fileName: null, ...bundle },
    OPTIONS,
    {
      createContext: () => ctx,
      subscribeHits: cb => {
        hits.add(cb)
        return () => hits.delete(cb)
      },
      scheduler,
      perfNow: () => 0,
      ...deps,
    },
  )
  return { ctx, session, hits }
}

afterEach(() => useGameStore.getState().reset())

describe('GameSession', () => {
  it('un chart sin audio suena con una pista silenciosa de su duración', async () => {
    const { session } = await open()
    expect(session.audioMode).toBe('silent')
    expect(session.player.durationS).toBeCloseTo(DURATION_S)
    expect(session.peaks.sampleRate).toBe(SILENT_SAMPLE_RATE)
    expect(session.sections.map(s => s.name)).toEqual(['Compases 1–4'])
  })

  it('con stems usa los dos canales del mezclador', async () => {
    const { session } = await open({
      audio: { stems: { drums: BYTES, backing: BYTES }, original: null },
    })
    expect(session.audioMode).toBe('stems')
  })

  it('play reanuda el contexto y arranca audio y engine; pausa los detiene', async () => {
    const { ctx, session } = await open()
    await session.toggle()
    expect(ctx.state).toBe('running')
    expect(session.isPlaying).toBe(true)
    expect(session.engine.phase).toBe('running')
    expect(useGameStore.getState().phase).toBe('playing')
    await session.toggle()
    expect(session.isPlaying).toBe(false)
    expect(session.engine.phase).toBe('idle')
    expect(useGameStore.getState().phase).toBe('paused')
  })

  it('si el audio termina antes que el chart, la partida termina igual', async () => {
    const { ctx, session } = await open({ audio: { stems: null, original: BYTES } })
    await session.play()
    // El MP3 dura menos que el chart: su fin natural cierra la partida
    expect(session.player.durationS).toBeCloseTo(DURATION_S - 2)
    ctx.lastSource.finish()
    expect(session.engine.phase).toBe('ended')
    expect(useGameStore.getState().phase).toBe('ended')
    expect(useGameStore.getState().results?.counts.miss).toBe(NOTES.length)
  })

  it('seek tras el fin deja la partida en pausa en ese punto', async () => {
    const { ctx, session } = await open()
    await session.play()
    ctx.lastSource.finish()
    session.seek(2)
    expect(useGameStore.getState().phase).toBe('paused')
    expect(useGameStore.getState().results).toBeNull()
    expect(session.clock.now()).toBe(2)
  })

  it('el metrónomo agenda clicks en el canal metronome mientras suena', async () => {
    const { ctx, session } = await open()
    await session.play()
    ctx.currentTime += 0.016
    session.metronome.tick()
    expect(ctx.oscillators.length).toBeGreaterThan(0)
    expect(ctx.gains.some(g => g.output === session.mixer.input('metronome'))).toBe(true)
  })

  it('genera Básico e Intermedio si el chart solo trae Completo', async () => {
    const { session } = await open()
    expect(session.chart.difficulties.basic.notes.length).toBeGreaterThan(0)
    expect(session.difficulty).toBe('full')
  })

  it('cambiar la dificultad carga otras notas en la misma posición y reinicia el marcador', async () => {
    const off = (t: number): ChartNote => ({ t, piece: 'kick', velocity: 80, confidence: 1 })
    // El bombo en contratiempo de semicorchea no está en Básico
    const { session } = await open({ chart: chart([...NOTES, off(1.125), off(2.125)]) })
    session.seek(1.5)
    await session.play()
    const position = session.clock.now()
    session.setDifficulty('basic')
    expect(session.difficulty).toBe('basic')
    expect(session.isPlaying).toBe(false)
    expect(session.clock.now()).toBeCloseTo(position, 6)
    expect(session.engine.chartNotes.map(n => n.t)).toEqual([1, 2, 3])
    expect(useGameStore.getState().phase).toBe('paused')
    expect(useGameStore.getState().hud.score).toBe(0)
  })

  it('setTempo estira las pistas y sigue desde la misma posición al nuevo tempo', async () => {
    const stretch = vi.fn<StretchFn>(async (channels, sampleRate, rate) =>
      stretchChannels(channels, sampleRate, rate),
    )
    const { ctx, session } = await open(
      { audio: { stems: { drums: BYTES, backing: BYTES }, original: null } },
      { stretch },
    )
    session.seek(2)
    await session.play()
    expect(await session.setTempo(0.77)).toBe(true) // se redondea a pasos de 5 %
    expect(session.tempo).toBe(0.75)
    expect(session.player.playbackRate).toBe(0.75)
    // Las dos pistas en una sola llamada: misma alineación
    expect(stretch).toHaveBeenCalledTimes(1)
    expect(stretch.mock.calls[0][0]).toHaveLength(2)
    const [drums, backing] = ctx.sources.slice(-2)
    expect(drums.buffer?.duration).toBeCloseTo((DURATION_S - 2) / 0.75, 1)
    expect(drums.playbackRate.value).toBe(1)
    expect(drums.startArgs?.[1]).toBeCloseTo(session.clock.songAtCtx(ctx.currentTime) / 0.75, 1)
    expect(backing.startArgs).toEqual(drums.startArgs)
    expect(session.isPlaying).toBe(true)
  })

  it('un cambio de tempo nuevo cancela el anterior', async () => {
    let release: () => void = () => {}
    const stretch = vi.fn<StretchFn>(
      (channels, sampleRate, rate, signal) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('cancelado', 'AbortError')),
          )
          release = () => resolve(stretchChannels(channels, sampleRate, rate))
        }),
    )
    const { session } = await open({ audio: { stems: null, original: BYTES } }, { stretch })
    const first = session.setTempo(0.5)
    const second = session.setTempo(0.8)
    release()
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(session.player.playbackRate).toBe(0.8)
    // Volver a 100 % no estira nada
    expect(await session.setTempo(1)).toBe(true)
    expect(stretch).toHaveBeenCalledTimes(2)
    expect(session.player.playbackRate).toBe(1)
  })

  it('sin audio el tempo solo escala la pista silenciosa', async () => {
    const stretch = vi.fn<StretchFn>()
    const { session } = await open({}, { stretch })
    expect(await session.setTempo(0.6)).toBe(true)
    expect(session.player.playbackRate).toBe(0.6)
    expect(stretch).not.toHaveBeenCalled()
  })

  it('si el time-stretch falla, se queda en el tempo que sonaba', async () => {
    const stretch = vi.fn<StretchFn>(async () => {
      throw new Error('sin memoria')
    })
    const { session } = await open({ audio: { stems: null, original: BYTES } }, { stretch })
    await expect(session.setTempo(0.5)).rejects.toThrow('sin memoria')
    expect(session.tempo).toBe(1)
    expect(session.player.playbackRate).toBe(1)
  })

  it('dispose quita la suscripción MIDI, cierra el contexto y limpia el store', async () => {
    const { ctx, session, hits } = await open()
    await session.play()
    expect(hits.size).toBe(1)
    session.dispose()
    expect(hits.size).toBe(0)
    expect(ctx.closed).toBe(true)
    expect(useGameStore.getState().phase).toBe('idle')
  })

  it('si el audio no se puede decodificar, cierra el contexto y lanza', async () => {
    const ctx = new FakeSessionContext()
    ctx.decodeAudioData = vi.fn().mockRejectedValue(new Error('formato no soportado'))
    await expect(
      GameSession.open(
        {
          chart: chart(NOTES),
          audio: { stems: null, original: BYTES },
          peaks: null,
          fileName: null,
        },
        OPTIONS,
        { createContext: () => ctx, subscribeHits: () => () => {} },
      ),
    ).rejects.toThrow('formato no soportado')
    expect(ctx.closed).toBe(true)
  })
})
