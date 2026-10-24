import type { ReactNode } from 'react'
import { cn } from './cn'

export interface ChipProps {
  children: ReactNode
  /** strong = etiqueta ("YouTube"); muted = dato ("silenciado · sincronizado +42 ms") */
  tone?: 'strong' | 'muted'
  className?: string
}

export function Chip({ children, tone = 'muted', className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[6px] bg-border px-[9px] py-[5px] text-[11px]',
        tone === 'strong' ? 'font-semibold text-fg' : 'text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}
