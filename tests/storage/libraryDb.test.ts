// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openLibraryDb } from '@/storage/libraryDb'
import type { LibraryDb, LibrarySong } from '@/storage/libraryDb'
import { analyzedChart } from '../fakes/FakeWorkerClient'

let db: LibraryDb
let dbIndex = 0

const song = (id: string, createdAt: number): LibrarySong => ({
  id,
  title: id,
  artist: '',
  fileName: `${id}.mp3`,
  durationS: 30,
  youtubeUrl: null,
  status: 'analyzing',
  jobId: null,
  error: null,
  summary: null,
  createdAt,
  updatedAt: createdAt,
  lastPlayedAt: null,
})

beforeEach(async () => {
  db = await openLibraryDb(`test-${dbIndex++}`)
})

afterEach(() => db.close())

describe('libraryDb', () => {
  it('guarda y lista canciones, la más nueva primero', async () => {
    await db.putSong(song('a', 1))
    await db.putSong(song('b', 2))
    await db.putSong({ ...song('a', 1), title: 'A editada' })
    const songs = await db.listSongs()
    expect(songs.map(s => s.id)).toEqual(['b', 'a'])
    expect(songs[1].title).toBe('A editada')
    expect(await db.getSong('zzz')).toBeNull()
  })

  it('guarda los archivos (blobs y JSON) por canción', async () => {
    const chart = analyzedChart(4)
    await db.putAssets('a', { audio: new Blob(['mp3-bytes'], { type: 'audio/mpeg' }), chart })
    await db.putAssets('a', { drums: new Blob(['drums']) })
    const audio = await db.getAsset('a', 'audio')
    expect(audio).toBeInstanceOf(Blob)
    expect(await audio!.text()).toBe('mp3-bytes')
    expect(await (await db.getAsset('a', 'drums'))!.text()).toBe('drums')
    expect(await db.getAsset('a', 'chart')).toEqual(chart)
    expect(await db.getAsset('a', 'peaks')).toBeNull()
  })

  it('borrar una canción borra sus archivos y no los de otras', async () => {
    await db.putSong(song('a', 1))
    await db.putSong(song('ab', 2))
    await db.putAssets('a', { audio: new Blob(['1']), drums: new Blob(['2']) })
    await db.putAssets('ab', { audio: new Blob(['3']) })
    await db.deleteSong('a')
    expect(await db.getSong('a')).toBeNull()
    expect(await db.getAsset('a', 'audio')).toBeNull()
    expect(await db.getAsset('a', 'drums')).toBeNull()
    expect(await (await db.getAsset('ab', 'audio'))!.text()).toBe('3')
  })

  it('los datos sobreviven a cerrar y reabrir', async () => {
    const name = `test-reopen-${dbIndex}`
    const first = await openLibraryDb(name)
    await first.putSong(song('a', 1))
    first.close()
    const second = await openLibraryDb(name)
    expect((await second.listSongs()).map(s => s.id)).toEqual(['a'])
    second.close()
  })
})
