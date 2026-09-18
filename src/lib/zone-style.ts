/**
 * How a zone is drawn, in one place.
 *
 * ZONE_COLORS in labels.ts is the zone's colour; everything here is built
 * around it and mirrors the @theme tokens in src/index.css. zone-style.test.ts
 * checks the two stay equal, and computes the WCAG contrast of every pairing
 * the app puts on screen — none of it is judged by eye.
 *
 * The one rule that is not obvious: on a SOLID zone fill, text is white on
 * qizil and yashil but dark on sariq. White on that amber is 3.7:1, which fails
 * AA for ordinary text; dark ink is 4.8:1.
 *
 * A zone is never shown by colour alone: every badge carries the word
 * (ZONE_NAMES) and a shape — an octagon for qizil, a triangle for sariq, a
 * circle for yashil (components/Zone.tsx).
 */

import { ZONE_COLORS } from './labels'
import type { RiskZone } from './risk'

export const TOKENS = {
  bg: '#F7F9FB',
  surface: '#FFFFFF',
  border: '#E3E8EF',
  textPrimary: '#0F172A',
  textMuted: '#64748B',
  brand: '#2563EB',
  brandSoft: '#EFF6FF',
} as const

/** Background steps of each zone, for pills and washes. Never for text. */
export const ZONE_SOFT: Record<RiskZone, string> = {
  qizil: '#FBEAE8',
  sariq: '#FCF1DF',
  yashil: '#E7F3ED',
}

/** Text and inner marks on a solid zone fill. */
export const ZONE_ON_SOLID: Record<RiskZone, string> = {
  qizil: '#FFFFFF',
  sariq: TOKENS.textPrimary,
  yashil: '#FFFFFF',
}

/**
 * Tailwind classes per zone, written out in full so Tailwind finds them — a
 * class name assembled at runtime would never be generated.
 */
export const ZONE_CLASS: Record<
  RiskZone,
  { solid: string; soft: string; text: string; borderTop: string; borderLeft: string; border: string }
> = {
  qizil: {
    solid: 'bg-zone-qizil text-white',
    soft: 'bg-zone-qizil-soft',
    text: 'text-zone-qizil',
    borderTop: 'border-t-zone-qizil',
    borderLeft: 'border-l-zone-qizil',
    border: 'border-zone-qizil',
  },
  sariq: {
    solid: 'bg-zone-sariq text-text-primary',
    soft: 'bg-zone-sariq-soft',
    text: 'text-zone-sariq',
    borderTop: 'border-t-zone-sariq',
    borderLeft: 'border-l-zone-sariq',
    border: 'border-zone-sariq',
  },
  yashil: {
    solid: 'bg-zone-yashil text-white',
    soft: 'bg-zone-yashil-soft',
    text: 'text-zone-yashil',
    borderTop: 'border-t-zone-yashil',
    borderLeft: 'border-l-zone-yashil',
    border: 'border-zone-yashil',
  },
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two #RRGGBB colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Re-exported so callers needing the raw hex take it from one import. */
export { ZONE_COLORS }
