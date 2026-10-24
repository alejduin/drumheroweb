import { useCallback, useEffect, useRef, useState } from 'react'
import { midiManager } from '@/midi/MidiManager'
import type { MidiConnectionState, MidiDevice } from '@/midi/MidiManager'
import type { MidiHit } from '@/types'

interface UseMidiReturn {
  state: MidiConnectionState
  devices: MidiDevice[]
  lastHit: MidiHit | null
  error: string | null
  connect: () => Promise<void>
  selectDevice: (id: string) => void
}

/**
 * Hook que expone el estado de la conexión MIDI al árbol de componentes.
 * Se suscribe al midiManager singleton y limpia al desmontar.
 */
export function useMidi(): UseMidiReturn {
  const [state, setState] = useState<MidiConnectionState>(midiManager.getState())
  const [devices, setDevices] = useState<MidiDevice[]>([])
  const [lastHit, setLastHit] = useState<MidiHit | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Ref para evitar setState tras desmontar
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    const unsubState = midiManager.onStateChange(s => {
      if (mounted.current) setState(s)
    })

    const unsubDevices = midiManager.onDevicesChange(d => {
      if (mounted.current) setDevices(d)
    })

    const unsubHit = midiManager.onHit(hit => {
      if (mounted.current) setLastHit(hit)
    })

    return () => {
      mounted.current = false
      unsubState()
      unsubDevices()
      unsubHit()
    }
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    try {
      await midiManager.connect()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido al conectar MIDI'
      if (mounted.current) setError(message)
    }
  }, [])

  const selectDevice = useCallback((id: string) => {
    midiManager.selectDevice(id)
  }, [])

  return { state, devices, lastHit, error, connect, selectDevice }
}
