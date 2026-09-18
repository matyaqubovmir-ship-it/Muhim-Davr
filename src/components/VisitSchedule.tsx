import { SCHEDULE_ZONE_NOTES, UI, VISIT_STATUS_LABELS } from '../lib/labels'
import { ZONE_CLASS } from '../lib/zone-style'
import {
  findNextVisit,
  formatISODate,
  generateSchedule,
  intervalFromPrevious,
  startOfDay,
  type RiskZoneForSchedule,
} from '../lib/schedule'

/**
 * The upcoming contact schedule. Every date comes from generateSchedule, which
 * is arithmetic on the LMP and a fixed week table — see the header of
 * src/lib/schedule.ts.
 */
export function VisitSchedule({
  lmpDate,
  zone,
  today = new Date(),
}: {
  lmpDate: Date | null
  zone: RiskZoneForSchedule
  today?: Date
}) {
  if (lmpDate === null) {
    return (
      <section className="mt-6">
        <h2 className="mb-2 border-b border-border pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase">
          {UI.scheduleTitle}
        </h2>
        <p className="py-1 text-sm leading-snug text-slate-600">{UI.scheduleNeedsGa}</p>
      </section>
    )
  }

  const schedule = generateSchedule({ lmpDate, currentZone: zone, today })
  const next = findNextVisit(schedule, today)
  const now = startOfDay(today)

  return (
    <section className="mt-6">
      <h2 className="mb-2 border-b border-border pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase">
        {UI.scheduleTitle}
      </h2>

      <p className="text-sm leading-snug text-slate-700">{SCHEDULE_ZONE_NOTES[zone]}</p>
      <p className="mt-0.5 text-xs text-text-muted">{UI.scheduleBasis}</p>

      <ol className="mt-3 space-y-1.5">
        {schedule.map((visit, index) => {
          const isNext = next !== null && visit.contactNumber === next.contactNumber
          const isToday = visit.targetDate.getTime() === now.getTime()
          const interval = intervalFromPrevious(schedule, index)
          const missed = visit.status === "o'tkazib yuborilgan"

          return (
            <li
              key={visit.contactNumber}
              className={[
                'rounded-md border p-2.5',
                isNext
                  ? `border-2 bg-surface ${ZONE_CLASS[zone].border}`
                  : missed
                    ? 'border-border bg-bg'
                    : 'border-border bg-surface',
              ].join(' ')}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={[
                    'text-sm font-semibold',
                    missed ? 'text-text-muted' : 'text-text-primary',
                  ].join(' ')}
                >
                  {visit.contactNumber}. {visit.targetWeek}-{UI.week}
                </span>

                {/* The zone-adjusted interval, visible per contact. */}
                {interval !== null ? (
                  <span className="text-xs text-text-muted">
                    +{interval} {UI.week}
                  </span>
                ) : null}

                {isNext ? (
                  <span
                    className={['rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase', ZONE_CLASS[zone].solid].join(' ')}
                  >
                    {isToday ? UI.today : UI.nextVisit}
                  </span>
                ) : null}
              </div>

              <div
                className={[
                  'mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm',
                  missed ? 'text-text-muted' : 'text-slate-700',
                ].join(' ')}
              >
                <span>{formatISODate(visit.targetDate)}</span>
                <span className="text-xs">{/* The calendar knows the date passed, not whether she came: never "missed". */}
                  {missed ? UI.pastContact : VISIT_STATUS_LABELS[visit.status]}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
