import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PIECES } from '@/types'
import type { Piece } from '@/types'
import type { MixLevels } from '@/audio/Mixer'
import { PIECE_LABELS } from '@/calibration/midiMapping'
import { measureAt } from '@/chart/grid'
import {
  canRedo,
  canUndo,
  chartWithEdits,
  createEditorState,
  editorReducer,
  isDirty,
  reviewItems,
} from '@/editor/editorState'
import { DIVISIONS } from '@/editor/quantize'
import type { Division } from '@/editor/quantize'
import type { GameSession, SessionOptions, SongBundle } from '@/game/GameSession'
import { formatClock } from '@/game/format'
import { effectiveSections } from '@/game/sections'
import { useGameSession } from '@/hooks/useGameSession'
import { useLibraryBundle } from '@/hooks/useLibraryBundle'
import { selectPhase, useGameStore } from '@/store/gameStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EditorCanvas } from '@/ui/editor/EditorCanvas'
import type { EditorView } from '@/ui/editor/EditorCanvas'
import { Button, Panel, SectionLabel, SegmentedControl } from '@/ui/primitives'
import { cn } from '@/ui/primitives/cn'

// Para revisar se oye la batería separada por encima del resto
const EDITOR_MIX: MixLevels = { drums: 1, backing: 0.5, metronome: 0, samples: 0 }

// "Escuchar la transcripción" (PLAN_V2 C4): la batería original, la partitura
// tocada con el kit, o las dos para comparar
type Listen = 'original' | 'transcription' | 'both'

const LISTEN_MIX: Record<Listen, Pick<MixLevels, 'drums' | 'samples'>> = {
  original: { drums: 1, samples: 0 },
  transcription: { drums: 0, samples: 1 },
  both: { drums: 0.7, samples: 0.85 },
}

const LISTEN_OPTIONS: { value: Listen; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'transcription', label: 'Transcripción' },
  { value: 'both', label: 'Ambas' },
]

function readOptions(): SessionOptions {
  const s = useSettingsStore.getState()
  return {
    difficulty: 'full',
    level: s.level,
    latencyMs: s.midiLatencyOffsetMs,
    dynamicsBonus: false,
    mix: EDITOR_MIX,
  }
}

type Tool = 'select' | 'add'

const TOOL_OPTIONS: { value: Tool; label: string }[] = [
  { value: 'select', label: 'Seleccionar' },
  { value: 'add', label: 'Agregar' },
]

const SELECT_CLASS =
  'h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg disabled:opacity-50'

interface EditorScreenProps {
  songId: string
  onBack: () => void
}

/** Editor de partitura (PLAN_V2 C3): carga la canción y abre el editor. */
export function EditorScreen({ songId, onBack }: EditorScreenProps) {
  const loaded = useLibraryBundle(songId)
  if (loaded.status === 'ready') {
    return <EditorSession bundle={loaded.bundle} songId={songId} onBack={onBack} />
  }
  if (loaded.status === 'error') return <Status message={loaded.message} onBack={onBack} />
  return <Status message="Cargando la partitura…" />
}

function EditorSession({ bundle, songId, onBack }: EditorScreenProps & { bundle: SongBundle }) {
  // El audio sirve de reloj para escuchar mientras se revisa
  const state = useGameSession(bundle, readOptions)
  if (state.status === 'ready') {
    return <EditorLayout session={state.session} songId={songId} onBack={onBack} />
  }
  if (state.status === 'error') {
    return <Status message={`No se pudo cargar el audio: ${state.message}`} onBack={onBack} />
  }
  return <Status message="Cargando la partitura…" />
}

function Status({ message, onBack }: { message: string; onBack?: () => void }) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-bg font-sans text-fg">
      <p className="max-w-lg text-center text-sm text-fg-2">{message}</p>
      {onBack && <Button onClick={onBack}>Volver</Button>}
    </main>
  )
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

