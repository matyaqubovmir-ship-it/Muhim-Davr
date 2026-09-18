/**
 * The demo data is only worth showing if the scorer still puts each woman
 * where the pitch says she is. If the rules change, this fails before the
 * demo does.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_PATIENT, PATIENTS, WORSENING_VISIT, plan, scoreVisit } from './seed-demo.ts'

describe('the demo data', () => {
  for (const today of [new Date(2026, 8, 18), new Date(2026, 8, 19), new Date(2027, 0, 5)]) {
    it(`scores as expected and has exactly one overdue woman, seeded ${today.toDateString()}`, () => {
      const lines = plan(today)
      expect(lines.filter((l) => l.includes('OVERDUE')).map((l) => l.split(/\s{2,}/)[0])).toEqual(['Zarina Qurbonova'])
    })
  }

  it('ends with every zone present, and one woman not yet assessed', () => {
    const latest = PATIENTS.map((p) => (p.telegram ? p.telegram.expect : p.visits.at(-1)?.expect ?? null))
    expect(new Set(latest)).toEqual(new Set(['qizil', 'sariq', 'yashil', null]))
  })

  it('turns the demo patient from sariq to qizil on stage, on absolute flags alone', () => {
    const p = PATIENTS.find((x) => x.name === DEMO_PATIENT)!
    expect(p.visits.at(-1)?.expect).toBe('sariq')
    const result = scoreVisit(p, { ga: 30, ...WORSENING_VISIT })
    expect(result.zone).toBe('qizil')
    expect(result.firedFactors).toEqual(expect.arrayContaining(['severe_hypertension', 'preeclampsia_suspected']))
  })

  it('carries no contact details: nothing here can message a real person', () => {
    expect(JSON.stringify(PATIENTS)).not.toMatch(/\+?998|phone|chat_id|national/i)
  })
})
