import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMidiMessage, parseNoteOn } from '@/midi/MidiManager'
import { DEFAULT_MIDI_MAP } from '@/midi/midiMap'

// ─── Helper: construir un MIDIMessageEvent falso ──────────────────────────────

function makeMidiEvent(status: number, note: number, velocity: number): MIDIMessageEvent {
  return {
    data: new Uint8Array([status, note, velocity]),
    timeStamp: 1000,
  } as unknown as MIDIMessageEvent
}

// Canal 10 (index 9): status noteOn = 0x90 | 0x09 = 0x99
const NOTE_ON_CH10 = 0x99
// Canal 1 (index 0): status noteOn = 0x90 | 0x00 = 0x90
const NOTE_ON_CH1 = 0x90
// noteOff canal 10 = 0x80 | 0x09 = 0x89
const NOTE_OFF_CH10 = 0x89

describe('parseMidiMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parsea un golpe válido de kick', () => {
    const event = makeMidiEvent(NOTE_ON_CH10, 36, 100)
    const hit = parseMidiMessage(event, DEFAULT_MIDI_MAP)

    expect(hit).not.toBeNull()
    expect(hit?.instrument).toBe('kick')
    expect(hit?.midi).toBe(36)
    expect(hit?.velocity).toBe(100)
    expect(hit?.timestamp).toBe(1000)
  })

  it('parsea un golpe válido de snare', () => {
    const event = makeMidiEvent(NOTE_ON_CH10, 38, 80)
    const hit = parseMidiMessage(event, DEFAULT_MIDI_MAP)
    expect(hit?.instrument).toBe('snare')
  })

  it('ignora mensajes en canales distintos al 10', () => {
    const event = makeMidiEvent(NOTE_ON_CH1, 36, 100)
    expect(parseMidiMessage(event, DEFAULT_MIDI_MAP)).toBeNull()
  })

  it('ignora noteOff (status 0x89)', () => {
    const event = makeMidiEvent(NOTE_OFF_CH10, 36, 0)
    expect(parseMidiMessage(event, DEFAULT_MIDI_MAP)).toBeNull()
  })

  it('ignora noteOn con velocity 0 (= noteOff en Roland)', () => {
    const event = makeMidiEvent(NOTE_ON_CH10, 36, 0)
    expect(parseMidiMessage(event, DEFAULT_MIDI_MAP)).toBeNull()
  })

  it('ignora velocity por debajo del umbral mínimo (golpes fantasma)', () => {
    const event = makeMidiEvent(NOTE_ON_CH10, 36, 3) // MIN_VELOCITY = 5
    expect(parseMidiMessage(event, DEFAULT_MIDI_MAP)).toBeNull()
  })

  it('ignora notas MIDI no mapeadas', () => {
    const event = makeMidiEvent(NOTE_ON_CH10, 99, 100) // nota 99 no existe
    expect(parseMidiMessage(event, DEFAULT_MIDI_MAP)).toBeNull()
  })

  it('retorna null si data está vacío o es demasiado corto', () => {
    const shortEvent = { data: new Uint8Array([0x99]), timeStamp: 0 } as unknown as MIDIMessageEvent
    expect(parseMidiMessage(shortEvent, DEFAULT_MIDI_MAP)).toBeNull()

    const emptyEvent = { data: new Uint8Array([]), timeStamp: 0 } as unknown as MIDIMessageEvent
    expect(parseMidiMessage(emptyEvent, DEFAULT_MIDI_MAP)).toBeNull()
  })

  it('usa el mapa personalizado si se provee', () => {
    const customMap = { 60: 'crash' as const }
    const event = makeMidiEvent(NOTE_ON_CH10, 60, 90)
    const hit = parseMidiMessage(event, customMap)
    expect(hit?.instrument).toBe('crash')
  })

  it('usa performance.now() si timeStamp es 0', () => {
    vi.spyOn(performance, 'now').mockReturnValue(9999)
    const event = makeMidiEvent(NOTE_ON_CH10, 36, 100)
    // timeStamp = 1000 en nuestro helper, así que NO debe usar performance.now()
    const hit = parseMidiMessage(event, DEFAULT_MIDI_MAP)
    expect(hit?.timestamp).toBe(1000)
  })
})

describe('parseNoteOn', () => {
  it('acepta noteOn de cualquier canal y nota, sin mapa', () => {
    expect(parseNoteOn(makeMidiEvent(NOTE_ON_CH10, 43, 90))).toEqual({
      note: 43,
      velocity: 90,
      channel: 9,
      timestamp: 1000,
    })
    expect(parseNoteOn(makeMidiEvent(NOTE_ON_CH1, 60, 64))?.channel).toBe(0)
  })

  it('ignora noteOff y noteOn con velocity 0', () => {
    expect(parseNoteOn(makeMidiEvent(NOTE_OFF_CH10, 36, 64))).toBeNull()
    expect(parseNoteOn(makeMidiEvent(NOTE_ON_CH10, 36, 0))).toBeNull()
  })
})
