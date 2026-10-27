import { create } from 'zustand'
import type { SongBundle } from '@/game/GameSession'
import { createCloudClient, createJobWaker } from '@/api/cloudClient'
import type { RemoteLibrary, RemoteSong } from '@/api/cloudClient'
import { supabase } from '@/api/supabase'
import { createWorkerClient } from '@/api/workerClient'
import type { WorkerClient } from '@/api/workerClient'
import { initialTracker, trackJob, trackerReducer } from '@/library/jobTracker'
import type { DownloadedResult, TrackerState } from '@/library/jobTracker'
import { statusForChart, summaryFromChart } from '@/library/status'
import { openLibraryDb } from '@/storage/libraryDb'
import type { AssetKind, AssetMap, LibraryDb, LibrarySong } from '@/storage/libraryDb'

// ─── Biblioteca de canciones importadas (PLAN_V2 B13 + B12) ──────────────────
// IndexedDB es la copia de trabajo (se juega sin red); el store refleja la lista
// y el progreso de los análisis. En modo nube `remote` es la fuente de verdad:
// sync() trae las canciones de la cuenta y los archivos se bajan al jugarlas.

export type WorkerStatus = 'unknown' | 'online' | 'offline'

export interface ImportInput {
  file: Blob
  fileName: string
  title: string
  artist: string
  durationS: number
  youtubeUrl: string | null
}

export interface LibraryDeps {
  openDb: () => Promise<LibraryDb>
  client: WorkerClient
  sleep: (ms: number) => Promise<void>
  now: () => number
  newId: () => string
  /** Aviso al terminar un análisis (Notification API en la app). */
  notify: (song: LibrarySong) => void
  /** Biblioteca en Supabase; null en modo local. */
  remote?: RemoteLibrary | null
}

export interface LibraryState {
  songs: LibrarySong[]
  loaded: boolean
  /** Progreso de los análisis de esta sesión, por id de canción. */
  trackers: Record<string, TrackerState>
  workerStatus: WorkerStatus
  /** Modo nube: el worker recoge los trabajos aunque se encienda más tarde. */
  cloud: boolean

  /** Lee la biblioteca y reanuda los análisis que quedaron a medias. */
  load(): Promise<void>
  /** Trae las canciones de la cuenta (modo nube). Lanza si no hay red o sesión. */
  sync(): Promise<void>
  checkWorker(): Promise<WorkerStatus>
  /** Guarda el audio y arranca el análisis. Retorna el id de la canción. */
  importSong(input: ImportInput): Promise<string>
  retry(id: string): void
  /** Cancela el análisis y quita la canción. */
  cancel(id: string): Promise<void>
  remove(id: string): Promise<void>
  /** Todo lo necesario para jugar, desde IndexedDB (funciona sin red). */
  bundle(id: string): Promise<SongBundle>
  markPlayed(id: string): Promise<void>
}

