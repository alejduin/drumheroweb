import type { ReactNode } from 'react'
import { cn } from './cn'

export type StatTileSize = 'compact' | 'md' | 'lg'
export type StatTone = 'default' | 'perfect' | 'close'

export interface StatTileProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  /** compact = HUD del header; md = Importar; lg = Resultados */
  size?: StatTileSize
  /** close = "POR REVISAR" (fondo ámbar) */
  variant?: 'default' | 'close'
  hintTone?: StatTone
  className?: string
}

const HINT_TONES: Record<StatTone, string> = {
  default: 'text-muted',
  perfect: 'text-perfect-fg',
  close: 'text-close-fg',
}

export function StatTile({
  label,
  value,
  hint,
  size = 'md',
  variant = 'default',
  hintTone = 'default',
  className,
}: StatTileProps) {
  const isClose = variant === 'close'
  return (
    <div
      className={cn(
        'flex flex-col',
        size === 'compact' && 'items-end',
        size === 'md' && 'gap-1 rounded-md p-3.5',
        size === 'md' && (isClose ? 'border border-close-border bg-close-bg' : 'bg-surface-2'),
        size === 'lg' && 'gap-1.5 rounded-lg border border-border bg-surface p-[18px]',
        className,
      )}
    >
      <span
        className={cn(
          'text-[11px] tracking-[0.08em] uppercase',
          isClose ? 'text-close-text' : 'text-muted',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono font-bold tabular-nums',
          size === 'lg' ? 'text-[30px]' : 'text-[22px]',
          isClose && 'text-close-text',
        )}
      >
        {value}
      </span>
      {hint && (
        <span className={cn('text-xs', isClose ? 'text-close-text' : HINT_TONES[hintTone])}>
          {hint}
        </span>
      )}
    </div>
  )
}
