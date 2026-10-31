import type { ChartV2, JobSummary } from '@/types'
import type { RemoteLibrary, RemoteSong } from '@/api/cloudClient'
import type { SongStatus } from '@/library/status'
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
    youtubeOffsetMs: 0,
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
  offsets: Array<[string, number]> = []

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

  async setYoutubeOffset(songId: string, offsetMs: number) {
    await this.check()
    this.offsets.push([songId, offsetMs])
    const song = this.songs.find(s => s.id === songId)
    if (song) song.youtubeOffsetMs = offsetMs
  }

  savedCharts: Array<{ songId: string; chart: ChartV2; status: SongStatus }> = []

  async saveChart(songId: string, chart: ChartV2, status: SongStatus, summary: JobSummary) {
    await this.check()
    this.savedCharts.push({ songId, chart, status })
    const song = this.songs.find(s => s.id === songId)
    if (song) Object.assign(song, { status, summary })
  }
}
