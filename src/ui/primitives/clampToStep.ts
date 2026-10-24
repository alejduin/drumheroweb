/** Redondea al step más cercano y limita a [min, max]. */
export function clampToStep(value: number, min: number, max: number, step: number): number {
  const stepped = Math.round((value - min) / step) * step + min
  // Redondeo extra para no arrastrar errores de coma flotante (0.1 + 0.2…)
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number(Math.min(Math.max(stepped, min), max).toFixed(decimals))
}
