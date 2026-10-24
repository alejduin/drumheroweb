import { TIME_EPSILON_S } from '@/constants/chart'
import { DIFFICULTIES } from '@/types'
import type { ChartV2 } from '@/types'

export interface ChartIssue {
  path: string
  message: string
}

/**
 * Valida las reglas del chart v2 que el JSON Schema no puede expresar.
 * Asume que el chart ya pasó el schema. Retorna la lista de problemas (vacía = válido).
 *
 * El worker aplica las mismas reglas en Python (chart.py); los tests de ambos
 * lados usan shared/examples/chart-v2.example.json.
 */
export function validateChartInvariants(chart: ChartV2): ChartIssue[] {
  const issues: ChartIssue[] = []
  const maxT = chart.durationS + TIME_EPSILON_S

  // ─── Rejilla ─────────────────────────────────────────────────────────────
  const { beats, downbeats } = chart.grid

  for (let i = 1; i < beats.length; i++) {
    if (beats[i] <= beats[i - 1]) {
      issues.push({
        path: `grid.beats[${i}]`,
        message: 'los beats deben ser estrictamente ascendentes',
      })
    }
  }
  if (beats[beats.length - 1] > maxT) {
    issues.push({ path: 'grid.beats', message: 'hay beats después de durationS' })
  }

  for (let i = 0; i < downbeats.length; i++) {
    if (i > 0 && downbeats[i] <= downbeats[i - 1]) {
      issues.push({
        path: `grid.downbeats[${i}]`,
        message: 'los downbeats deben ser estrictamente ascendentes',
      })
    }
    if (!beats.some(b => Math.abs(b - downbeats[i]) <= TIME_EPSILON_S)) {
      issues.push({
        path: `grid.downbeats[${i}]`,
        message: 'el downbeat no coincide con ningún beat',
      })
    }
  }

  // ─── Notas ───────────────────────────────────────────────────────────────
  for (const difficulty of DIFFICULTIES) {
    const notes = chart.difficulties[difficulty].notes
    for (let i = 0; i < notes.length; i++) {
      const path = `difficulties.${difficulty}.notes[${i}]`
      const note = notes[i]
      if (i > 0 && note.t < notes[i - 1].t) {
        issues.push({ path, message: 'las notas deben estar ordenadas por t' })
      }
      if (note.t > maxT) {
        issues.push({ path, message: 'la nota está después de durationS' })
      }
      if (note.tRaw !== undefined && note.tRaw > maxT) {
        issues.push({ path, message: 'tRaw está después de durationS' })
      }
    }
  }

  // ─── Secciones ───────────────────────────────────────────────────────────
  const measureCount = downbeats.length
  let previousEnd = 0
  chart.sections.forEach((section, i) => {
    const path = `sections[${i}]`
    if (section.endMeasure < section.startMeasure) {
      issues.push({ path, message: 'endMeasure debe ser >= startMeasure' })
    }
    if (section.startMeasure <= previousEnd) {
      issues.push({ path, message: 'las secciones deben estar ordenadas y sin solaparse' })
    }
    if (section.endMeasure > measureCount) {
      issues.push({
        path,
        message: `la sección termina después del último compás (${measureCount})`,
      })
    }
    // Una sección invertida igual ocupa hasta su compás mayor
    previousEnd = Math.max(previousEnd, section.startMeasure, section.endMeasure)
  })

  return issues
}
