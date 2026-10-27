// @vitest-environment node
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { WorkerError } from '@/api/workerClient'
import { WORKER_STALE_MS, audioExtension, createCloudClient } from '@/api/cloudClient'
import { authErrorMessage } from '@/api/cloudAuth'
import { cloudConfig } from '@/api/supabase'
import { analyzedChart } from '../fakes/FakeWorkerClient'

const UID = 'user-1'

interface Seen {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  contentType: string | null
}

type Handler = (req: Seen) => Response | undefined

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** supabase-js real sobre un fetch falso: se comprueban las peticiones que hace. */
function setup(handler: Handler, now = () => 1_000_000) {
  const seen: Seen[] = []
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init?.headers)
    let body: unknown = init?.body ?? null
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        // cuerpo de texto
      }
    }
    const req: Seen = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body,
      contentType: headers.get('content-type'),
    }
    seen.push(req)
    return handler(req) ?? json({ message: `sin ruta ${req.method} ${req.path}` }, 404)
  }
  const sb = createClient('https://demo.supabase.co', 'sb_publishable_x', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch as typeof fetch },
  })
  const client = createCloudClient(sb, { userId: async () => UID, now })
  return { client, seen }
}

describe('cliente de la nube', () => {
  it('crear: sube el audio a la carpeta del usuario, crea la canción y el trabajo', async () => {
    const { client, seen } = setup(req => {
      if (req.method === 'GET' && req.path === '/rest/v1/songs') return json(null)
      if (req.path.startsWith('/storage/v1/object/audio/')) return json({ Key: 'k' })
      if (req.method === 'POST' && req.path === '/rest/v1/songs') return json(null, 201)
      if (req.method === 'POST' && req.path === '/rest/v1/jobs') {
        return json({ id: 'job-9', status: 'queued', cached: false }, 201)
      }
    })
    const created = await client.createJob(new Blob(['mp3']), 'Mi Canción.MP3', {
      songId: 'song-1',
      title: 'Mi canción',
      artist: '',
      durationS: 200,
      youtubeUrl: null,
    })
    expect(created).toEqual({ jobId: 'job-9', status: 'queued', cached: false })
    const upload = seen.find(r => r.path.startsWith('/storage'))!
    expect(upload.path).toBe(`/storage/v1/object/audio/${UID}/song-1/original.mp3`)
    expect(seen.find(r => r.method === 'POST' && r.path === '/rest/v1/songs')!.body).toMatchObject({
      id: 'song-1',
      audio_path: `${UID}/song-1/original.mp3`,
      file_name: 'Mi Canción.MP3',
      duration_s: 200,
    })
    expect(seen.find(r => r.path === '/rest/v1/jobs')!.body).toEqual({ song_id: 'song-1' })
  })

  it('crear con la canción ya en la nube no vuelve a subir el audio', async () => {
    const { client, seen } = setup(req => {
      if (req.method === 'GET' && req.path === '/rest/v1/songs') return json({ id: 'song-1' })
      if (req.path === '/rest/v1/jobs')
        return json({ id: 'job-2', status: 'queued', cached: false })
    })
    await client.createJob(null, 'a.mp3', {
      songId: 'song-1',
      title: 't',
      artist: '',
      durationS: 1,
      youtubeUrl: null,
    })
    expect(seen.some(r => r.path.startsWith('/storage'))).toBe(false)
  })

  it('progreso y resultado del trabajo', async () => {
    const chart = analyzedChart()
    const { client } = setup(req => {
      if (req.path === '/rest/v1/jobs' && req.query.get('select') === '*') {
        return json({
          id: 'job-1',
          song_id: 'song-1',
          status: 'transcribing',
          cached: false,
          stages: [],
          summary: null,
          error: null,
          created_at: 'c',
          updated_at: 'u',
        })
      }
      if (req.path === '/rest/v1/jobs') return json({ song_id: 'song-1' })
      if (req.path === '/rest/v1/charts') {
        return json({
          data: chart,
          peaks: { samplesPerPeak: 1, sampleRate: 1, peaks: [] },
          drums_path: `${UID}/song-1/drums.ogg`,
          backing_path: `${UID}/song-1/backing.ogg`,
        })
      }
      if (req.path === `/storage/v1/object/stems/${UID}/song-1/drums.ogg`) {
        return new Response('OggS', { headers: { 'Content-Type': 'audio/ogg' } })
      }
    })
    expect(await client.getJob('job-1')).toMatchObject({ jobId: 'job-1', status: 'transcribing' })
    const result = await client.getResult('job-1')
    expect(result.stems.drums).toBe(`storage://stems/${UID}/song-1/drums.ogg`)
    expect(await (await client.download(result.stems.drums)).text()).toBe('OggS')
  })

  it('el worker cuenta como apagado sin latido reciente', async () => {
    let lastSeen = new Date(1_000_000 - 10_000).toISOString()
    const { client } = setup(req => {
      if (req.path === '/rest/v1/workers') return json([{ id: 'pc', last_seen: lastSeen }])
    })
    await expect(client.health()).resolves.toBeUndefined()
    lastSeen = new Date(1_000_000 - WORKER_STALE_MS - 1).toISOString()
    await expect(client.health()).rejects.toBeInstanceOf(WorkerError)
  })

  it('lista las canciones del usuario con su último trabajo', async () => {
    const { client, seen } = setup(req => {
      if (req.path === '/rest/v1/songs') {
        return json([
          {
            id: 'song-1',
            title: 'T',
            artist: 'A',
            file_name: 'a.mp3',
            duration_s: 10,
            youtube_url: null,
            status: 'analyzing',
            error: null,
            summary: null,
            created_at: '2026-10-26T00:00:00Z',
            updated_at: '2026-10-26T00:00:01Z',
            last_played_at: null,
            audio_path: 'x',
          },
        ])
      }
      if (req.path === '/rest/v1/jobs') {
        return json([
          { id: 'job-new', song_id: 'song-1' },
          { id: 'job-old', song_id: 'song-1' },
        ])
      }
    })
    const [song] = await client.listSongs()
    expect(song).toMatchObject({ id: 'song-1', fileName: 'a.mp3', jobId: 'job-new' })
    expect(song.createdAt).toBe(Date.parse('2026-10-26T00:00:00Z'))
    expect(seen[0].query.get('user_id')).toBe(`eq.${UID}`)
  })

  it('borrar quita audio y stems antes que la fila', async () => {
    const { client, seen } = setup(req => {
      if (req.method === 'GET' && req.path === '/rest/v1/songs') {
        return json({ audio_path: `${UID}/song-1/original.mp3` })
      }
      if (req.method === 'DELETE') return json([])
    })
    await client.deleteSong('song-1')
    const deletes = seen.filter(r => r.method === 'DELETE')
    expect(deletes.map(r => r.path)).toEqual([
      '/storage/v1/object/audio',
      '/storage/v1/object/stems',
      '/rest/v1/songs',
    ])
    expect(deletes[1].body).toEqual({
      prefixes: [`${UID}/song-1/drums.ogg`, `${UID}/song-1/backing.ogg`],
    })
  })

  it('un corte de red es un error transitorio', async () => {
    const sb = createClient('https://demo.supabase.co', 'k', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch,
      },
    })
    const client = createCloudClient(sb, { userId: async () => UID })
    // Un PATCH no se reintenta solo (las lecturas sí, con espera: supabase-js)
    const error = await client.cancelJob('job-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WorkerError)
    expect((error as WorkerError).transient).toBe(true)
  })

  it('extensión, configuración y mensajes de auth', () => {
    expect(audioExtension('a.M4A')).toBe('m4a')
    expect(() => audioExtension('a.flac')).toThrow(WorkerError)
    expect(cloudConfig({})).toBeNull()
    expect(cloudConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_PUBLISHABLE_KEY: ' k ' })).toEqual({
      url: 'u',
      publishableKey: 'k',
    })
    expect(authErrorMessage({ message: 'x', code: 'otp_expired', status: 403 })).toMatch(/enlace/)
    expect(authErrorMessage({ message: 'x', status: 0 })).toMatch(/Sin conexión/)
  })
})
