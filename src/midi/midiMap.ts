import type { DrumInstrument } from '@/types'

// Mapa por defecto Roland TD-02KV
// El usuario puede sobreescribirlo desde la pantalla de calibración
export const DEFAULT_MIDI_MAP: Record<number, DrumInstrument> = {
  36: 'kick',
  38: 'snare',
  40: 'snare_rim',
  42: 'hihat_closed',
  44: 'hihat_pedal',
  46: 'hihat_open',
  48: 'tom1',
  45: 'tom2',
  49: 'crash',
  51: 'ride',
  59: 'ride_edge',
}

/**
 * Resuelve una nota MIDI a un instrumento usando el mapa dado.
 * Retorna undefined si la nota no está mapeada.
 */
export function resolveInstrument(
  midiNote: number,
  map: Record<number, DrumInstrument> = DEFAULT_MIDI_MAP,
): DrumInstrument | undefined {
  return map[midiNote]
}

/**
 * Invierte el mapa (instrumento → nota MIDI).
 * Útil para la pantalla de calibración.
 */
export function invertMidiMap(
  map: Record<number, DrumInstrument>,
): Partial<Record<DrumInstrument, number>> {
  const result: Partial<Record<DrumInstrument, number>> = {}
  for (const [note, instrument] of Object.entries(map)) {
    result[instrument] = Number(note)
  }
  return result
}
