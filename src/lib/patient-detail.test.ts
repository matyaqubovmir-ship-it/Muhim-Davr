import { readdirSync, readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  ageOn,
  formatVisit,
  headerFigures,
  latestRecordedGa,
  loadPatientDetail,
  niceDomain,
  slotLabels,
  ticks,
  type AssessmentPoint,
  type PatientDetail,
} from './patient-detail'

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)
const TODAY = d(2026, 9, 18)

const point = (overrides: Partial<AssessmentPoint>): AssessmentPoint => ({
  id: 'a',
  visitDate: TODAY,
  createdAt: new Date(2026, 8, 18, 10, 29),
  bpSystolic: null,
  bpDiastolic: null,
  hemoglobin: null,
  zone: 'yashil',
  score: 0,
  firedFactors: [],
  recordedBy: 'midwife',
  gestationalAgeWeeks: null,
  ...overrides,
})

describe('ageOn', () => {
  it('counts whole years, turning over on the birthday', () => {
    expect(ageOn(d(1996, 4, 12), TODAY)).toBe(30)
    expect(ageOn(d(1996, 9, 18), TODAY)).toBe(30)
    expect(ageOn(d(1996, 9, 19), TODAY)).toBe(29)
  })
})

describe('latestRecordedGa', () => {
  it('takes the most recent assessment that wrote a gestational age down', () => {
    expect(
      latestRecordedGa([
        point({ gestationalAgeWeeks: 20, visitDate: d(2026, 8, 1) }),
        point({ gestationalAgeWeeks: 24, visitDate: d(2026, 8, 29) }),
        point({ gestationalAgeWeeks: null, visitDate: d(2026, 9, 10) }),
      ]),
    ).toEqual({ weeks: 24, on: d(2026, 8, 29) })
  })

  it('is null when none did', () => {
    expect(latestRecordedGa([point({})])).toBe(null)
  })
})

describe('headerFigures', () => {
  const detail = (header: Partial<PatientDetail['header']>, assessments: AssessmentPoint[] = []): PatientDetail => ({
    header: {
      pregnancyId: 'p',
      fullName: 'Test Bemor',
      district: 'T',
      village: null,
      birthDate: d(1996, 4, 12),
      gravida: 2,
      para: 1,
      lmpDate: null,
      lmpEstimated: null,
      eddDate: null,
      isActive: true,
      outcome: null,
      ...header,
    },
    currentZone: 'qizil',
    assessments,
    escalations: [],
    hasTelegram: false,
    reports: [],
  })

  it('works out age, week and a computed due date from the recorded LMP', () => {
    expect(headerFigures(detail({ lmpDate: d(2026, 4, 3) }), TODAY)).toEqual({
      age: 30,
      gestationalWeek: 24,
      dueDate: { date: d(2027, 1, 8), computed: true },
    })
  })

  it('shows a recorded EDD as recorded', () => {
    expect(headerFigures(detail({ lmpDate: d(2026, 4, 3), eddDate: d(2027, 1, 10) }), TODAY).dueDate).toEqual({
      date: d(2027, 1, 10),
      computed: false,
    })
  })

  it('falls back to the latest recorded gestational age, and to nothing', () => {
    const withGa = detail({}, [point({ gestationalAgeWeeks: 20, visitDate: d(2026, 8, 21) })])
    expect(headerFigures(withGa, TODAY).gestationalWeek).toBe(24)
    expect(headerFigures(detail({ birthDate: null }), TODAY)).toEqual({
      age: null,
      gestationalWeek: null,
      dueDate: null,
    })
  })
})

describe('niceDomain and ticks', () => {
  it('frames the values in clean steps with a half step of margin', () => {
    expect(niceDomain([95, 150, 165], 20)).toEqual([80, 180])
    expect(ticks([80, 180], 20)).toEqual([80, 100, 120, 140, 160, 180])
    expect(niceDomain([47, 95], 20)).toEqual([20, 120])
  })

  it('gives a lone value room either side, and never goes below zero', () => {
    expect(niceDomain([100], 20)).toEqual([80, 120])
    expect(niceDomain([5], 20)).toEqual([0, 40])
    expect(niceDomain([], 20)).toEqual([0, 80])
  })
})

describe('slotLabels', () => {
  it('adds the time only where a day holds more than one assessment', () => {
    expect(
      slotLabels([
        point({ visitDate: d(2026, 9, 1), createdAt: new Date(2026, 8, 1, 9, 5) }),
        point({ visitDate: d(2026, 9, 18), createdAt: new Date(2026, 8, 18, 10, 10) }),
        point({ visitDate: d(2026, 9, 18), createdAt: new Date(2026, 8, 18, 15, 29) }),
      ]),
    ).toEqual([
      { date: '01.09', time: null },
      { date: '18.09', time: '10:10' },
      { date: '18.09', time: '15:29' },
    ])
  })
})

