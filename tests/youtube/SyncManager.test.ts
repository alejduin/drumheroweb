import { describe, expect, it } from 'vitest'
import { CORRECTION_COOLDOWN_MS, DRIFT_CONFIRM_FRAMES } from '@/youtube/sync'
import type { VideoState } from '@/youtube/sync'
import { SyncManager } from '@/youtube/SyncManager'
import type { SyncClock, VideoPlayer } from '@/youtube/SyncManager'

class FakeClock implements SyncClock {
  t = 0
  isPlaying = false
  playbackRate = 1
  epoch = 0
  now() {
    return this.t
  }
  play() {
    this.isPlaying = true
    this.epoch++
  }
  pause() {
    this.isPlaying = false
    this.epoch++
  }
  seek(t: number) {
    this.t = t
    this.epoch++
  }
}

/** Video falso: avanza solo con `advance`; registra las órdenes. */
class FakeVideo implements VideoPlayer {
  t = 0
  s: VideoState = 'cued'
  muted = true
  rate = 1
  log: string[] = []
  currentTime() {
    return this.t
  }
  state() {
    return this.s
  }
  play() {
    this.log.push('play')
    this.s = 'playing'
  }
  pause() {
    this.log.push('pause')
    this.s = 'paused'
  }
  seekTo(s: number) {
    this.log.push(`seek ${s.toFixed(3)}`)
    this.t = s
  }
  setPlaybackRate(r: number) {
    this.rate = r
  }
  ensureMuted() {
    this.muted = true
  }
  advance(dt: number) {
    if (this.s === 'playing') this.t += dt * this.rate
  }
}

/** Reloj y video avanzan juntos frame a frame (16 ms); `videoSpeed` simula deriva. */
function run(
  sync: SyncManager,
  clock: FakeClock,
  video: FakeVideo,
  fromMs: number,
  frames: number,
  videoSpeed = 1,
) {
  let perf = fromMs
  for (let i = 0; i < frames; i++) {
    perf += 16
    if (clock.isPlaying) clock.t += 0.016 * clock.playbackRate
    video.advance(0.016 * videoSpeed)
    sync.tick(perf)
  }
  return perf
}

function setup(offsetMs = 0) {
  const clock = new FakeClock()
  const video = new FakeVideo()
  const sync = new SyncManager(video, clock, offsetMs)
  return { clock, video, sync }
}

describe('SyncManager', () => {
  it('sigue play y pausa del reloj, y en cada cambio alinea el video', () => {
    const { clock, video, sync } = setup()
    sync.tick(0)
    expect(video.log).toEqual(['seek 0.000'])
    clock.play()
    run(sync, clock, video, 0, 10)
    expect(video.s).toBe('playing')
    clock.pause()
    sync.tick(500)
    expect(video.s).toBe('paused')
    expect(video.log.at(-1)).toBe('pause')
  })

  it('un seek del reloj mueve el video aunque esté en pausa', () => {
    const { clock, video, sync } = setup(2000)
    sync.tick(0)
    clock.seek(30)
    sync.tick(16)
    expect(video.log.at(-1)).toBe('seek 32.000')
  })

  it('con deriva sostenida > 40 ms corrige con seekTo; sin deriva no toca el video', () => {
    const { clock, video, sync } = setup()
    clock.play()
    // 5 s al mismo ritmo: ninguna corrección
    let perf = run(sync, clock, video, 0, 300)
    expect(sync.getStats().corrections).toBe(0)
    // el video va un 2 % más rápido: deriva ~0.3 ms por frame → corrige
    perf = run(sync, clock, video, perf, 300, 1.02)
    expect(sync.getStats().corrections).toBeGreaterThan(0)
    expect(Math.abs((video.t - clock.t) * 1000)).toBeLessThan(45)
    expect(perf).toBeGreaterThan(0)
  })

  it('con el video siempre en hora, la deriva máxima medida es ~0', () => {
    const { clock, video, sync } = setup()
    clock.play()
    run(sync, clock, video, 0, 60 * 60 * 3) // 3 min a 60 fps
    const stats = sync.getStats()
    expect(stats.corrections).toBe(0)
    expect(stats.maxAbsDriftMs).toBeLessThan(1)
  })

  it('no corrige antes de DRIFT_CONFIRM_FRAMES ni durante el enfriamiento', () => {
    const { clock, video, sync } = setup()
    clock.play()
    let perf = run(sync, clock, video, 0, Math.ceil(CORRECTION_COOLDOWN_MS / 16) + 1)
    video.t += 0.2 // salto de 200 ms
    sync.tick((perf += 16))
    expect(sync.getStats().corrections).toBe(0)
    for (let i = 1; i < DRIFT_CONFIRM_FRAMES; i++) sync.tick((perf += 16))
    expect(sync.getStats().corrections).toBe(1)
    video.t += 0.2
    run(sync, clock, video, perf, 10)
    expect(sync.getStats().corrections).toBe(1) // dentro del enfriamiento
  })

  it('sigue la velocidad del reloj', () => {
    const { clock, video, sync } = setup()
    clock.playbackRate = 0.75
    sync.tick(0)
    expect(video.rate).toBe(0.75)
  })

  it('si la canción empieza antes que el video, el video espera en 0', () => {
    const { clock, video, sync } = setup(-1000) // el video empieza 1 s después
    clock.play()
    run(sync, clock, video, 0, 30) // 0.48 s: todavía antes del video
    expect(video.s).not.toBe('playing')
    run(sync, clock, video, 480, 40) // pasa el segundo 1
    expect(video.s).toBe('playing')
    expect(video.t).toBeGreaterThan(0)
  })

  it('cada tick asegura el silencio; sin cargar no hace nada más', () => {
    const { clock, video, sync } = setup()
    video.s = 'unstarted'
    video.muted = false
    clock.play()
    sync.tick(0)
    expect(video.muted).toBe(true)
    expect(video.log).toEqual([])
  })
})
