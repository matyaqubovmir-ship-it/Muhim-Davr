import { describe, expect, it } from 'vitest'
import {
  WHO_BASE_CONTACT_WEEKS,
  contactWeeksForZone,
  findNextVisit,
  formatISODate,
  fulfilledEarly,
  generateSchedule,
  intervalFromPrevious,
  parseISODate,
  scheduleAnchor,
  upcomingVisitRows,
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

describe('qizil — seen today, again within a week, never less often than sariq', () => {
  // 20 July 2026 is exactly week 28 of this pregnancy: a sariq (and so qizil)
  // contact week.
  const TODAY = new Date(2026, 6, 20)
  const schedule = generateSchedule({
    lmpDate: LMP,
    currentZone: 'qizil',
    today: TODAY,
  })
  const at = (week: number) =>
    formatISODate(schedule.find((v) => v.targetWeek === week && !v.followUp)!.targetDate)

  it('has a contact today', () => {
    const next = findNextVisit(schedule, TODAY)
    expect(next).not.toBeNull()
    expect(formatISODate(next!.targetDate)).toBe('2026-07-20')
    expect(next!.status).toBe('rejalashtirilgan')
  })

  it('adds a check-up one week later, because the next contact is two weeks away', () => {
    const followUp = schedule.find((v) => v.followUp)
    expect(followUp).toBeDefined()
    expect(formatISODate(followUp!.targetDate)).toBe('2026-07-27')
    expect(followUp!.targetWeek).toBe(29)
  })

  it('keeps the later contacts at their dates, on the sariq weeks', () => {
    expect(schedule.filter((v) => !v.followUp).map((v) => v.targetWeek)).toEqual(contactWeeksForZone('sariq'))
    expect(at(30)).toBe('2026-08-03')
    expect(at(34)).toBe('2026-08-31')
    expect(at(40)).toBe('2026-10-12')
  })

  it('numbers the contacts in date order', () => {
    expect(schedule.map((v) => v.contactNumber)).toEqual(schedule.map((_, i) => i + 1))
    const dates = schedule.map((v) => v.targetDate.getTime())
    expect([...dates].sort((a, b) => a - b)).toEqual(dates)
  })

  it('leaves past contacts marked as missed', () => {
    const week12 = schedule.find((v) => v.targetWeek === 12)!
    const week26 = schedule.find((v) => v.targetWeek === 26)!
    expect(week12.status).toBe("o'tkazib yuborilgan")
    expect(week26.status).toBe("o'tkazib yuborilgan")
  })

  it('pulls the next contact forward to today when today falls between contacts', () => {
    const today = new Date(2026, 6, 22) // week 28, day 2
    const s2 = generateSchedule({ lmpDate: LMP, currentZone: 'qizil', today })
    const moved = s2.find((v) => v.targetWeek === 30 && !v.followUp)!
    expect(formatISODate(moved.targetDate)).toBe('2026-07-22')
    expect(formatISODate(s2.find((v) => v.followUp)!.targetDate)).toBe('2026-07-29')
  })

  it('is never left weeks without a contact: red at week 21 is seen again within 7 days', () => {
    const today = new Date(2026, 5, 1) // week 21
    const rows = upcomingVisitRows(generateSchedule({ lmpDate: LMP, currentZone: 'qizil', today }), today)
    expect(rows[0]).toEqual({ target_week: 22, target_date: '2026-06-08' })
  })

  it('still gets a check-up when red past week 40, with no WHO contact left', () => {
    const today = new Date(2026, 9, 19) // week 41
    const rows = upcomingVisitRows(generateSchedule({ lmpDate: LMP, currentZone: 'qizil', today }), today)
    expect(rows).toEqual([{ target_week: 42, target_date: '2026-10-26' }])
  })

  it('adds no check-up when a contact already falls within ten days', () => {
    // 14 September is the week-36 contact itself; week 37 is seven days on.
    const today = new Date(2026, 8, 14)
    const s2 = generateSchedule({ lmpDate: LMP, currentZone: 'qizil', today })
    expect(s2.some((v) => v.followUp)).toBe(false)
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
  it('leaves yashil on the base weeks', () => {
    expect(contactWeeksForZone('yashil')).toEqual([...WHO_BASE_CONTACT_WEEKS])
  })

  it('never sees a qizil woman less often than a sariq one', () => {
    expect(contactWeeksForZone('qizil')).toEqual(contactWeeksForZone('sariq'))
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

describe('parseISODate', () => {
  it('reads a Postgres date as a local midnight', () => {
    const date = parseISODate('2026-03-15')
    expect(date).toEqual(new Date(2026, 2, 15))
    expect(formatISODate(date!)).toBe('2026-03-15')
  })

  it('refuses anything that is not a real calendar date', () => {
    expect(parseISODate('2026-02-31')).toBeNull()
    expect(parseISODate('15.03.2026')).toBeNull()
    expect(parseISODate('')).toBeNull()
  })
})

describe('scheduleAnchor', () => {
  const visitDate = new Date(2026, 8, 18)

  it('prefers the recorded LMP over any estimate', () => {
    expect(scheduleAnchor(new Date(2026, 2, 15), 30, visitDate)).toEqual(new Date(2026, 2, 15))
  })

  it('estimates from gestational age when no LMP is recorded', () => {
    expect(scheduleAnchor(null, 2, visitDate)).toEqual(new Date(2026, 8, 4))
  })

  it('has no anchor when neither is known', () => {
    expect(scheduleAnchor(null, null, visitDate)).toBeNull()
    expect(scheduleAnchor(null, Number.NaN, visitDate)).toBeNull()
  })
})

describe('upcomingVisitRows — what gets stored for the reminders', () => {
  it('stores only contacts strictly after today, as week and ISO date', () => {
    const today = new Date(2026, 7, 31) // the 34-week contact's own day
    const rows = upcomingVisitRows(
      generateSchedule({ lmpDate: LMP, currentZone: 'yashil', today }),
      today,
    )
    expect(rows).toEqual([
      { target_week: 36, target_date: '2026-09-14' },
      { target_week: 38, target_date: '2026-09-28' },
      { target_week: 40, target_date: '2026-10-12' },
    ])
  })

  it('does not store the qizil contact pulled to today — the visit being saved is that contact — but stores the check-up', () => {
    const today = new Date(2026, 7, 20)
    const schedule = generateSchedule({ lmpDate: LMP, currentZone: 'qizil', today })
    expect(schedule.some((visit) => formatISODate(visit.targetDate) === '2026-08-20')).toBe(true)
    expect(upcomingVisitRows(schedule, today).map((row) => row.target_week)).toEqual([33, 35, 36, 37, 38, 39, 40])
  })

  it('a late visit is late for the contact she missed, not early for the next (weekly sariq contacts)', () => {
    // The week-34 contact was Monday 31 August; she comes on Tuesday 1 September.
    const today = new Date(2026, 8, 1)
    const schedule = generateSchedule({ lmpDate: LMP, currentZone: 'sariq', today })
    expect(fulfilledEarly(schedule, today)).toBeNull()
    expect(upcomingVisitRows(schedule, today)[0]).toEqual({ target_week: 35, target_date: '2026-09-07' })
  })

  it('a visit exactly between two contacts consumes neither', () => {
    // 13 July is week 27: a week after the 26-week contact, a week before the 28-week one.
    const today = new Date(2026, 6, 13)
    const rows = upcomingVisitRows(generateSchedule({ lmpDate: LMP, currentZone: 'sariq', today }), today)
    expect(rows[0]).toEqual({ target_week: 28, target_date: '2026-07-20' })
  })

  it('yashil: a missed week-36 contact made up at week 37 leaves week 38 planned', () => {
    const today = new Date(2026, 8, 21)
    const rows = upcomingVisitRows(generateSchedule({ lmpDate: LMP, currentZone: 'yashil', today }), today)
    expect(rows[0]).toEqual({ target_week: 38, target_date: '2026-09-28' })
  })

  it('never stores a past contact, so nothing is ever recorded as missed', () => {
    const today = new Date(2026, 6, 1)
    const rows = upcomingVisitRows(
      generateSchedule({ lmpDate: LMP, currentZone: 'sariq', today }),
      today,
    )
    expect(rows.every((row) => row.target_date > '2026-07-01')).toBe(true)
  })

  it('a visit a few days early is that contact: it is not stored to be reminded of again', () => {
    // 1 July is five days before the 26-week contact (6 July).
    const today = new Date(2026, 6, 1)
    const rows = upcomingVisitRows(generateSchedule({ lmpDate: LMP, currentZone: 'sariq', today }), today)
    expect(rows[0]).toEqual({ target_week: 28, target_date: '2026-07-20' })
  })

  it('a visit more than a week early leaves the next contact planned', () => {
    // 20 June is sixteen days before the 26-week contact.
    const today = new Date(2026, 5, 20)
    const rows = upcomingVisitRows(generateSchedule({ lmpDate: LMP, currentZone: 'yashil', today }), today)
    expect(rows[0]).toEqual({ target_week: 26, target_date: '2026-07-06' })
  })

  it('stores nothing once the schedule is behind her', () => {
    const today = new Date(2026, 11, 1)
    expect(
      upcomingVisitRows(generateSchedule({ lmpDate: LMP, currentZone: 'yashil', today }), today),
    ).toEqual([])
  })
})
