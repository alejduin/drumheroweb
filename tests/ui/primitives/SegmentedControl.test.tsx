import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from '@/ui/primitives'

const OPTIONS = [
  { value: 'basic', label: 'Básico' },
  { value: 'intermediate', label: 'Intermedio', disabled: true },
  { value: 'full', label: 'Completo' },
]

function setup(value = 'basic') {
  const onChange = vi.fn()
  render(
    <SegmentedControl
      aria-label="Dificultad"
      options={OPTIONS}
      value={value}
      onChange={onChange}
    />,
  )
  return { onChange }
}

describe('SegmentedControl', () => {
  it('es un radiogroup con una opción marcada y solo ella en el orden de tabulación', () => {
    setup()
    expect(screen.getByRole('radiogroup', { name: 'Dificultad' })).toBeInTheDocument()
    const basic = screen.getByRole('radio', { name: 'Básico' })
    const full = screen.getByRole('radio', { name: 'Completo' })
    expect(basic).toHaveAttribute('aria-checked', 'true')
    expect(basic).toHaveAttribute('tabindex', '0')
    expect(full).toHaveAttribute('tabindex', '-1')
  })

  it('el clic selecciona; las deshabilitadas no', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Completo' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Intermedio' }))
    expect(onChange.mock.calls).toEqual([['full']])
  })

  it('las flechas saltan las deshabilitadas y dan la vuelta', () => {
    const { onChange } = setup()
    const basic = screen.getByRole('radio', { name: 'Básico' })
    fireEvent.keyDown(basic, { key: 'ArrowRight' })
    fireEvent.keyDown(basic, { key: 'ArrowLeft' })
    fireEvent.keyDown(basic, { key: 'End' })
    expect(onChange.mock.calls.map(c => c[0])).toEqual(['full', 'full', 'full'])
    expect(screen.getByRole('radio', { name: 'Completo' })).toHaveFocus()
  })
})
