import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NOT_SEEN_AFTER_DAYS,
  changedDistricts,
  changedPatients,
  currentGestationalWeek,
  dueDate,
  formatDay,
  groupByZone,
  sortDistricts,
  sortPatients,
  staleness,
  stalenessText,
  toRegistryPatient,
  type DistrictSummary,
  type RegistryPatient,
  type RegistryRow,
} from './registry'

const TODAY = new Date(2026, 8, 18)
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)

const summary = (district: string, qizil: number, sariq: number, yashil: number, unassessed = 0): DistrictSummary => ({
  district,
  qizil,
  sariq,
  yashil,
  unassessed,
  total: qizil + sariq + yashil + unassessed,
})

describe('sortDistricts', () => {
  it('leads with the most red, then the most yellow, then the largest, then by name', () => {
    const sorted = sortDistricts([
      summary('Xiva', 0, 5, 9),
      summary('Hazorasp', 2, 0, 1),
      summary('Gurlan', 0, 5, 1),
      summary('Urganch', 2, 1, 0),
      summary('Bog‘ot', 0, 5, 1),
    ])
    expect(sorted.map((s) => s.district)).toEqual(['Urganch', 'Hazorasp', 'Xiva', 'Bog‘ot', 'Gurlan'])
  })
})

describe('currentGestationalWeek', () => {
  it('counts from the recorded LMP', () => {
    expect(currentGestationalWeek(d(2026, 4, 3), null, null, TODAY)).toBe(24)
  })

  it('counts forward from the latest recorded gestational age when there is no LMP', () => {
    expect(currentGestationalWeek(null, 20, d(2026, 8, 21), TODAY)).toBe(24)
  })

  it('prefers the LMP over a recorded gestational age', () => {
    expect(currentGestationalWeek(d(2026, 4, 3), 30, d(2026, 9, 1), TODAY)).toBe(24)
  })

  it('is unknown with neither, and never negative', () => {
    expect(currentGestationalWeek(null, null, null, TODAY)).toBe(null)
    expect(currentGestationalWeek(d(2026, 10, 1), null, null, TODAY)).toBe(null)
  })
})

describe('dueDate', () => {
  it('uses the recorded EDD as recorded', () => {
    expect(dueDate(d(2027, 1, 8), d(2026, 4, 3), null, null)).toEqual({ date: d(2027, 1, 8), computed: false })
  })

  it('computes 280 days from the LMP, marked as computed', () => {
    expect(dueDate(null, d(2026, 4, 3), null, null)).toEqual({ date: d(2027, 1, 8), computed: true })
  })

  it('computes from the latest gestational age when there is no LMP', () => {
    // 20 weeks on 21 August leaves 20 weeks: 8 January.
    expect(dueDate(null, null, 20, d(2026, 8, 21))).toEqual({ date: d(2027, 1, 8), computed: true })
  })

  it('is unknown with nothing to go on', () => {
    expect(dueDate(null, null, null, null)).toBe(null)
  })
})

describe('staleness', () => {
  it('flags a planned contact whose date has passed', () => {
    expect(staleness(d(2026, 8, 1), d(2026, 9, 10), TODAY)).toEqual({ kind: 'overdue', since: d(2026, 9, 10) })
  })

  it('does not flag a contact planned for today', () => {
    expect(staleness(d(2026, 8, 1), TODAY, TODAY)).toBe(null)
  })

  it('does not flag a long gap when the next contact is still ahead', () => {
    expect(staleness(d(2026, 6, 1), d(2026, 10, 1), TODAY)).toBe(null)
  })

  it('flags a woman no midwife has assessed', () => {
    expect(staleness(null, null, TODAY)).toEqual({ kind: 'never_seen' })
  })

  it(`without a stored schedule, flags more than ${NOT_SEEN_AFTER_DAYS} days unseen`, () => {
    expect(staleness(d(2026, 8, 7), null, TODAY)).toBe(null) // 42 days
    expect(staleness(d(2026, 8, 6), null, TODAY)).toEqual({ kind: 'not_seen', days: 43 })
  })
})

