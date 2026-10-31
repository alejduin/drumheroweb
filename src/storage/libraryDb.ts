import type { ChartV2, JobSummary, WaveformPeaks } from '@/types'
import type { SongStatus } from '@/library/status'

// ─── Biblioteca local en IndexedDB (PLAN_V2 B13) ─────────────────────────────
// `songs`: metadatos de cada canción importada. `assets`: los archivos pesados
// (audio original, stems, chart y picos), con clave [songId, kind], para que la
// lista no cargue blobs y una canción analizada se pueda jugar sin red.

export const LIBRARY_DB_NAME = 'drumhero-library'
const DB_VERSION = 1
const SONGS = 'songs'
const ASSETS = 'assets'

export interface LibrarySong {
  id: string
  title: string
  artist: string
  fileName: string
  durationS: number
  /** URL de YouTube elegida al importar (solo video silenciado). */
  youtubeUrl: string | null
  /** Offset del video elegido en el asistente (ms); si falta, el del chart. */
  youtubeOffsetMs?: number
  status: SongStatus
  /** Trabajo del worker mientras se analiza (para reanudar al recargar). */
  jobId: string | null
  error: { code: string; message: string } | null
  summary: JobSummary | null
  createdAt: number
  updatedAt: number
  lastPlayedAt: number | null
  /** Está en la nube (Supabase): se sincroniza y se borra también allí. */
  cloud?: boolean
}

export interface AssetMap {
  audio: Blob
  drums: Blob
  backing: Blob
  chart: ChartV2
  peaks: WaveformPeaks
}

export type AssetKind = keyof AssetMap

interface AssetRecord<K extends AssetKind = AssetKind> {
  songId: string
  kind: K
  data: AssetMap[K]
}

const promisify = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const completed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transacción abortada'))
  })

export interface LibraryDb {
  listSongs(): Promise<LibrarySong[]>
  getSong(id: string): Promise<LibrarySong | null>
  putSong(song: LibrarySong): Promise<void>
  /** Borra la canción y todos sus archivos. */
  deleteSong(id: string): Promise<void>
  putAssets(songId: string, assets: Partial<AssetMap>): Promise<void>
  getAsset<K extends AssetKind>(songId: string, kind: K): Promise<AssetMap[K] | null>
  close(): void
}

export function openLibraryDb(
  name = LIBRARY_DB_NAME,
  factory: IDBFactory = indexedDB,
): Promise<LibraryDb> {
  const request = factory.open(name, DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(SONGS)) db.createObjectStore(SONGS, { keyPath: 'id' })
    if (!db.objectStoreNames.contains(ASSETS)) {
      db.createObjectStore(ASSETS, { keyPath: ['songId', 'kind'] })
    }
  }
  return promisify(request).then(wrap)
}

function wrap(db: IDBDatabase): LibraryDb {
  const store = (names: string | string[], mode: IDBTransactionMode = 'readonly') =>
    db.transaction(names, mode)

  return {
    async listSongs() {
      const songs = await promisify(
        store(SONGS).objectStore(SONGS).getAll() as IDBRequest<LibrarySong[]>,
      )
      return songs.sort((a, b) => b.createdAt - a.createdAt)
    },
    async getSong(id) {
      const song = await promisify(
        store(SONGS).objectStore(SONGS).get(id) as IDBRequest<LibrarySong | undefined>,
      )
      return song ?? null
    },
    async putSong(song) {
      const tx = store(SONGS, 'readwrite')
      tx.objectStore(SONGS).put(song)
      await completed(tx)
    },
    async deleteSong(id) {
      const tx = store([SONGS, ASSETS], 'readwrite')
      tx.objectStore(SONGS).delete(id)
      // Todas las claves [id, *]: los arrays ordenan después de cualquier string
      tx.objectStore(ASSETS).delete(IDBKeyRange.bound([id], [id, []]))
      await completed(tx)
    },
    async putAssets(songId, assets) {
      const tx = store(ASSETS, 'readwrite')
      const assetStore = tx.objectStore(ASSETS)
      for (const kind of Object.keys(assets) as AssetKind[]) {
        const data = assets[kind]
        if (data !== undefined) assetStore.put({ songId, kind, data } satisfies AssetRecord)
      }
      await completed(tx)
    },
    async getAsset(songId, kind) {
      const record = await promisify(
        store(ASSETS).objectStore(ASSETS).get([songId, kind]) as IDBRequest<
          AssetRecord | undefined
        >,
      )
      return (record?.data as AssetMap[typeof kind] | undefined) ?? null
    },
    close: () => db.close(),
  }
}
