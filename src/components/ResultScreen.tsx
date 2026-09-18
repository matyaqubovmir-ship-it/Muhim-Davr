import {
  DOCUMENT_UI,
  FACTOR_SENTENCES,
  FOLLOW_UP_UI,
  MISSING_FIELD_NAMES,
  UI,
  ZONE_ADVICE,
  ZONE_COLORS,
  ZONE_NAMES,
} from '../lib/labels'
import type { SavedVisit } from '../lib/visit-followup'
import { ZONE_CLASS } from '../lib/zone-style'
import { Button } from './Button'
import { EscalationNotice } from './EscalationNotice'
import { CheckIcon, FileIcon, PlusIcon } from './Icons'
import { LinkCode } from './LinkCode'
import { ProtocolReminders } from './ProtocolReminders'
import { VisitSchedule } from './VisitSchedule'

export function ResultScreen({
  saved,
  onNewEntry,
}: {
  saved: SavedVisit
  onNewEntry: () => void
}) {
  const { result, assessmentId, pregnancyId, lmpDate, schedule } = saved
  const color = ZONE_COLORS[result.zone]
  const missing = result.missingCriticalFields

  return (
    <div className="pb-24">
      {/*
        The zone's own colour, with the text colour that clears AA on it: white
        on qizil and yashil, dark on sariq (white on that amber is 3.7:1). No
        opacity on the text — it would pull the small lines below AA.
      */}
      <div
        className={[
          'mt-4 rounded-xl px-4 py-7 text-center transition-colors duration-500',
          ZONE_CLASS[result.zone].solid,
        ].join(' ')}
      >
        <div className="flex items-center justify-center gap-3 text-5xl leading-none font-semibold tracking-tight">
          <svg width="40" height="40" viewBox="0 0 16 16" aria-hidden="true">
            {result.zone === 'qizil' ? <path d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z" fill="none" stroke="currentColor" strokeWidth="1.4" /> : null}
            {result.zone === 'sariq' ? <path d="M8 1.6 14.8 14H1.2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /> : null}
            {result.zone === 'yashil' ? <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.4" /> : null}
          </svg>
          {ZONE_NAMES[result.zone]}
        </div>
        <div className="mt-3 text-sm leading-snug">{ZONE_ADVICE[result.zone]}</div>
        <div className="mt-4 text-sm">
          {UI.score}: <span className="font-semibold">{result.score}</span>
        </div>
      </div>

      <EscalationNotice
        initial={saved.escalation}
        assessmentId={assessmentId}
        pregnancyId={pregnancyId}
        result={result}
      />

      {/*
        Not an error panel. Incomplete data is part of the result, so it sits in
        the normal flow in the same neutral frame as the factor list, not in a
        red alert box that a midwife learns to dismiss.
      */}
      {missing.length > 0 ? (
        <section className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">{UI.incompleteTitle}</h2>
          <p className="mt-1.5 text-sm leading-snug text-amber-900">{UI.incompleteBody}</p>
          <ul className="mt-2 list-inside list-disc text-sm leading-relaxed text-amber-900">
            {missing.map((field) => (
              <li key={field}>{MISSING_FIELD_NAMES[field]}</li>
            ))}
          </ul>
          <p className="mt-2.5 text-sm leading-snug font-medium text-amber-900">
            {UI.incompleteNote}
          </p>
        </section>
      ) : null}

      <section className="mt-5">
        <h2 className="mb-2 border-b border-border pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase">
          {UI.factorsTitle}
        </h2>
        {result.firedFactors.length === 0 ? (
          <p className="py-1 text-sm text-slate-600">{UI.noFactors}</p>
        ) : (
          <ul className="divide-y divide-border">
            {result.firedFactors.map((factor) => (
              <li
                key={factor}
                className="flex gap-2.5 py-2.5 text-sm leading-snug text-slate-800"
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span>{FACTOR_SENTENCES[factor]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <VisitSchedule lmpDate={lmpDate} zone={result.zone} />

      {/* Whether the dates above were stored, which is what the reminders read. */}
      {schedule.kind === 'saved' ? (
        <p className="mt-2 text-xs leading-snug text-text-muted">{FOLLOW_UP_UI.scheduleSaved}</p>
      ) : null}
      {schedule.kind === 'failed' ? (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm leading-snug text-amber-900">
          {FOLLOW_UP_UI.scheduleFailed}{' '}
          <span className="text-xs break-words">({schedule.message})</span>
        </p>
      ) : null}

      {/* The lab sheet, if one was uploaded: kept with the record, or why not. */}
      {saved.document !== null ? (
        <p
          className={[
            'mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-sm leading-snug',
            saved.document.kind === 'saved'
              ? 'border-violet-200 bg-violet-50 text-violet-900'
              : 'border-amber-300 bg-amber-50 text-amber-900',
          ].join(' ')}
        >
          {saved.document.kind === 'saved' ? <CheckIcon size={16} className="mt-0.5" /> : <FileIcon size={16} className="mt-0.5" />}
          <span>
            {saved.document.kind === 'saved'
              ? DOCUMENT_UI.savedDoc
              : saved.document.kind === 'not_configured'
                ? DOCUMENT_UI.docNotConfigured
                : `${DOCUMENT_UI.docFailed} (${saved.document.message})`}
          </span>
        </p>
      ) : null}

      <ProtocolReminders />

      <LinkCode pregnancyId={pregnancyId} />

      {assessmentId ? (
        <p className="mt-5 text-xs break-all text-text-muted">
          {UI.savedAs}: {assessmentId}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto max-w-lg">
          <Button variant="primary" size="lg" fullWidth onClick={onNewEntry} icon={<PlusIcon size={18} />}>
            {UI.newEntry}
          </Button>
        </div>
      </div>
    </div>
  )
}
