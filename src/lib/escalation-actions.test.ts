import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  acknowledgeEscalation,
  acknowledgePatch,
  averageAckMinutes,
  closeEscalation,
  closePatch,
  formatElapsed,
  minutesBetween,
  urgencyFor,
} from './escalation-actions'
import { QUEUE_UI } from './labels'

const NOW = new Date('2026-09-18T12:00:00Z')

describe('the two moves the schema allows', () => {
  // escalations_status_timestamps in 001_schema.sql, restated as the test oracle:
  // qabul needs acknowledged_at and no closed_at; yopiq needs both.
  const sql = readFileSync(new URL('../../supabase/migrations/001_schema.sql', import.meta.url), 'utf8')

  it('the constraint the patches are written against is still in the schema', () => {
    expect(sql).toContain("when 'qabul' then acknowledged_at is not null and closed_at is null")
    expect(sql).toContain("when 'yopiq' then acknowledged_at is not null and closed_at is not null")
  })

  it('acknowledging sets status, time and who — and nothing about closing', () => {
    expect(acknowledgePatch('u-1', NOW)).toEqual({
      status: 'qabul',
      acknowledged_at: NOW.toISOString(),
      acknowledged_by: 'u-1',
    })
  })

  it('closing sets status, time, who and the trimmed note', () => {
    expect(closePatch('u-1', NOW, '  Yo‘naltirildi  ')).toEqual({
      status: 'yopiq',
      closed_at: NOW.toISOString(),
      closed_by: 'u-1',
      resolution_note: 'Yo‘naltirildi',
    })
  })
})

/** Records the update chain; answers with the given matched rows. */
function fakeClient(matched: unknown[]) {
  const calls: { method: string; args: unknown[] }[] = []
  const builder: Record<string, unknown> = {}
  for (const method of ['update', 'eq', 'select']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: matched, error: null })
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: () => builder,
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('acknowledgeEscalation and closeEscalation', () => {
  it('only acknowledges an escalation that is still open', async () => {
    const { client, calls } = fakeClient([{ id: 'e' }])
    expect(await acknowledgeEscalation(client, 'e', NOW)).toBe('done')
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'ochiq'] })
  })

  it('reports it when someone else got there first, instead of overwriting', async () => {
    const { client } = fakeClient([])
    expect(await acknowledgeEscalation(client, 'e', NOW)).toBe('already_handled')
  })

  it('only closes an acknowledged escalation, and never without a note', async () => {
    const { client, calls } = fakeClient([{ id: 'e' }])
    expect(await closeEscalation(client, 'e', 'Tug‘ruqxonaga yuborildi', NOW)).toBe('done')
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'qabul'] })
    await expect(closeEscalation(client, 'e', '   ', NOW)).rejects.toThrow(QUEUE_UI.noteRequired)
  })
})

describe('elapsed time', () => {
  it('reads as a clinician would say it', () => {
    expect(formatElapsed(0)).toBe(QUEUE_UI.justNow)
    expect(formatElapsed(12)).toBe(`12 ${QUEUE_UI.minutes}`)
    expect(formatElapsed(60)).toBe(`1 ${QUEUE_UI.hours}`)
    expect(formatElapsed(185)).toBe(`3 ${QUEUE_UI.hours} 5 ${QUEUE_UI.minutes}`)
    expect(formatElapsed(3 * 24 * 60 + 5)).toBe(`3 ${QUEUE_UI.days}`)
  })

  it('never goes negative when a clock is behind', () => {
    expect(minutesBetween(NOW, new Date(NOW.getTime() - 60_000))).toBe(0)
  })

  it('grows more urgent while an escalation stays open, and stops once acknowledged', () => {
    expect(urgencyFor('ochiq', 5)).toBe('calm')
    expect(urgencyFor('ochiq', 15)).toBe('waiting')
    expect(urgencyFor('ochiq', 60)).toBe('overdue')
    expect(urgencyFor('qabul', 600)).toBe('calm')
  })

  it('averages time-to-acknowledge over acknowledged escalations only', () => {
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
    expect(
      averageAckMinutes([
        { createdAt: NOW, acknowledgedAt: at(10) },
        { createdAt: NOW, acknowledgedAt: at(30) },
        { createdAt: NOW, acknowledgedAt: null },
      ]),
    ).toBe(20)
    expect(averageAckMinutes([])).toBe(null)
  })
})
