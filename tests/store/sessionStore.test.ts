import { beforeEach, describe, expect, it } from 'vitest'
import { sessionSnapshot } from '@/game/lastSession'
import { useSessionStore } from '@/store/sessionStore'

const GRID = { beats: [0, 0.5, 1, 1.5], downbeats: [0] }
const session = (id: string) =>
  sessionSnapshot({
    song: { kind: 'builtin', id },
    chart: { title: 'Demo', artist: '', grid: GRID },
    sections: [{ name: 'Todo', startMeasure: 1, endMeasure: 1 }],
    positionS: 1,
    difficulty: 'full',
    tempo: 1,
    now: 7,
  })

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().clear()
    localStorage.clear()
  })

  it('la última sesión sobrevive a una recarga (localStorage)', async () => {
    useSessionStore.getState().save(session('demo'))
    const raw = localStorage.getItem('drumhero-session')!
    expect(JSON.parse(raw).state.last.song).toEqual({ kind: 'builtin', id: 'demo' })

    // "Recarga": memoria vacía, localStorage intacto, y se rehidrata desde ahí
    useSessionStore.setState({ last: null })
    localStorage.setItem('drumhero-session', raw)
    await useSessionStore.persist.rehydrate()
    expect(useSessionStore.getState().last).toEqual(session('demo'))
  })

  it('forget solo olvida la sesión de esa canción', () => {
    useSessionStore.getState().save(session('demo'))
    useSessionStore.getState().forget({ kind: 'builtin', id: 'otra' })
    expect(useSessionStore.getState().last).not.toBeNull()
    useSessionStore.getState().forget({ kind: 'builtin', id: 'demo' })
    expect(useSessionStore.getState().last).toBeNull()
  })
})
