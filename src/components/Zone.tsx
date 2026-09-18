import { REGISTRY_UI, ZONE_COLORS, ZONE_NAMES } from '../lib/labels'
import type { RiskZone } from '../lib/risk'
import { ZONE_CLASS, ZONE_ON_SOLID } from '../lib/zone-style'

/**
 * A zone's shape, so the zone reads without colour: an octagon with "!" for
 * qizil (stop), a triangle with "!" for sariq (caution), a circle with a tick
 * for yashil. Decorative next to the word, so hidden from screen readers.
 */
export function ZoneIcon({ zone, size = 14 }: { zone: RiskZone | null; size?: number }) {
  if (zone === null) {
    // Not assessed: an empty dashed circle — neither a warning nor an all-clear.
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="#64748B" strokeWidth="1.5" strokeDasharray="2.5 2" />
      </svg>
    )
  }
  const fill = ZONE_COLORS[zone]
  const mark = ZONE_ON_SOLID[zone]
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      {zone === 'qizil' ? (
        <>
          <path d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z" fill={fill} />
          <rect x="7.1" y="3.8" width="1.8" height="5.6" rx="0.9" fill={mark} />
          <circle cx="8" cy="11.7" r="1.1" fill={mark} />
        </>
      ) : null}
      {zone === 'sariq' ? (
        <>
          <path d="M8 1.2 15.2 14.4H0.8z" fill={fill} strokeLinejoin="round" />
          <rect x="7.15" y="5.4" width="1.7" height="4.8" rx="0.85" fill={mark} />
          <circle cx="8" cy="12.2" r="1" fill={mark} />
        </>
      ) : null}
      {zone === 'yashil' ? (
        <>
          <circle cx="8" cy="8" r="7" fill={fill} />
          <path d="M4.8 8.2 7 10.4l4.3-4.6" fill="none" stroke={mark} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </svg>
  )
}

/**
 * The everyday zone badge: the soft step behind, the word in body ink, the
 * shape in the zone colour. Colours cross-fade when the zone changes.
 */
export function ZonePill({ zone, size = 'sm' }: { zone: RiskZone | null; size?: 'sm' | 'md' }) {
  const text = size === 'md' ? 'text-sm' : 'text-xs'
  const pad = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5'
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-semibold tracking-wide text-text-primary transition-colors duration-500',
        text,
        pad,
        zone === null ? 'border border-dashed border-slate-300 bg-surface' : ZONE_CLASS[zone].soft,
      ].join(' ')}
    >
      <ZoneIcon zone={zone} size={size === 'md' ? 14 : 12} />
      {zone === null ? REGISTRY_UI.unassessed.toUpperCase() : ZONE_NAMES[zone]}
    </span>
  )
}

/**
 * The headline badge: the zone's own colour, with the text colour that clears
 * AA on it — white on qizil and yashil, dark on sariq.
 */
export function ZoneSolid({ zone, className = '' }: { zone: RiskZone; className?: string }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 rounded-md font-semibold tracking-wide transition-colors duration-500',
        ZONE_CLASS[zone].solid,
        className,
      ].join(' ')}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
        {/* The shape in the badge's own text colour, so it reads on the fill. */}
        {zone === 'qizil' ? <path d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z" fill="none" stroke={ZONE_ON_SOLID[zone]} strokeWidth="1.6" /> : null}
        {zone === 'sariq' ? <path d="M8 1.6 14.8 14H1.2z" fill="none" stroke={ZONE_ON_SOLID[zone]} strokeWidth="1.6" strokeLinejoin="round" /> : null}
        {zone === 'yashil' ? <circle cx="8" cy="8" r="6.4" fill="none" stroke={ZONE_ON_SOLID[zone]} strokeWidth="1.6" /> : null}
      </svg>
      {ZONE_NAMES[zone]}
    </span>
  )
}
