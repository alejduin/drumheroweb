import { describe, expect, it } from 'vitest'
import { AuthFailure } from '@/api/cloudAuth'
import type { AuthApi, AuthUser } from '@/api/cloudAuth'
import { createAuthStore } from '@/store/authStore'

class FakeAuth implements AuthApi {
  session: AuthUser | null = null
  calls: string[] = []
  failNext: Error | null = null
  private next = 0

  private step(name: string) {
    this.calls.push(name)
    const fail = this.failNext
    this.failNext = null
    if (fail) throw fail
  }

  async currentUser() {
    return this.session
  }
  async signInAnonymously() {
    this.step('anon')
    this.session = { id: `anon-${++this.next}`, email: null }
    return this.session
  }
  async requestLink(email: string) {
    this.step(`link:${email}`)
  }
  async confirmLink(email: string, code: string) {
    this.step(`confirm-link:${code}`)
    this.session = { id: this.session!.id, email }
    return this.session
  }
  async requestSignIn(email: string) {
    this.step(`signin:${email}`)
  }
  async confirmSignIn(email: string, code: string) {
    this.step(`confirm-signin:${code}`)
    this.session = { id: 'cuenta', email }
    return this.session
  }
  async signOut() {
    this.step('signout')
    this.session = null
  }
}

function setup(api: FakeAuth | null = new FakeAuth()) {
  const users: AuthUser[] = []
  const store = createAuthStore({
    api,
    onUser: async user => {
      users.push(user)
    },
  })
  return { store, api: api!, users }
}

describe('authStore', () => {
  it('sin Supabase queda apagado', async () => {
    const { store } = setup(null)
    await store.getState().init()
    expect(store.getState().status).toBe('off')
  })

  it('arranca con una cuenta anónima o retoma la guardada', async () => {
    const { store, api, users } = setup()
    await store.getState().init()
    expect(store.getState()).toMatchObject({ status: 'ready', user: { id: 'anon-1', email: null } })
    expect(users.map(u => u.id)).toEqual(['anon-1'])

    const again = setup(api)
    await again.store.getState().init()
    expect(again.store.getState().user?.id).toBe('anon-1')
    expect(api.calls).toEqual(['anon'])
  })

  it('vincula el correo con un código y conserva la cuenta', async () => {
    const { store, api, users } = setup()
    await store.getState().init()
    await store.getState().requestCode('link', '  Yo@Correo.com ')
    expect(store.getState().pending).toEqual({ kind: 'link', email: 'yo@correo.com' })
    await store.getState().confirmCode('123 456')
    expect(api.calls).toEqual(['anon', 'link:yo@correo.com', 'confirm-link:123456'])
    expect(store.getState()).toMatchObject({
      pending: null,
      user: { id: 'anon-1', email: 'yo@correo.com' },
    })
    expect(users.map(u => u.id)).toEqual(['anon-1', 'anon-1'])
  })

  it('entra en otro equipo con la cuenta del correo', async () => {
    const { store, users } = setup()
    await store.getState().init()
    await store.getState().requestCode('signin', 'yo@correo.com')
    await store.getState().confirmCode('654321')
    expect(store.getState().user).toEqual({ id: 'cuenta', email: 'yo@correo.com' })
    expect(users.at(-1)?.id).toBe('cuenta')
  })

  it('valida correo y código antes de llamar a la nube', async () => {
    const { store, api } = setup()
    await store.getState().init()
    await store.getState().requestCode('link', 'no-es-correo')
    expect(store.getState().error).toMatch(/correo/)
    await store.getState().requestCode('link', 'yo@correo.com')
    await store.getState().confirmCode('12')
    expect(store.getState().error).toBe('El código tiene 6 dígitos.')
    expect(api.calls).toEqual(['anon', 'link:yo@correo.com'])
  })

  it('muestra el error de la nube y permite reintentar', async () => {
    const { store, api } = setup()
    await store.getState().init()
    await store.getState().requestCode('link', 'yo@correo.com')
    api.failNext = new AuthFailure('El código no es válido o ya venció. Pide uno nuevo.')
    await store.getState().confirmCode('000000')
    expect(store.getState()).toMatchObject({
      busy: false,
      pending: { kind: 'link' },
      error: 'El código no es válido o ya venció. Pide uno nuevo.',
    })
    store.getState().cancelCode()
    expect(store.getState()).toMatchObject({ pending: null, error: null })
  })

  it('sin red al arrancar queda en error y se reintenta', async () => {
    const { store, api } = setup()
    api.failNext = new TypeError('Failed to fetch')
    await store.getState().init()
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toMatch(/Sin conexión/)
    await store.getState().init()
    expect(store.getState().status).toBe('ready')
  })

  it('cerrar sesión sigue con una cuenta anónima nueva', async () => {
    const { store, users } = setup()
    await store.getState().init()
    await store.getState().requestCode('signin', 'yo@correo.com')
    await store.getState().confirmCode('111111')
    await store.getState().signOut()
    expect(store.getState().user).toEqual({ id: 'anon-2', email: null })
    expect(users.map(u => u.id)).toEqual(['anon-1', 'cuenta', 'anon-2'])
  })
})
