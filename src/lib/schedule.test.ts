import { describe, expect, it } from 'vitest'
import {
  WHO_BASE_CONTACT_WEEKS,
  contactWeeksForZone,
  findNextVisit,
  formatISODate,
  generateSchedule,
  intervalFromPrevious,
} from './schedule'

/** Monday 5 January 2026. Every contact therefore falls on a Monday. */
const LMP = new Date(2026, 0, 5)

/** Expected dates for the eight WHO contacts from that LMP, computed by hand. */
const EXPECTED_BASE_DATES = [
  ['12', '2026-03-30'],
  ['20', '2026-05-25'],
  ['26', '2026-07-06'],
  ['30', '2026-08-03'],
  ['34', '2026-08-31'],
  ['36', '2026-09-14'],
  ['38', '2026-09-28'],
  ['40', '2026-10-12'],
] as const

describe('yashil — the eight WHO contacts, unchanged', () => {
  const schedule = generateSchedule({
    lmpDate: LMP,
    currentZone: 'yashil',
    today: new Date(2026, 0, 6),
  })

  it('produces exactly eight contacts', () => {
    expect(schedule).toHaveLength(8)
    expect(schedule.map((v) => v.targetWeek)).toEqual([...WHO_BASE_CONTACT_WEEKS])
  })

  it.each(EXPECTED_BASE_DATES)(
    'week %s falls on %s for an LMP of 5 January 2026',
    (week, isoDate) => {
      const visit = schedule.find((v) => v.targetWeek === Number(week))
      expect(visit).toBeDefined()
      expect(formatISODate(visit!.targetDate)).toBe(isoDate)
    },
  )

  it('numbers the contacts 1 to 8 in date order', () => {
    expect(schedule.map((v) => v.contactNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].targetDate.getTime()).toBeGreaterThan(
        schedule[i - 1].targetDate.getTime(),
      )
    }
  })

  it('keeps every contact on the same weekday as the LMP', () => {
    // A whole number of weeks from a Monday is always a Monday. Catches any
    // drift from timezone or DST handling in the date arithmetic.
    for (const visit of schedule) {
      expect(visit.targetDate.getDay()).toBe(LMP.getDay())
    }
  })
})

describe('sariq — an extra contact midway between each pair from week 26', () => {
  const schedule = generateSchedule({
    lmpDate: LMP,
    currentZone: 'sariq',
    today: new Date(2026, 0, 6),
  })

  it('adds 28, 32, 35, 37 and 39 and nothing else', () => {
    expect(schedule.map((v) => v.targetWeek)).toEqual([
      12, 20, 26, 28, 30, 32, 34, 35, 36, 37, 38, 39, 40,
    ])
  })

  it('adds nothing before week 26', () => {
    // The 12-20 and 20-26 gaps are untouched: no contact at 16 or 23.
    const weeks = schedule.map((v) => v.targetWeek)
    expect(weeks.filter((w) => w < 26)).toEqual([12, 20])
  })

  it('keeps all eight original contacts', () => {
    const weeks = new Set(schedule.map((v) => v.targetWeek))
    for (const base of WHO_BASE_CONTACT_WEEKS) {
      expect(weeks.has(base)).toBe(true)
    }
  })

  it('dates the extra contacts correctly', () => {
    const at = (week: number) =>
      formatISODate(schedule.find((v) => v.targetWeek === week)!.targetDate)
    expect(at(28)).toBe('2026-07-20')
    expect(at(32)).toBe('2026-08-17')
    expect(at(35)).toBe('2026-09-07')
    expect(at(37)).toBe('2026-09-21')
    expect(at(39)).toBe('2026-10-05')
  })

  it('renumbers contacts 1 to 13 with no gaps', () => {
    expect(schedule.map((v) => v.contactNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ])
  })

  it('never puts an extra contact outside the pair it splits', () => {
    for (let i = 0; i < schedule.length; i++) {
      const gap = intervalFromPrevious(schedule, i)
      if (gap !== null) expect(gap).toBeGreaterThan(0)
    }
  })
})

