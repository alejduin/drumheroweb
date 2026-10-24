import type { SectionSpan } from '@/game/sections'

/** Nombres de sección bajo la forma de onda, cada uno en su tramo de la canción. */
export function SectionRuler({ spans }: { spans: readonly SectionSpan[] }) {
  return (
    <div className="relative h-4 shrink-0 text-[11px] text-faint" aria-hidden="true">
      {spans.map(span => (
        <span
          key={`${span.start}-${span.name}`}
          className="absolute top-0 overflow-hidden pr-2 whitespace-nowrap"
          style={{ left: `${span.start * 100}%`, width: `${(span.end - span.start) * 100}%` }}
        >
          {span.name}
        </span>
      ))}
    </div>
  )
}
