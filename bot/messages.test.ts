/**
 * The rules at the top of bot/messages.ts, enforced.
 *
 * Word lists are crude on purpose. They do not prove a string is safe; they
 * catch the specific failures this channel must never have — a reassurance, a
 * named condition, a medicine — if someone edits the copy later.
 */

import { describe, expect, it } from 'vitest'
import { BOT, WORSENS_LINE, formatUzbekDate, reminderMorning, reminderTomorrow, reminderTwoDays } from './messages.ts'

/** Every fixed string, and every reminder as she would receive it. */
const SAMPLE_DAY = new Date(2026, 8, 20)
const ALL_STRINGS: [string, string][] = [
  ...Object.entries(BOT),
  ['reminderTwoDays', reminderTwoDays(SAMPLE_DAY, 'Urganch')],
  ['reminderTomorrow', reminderTomorrow(SAMPLE_DAY, 'Urganch')],
  ['reminderMorning', reminderMorning(SAMPLE_DAY, 'Urganch')],
]

/** "You're fine", "don't worry", "all normal", "healthy", "no problem"… */
const REASSURANCE = [
  'yaxshi',
  'normal',
  'joyida',
  'xavotir',
  'tashvish',
  'sog‘lom',
  'muammo yo‘q',
  'xavf yo‘q',
  'qo‘rqmang',
]

/** Condition names — the bot names none. */
const DIAGNOSES = [
  'preeklampsiya',
  'eklampsiya',
  'gipertoniya',
  'kamqonlik',
  'anemiya',
  'infeksiya',
  'homila tushishi',
]

/** Medicine — the bot names none, except in the one sentence refusing to discuss it. */
const MEDICINES = ['aspirin', 'temir', 'folat', 'kalsiy', 'kaltsiy', 'vitamin', 'paratsetamol', 'mg']

describe('the bot never reassures', () => {
  it.each(ALL_STRINGS)('%s contains no reassurance', (_name, text) => {
    for (const word of REASSURANCE) expect(text.toLowerCase()).not.toContain(word)
  })
})

describe('the bot never diagnoses', () => {
  it.each(ALL_STRINGS)('%s names no condition', (_name, text) => {
    for (const word of DIAGNOSES) expect(text.toLowerCase()).not.toContain(word)
  })
})

describe('the bot never names a medicine', () => {
  it.each(ALL_STRINGS)('%s names no medicine or dose', (_name, text) => {
    for (const word of MEDICINES) {
      expect(new RegExp(`\\b${word}`, 'i').test(text), `${word} in ${text}`).toBe(false)
    }
  })

  it('refers medicine questions to her doctor or midwife', () => {
    expect(BOT.medicineRefusal).toContain('shifokoringiz')
    expect(BOT.medicineRefusal).toContain('akusherkangiz')
  })
})

describe('the closing line', () => {
  it('is the one the specification asks for', () => {
    expect(WORSENS_LINE.toLowerCase()).toBe('agar yomonlashsa, darhol murojaat qiling.')
  })
})

describe('emergency replies', () => {
  it('tell her to go now and give the ambulance number', () => {
    for (const text of [BOT.reportImmediate, BOT.reportImmediateNotSaved]) {
      expect(text).toContain('DARHOL')
      expect(text).toContain('103')
    }
  })

  it('only claim a doctor has it when it was saved', () => {
    expect(BOT.reportImmediate).toContain('shifokorga ham yuborildi')
    expect(BOT.reportImmediateNotSaved).not.toContain('yuborildi')
    expect(BOT.reportFailed).not.toContain('yuborildi')
  })
})

describe('visit reminders', () => {
  // 20 September 2026 is a Sunday.
  const date = new Date(2026, 8, 20)

  it('writes dates as DD.MM.YYYY', () => {
    expect(formatUzbekDate(new Date(2026, 0, 5))).toBe('05.01.2026')
  })

  it('give the date, the weekday and where to go', () => {
    const text = reminderTwoDays(date, 'Urganch')
    expect(text).toContain('20.09.2026, yakshanba')
    expect(text).toContain('2 kundan keyin')
    expect(text).toContain('Urganch tumanidagi oilaviy poliklinikangizga boring.')
  })

  it('say "today" on the morning of', () => {
    expect(reminderMorning(date, 'Xiva')).toContain('bugun, 20.09.2026')
  })

  it('do not double the word tuman', () => {
    expect(reminderMorning(date, 'Urganch tumani')).toContain('Urganch tumanidagi')
    expect(reminderMorning(date, 'Urganch tumani')).not.toContain('tumani tumanidagi')
  })

  it('still say where to go when no district is recorded', () => {
    expect(reminderMorning(date, null)).toContain('Oilaviy poliklinikangizga boring.')
  })
})
