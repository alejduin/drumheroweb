import { describe, expect, it } from 'vitest'
import { PERF_SAMPLES, PerfMonitor, perfLines } from '@/perf/PerfMonitor'

function monitor() {
  const m = new PerfMonitor()
  m.enabled = true
  return m
}

describe('PerfMonitor', () => {
  it('apagado no acumula nada', () => {
    const m = new PerfMonitor()
    m.frame(0, 1)
    m.frame(16, 1)
    m.hit(2)
    m.clock(0, 0, 1, true)
    m.clock(16, 0.016, 1, true)
    expect(m.summary()).toMatchObject({ fps: null, hit: null, drift: null, paint: null })
  })

  it('fps, p95 y frames lentos a partir de los intervalos', () => {
    const m = monitor()
    let t = 0
    m.frame(t, 2)
    for (let i = 0; i < 99; i++) m.frame((t += 1000 / 60), 2)
    m.frame((t += 40), 3) // un frame perdido
    m.frame((t += 2000), 2) // pestaña oculta: no cuenta como intervalo
    const s = m.summary()
    expect(s.frame?.count).toBe(100)
    expect(s.fps).toBeCloseTo(1000 / ((99 * (1000 / 60) + 40) / 100), 5)
    expect(s.longFrames).toBe(1)
    expect(s.paint?.max).toBe(3)
  })

  it('golpes: percentil 95 y máximo', () => {
    const m = monitor()
    for (let i = 1; i <= 100; i++) m.hit(i / 10)
    const s = m.summary()
    expect(s.hit?.p95).toBeCloseTo(9.5, 5)
    expect(s.hit?.max).toBeCloseTo(10, 5)
  })

  it('reloj: fluctuación respecto del tiempo real, con el tempo; ignora seeks y pausas', () => {
    const m = monitor()
    m.clock(0, 10, 0.5, true)
    m.clock(20, 10.01, 0.5, true) // avanzó justo 20 ms × 0,5 → 0
    m.clock(40, 10.023, 0.5, true) // 26 ms de reloj en 20 ms reales → 6 ms
    m.clock(60, 30, 0.5, true) // seek: no cuenta
    m.clock(80, 30, 0.5, false) // pausa: corta la serie
    m.clock(100, 31, 0.5, true)
    const s = m.summary()
    expect(s.drift?.count).toBe(2)
    expect(s.drift?.max).toBeCloseTo(6, 5)
  })

  it('conserva solo las últimas PERF_SAMPLES muestras', () => {
    const m = monitor()
    for (let i = 0; i < PERF_SAMPLES; i++) m.hit(100)
    for (let i = 0; i < PERF_SAMPLES; i++) m.hit(1)
    expect(m.summary().hit).toMatchObject({ count: PERF_SAMPLES, max: 1 })
    m.reset()
    expect(m.summary().hit).toBeNull()
  })

  it('líneas del panel con el veredicto frente a §10', () => {
    const m = monitor()
    expect(perfLines(m.summary()).map(l => l.ok)).toEqual([null, null, null])
    let t = 0
    m.frame(t, 1)
    for (let i = 0; i < 60; i++) m.frame((t += 1000 / 60), 1)
    m.hit(1.2)
    m.hit(7)
    m.clock(0, 0, 1, true)
    m.clock(16, 0.0161, 1, true)
    const lines = perfLines(m.summary())
    expect(lines.map(l => l.label)).toEqual(['Render', 'Golpe', 'Reloj'])
    expect(lines.map(l => l.ok)).toEqual([true, false, true])
    expect(lines[1].value).toBe('p95 7.0 ms · máx 7.0 ms · 2 golpes')
  })
})
