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

export interface WorkerClient {
  health(): Promise<HealthResponse>
  createJob(
    file: Blob,
    fileName: string,
    meta: { title: string; artist: string },
  ): Promise<CreateJobResponse>
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
    health: () => json<HealthResponse>('/v1/health'),
    createJob(file, fileName, { title, artist }) {
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
