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
