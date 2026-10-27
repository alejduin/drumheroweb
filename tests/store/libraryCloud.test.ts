// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { openLibraryDb } from '@/storage/libraryDb'
import { createLibraryStore } from '@/store/libraryStore'
import type { ImportInput } from '@/store/libraryStore'
import { FakeRemoteLibrary, remoteSong } from '../fakes/FakeRemoteLibrary'
import { FakeWorkerClient, makeJob } from '../fakes/FakeWorkerClient'

let dbIndex = 0

function setup(remote = new FakeRemoteLibrary(), client = new FakeWorkerClient()) {
  let id = 0
  const dbName = `cloud-${dbIndex++}`
  const store = createLibraryStore({
    openDb: () => openLibraryDb(dbName),
    client,
    remote,
    sleep: () => Promise.resolve(),
    now: () => 5000 + id,
    newId: () => `song-${++id}`,
    notify: () => {},
  })
  return { store, remote, client, dbName }
}

const input: ImportInput = {
  file: new Blob(['mp3'], { type: 'audio/mpeg' }),
  fileName: 'Seven Nation Army.mp3',
  title: 'Seven Nation Army',
  artist: 'The White Stripes',
  durationS: 230,
  youtubeUrl: null,
}

const ids = (store: ReturnType<typeof setup>['store']) => store.getState().songs.map(s => s.id)

describe('biblioteca en la nube', () => {
  it('sync trae las canciones de la cuenta y las juega bajando los archivos una vez', async () => {
    const { store, remote, dbName } = setup()
    remote.songs = [remoteSong({ lastPlayedAt: 700 })]
    expect(store.getState().cloud).toBe(true)
    await store.getState().sync()
    expect(store.getState().songs).toEqual([
      expect.objectContaining({ id: 'remote-1', title: 'Back in Black', cloud: true, jobId: null }),
    ])

    const bundle = await store.getState().bundle('remote-1')
    expect(bundle.chart.title).toBe('Back in Black')
    expect(await (bundle.audio!.stems!.drums as Blob).text()).toBe('drums')
    expect(bundle.peaks?.peaks).toEqual([0.3])
    // La segunda vez sale de IndexedDB, aunque no haya red
    remote.offline = true
    await store.getState().bundle('remote-1')
    expect(remote.fetched).toEqual(['remote-1'])
    const db = await openLibraryDb(dbName)
    expect(await db.getAsset('remote-1', 'chart')).toBeTruthy()
    db.close()
  })

  it('quita las borradas en otro equipo y conserva las que nunca subieron', async () => {
    const { store, remote, dbName } = setup()
    remote.songs = [remoteSong(), remoteSong({ id: 'remote-2', createdAt: 400 })]
    await store.getState().sync()
    const db = await openLibraryDb(dbName)
    await db.putSong({
      ...store.getState().songs[0],
      id: 'local-only',
      cloud: undefined,
      createdAt: 1,
    })
    db.close()

    remote.songs = [remoteSong()]
    await store.getState().sync()
    expect(ids(store)).toEqual(['remote-1', 'local-only'])
  })

  it('sin red sync falla y la biblioteca local queda intacta', async () => {
    const { store, remote } = setup()
    remote.songs = [remoteSong()]
    await store.getState().sync()
    remote.offline = true
    await expect(store.getState().sync()).rejects.toThrow('sin red')
    expect(ids(store)).toEqual(['remote-1'])
  })

  it('reanuda el análisis que empezó en otro equipo sin subir el audio', async () => {
    const { store, remote, client } = setup()
    client.jobs = [makeJob('transcribing'), makeJob('done')]
    remote.songs = [remoteSong({ status: 'analyzing', jobId: 'job-r' })]
    await store.getState().sync()
    await vi.waitFor(() =>
      expect(store.getState().songs[0]).toMatchObject({ status: 'ready', jobId: null }),
    )
    expect(client.created).toEqual([])
    expect(client.polls).toBeGreaterThan(0)
  })

  it('reintentar una canción fallida en otro equipo crea un trabajo sin archivo', async () => {
    const { store, remote, client } = setup()
    remote.songs = [
      remoteSong({ status: 'failed', jobId: 'job-x', error: { code: 'INTERNAL', message: 'x' } }),
    ]
    await store.getState().sync()
    store.getState().retry('remote-1')
    await vi.waitFor(() => expect(store.getState().songs[0].status).toBe('ready'))
    expect(client.lastFile).toBeNull()
    expect(client.lastMeta).toMatchObject({ songId: 'remote-1', title: 'Back in Black' })
  })

  it('importar sube con los datos de la canción y la marca como de la nube', async () => {
    const { store, client, remote } = setup()
    const id = await store.getState().importSong(input)
    await vi.waitFor(() => expect(store.getState().songs[0].status).toBe('ready'))
    expect(client.lastMeta).toEqual({
      songId: id,
      title: 'Seven Nation Army',
      artist: 'The White Stripes',
      durationS: 230,
      youtubeUrl: null,
    })
    expect(await client.lastFile?.text()).toBe('mp3')
    expect(store.getState().songs[0].cloud).toBe(true)
    // Una sync mientras la nube aún no la lista no la borra: el análisis es de esta pestaña
    remote.songs = [remoteSong({ id, status: 'ready' })]
    await store.getState().sync()
    expect(ids(store)).toEqual([id])
  })

  it('borrar y jugar llegan a la nube', async () => {
    const { store, remote } = setup()
    remote.songs = [remoteSong()]
    await store.getState().sync()
    await store.getState().markPlayed('remote-1')
    expect(remote.played).toEqual([['remote-1', 5000]])

    remote.offline = true
    await expect(store.getState().remove('remote-1')).rejects.toThrow()
    expect(ids(store)).toEqual(['remote-1'])
    remote.offline = false
    await store.getState().remove('remote-1')
    expect(remote.deleted).toEqual(['remote-1'])
    expect(ids(store)).toEqual([])
  })

  it('load no reanuda análisis antes de tener sesión', async () => {
    const { store, client, dbName } = setup()
    const db = await openLibraryDb(dbName)
    const { jobId, ...song } = remoteSong({ status: 'analyzing' })
    await db.putSong({ ...song, jobId, cloud: true })
    db.close()
    await store.getState().load()
    expect(store.getState().songs).toHaveLength(1)
    expect(store.getState().trackers).toEqual({})
    expect(client.polls).toBe(0)
  })
})
