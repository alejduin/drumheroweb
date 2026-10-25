import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/ui/primitives'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: ReactNode
  help?: ReactNode
  error?: string | null
}

/** Campo de texto de Importar (etiqueta + input + ayuda o error). */
export function TextField({ id, label, help, error, className, ...props }: TextFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-[42px] rounded-[10px] border bg-surface px-3 font-sans text-sm text-fg placeholder:text-faint',
          'focus-visible:border-accent focus-visible:outline-none',
          error ? 'border-miss/60' : 'border-border-strong',
        )}
        {...props}
      />
      {error ? (
        <span className="text-xs text-miss">{error}</span>
      ) : (
        help && <span className="text-xs text-muted">{help}</span>
      )}
    </div>
  )
}
