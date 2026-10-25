import { useSettingsStore } from '@/store/settingsStore'
import { midiManager } from './MidiManager'

/**
 * Mantiene el mapa del midiManager igual al guardado en ajustes (al arrancar y
 * cada vez que la calibración lo cambia). Retorna la baja.
 */
export function syncMidiMapWithSettings(): () => void {
  midiManager.setMidiMap(useSettingsStore.getState().midiMap)
  return useSettingsStore.subscribe((state, prev) => {
    if (state.midiMap !== prev.midiMap) midiManager.setMidiMap(state.midiMap)
  })
}
