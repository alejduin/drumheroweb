import { describe, expect, it, vi } from 'vitest'
import { BufferPlayer, START_LEAD_S } from '@/audio/BufferPlayer'
import { FakeAudioContext, fakeBuffer } from '../fakes/FakeAudioContext'

function setup(duration = 60) {
  const ctx = new FakeAudioContext()
  ctx.outputLatency = 0
  ctx.baseLatency = 0
  let perf = 0
  const player = new BufferPlayer(ctx, fakeBuffer(duration), () => perf)
  const advance = (s: number) => {
    ctx.currentTime += s
    perf += s * 1000
  }
  return { ctx, player, advance }
}

describe('BufferPlayer', () => {
  it('programa el arranque con margen y el reloj sigue esa misma programación', () => {
    const { ctx, player, advance } = setup()
    ctx.currentTime = 2
    player.play()
    expect(ctx.lastSource.startArgs).toEqual([2 + START_LEAD_S, 0])
    expect(ctx.lastSource.connected).toBe(true)
    advance(START_LEAD_S + 1)
    expect(player.clock.now()).toBeCloseTo(1, 9)
  })

  it('pausa y reanuda desde la misma posición con una fuente nueva', () => {
    const { ctx, player, advance } = setup()
    player.play()
    advance(START_LEAD_S + 5)
    player.pause()
    const first = ctx.lastSource
    expect(first.stopped).toBe(true)
    expect(player.isPlaying).toBe(false)
    advance(3)
    player.play()
    expect(ctx.sources).toHaveLength(2)
    expect(ctx.lastSource.startArgs?.[1]).toBeCloseTo(5, 9)
  })

  it('seek durante la reproducción reinicia en la nueva posición', () => {
    const { ctx, player, advance } = setup()
    player.play()
    advance(1)
    player.seek(42)
    expect(ctx.sources[0].stopped).toBe(true)
    expect(ctx.lastSource.startArgs?.[1]).toBe(42)
    expect(player.isPlaying).toBe(true)
  })

  it('seek con el reproductor detenido se limita a la duración', () => {
    const { player } = setup(10)
    player.seek(-3)
    expect(player.clock.now()).toBe(0)
    player.seek(99)
    expect(player.clock.now()).toBe(10)
    player.play() // al final: no arranca
    expect(player.isPlaying).toBe(false)
  })

  it('el fin natural detiene el reloj al final y avisa una vez', () => {
    const { ctx, player } = setup(10)
    const onEnded = vi.fn()
    player.onEnded(onEnded)
    player.play()
    ctx.lastSource.finish()
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
})
