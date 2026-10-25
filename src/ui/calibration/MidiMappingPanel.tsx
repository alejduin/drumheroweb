import { useEffect, useState } from 'react'
import { PIECES } from '@/types'
import type { Piece } from '@/types'
import { MIDI_DRUM_CHANNEL } from '@/constants/midi'
import {
  PIECE_HINTS,
  PIECE_LABELS,
  assignNote,
  notesByPiece,
  removeNote,
} from '@/calibration/midiMapping'
import { midiManager } from '@/midi/MidiManager'
import type { MidiNoteOn } from '@/midi/MidiManager'
import { DEFAULT_MIDI_MAP } from '@/midi/midiMap'
import { useSettingsStore } from '@/store/settingsStore'
import { Button, cn, Panel } from '@/ui/primitives'

/** Mapeo nota MIDI → pieza: "Asignar" y golpear el pad. Se guarda al instante. */
export function MidiMappingPanel() {
  const midiMap = useSettingsStore(s => s.midiMap)
  const setMidiMap = useSettingsStore(s => s.setMidiMap)
  const [listening, setListening] = useState<Piece | null>(null)
  const [last, setLast] = useState<MidiNoteOn | null>(null)

  // Último golpe (cualquier canal): sirve para comprobar el mapa pad por pad
  useEffect(() => midiManager.onNoteOn(setLast), [])

  useEffect(() => {
    if (!listening) return
    return midiManager.onNoteOn(({ note }) => {
      setMidiMap(assignNote(useSettingsStore.getState().midiMap, note, listening))
      setListening(null)
    })
  }, [listening, setMidiMap])

  const byPiece = notesByPiece(midiMap)
  const lastPiece = last ? midiMap[last.note] : undefined

  return (
    <Panel
      title="Mapeo MIDI"
      aside={
        <button
          type="button"
          className="cursor-pointer text-muted underline-offset-2 hover:text-fg hover:underline"
          onClick={() => setMidiMap({ ...DEFAULT_MIDI_MAP })}
        >
          Restablecer (TD-02KV)
        </button>
      }
    >
      <div
        className="rounded-md border border-border bg-surface-inset px-3.5 py-2.5 text-sm"
        aria-live="polite"
      >
        {last ? (
          <>
            <span className="text-muted">Último golpe: </span>
            <span className="font-mono text-fg">nota {last.note}</span>
            <span className="text-muted"> · vel {last.velocity} → </span>
            <span className={lastPiece ? 'font-semibold text-fg' : 'text-close-text'}>
              {lastPiece ? PIECE_LABELS[lastPiece] : 'sin asignar'}
            </span>
            {last.channel !== MIDI_DRUM_CHANNEL && (
              <p className="mt-1 text-xs text-close-text">
                Llega por el canal {last.channel + 1}: el juego solo lee el canal{' '}
                {MIDI_DRUM_CHANNEL + 1}. Cámbialo en el módulo.
              </p>
            )}
          </>
        ) : (
          <span className="text-muted">Golpea un pad para ver qué nota envía.</span>
        )}
      </div>

      <ul className="flex flex-col">
        {PIECES.map(piece => {
          const active = listening === piece
          const hit = lastPiece === piece
          return (
            <li
              key={piece}
              className={cn(
                'flex items-center gap-3 border-b border-border py-2 last:border-b-0',
                active && 'bg-accent-soft',
              )}
            >
              <div className="min-w-0 flex-1">
                <span className={cn('text-sm', hit ? 'font-bold text-fg' : 'text-fg-2')}>
                  {PIECE_LABELS[piece]}
                </span>
                {PIECE_HINTS[piece] && (
                  <span className="ml-2 text-xs text-faint">{PIECE_HINTS[piece]}</span>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {byPiece[piece].length === 0 && <span className="text-xs text-faint">—</span>}
                {byPiece[piece].map(note => (
                  <span
                    key={note}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-[6px] bg-border py-[3px] pr-1 pl-2 font-mono text-[11px]',
                      last?.note === note ? 'text-accent' : 'text-muted',
                    )}
                  >
                    {note}
                    <button
                      type="button"
                      aria-label={`Quitar nota ${note} de ${PIECE_LABELS[piece]}`}
                      className="cursor-pointer rounded px-1 text-faint hover:text-fg"
                      onClick={() => setMidiMap(removeNote(midiMap, note))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                variant={active ? 'primary' : 'secondary'}
                className="w-[118px]"
                onClick={() => setListening(active ? null : piece)}
              >
                {active ? 'Golpea el pad…' : 'Asignar'}
              </Button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
