import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_MIX, clampLevel } from '@/audio/Mixer'
import type { MixChannel, MixLevels } from '@/audio/Mixer'
import { DEFAULT_LEVEL } from '@/constants/scoring'
import { DEFAULT_ACCENT, applyAccent } from '@/constants/theme'
import type { AccentName } from '@/constants/theme'
import type { Level, Piece, ScoreView } from '@/types'
import { DEFAULT_MIDI_MAP, migrateMidiMap } from '@/midi/midiMap'

export interface UserSettings {
  midiDeviceId: string | null
  midiLatencyOffsetMs: number
  midiMap: Record<number, Piece> // nota MIDI → pieza
  /** Ventanas de acierto (PLAN_V2 D1); la dificultad se elige por partida. */
  level: Level
  view: ScoreView
  scrollSpeed: number // multiplicador sobre la velocidad base
  dynamicsBonus: boolean
  mix: MixLevels
  /** Color de acento de la UI (variantes de las maquetas). */
  accent: AccentName
}

interface SettingsStore extends UserSettings {
  setMidiDevice(id: string | null): void
  setLatencyOffset(ms: number): void
  setMidiMap(map: Record<number, Piece>): void
  setLevel(level: Level): void
  setView(view: ScoreView): void
  setScrollSpeed(v: number): void
  setDynamicsBonus(on: boolean): void
  setMixLevel(channel: MixChannel, level: number): void
  setMix(mix: MixLevels): void
  setAccent(accent: AccentName): void
}

export const DEFAULT_SETTINGS: UserSettings = {
  midiDeviceId: null,
  midiLatencyOffsetMs: 0,
  midiMap: { ...DEFAULT_MIDI_MAP },
  level: DEFAULT_LEVEL,
  view: 'staff',
  scrollSpeed: 1.0,
  dynamicsBonus: true,
  mix: { ...DEFAULT_MIX },
  accent: DEFAULT_ACCENT,
}

/** Ajustes guardados por una versión anterior → versión actual. */
export function migrateSettings(persisted: unknown, version: number): Partial<UserSettings> {
  const state = { ...(persisted as Record<string, unknown>) }
  // v1: mapa con tom3 y sin ride_edge (PLAN_V2 D5)
  if (version < 1 && state.midiMap) {
    state.midiMap = migrateMidiMap(state.midiMap as Record<number, string>)
  }
  // v2: volúmenes sueltos de V1 → mezclador por canal
  if (version < 2) {
    const metronome = state.metronomeVolume
    const samples = state.sampleVolume
    state.mix = {
      ...DEFAULT_MIX,
      ...(typeof metronome === 'number' ? { metronome: clampLevel(metronome) } : {}),
      ...(typeof samples === 'number' ? { samples: clampLevel(samples) } : {}),
    }
    delete state.metronomeVolume
    delete state.sampleVolume
  }
  return state as Partial<UserSettings>
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    set => ({
      ...DEFAULT_SETTINGS,

      setMidiDevice: id => set({ midiDeviceId: id }),
      setLatencyOffset: ms => set({ midiLatencyOffsetMs: ms }),
      setMidiMap: map => set({ midiMap: map }),
      setLevel: level => set({ level }),
      setView: view => set({ view }),
      setScrollSpeed: v => set({ scrollSpeed: v }),
      setDynamicsBonus: on => set({ dynamicsBonus: on }),
      setMixLevel: (channel, level) =>
        set(state => ({ mix: { ...state.mix, [channel]: clampLevel(level) } })),
      setMix: mix => set({ mix: { ...mix } }),
      setAccent: accent => set({ accent }),
    }),
    {
      name: 'drumhero-settings',
      version: 2,
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsStore,
    },
  ),
)

/** Aplica el acento guardado y lo sigue al cambiar. Retorna la desuscripción. */
export function syncAccentWithSettings(root: HTMLElement = document.documentElement): () => void {
  applyAccent(useSettingsStore.getState().accent, root)
  return useSettingsStore.subscribe((state, prev) => {
    if (state.accent !== prev.accent) applyAccent(state.accent, root)
  })
}
