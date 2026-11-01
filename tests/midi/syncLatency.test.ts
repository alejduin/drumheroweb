import { beforeEach, describe, expect, it } from 'vitest'
import type { MidiDevice } from '@/midi/MidiManager'
import { syncLatencyWithDevice } from '@/midi/syncLatency'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/store/settingsStore'
import { latencyProfileText } from '@/calibration/latency'

/** midiManager falso: el test elige el dispositivo y avisa. */
function fakeManager() {
  let name: string | null = null
  const listeners = new Set<(d: MidiDevice[]) => void>()
  return {
    getSelectedDeviceName: () => name,
    onDevicesChange: (cb: (d: MidiDevice[]) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    select(next: string | null) {
      name = next
      listeners.forEach(cb => cb([]))
    },
  }
}

beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS, latencyProfiles: {} }))

describe('perfil de latencia por dispositivo (D8)', () => {
  it('al calibrar se guarda en el perfil del dispositivo conectado', () => {
    const manager = fakeManager()
    const stop = syncLatencyWithDevice(manager)
    manager.select('TD-02')
    useSettingsStore.getState().setLatencyOffset(23)
    expect(useSettingsStore.getState().latencyProfiles['TD-02']).toMatchObject({ latencyMs: 23 })
    stop()
  })

  it('al cambiar de dispositivo aplica su perfil; uno sin perfil sigue con el último valor', () => {
    useSettingsStore.setState({
      latencyProfiles: {
        'TD-02': { latencyMs: 23, updatedAt: 1 },
        UM2: { latencyMs: 8, updatedAt: 1 },
      },
    })
    const manager = fakeManager()
    const stop = syncLatencyWithDevice(manager)
    manager.select('UM2')
    expect(useSettingsStore.getState().midiLatencyOffsetMs).toBe(8)
    manager.select('TD-02')
    expect(useSettingsStore.getState().midiLatencyOffsetMs).toBe(23)
    // Aplicar un perfil no lo reescribe
    expect(useSettingsStore.getState().latencyProfiles['TD-02'].updatedAt).toBe(1)
    manager.select('Nuevo')
    expect(useSettingsStore.getState().midiLatencyOffsetMs).toBe(23)
    expect(useSettingsStore.getState().latencyProfiles.Nuevo).toBeUndefined()
    stop()
  })

  it('sin dispositivo el ajuste no crea perfiles', () => {
    const stop = syncLatencyWithDevice(fakeManager())
    useSettingsStore.getState().setLatencyOffset(40)
    expect(useSettingsStore.getState().latencyProfiles).toEqual({})
    stop()
  })

  it('latencyProfileText', () => {
    const date = () => 'hoy'
    expect(latencyProfileText(null, undefined, date)).toMatch(/Conecta el kit/)
    expect(latencyProfileText('TD-02', undefined, date)).toMatch(/TD-02: sin calibrar/)
    expect(latencyProfileText('TD-02', { updatedAt: 1 }, date)).toBe(
      'Perfil de TD-02 · guardado hoy',
    )
  })
})
