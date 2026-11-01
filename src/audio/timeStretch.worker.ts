import { stretchChannels } from './timeStretch'

// Web Worker del time-stretch: el cálculo (unos segundos por canción) no bloquea la UI

export interface StretchRequest {
  channels: Float32Array[]
  sampleRate: number
  rate: number
}

export interface StretchResponse {
  channels?: Float32Array[]
  error?: string
}

self.onmessage = (event: MessageEvent<StretchRequest>) => {
  const { channels, sampleRate, rate } = event.data
  try {
    const out = stretchChannels(channels, sampleRate, rate)
    const response: StretchResponse = { channels: out }
    self.postMessage(response, { transfer: out.map(c => c.buffer) })
  } catch (error) {
    const response: StretchResponse = {
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
