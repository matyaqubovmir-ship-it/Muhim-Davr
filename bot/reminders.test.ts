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

    expect(count).toBe(3)
    const byChat = Object.fromEntries(sent.map((m) => [m.chatId, m.text]))
    expect(byChat[100]).toContain('bugun, 18.09.2026')
    expect(byChat[101]).toContain('bugun, 18.09.2026')
    expect(byChat[200]).toContain('20.09.2026')
    expect(byChat[200]).toContain('2 kundan keyin')
    // The visit tomorrow is neither today nor two days out.
    expect(sent.some((m) => m.text.includes('19.09.2026'))).toBe(false)
  })

  it('never sends the same reminder twice, however often it sweeps', async () => {
    const store = storeWithVisits()
    const { client, sent } = recordingTelegram()
    const now = tashkent('2026-09-18T08:00:00')

    await sendDueReminders(store, client, now)
    await sendDueReminders(store, client, now)
    await sendDueReminders(store, client, tashkent('2026-09-18T15:00:00'))

    expect(sent).toHaveLength(3)
  })

  it('sends nothing overnight, and sends it at seven instead', async () => {
    const store = storeWithVisits()
    const { client, sent } = recordingTelegram()

    expect(await sendDueReminders(store, client, tashkent('2026-09-18T03:00:00'))).toBe(0)
    expect(await sendDueReminders(store, client, tashkent('2026-09-17T22:30:00'))).toBe(0)
    expect(sent).toHaveLength(0)

    expect(await sendDueReminders(store, client, tashkent('2026-09-18T07:00:00'))).toBe(3)
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
    expect(await sendDueReminders(store, client, tashkent('2026-09-18T09:00:00'))).toBe(2)
    expect(calls).toBe(3)
  })

  it('sends nothing to a pregnancy with no linked chat', async () => {
    const store = createFakeStore()
    store.visits.push({ visitId: 'v', pregnancyId: 'unlinked', targetDate: '2026-09-18', district: null })
    const { client, sent } = recordingTelegram()
    expect(await sendDueReminders(store, client, tashkent('2026-09-18T09:00:00'))).toBe(0)
    expect(sent).toHaveLength(0)
  })
})
