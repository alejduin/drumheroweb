export interface SongMeta {
  id: string
  title: string
  artist: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  bpm: number
}

/** Catálogo de canciones disponibles. Añadir entradas aquí al agregar JSONs a /public/songs/. */
export const SONG_LIBRARY: SongMeta[] = [
  {
    id: 'basic-rock-001',
    title: 'Basic Rock Beat',
    artist: 'DrumHero',
    difficulty: 'beginner',
    bpm: 80,
  },
  {
    id: 'hihat-groove-002',
    title: 'Hi-Hat Groove',
    artist: 'DrumHero',
    difficulty: 'intermediate',
    bpm: 95,
  },
  {
    id: 'full-kit-003',
    title: 'Full Kit Challenge',
    artist: 'DrumHero',
    difficulty: 'advanced',
    bpm: 110,
  },
]
