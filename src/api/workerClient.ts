import type {
  ApiError,
  CreateJobResponse,
  HealthResponse,
  Job,
  JobErrorCode,
  JobResult,
} from '@/types'

// ─── Cliente HTTP del worker (/v1, PLAN_V2 §3) ────────────────────────────────

/** Por defecto el worker local de `docker compose up worker`. */
export const DEFAULT_WORKER_URL = 'http://localhost:8000'

/** Errores del worker más los del propio cliente (red caída, respuesta rara). */
export type ClientErrorCode = JobErrorCode | 'NETWORK'

export class WorkerError extends Error {
  readonly code: ClientErrorCode
  /** 0 = sin respuesta (red). */
  readonly status: number

  constructor(code: ClientErrorCode, message: string, status: number) {
    super(message)
    this.name = 'WorkerError'
    this.code = code
    this.status = status
  }

  /** Vale la pena reintentar (red o error del servidor), no un archivo inválido. */
  get transient(): boolean {
    return this.code === 'NETWORK' || this.status >= 500
  }
}

/** Datos de la canción que acompañan al audio (el worker local solo usa título y artista). */
export interface JobMeta {
  songId: string
  title: string
  artist: string
  durationS: number
  youtubeUrl: string | null
}

export interface WorkerClient {
  /** Lanza si no hay un worker que vaya a recoger los trabajos. */
  health(): Promise<void>
  /**
   * Crea un trabajo. `file` puede faltar si el audio ya está en la nube (canción
   * importada en otro equipo); el worker local siempre lo necesita.
   */
  createJob(file: Blob | null, fileName: string, meta: JobMeta): Promise<CreateJobResponse>
  getJob(jobId: string): Promise<Job>
  getResult(jobId: string): Promise<JobResult>
  cancelJob(jobId: string): Promise<void>
  /** Descarga un archivo del resultado (stems). */
  download(url: string): Promise<Blob>
}

type Fetch = typeof fetch

export function workerUrl(): string {
  const env = import.meta.env.VITE_WORKER_URL as string | undefined
  return (env || DEFAULT_WORKER_URL).replace(/\/+$/, '')
}

export function createWorkerClient(baseUrl = workerUrl(), fetchFn: Fetch = fetch): WorkerClient {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await fetchFn(path.startsWith('http') ? path : `${baseUrl}${path}`, init)
    } catch {
      throw new WorkerError('NETWORK', `no se pudo conectar con el worker (${baseUrl})`, 0)
    }
    if (!response.ok) throw await toError(response)
    return response
  }

  const json = async <T>(path: string, init?: RequestInit) =>
    (await (await request(path, init)).json()) as T

  return {
    async health() {
      await json<HealthResponse>('/v1/health')
    },
    createJob(file, fileName, { title, artist }) {
      if (!file) {
        return Promise.reject(new WorkerError('NOT_FOUND', 'falta el audio de la canción', 400))
      }
      const form = new FormData()
      form.append('file', file, fileName)
      if (title) form.append('title', title)
      if (artist) form.append('artist', artist)
      return json<CreateJobResponse>('/v1/jobs', { method: 'POST', body: form })
    },
    getJob: jobId => json<Job>(`/v1/jobs/${encodeURIComponent(jobId)}`),
    getResult: jobId => json<JobResult>(`/v1/jobs/${encodeURIComponent(jobId)}/result`),
    async cancelJob(jobId) {
      await request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
    },
    download: async url => (await request(url)).blob(),
  }
}

async function toError(response: Response): Promise<WorkerError> {
  try {
    const body = (await response.json()) as { error?: ApiError }
    if (body.error?.code)
      return new WorkerError(body.error.code, body.error.message, response.status)
  } catch {
    // cuerpo que no es JSON: se usa el estado HTTP
  }
  return new WorkerError('INTERNAL', `el worker respondió ${response.status}`, response.status)
}
