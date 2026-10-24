import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ReferenceHit } from '@/types'
import { StemPlayer } from '@/audio/StemPlayer'
import { midiManager } from '@/midi/MidiManager'
import { resolveInstrument } from '@/midi/midiMap'
import {
  EMPTY_RECORDING,
  buildReferenceFile,
  countByPiece,
  coveredSeconds,
  mergeTake,
  parseRecordingDraft,
  songIdFromFileName,
} from '@/reference/reference'
import type { RecordingState } from '@/reference/reference'

// Herramienta de desarrollo (A4): graba los golpes reales de una canción con la
// batería para medir la precisión de la IA. Ruta: /dev/record-reference

const SEEK_STEP_S = 5
const FEED_SIZE = 8
const DRAFT_PREFIX = 'drumhero.reference.'

interface LoadedSong {
  fileName: string
  songId: string
  sha256: string | null
  durationS: number
}

function formatTime(s: number): string {
  const sign = s < 0 ? '-' : ''
  const abs = Math.abs(s)
  const m = Math.floor(abs / 60)
  const sec = (abs % 60).toFixed(3).padStart(6, '0')
  return `${sign}${m}:${sec}`
}

async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', data)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

function loadDraft(songId: string): RecordingState | null {
  try {
    return parseRecordingDraft(localStorage.getItem(DRAFT_PREFIX + songId))
  } catch {
    return null
  }
}

function saveDraft(songId: string, state: RecordingState): void {
  try {
    localStorage.setItem(DRAFT_PREFIX + songId, JSON.stringify(state))
  } catch {
    // Sin almacenamiento (modo privado): el borrador es solo una comodidad
  }
}

