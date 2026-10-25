import type { TrackerState } from '@/library/jobTracker'
import { lowConfidenceHint, piecesText, stageRows, trackerHeadline } from '@/library/importView'
import type { LibrarySong } from '@/storage/libraryDb'
import { Button, Panel, StatTile, StepRow } from '@/ui/primitives'

interface AnalysisPanelProps {
  song: LibrarySong | null
  tracker: TrackerState | null
  /** Nombre del archivo elegido antes de analizar. */
  pendingFileName: string | null
  playing: boolean
  onPlay: () => void
  onRetry: () => void
  onCancel: () => void
}

/** Panel derecho de Importar: etapas del análisis, resumen y acciones. */
export function AnalysisPanel({
  song,
  tracker,
  pendingFileName,
  playing,
  onPlay,
  onRetry,
  onCancel,
}: AnalysisPanelProps) {
  const fileName = song?.fileName ?? pendingFileName
  const status = song?.status
  const summary = song?.summary ?? tracker?.job?.summary ?? null
  const finished = status === 'ready' || status === 'needs_review'
  const failed = status === 'failed'
  const title = !song
    ? fileName
      ? `Listo para analizar ${fileName}`
      : 'Análisis'
    : finished
      ? `${fileName} analizada`
      : `Analizando ${fileName}`

  return (
    <Panel
      title={<span className="text-base">{title}</span>}
      aside={song && !finished && !failed ? 'te avisamos al terminar' : undefined}
      className="min-w-0 flex-1 gap-[18px] rounded-[16px] p-6"
    >
      <p aria-live="polite" className={failed ? 'text-sm text-miss' : 'text-xs text-muted'}>
        {song ? trackerHeadline(tracker ?? fallbackTracker(song)) : trackerHeadline(null)}
      </p>

      {stageRows(tracker).map((row, i) => (
        <StepRow
          key={row.id}
          index={i + 1}
          label={row.label}
          state={finished ? 'done' : row.state}
          progress={row.progress}
          statusText={row.statusText}
        />
      ))}

      <div className="mt-1.5 grid grid-cols-3 gap-3 border-t border-border pt-[18px]">
        <StatTile
          label="Tempo"
          value={summary ? `${Math.round(summary.bpm)} BPM` : '—'}
          hint={
            summary ? `${summary.timeSignature.join('/')} · editable` : 'se detecta al analizar'
          }
        />
        <StatTile
          label="Piezas"
          value={
            <span className="block font-sans text-[15px] leading-[1.35]">
              {summary ? piecesText(summary.pieces) : '—'}
            </span>
          }
        />
        <StatTile
          label="Por revisar"
          variant="close"
          value={summary ? `${summary.lowConfidenceCount} notas` : '—'}
          hint={summary ? lowConfidenceHint(summary) : 'notas de baja confianza'}
        />
      </div>

      <div className="flex-1" />

      {song && !finished && (
        <div className="flex gap-3">
          {failed ? (
            <Button variant="primary" className="flex-1" onClick={onRetry}>
              Reintentar
            </Button>
          ) : null}
          <Button className="flex-1" onClick={onCancel}>
            {failed ? 'Descartar' : 'Cancelar análisis'}
          </Button>
        </div>
      )}

      <div className="flex gap-3">
        {/* El editor y la sincronización del video llegan en la Fase C */}
        <Button className="flex-1" disabled title="Llega con el editor (Fase C)">
          Revisar en el editor
        </Button>
        <Button className="flex-1" disabled title="Llega con el video (Fase C)">
          Sincronizar video
        </Button>
        <Button
          variant="light"
          className="flex-1 font-extrabold"
          disabled={!finished || playing}
          onClick={onPlay}
        >
          {playing ? 'Cargando…' : 'Jugar ahora'}
        </Button>
      </div>
    </Panel>
  )
}

/** Tras recargar no hay tracker de un fallo: se muestra el error guardado. */
function fallbackTracker(song: LibrarySong): TrackerState {
  return {
    phase: song.status === 'failed' ? 'failed' : song.status === 'analyzing' ? 'analyzing' : 'done',
    jobId: song.jobId,
    job: null,
    cached: false,
    error: song.error as TrackerState['error'],
    networkFailures: 0,
  }
}
