import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js'

// ─── Sesión en Supabase (PLAN_V2 B12) ────────────────────────────────────────
// Cada navegador arranca con una cuenta anónima. Para abrir la biblioteca en
// otro equipo se vincula un correo (código de 6 dígitos) y allí se entra con
// otro código. Sin contraseñas.

export interface AuthUser {
  id: string
  /** null mientras la cuenta es anónima. */
  email: string | null
}

export interface AuthApi {
  /** Sesión guardada en este navegador, si la hay. */
  currentUser(): Promise<AuthUser | null>
  signInAnonymously(): Promise<AuthUser>
  /** Envía un código para vincular el correo a la cuenta actual. */
  requestLink(email: string): Promise<void>
  confirmLink(email: string, code: string): Promise<AuthUser>
  /** Envía un código para entrar con una cuenta que ya tiene ese correo. */
  requestSignIn(email: string): Promise<void>
  confirmSignIn(email: string, code: string): Promise<AuthUser>
  signOut(): Promise<void>
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
      return 'Se enviaron demasiados códigos. Espera unos minutos y vuelve a intentarlo.'
    case 'otp_expired':
      return 'El código no es válido o ya venció. Pide uno nuevo.'
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

export function createAuthApi(sb: SupabaseClient): AuthApi {
  return {
    async currentUser() {
      const { data } = await sb.auth.getSession()
      return data.session ? toUser(data.session.user) : null
    },
    async signInAnonymously() {
      return userOf(check(await sb.auth.signInAnonymously()))
    },
    async requestLink(email) {
      check<unknown>(await sb.auth.updateUser({ email }))
    },
    async confirmLink(email, code) {
      return userOf(check(await sb.auth.verifyOtp({ email, token: code, type: 'email_change' })))
    },
    async requestSignIn(email) {
      check(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }))
    },
    async confirmSignIn(email, code) {
      return userOf(check(await sb.auth.verifyOtp({ email, token: code, type: 'email' })))
    },
    async signOut() {
      check(await sb.auth.signOut({ scope: 'local' }))
    },
  }
}
