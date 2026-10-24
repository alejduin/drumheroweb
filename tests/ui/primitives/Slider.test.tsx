import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Slider, clampToStep } from '@/ui/primitives'

function setup(props: Partial<Parameters<typeof Slider>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <Slider
      aria-label="Tempo"
      min={50}
      max={120}
      step={5}
      value={100}
      onChange={onChange}
      {...props}
    />,
  )
  return { onChange, slider: screen.getByRole('slider', { name: 'Tempo' }) }
}

describe('Slider', () => {
  it('expone los atributos aria', () => {
    const { slider } = setup({ valueText: '100 %' })
    expect(slider).toHaveAttribute('aria-valuemin', '50')
    expect(slider).toHaveAttribute('aria-valuemax', '120')
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    expect(slider).toHaveAttribute('aria-valuetext', '100 %')
  })

  it('el teclado mueve por step, página y extremos', () => {
    const { slider, onChange } = setup()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    fireEvent.keyDown(slider, { key: 'PageUp' })
    fireEvent.keyDown(slider, { key: 'Home' })
    fireEvent.keyDown(slider, { key: 'End' })
    expect(onChange.mock.calls.map(c => c[0])).toEqual([105, 95, 120, 50, 120])
  })

  it('no emite si el valor no cambia ni si está deshabilitado', () => {
    const atMax = setup({ value: 120 })
    fireEvent.keyDown(atMax.slider, { key: 'ArrowUp' })
    expect(atMax.onChange).not.toHaveBeenCalled()
  })

  it('deshabilitado no responde ni es enfocable', () => {
    const { slider, onChange } = setup({ disabled: true })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
    expect(slider).toHaveAttribute('tabindex', '-1')
    expect(slider).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('clampToStep', () => {
  it('redondea al step y limita al rango sin errores de coma flotante', () => {
    expect(clampToStep(103, 50, 120, 5)).toBe(105)
    expect(clampToStep(200, 50, 120, 5)).toBe(120)
    expect(clampToStep(0.30000000000000004, 0, 1, 0.1)).toBe(0.3)
  })
})
