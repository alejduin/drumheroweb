import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_MIDI_MAP } from '@/midi/midiMap'
import type { DrumInstrument, UserSettings } from '@/types'

interface SettingsStore extends UserSettings {
  setMidiDevice(id: string | null): void
  setLatencyOffset(ms: number): void
  setMidiMap(map: Record<number, DrumInstrument>): void
  setMetronomeVolume(v: number): void
  setSampleVolume(v: number): void
  setScrollSpeed(v: number): void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    set => ({
      midiDeviceId: null,
      midiLatencyOffsetMs: 0,
      midiMap: DEFAULT_MIDI_MAP,
      metronomeVolume: 0.7,
      sampleVolume: 1.0,
      scrollSpeed: 1.0,

      setMidiDevice: id => set({ midiDeviceId: id }),
      setLatencyOffset: ms => set({ midiLatencyOffsetMs: ms }),
      setMidiMap: map => set({ midiMap: map }),
      setMetronomeVolume: v => set({ metronomeVolume: v }),
      setSampleVolume: v => set({ sampleVolume: v }),
      setScrollSpeed: v => set({ scrollSpeed: v }),
    }),
    { name: 'drumhero-settings' },
  ),
)
