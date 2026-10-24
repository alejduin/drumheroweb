import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecordReferenceScreen } from '@/ui/screens/dev/RecordReferenceScreen'

describe('RecordReferenceScreen', () => {
  it('sin MIDI ni audio muestra la carga de archivo y el aviso de dispositivo', () => {
    render(<RecordReferenceScreen />)
    expect(screen.getByRole('heading', { name: 'Grabar referencia' })).toBeInTheDocument()
    expect(screen.getByLabelText('Audio')).toBeInTheDocument()
    expect(screen.getByText('sin dispositivo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reproducir/ })).not.toBeInTheDocument()
  })
})
