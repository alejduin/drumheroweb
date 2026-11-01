import { useSettingsStore } from '@/store/settingsStore'
import { midiManager } from './MidiManager'
import type { MidiManager } from './MidiManager'

// ─── Perfil de latencia por dispositivo (PLAN_V2 D8) ──────────────────────────
// Cada kit (o interfaz MIDI) tiene su latencia. Al seleccionar un dispositivo con
// perfil se aplica su valor; al calibrar o ajustar a mano se guarda en el perfil
// del dispositivo conectado. Un dispositivo nuevo sigue con el último valor hasta
// que se calibre.

type DeviceSource = Pick<MidiManager, 'getSelectedDeviceName' | 'onDevicesChange'>

export function syncLatencyWithDevice(
  manager: DeviceSource = midiManager,
  store: typeof useSettingsStore = useSettingsStore,
): () => void {
  let device: string | null = null
  let applying = false

  const onDevice = () => {
    const name = manager.getSelectedDeviceName()
    if (name === device) return
    device = name
    if (!name) return
    const profile = store.getState().latencyProfiles[name]
    if (profile && profile.latencyMs !== store.getState().midiLatencyOffsetMs) {
      applying = true
      store.getState().setLatencyOffset(profile.latencyMs)
      applying = false
    }
  }

  onDevice()
  const unsubDevices = manager.onDevicesChange(onDevice)
  const unsubStore = store.subscribe((state, prev) => {
    if (applying || !device || state.midiLatencyOffsetMs === prev.midiLatencyOffsetMs) return
    state.setLatencyProfile(device, state.midiLatencyOffsetMs)
  })
  return () => {
    unsubDevices()
    unsubStore()
  }
}
