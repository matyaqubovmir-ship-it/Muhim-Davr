import { useState } from 'react'
import { FOLLOW_UP_UI } from '../lib/labels'
import type { RiskResult } from '../lib/risk'
import { getAuthedSupabase } from '../lib/supabase'
import { raiseClinicEscalation, type EscalationOutcome } from '../lib/visit-followup'
import { Button } from './Button'

/**
 * Whether the doctor was told about this red assessment.
 *
 * Silent when there was nothing to escalate. When the escalation could not be
 * written it says so in red, in the normal flow, with a retry — the midwife is
 * the only person who knows it failed, and "the doctor was not told" is not
 * something she may have to infer from an absence.
 */
export function EscalationNotice({
  initial,
  assessmentId,
  pregnancyId,
  result,
}: {
  initial: EscalationOutcome
  assessmentId: string
  pregnancyId: string
  result: RiskResult
}) {
  const [outcome, setOutcome] = useState<EscalationOutcome>(initial)
  const [retrying, setRetrying] = useState(false)

  async function retry() {
    setRetrying(true)
    try {
      const client = await getAuthedSupabase()
      setOutcome(await raiseClinicEscalation(client, assessmentId, pregnancyId, result))
    } catch (caught) {
      setOutcome({ kind: 'failed', message: caught instanceof Error ? caught.message : String(caught) })
    } finally {
      setRetrying(false)
    }
  }

  if (outcome.kind === 'not_needed') return null

  if (outcome.kind === 'sent') {
    return (
      <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-slate-800">
        {FOLLOW_UP_UI.escalationSent}
      </p>
    )
  }

  return (
    <div role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 p-3">
      <p className="text-sm font-semibold text-red-900">{FOLLOW_UP_UI.escalationFailed}</p>
      <p className="mt-1 text-xs break-words text-red-800">({outcome.message})</p>
      <Button variant="danger" size="sm" className="mt-2" loading={retrying} onClick={retry}>
        {retrying ? FOLLOW_UP_UI.escalationRetrying : FOLLOW_UP_UI.escalationRetry}
      </Button>
    </div>
  )
}
