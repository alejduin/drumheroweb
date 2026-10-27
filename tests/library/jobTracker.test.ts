import { describe, expect, it } from 'vitest'
import { WorkerError } from '@/api/workerClient'
import {
  MAX_NETWORK_FAILURES,
  MAX_POLL_DELAY_MS,
  POLL_INTERVAL_MS,
  initialTracker,
  pollDelayMs,
  trackJob,
  trackerReducer,
} from '@/library/jobTracker'
import type { TrackerDeps, TrackerState } from '@/library/jobTracker'
import { FakeWorkerClient, makeJob } from '../fakes/FakeWorkerClient'

const network = () => new WorkerError('NETWORK', 'sin red', 0)

function run(client: FakeWorkerClient, start = initialTracker(), patch: Partial<TrackerDeps> = {}) {
  const states: TrackerState[] = []
  const sleeps: number[] = []
  const completed: unknown[] = []
  const promise = trackJob(start, {
    client,
    getAudio: async () => ({
      file: new Blob(['x']),
      fileName: 'a.mp3',
      meta: { songId: 's', title: 'T', artist: 'A', durationS: 10, youtubeUrl: null },
    }),
    onComplete: async result => {
      completed.push(result)
    },
    onState: s => states.push(s),
    sleep: async ms => {
      sleeps.push(ms)
    },
    ...patch,
  })
  return { promise, states, sleeps, completed }
}

describe('trackerReducer', () => {
  it('sube, analiza, descarga y termina', () => {
    let s = initialTracker()
    expect(s.phase).toBe('uploading')
    s = trackerReducer(s, { type: 'created', jobId: 'j', done: false, cached: false })
    expect(s).toMatchObject({ phase: 'analyzing', jobId: 'j' })
    s = trackerReducer(s, { type: 'polled', job: makeJob('transcribing') })
    expect(s.phase).toBe('analyzing')
    s = trackerReducer(s, { type: 'polled', job: makeJob('done') })
    expect(s.phase).toBe('downloading')
    s = trackerReducer(s, { type: 'downloaded' })
    expect(s.phase).toBe('done')
  })

  it('un trabajo en caché pasa directo a descargar', () => {
    const s = trackerReducer(initialTracker(), {
      type: 'created',
      jobId: 'j',
      done: true,
      cached: true,
    })
    expect(s).toMatchObject({ phase: 'downloading', cached: true })
  })

  it('el fallo del análisis trae el error del worker', () => {
    const job = makeJob('failed', { error: { code: 'NO_DRUMS_DETECTED', message: 'sin batería' } })
    const s = trackerReducer(initialTracker('j'), { type: 'polled', job })
    expect(s).toMatchObject({ phase: 'failed', error: { code: 'NO_DRUMS_DETECTED' } })
  })

  it('los cortes de red cuentan hasta rendirse', () => {
    let s = initialTracker('j')
    const error = { code: 'NETWORK' as const, message: 'sin red' }
    for (let i = 1; i < MAX_NETWORK_FAILURES; i++) {
      s = trackerReducer(s, { type: 'network-error', error })
      expect(s).toMatchObject({ phase: 'analyzing', networkFailures: i })
    }
    s = trackerReducer(s, { type: 'network-error', error })
    expect(s.phase).toBe('failed')
    // una respuesta buena reinicia la cuenta
    const ok = trackerReducer(
      trackerReducer(initialTracker('j'), { type: 'network-error', error }),
      {
        type: 'polled',
        job: makeJob('queued'),
      },
    )
    expect(ok.networkFailures).toBe(0)
  })

  it('la espera crece con los fallos de red, con tope', () => {
    expect(pollDelayMs(initialTracker('j'))).toBe(POLL_INTERVAL_MS)
    expect(pollDelayMs({ ...initialTracker('j'), networkFailures: 2 })).toBe(POLL_INTERVAL_MS * 4)
    expect(pollDelayMs({ ...initialTracker('j'), networkFailures: 10 })).toBe(MAX_POLL_DELAY_MS)
  })

  it('reintentar: sigue consultando tras un corte de red, si no vuelve a subir', () => {
    const failedByNetwork: TrackerState = {
      ...initialTracker('j'),
      phase: 'failed',
      error: { code: 'NETWORK', message: '' },
      networkFailures: MAX_NETWORK_FAILURES,
    }
    expect(trackerReducer(failedByNetwork, { type: 'retry' })).toMatchObject({
      phase: 'analyzing',
      jobId: 'j',
      networkFailures: 0,
      error: null,
    })
    const failedAnalysis: TrackerState = {
      ...initialTracker('j'),
      phase: 'failed',
      error: { code: 'TRANSCRIPTION_FAILED', message: '' },
    }
    expect(trackerReducer(failedAnalysis, { type: 'retry' })).toMatchObject({
      phase: 'uploading',
      jobId: null,
    })
    // retry solo aplica a un fallo
    const running = initialTracker('j')
    expect(trackerReducer(running, { type: 'retry' })).toBe(running)
  })
})

