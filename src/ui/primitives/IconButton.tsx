import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type IconButtonVariant = 'square' | 'round' | 'ghost'

const VARIANTS: Record<IconButtonVariant, string> = {
  // Pausa del header
  square: 'size-10 rounded-md border border-border-strong bg-surface-2 text-fg hover:bg-track',
  // Play/pausa del transporte
  round: 'size-11 rounded-full bg-fg text-on-accent hover:brightness-95',
  // Cerrar / ocultar (video)
  ghost: 'size-8 rounded-sm border border-border-strong bg-surface-2 text-muted hover:text-fg',
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Obligatorio: el botón solo tiene un icono. */
  'aria-label': string
  variant?: IconButtonVariant
}

export function IconButton({
  variant = 'square',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
