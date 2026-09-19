import { describe, expect, it } from 'vitest'
import { createFakeStore } from './fake-store.ts'
import { SURVEY } from './messages.ts'
import { latestPerPregnancy, sendMissedVisitNotices } from './missed-visits.ts'
import type { Keyboard, SendOutcome, TelegramClient } from './telegram.ts'

/** Tashkent is UTC+5 all year, with no daylight saving. */
function tashkent(isoLocal: string): Date {
  return new Date(isoLocal + '+05:00')
}

function recordingTelegram(outcomes: SendOutcome[] = []) {
  const sent: { chatId: number; text: string; keyboard?: Keyboard }[] = []
  const client: TelegramClient = {
    getUpdates: async () => [],
    sendMessage: async (chatId, text, keyboard) => {
      sent.push({ chatId, text, keyboard })
      return outcomes.shift() ?? { ok: true, blocked: false }
    },
  }
  return { client, sent }
}

/** Preg-a missed yesterday's contact (the 18th, seen from the 19th); preg-b's is today. */
function storeWithContacts() {
  const store = createFakeStore()
  store.channels.set(100, 'preg-a')
  store.channels.set(200, 'preg-b')
  store.visits.push(
    { visitId: 'v-yesterday', pregnancyId: 'preg-a', targetDate: '2026-09-18', district: 'Urganch' },
    { visitId: 'v-today', pregnancyId: 'preg-b', targetDate: '2026-09-19', district: 'Xiva' },
  )
  return store
}

describe('sendMissedVisitNotices', () => {
  it('waits until 09:00 the next morning', async () => {
    const store = storeWithContacts()
    const { client, sent } = recordingTelegram()
    expect(await sendMissedVisitNotices(store, client, tashkent('2026-09-19T08:59:00'))).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('tells her the visit was not recorded, and opens the survey with its first question', async () => {
    const store = storeWithContacts()
    const { client, sent } = recordingTelegram()
    const now = tashkent('2026-09-19T09:30:00')
    expect(await sendMissedVisitNotices(store, client, now)).toBe(1)

    expect(sent).toHaveLength(1)
    expect(sent[0].chatId).toBe(100)
    expect(sent[0].text).toContain('18.09.2026, juma')
    expect(sent[0].text).toContain('qayd etilmadi')
    expect(sent[0].text).toContain(SURVEY.intro)
    expect(sent[0].text.endsWith(SURVEY.questions.bp)).toBe(true)
    expect(sent[0].keyboard).toEqual([[SURVEY.cannotMeasure]])

    expect(store.surveys).toHaveLength(1)
    expect(store.surveys[0]).toMatchObject({ pregnancyId: 'preg-a', telegramChatId: 100, visitId: 'v-yesterday', step: 'bp' })
    expect(store.surveys[0].expiresAt.getTime() - now.getTime()).toBe(24 * 3600_000)
  })

  it('sends it once, however often the sweep runs', async () => {
    const store = storeWithContacts()
    const { client, sent } = recordingTelegram()
    await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:30:00'))
    await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:35:00'))
    await sendMissedVisitNotices(store, client, tashkent('2026-09-20T09:30:00'))
    // Woman A once; on the 20th, B's contact of the 19th has passed unrecorded too.
    expect(sent.map((s) => s.chatId)).toEqual([100, 200])
  })

  it('leaves today’s contact alone, and one older than the lookback', async () => {
    const store = storeWithContacts()
    store.channels.set(300, 'preg-c')
    store.visits.push({ visitId: 'v-old', pregnancyId: 'preg-c', targetDate: '2026-09-14', district: null })
    const { client, sent } = recordingTelegram()
    await sendMissedVisitNotices(store, client, tashkent('2026-09-19T10:00:00'))
    expect(sent.map((s) => s.chatId)).toEqual([100])
  })

  it('sends nothing to a woman with no Telegram: the specialist is told to phone her instead', async () => {
    const store = storeWithContacts()
    store.channels.delete(100)
    const { client, sent } = recordingTelegram()
    expect(await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:30:00'))).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('gives her the notice but no second survey when she is already answering one', async () => {
    const store = storeWithContacts()
    await store.createSurvey({ pregnancyId: 'preg-a', telegramChatId: 100, visitId: null, step: 'fever', expiresAt: new Date('2026-09-20T00:00:00Z') })
    const { client, sent } = recordingTelegram()
    await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:30:00'))
    expect(sent).toHaveLength(1)
    expect(sent[0].keyboard).toBeUndefined()
    expect(sent[0].text).not.toContain(SURVEY.intro)
    expect(store.surveys).toHaveLength(1)
  })

  it('gives the claim back after a failed send, so the next sweep tries again', async () => {
    const store = storeWithContacts()
    const { client, sent } = recordingTelegram([{ ok: false, blocked: false, description: 'timeout' }])
    expect(await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:30:00'))).toBe(0)
    expect(store.surveys).toHaveLength(0)
    expect(await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:35:00'))).toBe(1)
    expect(sent).toHaveLength(2)
    expect(store.surveys).toHaveLength(1)
  })

  it('does not retry a woman who blocked the bot', async () => {
    const store = storeWithContacts()
    const { client, sent } = recordingTelegram([{ ok: false, blocked: true, description: 'blocked' }])
    await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:30:00'))
    await sendMissedVisitNotices(store, client, tashkent('2026-09-19T09:35:00'))
    expect(sent).toHaveLength(1)
  })

  it('sends nothing at night', async () => {
    const store = storeWithContacts()
    const { client, sent } = recordingTelegram()
    await sendMissedVisitNotices(store, client, tashkent('2026-09-19T21:00:00'))
    expect(sent).toHaveLength(0)
  })
})

describe('latestPerPregnancy', () => {
  it('keeps one contact per pregnancy: the most recent', () => {
    const picked = latestPerPregnancy([
      { visitId: 'a1', pregnancyId: 'a', targetDate: '2026-09-16', district: null },
      { visitId: 'a2', pregnancyId: 'a', targetDate: '2026-09-18', district: null },
      { visitId: 'b1', pregnancyId: 'b', targetDate: '2026-09-17', district: null },
    ])
    expect(picked.map((v) => v.visitId)).toEqual(['b1', 'a2'])
  })
})