describe('trackJob', () => {
  it('lleva el trabajo hasta done y entrega el resultado', async () => {
    const client = new FakeWorkerClient()
    client.jobs = [makeJob('queued'), makeJob('separating'), makeJob('done')]
    const { promise, states, sleeps, completed } = run(client)
    const final = await promise
    expect(final.phase).toBe('done')
    expect(client.created).toEqual([{ fileName: 'a.mp3', title: 'T', artist: 'A' }])
    expect(client.polls).toBe(3)
    expect(sleeps).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS])
    expect(states.map(s => s.phase)).toEqual([
      'analyzing',
      'analyzing',
      'analyzing',
      'downloading',
      'done',
    ])
    expect(completed).toHaveLength(1)
  })

  it('en caché no consulta: descarga directo', async () => {
    const client = new FakeWorkerClient()
    client.creates = [{ jobId: 'job-1', status: 'done', cached: true }]
    const { promise } = run(client)
    expect((await promise).cached).toBe(true)
    expect(client.polls).toBe(0)
  })

  it('reanuda un trabajo existente sin volver a subir', async () => {
    const client = new FakeWorkerClient()
    const getAudio = () => Promise.reject(new Error('no debería leer el audio'))
    const { promise } = run(client, initialTracker('job-1'), { getAudio })
    expect((await promise).phase).toBe('done')
    expect(client.created).toHaveLength(0)
  })

  it('reintenta los cortes de red con espera creciente', async () => {
    const client = new FakeWorkerClient()
    client.jobs = [network(), network(), makeJob('done')]
    const { promise, sleeps } = run(client)
    expect((await promise).phase).toBe('done')
    expect(sleeps).toEqual([POLL_INTERVAL_MS * 2, POLL_INTERVAL_MS * 4])
  })

  it('se rinde tras MAX_NETWORK_FAILURES cortes seguidos', async () => {
    const client = new FakeWorkerClient()
    client.jobs = [network()]
    const final = await run(client).promise
    expect(final).toMatchObject({ phase: 'failed', error: { code: 'NETWORK' } })
    expect(client.polls).toBe(MAX_NETWORK_FAILURES)
  })

  it('un archivo rechazado falla sin reintentar', async () => {
    const client = new FakeWorkerClient()
    client.creates = [new WorkerError('TOO_LONG', 'dura más de 10 min', 422)]
    const final = await run(client).promise
    expect(final).toMatchObject({ phase: 'failed', error: { code: 'TOO_LONG' } })
    expect(client.created).toHaveLength(1)
  })

  it('el análisis fallido termina en failed', async () => {
    const client = new FakeWorkerClient()
    client.jobs = [makeJob('failed', { error: { code: 'SEPARATION_FAILED', message: 'x' } })]
    const final = await run(client).promise
    expect(final.error?.code).toBe('SEPARATION_FAILED')
  })

  it('si guardar el resultado falla, termina en failed', async () => {
    const client = new FakeWorkerClient()
    const onComplete = () => Promise.reject(new Error('disco lleno'))
    const final = await run(client, initialTracker(), { onComplete }).promise
    expect(final).toMatchObject({
      phase: 'failed',
      error: { code: 'INTERNAL', message: 'disco lleno' },
    })
  })

  it('cancelar avisa al worker y termina en canceled', async () => {
    const client = new FakeWorkerClient()
    client.jobs = [makeJob('queued')]
    const controller = new AbortController()
    const sleep = async () => controller.abort()
    const final = await run(client, initialTracker(), { sleep, signal: controller.signal }).promise
    expect(final.phase).toBe('canceled')
    expect(client.canceled).toEqual(['job-1'])
  })
})
