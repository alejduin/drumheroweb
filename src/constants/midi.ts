// ─── MIDI (Roland TD-02KV) ────────────────────────────────────────────────────

// Canal MIDI de batería Roland (canal 10, index 9)
export const MIDI_DRUM_CHANNEL = 9

// Status byte de noteOn en canal 10
export const MIDI_NOTE_ON_STATUS = 0x99

// Velocidad mínima para considerar un golpe válido (filtrar fantasmas)
export const MIN_VELOCITY = 5
