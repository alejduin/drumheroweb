import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'light' | 'warning'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110',
  secondary: 'border border-border-strong bg-surface-2 text-fg hover:bg-track',
  light: 'bg-fg text-on-accent hover:brightness-95',
  warning: 'border border-close-fg bg-close-bg text-close-text hover:brightness-110',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-[34px] rounded-sm px-3 text-xs font-semibold',
  md: 'h-11 rounded-md px-4 text-sm font-bold',
  lg: 'h-12 rounded-[12px] px-5 text-[15px] font-extrabold',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 font-sans transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  )
}
