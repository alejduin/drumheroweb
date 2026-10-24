import { cn } from './cn'

export type LegendColor = 'perfect' | 'close' | 'miss' | 'wrong' | 'accent'

const SWATCHES: Record<LegendColor, string> = {
  perfect: 'bg-perfect',
  close: 'bg-close',
  miss: 'bg-miss',
  wrong: 'bg-wrong',
  accent: 'bg-accent',
}

export interface LegendItem {
  label: string
  color: LegendColor
}

export interface LegendProps {
  items: readonly LegendItem[]
  /** paper = sobre la partitura */
  variant?: 'dark' | 'paper'
  className?: string
}

export function Legend({ items, variant = 'dark', className }: LegendProps) {
  return (
    <ul
      className={cn(
        'flex flex-wrap gap-x-5 gap-y-1 text-xs',
        variant === 'paper' ? 'text-paper-muted' : 'text-fg',
        className,
      )}
    >
      {items.map(item => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-2.5 rounded-[3px]', SWATCHES[item.color])} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
