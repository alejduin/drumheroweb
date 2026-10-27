import type { AnalysisStage, ChartV2, Job, JobResult, JobStatus } from '@/types'
import { ANALYSIS_STAGE_IDS } from '@/types'
import type { JobMeta, WorkerClient } from '@/api/workerClient'

/** Chart mínimo del worker: `low` notas de confianza baja entre `total`. */
export function analyzedChart(total = 20, low = 0): ChartV2 {
  const notes = Array.from({ length: total }, (_, i) => ({
    t: 1 + i * 0.5,
    piece: 'snare' as const,
    velocity: 90,
    confidence: i < low ? 0.4 : 0.95,
  }))
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5)
  return {
    version: 2,
    id: 'sha',
    title: 'Del worker',
    artist: 'Worker',
    bpm: 120,
    timeSignature: [4, 4],
    durationS: 20,
    audioUrl: null,
    stems: {
      drums: 'http://w/v1/files/sha/drums.ogg',
      backing: 'http://w/v1/files/sha/backing.ogg',
    },
    audioSha256: 'sha',
    youtubeUrl: null,
    youtubeOffsetMs: 0,
    grid: { beats, downbeats: beats.filter((_, i) => i % 4 === 0) },
    difficulties: { basic: { notes: [] }, intermediate: { notes: [] }, full: { notes } },
    sections: [],
    source: { kind: 'ai', createdAt: '2026-10-25T00:00:00.000Z' },
  }
}

export function makeJob(status: JobStatus, patch: Partial<Job> = {}): Job {
  const stages: AnalysisStage[] = ANALYSIS_STAGE_IDS.map(id => ({
    id,
    label: id,
    state: status === 'done' ? 'done' : 'pending',
    progress: status === 'done' ? 1 : 0,
  }))
  return {
    jobId: 'job-1',
    status,
    cached: false,
    stages,
    summary: null,
    error: null,
    createdAt: '2026-10-25T00:00:00Z',
    updatedAt: '2026-10-25T00:00:00Z',
    ...patch,
  }
}

type Step<T> = T | Error

/**
 * Worker falso: `jobs` es la secuencia de respuestas de GET /jobs/{id} (la última
 * se repite); `creates` la de POST /jobs. Cualquier paso puede ser un Error.
 */
export class FakeWorkerClient implements WorkerClient {
  creates: Array<Step<{ jobId: string; status: JobStatus; cached: boolean }>> = [
    { jobId: 'job-1', status: 'queued', cached: false },
  ]
  jobs: Array<Step<Job>> = [makeJob('done')]
  result: Step<JobResult> = {
    chart: analyzedChart(),
    stems: { drums: 'http://w/drums.ogg', backing: 'http://w/backing.ogg' },
    peaks: { samplesPerPeak: 512, sampleRate: 44100, peaks: [0.1, 0.5] },
  }
  healthy = true
  created: Array<{ fileName: string; title: string; artist: string }> = []
  polls = 0
  canceled: string[] = []

  /** Último `meta` y archivo recibidos al crear un trabajo. */
  lastMeta: JobMeta | null = null
  lastFile: Blob | null = null

  async health() {
    if (!this.healthy) throw new Error('offline')
  }

  async createJob(file: Blob | null, fileName: string, meta: JobMeta) {
    this.created.push({ fileName, title: meta.title, artist: meta.artist })
    this.lastMeta = meta
    this.lastFile = file
    return unwrap(this.creates.length > 1 ? this.creates.shift()! : this.creates[0])
  }

  async getJob() {
    this.polls++
    return unwrap(this.jobs.length > 1 ? this.jobs.shift()! : this.jobs[0])
  }

  async getResult() {
    return unwrap(this.result)
  }

  async cancelJob(jobId: string) {
    this.canceled.push(jobId)
  }

  async download(url: string) {
    return new Blob([url], { type: 'audio/ogg' })
  }
}

function unwrap<T>(step: Step<T>): T {
  if (step instanceof Error) throw step
  return step
}
