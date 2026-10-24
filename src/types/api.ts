import type { ChartV2, Piece } from './chart'

// ─── API del worker (/v1) ─────────────────────────────────────────────────────
// Espejo TS de shared/openapi.yaml. Un test de paridad verifica los enums.

export const JOB_STATUSES = [
  'queued',
  'separating',
  'transcribing',
  'tempo',
  'quantizing',
  'finalizing',
  'done',
  'failed',
  'canceled',
] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

/** Estados finales: el trabajo ya no cambia. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['done', 'failed', 'canceled']

/** Etapas en el orden en que se muestran en la pantalla Importar. */
export const ANALYSIS_STAGE_IDS = [
  'separate',
  'transcribe',
  'tempo',
  'quantize',
  'difficulties',
] as const

export type AnalysisStageId = (typeof ANALYSIS_STAGE_IDS)[number]

export const STAGE_STATES = ['pending', 'running', 'done', 'failed'] as const

export type StageState = (typeof STAGE_STATES)[number]

export const JOB_ERROR_CODES = [
  'UNSUPPORTED_FORMAT',
  'TOO_LONG',
  'TOO_LARGE',
  'DECODE_FAILED',
  'SEPARATION_FAILED',
  'TRANSCRIPTION_FAILED',
  'NO_DRUMS_DETECTED',
  'NOT_READY',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'INTERNAL',
] as const

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number]

export interface ApiError {
  code: JobErrorCode
  message: string
}

export interface AnalysisStage {
  id: AnalysisStageId
  label: string
  state: StageState
  progress: number // 0-1
}

export interface JobSummary {
  bpm: number
  timeSignature: [number, number]
  durationS: number
  pieces: Piece[]
  lowConfidenceCount: number
  lowConfidenceByPiece: Partial<Record<Piece, number>>
}

export interface Job {
  jobId: string
  status: JobStatus
  cached: boolean
  stages: AnalysisStage[]
  summary: JobSummary | null
  error: ApiError | null
  createdAt: string
  updatedAt: string
}

/** Cuerpo de POST /v1/jobs en modo Supabase (en modo local se usa multipart con `file`). */
export interface CreateJobRequest {
  audioPath: string
  sha256: string
  title: string
  artist: string
  durationS: number
}

export interface CreateJobResponse {
  jobId: string
  status: JobStatus
  cached: boolean
}

/** Picos de la forma de onda para el transporte (valores 0-1). */
export interface WaveformPeaks {
  samplesPerPeak: number
  sampleRate: number
  peaks: number[]
}

export interface JobResult {
  chart: ChartV2
  stems: { drums: string; backing: string }
  peaks: WaveformPeaks
}

export interface HealthResponse {
  status: 'ok'
  device: 'cpu' | 'cuda'
  models: { demucs: string; adtof: string; beatThis: string }
}
