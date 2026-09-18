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
