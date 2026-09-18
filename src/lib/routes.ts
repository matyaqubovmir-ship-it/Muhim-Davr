/**
 * The app's routes, as data. Pure: parse a path into a route and build a path
 * from one, so every URL the app produces is one it can read back.
 *
 * Hand-rolled rather than a router dependency: there are nine paths and none of
 * them nests, and a 40-line table is easier to read under time pressure than a
 * library's conventions.
 */

import type { RiskZone } from './risk'

export type Route =
  | { name: 'entry' }
  | { name: 'escalations' }
  | { name: 'dashboard' }
  | { name: 'registry' }
  | { name: 'district'; district: string }
  | { name: 'patient'; pregnancyId: string }
  | { name: 'new_patient' }
  | { name: 'patients' }
  | { name: 'not_found' }

/** Where a patient row was clicked from, for the "back to Sariq · <tuman>" link. */
export interface PatientOrigin {
  district: string
  zone: RiskZone | null
}

function decode(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment)
    return decoded.trim() === '' ? null : decoded
  } catch {
    return null
  }
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter((part) => part !== '')

  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'entry')) return { name: 'entry' }
  if (parts.length === 1 && parts[0] === 'escalations') return { name: 'escalations' }
  if (parts.length === 1 && parts[0] === 'dashboard') return { name: 'dashboard' }
  if (parts.length === 1 && parts[0] === 'registry') return { name: 'registry' }
  if (parts.length === 1 && parts[0] === 'patients') return { name: 'patients' }

  if (parts.length === 2 && parts[0] === 'registry') {
    const district = decode(parts[1])
    return district === null ? { name: 'not_found' } : { name: 'district', district }
  }
  if (parts.length === 2 && parts[0] === 'patients' && parts[1] === 'new') return { name: 'new_patient' }
  if (parts.length === 2 && parts[0] === 'patients') {
    const pregnancyId = decode(parts[1])
    return pregnancyId === null ? { name: 'not_found' } : { name: 'patient', pregnancyId }
  }
  return { name: 'not_found' }
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'entry':
      return '/'
    case 'escalations':
      return '/escalations'
    case 'dashboard':
      return '/dashboard'
    case 'registry':
      return '/registry'
    case 'district':
      return `/registry/${encodeURIComponent(route.district)}`
    case 'patient':
      return `/patients/${encodeURIComponent(route.pregnancyId)}`
    case 'new_patient':
      return '/patients/new'
    case 'patients':
      return '/patients'
    case 'not_found':
      return '/'
  }
}

/** Reads a PatientOrigin back out of history state, trusting nothing about its shape. */
export function readPatientOrigin(state: unknown): PatientOrigin | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null
  const from = (state as { from: unknown }).from
  if (typeof from !== 'object' || from === null) return null
  const { district, zone } = from as { district?: unknown; zone?: unknown }
  if (typeof district !== 'string' || district === '') return null
  const validZone = zone === 'qizil' || zone === 'sariq' || zone === 'yashil' ? zone : null
  return { district, zone: validZone }
}