function EditorLayout({
  session,
  songId,
  onBack,
}: {
  session: GameSession
  songId: string
  onBack: () => void
}) {
  const { chart } = session
  const [state, dispatch] = useReducer(editorReducer, chart, createEditorState)
  const [tool, setTool] = useState<Tool>('select')
  const [listen, setListen] = useState<Listen>('original')
  const [sectionIndex, setSectionIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const view = useRef<EditorView>({ startS: 0 })
  const playing = useGameStore(selectPhase) === 'playing'
  const sections = useMemo(() => effectiveSections(chart), [chart])
  const review = useMemo(() => reviewItems(state), [state])
  const dirty = isDirty(state)
  const selectedNotes = state.notes.filter(n => state.selection.includes(n.id))
  const hasSelection = selectedNotes.length > 0

  // El kit toca las notas tal como están en el editor, con los cambios sin guardar
  useEffect(() => {
    session.kit.setNotes(state.notes)
  }, [session, state.notes])

  function changeListen(value: Listen) {
    setListen(value)
    for (const [channel, level] of Object.entries(LISTEN_MIX[value])) {
      session.setMixLevel(channel as keyof MixLevels, level)
    }
  }

  const togglePlay = useCallback(() => {
    if (session.isPlaying) session.pause()
    else {
      // Arranca donde se está mirando
      session.seek(Math.max(view.current.startS, 0))
      void session.play()
    }
  }, [session])

  /** Mueve la vista un compás hacia atrás o adelante. */
  const jumpMeasure = useCallback(
    (delta: number) => {
      const { downbeats } = chart.grid
      if (!downbeats.length) return
      const current = Math.max(measureAt(chart.grid, view.current.startS + 0.01), 1)
      const target = Math.min(Math.max(current + delta, 1), downbeats.length)
      view.current.startS = downbeats[target - 1] - 0.2
    },
    [chart.grid],
  )

  const focusNote = (id: number, t: number) => {
    session.pause()
    view.current.startS = t - 1
    dispatch({ type: 'select', ids: [id] })
  }

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.code === 'KeyZ') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.code === 'KeyY') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        dispatch({ type: 'delete' })
      } else if (e.code === 'Enter') {
        dispatch({ type: 'confirm' })
      } else if (e.code === 'Escape') {
        dispatch({ type: 'select', ids: [] })
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault()
        const steps = e.code === 'ArrowLeft' ? -1 : 1
        if (state.selection.length) dispatch({ type: 'move', steps })
        else jumpMeasure(steps)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, jumpMeasure, state.selection.length])

  // Avisar antes de cerrar la pestaña con cambios sin guardar
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function leave() {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Salir igual?')) return
    session.pause()
    onBack()
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      await useLibraryStore.getState().saveChart(songId, chartWithEdits(chart, state))
      setMessage({ tone: 'ok', text: 'Guardado. La próxima partida usa esta partitura.' })
    } catch (e) {
      setMessage({
        tone: 'error',
        text: `Se guardó en este equipo, pero no en la nube: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      // La copia local quedó guardada en los dos casos
      dispatch({ type: 'saved' })
      setSaving(false)
    }
  }

  const section = sections[sectionIndex]

  return (
    <main className="flex h-full flex-col gap-4 overflow-y-auto bg-bg p-8 font-sans text-fg select-none">
      <header className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <SectionLabel className="text-xs">Editar partitura · {chart.title}</SectionLabel>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em]">
            {review.length
              ? `${review.length} ${review.length === 1 ? 'nota' : 'notas'} por revisar`
              : 'Todo revisado'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!canUndo(state)} onClick={() => dispatch({ type: 'undo' })}>
            Deshacer
          </Button>
          <Button size="sm" disabled={!canRedo(state)} onClick={() => dispatch({ type: 'redo' })}>
            Rehacer
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button size="sm" onClick={leave}>
            ← Volver
          </Button>
        </div>
      </header>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={cn('text-sm', message.tone === 'error' ? 'text-miss' : 'text-perfect-fg')}
        >
          {message.text}
        </p>
      )}

      <section className="h-[300px] shrink-0 overflow-hidden rounded-xl bg-paper">
        <EditorCanvas
          notes={state.notes}
          selection={state.selection}
          grid={chart.grid}
          durationS={chart.durationS}
          clock={session.clock}
          view={view}
          onNoteClick={(id, additive) => dispatch({ type: 'select', ids: [id], additive })}
          onEmptyClick={(t, piece) => {
            if (tool === 'add') dispatch({ type: 'add', t, piece })
            else dispatch({ type: 'select', ids: [] })
          }}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" onClick={togglePlay}>
          {playing ? 'Pausar' : 'Reproducir'} <span className="text-xs opacity-70">(Espacio)</span>
        </Button>
        <Button size="sm" onClick={() => jumpMeasure(-1)}>
          ◀ Compás
        </Button>
        <Button size="sm" onClick={() => jumpMeasure(1)}>
          Compás ▶
        </Button>
        <SegmentedControl<Listen>
          aria-label="Escuchar"
          options={LISTEN_OPTIONS}
          value={listen}
          onChange={changeListen}
        />
        <span className="text-xs text-muted">
          Rueda del ratón para desplazarte · clic en una nota para elegirla, Mayús para sumar
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap gap-4">
        <Panel title="Edición" className="min-w-[420px] flex-1 gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl<Tool>
              aria-label="Herramienta"
              options={TOOL_OPTIONS}
              value={tool}
              onChange={setTool}
            />
            <label className="flex items-center gap-2 text-sm text-fg-2">
              Rejilla
              <select
                className={SELECT_CLASS}
                value={state.division}
                onChange={e =>
                  dispatch({ type: 'setDivision', division: Number(e.target.value) as Division })
                }
              >
                {DIVISIONS.map(d => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">
            {tool === 'add'
              ? 'Clic en el pentagrama agrega la pieza de esa altura, ajustada a la rejilla.'
              : 'Elige notas para cambiarlas. Las ámbar son las que la IA no tiene claras.'}
          </p>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="w-full text-sm font-semibold">
              {hasSelection
                ? `${selectedNotes.length} ${selectedNotes.length === 1 ? 'nota elegida' : 'notas elegidas'}`
                : 'Ninguna nota elegida'}
            </span>
            <select
              aria-label="Pieza"
              className={SELECT_CLASS}
              disabled={!hasSelection}
              value={selectedNotes[0]?.piece ?? ''}
              onChange={e => dispatch({ type: 'setPiece', piece: e.target.value as Piece })}
            >
              {!hasSelection && <option value="">Pieza…</option>}
              {PIECES.map(p => (
                <option key={p} value={p}>
                  {PIECE_LABELS[p]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!hasSelection}
              title="Una casilla antes (←)"
              onClick={() => dispatch({ type: 'move', steps: -1 })}
            >
              ←
            </Button>
            <Button
              size="sm"
              disabled={!hasSelection}
              title="Una casilla después (→)"
              onClick={() => dispatch({ type: 'move', steps: 1 })}
            >
              →
            </Button>
            <Button
              size="sm"
              disabled={!hasSelection}
              onClick={() => dispatch({ type: 'confirm' })}
            >
              Está bien (Enter)
            </Button>
            <Button size="sm" disabled={!hasSelection} onClick={() => dispatch({ type: 'delete' })}>
              Borrar (Supr)
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="w-full text-sm font-semibold">Recuantizar una sección</span>
            <select
              aria-label="Sección"
              className={SELECT_CLASS}
              value={sectionIndex}
              onChange={e => setSectionIndex(Number(e.target.value))}
            >
              {sections.map((s, i) => (
                <option key={`${s.name}-${s.startMeasure}`} value={i}>
                  {s.name} (c. {s.startMeasure}–{s.endMeasure})
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!section}
              onClick={() =>
                section &&
                dispatch({
                  type: 'requantize',
                  fromMeasure: section.startMeasure,
                  toMeasure: section.endMeasure,
                  division: state.division,
                })
              }
            >
              Ajustar a {DIVISIONS.find(d => d.value === state.division)?.label}
            </Button>
            <span className="w-full text-xs text-muted">
              Vuelve a colocar las notas desde lo que detectó la IA, con la rejilla elegida.
            </span>
          </div>
        </Panel>

        <Panel
          title={`Por revisar (${review.length})`}
          className="max-h-[420px] w-[340px] shrink-0 gap-2"
        >
          {review.length === 0 ? (
            <p className="text-sm text-muted">No quedan notas dudosas.</p>
          ) : (
            <>
              <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {review.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => focusNote(item.id, item.t)}
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2',
                        state.selection.includes(item.id) && 'bg-surface-2',
                      )}
                    >
                      <span>
                        <span className="font-mono text-xs text-muted">
                          c. {item.measure} · {Math.round(item.beat * 100) / 100}
                        </span>{' '}
                        {PIECE_LABELS[item.piece]}
                      </span>
                      <span className="font-mono text-xs text-close-fg">
                        {Math.round(item.confidence * 100)}% · {formatClock(item.t)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button size="sm" onClick={() => dispatch({ type: 'confirmAll' })}>
                Marcar todas como revisadas
              </Button>
            </>
          )}
        </Panel>
      </div>
    </main>
  )
}
