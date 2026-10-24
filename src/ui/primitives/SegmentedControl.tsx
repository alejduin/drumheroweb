import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { cn } from './cn'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  /** dark = paneles de la UI; paper = sobre la partitura */
  variant?: 'dark' | 'paper'
  fullWidth?: boolean
  className?: string
}

const STYLES = {
  dark: {
    group: 'rounded-md bg-surface-inset',
    item: 'h-8 text-muted',
    active: 'bg-track text-fg',
  },
  paper: {
    group: 'rounded-md bg-paper-chip',
    item: 'h-[30px] text-paper-muted',
    active: 'bg-paper-active text-on-accent',
  },
} as const

/**
 * Grupo de opciones excluyentes (role="radiogroup").
 * Teclado: flechas mueven la selección saltando las deshabilitadas; Inicio/Fin.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = 'dark',
  fullWidth = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const styles = STYLES[variant]
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0)

  function select(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    refs.current[index]?.focus()
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    const pos = enabled.indexOf(index)
    let target: number | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      target = enabled[(pos + 1) % enabled.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      target = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') target = enabled[0]
    else if (e.key === 'End') target = enabled[enabled.length - 1]
    if (target === undefined) return
    e.preventDefault()
    select(target)
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex gap-1 p-1', styles.group, fullWidth ? 'w-full' : 'w-fit', className)}
    >
      {options.map((option, i) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={el => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={e => onKeyDown(e, i)}
            className={cn(
              'cursor-pointer rounded-[7px] px-3 font-sans text-xs font-semibold transition',
              'focus-visible:outline-2 focus-visible:outline-accent',
              'disabled:cursor-not-allowed disabled:opacity-40',
              styles.item,
              checked && styles.active,
              fullWidth && 'flex-1',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
