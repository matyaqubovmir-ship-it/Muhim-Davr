/**
 * Guards the snapshot rule stated at the top of the assessments table in
 * supabase/migrations/001_schema.sql: every input the score reads must have a
 * column to be stored in.
 *
 * This exists because the two sides had already drifted once — risk.ts was
 * written from the point table, the schema from an earlier sketch, and five
 * columns were named differently while nine did not exist at all. A frozen
 * score whose inputs were never stored cannot be reproduced or audited, which
 * defeats the whole append-only design.
 *
 * The SQL parsing is deliberately crude. It does not need to understand
 * Postgres; it needs to fail when a column name is absent.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCORING_INPUT_FIELDS, type ScoringInputField } from './risk'

const MIGRATION_PATH = new URL('../../supabase/migrations/001_schema.sql', import.meta.url)

/**
 * Scoring field -> column name, where the two deliberately differ.
 * Anything not listed here must match its field name exactly.
 */
const COLUMN_OVERRIDES: Partial<Record<ScoringInputField, string>> = {
  // Stored as a number, never derived from patients.birth_date: age changes,
  // and a frozen score has to stay reproducible from its own row.
  age: 'age_at_assessment',
}

/** Column names that were renamed and must not come back. */
const RETIRED_COLUMNS = [
  'hb',
  'bleeding',
  'multiple_pregnancy',
  'prior_cesarean',
  'prior_stillbirth',
] as const

const sql = readFileSync(MIGRATION_PATH, 'utf8')

/** The body of `create table assessments ( ... )`, up to the closing paren. */
function assessmentsBlock(): string {
  const start = sql.indexOf('create table assessments (')
  expect(start, 'create table assessments ( not found in migration').toBeGreaterThan(-1)
  const end = sql.indexOf('\n);', start)
  expect(end, 'end of assessments table not found').toBeGreaterThan(start)
  return sql.slice(start, end)
}

/** A column definition is a line that begins with the name followed by a type. */
function hasColumn(block: string, column: string): boolean {
  return new RegExp(`^\\s*${column}\\s+\\S`, 'm').test(block)
}

function columnFor(field: ScoringInputField): string {
  return COLUMN_OVERRIDES[field] ?? field
}

describe('risk.ts and 001_schema.sql agree', () => {
  const block = assessmentsBlock()

  it('finds the assessments table in the migration', () => {
    expect(block.length).toBeGreaterThan(0)
    expect(SCORING_INPUT_FIELDS.length).toBe(21)
  })

  it.each(SCORING_INPUT_FIELDS)(
    'scoring input %s has a column on assessments',
    (field) => {
      const column = columnFor(field)
      expect(
        hasColumn(block, column),
        `risk.ts reads "${field}" but assessments has no "${column}" column. ` +
          'Add it to supabase/migrations/001_schema.sql — see the snapshot rule ' +
          'above the table.',
      ).toBe(true)
    },
  )

  it.each(RETIRED_COLUMNS)('retired column %s is gone', (column) => {
    expect(
      hasColumn(block, column),
      `"${column}" was renamed to match risk.ts and should not exist.`,
    ).toBe(false)
  })

  it('stores the rules version alongside the score', () => {
    // A frozen score is only interpretable if the rules behind it are known.
    expect(hasColumn(block, 'rules_version')).toBe(true)
    expect(/rules_version\s+text\s+not\s+null/.test(block)).toBe(true)
  })

  it('stores the score, zone and fired factors', () => {
    expect(hasColumn(block, 'risk_score')).toBe(true)
    expect(hasColumn(block, 'risk_zone')).toBe(true)
    expect(hasColumn(block, 'fired_factors')).toBe(true)
  })

  it('keeps the provenance columns', () => {
    expect(hasColumn(block, 'extracted_json')).toBe(true)
    expect(hasColumn(block, 'corrected_by_human')).toBe(true)
  })

  it('still forbids UPDATE and DELETE on assessments', () => {
    // The append-only guarantee is what makes a snapshot worth taking.
    expect(/create trigger assessments_no_update/.test(sql)).toBe(true)
    expect(/create trigger assessments_no_delete/.test(sql)).toBe(true)
  })

  it('has no scoring threshold hard-coded in the migration', () => {
    // Thresholds live in risk.ts only. If a weight ever appears in the schema
    // the two can disagree, and the row would no longer explain its own score.
    expect(/risk_score\s*>=\s*7/.test(sql)).toBe(false)
    expect(/risk_score\s*>=\s*3/.test(sql)).toBe(false)
  })
})
