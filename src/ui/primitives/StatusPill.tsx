import type { ReactNode } from 'react'
import { cn } from './cn'

export type StatusTone = 'perfect' | 'close' | 'miss' | 'neutral'

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  perfect: { pill: 'border-perfect-border bg-perfect-bg text-perfect-text', dot: 'bg-perfect-fg' },
  close: { pill: 'border-close-border bg-close-bg text-close-text', dot: 'bg-close-fg' },
  miss: { pill: 'border-miss/40 bg-miss/10 text-fg-2', dot: 'bg-miss' },
  neutral: { pill: 'border-border-strong bg-surface-2 text-muted', dot: 'bg-faint' },
}

export interface StatusPillProps {
  children: ReactNode
  tone?: StatusTone
  className?: string
}

/** Píldora con punto de estado ("TD-02KV conectado"). */
export function StatusPill({ children, tone = 'neutral', className }: StatusPillProps) {
  const styles = TONES[tone]
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs',
        styles.pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', styles.dot)} />
      {children}
    </span>
  )
}
