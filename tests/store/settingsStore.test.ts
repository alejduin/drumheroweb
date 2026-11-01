import { describe, expect, it } from 'vitest'
import { DEFAULT_MIX } from '@/audio/Mixer'
import { migrateSettings } from '@/store/settingsStore'

describe('migrateSettings', () => {
  it('v1 → v2: los volúmenes sueltos pasan al mezclador', () => {
    const migrated = migrateSettings(
      { midiLatencyOffsetMs: 12, metronomeVolume: 0.7, sampleVolume: 2 },
      1,
    )
    expect(migrated.mix).toEqual({ ...DEFAULT_MIX, metronome: 0.7, samples: 1 })
    expect(migrated.midiLatencyOffsetMs).toBe(12)
    expect(migrated).not.toHaveProperty('metronomeVolume')
    expect(migrated).not.toHaveProperty('sampleVolume')
  })

  it('sin volúmenes guardados usa la mezcla por defecto', () => {
    expect(migrateSettings({}, 1).mix).toEqual(DEFAULT_MIX)
  })

  it('v2 no se toca', () => {
    const mix = { ...DEFAULT_MIX, backing: 0.3 }
    expect(migrateSettings({ mix }, 2).mix).toBe(mix)
  })
})

describe('syncAccentWithSettings', () => {
  it('aplica el acento guardado y lo sigue al cambiar', async () => {
    const { syncAccentWithSettings, useSettingsStore } = await import('@/store/settingsStore')
    const root = document.createElement('div')
    useSettingsStore.getState().setAccent('blue')
    const stop = syncAccentWithSettings(root)
    expect(root.getAttribute('data-accent')).toBe('blue')
    useSettingsStore.getState().setAccent('violet') // el acento por defecto no lleva atributo
    expect(root.hasAttribute('data-accent')).toBe(false)
    stop()
    useSettingsStore.getState().setAccent('pink')
    expect(root.hasAttribute('data-accent')).toBe(false)
  })
})

describe('tempo guardado', () => {
  it('se guarda redondeado a 50–100 % en pasos de 5 %', async () => {
    const { useSettingsStore } = await import('@/store/settingsStore')
    expect(useSettingsStore.getState().tempo).toBe(1)
    useSettingsStore.getState().setTempo(0.62)
    expect(useSettingsStore.getState().tempo).toBe(0.6)
    useSettingsStore.getState().setTempo(0.2)
    expect(useSettingsStore.getState().tempo).toBe(0.5)
    useSettingsStore.getState().setTempo(1)
  })
})
