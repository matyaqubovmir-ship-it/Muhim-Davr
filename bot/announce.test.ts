import { describe, expect, it } from 'vitest'
import { parseBroadcastArgs, sendAnnouncement } from './announce.ts'
import type { TelegramClient } from './telegram.ts'

describe('parseBroadcastArgs', () => {
  it('is a dry run unless --send is given', () => {
    expect(parseBroadcastArgs(['--tuman', 'Urganch', '--message', 'Matn'])).toEqual({
      tuman: 'Urganch',
      message: 'Matn',
      send: false,
    })
    expect(parseBroadcastArgs(['--tuman', 'Urganch', '--message', 'Matn', '--send'])?.send).toBe(true)
  })

  it('refuses a missing tuman or message rather than guessing an audience', () => {
    expect(parseBroadcastArgs(['--message', 'Matn'])).toBe(null)
    expect(parseBroadcastArgs(['--tuman', 'Urganch'])).toBe(null)
    expect(parseBroadcastArgs(['--tuman', '--message', 'Matn'])).toBe(null)
    expect(parseBroadcastArgs(['--tuman', 'Urganch', '--message', '   '])).toBe(null)
  })
})

describe('sendAnnouncement', () => {
  it('sends the text unchanged to every target and counts the outcomes', async () => {
    const sent: { chatId: number; text: string }[] = []
    const telegram: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text })
        if (chatId === 2) return { ok: false, blocked: true }
        if (chatId === 3) return { ok: false, blocked: false, description: 'boom' }
        return { ok: true, blocked: false }
      },
    }
    const message = 'Ertaga tuman poliklinikasi soat 9:00 dan ishlaydi.'
    const outcome = await sendAnnouncement(
      telegram,
      [1, 2, 3, 4].map((chatId) => ({ chatId, pregnancyId: `p${chatId}` })),
      message,
      0,
    )
    expect(outcome).toEqual({ sent: 2, blocked: 1, failed: 1 })
    expect(sent.every((m) => m.text === message)).toBe(true)
  })
})