export function createLibraryStore(deps: LibraryDeps) {
  let dbPromise: Promise<LibraryDb> | null = null
  const db = () => (dbPromise ??= deps.openDb())
  const controllers = new Map<string, AbortController>()
  const remote = deps.remote ?? null

  return create<LibraryState>()((set, get) => {
    const replaceSong = (song: LibrarySong) =>
      set(s => ({ songs: s.songs.map(x => (x.id === song.id ? song : x)) }))

    async function updateSong(
      id: string,
      patch: Partial<LibrarySong>,
    ): Promise<LibrarySong | null> {
      const current = await (await db()).getSong(id)
      if (!current) return null
      const song = { ...current, ...patch, updatedAt: deps.now() }
      await (await db()).putSong(song)
      replaceSong(song)
      return song
    }

    async function complete(id: string, { result, drums, backing }: DownloadedResult) {
      await (await db()).putAssets(id, { chart: result.chart, peaks: result.peaks, drums, backing })
      const song = await updateSong(id, {
        status: statusForChart(result.chart),
        jobId: null,
        error: null,
        summary: summaryFromChart(result.chart),
        durationS: result.chart.durationS,
      })
      if (song) deps.notify(song)
    }

    async function track(id: string, start: TrackerState) {
      if (controllers.has(id)) return
      const controller = new AbortController()
      controllers.set(id, controller)
      let lastJobId = start.jobId
      const final = await trackJob(start, {
        client: deps.client,
        sleep: deps.sleep,
        signal: controller.signal,
        async getAudio() {
          const library = await db()
          const [song, file] = await Promise.all([
            library.getSong(id),
            library.getAsset(id, 'audio'),
          ])
          // En la nube el audio puede estar solo allí (importado en otro equipo)
          if (!song || (!file && !song.cloud)) throw new Error('falta el audio de la canción')
          return {
            file: file ?? null,
            fileName: song.fileName,
            meta: {
              songId: id,
              title: song.title,
              artist: song.artist,
              durationS: song.durationS,
              youtubeUrl: song.youtubeUrl,
            },
          }
        },
        onComplete: result => complete(id, result),
        onState(state) {
          set(s => ({ trackers: { ...s.trackers, [id]: state } }))
          // El jobId se guarda en cuanto existe: al recargar se sigue consultando
          if (state.jobId && state.jobId !== lastJobId) {
            lastJobId = state.jobId
            void updateSong(id, { jobId: state.jobId, ...(remote ? { cloud: true } : {}) })
          }
        },
      })
      controllers.delete(id)
      if (final.phase === 'failed') {
        await updateSong(id, { status: 'failed', error: final.error })
      }
    }

    function resumeAnalyses(songs: LibrarySong[]) {
      for (const song of songs) {
        if (song.status === 'analyzing') void track(song.id, initialTracker(song.jobId))
      }
    }

    /** Mezcla una canción de la nube con la copia local (si la hay). */
    function fromRemote(r: RemoteSong, local: LibrarySong | undefined): LibrarySong {
      // Un análisis seguido en esta pestaña manda sobre lo que diga la nube
      if (local && controllers.has(local.id)) return { ...local, cloud: true }
      const { jobId, ...fields } = r
      return {
        ...fields,
        jobId: r.status === 'analyzing' ? (jobId ?? local?.jobId ?? null) : null,
        lastPlayedAt: Math.max(r.lastPlayedAt ?? 0, local?.lastPlayedAt ?? 0) || null,
        cloud: true,
      }
    }

    return {
      songs: [],
      loaded: false,
      trackers: {},
      workerStatus: 'unknown',
      cloud: Boolean(remote),

      async load() {
        const songs = await (await db()).listSongs()
        set({ songs, loaded: true })
        // En modo nube los análisis se reanudan después de sync() (hace falta sesión)
        if (!remote) resumeAnalyses(songs)
      },

      async sync() {
        if (!remote) return
        const library = await db()
        const [remoteSongs, localSongs] = await Promise.all([
          remote.listSongs(),
          library.listSongs(),
        ])
        const locals = new Map(localSongs.map(s => [s.id, s]))
        const remoteIds = new Set(remoteSongs.map(s => s.id))
        for (const r of remoteSongs) await library.putSong(fromRemote(r, locals.get(r.id)))
        // Borradas en otro equipo (o de otra cuenta): fuera de este navegador.
        // Las que nunca subieron a la nube se quedan.
        for (const local of localSongs) {
          if (local.cloud && !remoteIds.has(local.id) && !controllers.has(local.id)) {
            await library.deleteSong(local.id)
          }
        }
        const songs = await library.listSongs()
        set(s => {
          const trackers = { ...s.trackers }
          for (const id of Object.keys(trackers))
            if (!songs.some(x => x.id === id)) delete trackers[id]
          return { songs, trackers, loaded: true }
        })
        resumeAnalyses(songs)
      },

      async checkWorker() {
        let workerStatus: WorkerStatus
        try {
          await deps.client.health()
          workerStatus = 'online'
        } catch {
          workerStatus = 'offline'
        }
        set({ workerStatus })
        return workerStatus
      },

      async importSong(input) {
        const now = deps.now()
        const song: LibrarySong = {
          id: deps.newId(),
          title: input.title.trim() || input.fileName,
          artist: input.artist.trim(),
          fileName: input.fileName,
          durationS: input.durationS,
          youtubeUrl: input.youtubeUrl,
          status: 'analyzing',
          jobId: null,
          error: null,
          summary: null,
          createdAt: now,
          updatedAt: now,
          lastPlayedAt: null,
        }
        const library = await db()
        await library.putAssets(song.id, { audio: input.file })
        await library.putSong(song)
        set(s => ({ songs: [song, ...s.songs] }))
        void track(song.id, initialTracker())
        return song.id
      },

      retry(id) {
        const song = get().songs.find(s => s.id === id)
        if (!song || song.status !== 'failed' || controllers.has(id)) return
        // Tras recargar no hay tracker: se reconstruye desde lo guardado
        const failed = get().trackers[id] ?? {
          ...initialTracker(song.jobId),
          phase: 'failed' as const,
          error: song.error as TrackerState['error'],
        }
        const start = trackerReducer(failed, { type: 'retry' })
        void updateSong(id, { status: 'analyzing', error: null }).then(() => track(id, start))
      },

      async cancel(id) {
        const controller = controllers.get(id)
        const jobId = get().trackers[id]?.jobId ?? get().songs.find(s => s.id === id)?.jobId
        if (controller) controller.abort()
        else if (jobId) await deps.client.cancelJob(jobId).catch(() => {})
        await get().remove(id)
      },

      async remove(id) {
        controllers.get(id)?.abort()
        const song = await (await db()).getSong(id)
        // Sin red no se borra: la nube la volvería a traer en la siguiente sync
        if (remote && song?.cloud) await remote.deleteSong(id)
        await (await db()).deleteSong(id)
        set(s => {
          const trackers = { ...s.trackers }
          delete trackers[id]
          return { songs: s.songs.filter(x => x.id !== id), trackers }
        })
      },

      async bundle(id) {
        const library = await db()
        const [song, chart, peaks, drums, backing, audio] = await Promise.all([
          library.getSong(id),
          library.getAsset(id, 'chart'),
          library.getAsset(id, 'peaks'),
          library.getAsset(id, 'drums'),
          library.getAsset(id, 'backing'),
          library.getAsset(id, 'audio'),
        ])
        if (!song) throw new Error('La canción ya no está en la biblioteca.')
        if (!chart && remote && song.cloud && song.status !== 'analyzing') {
          // Analizada en otro equipo: se baja una vez y queda para jugar sin red
          const downloaded = await remote.fetchResult(id)
          const assets = {
            chart: downloaded.result.chart,
            peaks: downloaded.result.peaks,
            drums: downloaded.drums,
            backing: downloaded.backing,
          }
          await library.putAssets(id, assets)
          return toBundle(song, { ...assets, audio })
        }
        if (!chart) throw new Error('La canción todavía no tiene partitura.')
        return toBundle(song, { chart, peaks, drums, backing, audio })
      },

      async markPlayed(id) {
        const at = deps.now()
        const song = await updateSong(id, { lastPlayedAt: at })
        if (remote && song?.cloud) await remote.markPlayed(id, at).catch(() => {})
      },
    }
  })
}

