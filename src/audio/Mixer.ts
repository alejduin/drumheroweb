// ─── Mezclador ────────────────────────────────────────────────────────────────
// Un GainNode por canal hacia ctx.destination. Los niveles van de 0 a 1 (lo que
// muestra el deslizador); la ganancia aplica una curva perceptual.

export const MIX_CHANNELS = ['drums', 'backing', 'metronome', 'samples'] as const

export type MixChannel = (typeof MIX_CHANNELS)[number]

export type MixLevels = Record<MixChannel, number>

export const MIX_PRESETS = {
  // "Tocar yo la batería" (maqueta): sin la batería original, backing 80 %, metrónomo 40 %
  play_drums: { drums: 0, backing: 0.8, metronome: 0.4 },
  // Escuchar la canción completa, sin metrónomo
  listen: { drums: 1, backing: 1, metronome: 0 },
} as const satisfies Record<string, Partial<MixLevels>>

export type MixPreset = keyof typeof MIX_PRESETS

// Samples del kit desactivados por defecto: el sonido sale del módulo TD-02KV (REQUIREMENTS_V2 §8)
export const DEFAULT_MIX: Readonly<MixLevels> = { ...MIX_PRESETS.play_drums, samples: 0 }

// Constante de tiempo de la rampa de ganancia: evita clics al mover un deslizador
export const GAIN_RAMP_S = 0.015

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.min(Math.max(level, 0), 1)
}

/** Nivel del deslizador (0–1) → ganancia lineal. Curva cuadrática ≈ volumen percibido. */
export function levelToGain(level: number): number {
  const l = clampLevel(level)
  return l * l
}

/** Aplica un preset sobre los niveles actuales (los canales que no define se conservan). */
export function applyPreset(levels: Readonly<MixLevels>, preset: MixPreset): MixLevels {
  return { ...levels, ...MIX_PRESETS[preset] }
}

/** Preset que coincide con los niveles, si hay alguno (para resaltarlo en la UI). */
export function matchingPreset(levels: Readonly<MixLevels>): MixPreset | null {
  for (const [name, preset] of Object.entries(MIX_PRESETS) as [MixPreset, Partial<MixLevels>][]) {
    const matches = (Object.keys(preset) as MixChannel[]).every(
      channel => Math.abs(levels[channel] - preset[channel]!) < 1e-9,
    )
    if (matches) return name
  }
  return null
}

/** Subconjunto de AudioContext que usa el mezclador (fake en tests). */
export interface MixerContext {
  readonly currentTime: number
  readonly destination: AudioNode
  createGain(): GainNode
}

export class Mixer {
  private readonly ctx: MixerContext
  private readonly gains: Record<MixChannel, GainNode>
  private current: MixLevels

  constructor(ctx: MixerContext, levels: Readonly<MixLevels> = DEFAULT_MIX) {
    this.ctx = ctx
    this.current = { ...DEFAULT_MIX }
    const gains = {} as Record<MixChannel, GainNode>
    for (const channel of MIX_CHANNELS) {
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      gains[channel] = gain
    }
    this.gains = gains
    this.setLevels(levels, true)
  }

  /** Nodo al que se conectan las fuentes de ese canal. */
  input(channel: MixChannel): AudioNode {
    return this.gains[channel]
  }

  get levels(): Readonly<MixLevels> {
    return this.current
  }

  setLevel(channel: MixChannel, level: number, immediate = false): void {
    const l = clampLevel(level)
    this.current = { ...this.current, [channel]: l }
    const param = this.gains[channel].gain
    if (immediate) param.value = levelToGain(l)
    else param.setTargetAtTime(levelToGain(l), this.ctx.currentTime, GAIN_RAMP_S)
  }

  setLevels(levels: Partial<MixLevels>, immediate = false): void {
    for (const channel of MIX_CHANNELS) {
      const level = levels[channel]
      if (level !== undefined) this.setLevel(channel, level, immediate)
    }
  }

  applyPreset(preset: MixPreset): void {
    this.setLevels(MIX_PRESETS[preset])
  }

  dispose(): void {
    for (const channel of MIX_CHANNELS) this.gains[channel].disconnect()
  }
}
