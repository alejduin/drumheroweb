import { describe, expect, it } from 'vitest'
import { DEFAULT_MIDI_MAP, invertMidiMap, migrateMidiMap, resolveInstrument } from '@/midi/midiMap'

describe('DEFAULT_MIDI_MAP', () => {
  it('contiene todos los instrumentos Roland TD-02KV', () => {
    const instruments = Object.values(DEFAULT_MIDI_MAP)
    expect(instruments).toContain('kick')
    expect(instruments).toContain('snare')
    expect(instruments).toContain('hihat_closed')
    expect(instruments).toContain('hihat_open')
    expect(instruments).toContain('hihat_pedal')
    expect(instruments).toContain('crash')
    expect(instruments).toContain('ride')
    expect(instruments).toContain('tom1')
    expect(instruments).toContain('tom2')
    expect(instruments).toContain('tom3')
  })

  it('mapea las notas MIDI correctas según el estándar Roland', () => {
    expect(DEFAULT_MIDI_MAP[36]).toBe('kick')
    expect(DEFAULT_MIDI_MAP[38]).toBe('snare')
    expect(DEFAULT_MIDI_MAP[40]).toBe('snare_rim')
    expect(DEFAULT_MIDI_MAP[42]).toBe('hihat_closed')
    expect(DEFAULT_MIDI_MAP[44]).toBe('hihat_pedal')
    expect(DEFAULT_MIDI_MAP[46]).toBe('hihat_open')
    expect(DEFAULT_MIDI_MAP[48]).toBe('tom1')
    expect(DEFAULT_MIDI_MAP[45]).toBe('tom2')
    expect(DEFAULT_MIDI_MAP[49]).toBe('crash')
    expect(DEFAULT_MIDI_MAP[51]).toBe('ride')
    expect(DEFAULT_MIDI_MAP[43]).toBe('tom3')
    expect(DEFAULT_MIDI_MAP[59]).toBe('ride') // borde del ride = ride (D5)
    expect(Object.keys(DEFAULT_MIDI_MAP)).toHaveLength(12)
  })
})

describe('resolveInstrument', () => {
  it('retorna el instrumento correcto para una nota conocida', () => {
    expect(resolveInstrument(36)).toBe('kick')
    expect(resolveInstrument(38)).toBe('snare')
    expect(resolveInstrument(49)).toBe('crash')
  })

  it('retorna undefined para notas no mapeadas', () => {
    expect(resolveInstrument(0)).toBeUndefined()
    expect(resolveInstrument(127)).toBeUndefined()
    expect(resolveInstrument(37)).toBeUndefined()
  })

  it('usa el mapa personalizado cuando se provee', () => {
    const customMap = { 60: 'kick' as const }
    expect(resolveInstrument(60, customMap)).toBe('kick')
    expect(resolveInstrument(36, customMap)).toBeUndefined()
  })
})

describe('invertMidiMap', () => {
  it('invierte correctamente el mapa nota→instrumento', () => {
    const inverted = invertMidiMap(DEFAULT_MIDI_MAP)
    expect(inverted['kick']).toBe(36)
    expect(inverted['snare']).toBe(38)
    expect(inverted['crash']).toBe(49)
    expect(inverted['ride']).toBe(51) // 51 y 59 → ride: gana la menor
  })

  it('maneja un mapa personalizado', () => {
    const custom = { 60: 'kick' as const, 62: 'snare' as const }
    const inverted = invertMidiMap(custom)
    expect(inverted['kick']).toBe(60)
    expect(inverted['snare']).toBe(62)
  })
})

describe('migrateMidiMap', () => {
  it('convierte ride_edge en ride y agrega tom3 si falta', () => {
    const v1 = { 36: 'kick', 51: 'ride', 59: 'ride_edge', 99: 'cowbell' }
    expect(migrateMidiMap(v1)).toEqual({ 36: 'kick', 51: 'ride', 59: 'ride', 43: 'tom3' })
  })

  it('respeta una asignación propia de la nota 43', () => {
    expect(migrateMidiMap({ 43: 'tom2' })).toEqual({ 43: 'tom2' })
  })
})
