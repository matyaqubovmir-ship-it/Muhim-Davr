import { describe, expect, it } from 'vitest'
import { createFakeStore } from './fake-store.ts'
import { clinicClock, sendDueReminders } from './reminders.ts'
import type { TelegramClient } from './telegram.ts'

/** Tashkent is UTC+5 all year, with no daylight saving. */
function tashkent(isoLocal: string): Date {
  return new Date(isoLocal + '+05:00')
}

function recordingTelegram() {
  const sent: { chatId: number; text: string }[] = []
  const client: TelegramClient = {
    getUpdates: async () => [],
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text })
      return { ok: true, blocked: false }
    },
  }
  return { client, sent }
}

function storeWithVisits() {
  const store = createFakeStore()
  store.channels.set(100, 'preg-a')
  store.channels.set(101, 'preg-a') // her husband's phone, linked separately
  store.channels.set(200, 'preg-b')
  store.visits.push(
    { visitId: 'v-today', pregnancyId: 'preg-a', targetDate: '2026-09-18', district: 'Urganch' },
    { visitId: 'v-in-two', pregnancyId: 'preg-b', targetDate: '2026-09-20', district: 'Xiva' },
    { visitId: 'v-tomorrow', pregnancyId: 'preg-b', targetDate: '2026-09-19', district: 'Xiva' },
  )
  return store
}

describe('clinicClock', () => {
  it('reads the calendar day and hour in Tashkent, whatever the machine clock says', () => {
    // 20:30 UTC on the 17th is 01:30 on the 18th in Tashkent.
    const { today, hour } = clinicClock(new Date('2026-09-17T20:30:00Z'))
    expect(today.getFullYear()).toBe(2026)
    expect(today.getMonth()).toBe(8)
    expect(today.getDate()).toBe(18)
    expect(hour).toBe(1)
  })
})

describe('sendDueReminders', () => {
  it('sends the morning reminder today and the two-day reminder, to every linked chat', async () => {
    const store = storeWithVisits()
    const { client, sent } = recordingTelegram()

    const count = await sendDueReminders(store, client, tashkent('2026-09-18T08:00:00'))

    // Tomorrow's visit had no two-day reminder (this store never swept on the
    // 17th), so it gets the day-before one.
    expect(count).toBe(4)
    expect(sent.filter((m) => m.chatId === 100)[0].text).toContain('bugun, 18.09.2026')
    expect(sent.filter((m) => m.chatId === 101)[0].text).toContain('bugun, 18.09.2026')
    const toB = sent.filter((m) => m.chatId === 200).map((m) => m.text)
    expect(toB.some((t) => t.includes('20.09.2026') && t.includes('2 kundan keyin'))).toBe(true)
    expect(toB.some((t) => t.includes('ertaga, 19.09.2026'))).toBe(true)
  })

  it('does not send the day-before reminder after a two-day one went out', async () => {
    const store = storeWithVisits()
    const { client, sent } = recordingTelegram()
    await sendDueReminders(store, client, tashkent('2026-09-17T08:00:00'))
    const onThe17th = sent.length
    await sendDueReminders(store, client, tashkent('2026-09-18T08:00:00'))
    const tomorrowTexts = sent.slice(onThe17th).filter((m) => m.text.includes('19.09.2026'))
    expect(tomorrowTexts).toEqual([])
  })

  it('tries again next sweep when Telegram fails, instead of losing the reminder', async () => {
    const store = createFakeStore()
    store.channels.set(100, 'preg-a')
    store.visits.push({ visitId: 'v', pregnancyId: 'preg-a', targetDate: '2026-09-18', district: null })
    let fail = true
    const sent: string[] = []
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async (_chat, text) => {
        if (fail) return { ok: false, blocked: false, description: 'timeout' }
        sent.push(text)
        return { ok: true, blocked: false }
      },
    }
    expect(await sendDueReminders(store, client, tashkent('2026-09-18T08:00:00'))).toBe(0)
    fail = false
    expect(await sendDueReminders(store, client, tashkent('2026-09-18T08:05:00'))).toBe(1)
    expect(sent).toHaveLength(1)
  })

  it('never sends the same reminder twice, however often it sweeps', async () => {
    const store = storeWithVisits()
    const { client, sent } = recordingTelegram()
    const now = tashkent('2026-09-18T08:00:00')

    await sendDueReminders(store, client, now)
    await sendDueReminders(store, client, now)
    await sendDueReminders(store, client, tashkent('2026-09-18T15:00:00'))

    expect(sent).toHaveLength(4)
  })

  it('sends nothing overnight, and sends it at seven instead', async () => {
    const store = storeWithVisits()
    const { client, sent } = recordingTelegram()

    expect(await sendDueReminders(store, client, tashkent('2026-09-18T03:00:00'))).toBe(0)
    expect(await sendDueReminders(store, client, tashkent('2026-09-17T22:30:00'))).toBe(0)
    expect(sent).toHaveLength(0)

    expect(await sendDueReminders(store, client, tashkent('2026-09-18T07:00:00'))).toBe(4)
  })

  it('does not stop the sweep when one send fails', async () => {
    const store = storeWithVisits()
    let calls = 0
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async () => {
        calls++
        return calls === 1 ? { ok: false, blocked: true, description: 'blocked' } : { ok: true, blocked: false }
      },
    }
    expect(await sendDueReminders(store, client, tashkent('2026-09-18T09:00:00'))).toBe(3)
    expect(calls).toBe(4)
  })

  it('sends nothing to a pregnancy with no linked chat', async () => {
    const store = createFakeStore()
    store.visits.push({ visitId: 'v', pregnancyId: 'unlinked', targetDate: '2026-09-18', district: null })
    const { client, sent } = recordingTelegram()
    expect(await sendDueReminders(store, client, tashkent('2026-09-18T09:00:00'))).toBe(0)
    expect(sent).toHaveLength(0)
  })
})
