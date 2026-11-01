import type { SupabaseClient } from '@supabase/supabase-js'
import type { Difficulty, Level } from '@/types'
import { isPracticeLayer } from '@/chart/layers'
import type { PlayEntry } from '@/progress/history'

// ─── Historial de partidas en Supabase (PLAN_V2 D7) ───────────────────────────
// Tabla `plays` con RLS por usuario. Insertar es idempotente (id del navegador).

export interface RemotePlays {
  /** Partidas del usuario con sesión, las más nuevas primero. */
  listPlays(limit: number): Promise<PlayEntry[]>
  /** Sube partidas; las que ya estaban se ignoran. */
  insertPlays(plays: readonly PlayEntry[]): Promise<void>
}

export interface PlayRow {
  id: string
  song_id: string
  title: string
  difficulty: Difficulty
  level: Level
  tempo: number
  score: number
  precision: number | null
  stats: { layer?: unknown; waitMode?: unknown; completed?: unknown; evaluated?: unknown } | null
  duration_s: number
  played_at: string
}

export function toPlayRow(p: PlayEntry): PlayRow {
  return {
    id: p.id,
    song_id: p.songId,
    title: p.title.slice(0, 200),
    difficulty: p.difficulty,
    level: p.level,
    tempo: p.tempo,
    score: Math.max(0, Math.round(p.score)),
    precision: p.precision,
    stats: {
      layer: p.layer,
      waitMode: p.waitMode,
      completed: p.completed,
      evaluated: p.evaluated,
    },
    duration_s: Math.min(Math.max(p.durationS, 0), 86_400),
    played_at: new Date(p.playedAt).toISOString(),
  }
}

export function fromPlayRow(row: PlayRow): PlayEntry {
  const stats = row.stats ?? {}
  return {
    id: row.id,
    songId: row.song_id,
    title: row.title,
    difficulty: row.difficulty,
    level: row.level,
    tempo: row.tempo,
    layer: isPracticeLayer(stats.layer) ? stats.layer : 'full',
    waitMode: stats.waitMode === true,
    completed: stats.completed === true,
    score: row.score,
    precision: row.precision,
    evaluated: typeof stats.evaluated === 'number' ? stats.evaluated : 0,
    durationS: row.duration_s,
    playedAt: Date.parse(row.played_at),
  }
}

const COLUMNS =
  'id, song_id, title, difficulty, level, tempo, score, precision, stats, duration_s, played_at'

export function createPlaysCloud(sb: SupabaseClient): RemotePlays {
  return {
    async listPlays(limit) {
      const { data, error } = await sb
        .from('plays')
        .select(COLUMNS)
        .order('played_at', { ascending: false })
        .limit(limit)
        .returns<PlayRow[]>()
      if (error) throw new Error(`no se pudo leer el historial: ${error.message}`)
      return (data ?? []).map(fromPlayRow)
    },

    async insertPlays(plays) {
      if (plays.length === 0) return
      const { error } = await sb
        .from('plays')
        .upsert(plays.map(toPlayRow), { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw new Error(`no se pudo guardar el historial: ${error.message}`)
    },
  }
}
