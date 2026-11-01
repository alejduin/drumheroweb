// Iconos de la pantalla de juego (heredan el color del texto)

export function PauseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="3" y="2" width="3.5" height="12" rx="1" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
    </svg>
  )
}

export function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M4 2.5 L13.5 8 L4 13.5 Z" />
    </svg>
  )
}

export function RestartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="2.5" y="2.5" width="2.2" height="11" rx="0.8" />
      <path d="M13.5 2.5 L5.5 8 L13.5 13.5 Z" />
    </svg>
  )
}

export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3 3 L11 11 M11 3 L3 11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function VideoPlaceholderIcon() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      aria-hidden="true"
      className="text-border-dashed"
    >
      <circle cx="28" cy="28" r="27" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M23 18 L39 28 L23 38 Z" fill="currentColor" />
    </svg>
  )
}