describe('qizil — the next contact is today', () => {
  // 20 July 2026 is week 28 of this pregnancy: past the week-26 contact,
  // before the week-30 one.
  const TODAY = new Date(2026, 6, 20)
  const schedule = generateSchedule({
    lmpDate: LMP,
    currentZone: 'qizil',
    today: TODAY,
  })

  it('moves the next due contact to today', () => {
    const next = findNextVisit(schedule, TODAY)
    expect(next).not.toBeNull()
    expect(formatISODate(next!.targetDate)).toBe('2026-07-20')
    expect(next!.status).toBe('rejalashtirilgan')
  })

  it('pulls forward the contact that was next, keeping its number and week', () => {
    // The week-30 contact is the one that was due next, so it is the one moved.
    const moved = schedule.find((v) => v.targetWeek === 30)
    expect(moved).toBeDefined()
    expect(formatISODate(moved!.targetDate)).toBe('2026-07-20')
  })

  it('still shows the rest of the schedule at its original dates', () => {
    expect(schedule).toHaveLength(8)
    const at = (week: number) =>
      formatISODate(schedule.find((v) => v.targetWeek === week)!.targetDate)
    expect(at(34)).toBe('2026-08-31')
    expect(at(36)).toBe('2026-09-14')
    expect(at(38)).toBe('2026-09-28')
    expect(at(40)).toBe('2026-10-12')
  })

  it('leaves past contacts marked as missed', () => {
    const week12 = schedule.find((v) => v.targetWeek === 12)!
    const week26 = schedule.find((v) => v.targetWeek === 26)!
    expect(week12.status).toBe("o'tkazib yuborilgan")
    expect(week26.status).toBe("o'tkazib yuborilgan")
  })

  it('does not add or remove contacts', () => {
    expect(schedule.map((v) => v.targetWeek)).toEqual([...WHO_BASE_CONTACT_WEEKS])
  })
})

describe('status', () => {
  it('marks contacts before today as missed and the rest as planned', () => {
    const schedule = generateSchedule({
      lmpDate: LMP,
      currentZone: 'yashil',
      today: new Date(2026, 7, 3), // the week-30 contact date itself
    })
    const byWeek = Object.fromEntries(schedule.map((v) => [v.targetWeek, v.status]))
    expect(byWeek[26]).toBe("o'tkazib yuborilgan")
    // A contact due today is not missed.
    expect(byWeek[30]).toBe('rejalashtirilgan')
    expect(byWeek[34]).toBe('rejalashtirilgan')
  })

  it('never returns bajarilgan — completion is recorded by the visits table', () => {
    const schedule = generateSchedule({
      lmpDate: LMP,
      currentZone: 'sariq',
      today: new Date(2026, 8, 1),
    })
    expect(schedule.every((v) => v.status !== 'bajarilgan')).toBe(true)
  })
})

describe('contactWeeksForZone', () => {
  it('leaves yashil and qizil on the base weeks', () => {
    expect(contactWeeksForZone('yashil')).toEqual([...WHO_BASE_CONTACT_WEEKS])
    expect(contactWeeksForZone('qizil')).toEqual([...WHO_BASE_CONTACT_WEEKS])
  })

  it('returns sorted, unique weeks for sariq', () => {
    const weeks = contactWeeksForZone('sariq')
    expect([...weeks].sort((a, b) => a - b)).toEqual(weeks)
    expect(new Set(weeks).size).toBe(weeks.length)
  })
})

describe('findNextVisit', () => {
  it('returns null once every contact is in the past', () => {
    const schedule = generateSchedule({
      lmpDate: LMP,
      currentZone: 'yashil',
      today: new Date(2026, 11, 1),
    })
    expect(findNextVisit(schedule, new Date(2026, 11, 1))).toBeNull()
  })
})
