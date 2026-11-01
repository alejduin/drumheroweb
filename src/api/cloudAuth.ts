import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js'

// ─── Sesión en Supabase (PLAN_V2 B12) ────────────────────────────────────────
// Cada navegador arranca con una cuenta anónima. Para abrir la biblioteca en
// otro equipo se vincula un correo y allí se entra con un enlace por correo
// (plantillas por defecto de Supabase: sin SMTP propio). El enlace vuelve a la
// app con la sesión en el #hash. Sin contraseñas.

export interface AuthUser {
  id: string
  /** null mientras la cuenta es anónima. */
  email: string | null
}

export interface AuthApi {
  /**
   * Sesión de este navegador (la guardada o la que trajo el enlace del correo).
   * `error`: el enlace venció o ya se usó.
   */
  currentUser(): Promise<{ user: AuthUser | null; error: string | null }>
  signInAnonymously(): Promise<AuthUser>
  /** Envía un enlace para vincular el correo a la cuenta actual. */
  requestLink(email: string): Promise<void>
  /** Envía un enlace para entrar con una cuenta que ya tiene ese correo. */
  requestSignIn(email: string): Promise<void>
  signOut(): Promise<void>
  /** Cambios de sesión (enlace abierto en otra pestaña, renovación). Retorna la baja. */
  onUserChange(listener: (user: AuthUser | null) => void): () => void
}

const toUser = (user: User): AuthUser => ({
  id: user.id,
  email: user.is_anonymous ? null : (user.email ?? null),
})

/** Mensaje para la persona según el código de error de Supabase Auth. */
export function authErrorMessage(
  error: Pick<AuthError, 'message'> & { code?: string; status?: number },
) {
  switch (error.code) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Se enviaron demasiados correos. Espera unos minutos y vuelve a intentarlo.'
    case 'otp_expired':
    case 'access_denied':
      return 'El enlace ya venció o ya se usó. Pide uno nuevo.'
    case 'email_exists':
      return 'Ese correo ya tiene una cuenta: usa «Entrar con mi correo».'
    case 'otp_disabled':
    case 'signup_disabled':
    case 'user_not_found':
      return 'No hay ninguna cuenta con ese correo. Vincúlalo primero desde el equipo donde tienes tus canciones.'
    case 'email_address_invalid':
    case 'validation_failed':
      return 'Revisa el correo: no parece válido.'
    case 'anonymous_provider_disabled':
      return 'La nube no acepta cuentas anónimas todavía (hay que activarlas en Supabase).'
  }
  if (!error.status) return 'Sin conexión con la nube. Revisa tu red.'
  return error.message
}

export class AuthFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthFailure'
  }
}

function check<T>(response: { data?: T; error: AuthError | null }): T {
  if (response.error) throw new AuthFailure(authErrorMessage(response.error))
  return response.data as T
}

function userOf(data: { user: User | null }): AuthUser {
  if (!data.user) throw new AuthFailure('La nube no devolvió el usuario.')
  return toUser(data.user)
}

/** Candado entre pestañas del alta anónima. */
export const ANON_LOCK = 'drumhero-anonymous-sign-in'

export interface AnonymousOnceDeps {
  /** Sesión guardada en este navegador (la comparten las pestañas). */
  session: () => Promise<AuthUser | null>
  signIn: () => Promise<AuthUser>
  locks?: AnonLocks | null
  doc?: PrerenderDoc | null
}

/** Lo que se usa de navigator.locks (Web Locks). */
export interface AnonLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

/** Lo que se usa de document para detectar una precarga (falta en lib.dom). */
export interface PrerenderDoc {
  readonly prerendering?: boolean
  addEventListener(type: 'prerenderingchange', listener: () => void, options: { once: true }): void
}

/**
 * Alta anónima sin duplicados: varias pestañas que abren a la vez sin sesión
 * (o una precarga de Chrome) creaban una cuenta cada una. Una precarga espera a
 * mostrarse; con el candado, la segunda pestaña encuentra la sesión que guardó
 * la primera y la reutiliza.
 */
export async function anonymousOnce({
  session,
  signIn,
  locks = typeof navigator !== 'undefined'
    ? ((navigator.locks as AnonLocks | undefined) ?? null)
    : null,
  doc = typeof document !== 'undefined' ? (document as PrerenderDoc) : null,
}: AnonymousOnceDeps): Promise<AuthUser> {
  if (doc?.prerendering) {
    await new Promise<void>(resolve =>
      doc.addEventListener('prerenderingchange', () => resolve(), { once: true }),
    )
  }
  const once = async () => (await session()) ?? (await signIn())
  return locks ? locks.request(ANON_LOCK, once) : once()
}

/** Adonde vuelve el enlace del correo: esta misma página (localhost o la publicada). */
function redirectTo() {
  return `${window.location.origin}${window.location.pathname}`
}

/** Quita del #hash el error del enlace para que no reaparezca al recargar. */
function clearHash() {
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState(window.history.state, '', url.toString())
}

export function createAuthApi(sb: SupabaseClient): AuthApi {
  return {
    async currentUser() {
      // initialize() lee el #hash del enlace (una sola vez) y devuelve su error
      const { error } = await sb.auth.initialize()
      let linkError: string | null = null
      if (error) {
        const code = (error as { details?: { code?: string } }).details?.code
        linkError = authErrorMessage({ message: error.message, code, status: 400 })
        clearHash()
      }
      const { data } = await sb.auth.getSession()
      return { user: data.session ? toUser(data.session.user) : null, error: linkError }
    },
    signInAnonymously() {
      return anonymousOnce({
        session: async () => {
          const { data } = await sb.auth.getSession()
          return data.session ? toUser(data.session.user) : null
        },
        signIn: async () => userOf(check(await sb.auth.signInAnonymously())),
      })
    },
    async requestLink(email) {
      check<unknown>(await sb.auth.updateUser({ email }, { emailRedirectTo: redirectTo() }))
    },
    async requestSignIn(email) {
      check(
        await sb.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: redirectTo() },
        }),
      )
    },
    async signOut() {
      check(await sb.auth.signOut({ scope: 'local' }))
    },
    onUserChange(listener) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        // Fuera del callback: supabase-js pide no llamar a su API dentro
        setTimeout(() => listener(session ? toUser(session.user) : null), 0)
      })
      return () => data.subscription.unsubscribe()
    },
  }
}