describe('formatVisit', () => {
  it('uses the visit date, and the saved time', () => {
    expect(formatVisit({ visitDate: d(2026, 9, 17), createdAt: new Date(2026, 8, 18, 3, 7) })).toBe('17.09.2026 03:07')
  })
})

// --- loadPatientDetail, against a stand-in client ---------------------------

type Result = { data?: unknown; error?: { message: string } | null; count?: number }

/** Each table answers with a fixed result, whatever the filter chain. */
function fakeClient(tables: Record<string, Result>): { client: SupabaseClient; selects: Record<string, string> } {
  const selects: Record<string, string> = {}
  const client = {
    from(table: string) {
      const result = { data: null, error: null, ...tables[table] }
      const builder: Record<string, unknown> = {
        select(columns: string) {
          selects[table] = columns
          return builder
        },
        eq: () => builder,
        order: () => builder,
        maybeSingle: async () => result,
        then: (resolve: (value: Result) => unknown) => resolve(result),
      }
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, selects }
}

const LIVE_SHAPED = {
  pregnancies: {
    data: {
      id: 'p-1',
      lmp_date: '2026-04-03',
      lmp_estimated: false,
      edd_date: null,
      gravida: 2,
      para: 1,
      is_active: true,
      outcome: null,
      patients: { full_name: 'Test Bemor', birth_date: '1996-04-12', district: 'T', village: 'V' },
    },
  },
  latest_assessment_per_pregnancy: { data: { risk_zone: 'qizil' } },
  assessments: {
    data: [
      {
        id: 'a-1',
        visit_date: '2026-09-18',
        created_at: '2026-09-18T10:29:28+05:00',
        bp_systolic: 165,
        bp_diastolic: 112,
        hemoglobin: null,
        risk_zone: 'qizil',
        risk_score: 8,
        fired_factors: ['severe_hypertension'],
        recorded_by: 'midwife',
        gestational_age_weeks: null,
      },
    ],
  },
  escalations: {
    data: [
      {
        id: 'e-1',
        status: 'ochiq',
        source: 'clinic',
        reason: 'r',
        fired_factors: ['severe_hypertension'],
        created_at: '2026-09-18T10:29:28+05:00',
        acknowledged_at: null,
        closed_at: null,
        referred_to: null,
        resolution_note: null,
      },
    ],
  },
  patient_channels: { count: 0 },
  patient_reports: { data: [] },
}

describe('loadPatientDetail', () => {
  it('assembles the page from its rows, nulls kept as nulls', async () => {
    const detail = await loadPatientDetail(fakeClient(LIVE_SHAPED).client, 'p-1')
    expect(detail?.header).toEqual(
      expect.objectContaining({ fullName: 'Test Bemor', gravida: 2, para: 1, lmpDate: d(2026, 4, 3), eddDate: null }),
    )
    expect(detail?.currentZone).toBe('qizil')
    expect(detail?.assessments[0]).toEqual(
      expect.objectContaining({ bpSystolic: 165, bpDiastolic: 112, hemoglobin: null, score: 8, visitDate: TODAY }),
    )
    expect(detail?.escalations[0]).toEqual(expect.objectContaining({ status: 'ochiq', source: 'clinic', acknowledgedAt: null }))
    expect(detail?.hasTelegram).toBe(false)
  })

  it('is null for a pregnancy that does not exist', async () => {
    expect(await loadPatientDetail(fakeClient({ ...LIVE_SHAPED, pregnancies: { data: null } }).client, 'nope')).toBe(null)
  })

  it('shows no zone rather than a guessed one when the view has none', async () => {
    const detail = await loadPatientDetail(
      fakeClient({ ...LIVE_SHAPED, latest_assessment_per_pregnancy: { data: null } }).client,
      'p-1',
    )
    expect(detail?.currentZone).toBe(null)
  })

  it('fails loudly rather than rendering a partial page', async () => {
    await expect(
      loadPatientDetail(fakeClient({ ...LIVE_SHAPED, escalations: { error: { message: 'denied' } } }).client, 'p-1'),
    ).rejects.toThrow('denied')
  })

  it('selects only columns the migrations define', async () => {
    const { client, selects } = fakeClient(LIVE_SHAPED)
    await loadPatientDetail(client, 'p-1')
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const sql = readdirSync(dir)
      .map((file) => readFileSync(new URL(file, dir), 'utf8'))
      .join('\n')
    const columns = Object.values(selects)
      .flatMap((s) => s.replace(/[a-z_]+!?[a-z_]*\(/g, ',').replace(/\)/g, '').split(','))
      .map((c) => c.trim())
      .filter((c) => c !== '')
    expect(columns.length).toBeGreaterThan(30)
    for (const column of columns) {
      expect(sql, `${column} is in no migration`).toMatch(new RegExp(`\\b${column}\\b`))
    }
  })
})
