// ─── Tokens para canvas ───────────────────────────────────────────────────────
// Espejo de src/styles/theme.css para lo que se pinta en Canvas 2D (partitura,
// forma de onda, efectos). Un test verifica que los valores coinciden.

export const THEME_COLORS = {
  bg: '#0b0c10',
  'surface-header': '#101117',
  surface: '#13141b',
  'surface-2': '#171922',
  'surface-inset': '#0e0f14',
  'surface-video': '#15161d',
  'surface-idle': '#1b1d26',
  track: '#262938',
  border: '#22252f',
  'border-strong': '#2e3240',
  'border-dashed': '#3a3e4d',
  fg: '#ecedf2',
  'fg-2': '#c9ccd8',
  muted: '#9aa0b4',
  faint: '#6b6f7e',
  accent: '#a78bfa',
  'accent-soft': '#221e35',
  'on-accent': '#15161c',
  perfect: '#10b981',
  'perfect-strong': '#059669',
  'perfect-fg': '#34d399',
  'perfect-bg': '#13261f',
  'perfect-border': '#1e4a39',
  'perfect-text': '#a7f3d0',
  close: '#d97706',
  'close-fg': '#fbbf24',
  'close-bg': '#2a2312',
  'close-border': '#5c4710',
  'close-text': '#fde68a',
  miss: '#dc2626',
  wrong: '#9aa0b4',
  paper: '#f4f2ec',
  'paper-ink': '#2a2c35',
  'paper-future': '#1c1d24',
  'paper-chip': '#e4e1d8',
  'paper-muted': '#4b4f5e',
  'paper-active': '#ffffff',
} as const

export type ThemeColor = keyof typeof THEME_COLORS

export const ACCENTS = {
  violet: { accent: '#a78bfa', soft: '#221e35' },
  blue: { accent: '#60a5fa', soft: '#182333' },
  pink: { accent: '#f472b6', soft: '#2e1b29' },
} as const

export type AccentName = keyof typeof ACCENTS

export const DEFAULT_ACCENT: AccentName = 'violet'

export const FONT_SANS = "'Archivo', system-ui, sans-serif"
export const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace"

/** Aplica el acento a toda la UI (atributo data-accent en <html>, ver theme.css). */
export function applyAccent(name: AccentName, root: HTMLElement = document.documentElement): void {
  if (name === DEFAULT_ACCENT) root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', name)
}
