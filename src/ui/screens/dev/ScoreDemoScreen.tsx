import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SongClock } from '@/audio/AudioClock'
import { ACCENTS } from '@/constants/theme'
import type { Piece } from '@/types'
import { GameEngine } from '@/engine/GameEngine'
import { midiManager } from '@/midi/MidiManager'
import { ScoreCanvas } from '@/renderer/ScoreCanvas'
import type { ScoreView } from '@/renderer/ScoreCanvas'
import { Button, Checkbox, SegmentedControl, Slider } from '@/ui/primitives'
import { buildDemoChart } from './demoChart'

/**
 * Reloj de la demo, solo para /dev/score: no hay MP3, así que la posición sale de
 * performance.now(). En el juego el reloj es siempre el AudioClock del audio.
 */
class DemoClock implements SongClock {
  readonly playbackRate = 1
  private anchorPerf = 0
  private anchorSong = 0
  private playing = false

  get isPlaying(): boolean {
    return this.playing
  }

  now(): number {
    return this.playing ? this.perfToSong(performance.now()) : this.anchorSong
  }

  perfToSong(perfMs: number): number {
    return this.anchorSong + (perfMs - this.anchorPerf) / 1000
  }

  songToPerf(songT: number): number {
    return this.anchorPerf + (songT - this.anchorSong) * 1000
  }

  play(): void {
    this.anchorPerf = performance.now()
    this.playing = true
  }

  pause(): void {
    this.anchorSong = this.now()
    this.playing = false
  }

  seek(songT: number): void {
    this.anchorSong = songT
    this.anchorPerf = performance.now()
  }
}

/** Resultado simulado de cada nota: desfase en ms, Fallo o pad incorrecto. */
type PlannedHit = { offsetMs: number } | { miss: true } | { wrongPiece: Piece }

function planHits(count: number): PlannedHit[] {
  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  return Array.from({ length: count }, () => {
    const r = random()
    if (r < 0.06) return { miss: true }
    if (r < 0.09) return { wrongPiece: 'crash' }
    // La mayoría cerca del centro, algunos en la ventana Cerca
    const spread = random() < 0.8 ? 25 : 70
    return { offsetMs: (random() * 2 - 1) * spread }
  })
}

const VIEWS = [
  { value: 'staff', label: 'Pentagrama' },
  { value: 'lanes', label: 'Carriles' },
] as const

/**
 * Demo de la partitura (solo en dev, /dev/score): 2 000 notas, autoplay simulado y
 * golpes MIDI reales si hay kit conectado. Sirve para la prueba manual de 60 fps.
 */
export function ScoreDemoScreen() {
  const chart = useMemo(() => buildDemoChart(), [])
  const notes = chart.difficulties.full.notes
  const clock = useMemo(() => new DemoClock(), [])
  const engine = useMemo(() => {
    const e = new GameEngine({ clock })
    e.load(chart, 'full', { level: 'intermediate', dynamicsBonus: true })
    return e
  }, [chart, clock])
  const plan = useMemo(() => planHits(notes.length), [notes])

  const [view, setView] = useState<ScoreView>('staff')
  const [playing, setPlaying] = useState(false)
  const [autoplay, setAutoplay] = useState(true)
  const [scrollSpeed, setScrollSpeed] = useState(1)
  const fpsRef = useRef<HTMLSpanElement>(null)
  const autoplayRef = useRef(autoplay)
  const cursorRef = useRef(0)

  useEffect(() => {
    autoplayRef.current = autoplay
  }, [autoplay])

  // Autoplay: toca las notas según el plan, con timestamps como los del MIDI
  useEffect(() => {
    if (!playing) return
    let frameId = requestAnimationFrame(function frame() {
      frameId = requestAnimationFrame(frame)
      const now = clock.now()
      while (cursorRef.current < notes.length) {
        const i = cursorRef.current
        const p = plan[i]
        const t = notes[i].t + ('offsetMs' in p ? p.offsetMs / 1000 : 0)
        if (t > now) break
        cursorRef.current++
        if (!autoplayRef.current || 'miss' in p) continue
        engine.handleHit({
          instrument: 'wrongPiece' in p ? p.wrongPiece : notes[i].piece,
          midi: 0,
          velocity: notes[i].velocity,
          timestamp: clock.songToPerf(t),
        })
      }
    })
    return () => cancelAnimationFrame(frameId)
  }, [playing, clock, engine, notes, plan])

  // Golpes reales del kit (si está conectado)
  useEffect(() => midiManager.onHit(hit => engine.handleHit(hit)), [engine])

  useEffect(() => {
    const unsubscribe = engine.onEnd(() => setPlaying(false))
    return () => {
      unsubscribe()
      engine.stop()
    }
  }, [engine])

  const restart = useCallback(() => {
    clock.seek(0)
    engine.seek(0)
    cursorRef.current = 0
  }, [clock, engine])

  const toggle = useCallback(() => {
    if (playing) {
      clock.pause()
      engine.stop()
    } else {
      if (engine.phase === 'ended') restart()
      clock.play()
      engine.start()
    }
    setPlaying(!playing)
  }, [playing, clock, engine, restart])

  // fps medidos en ventanas de 500 ms, escritos directo al DOM (sin re-render)
  const fpsWindow = useRef({ start: 0, frames: 0 })
  const onFrame = useCallback((nowMs: number) => {
    const w = fpsWindow.current
    w.frames++
    if (nowMs - w.start >= 500) {
      if (fpsRef.current) {
        fpsRef.current.textContent = `${Math.round((w.frames * 1000) / (nowMs - w.start))} fps`
      }
      w.start = nowMs
      w.frames = 0
    }
  }, [])

  return (
    <main className="min-h-screen bg-bg p-6 font-sans text-fg">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-lg font-bold">Demo de partitura · {notes.length} notas</h1>
        <Button size="sm" onClick={toggle}>
          {playing ? 'Pausa' : 'Reproducir'}
        </Button>
        <Button size="sm" variant="secondary" onClick={restart}>
          Reiniciar
        </Button>
        <Checkbox checked={autoplay} onChange={setAutoplay} label="Autoplay" />
        <Slider
          aria-label="Velocidad de scroll"
          value={scrollSpeed}
          onChange={setScrollSpeed}
          min={0.5}
          max={2}
          step={0.1}
          valueText={`×${scrollSpeed.toFixed(1)}`}
          className="w-48"
        />
        <span ref={fpsRef} className="font-mono text-sm text-muted">
          — fps
        </span>
        <Button size="sm" variant="secondary" onClick={() => void midiManager.connect()}>
          Conectar MIDI
        </Button>
      </div>

      <section
        aria-label="Partitura"
        className="relative h-[300px] overflow-hidden rounded-xl bg-paper"
      >
        <ScoreCanvas
          source={engine}
          clock={clock}
          notes={notes}
          grid={chart.grid}
          view={view}
          accent={ACCENTS.violet.accent}
          scrollSpeed={scrollSpeed}
          onFrame={onFrame}
        />
        <SegmentedControl
          aria-label="Vista de la partitura"
          variant="paper"
          options={VIEWS}
          value={view}
          onChange={setView}
          className="absolute top-3 right-4"
        />
      </section>
    </main>
  )
}
