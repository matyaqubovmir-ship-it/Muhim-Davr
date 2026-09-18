import { PATIENT_PAGE_UI, ZONE_COLORS, ZONE_NAMES } from '../lib/labels'
import { niceDomain, slotLabels, ticks, type AssessmentPoint } from '../lib/patient-detail'
import { useWidth } from '../lib/use-width'

/**
 * Series colours: the first three slots of the dataviz reference palette,
 * validated as a set against the white card (all pairs pass CVD and
 * normal-vision separation; aqua is below 3:1, which the chart's title and the
 * table beside it relieve). Fixed per measure, never per position.
 */
const SERIES = {
  systolic: '#2a78d6',
  diastolic: '#eb6834',
  hemoglobin: '#1baf7a',
} as const

const GRID = '#e2e8f0'
const AXIS_TEXT = '#64748b'
const LABEL_TEXT = '#475569'

const MARGIN = { top: 10, right: 70, bottom: 34, left: 40 }

interface Series {
  key: keyof typeof SERIES
  label: string
  values: (number | null)[]
}

/** Runs of consecutive recorded values. A missing value breaks the line rather than bridging it. */
function segments(values: readonly (number | null)[]): { i: number; v: number }[][] {
  const runs: { i: number; v: number }[][] = []
  let run: { i: number; v: number }[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length > 0) runs.push(run)
      run = []
    } else {
      run.push({ i, v })
    }
  })
  if (run.length > 0) runs.push(run)
  return runs
}

