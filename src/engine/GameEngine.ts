import { GOOD_WINDOW_MS, POINTS } from '@/constants/game'
import { evaluateHit, findClosestNote, isNoteMissed } from '@/engine/HitEvaluator'
import { flattenNotes } from '@/engine/SongParser'
import { midiManager } from '@/midi/MidiManager'
import { HitAccuracy } from '@/types'
import type { HitResult, MidiHit, NoteEvent, SongData } from '@/types'

// ─── Tipos de callbacks ───────────────────────────────────────────────────────

type HitResultCallback = (result: HitResult) => void
type MissCallback = (note: NoteEvent) => void
type FrameCallback = (gameTimeMs: number) => void
type SongEndCallback = () => void

// ─── GameEngine ───────────────────────────────────────────────────────────────

/**
 * GameEngine — orquesta el loop principal del juego.
 *
 * Responsabilidades:
 *  - Mantener el reloj de la canción con performance.now()
 *  - Recibir hits MIDI y matchearlos a notas pendientes
 *  - Detectar misses (notas que vencieron sin ser golpeadas)
 *  - Emitir eventos a suscriptores (renderer, scoring, UI)
 *
 * NO contiene lógica de render ni de React.
 */
export class GameEngine {
  private song: SongData | null = null
  private allNotes: NoteEvent[] = []

  // Índice de la primera nota que aún puede ser golpeada o missada
  private noteHead = 0

  // Notas que ya están en la ventana de evaluación pero no se han resuelto
  private pendingNotes: NoteEvent[] = []

  // Set de notas ya resueltas (para no procesarlas dos veces)
  private resolvedNotes = new Set<NoteEvent>()

  private songStartTime: number | null = null
  private rafId: number | null = null
  private isRunning = false
  private latencyOffsetMs = 0

  // ─── Callbacks ──────────────────────────────────────────────────────────────

  private hitResultCallbacks = new Set<HitResultCallback>()
  private missCallbacks = new Set<MissCallback>()
  private frameCallbacks = new Set<FrameCallback>()
  private songEndCallbacks = new Set<SongEndCallback>()

  // ─── API pública ─────────────────────────────────────────────────────────────

  load(song: SongData, latencyOffsetMs = 0): void {
    // Detener cualquier partida en curso antes de resetear
    // (necesario para React StrictMode que invoca effects dos veces en dev)
    this.pause()
    this.unsubMidi?.()
    this.unsubMidi = null
    this.song = song
    this.latencyOffsetMs = latencyOffsetMs
    this.allNotes = flattenNotes(song)
    this.reset()
  }

  start(): void {
    if (!this.song || this.isRunning) return
    this.reset()
    this.songStartTime = performance.now()
    this.isRunning = true
    this.unsubMidi = midiManager.onHit(hit => this.handleHit(hit))
    this.rafId = requestAnimationFrame(this.loop)
  }

  pause(): void {
    if (!this.isRunning) return
    this.isRunning = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  resume(): void {
    if (this.isRunning || !this.song || this.songStartTime === null) return
    // Reajustar el origen del reloj para compensar el tiempo pausado
    const pausedAt = this.currentGameTimeMs()
    this.songStartTime = performance.now() - pausedAt
    this.isRunning = true
    this.rafId = requestAnimationFrame(this.loop)
  }

  stop(): void {
    this.pause()
    this.unsubMidi?.()
    this.unsubMidi = null
    this.reset()
  }

  setLatencyOffset(ms: number): void {
    this.latencyOffsetMs = ms
  }

  currentGameTimeMs(): number {
    if (this.songStartTime === null) return 0
    return performance.now() - this.songStartTime
  }

  // ─── Suscripciones ───────────────────────────────────────────────────────────

  onHitResult(cb: HitResultCallback): () => void {
    this.hitResultCallbacks.add(cb)
    return () => this.hitResultCallbacks.delete(cb)
  }

  onMiss(cb: MissCallback): () => void {
    this.missCallbacks.add(cb)
    return () => this.missCallbacks.delete(cb)
  }

  /** Llamado en cada frame del RAF con el tiempo actual de la canción en ms */
  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.add(cb)
    return () => this.frameCallbacks.delete(cb)
  }

