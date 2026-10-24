import { cn } from './cn'

export const MAX_STARS = 5
const STAR_PATH = 'M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18.3 5.5 22l1.7-7.4-5.7-5 7.5-.7z'

export interface StarsProps {
  /** 0–5 (se redondea) */
  value: number
  size?: number
  className?: string
}

export function Stars({ value, size = 34, className }: StarsProps) {
  const filled = Math.round(Math.min(Math.max(value, 0), MAX_STARS))
  return (
    <div
      role="img"
      aria-label={`${filled} de ${MAX_STARS} estrellas`}
      className={cn('flex gap-1.5', className)}
    >
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <path d={STAR_PATH} className={i < filled ? 'fill-close-fg' : 'fill-border-strong'} />
        </svg>
      ))}
    </div>
  )
}
