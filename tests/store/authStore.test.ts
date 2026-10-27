import { describe, expect, it } from 'vitest'
import { AuthFailure } from '@/api/cloudAuth'
import type { AuthApi, AuthUser } from '@/api/cloudAuth'
import { createAuthStore } from '@/store/authStore'

class FakeAuth implements AuthApi {
  session: AuthUser | null = null
  /** Error del enlace con el que se abrió la página. */
  linkError: string | null = null
  calls: string[] = []
  failNext: Error | null = null
  private next = 0
  private listeners: Array<(user: AuthUser | null) => void> = []

  private step(name: string) {
    this.calls.push(name)
    const fail = this.failNext
    this.failNext = null
    if (fail) throw fail
  }

  async currentUser() {
    return { user: this.session, error: this.linkError }
  }
  async signInAnonymously() {
    this.step('anon')
    this.session = { id: `anon-${++this.next}`, email: null }
    return this.session
  }
  async requestLink(email: string) {
    this.step(`link:${email}`)
  }
  async requestSignIn(email: string) {
    this.step(`signin:${email}`)
  }
  async signOut() {
    this.step('signout')
    this.session = null
  }
  onUserChange(listener: (user: AuthUser | null) => void) {
    this.listeners.push(listener)
    return () => {}
  }
  /** Se abrió el enlace del correo (en esta u otra pestaña). */
  emit(user: AuthUser | null) {
    this.session = user
    for (const listener of this.listeners) listener(user)
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

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

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

  it('vincular: envía el enlace y toma la sesión cuando se abre', async () => {
    const { store, api, users } = setup()
    await store.getState().init()
    await store.getState().requestLink('link', '  Yo@Correo.com ')
    expect(api.calls).toEqual(['anon', 'link:yo@correo.com'])
    expect(store.getState().pending).toEqual({ kind: 'link', email: 'yo@correo.com' })

    api.emit({ id: 'anon-1', email: 'yo@correo.com' })
    await flush()
    expect(store.getState()).toMatchObject({
      pending: null,
      user: { id: 'anon-1', email: 'yo@correo.com' },
    })
    expect(users.map(u => u.id)).toEqual(['anon-1', 'anon-1'])
  })

  it('entrar desde otro equipo cambia de cuenta y sincroniza', async () => {
    const { store, api, users } = setup()
    await store.getState().init()
    await store.getState().requestLink('signin', 'yo@correo.com')
    expect(api.calls).toContain('signin:yo@correo.com')
    api.emit({ id: 'cuenta', email: 'yo@correo.com' })
    await flush()
    expect(store.getState().user).toEqual({ id: 'cuenta', email: 'yo@correo.com' })
    expect(users.at(-1)?.id).toBe('cuenta')
  })

  it('la página abierta desde el enlace ya trae la sesión', async () => {
    const api = new FakeAuth()
    api.session = { id: 'cuenta', email: 'yo@correo.com' }
    const { store, users } = setup(api)
    await store.getState().init()
    expect(store.getState().user?.email).toBe('yo@correo.com')
    expect(api.calls).toEqual([])
    expect(users.map(u => u.id)).toEqual(['cuenta'])
  })

  it('un enlace vencido sigue con la cuenta guardada y lo avisa', async () => {
    const api = new FakeAuth()
    api.session = { id: 'anon-9', email: null }
    api.linkError = 'El enlace ya venció o ya se usó. Pide uno nuevo.'
    const { store } = setup(api)
    await store.getState().init()
    expect(store.getState()).toMatchObject({
      status: 'ready',
      user: { id: 'anon-9' },
      error: 'El enlace ya venció o ya se usó. Pide uno nuevo.',
    })
  })

  it('ignora renovaciones del mismo usuario', async () => {
    const { store, api, users } = setup()
    await store.getState().init()
    api.emit({ id: 'anon-1', email: null })
    api.emit(null)
    await flush()
    expect(users).toHaveLength(1)
    expect(store.getState().user?.id).toBe('anon-1')
  })

  it('valida el correo antes de llamar a la nube', async () => {
    const { store, api } = setup()
    await store.getState().init()
    await store.getState().requestLink('link', 'no-es-correo')
    expect(store.getState().error).toMatch(/correo/)
    expect(api.calls).toEqual(['anon'])
  })

  it('muestra el error de la nube y permite otro correo', async () => {
    const { store, api } = setup()
    await store.getState().init()
    api.failNext = new AuthFailure('Se enviaron demasiados correos.')
    await store.getState().requestLink('link', 'yo@correo.com')
    expect(store.getState()).toMatchObject({
      busy: false,
      pending: null,
      error: 'Se enviaron demasiados correos.',
    })
    await store.getState().requestLink('link', 'yo@correo.com')
    store.getState().cancelLink()
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
    const { store, api, users } = setup()
    await store.getState().init()
    api.emit({ id: 'cuenta', email: 'yo@correo.com' })
    await flush()
    await store.getState().signOut()
    expect(store.getState().user).toEqual({ id: 'anon-2', email: null })
    expect(users.map(u => u.id)).toEqual(['anon-1', 'cuenta', 'anon-2'])
  })
})