const row = (overrides: Partial<RegistryRow>): RegistryRow => ({
  pregnancy_id: 'p',
  full_name: 'Test Bemor',
  district: 'T',
  village: null,
  lmp_date: null,
  edd_date: null,
  risk_zone: null,
  last_clinic_visit_date: null,
  latest_ga_weeks: null,
  latest_ga_on: null,
  earliest_planned_visit: null,
  ...overrides,
})

describe('toRegistryPatient', () => {
  it('turns a registry_pregnancies row into what the screen shows', () => {
    const patient = toRegistryPatient(
      row({
        pregnancy_id: 'p-1',
        village: 'Sanoat',
        lmp_date: '2026-04-03',
        risk_zone: 'qizil',
        last_clinic_visit_date: '2026-09-18',
        earliest_planned_visit: '2026-10-30',
      }),
      TODAY,
    )
    expect(patient).toEqual({
      pregnancyId: 'p-1',
      fullName: 'Test Bemor',
      district: 'T',
      village: 'Sanoat',
      zone: 'qizil',
      gestationalWeek: 24,
      dueDate: { date: d(2027, 1, 8), computed: true },
      lastVisit: TODAY,
      staleness: null,
    })
  })

  it('keeps a never-assessed pregnancy as no zone at all', () => {
    const patient = toRegistryPatient(row({}), TODAY)
    expect(patient.zone).toBe(null)
    expect(patient.staleness).toEqual({ kind: 'never_seen' })
  })
})

const patient = (id: string, zone: RegistryPatient['zone'], extra: Partial<RegistryPatient> = {}): RegistryPatient => ({
  pregnancyId: id,
  fullName: id,
  district: 'T',
  village: null,
  zone,
  gestationalWeek: null,
  dueDate: null,
  lastVisit: d(2026, 9, 1),
  staleness: null,
  ...extra,
})

describe('groupByZone', () => {
  it('puts every patient in her zone, and the unassessed in their own group', () => {
    const groups = groupByZone([patient('a', 'qizil'), patient('b', null), patient('c', 'yashil')])
    expect(groups.qizil.map((p) => p.pregnancyId)).toEqual(['a'])
    expect(groups.sariq).toEqual([])
    expect(groups.yashil.map((p) => p.pregnancyId)).toEqual(['c'])
    expect(groups.unassessed.map((p) => p.pregnancyId)).toEqual(['b'])
  })

  it('orders a zone: needs chasing first, then longest unseen, then by name', () => {
    const groups = groupByZone([
      patient('recent', 'sariq', { lastVisit: d(2026, 9, 15) }),
      patient('older', 'sariq', { lastVisit: d(2026, 8, 1) }),
      patient('overdue', 'sariq', { lastVisit: d(2026, 9, 16), staleness: { kind: 'overdue', since: d(2026, 9, 17) } }),
      patient('never', 'sariq', { lastVisit: null }),
    ])
    expect(groups.sariq.map((p) => p.pregnancyId)).toEqual(['overdue', 'never', 'older', 'recent'])
  })
})

describe('what changed between two reads', () => {
  it('names districts whose counts moved, and new ones', () => {
    expect(
      changedDistricts(
        [summary('Urganch', 1, 1, 1), summary('Xiva', 0, 1, 0)],
        [summary('Urganch', 2, 0, 1), summary('Xiva', 0, 1, 0), summary('Gurlan', 0, 0, 1)],
      ),
    ).toEqual(['Urganch', 'Gurlan'])
  })

  it('names patients whose zone moved, and new ones', () => {
    expect(
      changedPatients(
        [patient('a', 'sariq'), patient('b', 'yashil')],
        [patient('a', 'qizil'), patient('b', 'yashil'), patient('c', null)],
      ),
    ).toEqual(['a', 'c'])
  })
})

describe('formatDay', () => {
  it('writes DD.MM.YYYY', () => {
    expect(formatDay(d(2027, 1, 8))).toBe('08.01.2027')
  })
})

