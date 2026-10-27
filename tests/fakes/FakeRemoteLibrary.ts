import type { RemoteLibrary, RemoteSong } from '@/api/cloudClient'
import type { DownloadedResult } from '@/library/jobTracker'
import { analyzedChart } from './FakeWorkerClient'

export function remoteSong(patch: Partial<RemoteSong> = {}): RemoteSong {
  return {
    id: 'remote-1',
    title: 'Back in Black',
    artist: 'AC/DC',
    fileName: 'back in black.mp3',
    durationS: 255,
    youtubeUrl: null,
    status: 'ready',
    error: null,
    summary: null,
    createdAt: 500,
    updatedAt: 600,
    lastPlayedAt: null,
    jobId: 'job-r',
    ...patch,
  }
}

/** Biblioteca en la nube en memoria. */
export class FakeRemoteLibrary implements RemoteLibrary {
  songs: RemoteSong[] = []
  offline = false
  deleted: string[] = []
  played: Array<[string, number]> = []
  fetched: string[] = []

  private check() {
    if (this.offline) return Promise.reject(new Error('sin red'))
    return Promise.resolve()
  }

  async listSongs() {
    await this.check()
    return this.songs.map(s => ({ ...s }))
  }

  async fetchResult(songId: string): Promise<DownloadedResult> {
    await this.check()
    this.fetched.push(songId)
    return {
      result: {
        chart: analyzedChart(),
        stems: { drums: 'storage://stems/d', backing: 'storage://stems/b' },
        peaks: { samplesPerPeak: 512, sampleRate: 44100, peaks: [0.3] },
      },
      drums: new Blob(['drums']),
      backing: new Blob(['backing']),
    }
  }

  async deleteSong(songId: string) {
    await this.check()
    this.deleted.push(songId)
    this.songs = this.songs.filter(s => s.id !== songId)
  }

  async markPlayed(songId: string, at: number) {
    await this.check()
    this.played.push([songId, at])
  }
}
