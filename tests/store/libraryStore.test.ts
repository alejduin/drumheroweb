// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { JobResult } from '@/types'
import { WorkerError } from '@/api/workerClient'
import { openLibraryDb } from '@/storage/libraryDb'
import type { LibrarySong } from '@/storage/libraryDb'
import { createLibraryStore } from '@/store/libraryStore'
import type { ImportInput } from '@/store/libraryStore'
import { FakeWorkerClient, analyzedChart, makeJob } from '../fakes/FakeWorkerClient'

let dbIndex = 0

function setup(client = new FakeWorkerClient(), dbName = `library-${dbIndex++}`) {
  let id = 0
  const notified: LibrarySong[] = []
  const store = createLibraryStore({
    openDb: () => openLibraryDb(dbName),
    client,
    sleep: () => Promise.resolve(),
    now: () => 1000 + id,
    newId: () => `song-${++id}`,
    notify: song => notified.push(song),
  })
  return { store, client, notified, dbName }
}

const input = (patch: Partial<ImportInput> = {}): ImportInput => ({
  file: new Blob(['mp3'], { type: 'audio/mpeg' }),
  fileName: 'Seven Nation Army.mp3',
  title: 'Seven Nation Army',
  artist: 'The White Stripes',
  durationS: 230,
  youtubeUrl: 'https://www.youtube.com/watch?v=0J2QdDbelmY',
  ...patch,
})

const songOf = (store: ReturnType<typeof setup>['store'], id: string) =>
  store.getState().songs.find(s => s.id === id)

describe('libraryStore', () => {
  it('importar: guarda, analiza y deja la canción lista para jugar', async () => {
    const { store, client, notified } = setup()
    client.jobs = [makeJob('separating'), makeJob('done')]
    const id = await store.getState().importSong(input())
    expect(songOf(store, id)?.status).toBe('analyzing')
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('ready'))
    expect(client.created[0]).toEqual({
      fileName: 'Seven Nation Army.mp3',
      title: 'Seven Nation Army',
      artist: 'The White Stripes',
    })
    expect(songOf(store, id)).toMatchObject({
      jobId: null,
      summary: { bpm: 120, pieces: ['snare'] },
    })
    expect(store.getState().trackers[id].phase).toBe('done')
    expect(notified.map(s => s.id)).toEqual([id])
  })

  it('bundle lee todo de IndexedDB (sin worker)', async () => {
    const { store, client } = setup()
    const id = await store.getState().importSong(input())
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('ready'))
    client.jobs = [new WorkerError('NETWORK', 'sin red', 0)]
    client.healthy = false
    const bundle = await store.getState().bundle(id)
    expect(bundle.chart).toMatchObject({
      title: 'Seven Nation Army',
      artist: 'The White Stripes',
      youtubeUrl: 'https://www.youtube.com/watch?v=0J2QdDbelmY',
    })
    expect(bundle.fileName).toBe('Seven Nation Army.mp3')
    expect(bundle.peaks?.peaks).toEqual([0.1, 0.5])
    expect(bundle.audio?.stems?.drums).toBeInstanceOf(Blob)
    expect(await (bundle.audio!.original as Blob).text()).toBe('mp3')
    expect(await store.getState().checkWorker()).toBe('offline')
  })

  it('marca "por revisar" con muchas notas dudosas', async () => {
    const { store, client } = setup()
    client.result = { ...(client.result as JobResult), chart: analyzedChart(20, 5) }
    const id = await store.getState().importSong(input())
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('needs_review'))
  })

  it('al recargar reanuda el análisis con el jobId guardado', async () => {
    const first = setup()
    first.client.jobs = [makeJob('queued')]
    // la primera sesión se queda esperando entre consultas (como al cerrar la pestaña)
    const hang = new Promise<void>(() => {})
    const blocked = createLibraryStore({
      openDb: () => openLibraryDb(first.dbName),
      client: first.client,
      sleep: () => hang,
      now: () => 1,
      newId: () => 'song-x',
      notify: () => {},
    })
    await blocked.getState().importSong(input())
    // el jobId ya está guardado en IndexedDB
    await vi.waitFor(() => expect(songOf(blocked, 'song-x')?.jobId).toBe('job-1'))

    // "recarga": otro store sobre la misma base; el worker ya terminó
    const client = new FakeWorkerClient()
    const second = setup(client, first.dbName)
    await second.store.getState().load()
    await vi.waitFor(() => expect(songOf(second.store, 'song-x')?.status).toBe('ready'))
    expect(client.created).toHaveLength(0) // no se volvió a subir
  })

  it('un fallo queda guardado y se puede reintentar', async () => {
    const { store, client } = setup()
    client.jobs = [makeJob('failed', { error: { code: 'TRANSCRIPTION_FAILED', message: 'x' } })]
    const id = await store.getState().importSong(input())
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('failed'))
    expect(songOf(store, id)?.error?.code).toBe('TRANSCRIPTION_FAILED')

    client.jobs = [makeJob('done')]
    store.getState().retry(id)
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('ready'))
    expect(client.created).toHaveLength(2) // se volvió a subir
  })

  it('reintentar tras recargar usa el error guardado', async () => {
    const first = setup()
    first.client.creates = [new WorkerError('NETWORK', 'sin red', 0)]
    const id = await first.store.getState().importSong(input())
    await vi.waitFor(() => expect(songOf(first.store, id)?.status).toBe('failed'))

    const second = setup(new FakeWorkerClient(), first.dbName)
    await second.store.getState().load()
    expect(second.store.getState().trackers[id]).toBeUndefined()
    second.store.getState().retry(id)
    await vi.waitFor(() => expect(songOf(second.store, id)?.status).toBe('ready'))
  })

  it('cancelar avisa al worker y quita la canción', async () => {
    const { store, client, dbName } = setup()
    client.creates = [{ jobId: 'job-9', status: 'queued', cached: false }]
    client.jobs = [makeJob('failed')]
    const id = await store.getState().importSong(input())
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('failed'))
    await store.getState().cancel(id)
    expect(client.canceled).toEqual(['job-9'])
    expect(store.getState().songs).toHaveLength(0)
    const db = await openLibraryDb(dbName)
    expect(await db.getAsset(id, 'audio')).toBeNull()
    db.close()
  })

  it('markPlayed guarda la fecha', async () => {
    const { store } = setup()
    const id = await store.getState().importSong(input())
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('ready'))
    await store.getState().markPlayed(id)
    expect(songOf(store, id)?.lastPlayedAt).not.toBeNull()
  })

  it('bundle de una canción sin partitura falla con un mensaje claro', async () => {
    const { store, client } = setup()
    client.jobs = [makeJob('failed')]
    const id = await store.getState().importSong(input())
    await vi.waitFor(() => expect(songOf(store, id)?.status).toBe('failed'))
    await expect(store.getState().bundle(id)).rejects.toThrow(/partitura/)
  })
})
