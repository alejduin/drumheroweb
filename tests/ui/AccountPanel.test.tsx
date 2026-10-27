import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { AccountPanel } from '@/ui/account/AccountPanel'

const requestLink = vi.fn(async () => {})
const cancelLink = vi.fn()
const signOut = vi.fn(async () => {})

function setState(patch: Partial<ReturnType<typeof useAuthStore.getState>>) {
  useAuthStore.setState({
    status: 'ready',
    user: { id: 'anon', email: null },
    pending: null,
    busy: false,
    error: null,
    requestLink,
    cancelLink,
    signOut,
    ...patch,
  })
}

afterEach(() => vi.clearAllMocks())

describe('AccountPanel', () => {
  it('no se muestra en modo local', () => {
    setState({ status: 'off' })
    const { container } = render(<AccountPanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('cuenta anónima: vincular o entrar con el correo', () => {
    setState({})
    render(<AccountPanel />)
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'yo@correo.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme un enlace' }))
    expect(requestLink).toHaveBeenCalledWith('link', 'yo@correo.com')

    fireEvent.click(screen.getByRole('button', { name: /Entrar con mi correo/ }))
    expect(screen.getByText(/dejarán de verse aquí/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme un enlace' }))
    expect(requestLink).toHaveBeenLastCalledWith('signin', 'yo@correo.com')
  })

  it('espera el enlace y permite reenviarlo', () => {
    setState({ pending: { kind: 'signin', email: 'yo@correo.com' }, error: 'Demasiados correos' })
    render(<AccountPanel />)
    expect(screen.getByText('yo@correo.com')).toBeInTheDocument()
    expect(screen.getByText(/en este equipo y este navegador/)).toBeInTheDocument()
    expect(screen.getByText('Demasiados correos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }))
    expect(requestLink).toHaveBeenCalledWith('signin', 'yo@correo.com')
    fireEvent.click(screen.getByRole('button', { name: 'Usar otro correo' }))
    expect(cancelLink).toHaveBeenCalled()
  })

  it('con correo vinculado permite cerrar sesión', () => {
    setState({ user: { id: 'u', email: 'yo@correo.com' } })
    render(<AccountPanel />)
    expect(screen.getByText('yo@correo.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(signOut).toHaveBeenCalled()
  })
})
