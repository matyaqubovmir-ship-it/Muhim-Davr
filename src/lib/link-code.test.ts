/**
 * Pins the link code to its second definition, the `link_code` generated column
 * in supabase/migrations/003_patient_channel.sql.
 *
 * The midwife's screen computes the code here; the bot looks it up in the
 * database. If the two ever derived it differently, every code a midwife read
 * out would be one no patient could use, and nothing would say why.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LINK_CODE_LENGTH, linkCodeForPregnancy, normaliseLinkCode } from './link-code'

const sql = readFileSync(
  new URL('../../supabase/migrations/003_patient_channel.sql', import.meta.url),
  'utf8',
)

/**
 * The generated-column expression, run in JavaScript: the SQL functions it uses
 * are simple enough to model one for one.
 */
function sqlLinkCode(id: string): string {
  const match = /generated always as \(upper\(substr\(replace\(id::text, '-', ''\), 1, (\d+)\)\)\) stored/.exec(
    sql,
  )
  expect(match, 'link_code expression in 003 no longer has the expected shape').not.toBeNull()
  const length = Number(match![1])
  return id.replace(/-/g, '').substring(0, length).toUpperCase()
}

const IDS = [
  'a3f91c2e-0000-4000-8000-000000000001',
  '00ff00aa-1234-4abc-9def-0123456789ab',
  'FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF',
  '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
]

describe('link code — app and database agree', () => {
  it.each(IDS)('derives the same code as the generated column for %s', (id) => {
    expect(linkCodeForPregnancy(id)).toBe(sqlLinkCode(id.toLowerCase()))
  })

  it('uses the same length as the migration', () => {
    expect(sqlLinkCode(IDS[0])).toHaveLength(LINK_CODE_LENGTH)
  })
})

describe('linkCodeForPregnancy', () => {
  it('refuses anything that is not a uuid rather than deriving a code from a typo', () => {
    expect(linkCodeForPregnancy('a3f91c')).toBe(null)
    expect(linkCodeForPregnancy('')).toBe(null)
    expect(linkCodeForPregnancy('not-a-uuid-at-all-0000-000000000000')).toBe(null)
  })

  it('tolerates surrounding space and upper case', () => {
    expect(linkCodeForPregnancy('  A3F91C2E-0000-4000-8000-000000000001 ')).toBe('A3F91C')
  })
})

describe('normaliseLinkCode — the code as a patient types it', () => {
  it.each([
    ['a3f91c', 'A3F91C'],
    [' A3F 91C ', 'A3F91C'],
    ['a3f-91c', 'A3F91C'],
    ['/A3F91C', 'A3F91C'],
  ])('reads %j as %s', (typed, code) => {
    expect(normaliseLinkCode(typed)).toBe(code)
  })

  it('rejects a code of the wrong length', () => {
    expect(normaliseLinkCode('A3F91')).toBe(null)
    expect(normaliseLinkCode('A3F91C0')).toBe(null)
  })

  it('rejects letters outside hex, rather than guessing what was meant', () => {
    // O and I are not code characters; a code made only of them is empty.
    expect(normaliseLinkCode('OOIIOO')).toBe(null)
  })
})
