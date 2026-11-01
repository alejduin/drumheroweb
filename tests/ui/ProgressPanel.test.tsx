import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayEntry } from '@/progress/history'
import { useHistoryStore } from '@/store/historyStore'
import { useSettingsStore } from '@/store/settingsStore'
import { ProgressPanel } from '@/ui/home/ProgressPanel'

const play = (over: Partial<PlayEntry>): PlayEntry => ({
  id: 'a',
  songId: 's',
  title: 'Mi canción',
  difficulty: 'full',
  level: 'intermediate',
  tempo: 1,
  layer: 'full',
  waitMode: false,
  completed: true,
  score: 100,
  precision: 0.92,
  evaluated: 50,
  durationS: 25 * 60,
  playedAt: Date.now(),
  ...over,
})

afterEach(() => {
  useHistoryStore.setState({ plays: [], pending: [], lastAdded: null })
  useSettingsStore.getState().setWeeklyGoal(120)
})

describe('ProgressPanel', () => {
  it('muestra racha, meta semanal, insignias y la última partida', () => {
    useHistoryStore.setState({ plays: [play({})] })
    useSettingsStore.getState().setWeeklyGoal(60)
    render(<ProgressPanel />)
    expect(screen.getByText('1 día')).toBeInTheDocument()
    expect(screen.getByText(/hoy ya practicaste/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Meta semanal' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
    const badges = within(screen.getByRole('list', { name: 'Insignias' }))
    expect(badges.getByText(/Primera canción/)).toHaveTextContent('(ganada)')
    expect(badges.getByText(/7 días seguidos/)).toHaveTextContent('(por ganar)')
    expect(screen.getByRole('list', { name: 'Últimas partidas' })).toHaveTextContent('Mi canción')
  })

  it('sin historial invita a empezar', () => {
    render(<ProgressPanel />)
    expect(screen.getByText('0 días')).toBeInTheDocument()
    expect(screen.getByText(/toca hoy para empezar una/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Últimas partidas' })).toBeNull()
  })
})
