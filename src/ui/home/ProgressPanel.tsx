import { useMemo, useState } from 'react'
import { formatPercent } from '@/game/format'
import { BADGES, BADGE_INFO, dayLabel, progressSummary } from '@/progress/history'
import { useHistoryStore } from '@/store/historyStore'
import { useSettingsStore } from '@/store/settingsStore'
import { Panel, ProgressBar, cn } from '@/ui/primitives'

/** Racha, meta semanal, insignias y últimas partidas (PLAN_V2 D7, StreakSummary). */
export function ProgressPanel() {
  const plays = useHistoryStore(s => s.plays)
  const goalMin = useSettingsStore(s => s.weeklyGoalMin)
  // La hora de apertura de la portada basta para saber qué es "hoy"
  const [now] = useState(() => Date.now())
  const summary = useMemo(() => progressSummary(plays, now, goalMin), [plays, now, goalMin])
  const { streak, weekMin, badges, recent } = summary
  const reached = weekMin >= goalMin

  const streakHint = streak.today
    ? 'hoy ya practicaste'
    : streak.days > 0
      ? 'toca hoy para no perderla'
      : 'toca hoy para empezar una'

  return (
    <Panel title="Tu progreso" aside="racha y meta semanal">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-extrabold">
            {streak.days} {streak.days === 1 ? 'día' : 'días'}
          </span>
          <span className="text-xs text-muted">racha · {streakHint}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-2xl font-extrabold">
            {weekMin}
            <span className="text-sm font-semibold text-muted"> / {goalMin} min</span>
          </span>
          <ProgressBar
            aria-label="Meta semanal"
            value={goalMin > 0 ? weekMin / goalMin : 0}
            tone={reached ? 'perfect' : 'accent'}
          />
          <span className="text-xs text-muted">
            {reached ? '¡meta cumplida esta semana!' : 'meta semanal'}
          </span>
        </div>
      </div>

      <ul aria-label="Insignias" className="flex flex-wrap gap-2">
        {BADGES.map(id => {
          const earned = badges[id] !== undefined
          return (
            <li
              key={id}
              title={earned ? `Ganada ${dayLabel(badges[id]!, now)}` : BADGE_INFO[id].hint}
              className={cn(
                'rounded-[6px] border px-[9px] py-[5px] text-[11px]',
                earned
                  ? 'border-accent bg-accent-soft font-semibold text-fg'
                  : 'border-border text-faint',
              )}
            >
              {BADGE_INFO[id].label}
              <span className="sr-only">{earned ? ' (ganada)' : ' (por ganar)'}</span>
            </li>
          )
        })}
      </ul>

      {recent.length > 0 && (
        <ol aria-label="Últimas partidas" className="flex flex-col gap-1 text-xs">
          {recent.map(p => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="truncate text-fg-2">
                {p.title || 'Canción'}
                {!p.completed && <span className="text-muted"> · práctica</span>}
              </span>
              <span className="shrink-0 font-mono text-muted">
                {formatPercent(p.precision)} · {Math.max(1, Math.round(p.durationS / 60))} min ·{' '}
                {dayLabel(p.playedAt, now)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
