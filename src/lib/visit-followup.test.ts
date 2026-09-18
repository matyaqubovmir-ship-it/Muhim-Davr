import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { scoreAssessment } from './risk'
import { raiseClinicEscalation, readRecordedLmp, saveSchedule } from './visit-followup'

interface Recorded {
  inserts: { table: string; row: unknown }[]
  rpcs: { name: string; args: Record<string, unknown> }[]
}

/** Just enough of a Supabase client for these three functions. */
function fakeClient(options: {
  insertError?: { code?: string; message: string }
  rpcResult?: { data: unknown; error: { message: string } | null }
  lmpDate?: string | null
  throws?: boolean
}): { client: SupabaseClient; recorded: Recorded } {
  const recorded: Recorded = { inserts: [], rpcs: [] }
  const client = {
    from(table: string) {
      if (options.throws) throw new Error('network down')
      return {
        insert: async (row: unknown) => {
          recorded.inserts.push({ table, row })
          return { error: options.insertError ?? null }
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: options.lmpDate === undefined ? null : { lmp_date: options.lmpDate },
              error: null,
            }),
          }),
        }),
      }
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (options.throws) throw new Error('network down')
      recorded.rpcs.push({ name, args })
      return options.rpcResult ?? { data: 3, error: null }
    },
  }
  return { client: client as unknown as SupabaseClient, recorded }
}

const RED = scoreAssessment({ bp_systolic: 170, bp_diastolic: 112 })
const GREEN = scoreAssessment({ bp_systolic: 110, bp_diastolic: 70, hemoglobin: 125, proteinuria: false, age: 25 })

describe('raiseClinicEscalation', () => {
  it('inserts a clinic escalation for a red assessment', async () => {
    const { client, recorded } = fakeClient({})
    expect(await raiseClinicEscalation(client, 'a-1', 'p-1', RED)).toEqual({ kind: 'sent' })
    expect(recorded.inserts).toEqual([
      {
        table: 'escalations',
        row: expect.objectContaining({
          assessment_id: 'a-1',
          pregnancy_id: 'p-1',
          source: 'clinic',
          fired_factors: ['severe_hypertension'],
        }),
      },
    ])
  })

  it('writes nothing for an assessment that is not red', async () => {
    const { client, recorded } = fakeClient({})
    expect(await raiseClinicEscalation(client, 'a-1', 'p-1', GREEN)).toEqual({ kind: 'not_needed' })
    expect(recorded.inserts).toHaveLength(0)
  })

  it('treats "already escalated" as sent, so a retry is safe', async () => {
    const { client } = fakeClient({ insertError: { code: '23505', message: 'duplicate' } })
    expect(await raiseClinicEscalation(client, 'a-1', 'p-1', RED)).toEqual({ kind: 'sent' })
  })

  it('reports a failure instead of throwing', async () => {
    const refused = fakeClient({ insertError: { code: '42501', message: 'denied' } })
    expect(await raiseClinicEscalation(refused.client, 'a-1', 'p-1', RED)).toEqual({
      kind: 'failed',
      message: 'denied',
    })
    const offline = fakeClient({ throws: true })
    expect(await raiseClinicEscalation(offline.client, 'a-1', 'p-1', RED)).toEqual({
      kind: 'failed',
      message: 'network down',
    })
  })
})

describe('readRecordedLmp', () => {
  it('reads pregnancies.lmp_date as a local date', async () => {
    const { client } = fakeClient({ lmpDate: '2026-03-15' })
    expect(await readRecordedLmp(client, 'p-1')).toEqual(new Date(2026, 2, 15))
  })

  it('is null when none is recorded or the read fails', async () => {
    expect(await readRecordedLmp(fakeClient({ lmpDate: null }).client, 'p-1')).toBeNull()
    expect(await readRecordedLmp(fakeClient({ throws: true }).client, 'p-1')).toBeNull()
  })
})

describe('saveSchedule', () => {
  const today = new Date(2026, 7, 31)
  const write = {
    pregnancyId: 'p-1',
    assessmentId: 'a-1',
    lmpDate: new Date(2026, 0, 5),
    zone: 'yashil' as const,
    today,
  }

  it('sends the upcoming contacts, today and the assessment to replace_planned_visits', async () => {
    const { client, recorded } = fakeClient({})
    expect(await saveSchedule(client, write)).toEqual({ kind: 'saved', planned: 3 })
    expect(recorded.rpcs).toEqual([
      {
        name: 'replace_planned_visits',
        args: {
          p_pregnancy_id: 'p-1',
          p_today: '2026-08-31',
          p_assessment_id: 'a-1',
          p_visits: [
            { target_week: 36, target_date: '2026-09-14' },
            { target_week: 38, target_date: '2026-09-28' },
            { target_week: 40, target_date: '2026-10-12' },
          ],
        },
      },
    ])
  })

  it('writes nothing at all without an anchor — an empty list would delete her schedule', async () => {
    const { client, recorded } = fakeClient({})
    expect(await saveSchedule(client, { ...write, lmpDate: null })).toEqual({ kind: 'no_anchor' })
    expect(recorded.rpcs).toHaveLength(0)
  })

  it('reports a failure instead of throwing', async () => {
    const missing = fakeClient({ rpcResult: { data: null, error: { message: 'function not found' } } })
    expect(await saveSchedule(missing.client, write)).toEqual({
      kind: 'failed',
      message: 'function not found',
    })
    expect(await saveSchedule(fakeClient({ throws: true }).client, write)).toEqual({
      kind: 'failed',
      message: 'network down',
    })
  })
})

describe('replace_planned_visits — the client and the migration agree', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/004_persist_schedule.sql', import.meta.url),
    'utf8',
  )

  it('calls the function with exactly the parameters 004 declares', async () => {
    const signature = /create or replace function replace_planned_visits\(([\s\S]*?)\)\s*returns/.exec(sql)
    expect(signature, 'replace_planned_visits not found in 004').not.toBeNull()
    const declared = [...signature![1].matchAll(/\b(p_\w+)\s+\w+/g)].map((m) => m[1])

    const { client, recorded } = fakeClient({})
    await saveSchedule(client, {
      pregnancyId: 'p',
      assessmentId: 'a',
      lmpDate: new Date(2026, 0, 5),
      zone: 'sariq',
      today: new Date(2026, 5, 1),
    })
    expect(Object.keys(recorded.rpcs[0].args).sort()).toEqual([...declared].sort())
  })

  it('makes the contact-number constraint deferrable, which the renumbering needs', () => {
    expect(sql).toMatch(/unique \(pregnancy_id, contact_number\) deferrable/)
  })
})
