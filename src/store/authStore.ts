import { create } from 'zustand'
import { AuthFailure, createAuthApi } from '@/api/cloudAuth'
import type { AuthApi, AuthUser } from '@/api/cloudAuth'
import { supabase } from '@/api/supabase'
import { useLibraryStore } from '@/store/libraryStore'

// ─── Cuenta en la nube (PLAN_V2 B12) ─────────────────────────────────────────

export type AuthStatus = 'off' | 'connecting' | 'ready' | 'error'

/** Enlace enviado: falta abrirlo desde el correo en este equipo. */
export interface PendingLink {
  kind: 'link' | 'signin'
  email: string
}

export interface AuthState {
  /** off = modo local (sin Supabase configurado). */
  status: AuthStatus
  user: AuthUser | null
  pending: PendingLink | null
  busy: boolean
  error: string | null

  /** Retoma la sesión (guardada o del enlace) o crea una cuenta anónima. */
  init(): Promise<void>
  /** Envía el enlace por correo: vincular esta cuenta o entrar con otra. */
  requestLink(kind: PendingLink['kind'], email: string): Promise<void>
  cancelLink(): void
  signOut(): Promise<void>
}

export interface AuthDeps {
  api: AuthApi | null
  /** Cambió el usuario: la biblioteca se vuelve a sincronizar. */
  onUser: (user: AuthUser) => Promise<void>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const messageOf = (error: unknown) =>
  error instanceof AuthFailure
    ? error.message
    : 'Sin conexión con la nube. Revisa tu red y vuelve a intentarlo.'

export function createAuthStore({ api, onUser }: AuthDeps) {
  return create<AuthState>()((set, get) => {
    /** Ejecuta una acción con `busy` y deja el error a la vista. */
    async function run(action: () => Promise<void>) {
      set({ busy: true, error: null })
      try {
        await action()
      } catch (error) {
        set({ error: messageOf(error) })
      } finally {
        set({ busy: false })
      }
    }

    async function become(user: AuthUser) {
      set({ user, status: 'ready', pending: null })
      subscribe()
      // Sin red la biblioteca local sigue sirviendo; se reintenta al volver
      await onUser(user).catch(() => {})
    }

    let subscribed = false
    /** El enlace se abre en otra pestaña: la sesión llega por aquí. */
    function subscribe() {
      if (subscribed || !api) return
      subscribed = true
      api.onUserChange(user => {
        const current = get().user
        if (!user || (current && current.id === user.id && current.email === user.email)) return
        void become(user)
      })
    }

    return {
      status: api ? 'connecting' : 'off',
      user: null,
      pending: null,
      busy: false,
      error: null,

      async init() {
        if (!api || get().user || get().busy) return
        set({ status: 'connecting', busy: true, error: null })
        try {
          const { user, error } = await api.currentUser()
          await become(user ?? (await api.signInAnonymously()))
          if (error) set({ error })
        } catch (error) {
          set({ status: 'error', error: messageOf(error) })
        } finally {
          set({ busy: false })
        }
      },

      requestLink(kind, email) {
        const clean = email.trim().toLowerCase()
        if (!EMAIL_RE.test(clean)) {
          set({ error: 'Revisa el correo: no parece válido.' })
          return Promise.resolve()
        }
        return run(async () => {
          if (!api) return
          await (kind === 'link' ? api.requestLink(clean) : api.requestSignIn(clean))
          set({ pending: { kind, email: clean } })
        })
      },

      cancelLink() {
        set({ pending: null, error: null })
      },

      signOut() {
        return run(async () => {
          if (!api) return
          await api.signOut()
          // Sigue jugando con una cuenta anónima nueva; las canciones de la
          // cuenta anterior salen de este navegador en la siguiente sync
          set({ user: null })
          await become(await api.signInAnonymously())
        })
      },
    }
  })
}

const sb = supabase()

export const useAuthStore = createAuthStore({
  api: sb ? createAuthApi(sb) : null,
  onUser: () => useLibraryStore.getState().sync(),
})
