import { describe, expect, it } from 'vitest'
import { groupOf, groupVisits, type CalendarVisit } from './visits'

const TODAY = new Date(2026, 8, 18, 15, 0)
const d = (day: number, month = 9) => new Date(2026, month - 1, day)

function visit(name: string, date: Date, extra: Partial<CalendarVisit> = {}): CalendarVisit {
  return {
    visitId: `v-${name}`,
    pregnancyId: `p-${name}`,
    fullName: name,
    district: 'Urganch',
    village: null,
    targetWeek: 30,
    targetDate: date,
    zone: 'yashil',
    hasTelegram: true,
    remindersSent: [],
    ...extra,
  }
}

describe('groupOf', () => {
  it('sorts a date into the day it falls on, whatever the hour now', () => {
    expect(groupOf(d(17), TODAY)).toBe('overdue')
    expect(groupOf(d(18), TODAY)).toBe('today')
    expect(groupOf(d(19), TODAY)).toBe('tomorrow')
    expect(groupOf(d(25), TODAY)).toBe('thisWeek')
    expect(groupOf(d(26), TODAY)).toBe('later')
  })
})

describe('groupVisits', () => {
  it('puts the red first within a day, then those nobody can reach on Telegram', () => {
    const groups = groupVisits(
      [
        visit('Yashil, Telegram', d(18)),
        visit('Yashil, no Telegram', d(18), { hasTelegram: false }),
        visit('Qizil', d(18), { zone: 'qizil' }),
        visit('Earlier overdue', d(10)),
        visit('Later overdue', d(15)),
      ],
      TODAY,
    )
    expect(groups.today.map((v) => v.fullName)).toEqual(['Qizil', 'Yashil, no Telegram', 'Yashil, Telegram'])
    expect(groups.overdue.map((v) => v.fullName)).toEqual(['Earlier overdue', 'Later overdue'])
    expect(groups.tomorrow).toEqual([])
  })
})
