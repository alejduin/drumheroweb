import { useEffect, useState } from 'react'
import { midiManager } from '@/midi/MidiManager'
import type { MidiConnectionState } from '@/midi/MidiManager'
import { StatusPill } from '@/ui/primitives'
import type { StatusTone } from '@/ui/primitives'

const TONES: Record<MidiConnectionState, StatusTone> = {
  connected: 'perfect',
  requesting: 'close',
  disconnected: 'neutral',
  error: 'miss',
}

/** "TD-02KV conectado". Escucha solo el estado y los dispositivos, nunca los golpes. */
export function MidiStatusPill() {
  const [state, setState] = useState(midiManager.getState())
  const [device, setDevice] = useState(midiManager.getSelectedDeviceName())

  useEffect(() => {
    const refresh = () => setDevice(midiManager.getSelectedDeviceName())
    const unsubs = [
      midiManager.onStateChange(s => {
        setState(s)
        refresh()
      }),
      midiManager.onDevicesChange(refresh),
    ]
    return () => unsubs.forEach(unsub => unsub())
  }, [])

  const connected = state === 'connected' && device
  const label = connected
    ? `${device} conectado`
    : state === 'requesting'
      ? 'Conectando MIDI…'
      : state === 'error'
        ? 'MIDI no disponible'
        : state === 'connected'
          ? 'Sin batería MIDI'
          : 'MIDI desconectado'
  return (
    <StatusPill
      tone={connected ? 'perfect' : TONES[state === 'connected' ? 'disconnected' : state]}
    >
      {label}
    </StatusPill>
  )
}
