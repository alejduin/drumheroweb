import { describe, expect, it } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT, THEME_COLORS, applyAccent } from '@/constants/theme'
import themeCss from '@/styles/theme.css?raw'

function cssColors(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map(m => [
      m[1],
      m[2].toLowerCase(),
    ]),
  )
}

function block(selector: string): string {
  const start = themeCss.indexOf(selector)
  expect(start, `falta ${selector} en theme.css`).toBeGreaterThanOrEqual(0)
  return themeCss.slice(start, themeCss.indexOf('}', start))
}

describe('tokens de tema', () => {
  it('THEME_COLORS refleja exactamente los colores de @theme', () => {
    expect(THEME_COLORS).toEqual(cssColors(block('@theme')))
  })

  it('los acentos alternativos coinciden con theme.css', () => {
    for (const [name, { accent, soft }] of Object.entries(ACCENTS)) {
      if (name === DEFAULT_ACCENT) {
        expect(THEME_COLORS.accent).toBe(accent)
        expect(THEME_COLORS['accent-soft']).toBe(soft)
        continue
      }
      const colors = cssColors(block(`:root[data-accent='${name}']`))
      expect(colors).toEqual({ accent, 'accent-soft': soft })
    }
  })

  it('applyAccent pone y quita data-accent', () => {
    const root = document.createElement('html')
    applyAccent('pink', root)
    expect(root.dataset.accent).toBe('pink')
    applyAccent(DEFAULT_ACCENT, root)
    expect(root.hasAttribute('data-accent')).toBe(false)
  })
})
