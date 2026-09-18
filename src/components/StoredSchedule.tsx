import { UI, VISITS_UI } from '../lib/labels'
import type { StoredVisit } from '../lib/patient-detail'
import { formatDay } from '../lib/registry'
import { startOfDay } from '../lib/schedule'
import { CheckIcon, SendIcon } from './Icons'

const DAY_MS = 86_400_000

/**
 * Her schedule as it is stored — the rows the bot reminds her from and the
 * calendar lists — rather than one recomputed from today's date. What a
 * clinician sees here is what the patient is told.
 */
export function StoredSchedule({
  visits,
  hasTelegram,
  today = new Date(),
}: {
  visits: readonly StoredVisit[]
  hasTelegram: boolean
  today?: Date
}) {
  const now = startOfDay(today).getTime()
  const next = visits.find((v) => v.status === 'rejalashtirilgan' && startOfDay(v.targetDate).getTime() >= now)

  return (
    <div>
      <p className="mb-3 text-xs leading-snug text-text-muted">{VISITS_UI.storedNote}</p>
      <ol className="space-y-2">
        {visits.map((visit) => {
          const day = startOfDay(visit.targetDate).getTime()
          const days = Math.round((day - now) / DAY_MS)
          const done = visit.status === 'bajarilgan'
          const overdue = visit.status === 'rejalashtirilgan' && days < 0
          const isNext = visit === next

          return (
            <li
              key={visit.id}
              className={[
                'rounded-xl border p-3 transition-colors',
                isNext
                  ? 'border-brand/60 bg-brand-soft/60 shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
                  : overdue
                    ? 'border-amber-300 bg-amber-50/70'
                    : 'border-border bg-surface',
              ].join(' ')}
            >
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className={['text-sm font-semibold', done ? 'text-text-muted' : 'text-text-primary'].join(' ')}>
                  {visit.contactNumber}. {visit.targetWeek}-{VISITS_UI.week}
                </span>
                <span className="text-sm text-slate-700 tabular-nums">{formatDay(visit.targetDate)}</span>

                {done ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-zone-yashil-soft px-2 py-0.5 text-xs font-semibold text-zone-yashil">
                    <CheckIcon size={13} /> {VISITS_UI.done}
                  </span>
                ) : overdue ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    {VISITS_UI.pastPlanned} · {VISITS_UI.daysOverdue(-days)}
                  </span>
                ) : isNext ? (
                  <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
                    {days === 0 ? UI.today : `${UI.nextVisit} · ${VISITS_UI.inDays(days)}`}
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">{days === 0 ? UI.today : VISITS_UI.inDays(days)}</span>
                )}
              </div>

              {/* Whether the patient hears about it: what was sent, what will be, or that nobody will. */}
              {!done ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {!hasTelegram ? (
                    <span className="text-amber-800">{VISITS_UI.noTelegram}</span>
                  ) : visit.remindersSent.length > 0 ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-sky-800">
                        <SendIcon size={12} /> {VISITS_UI.remindersSent}:
                      </span>
                      {visit.remindersSent.map((kind) => (
                        <span key={kind} className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800 ring-1 ring-sky-200">
                          {kind === 'ikki_kun' ? VISITS_UI.reminderTwoDays : VISITS_UI.reminderMorning}
                        </span>
                      ))}
                    </>
                  ) : days >= 0 ? (
                    <span className="inline-flex items-center gap-1 text-text-muted">
                      <SendIcon size={12} /> {VISITS_UI.reminderWillSend}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
