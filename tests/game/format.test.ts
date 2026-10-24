import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatClockMs,
  formatPercent,
  formatScore,
  formatSignedMs,
} from '@/game/format'

describe('formato de tiempos', () => {
  it('m:ss para el header', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(84.9)).toBe('1:24')
    expect(formatClock(203)).toBe('3:23')
    expect(formatClock(3600 + 5)).toBe('60:05')
  })

  it('m:ss.mmm para el transporte, sin redondear hacia arriba', () => {
    expect(formatClockMs(84.318)).toBe('1:24.318')
    expect(formatClockMs(203)).toBe('3:23.000')
    expect(formatClockMs(59.9999)).toBe('0:59.999')
    expect(formatClockMs(0.07)).toBe('0:00.070')
  })

  it('valores negativos o NaN se muestran como 0', () => {
    expect(formatClock(-3)).toBe('0:00')
    expect(formatClockMs(-0.01)).toBe('0:00.000')
  })
})

describe('formato de números', () => {
  it('puntos con separador de miles como la maqueta', () => {
    expect(formatScore(12450)).toBe('12,450')
    expect(formatScore(0)).toBe('0')
    expect(formatScore(1234567.4)).toBe('1,234,567')
  })

  it('porcentaje y "—" sin datos', () => {
    expect(formatPercent(0.94)).toBe('94%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(null)).toBe('—')
  })

  it('ms con signo', () => {
    expect(formatSignedMs(42)).toBe('+42 ms')
    expect(formatSignedMs(-8.6)).toBe('-9 ms')
    expect(formatSignedMs(0)).toBe('0 ms')
  })
})