  onSongEnd(cb: SongEndCallback): () => void {
    this.songEndCallbacks.add(cb)
    return () => this.songEndCallbacks.delete(cb)
  }

  // ─── Loop principal ──────────────────────────────────────────────────────────

  private unsubMidi: (() => void) | null = null

  private loop = (): void => {
    if (!this.isRunning) return

    const gameTimeMs = this.currentGameTimeMs()

    this.advanceNoteHead(gameTimeMs)
    this.detectMisses(gameTimeMs)
    this.frameCallbacks.forEach(cb => cb(gameTimeMs))

    if (this.isSongFinished(gameTimeMs)) {
      this.isRunning = false
      this.unsubMidi?.()
      this.songEndCallbacks.forEach(cb => cb())
      return
    }

    this.rafId = requestAnimationFrame(this.loop)
  }

  // ─── Procesamiento de hits MIDI ──────────────────────────────────────────────

  private handleHit(hit: MidiHit): void {
    if (!this.isRunning || this.songStartTime === null) return

    const hitTimeMs = hit.timestamp - this.songStartTime
    const note = findClosestNote(hitTimeMs, hit.instrument, this.pendingNotes)

    if (!note) {
      // Golpe que no corresponde a ninguna nota — ignorar silenciosamente
      return
    }

    this.resolvedNotes.add(note)
    this.pendingNotes = this.pendingNotes.filter(n => n !== note)

    const result = evaluateHit(hitTimeMs, note, this.latencyOffsetMs)
    this.hitResultCallbacks.forEach(cb => cb(result))
  }

  // ─── Avance de la ventana de notas pendientes ─────────────────────────────────

  /**
   * Mueve notas desde allNotes a pendingNotes cuando entran en la ventana Good.
   * Avanzamos el noteHead para no re-procesar notas ya ingresadas.
   */
  private advanceNoteHead(gameTimeMs: number): void {
    while (this.noteHead < this.allNotes.length) {
      const note = this.allNotes[this.noteHead]
      // La nota entra en ventana cuando gameTimeMs está a ≤ GOOD_WINDOW_MS de ella
      if (note.absoluteTimeMs - gameTimeMs <= GOOD_WINDOW_MS) {
        if (!this.resolvedNotes.has(note)) {
          this.pendingNotes.push(note)
        }
        this.noteHead++
      } else {
        break
      }
    }
  }

  /**
   * Detecta notas en pendingNotes que ya vencieron sin ser golpeadas → Miss.
   */
  private detectMisses(gameTimeMs: number): void {
    const stillPending: NoteEvent[] = []

    for (const note of this.pendingNotes) {
      if (isNoteMissed(note.absoluteTimeMs, gameTimeMs)) {
        this.resolvedNotes.add(note)
        const missResult: HitResult = {
          noteEvent: note,
          accuracy: HitAccuracy.Miss,
          deltaMs: gameTimeMs - note.absoluteTimeMs,
          points: POINTS[HitAccuracy.Miss],
        }
        this.hitResultCallbacks.forEach(cb => cb(missResult))
        this.missCallbacks.forEach(cb => cb(note))
      } else {
        stillPending.push(note)
      }
    }

    this.pendingNotes = stillPending
  }

  private isSongFinished(gameTimeMs: number): boolean {
    if (!this.song || this.allNotes.length === 0) return false
    const lastNote = this.allNotes[this.allNotes.length - 1]
    // Termina cuando todas las notas están resueltas y la última ya pasó su ventana
    return (
      this.resolvedNotes.size >= this.allNotes.length &&
      gameTimeMs > lastNote.absoluteTimeMs + GOOD_WINDOW_MS
    )
  }

  private reset(): void {
    this.noteHead = 0
    this.pendingNotes = []
    this.resolvedNotes = new Set()
    this.songStartTime = null
  }
}

// Singleton para uso en la app
export const gameEngine = new GameEngine()
