import { describe, expect, it } from 'vitest'
import { attentionList, dailyCounts, mergeActivity, totalsOf, type ActivityItem } from './dashboard'
import type { DistrictSummary, RegistryPatient } from './registry'

const TODAY = new Date(2026, 8, 18, 15, 30)
const d = (m: number, day: number, h = 10) => new Date(2026, m - 1, day, h)

describe('dailyCounts', () => {
  it('has one entry per day, oldest first, ending today — empty days are zeros, not gaps', () => {
    const series = dailyCounts([], [], TODAY, 14)
    expect(series).toHaveLength(14)
    expect(series[0].date).toEqual(new Date(2026, 8, 5))
    expect(series[13].date).toEqual(new Date(2026, 8, 18))
    expect(series.every((s) => s.assessments === 0 && s.escalations === 0)).toBe(true)
  })

  it('counts each event on its own local day, whatever the hour', () => {
    const series = dailyCounts([d(9, 18, 0), d(9, 18, 23), d(9, 17)], [d(9, 18, 9)], TODAY, 14)
    expect(series[13]).toMatchObject({ assessments: 2, escalations: 1 })
    expect(series[12]).toMatchObject({ assessments: 1, escalations: 0 })
  })

  it('drops events outside the window instead of piling them onto an edge', () => {
    const series = dailyCounts([d(9, 4), d(9, 19)], [d(8, 1)], TODAY, 14)
    expect(series.reduce((sum, s) => sum + s.assessments + s.escalations, 0)).toBe(0)
  })
})

describe('totalsOf', () => {
  it('adds every district, keeping not-assessed as its own count', () => {
    const districts: DistrictSummary[] = [
      { district: 'Urganch', qizil: 2, sariq: 1, yashil: 4, unassessed: 1, total: 8 },
      { district: 'Xiva', qizil: 0, sariq: 3, yashil: 2, unassessed: 0, total: 5 },
    ]
    expect(totalsOf(districts)).toEqual({ active: 13, qizil: 2, sariq: 4, yashil: 6, unassessed: 1 })
  })

  it('is all zeros with no districts', () => {
    expect(totalsOf([])).toEqual({ active: 0, qizil: 0, sariq: 0, yashil: 0, unassessed: 0 })
  })
})

function patient(name: string, zone: RegistryPatient['zone'], staleness: RegistryPatient['staleness'] = null): RegistryPatient {
  return {
    pregnancyId: `p-${name}`,
    fullName: name,
    district: 'Urganch',
    village: null,
    zone,
    gestationalWeek: 30,
    dueDate: null,
    lastVisit: d(9, 1),
    staleness,
  }
}

describe('attentionList', () => {
  it('holds every qizil woman and anyone overdue or never seen, qizil first', () => {
    const list = attentionList([
      patient('Yashil, on time', 'yashil'),
      patient('Sariq, overdue', 'sariq', { kind: 'overdue', since: d(9, 10) }),
      patient('Qizil', 'qizil'),
      patient('Never seen', null, { kind: 'never_seen' }),
      patient('Sariq, on time', 'sariq'),
    ])
    expect(list.map((p) => p.fullName)).toEqual(['Qizil', 'Sariq, overdue', 'Never seen'])
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => patient(`Q${i}`, 'qizil'))
    expect(attentionList(many, 8)).toHaveLength(8)
  })
})

describe('mergeActivity', () => {
  const item = (id: string, at: Date): ActivityItem => ({
    id,
    kind: 'assessment',
    at,
    pregnancyId: 'p',
    patientName: null,
    zone: null,
    detail: null,
  })

  it('interleaves the kinds newest first and keeps only the most recent', () => {
    const merged = mergeActivity(
      [
        [item('a1', d(9, 18, 9)), item('a2', d(9, 16))],
        [item('e1', d(9, 18, 11))],
        [item('t1', d(9, 17))],
      ],
      3,
    )
    expect(merged.map((i) => i.id)).toEqual(['e1', 'a1', 't1'])
  })
})
