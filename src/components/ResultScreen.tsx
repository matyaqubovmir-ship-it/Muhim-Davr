import {
  FACTOR_SENTENCES,
  MISSING_FIELD_NAMES,
  UI,
  ZONE_ADVICE,
  ZONE_COLORS,
  ZONE_NAMES,
} from '../lib/labels'
import type { RiskResult } from '../lib/risk'
import { LinkCode } from './LinkCode'
import { ProtocolReminders } from './ProtocolReminders'
import { VisitSchedule } from './VisitSchedule'

export function ResultScreen({
  result,
  assessmentId,
  pregnancyId,
  lmpDate,
  onNewEntry,
}: {
  result: RiskResult
  assessmentId: string
  pregnancyId: string
  lmpDate: Date | null
  onNewEntry: () => void
}) {
  const color = ZONE_COLORS[result.zone]
  const missing = result.missingCriticalFields

  return (
    <div className="pb-24">
      <div
        className="mt-4 rounded-xl px-4 py-7 text-center text-white"
        style={{ backgroundColor: color }}
      >
        <div className="text-5xl leading-none font-bold tracking-tight">
          {ZONE_NAMES[result.zone]}
        </div>
        <div className="mt-3 text-sm leading-snug opacity-95">
          {ZONE_ADVICE[result.zone]}
        </div>
        <div className="mt-4 text-sm opacity-90">
          {UI.score}: <span className="font-semibold">{result.score}</span>
        </div>
      </div>

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
        <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {UI.factorsTitle}
        </h2>
        {result.firedFactors.length === 0 ? (
          <p className="py-1 text-sm text-slate-600">{UI.noFactors}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
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

      <ProtocolReminders />

      <LinkCode pregnancyId={pregnancyId} />

      {assessmentId ? (
        <p className="mt-5 text-xs break-all text-slate-400">
          {UI.savedAs}: {assessmentId}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={onNewEntry}
            className="min-h-12 w-full rounded-lg bg-slate-900 text-base font-semibold text-white"
          >
            {UI.newEntry}
          </button>
        </div>
      </div>
    </div>
  )
}
