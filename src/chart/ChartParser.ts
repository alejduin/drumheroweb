import Ajv2020 from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import schema from '@shared/chart-v2.schema.json'
import type { ChartV2 } from '@/types'
import { convertV1ToV2, isChartV1 } from './convertV1'
import { repairChartGrid } from './gridRepair'
import { validateChartInvariants } from './invariants'
import type { ChartIssue } from './invariants'

export class ChartParseError extends Error {
  readonly issues: ChartIssue[]

  constructor(issues: ChartIssue[]) {
    const first = issues[0]
    super(`chart inválido: ${first ? `${first.path || '(raíz)'} ${first.message}` : 'desconocido'}`)
    this.name = 'ChartParseError'
    this.issues = issues
  }
}

// El schema se compila una sola vez, al primer uso
let validator: ValidateFunction | null = null

function getValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    validator = ajv.compile(schema)
  }
  return validator
}

/** Problemas del chart contra shared/chart-v2.schema.json y las invariantes (vacío = válido). */
export function chartIssues(raw: unknown): ChartIssue[] {
  const validate = getValidator()
  if (!validate(raw)) {
    return (validate.errors ?? []).map(e => ({
      path: e.instancePath.replace(/^\//, '').replaceAll('/', '.'),
      message: e.message ?? 'inválido',
    }))
  }
  return validateChartInvariants(raw as ChartV2)
}

/**
 * Valida y devuelve un chart v2. Acepta también charts v1 (sin `version`, con
 * `measures`), que se convierten con convertV1ToV2. Repara el arranque de la
 * rejilla si el detector de pulso dejó beats falsos en la intro. Lanza ChartParseError.
 */
export function parseChart(raw: unknown): ChartV2 {
  let chart = raw
  if (isChartV1(raw)) {
    try {
      chart = convertV1ToV2(raw)
    } catch (e) {
      throw new ChartParseError([{ path: '', message: e instanceof Error ? e.message : String(e) }])
    }
  }
  const issues = chartIssues(chart)
  if (issues.length > 0) throw new ChartParseError(issues)
  return repairChartGrid(chart as ChartV2)
}
