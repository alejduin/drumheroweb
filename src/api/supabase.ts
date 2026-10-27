import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Conexión con Supabase (PLAN_V2 B12) ─────────────────────────────────────
// Modo nube solo si .env.local trae URL y clave publicable; si no, la app sigue
// en modo local (IndexedDB + worker en http://localhost:8000).

export interface CloudConfig {
  url: string
  publishableKey: string
}

export function cloudConfig(env: Record<string, unknown> = import.meta.env): CloudConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : ''
  const key =
    typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string'
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : ''
  return url && key ? { url, publishableKey: key } : null
}

let client: SupabaseClient | null | undefined

/** Cliente único de la app; null en modo local. */
export function supabase(): SupabaseClient | null {
  if (client === undefined) {
    const config = cloudConfig()
    client = config
      ? createClient(config.url, config.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        })
      : null
  }
  return client
}
