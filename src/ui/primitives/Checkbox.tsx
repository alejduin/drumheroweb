import { useId } from 'react'
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  disabled?: boolean
  className?: string
}

/** Fila "texto ··· [x]" de los paneles de configuración (checkbox nativo con acento). */
export function Checkbox({ checked, onChange, label, disabled = false, className }: CheckboxProps) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 text-xs text-fg-2',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      {label}
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="size-[18px] cursor-pointer accent-accent disabled:cursor-not-allowed"
      />
    </label>
  )
}
