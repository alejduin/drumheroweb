import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { AccountPanel } from '@/ui/account/AccountPanel'

const requestCode = vi.fn(async () => {})
const confirmCode = vi.fn(async () => {})
const signOut = vi.fn(async () => {})

function setState(patch: Partial<ReturnType<typeof useAuthStore.getState>>) {
  useAuthStore.setState({
    status: 'ready',
    user: { id: 'anon', email: null },
    pending: null,
    busy: false,
    error: null,
    requestCode,
    confirmCode,
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
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    expect(requestCode).toHaveBeenCalledWith('link', 'yo@correo.com')

    fireEvent.click(screen.getByRole('button', { name: /Entrar con mi correo/ }))
    expect(screen.getByText(/dejarán de verse aquí/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    expect(requestCode).toHaveBeenLastCalledWith('signin', 'yo@correo.com')
  })

  it('pide el código enviado y muestra el error', () => {
    setState({ pending: { kind: 'link', email: 'yo@correo.com' }, error: 'El código no es válido' })
    render(<AccountPanel />)
    expect(screen.getByText('yo@correo.com')).toBeInTheDocument()
    expect(screen.getByText('El código no es válido')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(confirmCode).toHaveBeenCalledWith('123456')
  })

  it('con correo vinculado permite cerrar sesión', () => {
    setState({ user: { id: 'u', email: 'yo@correo.com' } })
    render(<AccountPanel />)
    expect(screen.getByText('yo@correo.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(signOut).toHaveBeenCalled()
  })
})
