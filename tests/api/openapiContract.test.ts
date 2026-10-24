import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import openapiSource from '@shared/openapi.yaml?raw'
import { ANALYSIS_STAGE_IDS, JOB_ERROR_CODES, JOB_STATUSES, STAGE_STATES } from '@/types'

interface OpenApiDoc {
  openapi: string
  paths: Record<string, Record<string, unknown>>
  components: { schemas: Record<string, { enum?: string[]; required?: string[] }> }
}

const doc = parse(openapiSource) as OpenApiDoc
const schemas = doc.components.schemas

// ─── Contrato del worker ↔ tipos TS ──────────────────────────────────────────

describe('shared/openapi.yaml', () => {
  it('es OpenAPI 3.1', () => {
    expect(doc.openapi).toBe('3.1.0')
  })

  it('expone los endpoints del plan', () => {
    expect(Object.keys(doc.paths).sort()).toEqual(
      [
        '/v1/files/{path}',
        '/v1/health',
        '/v1/jobs',
        '/v1/jobs/{jobId}',
        '/v1/jobs/{jobId}/result',
      ].sort(),
    )
    expect(Object.keys(doc.paths['/v1/jobs/{jobId}'])).toEqual(
      expect.arrayContaining(['get', 'delete']),
    )
  })

  it('los estados del trabajo coinciden con TS', () => {
    expect(schemas.JobStatus.enum).toEqual([...JOB_STATUSES])
  })

  it('las etapas coinciden con TS y con la pantalla Importar', () => {
    expect(schemas.AnalysisStageId.enum).toEqual([...ANALYSIS_STAGE_IDS])
    expect(schemas.StageState.enum).toEqual([...STAGE_STATES])
  })

  it('los códigos de error coinciden con TS', () => {
    expect(schemas.ErrorCode.enum).toEqual([...JOB_ERROR_CODES])
  })

  it('todas las $ref internas apuntan a componentes existentes', () => {
    const refs = [...openapiSource.matchAll(/\$ref: '#\/components\/(\w+)\/(\w+)'/g)]
    expect(refs.length).toBeGreaterThan(0)
    const components = (doc as unknown as { components: Record<string, Record<string, unknown>> })
      .components
    for (const [, kind, name] of refs) {
      expect(components[kind]?.[name], `${kind}/${name}`).toBeDefined()
    }
  })
})
