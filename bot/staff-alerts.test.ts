import { describe, expect, it } from 'vitest'
import { createFakeStore, type FakeStore } from './fake-store.ts'
import { createStaffAlerter, loadStaffAlertConfig, staffAlertText, type StaffAlertConfig } from './staff-alerts.ts'
import type { OpenEscalation } from './store.ts'
import type { SendOutcome, TelegramClient } from './telegram.ts'

const SEND: StaffAlertConfig = { chatId: -1001234, send: true, appUrl: 'https://muhim-davr.example', intervalMs: 15_000 }
const DRY: StaffAlertConfig = { ...SEND, send: false }

function alert(id: string, createdAt: string, extra: Partial<OpenEscalation> = {}): OpenEscalation {
  return {
    id,
    createdAt,
    source: 'clinic',
    reason: 'Akusherka ko‘rigida qizil zona aniqlandi. Qon bosimi juda yuqori (160/110 va undan yuqori).',
    pregnancyId: `preg-${id}`,
    district: 'Urganch',
    ...extra,
  }
}

function fakeTelegram(outcomes: SendOutcome[] = []) {
  const sent: { chatId: number; text: string }[] = []
  const client: TelegramClient = {
    async getUpdates() {
      return []
    },
    async sendMessage(chatId, text) {
      sent.push({ chatId, text })
      return outcomes.shift() ?? { ok: true, blocked: false }
    },
  }
  return { client, sent }
}

function open(store: FakeStore, a: OpenEscalation, status: 'ochiq' | 'qabul' = 'ochiq') {
  store.escalationFeed.push({ ...a, status })
}

describe('loadStaffAlertConfig', () => {
  it('is off without a chat id', () => {
    expect(loadStaffAlertConfig({})).toBeNull()
  })

  it('is a dry run unless STAFF_ALERTS=send, exactly', () => {
    expect(loadStaffAlertConfig({ STAFF_ALERT_CHAT_ID: '12345' })?.send).toBe(false)
    expect(loadStaffAlertConfig({ STAFF_ALERT_CHAT_ID: '12345', STAFF_ALERTS: 'yes' })?.send).toBe(false)
    expect(loadStaffAlertConfig({ STAFF_ALERT_CHAT_ID: '12345', STAFF_ALERTS: 'send' })?.send).toBe(true)
  })

  it('takes a group id and trims the app address', () => {
    expect(loadStaffAlertConfig({ STAFF_ALERT_CHAT_ID: '-1001234', APP_URL: 'https://x.app/' })).toMatchObject({
      chatId: -1001234,
      appUrl: 'https://x.app',
    })
  })

  it('refuses an id that is not a number rather than guess whose phone it is', () => {
    expect(() => loadStaffAlertConfig({ STAFF_ALERT_CHAT_ID: '@doctor' })).toThrow(/chat id/)
  })
})

describe('staffAlertText', () => {
  it('says where, from which channel and why, with a link — and no name', () => {
    const text = staffAlertText(alert('e1', '2026-09-18T10:00:00Z', { source: 'telegram' }), SEND.appUrl)
    expect(text).toContain('Urganch')
    expect(text).toContain('bemorning o‘z Telegrami')
    expect(text).toContain('Qon bosimi juda yuqori')
    expect(text).toContain('https://muhim-davr.example/patients/preg-e1')
  })

  it('points at the app when there is no address to link', () => {
    expect(staffAlertText(alert('e1', '2026-09-18T10:00:00Z'), null)).toContain('Yo‘llanmalar')
  })
})

