import { MIDI_DRUM_CHANNEL, MIN_VELOCITY } from '@/constants/midi'
import type { MidiHit, Piece } from '@/types'
import { DEFAULT_MIDI_MAP, resolveInstrument } from './midiMap'

export type MidiConnectionState = 'disconnected' | 'requesting' | 'connected' | 'error'

export interface MidiDevice {
  id: string
  name: string
  manufacturer: string
}

/** noteOn crudo (cualquier canal y nota, velocity > 0), sin pasar por el mapa. */
export interface MidiNoteOn {
  note: number
  velocity: number
  channel: number // 0–15
  timestamp: number // MIDIMessageEvent.timeStamp (base performance.now(), ms)
}

type HitCallback = (hit: MidiHit) => void
type NoteOnCallback = (noteOn: MidiNoteOn) => void
type StateCallback = (state: MidiConnectionState) => void
type DevicesCallback = (devices: MidiDevice[]) => void

/**
 * MidiManager — singleton que gestiona la conexión Web MIDI API.
 *
 * Uso:
 *   await midiManager.connect()
 *   const unsub = midiManager.onHit(hit => console.log(hit))
 *   unsub() // para dejar de escuchar
 */
class MidiManager {
  private access: MIDIAccess | null = null
  private selectedInput: MIDIInput | null = null
  private midiMap: Record<number, Piece> = { ...DEFAULT_MIDI_MAP }
  private connectionState: MidiConnectionState = 'disconnected'

  private hitCallbacks = new Set<HitCallback>()
  private noteOnCallbacks = new Set<NoteOnCallback>()
  private stateCallbacks = new Set<StateCallback>()
  private devicesCallbacks = new Set<DevicesCallback>()

  // ─── Conexión ───────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this.setState('error')
      throw new Error('Web MIDI API no disponible. Usa Chrome o Edge.')
    }

    this.setState('requesting')

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
      this.access.onstatechange = () => this.notifyDevices()
      this.setState('connected')
      this.notifyDevices()

      // Auto-seleccionar el primer dispositivo disponible
      const devices = this.getDevices()
      if (devices.length > 0) {
        this.selectDevice(devices[0].id)
      }
    } catch {
      this.setState('error')
      throw new Error('Permiso MIDI denegado por el usuario.')
    }
  }

  disconnect(): void {
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null
      this.selectedInput = null
    }
    this.access = null
    this.setState('disconnected')
  }

  // ─── Dispositivos ───────────────────────────────────────────────────────────

  getDevices(): MidiDevice[] {
    if (!this.access) return []
    const devices: MidiDevice[] = []
    this.access.inputs.forEach(input => {
      devices.push({
        id: input.id,
        name: input.name ?? 'Dispositivo desconocido',
        manufacturer: input.manufacturer ?? '',
      })
    })
    return devices
  }

  selectDevice(id: string): void {
    if (!this.access) return

    // Desconectar el input anterior
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null
    }

    const input = this.access.inputs.get(id)
    if (!input) return

    this.selectedInput = input
    this.selectedInput.onmidimessage = (event: MIDIMessageEvent) => this.handleMessage(event)
  }

  // ─── Mapa MIDI ──────────────────────────────────────────────────────────────

  setMidiMap(map: Record<number, Piece>): void {
    this.midiMap = { ...map }
  }

  getMidiMap(): Record<number, Piece> {
    return { ...this.midiMap }
  }

  /** Asigna una nota MIDI a un instrumento (usado en calibración) */
  mapNote(midiNote: number, instrument: Piece): void {
    this.midiMap[midiNote] = instrument
  }

  // ─── Subscripciones ─────────────────────────────────────────────────────────

  /** Recibe cada golpe detectado. Retorna función para cancelar la suscripción. */
  onHit(callback: HitCallback): () => void {
    this.hitCallbacks.add(callback)
    return () => this.hitCallbacks.delete(callback)
  }

  /** Recibe cada noteOn crudo (grabación de referencias, calibración). */
  onNoteOn(callback: NoteOnCallback): () => void {
    this.noteOnCallbacks.add(callback)
    return () => this.noteOnCallbacks.delete(callback)
  }

  /** Nombre del dispositivo de entrada seleccionado. */
  getSelectedDeviceName(): string | null {
    return this.selectedInput?.name ?? null
  }

  /** Recibe cambios en el estado de conexión. */
  onStateChange(callback: StateCallback): () => void {
    this.stateCallbacks.add(callback)
    return () => this.stateCallbacks.delete(callback)
  }

  /** Recibe cambios en la lista de dispositivos. */
  onDevicesChange(callback: DevicesCallback): () => void {
    this.devicesCallbacks.add(callback)
    return () => this.devicesCallbacks.delete(callback)
  }

  getState(): MidiConnectionState {
    return this.connectionState
  }

  // ─── Procesamiento de mensajes ──────────────────────────────────────────────

  private handleMessage(event: MIDIMessageEvent): void {
    // Sin console.log por mensaje: añade latencia en el camino crítico del golpe
    if (this.noteOnCallbacks.size > 0) {
      const noteOn = parseNoteOn(event)
      if (noteOn) this.noteOnCallbacks.forEach(cb => cb(noteOn))
    }

    const hit = parseMidiMessage(event, this.midiMap)
    if (hit) {
      this.hitCallbacks.forEach(cb => cb(hit))
    }
  }

  private setState(state: MidiConnectionState): void {
    this.connectionState = state
    this.stateCallbacks.forEach(cb => cb(state))
  }

  private notifyDevices(): void {
    const devices = this.getDevices()
    this.devicesCallbacks.forEach(cb => cb(devices))
  }
}

/** noteOn con velocity > 0 en cualquier canal; null para todo lo demás. Función pura. */
export function parseNoteOn(event: MIDIMessageEvent): MidiNoteOn | null {
  const data = event.data
  if (!data || data.length < 3) return null
  const status = data[0]
  if ((status & 0xf0) !== 0x90 || data[2] < MIN_VELOCITY) return null
  return {
    note: data[1],
    velocity: data[2],
    channel: status & 0x0f,
    timestamp: event.timeStamp ?? performance.now(),
  }
}

/**
 * Parsea un MIDIMessageEvent y retorna un MidiHit si es un golpe válido.
 * Función pura exportada para facilitar el testing.
 */
export function parseMidiMessage(
  event: MIDIMessageEvent,
  midiMap: Record<number, Piece> = DEFAULT_MIDI_MAP,
): MidiHit | null {
  const data = event.data
  if (!data || data.length < 3) return null

  const status = data[0]
  const note = data[1]
  const velocity = data[2]

  const channel = status & 0x0f
  const messageType = status & 0xf0

  // Solo noteOn en canal 10 (channel index 9)
  const isNoteOn = messageType === 0x90
  const isDrumChannel = channel === MIDI_DRUM_CHANNEL

  if (!isNoteOn || !isDrumChannel) return null

  // noteOn con velocity 0 = noteOff en Roland — ignorar
  if (velocity < MIN_VELOCITY) return null

  const instrument = resolveInstrument(note, midiMap)
  if (!instrument) return null

  return {
    instrument,
    midi: note,
    velocity,
    timestamp: event.timeStamp ?? performance.now(),
  }
}

// Exportar instancia singleton
export const midiManager = new MidiManager()
