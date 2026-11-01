import { describe, expect, it, vi } from 'vitest'
import { Mixer } from '@/audio/Mixer'
import { START_LEAD_S, StemPlayer, createSongPlayer } from '@/audio/StemPlayer'
import { FakeAudioContext, fakeBuffer } from '../fakes/FakeAudioContext'

const DRUMS = { name: 'drums' } as unknown as AudioNode
const BACKING = { name: 'backing' } as unknown as AudioNode

function setup(durations: number[] = [60]) {
  const ctx = new FakeAudioContext()
  ctx.outputLatency = 0
  ctx.baseLatency = 0
  let perf = 0
  const outputs = [DRUMS, BACKING]
  const tracks = durations.map((d, i) => ({ buffer: fakeBuffer(d), output: outputs[i % 2] }))
  const player = new StemPlayer(ctx, tracks, () => perf)
  const advance = (s: number) => {
    ctx.currentTime += s
    perf += s * 1000
  }
  return { ctx, player, advance }
}

describe('StemPlayer', () => {
  it('arranca todos los stems en el mismo instante y offset, cada uno a su salida', () => {
    const { ctx, player } = setup([60, 60])
    ctx.currentTime = 2
    player.play()
    expect(ctx.sources).toHaveLength(2)
    expect(ctx.sources.map(s => s.startArgs)).toEqual([
      [2 + START_LEAD_S, 0],
      [2 + START_LEAD_S, 0],
    ])
    expect(ctx.sources.map(s => s.output)).toEqual([DRUMS, BACKING])
  })

  it('el reloj sigue la programación del arranque y es monótono', () => {
    const { player, advance } = setup()
    player.play()
    expect(player.clock.now()).toBeCloseTo(-START_LEAD_S, 9) // aún no suena
    let last = -Infinity
    for (let i = 0; i < 100; i++) {
      advance(0.016)
      const t = player.clock.now()
      expect(t).toBeGreaterThan(last)
      last = t
    }
    expect(last).toBeCloseTo(1.6 - START_LEAD_S, 9)
  })

  it('perfToSong traduce el timestamp de un golpe a segundos de canción', () => {
    const { player, advance } = setup()
    player.play()
    advance(START_LEAD_S + 3)
    // un golpe que ocurrió 20 ms antes del instante actual (perf = 3050 ms)
    expect(player.clock.perfToSong(3050 - 20)).toBeCloseTo(2.98, 9)
  })

  it('pausa y reanuda desde la misma posición con fuentes nuevas', () => {
    const { ctx, player, advance } = setup([60, 60])
    player.play()
    advance(START_LEAD_S + 5)
    player.pause()
    expect(ctx.sources.every(s => s.stopped && !s.connected)).toBe(true)
    expect(player.isPlaying).toBe(false)
    expect(player.clock.now()).toBeCloseTo(5, 9)
    advance(3)
    expect(player.clock.now()).toBeCloseTo(5, 9) // detenido no avanza
    player.play()
    expect(ctx.sources).toHaveLength(4)
    expect(ctx.sources.slice(2).map(s => s.startArgs?.[1])).toEqual([
      expect.closeTo(5, 9),
      expect.closeTo(5, 9),
    ])
  })

  it('seek durante la reproducción reinicia todos los stems en la nueva posición', () => {
    const { ctx, player, advance } = setup([60, 60])
    player.play()
    advance(1)
    player.seek(42)
    expect(ctx.sources.slice(0, 2).every(s => s.stopped)).toBe(true)
    expect(ctx.sources.slice(2).map(s => s.startArgs?.[1])).toEqual([42, 42])
    expect(player.isPlaying).toBe(true)
  })

  it('seek con el reproductor detenido se limita a la duración', () => {
    const { player } = setup([10])
    player.seek(-3)
    expect(player.clock.now()).toBe(0)
    player.seek(99)
    expect(player.clock.now()).toBe(10)
    player.play() // al final: no arranca
    expect(player.isPlaying).toBe(false)
  })

  it('la velocidad escala el reloj y las fuentes, sin saltar de posición', () => {
    const { ctx, player, advance } = setup()
    player.play()
    advance(START_LEAD_S + 4)
    player.setPlaybackRate(0.75)
    expect(player.playbackRate).toBe(0.75)
    expect(ctx.lastSource.playbackRate.value).toBe(0.75)
    expect(ctx.lastSource.startArgs?.[1]).toBeCloseTo(4, 9)
    advance(START_LEAD_S + 2)
    expect(player.clock.now()).toBeCloseTo(4 + 2 * 0.75, 9)
    expect(() => player.setPlaybackRate(0)).toThrow(RangeError)
  })

  it('setTempo con pistas estiradas suena a velocidad 1 desde la posición equivalente', () => {
    const { ctx, player, advance } = setup([60, 60])
    player.play()
    advance(START_LEAD_S + 4)
    const stretched = [fakeBuffer(80), fakeBuffer(80)]
    player.setTempo(0.75, stretched)
    expect(player.playbackRate).toBe(0.75)
    const [drums, backing] = ctx.sources.slice(-2)
    expect(drums.buffer).toBe(stretched[0])
    expect(backing.buffer).toBe(stretched[1])
    expect(drums.playbackRate.value).toBe(1)
    // El segundo 4 de la canción está en el 4 / 0,75 del audio estirado
    expect(drums.startArgs?.[1]).toBeCloseTo(4 / 0.75, 9)
    expect(backing.startArgs?.[0]).toBe(drums.startArgs?.[0])
    // El reloj sigue en segundos de canción, a 0,75 por segundo real
    advance(START_LEAD_S + 2)
    expect(player.clock.now()).toBeCloseTo(4 + 2 * 0.75, 9)
  })

  it('setTempo(1) vuelve a las pistas originales', () => {
    const { ctx, player, advance } = setup([60])
    player.setTempo(0.5, [fakeBuffer(120)])
    player.play()
    advance(START_LEAD_S + 2)
    player.setTempo(1, null)
    expect(ctx.lastSource.buffer?.duration).toBe(60)
    expect(ctx.lastSource.playbackRate.value).toBe(1)
    expect(ctx.lastSource.startArgs?.[1]).toBeCloseTo(1, 9)
  })

  it('setTempo exige un buffer estirado por pista', () => {
    const { player } = setup([60, 60])
    expect(() => player.setTempo(0.5, [fakeBuffer(120)])).toThrow()
    expect(() => player.setTempo(-1, null)).toThrow(RangeError)
  })

  it('con stems de distinta duración la duración es la mayor y el corto no arranca pasado su fin', () => {
    const { ctx, player } = setup([30, 31])
    expect(player.durationS).toBe(31)
    player.seek(30.5)
    player.play()
    expect(ctx.sources).toHaveLength(1)
  })

  it('el fin natural de la pista más larga detiene el reloj al final y avisa una vez', () => {
    const { ctx, player } = setup([9, 10])
    const onEnded = vi.fn()
    player.onEnded(onEnded)
    player.play()
    ctx.sources[0].finish() // el stem corto termina antes: no es el fin
    expect(onEnded).not.toHaveBeenCalled()
    ctx.sources[1].finish()
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(player.isPlaying).toBe(false)
    expect(player.clock.now()).toBe(10)
  })

  it('una fuente detenida por pausa no dispara onEnded', () => {
    const { ctx, player } = setup()
    const onEnded = vi.fn()
    player.onEnded(onEnded)
    player.play()
    const source = ctx.lastSource
    player.pause()
    source.finish() // el navegador dispara onended también tras stop()
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('exige al menos una pista', () => {
    expect(() => new StemPlayer(new FakeAudioContext(), [])).toThrow()
  })
})

describe('createSongPlayer', () => {
  it('conecta cada pista a la entrada de su canal del mezclador', () => {
    const ctx = new FakeAudioContext()
    const mixer = new Mixer(ctx)
    const player = createSongPlayer(
      ctx,
      {
        mode: 'stems',
        tracks: [
          { channel: 'drums', buffer: fakeBuffer(5) },
          { channel: 'backing', buffer: fakeBuffer(5) },
        ],
        fallbackReason: null,
      },
      mixer,
    )
    player.play()
    expect(ctx.sources.map(s => s.output)).toEqual([mixer.input('drums'), mixer.input('backing')])
  })
})