function toBundle(
  song: LibrarySong,
  {
    chart,
    peaks,
    drums,
    backing,
    audio,
  }: Pick<AssetMap, 'chart'> & {
    [K in Exclude<AssetKind, 'chart'>]?: AssetMap[K] | null
  },
): SongBundle {
  const stems = drums && backing ? { drums, backing } : null
  if (!stems && !audio) throw new Error('Falta el audio de la canción.')
  return {
    chart: { ...chart, title: song.title, artist: song.artist, youtubeUrl: song.youtubeUrl },
    audio: { stems, original: audio ?? null },
    peaks: peaks ?? null,
    fileName: song.fileName,
  }
}

function browserNotify(song: LibrarySong) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  new Notification('Partitura lista', { body: `${song.title} ya se puede tocar.` })
}

function defaultDeps(): LibraryDeps {
  const base = {
    openDb: () => openLibraryDb(),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    notify: browserNotify,
  }
  const sb = supabase()
  if (!sb) {
    return {
      ...base,
      client: createWorkerClient(),
      // Espera entre consultas al worker (no es el reloj del juego)
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      remote: null,
    }
  }
  const cloud = createCloudClient(sb, {
    async userId() {
      const { data } = await sb.auth.getSession()
      if (!data.session) throw new Error('sin sesión en la nube')
      return data.session.user.id
    },
  })
  return { ...base, client: cloud, remote: cloud, sleep: createJobWaker(sb) }
}

export const useLibraryStore = createLibraryStore(defaultDeps())