export function RecordReferenceScreen() {
  const ctxRef = useRef<AudioContext | null>(null)
  const playerRef = useRef<StemPlayer | null>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  // Toma en curso: refs para no re-renderizar por golpe en el camino crítico
  const takeStartRef = useRef<number | null>(null)
  const takeHitsRef = useRef<ReferenceHit[]>([])
  const armedRef = useRef(true)
  // Espejos de estado para callbacks creados antes (onEnded, teclado)
  const recordingRef = useRef<RecordingState>(EMPTY_RECORDING)
  const songIdRef = useRef<string | null>(null)

  const [song, setSong] = useState<LoadedSong | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [armed, setArmed] = useState(true)
  const [recording, setRecording] = useState<RecordingState>(EMPTY_RECORDING)
  const [undoStack, setUndoStack] = useState<RecordingState[]>([])
  const [feed, setFeed] = useState<ReferenceHit[]>([])
  const [takeCount, setTakeCount] = useState(0)
  const [unmapped, setUnmapped] = useState(0)
  const [device, setDevice] = useState<string | null>(null)

  // ─── MIDI ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const refreshDevice = () => setDevice(midiManager.getSelectedDeviceName())
    const unsubState = midiManager.onStateChange(refreshDevice)
    const unsubDevices = midiManager.onDevicesChange(refreshDevice)
    if ('requestMIDIAccess' in navigator && midiManager.getState() === 'disconnected') {
      midiManager.connect().catch((e: unknown) => setError(String(e)))
    }
    refreshDevice()

    const unsubNotes = midiManager.onNoteOn(noteOn => {
      const player = playerRef.current
      if (!player?.isPlaying || takeStartRef.current === null) return
      const piece = resolveInstrument(noteOn.note)
      if (!piece) {
        setUnmapped(n => n + 1)
        return
      }
      const hit: ReferenceHit = {
        t: player.clock.perfToSong(noteOn.timestamp),
        piece,
        note: noteOn.note,
        velocity: noteOn.velocity,
      }
      takeHitsRef.current.push(hit)
      setTakeCount(takeHitsRef.current.length)
      setFeed(f => [hit, ...f].slice(0, FEED_SIZE))
    })
    return () => {
      unsubState()
      unsubDevices()
      unsubNotes()
    }
  }, [])

  // ─── Reloj en pantalla (solo pinta; el tiempo lo da el AudioClock) ─────────

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const player = playerRef.current
      if (player && timeRef.current && progressRef.current) {
        const t = player.clock.now()
        timeRef.current.textContent = formatTime(t)
        progressRef.current.style.width = `${Math.min(Math.max(t / player.durationS, 0), 1) * 100}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ─── Tomas ─────────────────────────────────────────────────────────────────

  const setRecordingState = useCallback((next: RecordingState) => {
    recordingRef.current = next
    setRecording(next)
    if (songIdRef.current) saveDraft(songIdRef.current, next)
  }, [])

  const commit = useCallback(
    (next: RecordingState) => {
      const previous = recordingRef.current
      if (next === previous) return
      setUndoStack(stack => [...stack, previous])
      setRecordingState(next)
    },
    [setRecordingState],
  )

  const startTake = useCallback(() => {
    const player = playerRef.current
    if (!player || !armedRef.current) return
    takeStartRef.current = Math.max(player.clock.now(), 0)
    takeHitsRef.current = []
    setTakeCount(0)
  }, [])

  const finishTake = useCallback(() => {
    const player = playerRef.current
    const startS = takeStartRef.current
    takeStartRef.current = null
    if (!player || startS === null) return
    const endS = Math.min(player.clock.now(), player.durationS)
    const hits = takeHitsRef.current
    takeHitsRef.current = []
    commit(mergeTake(recordingRef.current, { startS, endS }, hits))
  }, [commit])

  // ─── Transporte ────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (player.isPlaying) {
      finishTake()
      player.pause()
      setPlaying(false)
    } else {
      void ctxRef.current?.resume()
      player.play()
      startTake()
      setPlaying(player.isPlaying)
    }
  }, [finishTake, startTake])

  const seekTo = useCallback(
    (t: number) => {
      const player = playerRef.current
      if (!player) return
      const wasPlaying = player.isPlaying
      if (wasPlaying) finishTake()
      player.seek(t)
      if (wasPlaying) startTake()
    },
    [finishTake, startTake],
  )

  const toggleArmed = useCallback(() => {
    const next = !armedRef.current
    armedRef.current = next
    setArmed(next)
    if (!playerRef.current?.isPlaying) return
    if (next) startTake()
    else finishTake()
  }, [finishTake, startTake])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return
      const player = playerRef.current
      if (!player) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'KeyR') {
        toggleArmed()
      } else if (e.code === 'ArrowLeft') {
        seekTo(player.clock.now() - SEEK_STEP_S)
      } else if (e.code === 'ArrowRight') {
        seekTo(player.clock.now() + SEEK_STEP_S)
      } else if (e.code === 'Home') {
        seekTo(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seekTo, toggleArmed, togglePlay])

  useEffect(() => () => playerRef.current?.dispose(), [])

  // ─── Carga del audio ───────────────────────────────────────────────────────

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      playerRef.current?.dispose()
      playerRef.current = null
      setPlaying(false)
      ctxRef.current ??= new AudioContext({ latencyHint: 'interactive' })
      const data = await file.arrayBuffer()
      const sha256 = await sha256Hex(data.slice(0))
      const buffer = await ctxRef.current.decodeAudioData(data)
      const player = new StemPlayer(ctxRef.current, [
        { buffer, output: ctxRef.current.destination },
      ])
      player.onEnded(() => {
        finishTake()
        setPlaying(false)
      })
      playerRef.current = player

      const songId = songIdFromFileName(file.name, sha256?.slice(0, 16) ?? 'cancion')
      const draft = loadDraft(songId)
      songIdRef.current = songId
      recordingRef.current = draft ?? EMPTY_RECORDING
      setRecording(recordingRef.current)
      setUndoStack([])
      setFeed([])
      setUnmapped(0)
      setSong({ fileName: file.name, songId, sha256, durationS: buffer.duration })
      if (draft && draft.hits.length > 0) {
        setNotice(
          `Se recuperó el borrador: ${draft.hits.length} golpes en ${draft.takes.length} tomas.`,
        )
      }
    } catch (err) {
      setError(`No se pudo decodificar el audio: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  function undo() {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack(stack => stack.slice(0, -1))
    setRecordingState(previous)
  }

  function clearAll() {
    if (!song || recording.hits.length === 0) return
    if (!window.confirm('¿Borrar todos los golpes grabados de esta canción?')) return
    commit(EMPTY_RECORDING)
  }

  function download() {
    if (!song) return
    const file = buildReferenceFile(recording, {
      songId: song.songId,
      audioFile: song.fileName,
      audioSha256: song.sha256,
      durationS: Number(song.durationS.toFixed(4)),
      recordedAt: new Date().toISOString(),
      device,
      outputLatencyMs: Math.round((playerRef.current?.clock.outputLatencyS() ?? 0) * 1000),
    })
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `${song.songId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Vista ─────────────────────────────────────────────────────────────────

  const counts = countByPiece(recording.hits)
  const coverage = song ? coveredSeconds(recording.takes) / song.durationS : 0
  const recordingNow = playing && armed

  return (
    <div className="h-screen overflow-auto bg-zinc-950 px-6 py-8 text-zinc-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">Grabar referencia</h1>
          <span className="text-sm text-zinc-400">
            MIDI: {device ?? <span className="text-amber-400">sin dispositivo</span>}
          </span>
        </header>

        <p className="text-sm leading-relaxed text-zinc-400">
          Carga el MP3 de <code>worker/poc/songs/</code>, activa <b>Grabar</b> y toca la batería de
          la canción. Puedes grabar por tramos: regrabar un pasaje reemplaza solo sus golpes. Al
          terminar, descarga el JSON y guárdalo en <code>worker/poc/references/</code>.
        </p>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-zinc-400">Audio</span>
          <input
            type="file"
            accept="audio/*,.mp3,.ogg,.wav,.flac,.m4a"
            onChange={e => void handleFile(e)}
            disabled={loading}
            className="text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
          />
        </label>

        {loading && <p className="text-sm text-zinc-400">Decodificando…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}

        {song && (
          <>
            <section className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{song.fileName}</span>
                <span className="font-mono text-zinc-400">id: {song.songId}</span>
              </div>
              <div
                className="h-3 cursor-pointer overflow-hidden rounded bg-zinc-800"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  seekTo(((e.clientX - rect.left) / rect.width) * song.durationS)
                }}
              >
                <div ref={progressRef} className="h-full bg-violet-400" style={{ width: '0%' }} />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="rounded bg-violet-500 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-violet-400"
                >
                  {playing ? 'Pausa' : 'Reproducir'}
                </button>
                <button
                  type="button"
                  onClick={() => seekTo(0)}
                  className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
                >
                  Al inicio
                </button>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={armed} onChange={toggleArmed} />
                  Grabar
                </label>
                {recordingNow && (
                  <span className="text-sm font-medium text-red-400">● grabando ({takeCount})</span>
                )}
                <span ref={timeRef} className="ml-auto font-mono text-lg tabular-nums">
                  0:00.000
                </span>
                <span className="font-mono text-sm text-zinc-500">
                  / {formatTime(song.durationS)}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                Espacio: reproducir/pausa · R: grabar sí/no · ←/→: ±{SEEK_STEP_S} s · Inicio: volver
                al principio
              </p>
            </section>

            <section className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
                <h2 className="mb-2 font-medium">Grabado</h2>
                <p>
                  {recording.hits.length} golpes · {recording.takes.length} tomas · cobertura{' '}
                  {Math.round(coverage * 100)} %
                </p>
                <ul className="mt-2 font-mono text-xs text-zinc-400">
                  {Object.entries(counts).map(([piece, n]) => (
                    <li key={piece}>
                      {piece}: {n}
                    </li>
                  ))}
                </ul>
                {unmapped > 0 && (
                  <p className="mt-2 text-xs text-amber-400">
                    {unmapped} notas MIDI sin pieza asignada (ignoradas)
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
                <h2 className="mb-2 font-medium">Últimos golpes</h2>
                <ul className="font-mono text-xs text-zinc-400">
                  {feed.map((hit, i) => (
                    <li key={`${hit.t}-${hit.note}-${i}`}>
                      {formatTime(hit.t)} {hit.piece} v{hit.velocity}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={download}
                disabled={recording.hits.length === 0}
                className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                Descargar {song.songId}.json
              </button>
              <button
                type="button"
                onClick={undo}
                disabled={undoStack.length === 0 || playing}
                className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-40"
              >
                Deshacer última toma
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={recording.hits.length === 0 || playing}
                className="ml-auto rounded bg-zinc-800 px-3 py-1.5 text-sm text-red-300 hover:bg-zinc-700 disabled:opacity-40"
              >
                Borrar todo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
