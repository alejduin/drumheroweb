import { mapPlayerState } from './sync'
import type { VideoState } from './sync'
import type { VideoPlayer } from './SyncManager'

// ─── IFrame Player API (tipos mínimos de lo que se usa) ───────────────────────

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
  setPlaybackRate(rate: number): void
  mute(): void
  isMuted(): boolean
  destroy(): void
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: () => void
        onError?: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api'
const API_TIMEOUT_MS = 15000

let apiPromise: Promise<YTNamespace> | null = null

/** Carga el script de la API una sola vez. */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = API_SRC
    script.async = true
    script.onerror = () => {
      apiPromise = null
      script.remove()
      reject(new Error('No se pudo cargar YouTube (¿sin conexión?)'))
    }
    document.head.appendChild(script)
    // Si el script carga pero la API nunca avisa (bloqueadores), no esperar para siempre
    window.setTimeout(() => {
      if (window.YT?.Player) return
      apiPromise = null
      reject(new Error('YouTube no respondió'))
    }, API_TIMEOUT_MS)
  })
  return apiPromise
}

// Sin controles ni teclado: el video solo se mueve con el reloj del MP3
const PLAYER_VARS = {
  controls: 0,
  disablekb: 1,
  fs: 0,
  iv_load_policy: 3,
  modestbranding: 1,
  playsinline: 1,
  rel: 0,
  mute: 1,
}

const ERRORS: Record<number, string> = {
  2: 'el enlace no es válido',
  5: 'el video no se puede reproducir en el navegador',
  100: 'el video no existe o es privado',
  101: 'el autor no permite verlo fuera de YouTube',
  150: 'el autor no permite verlo fuera de YouTube',
}

/**
 * YouTubePlayer — el reproductor de YouTube, siempre silenciado (CLAUDE.md, regla 3).
 * `create` resuelve cuando el video está listo para recibir órdenes.
 */
export class YouTubePlayer implements VideoPlayer {
  private readonly yt: YTPlayer

  private constructor(yt: YTPlayer) {
    this.yt = yt
  }

  static async create(
    element: HTMLElement,
    videoId: string,
    onError: (message: string) => void,
  ): Promise<YouTubePlayer> {
    const YT = await loadApi()
    return new Promise(resolve => {
      const yt = new YT.Player(element, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: PLAYER_VARS,
        events: {
          onReady: () => {
            yt.mute()
            resolve(new YouTubePlayer(yt))
          },
          onError: e => onError(ERRORS[e.data] ?? `error ${e.data} del reproductor`),
        },
      })
    })
  }

  currentTime(): number {
    return this.yt.getCurrentTime()
  }

  state(): VideoState {
    return mapPlayerState(this.yt.getPlayerState())
  }

  play(): void {
    this.yt.mute()
    this.yt.playVideo()
  }

  pause(): void {
    this.yt.pauseVideo()
  }

  seekTo(seconds: number): void {
    this.yt.seekTo(seconds, true)
  }

  setPlaybackRate(rate: number): void {
    this.yt.setPlaybackRate(rate)
  }

  ensureMuted(): void {
    if (!this.yt.isMuted()) this.yt.mute()
  }

  destroy(): void {
    this.yt.destroy()
  }
}
