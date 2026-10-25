import type { Job, JobResult } from '@/types'
import { WorkerError } from '@/api/workerClient'
import type { ClientErrorCode, WorkerClient } from '@/api/workerClient'

// ─── Seguimiento de un análisis (PLAN_V2 B13) ─────────────────────────────────
// Máquina de estados pura (trackerReducer) + un driver que sube el audio, consulta
// el trabajo cada POLL_INTERVAL_MS (Realtime llega con Supabase, B12) y descarga
// el resultado. Los cortes de red se reintentan con espera creciente.

export const POLL_INTERVAL_MS = 2000
export const MAX_POLL_DELAY_MS = 15000
/** Fallos de red seguidos antes de rendirse (con la espera creciente, ~1 min). */
export const MAX_NETWORK_FAILURES = 6

export type TrackerPhase =
  | 'uploading'
  | 'analyzing'
  | 'downloading'
  | 'done'
  | 'failed'
  | 'canceled'

export interface TrackerError {
  code: ClientErrorCode
  message: string
}

export interface TrackerState {
  phase: TrackerPhase
  jobId: string | null
  /** Último estado del trabajo recibido del worker. */
  job: Job | null
  cached: boolean
  error: TrackerError | null
  networkFailures: number
}

export type TrackerEvent =
  | { type: 'created'; jobId: string; done: boolean; cached: boolean }
  | { type: 'polled'; job: Job }
  | { type: 'network-error'; error: TrackerError }
  | { type: 'error'; error: TrackerError }
  | { type: 'downloaded' }
  | { type: 'canceled' }
  | { type: 'retry' }

export const initialTracker = (jobId: string | null = null): TrackerState => ({
  phase: jobId ? 'analyzing' : 'uploading',
  jobId,
  job: null,
  cached: false,
  error: null,
  networkFailures: 0,
})

export const isTerminal = (state: TrackerState) =>
  state.phase === 'done' || state.phase === 'failed' || state.phase === 'canceled'

export function trackerReducer(state: TrackerState, event: TrackerEvent): TrackerState {
  switch (event.type) {
    case 'created':
      return {
        ...state,
        jobId: event.jobId,
        cached: event.cached,
        phase: event.done ? 'downloading' : 'analyzing',
        networkFailures: 0,
        error: null,
      }
    case 'polled': {
      const { job } = event
      const base = { ...state, job, cached: state.cached || job.cached, networkFailures: 0 }
      if (job.status === 'done') return { ...base, phase: 'downloading' }
      if (job.status === 'canceled') return { ...base, phase: 'canceled' }
      if (job.status === 'failed') {
        const error = job.error ?? { code: 'INTERNAL', message: 'el análisis falló' }
        return { ...base, phase: 'failed', error }
      }
      return { ...base, phase: 'analyzing' }
    }
    case 'network-error': {
      const networkFailures = state.networkFailures + 1
      return networkFailures >= MAX_NETWORK_FAILURES
        ? { ...state, networkFailures, phase: 'failed', error: event.error }
        : { ...state, networkFailures, error: event.error }
    }
    case 'error':
      return { ...state, phase: 'failed', error: event.error }
    case 'downloaded':
      return { ...state, phase: 'done', error: null }
    case 'canceled':
      return { ...state, phase: 'canceled' }
    case 'retry': {
      if (state.phase !== 'failed') return state
      // Tras un corte de red se sigue consultando el mismo trabajo; en cualquier
      // otro caso se sube otra vez (la caché por sha256 lo resuelve al instante)
      const resume = state.jobId !== null && state.error?.code === 'NETWORK'
      return resume ? { ...initialTracker(state.jobId), job: state.job } : initialTracker()
    }
  }
}

/** Espera antes de la siguiente consulta: crece con los fallos de red seguidos. */
export function pollDelayMs(state: TrackerState): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** state.networkFailures, MAX_POLL_DELAY_MS)
}

export function toTrackerError(error: unknown): { error: TrackerError; transient: boolean } {
  if (error instanceof WorkerError) {
    return { error: { code: error.code, message: error.message }, transient: error.transient }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { error: { code: 'INTERNAL', message }, transient: false }
}

export interface DownloadedResult {
  result: JobResult
  drums: Blob
  backing: Blob
}

export interface TrackerDeps {
  client: WorkerClient
  /** El audio a subir (se lee de IndexedDB solo si hace falta subirlo). */
  getAudio: () => Promise<{ file: Blob; fileName: string; title: string; artist: string }>
  /** Guarda el resultado; si lanza, el seguimiento falla (INTERNAL). */
  onComplete: (downloaded: DownloadedResult) => Promise<void>
  onState: (state: TrackerState) => void
  sleep: (ms: number) => Promise<void>
  /** Cancelar: se pide al worker y se termina en `canceled`. */
  signal?: AbortSignal
}

/** Lleva un análisis hasta un estado final. Nunca lanza: los errores quedan en el estado. */
export async function trackJob(start: TrackerState, deps: TrackerDeps): Promise<TrackerState> {
  const { client } = deps
  let state = start
  const dispatch = (event: TrackerEvent) => {
    state = trackerReducer(state, event)
    deps.onState(state)
  }

  while (!isTerminal(state)) {
    if (deps.signal?.aborted) {
      if (state.jobId) await client.cancelJob(state.jobId).catch(() => {})
      dispatch({ type: 'canceled' })
      break
    }
    try {
      if (state.phase === 'uploading') {
        const { file, fileName, title, artist } = await deps.getAudio()
        const created = await client.createJob(file, fileName, { title, artist })
        dispatch({
          type: 'created',
          jobId: created.jobId,
          done: created.status === 'done',
          cached: created.cached,
        })
      } else if (state.phase === 'analyzing') {
        dispatch({ type: 'polled', job: await client.getJob(state.jobId!) })
        if (state.phase === 'analyzing') await deps.sleep(pollDelayMs(state))
      } else {
        const result = await client.getResult(state.jobId!)
        const [drums, backing] = await Promise.all([
          client.download(result.stems.drums),
          client.download(result.stems.backing),
        ])
        await deps.onComplete({ result, drums, backing })
        dispatch({ type: 'downloaded' })
      }
    } catch (error) {
      const { error: trackerError, transient } = toTrackerError(error)
      if (transient) {
        dispatch({ type: 'network-error', error: trackerError })
        if (!isTerminal(state)) await deps.sleep(pollDelayMs(state))
      } else {
        dispatch({ type: 'error', error: trackerError })
      }
    }
  }
  return state
}
