import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clampToStep } from './clampToStep'
import { cn } from './cn'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  'aria-label': string
  min?: number
  max?: number
  step?: number
  /** Texto para lectores de pantalla ("75 %", "+42 ms"). */
  valueText?: string
  /** accent = tempo; light = mezclador */
  tone?: 'accent' | 'light'
  disabled?: boolean
  className?: string
}

const PAGE_STEPS = 10

/**
 * Deslizador accesible (role="slider"). Teclado: flechas ±step, RePág/AvPág ±10 steps,
 * Inicio/Fin. Puntero: clic o arrastre sobre la pista.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  valueText,
  tone = 'accent',
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const fraction = max > min ? (Math.min(Math.max(value, min), max) - min) / (max - min) : 0

  function emit(next: number) {
    const clamped = clampToStep(next, min, max, step)
    if (clamped !== value) onChange(clamped)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (disabled) return
    const deltas: Record<string, number> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: step * PAGE_STEPS,
      PageDown: -step * PAGE_STEPS,
    }
    if (e.key in deltas) emit(value + deltas[e.key])
    else if (e.key === 'Home') emit(min)
    else if (e.key === 'End') emit(max)
    else return
    e.preventDefault()
  }

  function fromPointer(e: PointerEvent) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    emit(min + ((e.clientX - rect.left) / rect.width) * (max - min))
  }

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      onPointerDown={e => {
        if (disabled) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        fromPointer(e)
      }}
      onPointerMove={e => {
        if (!disabled && e.currentTarget.hasPointerCapture?.(e.pointerId)) fromPointer(e)
      }}
      className={cn(
        'group relative flex h-4 w-full cursor-pointer touch-none items-center rounded-full',
        'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <div ref={trackRef} className="relative h-1.5 w-full rounded-full bg-track">
        <div
          className={cn('h-full rounded-full', tone === 'accent' ? 'bg-accent' : 'bg-fg')}
          style={{ width: `${fraction * 100}%` }}
        />
        <div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>
    </div>
  )
}
