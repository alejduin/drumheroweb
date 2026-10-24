// ─── Formato de tiempos y números de la pantalla de juego ─────────────────────

const SCORE_FORMAT = new Intl.NumberFormat('en-US') // "12,450", como la maqueta

function split(seconds: number): { m: number; s: number; ms: number } {
  const totalMs = Math.max(0, Math.floor(seconds * 1000 + 1e-6))
  return {
    m: Math.floor(totalMs / 60000),
    s: Math.floor(totalMs / 1000) % 60,
    ms: totalMs % 1000,
  }
}

/** 84.3 → "1:24" (barra de progreso del header). */
export function formatClock(seconds: number): string {
  const { m, s } = split(seconds)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 84.318 → "1:24.318" (transporte, reloj maestro). */
export function formatClockMs(seconds: number): string {
  const { ms } = split(seconds)
  return `${formatClock(seconds)}.${String(ms).padStart(3, '0')}`
}

export function formatScore(score: number): string {
  return SCORE_FORMAT.format(Math.round(score))
}

/** 0.94 → "94%"; null (nada evaluado) → "—". */
export function formatPercent(fraction: number | null): string {
  return fraction === null ? '—' : `${Math.round(fraction * 100)}%`
}

/** 42 → "+42 ms"; -9 → "-9 ms"; 0 → "0 ms". */
export function formatSignedMs(ms: number): string {
  const rounded = Math.round(ms)
  return `${rounded > 0 ? '+' : ''}${rounded} ms`
}