describe('the staff alerter', () => {
  it('starts after the newest escalation already there: history is not re-sent', async () => {
    const store = createFakeStore()
    open(store, alert('old', '2026-09-18T09:00:00Z'))
    const { client, sent } = fakeTelegram()
    const alerter = createStaffAlerter(store, client, SEND, () => {})
    await alerter.start()
    expect(await alerter.sweep()).toBe(0)

    open(store, alert('new', '2026-09-18T09:05:00Z'))
    expect(await alerter.sweep()).toBe(1)
    expect(sent.map((s) => s.chatId)).toEqual([-1001234])
    expect(await alerter.sweep()).toBe(0)
  })

  it('sends each new open escalation once, oldest first, and skips ones already taken', async () => {
    const store = createFakeStore()
    const { client, sent } = fakeTelegram()
    const alerter = createStaffAlerter(store, client, SEND, () => {})
    await alerter.start()
    open(store, alert('b', '2026-09-18T10:02:00Z', { district: 'Xiva' }))
    open(store, alert('a', '2026-09-18T10:01:00Z', { district: 'Gurlan' }))
    open(store, alert('taken', '2026-09-18T10:03:00Z', { district: 'Shovot' }), 'qabul')
    await alerter.sweep()
    expect(sent.map((s) => s.text.split('\n')[1])).toEqual(['Tuman: Gurlan', 'Tuman: Xiva'])
  })

  it('in a dry run logs the alert and sends nothing', async () => {
    const store = createFakeStore()
    const { client, sent } = fakeTelegram()
    const lines: string[] = []
    const alerter = createStaffAlerter(store, client, DRY, (line) => lines.push(line))
    await alerter.start()
    open(store, alert('e1', '2026-09-18T10:00:00Z'))
    expect(await alerter.sweep()).toBe(1)
    expect(sent).toEqual([])
    expect(lines.join('\n')).toMatch(/DRY RUN/)
  })

  it('retries a failed send on the next sweep instead of losing it', async () => {
    const store = createFakeStore()
    const { client, sent } = fakeTelegram([{ ok: false, blocked: false, description: 'network' }])
    const alerter = createStaffAlerter(store, client, SEND, () => {})
    await alerter.start()
    open(store, alert('e1', '2026-09-18T10:00:00Z'))
    open(store, alert('e2', '2026-09-18T10:01:00Z'))
    expect(await alerter.sweep()).toBe(0)
    expect(await alerter.sweep()).toBe(2)
    expect(sent.map((s) => s.text.includes('preg-e1'))).toEqual([true, true, false])
  })

  it('passes a chat that has blocked the bot rather than stall every alert behind it', async () => {
    const store = createFakeStore()
    const { client } = fakeTelegram([{ ok: false, blocked: true, description: 'bot was kicked' }])
    const lines: string[] = []
    const alerter = createStaffAlerter(store, client, SEND, (line) => lines.push(line))
    await alerter.start()
    open(store, alert('e1', '2026-09-18T10:00:00Z'))
    open(store, alert('e2', '2026-09-18T10:01:00Z'))
    expect(await alerter.sweep()).toBe(2)
    expect(lines.join('\n')).toMatch(/refused/)
  })

  it('refuses to sweep before it knows where to start', async () => {
    const alerter = createStaffAlerter(createFakeStore(), fakeTelegram().client, SEND, () => {})
    await expect(alerter.sweep()).rejects.toThrow(/start/)
  })
})

describe('the morning digest', () => {
  const tashkent = (iso: string) => new Date(iso + '+05:00')
  const memory = () => {
    let day: string | null = null
    return {
      read: () => day,
      write: (d: string) => {
        day = d
      },
    }
  }

  function storeWithDay() {
    const store = createFakeStore()
    store.visits.push(
      { visitId: 'a', pregnancyId: 'p-a', targetDate: '2026-09-18', district: 'Urganch' },
      { visitId: 'b', pregnancyId: 'p-b', targetDate: '2026-09-18', district: 'Urganch' },
      { visitId: 'c', pregnancyId: 'p-c', targetDate: '2026-09-18', district: 'Xiva' },
      { visitId: 'd', pregnancyId: 'p-d', targetDate: '2026-09-10', district: 'Xiva' },
      { visitId: 'e', pregnancyId: 'p-e', targetDate: '2026-09-25', district: 'Xiva' },
    )
    store.channels.set(1, 'p-a')
    return store
  }

  it('counts today by district, who must be phoned, and who is overdue — no names', async () => {
    const { client, sent } = fakeTelegram()
    const alerter = createStaffAlerter(storeWithDay(), client, SEND, () => {}, memory())
    expect(await alerter.digest(tashkent('2026-09-18T07:05:00'))).toBe(true)
    const text = sent[0].text
    expect(text).toContain('18.09.2026')
    expect(text).toContain('Bugun: 3 ta ko‘rik rejalashtirilgan: Urganch 2, Xiva 1')
    expect(text).toContain('telefon orqali eslatish kerak: 2')
    expect(text).toContain('Muddati o‘tgan (ko‘rik kiritilmagan): 1')
    expect(text).toContain('https://muhim-davr.example/visits')
  })

  it('goes out once a day, from seven, however often the bot ticks', async () => {
    const { client, sent } = fakeTelegram()
    const alerter = createStaffAlerter(storeWithDay(), client, SEND, () => {}, memory())
    expect(await alerter.digest(tashkent('2026-09-18T06:59:00'))).toBe(false)
    expect(await alerter.digest(tashkent('2026-09-18T07:00:00'))).toBe(true)
    expect(await alerter.digest(tashkent('2026-09-18T12:00:00'))).toBe(false)
    expect(await alerter.digest(tashkent('2026-09-19T07:30:00'))).toBe(true)
    expect(sent).toHaveLength(2)
  })

  it('remembers the day across a restart', async () => {
    const day = memory()
    const { client, sent } = fakeTelegram()
    await createStaffAlerter(storeWithDay(), client, SEND, () => {}, day).digest(tashkent('2026-09-18T08:00:00'))
    await createStaffAlerter(storeWithDay(), client, SEND, () => {}, day).digest(tashkent('2026-09-18T09:00:00'))
    expect(sent).toHaveLength(1)
  })

  it('only logs in a dry run', async () => {
    const { client, sent } = fakeTelegram()
    const lines: string[] = []
    await createStaffAlerter(storeWithDay(), client, DRY, (l) => lines.push(l), memory()).digest(tashkent('2026-09-18T08:00:00'))
    expect(sent).toEqual([])
    expect(lines.join('\n')).toMatch(/DRY RUN — would send the morning digest/)
  })
})
