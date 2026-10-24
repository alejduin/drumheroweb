import { cn } from './cn'
import { ProgressBar } from './ProgressBar'
import type { ProgressTone } from './ProgressBar'

export type StepState = 'done' | 'running' | 'pending' | 'failed'

const STATES: Record<StepState, { badge: string; tone: ProgressTone; status: string }> = {
  done: { badge: 'bg-perfect-bg text-perfect-fg', tone: 'perfect', status: 'listo' },
  running: { badge: 'bg-accent-soft text-accent', tone: 'accent', status: '' },
  pending: { badge: 'bg-surface-idle text-faint', tone: 'idle', status: 'en espera' },
  failed: { badge: 'bg-miss/15 text-miss', tone: 'idle', status: 'error' },
}

export interface StepRowProps {
  index: number
  label: string
  state: StepState
  /** 0–1, solo cuenta en running */
  progress?: number
  /** Sobrescribe el texto de estado (por defecto: listo / NN% / en espera / error) */
  statusText?: string
}

/** Etapa del análisis en Importar: círculo numerado + nombre + estado + barra. */
export function StepRow({ index, label, state, progress = 0, statusText }: StepRowProps) {
  const styles = STATES[state]
  const value = state === 'done' ? 1 : state === 'running' ? progress : 0
  const status =
    statusText ?? (state === 'running' ? `${Math.round(progress * 100)}%` : styles.status)
  return (
    <div className="flex items-center gap-3.5">
      <div
        aria-hidden="true"
        className={cn(
          'flex size-[30px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
          styles.badge,
        )}
      >
        {state === 'done' ? '✓' : state === 'failed' ? '!' : index}
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex justify-between text-sm">
          <span className="font-semibold">{label}</span>
          <span
            className={cn('font-mono text-xs', state === 'failed' ? 'text-miss' : 'text-muted')}
          >
            {status}
          </span>
        </div>
        <ProgressBar value={value} tone={styles.tone} aria-label={`${label}: ${status}`} />
      </div>
    </div>
  )
}
