import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChartV2, Job, JobResult, JobSummary, WaveformPeaks } from '@/types'
import { WorkerError } from '@/api/workerClient'
import type { JobMeta, WorkerClient } from '@/api/workerClient'
import type { SongStatus } from '@/library/status'
import type { DownloadedResult } from '@/library/jobTracker'

// ─── Biblioteca y trabajos en Supabase (PLAN_V2 B12) ─────────────────────────
// El navegador sube el audio a audio/{usuario}/{canción}/ y crea una fila en
// jobs; el worker de la PC la reclama y deja chart, peaks y stems. RLS limita
// todo a las filas del usuario con sesión.

export const AUDIO_BUCKET = 'audio'
export const STEMS_BUCKET = 'stems'
/** Sin latido del worker en este tiempo se considera apagado (late cada 30 s). */
export const WORKER_STALE_MS = 90_000

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
}

/** Una canción tal como está en la nube. */
export interface RemoteSong {
  id: string
  title: string
  artist: string
  fileName: string
  durationS: number
  youtubeUrl: string | null
  status: SongStatus
  error: { code: string; message: string } | null
  summary: JobSummary | null
  createdAt: number
  updatedAt: number
  lastPlayedAt: number | null
  /** Último trabajo de la canción (para seguir su progreso). */
  jobId: string | null
}

export interface RemoteLibrary {
  /** Canciones del usuario con sesión, las más nuevas primero. Lanza sin sesión. */
  listSongs(): Promise<RemoteSong[]>
  /** Chart, peaks y stems de una canción ya analizada. */
  fetchResult(songId: string): Promise<DownloadedResult>
  /** Borra la canción, su audio y sus stems. */
  deleteSong(songId: string): Promise<void>
  markPlayed(songId: string, at: number): Promise<void>
}

interface CloudDeps {
  /** Id del usuario con sesión; lanza si no hay. */
  userId: () => Promise<string>
  now?: () => number
}

interface SongRow {
  id: string
  title: string
  artist: string
  file_name: string
  duration_s: number
  youtube_url: string | null
  status: SongStatus
  error: RemoteSong['error']
  summary: JobSummary | null
  created_at: string
  updated_at: string
  last_played_at: string | null
  audio_path: string
}

interface JobRow {
  id: string
  song_id: string
  status: Job['status']
  cached: boolean
  stages: Job['stages']
  summary: JobSummary | null
  error: Job['error']
  created_at: string
  updated_at: string
}

interface ChartRow {
  data: ChartV2
  peaks: WaveformPeaks
  drums_path: string
  backing_path: string
}

/** Error de supabase-js → WorkerError (status 0 = sin red: se reintenta). */
export function toWorkerError(error: { message: string; status?: number }): WorkerError {
  const status = error.status ?? 0
  if (status === 0)
    return new WorkerError('NETWORK', `sin conexión con la nube: ${error.message}`, 0)
  if (status === 401 || status === 403)
    return new WorkerError('UNAUTHORIZED', error.message, status)
  if (status === 404) return new WorkerError('NOT_FOUND', error.message, status)
  return new WorkerError('INTERNAL', error.message, status)
}

type Result<T> = { data: T | null; error: { message: string } | null; status?: number }

function unwrap<T>({ data, error, status }: Result<T>): T {
  if (error) {
    // PostgREST pone el estado HTTP en la respuesta; Storage en el error
    const errorStatus = (error as { status?: number; statusCode?: string }).status
    throw toWorkerError({ message: error.message, status: status || errorStatus || 0 })
  }
  return data as T
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : null)

export function storageUrl(bucket: string, path: string) {
  return `storage://${bucket}/${path}`
}

function parseStorageUrl(url: string): { bucket: string; path: string } {
  const match = /^storage:\/\/([^/]+)\/(.+)$/.exec(url)
  if (!match) throw new WorkerError('NOT_FOUND', `ruta de archivo inválida: ${url}`, 400)
  return { bucket: match[1], path: match[2] }
}

export function audioExtension(fileName: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? ''
  if (!(ext in CONTENT_TYPES)) {
    throw new WorkerError('UNSUPPORTED_FORMAT', `formato no soportado (.${ext || '?'})`, 422)
  }
  return ext
}

