/**
 * The palette, checked rather than eyeballed: the tokens in src/index.css
 * agree with the TypeScript copies, and every colour pairing the app draws
 * clears its WCAG threshold — 4.5:1 for text, 3:1 for large text and for
 * non-text marks (icons, borders, chart bands' edges).
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ZONE_COLORS } from './labels'
import type { RiskZone } from './risk'
import { TOKENS, ZONE_ON_SOLID, ZONE_SOFT, contrastRatio } from './zone-style'

const ZONES: RiskZone[] = ['qizil', 'sariq', 'yashil']
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)
  expect(match, `--color-${name} missing from index.css`).not.toBeNull()
  return match![1].toUpperCase()
}

describe('index.css tokens agree with the TypeScript copies', () => {
  it.each(ZONES)('%s: the solid colour equals ZONE_COLORS and the soft step equals ZONE_SOFT', (zone) => {
    expect(token(`zone-${zone}`)).toBe(ZONE_COLORS[zone].toUpperCase())
    expect(token(`zone-${zone}-soft`)).toBe(ZONE_SOFT[zone].toUpperCase())
  })

  it('the neutral tokens equal TOKENS', () => {
    expect(token('bg')).toBe(TOKENS.bg.toUpperCase())
    expect(token('surface')).toBe(TOKENS.surface.toUpperCase())
    expect(token('border')).toBe(TOKENS.border.toUpperCase())
    expect(token('text-primary')).toBe(TOKENS.textPrimary.toUpperCase())
    expect(token('text-muted')).toBe(TOKENS.textMuted.toUpperCase())
    expect(token('brand')).toBe(TOKENS.brand.toUpperCase())
    expect(token('brand-soft')).toBe(TOKENS.brandSoft.toUpperCase())
  })
})

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })
})

describe('every zone pairing on screen clears WCAG AA', () => {
  it.each(ZONES)('%s: text on its solid fill (badges, result card) ≥ 4.5', (zone) => {
    expect(contrastRatio(ZONE_ON_SOLID[zone], ZONE_COLORS[zone])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(ZONES)('%s: the word on its soft pill ≥ 4.5', (zone) => {
    expect(contrastRatio(TOKENS.textPrimary, ZONE_SOFT[zone])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(ZONES)('%s: its icon on its soft pill ≥ 3 (non-text mark)', (zone) => {
    expect(contrastRatio(ZONE_COLORS[zone], ZONE_SOFT[zone])).toBeGreaterThanOrEqual(3)
  })

  it.each(ZONES)('%s: large numerals, borders and icons on surface and page background ≥ 3', (zone) => {
    expect(contrastRatio(ZONE_COLORS[zone], TOKENS.surface)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(ZONE_COLORS[zone], TOKENS.bg)).toBeGreaterThanOrEqual(3)
  })

  it('white on sariq is below AA for ordinary text — which is why sariq gets dark ink', () => {
    expect(contrastRatio('#FFFFFF', ZONE_COLORS.sariq)).toBeLessThan(4.5)
  })
})

describe('the neutral pairings clear WCAG AA', () => {
  it('body and muted text on surface and background ≥ 4.5', () => {
    for (const background of [TOKENS.surface, TOKENS.bg]) {
      expect(contrastRatio(TOKENS.textPrimary, background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(TOKENS.textMuted, background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('white on brand buttons, and brand links on surface ≥ 4.5', () => {
    expect(contrastRatio('#FFFFFF', TOKENS.brand)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.brand, TOKENS.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.brand, TOKENS.brandSoft)).toBeGreaterThanOrEqual(4.5)
  })
})
