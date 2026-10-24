import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox, ProgressBar, Stars, StepRow } from '@/ui/primitives'

describe('Checkbox', () => {
  it('la etiqueta está asociada y alterna el valor', () => {
    const onChange = vi.fn()
    render(<Checkbox label="Metrónomo" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByText('Metrónomo'))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('checkbox', { name: 'Metrónomo' })).not.toBeChecked()
  })

  it('deshabilitado no cambia', async () => {
    const onChange = vi.fn()
    render(<Checkbox label="Metrónomo" checked onChange={onChange} disabled />)
    const checkbox = screen.getByRole('checkbox', { name: 'Metrónomo' })
    expect(checkbox).toBeDisabled()
    await userEvent.click(checkbox)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('indicadores', () => {
  it('ProgressBar limita a 0–100', () => {
    render(<ProgressBar aria-label="p" value={1.7} />)
    expect(screen.getByRole('progressbar', { name: 'p' })).toHaveAttribute('aria-valuenow', '100')
  })

  it('StepRow muestra el porcentaje en curso y el estado en las demás', () => {
    render(
      <>
        <StepRow index={1} label="Separar" state="done" />
        <StepRow index={2} label="Transcribir" state="running" progress={0.42} />
        <StepRow index={3} label="Tempo" state="pending" />
      </>,
    )
    expect(screen.getByText('listo')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Transcribir: 42%' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
    expect(screen.getByText('en espera')).toBeInTheDocument()
  })

  it('Stars redondea y limita', () => {
    render(<Stars value={7} />)
    expect(screen.getByRole('img', { name: '5 de 5 estrellas' })).toBeInTheDocument()
  })
})
