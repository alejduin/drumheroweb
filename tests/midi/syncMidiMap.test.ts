import { afterEach, describe, expect, it } from 'vitest'
import { midiManager } from '@/midi/MidiManager'
import { DEFAULT_MIDI_MAP } from '@/midi/midiMap'
import { syncMidiMapWithSettings } from '@/midi/syncMidiMap'
import { useSettingsStore } from '@/store/settingsStore'

describe('syncMidiMapWithSettings', () => {
  afterEach(() => useSettingsStore.getState().setMidiMap({ ...DEFAULT_MIDI_MAP }))

  it('aplica el mapa guardado al arrancar y cada cambio posterior', () => {
    useSettingsStore.getState().setMidiMap({ 37: 'snare' })
    midiManager.setMidiMap({ ...DEFAULT_MIDI_MAP })
    const unsub = syncMidiMapWithSettings()
    expect(midiManager.getMidiMap()).toEqual({ 37: 'snare' })

    useSettingsStore.getState().setMidiMap({ 37: 'snare', 36: 'kick' })
    expect(midiManager.getMidiMap()).toEqual({ 37: 'snare', 36: 'kick' })

    unsub()
    useSettingsStore.getState().setMidiMap({ 36: 'kick' })
    expect(midiManager.getMidiMap()).toEqual({ 37: 'snare', 36: 'kick' })
  })
})
