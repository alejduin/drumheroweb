import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/** Etiqueta de sección: "DIFICULTAD", "MEZCLADOR", "PUNTOS"… */
export function SectionLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('text-[11px] tracking-[0.08em] text-muted uppercase', className)}
      {...props}
    />
  )
}
