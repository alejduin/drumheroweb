import { useSyncExternalStore } from 'react'
import { midiManager } from '@/midi/MidiManager'

const subscribe = (onChange: () => void) => {
  const unsubs = [midiManager.onStateChange(onChange), midiManager.onDevicesChange(onChange)]
  return () => unsubs.forEach(unsub => unsub())
}
const snapshot = () => midiManager.getSelectedDeviceName()

/** Nombre del dispositivo MIDI seleccionado (null sin batería). */
export function useMidiDeviceName(): string | null {
  return useSyncExternalStore(subscribe, snapshot)
}
