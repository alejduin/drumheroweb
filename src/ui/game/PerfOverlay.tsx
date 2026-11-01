import { useEffect, useRef } from 'react'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { perfLines, perfMonitor } from '@/perf/PerfMonitor'

// Se refresca dos veces por segundo escribiendo en el DOM, sin re-render
const REFRESH_MS = 500
const TONE = { true: 'text-perfect-fg', false: 'text-miss', null: 'text-muted' } as const

/**
 * Panel de rendimiento (D8): fps, ms por golpe y fluctuación del reloj frente a los
 * objetivos de REQUIREMENTS_V2 §10. Se activa en Ajustes → Diagnóstico.
 */
export function PerfOverlay() {
  const rowsRef = useRef<HTMLDListElement>(null)
  const lastRef = useRef(0)

  useEffect(() => {
    perfMonitor.reset()
    perfMonitor.enabled = true
    return () => {
      perfMonitor.enabled = false
      perfMonitor.reset()
    }
  }, [])

  useAnimationFrame(nowMs => {
    const rows = rowsRef.current
    if (!rows || nowMs - lastRef.current < REFRESH_MS) return
    lastRef.current = nowMs
    perfLines(perfMonitor.summary()).forEach((line, i) => {
      const value = rows.children[i * 2 + 1] as HTMLElement | undefined
      if (!value) return
      value.textContent = line.value
      value.className = TONE[String(line.ok) as keyof typeof TONE]
    })
  })

  return (
    <aside
      aria-label="Rendimiento"
      className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-md border border-border bg-surface-inset/90 px-3 py-2 font-mono text-[11px]"
    >
      <dl ref={rowsRef} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {['Render', 'Golpe', 'Reloj'].map(label => [
          <dt key={`${label}-l`} className="text-faint">
            {label}
          </dt>,
          <dd key={`${label}-v`} className="text-muted">
            —
          </dd>,
        ])}
      </dl>
    </aside>
  )
}
