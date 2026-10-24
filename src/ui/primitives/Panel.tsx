import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Texto a la derecha del título ("precisión", "te avisamos al terminar"). */
  aside?: ReactNode
  as?: 'section' | 'aside' | 'div'
}

export function Panel({
  title,
  aside,
  as: Tag = 'section',
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <Tag
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-[18px]',
        className,
      )}
      {...props}
    >
      {(title || aside) && (
        <div className="flex items-baseline justify-between gap-3">
          {title && <span className="text-sm font-bold">{title}</span>}
          {aside && <span className="text-[11px] text-muted">{aside}</span>}
        </div>
      )}
      {children}
    </Tag>
  )
}
