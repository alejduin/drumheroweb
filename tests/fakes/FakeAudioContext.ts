import type { MixerContext } from '@/audio/Mixer'
import type { PlayerContext } from '@/audio/StemPlayer'

/** Fuente falsa: registra start/stop y permite simular el fin natural. */
export class FakeBufferSource {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  startArgs: [number, number] | null = null
  stopped = false
  output: unknown = null
  readonly playbackRate = { value: 1 }

  get connected(): boolean {
    return this.output !== null
  }

  connect(node: unknown): void {
    this.output = node
  }

  disconnect(): void {
    this.output = null
  }

  start(when = 0, offset = 0): void {
    this.startArgs = [when, offset]
  }

  stop(): void {
    this.stopped = true
  }

  /** Simula que el buffer terminó de sonar. */
  finish(): void {
    this.onended?.()
  }
}

/** GainNode falso: guarda el valor y las rampas pedidas. */
export class FakeGainNode {
  output: unknown = null
  readonly ramps: Array<[target: number, startTime: number, timeConstant: number]> = []
  readonly automation: Array<[kind: string, value: number, time: number]> = []
  readonly gain = {
    value: 1,
    setValueAtTime: (value: number, time: number) => {
      this.automation.push(['set', value, time])
    },
    exponentialRampToValueAtTime: (value: number, time: number) => {
      this.automation.push(['exp', value, time])
    },
    setTargetAtTime: (target: number, startTime: number, timeConstant: number) => {
      this.ramps.push([target, startTime, timeConstant])
      this.gain.value = target // el fake llega al objetivo al instante
    },
  }

  connect(node: unknown): void {
    this.output = node
  }

  disconnect(): void {
    this.output = null
  }
}

/** Oscilador falso: registra start/stop (los clicks del metrónomo). */
export class FakeOscillator {
  readonly frequency = { value: 440 }
  onended: (() => void) | null = null
  startAt: number | null = null
  stopAt: number | null = null
  /** stop() sin argumento = cancelado. */
  cancelled = false
  output: unknown = null

  connect(node: unknown): void {
    this.output = node
  }

  disconnect(): void {
    this.output = null
  }

  start(when = 0): void {
    this.startAt = when
  }

  stop(when?: number): void {
    if (when === undefined) this.cancelled = true
    else this.stopAt = when
  }
}

/**
 * AudioContext controlable: el test mueve `currentTime` y decide qué devuelve
 * getOutputTimestamp (o lo desactiva para probar el fallback con outputLatency).
 */
export class FakeAudioContext implements PlayerContext, MixerContext {
  currentTime = 0
  /** Baja para que los sonidos sintetizados del kit pesen poco en los tests. */
  readonly sampleRate = 8000
  outputLatency: number | undefined = 0.02
  baseLatency: number | undefined = 0.01
  /** null = getOutputTimestamp no disponible en este "navegador". */
  outputTimestamp: AudioTimestamp | null = null
  readonly destination = { name: 'destination' } as unknown as AudioNode
  readonly sources: FakeBufferSource[] = []
  readonly gains: FakeGainNode[] = []
  readonly oscillators: FakeOscillator[] = []

  get getOutputTimestamp(): (() => AudioTimestamp) | undefined {
    const ts = this.outputTimestamp
    return ts ? () => ts : undefined
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }

  createOscillator(): OscillatorNode {
    const osc = new FakeOscillator()
    this.oscillators.push(osc)
    return osc as unknown as OscillatorNode
  }

  createGain(): GainNode {
    const gain = new FakeGainNode()
    this.gains.push(gain)
    return gain as unknown as GainNode
  }

  get lastSource(): FakeBufferSource {
    return this.sources[this.sources.length - 1]
  }
}

export function fakeBuffer(duration: number): AudioBuffer {
  return { duration } as AudioBuffer
}
