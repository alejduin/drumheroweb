import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIX,
  GAIN_RAMP_S,
  MIX_CHANNELS,
  Mixer,
  applyPreset,
  clampLevel,
  levelToGain,
  matchingPreset,
} from '@/audio/Mixer'
import { FakeAudioContext } from '../fakes/FakeAudioContext'
import type { FakeGainNode } from '../fakes/FakeAudioContext'

describe('niveles', () => {
  it('clampLevel limita a 0–1 y descarta valores no finitos', () => {
    expect([-0.5, 0.3, 1.7, NaN, Infinity].map(clampLevel)).toEqual([0, 0.3, 1, 0, 0])
  })

  it('levelToGain es cuadrática y respeta los extremos', () => {
    expect(levelToGain(0)).toBe(0)
    expect(levelToGain(1)).toBe(1)
    expect(levelToGain(0.5)).toBe(0.25)
    expect(levelToGain(2)).toBe(1)
  })
})

describe('presets', () => {
  it('"Tocar yo la batería": batería 0 %, backing 80 %, metrónomo 40 %; samples intactos', () => {
    const levels = applyPreset({ drums: 1, backing: 1, metronome: 0, samples: 0.6 }, 'play_drums')
    expect(levels).toEqual({ drums: 0, backing: 0.8, metronome: 0.4, samples: 0.6 })
    expect(matchingPreset(levels)).toBe('play_drums')
  })

  it('por defecto se arranca en "Tocar yo la batería" con los samples apagados', () => {
    expect(DEFAULT_MIX).toEqual({ drums: 0, backing: 0.8, metronome: 0.4, samples: 0 })
  })

  it('matchingPreset es null al tocar un deslizador', () => {
    expect(matchingPreset({ ...DEFAULT_MIX, backing: 0.7 })).toBeNull()
    expect(matchingPreset(applyPreset(DEFAULT_MIX, 'listen'))).toBe('listen')
  })
})

describe('Mixer', () => {
  function setup() {
    const ctx = new FakeAudioContext()
    const mixer = new Mixer(ctx)
    const gain = (i: number) => ctx.gains[i] as FakeGainNode
    return { ctx, mixer, gain }
  }

  it('crea un canal por pista conectado al destino, con los niveles iniciales sin rampa', () => {
    const { ctx, mixer, gain } = setup()
    expect(ctx.gains).toHaveLength(MIX_CHANNELS.length)
    expect(ctx.gains.every(g => g.output === ctx.destination)).toBe(true)
    expect(MIX_CHANNELS.map((_, i) => gain(i).gain.value)).toEqual(
      [0, 0.64, 0.16, 0].map(v => expect.closeTo(v, 9)),
    )
    expect(ctx.gains.every(g => g.ramps.length === 0)).toBe(true)
    expect(mixer.input('drums')).toBe(ctx.gains[0])
  })

  it('setLevel limita, guarda el nivel y aplica una rampa corta', () => {
    const { ctx, mixer, gain } = setup()
    ctx.currentTime = 3
    mixer.setLevel('backing', 1.5)
    expect(mixer.levels.backing).toBe(1)
    expect(gain(1).ramps).toEqual([[1, 3, GAIN_RAMP_S]])
  })

  it('applyPreset cambia solo los canales del preset', () => {
    const { mixer } = setup()
    mixer.setLevel('samples', 0.5)
    mixer.applyPreset('listen')
    expect(mixer.levels).toEqual({ drums: 1, backing: 1, metronome: 0, samples: 0.5 })
  })

  it('dispose desconecta los canales', () => {
    const { ctx, mixer } = setup()
    mixer.dispose()
    expect(ctx.gains.every(g => g.output === null)).toBe(true)
  })
})
