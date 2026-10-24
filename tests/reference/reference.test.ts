import { describe, expect, it } from 'vitest'
import type { ReferenceHit } from '@/types'
import { DEFAULT_PIECE_MAP, pieceForNote } from '@/midi/pieceMap'
import {
  EMPTY_RECORDING,
  buildReferenceFile,
  countByPiece,
  coveredSeconds,
  mergeTake,
  parseRecordingDraft,
  songIdFromFileName,
} from '@/reference/reference'

const hit = (t: number, piece: ReferenceHit['piece'] = 'kick', note = 36): ReferenceHit => ({
  t,
  piece,
  note,
  velocity: 90,
})

describe('songIdFromFileName', () => {
  it('coincide con song_id_from_name del worker', () => {
    // Mismos casos que worker/tests/test_chart.py
    expect(songIdFromFileName('01 Rock simple (v2).mp3', 'x')).toBe('01-Rock-simple-v2')
    expect(songIdFromFileName('¡¡¡.mp3', 'fallback')).toBe('fallback')
    expect(songIdFromFileName('Enter Sandman.mp3', 'x')).toBe('Enter-Sandman')
    expect(songIdFromFileName('The Unforgiven III.mp3', 'x')).toBe('The-Unforgiven-III')
    expect(songIdFromFileName('a.b.mp3', 'x')).toBe('a-b')
  })
})

describe('mergeTake', () => {
  it('añade los golpes de la primera toma ordenados', () => {
    const state = mergeTake(EMPTY_RECORDING, { startS: 0, endS: 10 }, [hit(5), hit(1)])
    expect(state.hits.map(h => h.t)).toEqual([1, 5])
    expect(state.takes).toEqual([{ startS: 0, endS: 10 }])
  })

  it('regrabar un tramo reemplaza solo los golpes de ese tramo', () => {
    let state = mergeTake(EMPTY_RECORDING, { startS: 0, endS: 30 }, [
      hit(2),
      hit(12),
      hit(15),
      hit(25),
    ])
    state = mergeTake(state, { startS: 10, endS: 20 }, [hit(11, 'snare', 38)])
    expect(state.hits.map(h => [h.t, h.piece])).toEqual([
      [2, 'kick'],
      [11, 'snare'],
      [25, 'kick'],
    ])
  })

  it('una toma sin golpes vacía su tramo (se tocó silencio)', () => {
    let state = mergeTake(EMPTY_RECORDING, { startS: 0, endS: 10 }, [hit(3), hit(8)])
    state = mergeTake(state, { startS: 7, endS: 9 }, [])
    expect(state.hits.map(h => h.t)).toEqual([3])
  })

  it('descarta golpes fuera de la toma y tomas vacías', () => {
    const state = mergeTake(EMPTY_RECORDING, { startS: 5, endS: 6 }, [hit(4.9), hit(5.5), hit(6.1)])
    expect(state.hits.map(h => h.t)).toEqual([5.5])
    expect(mergeTake(state, { startS: 3, endS: 3 }, [hit(3)])).toBe(state)
  })

  it('golpes simultáneos se ordenan por nota', () => {
    const state = mergeTake(EMPTY_RECORDING, { startS: 0, endS: 2 }, [
      hit(1, 'hihat_closed', 42),
      hit(1, 'kick', 36),
    ])
    expect(state.hits.map(h => h.piece)).toEqual(['kick', 'hihat_closed'])
  })
})

describe('coveredSeconds', () => {
  it('une intervalos solapados', () => {
    expect(
      coveredSeconds([
        { startS: 0, endS: 10 },
        { startS: 5, endS: 15 },
        { startS: 20, endS: 25 },
        { startS: 21, endS: 22 },
        { startS: 30, endS: 30 },
      ]),
    ).toBe(20)
    expect(coveredSeconds([])).toBe(0)
  })
})

describe('buildReferenceFile', () => {
  it('redondea tiempos a 0.1 ms y añade versión', () => {
    const state = mergeTake(EMPTY_RECORDING, { startS: 0.123456, endS: 9.87654321 }, [
      hit(1.23456789),
    ])
    const file = buildReferenceFile(state, {
      songId: 'x',
      audioFile: 'x.mp3',
      audioSha256: null,
      durationS: 10,
      recordedAt: '2026-10-24T00:00:00.000Z',
      device: 'TD-02',
      outputLatencyMs: 20,
    })
    expect(file.version).toBe(1)
    expect(file.hits[0].t).toBe(1.2346)
    expect(file.takes[0]).toEqual({ startS: 0.1235, endS: 9.8765 })
    expect(countByPiece(file.hits)).toEqual({ kick: 1 })
  })
})

describe('parseRecordingDraft', () => {
  it('acepta un borrador válido y rechaza basura', () => {
    const state = mergeTake(EMPTY_RECORDING, { startS: 0, endS: 2 }, [hit(1)])
    expect(parseRecordingDraft(JSON.stringify(state))).toEqual(state)
    expect(parseRecordingDraft(null)).toBeNull()
    expect(parseRecordingDraft('{no es json')).toBeNull()
    expect(parseRecordingDraft('{"takes":[],"hits":[{"t":"1"}]}')).toBeNull()
  })
})

describe('DEFAULT_PIECE_MAP', () => {
  it('incluye tom3 = 43 y el borde del ride como ride', () => {
    expect(pieceForNote(43)).toBe('tom3')
    expect(pieceForNote(59)).toBe('ride')
    expect(pieceForNote(51)).toBe('ride')
    expect(pieceForNote(60)).toBeUndefined()
    expect(Object.keys(DEFAULT_PIECE_MAP)).toHaveLength(12)
  })
})