function Panel({
  width,
  plotHeight,
  step,
  series,
  assessments,
  active,
  onHover,
  onSelect,
  ariaLabel,
}: {
  width: number
  plotHeight: number
  step: number
  series: Series[]
  assessments: readonly AssessmentPoint[]
  active: number | null
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
  ariaLabel: string
}) {
  const n = assessments.length
  const plotLeft = MARGIN.left
  const plotRight = width - MARGIN.right
  const plotTop = MARGIN.top
  const plotBottom = MARGIN.top + plotHeight
  const slot = (plotRight - plotLeft) / n
  const cx = (i: number) => plotLeft + slot * (i + 0.5)

  const recorded = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const domain = niceDomain(recorded, step)
  const y = (v: number) => plotBottom - ((v - domain[0]) / (domain[1] - domain[0])) * plotHeight

  const labels = slotLabels(assessments)
  // Thin the x labels when slots get narrow, always keeping the latest.
  const every = Math.max(1, Math.ceil(40 / slot))

  // End labels name each line where it ends; if two would collide, the legend
  // carries identity instead of nudged labels drifting off their lines.
  // A single series has no end label: the panel's title already names it.
  const ends = series
    .filter((s) => s.label !== '')
    .map((s) => {
      const last = [...s.values.keys()].reverse().find((i) => s.values[i] !== null)
      return last === undefined ? null : { key: s.key, label: s.label, y: y(s.values[last] as number) }
    })
    .filter((e): e is { key: Series['key']; label: string; y: number } => e !== null)
  const endsCollide = ends.length > 1 && Math.abs(ends[0].y - ends[1].y) < 14

  return (
    <svg
      width={width}
      height={plotBottom + MARGIN.bottom}
      role="img"
      aria-label={ariaLabel}
      className="block touch-manipulation select-none"
    >
      {/* zone bands: a wash per assessment, the zone's own colour as a strip on top */}
      {assessments.map((a, i) => (
        <g key={`band-${a.id}`}>
          <rect
            x={plotLeft + slot * i + 1}
            y={plotTop}
            width={Math.max(0, slot - 2)}
            height={plotHeight}
            fill={ZONE_COLORS[a.zone]}
            fillOpacity={active === i ? 0.2 : 0.1}
          />
          <rect x={plotLeft + slot * i + 1} y={plotTop} width={Math.max(0, slot - 2)} height={4} fill={ZONE_COLORS[a.zone]} />
        </g>
      ))}

      {/* grid and y ticks: solid hairlines, recessive */}
      {ticks(domain, step).map((t) => (
        <g key={`tick-${t}`}>
          <line x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={plotLeft - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={AXIS_TEXT} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t}
          </text>
        </g>
      ))}

      {active !== null ? (
        <line x1={cx(active)} x2={cx(active)} y1={plotTop} y2={plotBottom} stroke="#334155" strokeWidth={1} />
      ) : null}

      {series.map((s) =>
        segments(s.values).map((run) => (
          <g key={`${s.key}-${run[0].i}`}>
            {run.length > 1 ? (
              <path
                d={run.map((p, k) => `${k === 0 ? 'M' : 'L'}${cx(p.i)},${y(p.v)}`).join(' ')}
                fill="none"
                stroke={SERIES[s.key]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {run.map((p) => (
              <circle
                key={p.i}
                cx={cx(p.i)}
                cy={y(p.v)}
                r={active === p.i ? 5.5 : 4}
                fill={SERIES[s.key]}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
          </g>
        )),
      )}

      {!endsCollide
        ? ends.map((e) => (
            <text key={`end-${e.key}`} x={plotRight + 8} y={e.y + 4} fontSize={12} fill={LABEL_TEXT}>
              {e.label}
            </text>
          ))
        : null}

      {labels.map((label, i) =>
        i % every === 0 || i === n - 1 ? (
          <text key={`x-${i}`} x={cx(i)} y={plotBottom + 15} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
            <tspan x={cx(i)}>{label.date}</tspan>
            {label.time !== null ? (
              <tspan x={cx(i)} dy={13}>
                {label.time}
              </tspan>
            ) : null}
          </text>
        ) : null,
      )}

      {/* hit areas: the whole column, far larger than any mark */}
      {assessments.map((a, i) => (
        <rect
          key={`hit-${a.id}`}
          x={plotLeft + slot * i}
          y={plotTop}
          width={slot}
          height={plotHeight}
          fill="transparent"
          className="cursor-pointer"
          onPointerEnter={() => onHover(i)}
          onPointerLeave={() => onHover(null)}
          onClick={() => onSelect(i)}
        />
      ))}
    </svg>
  )
}

function LineKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span aria-hidden="true" className="inline-block h-0.5 w-3.5 rounded" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

/**
 * Blood pressure and haemoglobin across her assessments, one slot per
 * assessment in the order they were made, each slot washed in that
 * assessment's zone.
 *
 * Two panels, never one: mmHg and g/L on a shared axis would invent a relation
 * between the two lines. Slots rather than a calendar axis because several
 * assessments often share a day, and a date axis would stack them on one point;
 * each slot is labelled with its date, and its time when the day repeats.
 */
export function AssessmentChart({
  assessments,
  active,
  onHover,
  onSelect,
}: {
  assessments: readonly AssessmentPoint[]
  active: number | null
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const bp: Series[] = [
    { key: 'systolic', label: PATIENT_PAGE_UI.systolic, values: assessments.map((a) => a.bpSystolic) },
    { key: 'diastolic', label: PATIENT_PAGE_UI.diastolic, values: assessments.map((a) => a.bpDiastolic) },
  ]
  const hb: Series[] = [{ key: 'hemoglobin', label: '', values: assessments.map((a) => a.hemoglobin) }]
  const hasBp = bp.some((s) => s.values.some((v) => v !== null))
  const hasHb = hb[0].values.some((v) => v !== null)
  const zones = assessments.map((a) => ZONE_NAMES[a.zone]).join(', ')

  return (
    <div ref={ref} className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">{PATIENT_PAGE_UI.bpChart}</h3>
          <div className="flex gap-3">
            <LineKey color={SERIES.systolic} label={PATIENT_PAGE_UI.systolic} />
            <LineKey color={SERIES.diastolic} label={PATIENT_PAGE_UI.diastolic} />
          </div>
        </div>
        {!hasBp ? (
          <p className="mt-1 text-sm text-slate-600">{PATIENT_PAGE_UI.noBp}</p>
        ) : width > 0 ? (
          <Panel
            width={width}
            plotHeight={170}
            step={20}
            series={bp}
            assessments={assessments}
            active={active}
            onHover={onHover}
            onSelect={onSelect}
            ariaLabel={`${PATIENT_PAGE_UI.bpChart}. ${zones}`}
          />
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-800">{PATIENT_PAGE_UI.hbChart}</h3>
        {!hasHb ? (
          <p className="mt-1 text-sm text-slate-600">{PATIENT_PAGE_UI.noHb}</p>
        ) : width > 0 ? (
          <Panel
            width={width}
            plotHeight={110}
            step={20}
            series={hb}
            assessments={assessments}
            active={active}
            onHover={onHover}
            onSelect={onSelect}
            ariaLabel={`${PATIENT_PAGE_UI.hbChart}. ${zones}`}
          />
        ) : null}
      </div>
    </div>
  )
}
