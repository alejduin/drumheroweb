import { cn } from './cn'

export type ProgressTone = 'accent' | 'perfect' | 'idle'

const TONES: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  perfect: 'bg-perfect-fg',
  idle: 'bg-border-strong',
}

export interface ProgressBarProps {
  /** 0–1 */
  value: number
  'aria-label': string
  tone?: ProgressTone
  className?: string
}

export function ProgressBar({
  value,
  tone = 'accent',
  className,
  'aria-label': ariaLabel,
}: ProgressBarProps) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('h-1 w-full rounded-[2px] bg-border', className)}
    >
      <div
        className={cn('h-full rounded-[2px] transition-[width]', TONES[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
