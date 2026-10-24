import type { PlayerContext } from '@/audio/BufferPlayer'

/** Fuente falsa: registra start/stop y permite simular el fin natural. */
export class FakeBufferSource {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  startArgs: [number, number] | null = null
  stopped = false
  connected = false

  connect(): void {
    this.connected = true
  }

  disconnect(): void {
    this.connected = false
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

/**
 * AudioContext controlable: el test mueve `currentTime` y decide qué devuelve
 * getOutputTimestamp (o lo desactiva para probar el fallback con outputLatency).
 */
export class FakeAudioContext implements PlayerContext {
  currentTime = 0
  outputLatency: number | undefined = 0.02
  baseLatency: number | undefined = 0.01
  /** null = getOutputTimestamp no disponible en este "navegador". */
  outputTimestamp: AudioTimestamp | null = null
  readonly destination = {} as AudioNode
  readonly sources: FakeBufferSource[] = []

  get getOutputTimestamp(): (() => AudioTimestamp) | undefined {
    const ts = this.outputTimestamp
    return ts ? () => ts : undefined
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }

  get lastSource(): FakeBufferSource {
    return this.sources[this.sources.length - 1]
  }
}

export function fakeBuffer(duration: number): AudioBuffer {
  return { duration } as AudioBuffer
}
