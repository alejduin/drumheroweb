import { useEffect, useRef, useState } from 'react'
import { useMidi } from '@/hooks/useMidi'
import type { MidiDevice } from '@/midi/MidiManager'

interface Toast {
  id: number
  message: string
  type: 'connected' | 'disconnected'
}

let _toastId = 0

/**
 * MidiConnectionToast — muestra una notificación cuando se conecta
 * o desconecta un dispositivo MIDI (batería electrónica).
 */
export function MidiConnectionToast() {
  const { devices } = useMidi()
  const prevDevicesRef = useRef<MidiDevice[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const prev = prevDevicesRef.current
    const prevIds = new Set(prev.map(d => d.id))
    const currIds = new Set(devices.map(d => d.id))

    const add = (message: string, type: Toast['type']) => {
      const id = ++_toastId
      setToasts(t => [...t, { id, message, type }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
    }

    // Dispositivos nuevos → conectado
    devices.forEach(d => {
      if (!prevIds.has(d.id)) {
        add(`Batería conectada: ${d.name}`, 'connected')
      }
    })

    // Dispositivos removidos → desconectado
    prev.forEach(d => {
      if (!currIds.has(d.id)) {
        add(`Batería desconectada: ${d.name}`, 'disconnected')
      }
    })

    prevDevicesRef.current = devices
  }, [devices])

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl text-white text-sm font-medium transition-opacity ${
            toast.type === 'connected'
              ? 'bg-green-700 border border-green-500'
              : 'bg-amber-800 border border-amber-600'
          }`}
        >
          <span className="text-lg" aria-hidden="true">
            {toast.type === 'connected' ? '🥁' : '🔌'}
          </span>
          {toast.message}
        </div>
      ))}
    </div>
  )
}