export function createCloudClient(
  sb: SupabaseClient,
  { userId, now = Date.now }: CloudDeps,
): WorkerClient & RemoteLibrary {
  async function download(url: string): Promise<Blob> {
    const { bucket, path } = parseStorageUrl(url)
    return unwrap(await sb.storage.from(bucket).download(path))
  }

  async function chartOf(songId: string): Promise<ChartRow> {
    const row = unwrap(
      await sb
        .from('charts')
        .select('data, peaks, drums_path, backing_path')
        .eq('song_id', songId)
        .maybeSingle<ChartRow>(),
    )
    if (!row) throw new WorkerError('NOT_READY', 'la canción todavía no tiene partitura', 409)
    return row
  }

  const resultOf = (row: ChartRow): JobResult => ({
    chart: row.data,
    peaks: row.peaks,
    stems: {
      drums: storageUrl(STEMS_BUCKET, row.drums_path),
      backing: storageUrl(STEMS_BUCKET, row.backing_path),
    },
  })

  return {
    async health() {
      const rows = unwrap(
        await sb
          .from('workers')
          .select('id, last_seen')
          .order('last_seen', { ascending: false })
          .limit(1),
      ) as { last_seen: string }[]
      const lastSeen = rows[0] ? Date.parse(rows[0].last_seen) : 0
      if (now() - lastSeen > WORKER_STALE_MS) {
        throw new WorkerError('NETWORK', 'el worker de IA no está encendido', 0)
      }
    },

    async createJob(file: Blob | null, fileName: string, meta: JobMeta) {
      const uid = await userId()
      const existing = unwrap(
        await sb.from('songs').select('id').eq('id', meta.songId).maybeSingle(),
      )
      if (!existing) {
        if (!file) throw new WorkerError('NOT_FOUND', 'falta el audio de la canción', 400)
        const ext = audioExtension(fileName)
        const audioPath = `${uid}/${meta.songId}/original.${ext}`
        unwrap(
          await sb.storage
            .from(AUDIO_BUCKET)
            .upload(audioPath, file, { contentType: CONTENT_TYPES[ext], upsert: true }),
        )
        unwrap(
          await sb.from('songs').insert({
            id: meta.songId,
            title: meta.title || fileName,
            artist: meta.artist,
            file_name: fileName,
            audio_path: audioPath,
            duration_s: meta.durationS,
            youtube_url: meta.youtubeUrl,
          }),
        )
      }
      const job = unwrap(
        await sb
          .from('jobs')
          .insert({ song_id: meta.songId })
          .select('id, status, cached')
          .single<{ id: string; status: Job['status']; cached: boolean }>(),
      )
      return { jobId: job.id, status: job.status, cached: job.cached }
    },

    async getJob(jobId) {
      const row = unwrap(await sb.from('jobs').select('*').eq('id', jobId).maybeSingle<JobRow>())
      if (!row) throw new WorkerError('NOT_FOUND', 'el trabajo ya no existe', 404)
      return {
        jobId: row.id,
        status: row.status,
        cached: row.cached,
        stages: row.stages,
        summary: row.summary,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    },

    async getResult(jobId) {
      const job = unwrap(
        await sb.from('jobs').select('song_id').eq('id', jobId).maybeSingle<{ song_id: string }>(),
      )
      if (!job) throw new WorkerError('NOT_FOUND', 'el trabajo ya no existe', 404)
      return resultOf(await chartOf(job.song_id))
    },

    async cancelJob(jobId) {
      unwrap(await sb.from('jobs').update({ cancel_requested: true }).eq('id', jobId))
    },

    download,

    async listSongs() {
      const uid = await userId()
      const [songs, jobs] = await Promise.all([
        sb
          .from('songs')
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .then(r => unwrap(r as Result<SongRow[]>)),
        sb
          .from('jobs')
          .select('id, song_id')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .then(r => unwrap(r as Result<{ id: string; song_id: string }[]>)),
      ])
      const latestJob = new Map<string, string>()
      for (const job of jobs) if (!latestJob.has(job.song_id)) latestJob.set(job.song_id, job.id)
      return songs.map(row => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        fileName: row.file_name,
        durationS: row.duration_s,
        youtubeUrl: row.youtube_url,
        status: row.status,
        error: row.error,
        summary: row.summary,
        createdAt: ms(row.created_at)!,
        updatedAt: ms(row.updated_at)!,
        lastPlayedAt: ms(row.last_played_at),
        jobId: latestJob.get(row.id) ?? null,
      }))
    },

    async fetchResult(songId) {
      const result = resultOf(await chartOf(songId))
      const [drums, backing] = await Promise.all([
        download(result.stems.drums),
        download(result.stems.backing),
      ])
      return { result, drums, backing }
    },

    async deleteSong(songId) {
      const uid = await userId()
      const row = unwrap(
        await sb
          .from('songs')
          .select('audio_path')
          .eq('id', songId)
          .maybeSingle<{ audio_path: string }>(),
      )
      if (!row) return
      // Primero los archivos: si falla, la fila sigue y se puede reintentar
      unwrap(await sb.storage.from(AUDIO_BUCKET).remove([row.audio_path]))
      unwrap(
        await sb.storage
          .from(STEMS_BUCKET)
          .remove([`${uid}/${songId}/drums.ogg`, `${uid}/${songId}/backing.ogg`]),
      )
      unwrap(await sb.from('songs').delete().eq('id', songId))
    },

    async markPlayed(songId, at) {
      unwrap(
        await sb
          .from('songs')
          .update({ last_played_at: new Date(at).toISOString() })
          .eq('id', songId),
      )
    },
  }
}

/**
 * Espera entre consultas que Realtime corta en cuanto cambia un trabajo del
 * usuario (no es el reloj del juego). Sin Realtime queda la espera normal.
 */
export function createJobWaker(sb: SupabaseClient, slowdown = 5) {
  const waiting = new Set<() => void>()
  let subscribed = false
  const wakeAll = () => {
    for (const wake of [...waiting]) wake()
  }
  return (delayMs: number) =>
    new Promise<void>(resolve => {
      if (!subscribed) {
        subscribed = true
        sb.channel('jobs-progress')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, wakeAll)
          .subscribe()
      }
      const done = () => {
        waiting.delete(done)
        clearTimeout(timer)
        resolve()
      }
      // Con Realtime la consulta periódica es solo un respaldo: se espacia
      const timer = setTimeout(done, delayMs * slowdown)
      waiting.add(done)
    })
}
