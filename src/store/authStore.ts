import { create } from 'zustand'
import { AuthFailure, createAuthApi } from '@/api/cloudAuth'
import type { AuthApi, AuthUser } from '@/api/cloudAuth'
import { supabase } from '@/api/supabase'
import { useLibraryStore } from '@/store/libraryStore'

// ─── Cuenta en la nube (PLAN_V2 B12) ─────────────────────────────────────────

export type AuthStatus = 'off' | 'connecting' | 'ready' | 'error'

/** Código pedido y a la espera de que la persona lo escriba. */
export interface PendingCode {
  kind: 'link' | 'signin'
  email: string
}

export interface AuthState {
  /** off = modo local (sin Supabase configurado). */
  status: AuthStatus
  user: AuthUser | null
  pending: PendingCode | null
  busy: boolean
  error: string | null

  /** Retoma la sesión guardada o crea una cuenta anónima. */
  init(): Promise<void>
  requestCode(kind: PendingCode['kind'], email: string): Promise<void>
  confirmCode(code: string): Promise<void>
  cancelCode(): void
  signOut(): Promise<void>
}

export interface AuthDeps {
  api: AuthApi | null
  /** Cambió el usuario: la biblioteca se vuelve a sincronizar. */
  onUser: (user: AuthUser) => Promise<void>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_RE = /^\d{6}$/

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
      // Sin red la biblioteca local sigue sirviendo; se reintenta al volver
      await onUser(user).catch(() => {})
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
          await become((await api.currentUser()) ?? (await api.signInAnonymously()))
        } catch (error) {
          set({ status: 'error', error: messageOf(error) })
        } finally {
          set({ busy: false })
        }
      },

      requestCode(kind, email) {
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

      confirmCode(code) {
        const pending = get().pending
        const clean = code.replace(/\s+/g, '')
        if (!pending || !api) return Promise.resolve()
        if (!CODE_RE.test(clean)) {
          set({ error: 'El código tiene 6 dígitos.' })
          return Promise.resolve()
        }
        return run(async () => {
          const user =
            pending.kind === 'link'
              ? await api.confirmLink(pending.email, clean)
              : await api.confirmSignIn(pending.email, clean)
          await become(user)
        })
      },

      cancelCode() {
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