describe('the registry reads only what migration 005 defines', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/005_latest_assessment_view.sql', import.meta.url),
    'utf8',
  )
  const source = readFileSync(new URL('./registry.ts', import.meta.url), 'utf8')

  it.each(['latest_assessment_per_pregnancy', 'registry_pregnancies', 'registry_district_counts'])(
    'defines %s as a security_invoker view',
    (view) => {
      expect(sql).toMatch(new RegExp(`create view ${view}\\s+with \\(security_invoker = true\\)`))
    },
  )

  it('every column the app selects exists in the views', () => {
    const selects = [...source.matchAll(/\.select\(\s*((?:'[^']*'\s*\+?\s*)+),?\s*\)/g)].map((m) =>
      m[1].replace(/'\s*\+\s*'/g, '').replace(/'/g, ''),
    )
    expect(selects.length).toBe(2)
    for (const column of selects.flatMap((s) => s.split(',').map((c) => c.trim()))) {
      expect(sql, `${column} is not in 005`).toMatch(new RegExp(`\\b${column}\\b`))
    }
  })
})

describe('no geography in code', () => {
  // Districts come from patients.district. A place name in the app's source is
  // a place the registry claims to cover whether or not anyone lives there.
  const PLACES = [
    'Xorazm', 'Urganch', 'Xiva', 'Hazorasp', 'Xonqa', 'Shovot', 'Gurlan', 'Bog‘ot',
    'Yangiariq', 'Yangibozor', 'Qo‘shko‘pir', 'Tuproqqal', 'Toshkent', 'Samarqand',
    'Buxoro', 'Andijon', 'Farg‘ona', 'Namangan', 'Qashqadaryo', 'Surxondaryo',
    'Navoiy', 'Jizzax', 'Sirdaryo', 'Qoraqalpog',
  ]
  const srcDir = fileURLToPath(new URL('..', import.meta.url))
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return files(path)
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })

  it('src/ names no viloyat or tuman', () => {
    for (const file of files(srcDir)) {
      const text = readFileSync(file, 'utf8')
      for (const place of PLACES) {
        expect(text.includes(place), `${place} in ${file}`).toBe(false)
      }
    }
  })
})

describe('sortPatients — the registry table', () => {
  const list = [
    patient('green', 'yashil', { gestationalWeek: 30 }),
    patient('unknown', null, { gestationalWeek: null }),
    patient('red-late', 'qizil', { lastVisit: d(2026, 9, 10), gestationalWeek: 20 }),
    patient('red-chase', 'qizil', { lastVisit: d(2026, 9, 12), staleness: { kind: 'overdue', since: d(2026, 9, 15) } }),
    patient('amber', 'sariq', { gestationalWeek: 36 }),
  ]

  it('defaults to triage order: qizil, sariq, then not assessed, then yashil — unknown is never the safest', () => {
    expect(sortPatients(list, 'zone', 'asc').map((p) => p.pregnancyId)).toEqual([
      'red-chase',
      'red-late',
      'amber',
      'unknown',
      'green',
    ])
  })

  it('sorts by gestational week, leaving unknown weeks last in either direction', () => {
    expect(sortPatients(list, 'week', 'desc').map((p) => p.pregnancyId).at(-1)).toBe('unknown')
    expect(sortPatients(list, 'week', 'asc').map((p) => p.pregnancyId).at(-1)).toBe('unknown')
    expect(sortPatients(list, 'week', 'desc')[0].pregnancyId).toBe('amber')
  })

  it('breaks ties by the triage order, so equal rows never shuffle', () => {
    const twins = [patient('b', 'qizil'), patient('a', 'qizil')]
    expect(sortPatients(twins, 'district', 'asc').map((p) => p.pregnancyId)).toEqual(['a', 'b'])
  })
})

describe('stalenessText', () => {
  it('says why she needs chasing', () => {
    expect(stalenessText({ kind: 'overdue', since: d(2026, 9, 10) })).toContain('10.09.2026')
    expect(stalenessText({ kind: 'not_seen', days: 50 })).toMatch(/^50 /)
  })
})
