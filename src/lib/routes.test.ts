import { describe, expect, it } from 'vitest'
import { parseRoute, pathFor, readPatientOrigin, type Route } from './routes'

describe('parseRoute', () => {
  it.each([
    ['/', { name: 'entry' }],
    ['/entry', { name: 'entry' }],
    ['/registry', { name: 'registry' }],
    ['/registry/', { name: 'registry' }],
    ['/registry/Urganch', { name: 'district', district: 'Urganch' }],
    ['/escalations', { name: 'escalations' }],
    ['/patients/d8668940-1587-40b2-83a4-294b26d450aa', { name: 'patient', pregnancyId: 'd8668940-1587-40b2-83a4-294b26d450aa' }],
    ['/patients/new', { name: 'new_patient' }],
    ['/patients', { name: 'patients' }],
    ['/registry/Urganch/extra', { name: 'not_found' }],
    ['/nowhere', { name: 'not_found' }],
    ['/registry/%E0%A4%A', { name: 'not_found' }],
    ['/registry/%20', { name: 'not_found' }],
  ] as [string, Route][])('%s', (path, route) => {
    expect(parseRoute(path)).toEqual(route)
  })
})

describe('pathFor', () => {
  it.each(['Urganch', 'Qo‘shko‘pir', 'Tuproqqal’a', 'Урганч', 'Yangi ariq', 'A/B'])(
    'round-trips the district name %j through the URL',
    (district) => {
      const path = pathFor({ name: 'district', district })
      expect(path.split('/')).toHaveLength(3)
      expect(parseRoute(path)).toEqual({ name: 'district', district })
    },
  )
})

describe('readPatientOrigin', () => {
  it('reads what the registry puts in history state', () => {
    expect(readPatientOrigin({ from: { district: 'Hazorasp', zone: 'sariq' } })).toEqual({
      district: 'Hazorasp',
      zone: 'sariq',
    })
  })

  it('keeps the district when the zone is unknown or unassessed', () => {
    expect(readPatientOrigin({ from: { district: 'Hazorasp', zone: null } })).toEqual({
      district: 'Hazorasp',
      zone: null,
    })
    expect(readPatientOrigin({ from: { district: 'Hazorasp', zone: 'purple' } })?.zone).toBe(null)
  })

  it('returns null for anything else — a reload, a pasted link, or garbage', () => {
    for (const state of [null, undefined, 'x', {}, { from: null }, { from: { district: '' } }, { from: { district: 3 } }]) {
      expect(readPatientOrigin(state)).toBe(null)
    }
  })
})
