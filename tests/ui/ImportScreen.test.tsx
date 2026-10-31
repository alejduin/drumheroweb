import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLibraryStore } from '@/store/libraryStore'
import { ImportScreen } from '@/ui/screens/ImportScreen'

// El worker y la biblioteca no se tocan en estos tests
const checkWorker = vi.fn(async () => 'online' as const)
useLibraryStore.setState({ checkWorker, loaded: true, workerStatus: 'online' })

afterEach(() => vi.clearAllMocks())

function setup() {
  render(<ImportScreen onPlay={vi.fn()} onBack={vi.fn()} onSyncVideo={vi.fn()} onEdit={vi.fn()} />)
  return {
    input: screen.getByTestId('audio-input') as HTMLInputElement,
    analyze: screen.getByRole('button', { name: 'Analizar con IA' }),
  }
}

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name)

describe('ImportScreen', () => {
  it('rechaza formatos no soportados', async () => {
    const { input, analyze } = setup()
    fireEvent.change(input, { target: { files: [file('notas.txt')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato no soportado')
    expect(analyze).toBeDisabled()
  })

  it('rechaza archivos vacíos', async () => {
    const { input } = setup()
    fireEvent.change(input, { target: { files: [file('vacio.mp3', 0)] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('vacío')
  })

  it('también valida lo que se arrastra', async () => {
    setup()
    const zone = screen.getByRole('button', { name: 'Elegir archivo de audio' })
    fireEvent.drop(zone, { dataTransfer: { files: [file('video.mkv')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato no soportado')
  })

  it('valida la URL de YouTube', async () => {
    setup()
    const field = screen.getByLabelText(/Video de YouTube/)
    fireEvent.change(field, { target: { value: 'https://vimeo.com/123' } })
    expect(screen.getByText('No parece un enlace a un video de YouTube.')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    await waitFor(() =>
      expect(screen.queryByText('No parece un enlace a un video de YouTube.')).toBeNull(),
    )
  })

  it('avisa si el worker no responde', () => {
    useLibraryStore.setState({ workerStatus: 'offline' })
    setup()
    expect(screen.getByRole('alert')).toHaveTextContent('docker compose up -d worker')
    useLibraryStore.setState({ workerStatus: 'online' })
  })
})
