import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_MIX, clampLevel } from '@/audio/Mixer'
import { normalizeTempo } from '@/audio/timeStretch'
import type { MixChannel, MixLevels } from '@/audio/Mixer'
import { DEFAULT_LEVEL } from '@/constants/scoring'
import { DEFAULT_ACCENT, applyAccent } from '@/constants/theme'
import type { AccentName } from '@/constants/theme'
import type { PracticeLayer } from '@/chart/layers'
import { DEFAULT_WEEKLY_GOAL_MIN } from '@/progress/history'
import type { Difficulty, Level, Piece, ScoreView } from '@/types'
import { DEFAULT_MIDI_MAP, migrateMidiMap } from '@/midi/midiMap'

export interface UserSettings {
  midiDeviceId: string | null
  midiLatencyOffsetMs: number
  midiMap: Record<number, Piece> // nota MIDI → pieza
  /** Ventanas de acierto (PLAN_V2 D1); la dificultad se elige por partida. */
  level: Level
  /** Última dificultad elegida en una partida (PLAN_V2 D1). */
  difficulty: Difficulty
  /** Último tempo elegido, 0,5–1 (PLAN_V2 D2). */
  tempo: number
  /** Cuenta de un compás al empezar o reanudar (D3). */
  countIn: boolean
  /** Rampa +5 % al lograr ≥ 90 % en una vuelta del loop (D3). */
  tempoRamp: boolean
  /** Modo espera: la partida se detiene en cada nota hasta tocarla (D4). */
  waitMode: boolean
  /** Última capa de práctica elegida (D5). */
  layer: PracticeLayer
  /** Meta semanal de práctica en minutos (D7). */
  weeklyGoalMin: number
  view: ScoreView
  scrollSpeed: number // multiplicador sobre la velocidad base
  dynamicsBonus: boolean
  mix: MixLevels
  /** Color de acento de la UI (variantes de las maquetas). */
  accent: AccentName
  /** Latencia calibrada por dispositivo MIDI (D8), por nombre del dispositivo. */
  latencyProfiles: Record<string, LatencyProfile>
}

export interface LatencyProfile {
  latencyMs: number
  updatedAt: number
}

interface SettingsStore extends UserSettings {
  setMidiDevice(id: string | null): void
  setLatencyOffset(ms: number): void
  setMidiMap(map: Record<number, Piece>): void
  setLevel(level: Level): void
  setDifficulty(difficulty: Difficulty): void
  setTempo(tempo: number): void
  setCountIn(on: boolean): void
  setTempoRamp(on: boolean): void
  setWaitMode(on: boolean): void
  setLayer(layer: PracticeLayer): void
  setWeeklyGoal(minutes: number): void
  setView(view: ScoreView): void
  setScrollSpeed(v: number): void
  setDynamicsBonus(on: boolean): void
  setMixLevel(channel: MixChannel, level: number): void
  setMix(mix: MixLevels): void
  setAccent(accent: AccentName): void
  /** Guarda la latencia de un dispositivo (la sincronía con el MIDI lo llama sola). */
  setLatencyProfile(device: string, latencyMs: number, at?: number): void
}

export const DEFAULT_SETTINGS: UserSettings = {
  midiDeviceId: null,
  midiLatencyOffsetMs: 0,
  midiMap: { ...DEFAULT_MIDI_MAP },
  level: DEFAULT_LEVEL,
  difficulty: 'full',
  tempo: 1,
  countIn: false,
  tempoRamp: false,
  waitMode: false,
  layer: 'full',
  weeklyGoalMin: DEFAULT_WEEKLY_GOAL_MIN,
  view: 'staff',
  scrollSpeed: 1.0,
  dynamicsBonus: true,
  mix: { ...DEFAULT_MIX },
  accent: DEFAULT_ACCENT,
  latencyProfiles: {},
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
      setDifficulty: difficulty => set({ difficulty }),
      setTempo: tempo => set({ tempo: normalizeTempo(tempo) }),
      setCountIn: on => set({ countIn: on }),
      setTempoRamp: on => set({ tempoRamp: on }),
      setWaitMode: on => set({ waitMode: on }),
      setLayer: layer => set({ layer }),
      setWeeklyGoal: minutes =>
        set({ weeklyGoalMin: Math.min(Math.max(Math.round(minutes), 10), 1000) }),
      setView: view => set({ view }),
      setScrollSpeed: v => set({ scrollSpeed: v }),
      setDynamicsBonus: on => set({ dynamicsBonus: on }),
      setMixLevel: (channel, level) =>
        set(state => ({ mix: { ...state.mix, [channel]: clampLevel(level) } })),
      setMix: mix => set({ mix: { ...mix } }),
      setAccent: accent => set({ accent }),
      setLatencyProfile: (device, latencyMs, at = Date.now()) =>
        set(state => ({
          latencyProfiles: { ...state.latencyProfiles, [device]: { latencyMs, updatedAt: at } },
        })),
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
