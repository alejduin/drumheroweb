import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemotePlays } from '@/api/playsCloud'
import { fromPlayRow, toPlayRow } from '@/api/playsCloud'
import type { PlayEntry } from '@/progress/history'
import { createHistoryStore, mergePlays } from '@/store/historyStore'

let seq = 0
function play(playedAt: number, over: Partial<PlayEntry> = {}): PlayEntry {
  return {
    id: `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`,
    songId: 's',
    title: 'Canción',
    difficulty: 'full',
    level: 'intermediate',
    tempo: 0.75,
    layer: 'kick_snare',
    waitMode: true,
    completed: true,
    score: 1234,
    precision: 0.875,
    evaluated: 40,
    durationS: 95.5,
    playedAt,
    ...over,
  }
}

function fakeRemote(rows: PlayEntry[] = []) {
  const remote = {
    rows,
    fail: false,
    listPlays: vi.fn(async () => {
      if (remote.fail) throw new Error('sin red')
      return [...remote.rows]
    }),
    insertPlays: vi.fn(async (plays: readonly PlayEntry[]) => {
      if (remote.fail) throw new Error('sin red')
      for (const p of plays) if (!remote.rows.some(r => r.id === p.id)) remote.rows.push(p)
    }),
  }
  return remote satisfies RemotePlays
}

beforeEach(() => localStorage.clear())

describe('playsCloud: filas', () => {
  it('ida y vuelta sin perder datos', () => {
    const p = play(Date.UTC(2026, 10, 1, 12))
    const row = toPlayRow(p)
    expect(row).toMatchObject({ song_id: 's', played_at: '2026-11-01T12:00:00.000Z' })
    expect(fromPlayRow(row)).toEqual(p)
  })

  it('stats faltantes o inválidas toman valores por defecto', () => {
    const row = { ...toPlayRow(play(0)), stats: { layer: 'toms' } }
    expect(fromPlayRow(row)).toMatchObject({
      layer: 'full',
      waitMode: false,
      completed: false,
      evaluated: 0,
    })
  })
})

describe('mergePlays', () => {
  it('la cuenta manda; lo pendiente se conserva y lo sincronizado de otra cuenta sale', () => {
    const remote = [play(3), play(1)]
    const pending = play(2)
    const otherAccount = play(4)
    const merged = mergePlays(remote, [otherAccount, pending, remote[0]], [pending.id])
    expect(merged.map(p => p.playedAt)).toEqual([3, 2, 1])
  })
})

describe('historyStore', () => {
  it('sin nube guarda solo en local', () => {
    const store = createHistoryStore({ remote: null })
    const p = play(1)
    store.getState().addPlay(p)
    store.getState().addPlay(p) // mismo id: no duplica
    expect(store.getState()).toMatchObject({ plays: [p], pending: [], lastAdded: p.id })
  })

  it('con nube sube al agregar y quita de pendientes', async () => {
    const remote = fakeRemote()
    const store = createHistoryStore({ remote })
    store.getState().addPlay(play(1))
    await vi.waitFor(() => expect(store.getState().pending).toEqual([]))
    expect(remote.rows).toHaveLength(1)
  })

  it('sin red queda pendiente y se sube en la próxima sync, que trae la cuenta', async () => {
    const remote = fakeRemote([play(5)])
    remote.fail = true
    const store = createHistoryStore({ remote })
    const local = play(2)
    store.getState().addPlay(local)
    await Promise.resolve()
    expect(store.getState().pending).toEqual([local.id])

    await store.getState().sync() // sigue sin red: no pierde nada
    expect(store.getState().plays).toEqual([local])

    remote.fail = false
    await store.getState().sync()
    expect(remote.insertPlays).toHaveBeenLastCalledWith([local])
    expect(store.getState().pending).toEqual([])
    expect(store.getState().plays.map(p => p.playedAt)).toEqual([5, 2])
  })
})
