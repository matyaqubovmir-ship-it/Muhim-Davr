/**
 * The demo role switch: which tabs are shown, and nothing else.
 *
 * NOT A SECURITY BOUNDARY. Every route stays reachable by URL whichever role is
 * chosen, and the database cannot tell the roles apart — every device signs in
 * anonymously and RLS treats every session as staff (src/lib/supabase.ts,
 * 001_schema.sql). Real roles need real accounts; this only keeps a midwife's
 * phone and a specialist's desk from showing each other's menus in a demo.
 */

import { useState } from 'react'
import type { Route } from './routes'

export type Role = 'midwife' | 'specialist'

type TabRoute = Extract<Route['name'], 'entry' | 'new_patient' | 'registry' | 'escalations' | 'patients'>

/** Each role's tabs, in order. The first is where switching to the role lands. */
export const ROLE_TABS: Record<Role, readonly TabRoute[]> = {
  midwife: ['entry', 'new_patient'],
  specialist: ['registry', 'escalations', 'patients'],
}

export function homeFor(role: Role): Route {
  return { name: ROLE_TABS[role][0] } as Route
}

const STORAGE_KEY = 'ona.role'

/** A per-device preference, so it may be missing or unreadable: then midwife. */
export function readStoredRole(): Role {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'specialist' ? 'specialist' : 'midwife'
  } catch {
    return 'midwife'
  }
}

export function useRole(): [Role, (role: Role) => void] {
  const [role, setRole] = useState<Role>(readStoredRole)
  const change = (next: Role) => {
    setRole(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private window or storage disabled: the choice lasts until reload.
    }
  }
  return [role, change]
}
