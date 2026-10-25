// ─── Etiquetas ID3v2 (título y artista) para rellenar el formulario de Importar ──
// Solo lo necesario: cabecera ID3v2.2/2.3/2.4 y los marcos de texto TIT2/TPE1
// (TT2/TP1 en 2.2). El worker hace lo mismo con ffprobe; esto evita esperar a subir.

export interface Id3Tags {
  title?: string
  artist?: string
}

const synchsafe = (b: Uint8Array, i: number) =>
  ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)

const uint32 = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0

function decodeText(data: Uint8Array): string {
  if (data.length === 0) return ''
  const body = data.subarray(1)
  let text: string
  switch (data[0]) {
    case 1: // UTF-16 con BOM
      text = new TextDecoder(body[0] === 0xfe && body[1] === 0xff ? 'utf-16be' : 'utf-16le').decode(
        body,
      )
      break
    case 2:
      text = new TextDecoder('utf-16be').decode(body)
      break
    case 3:
      text = new TextDecoder('utf-8').decode(body)
      break
    default:
      text = new TextDecoder('latin1').decode(body)
  }
  // Quita BOM y terminadores; con varios valores (2.4) se queda con el primero
  return text
    .replace(/^\uFEFF/, '')
    .split('\u0000')[0]
    .trim()
}

const FRAMES: Record<string, keyof Id3Tags> = {
  TIT2: 'title',
  TPE1: 'artist',
  TT2: 'title',
  TP1: 'artist',
}

/** Bytes que ocupa la etiqueta (cabecera incluida) según sus 10 primeros bytes; 0 si no hay. */
export function id3TagLength(header: ArrayBuffer): number {
  const b = new Uint8Array(header)
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0
  return 10 + synchsafe(b, 6)
}

/** Lee título y artista de la cabecera ID3v2 de un MP3 (vacío si no hay). */
export function readId3Tags(buffer: ArrayBuffer): Id3Tags {
  const b = new Uint8Array(buffer)
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {}
  const version = b[3]
  if (version < 2 || version > 4) return {}
  const flags = b[5]
  const end = Math.min(b.length, 10 + synchsafe(b, 6))
  let i = 10
  // Cabecera extendida (2.3/2.4): se salta
  if (flags & 0x40 && version >= 3) i += version === 4 ? synchsafe(b, i) : uint32(b, i) + 4

  const idLength = version === 2 ? 3 : 4
  const headerLength = version === 2 ? 6 : 10
  const tags: Id3Tags = {}
  while (i + headerLength <= end) {
    if (b[i] === 0) break // relleno
    const id = String.fromCharCode(...b.subarray(i, i + idLength))
    const size =
      version === 2
        ? (b[i + 3] << 16) | (b[i + 4] << 8) | b[i + 5]
        : version === 4
          ? synchsafe(b, i + 4)
          : uint32(b, i + 4)
    const start = i + headerLength
    if (size <= 0 || start + size > end) break
    const key = FRAMES[id]
    if (key && !tags[key]) {
      const value = decodeText(b.subarray(start, start + size))
      if (value) tags[key] = value
    }
    i = start + size
  }
  return tags
}
