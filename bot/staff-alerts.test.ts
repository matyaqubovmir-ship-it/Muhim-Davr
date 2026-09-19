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

describe('a contact nobody recorded', () => {
  const at = (iso: string) => new Date(iso + '+05:00')
  const noDigest = { read: () => null, write: () => {} }

  function storeWithMissed() {
    const store = createFakeStore()
    store.channels.set(100, 'preg-a') // on Telegram
    store.visits.push(
      { visitId: 'v-a', pregnancyId: 'preg-a', targetDate: '2026-09-18', district: 'Urganch' },
      { visitId: 'v-b', pregnancyId: 'preg-b', targetDate: '2026-09-17', district: 'Xiva' }, // no Telegram
      { visitId: 'v-today', pregnancyId: 'preg-c', targetDate: '2026-09-19', district: 'Gurlan' },
    )
    return store
  }

  it('tells the specialist once per contact, from 09:00, saying who must be phoned', async () => {
    const store = storeWithMissed()
    const { client, sent } = fakeTelegram()
    const alerter = createStaffAlerter(store, client, SEND, () => {}, noDigest)

    expect(await alerter.missedVisits(at('2026-09-19T08:30:00'))).toBe(0)
    expect(await alerter.missedVisits(at('2026-09-19T09:05:00'))).toBe(2)
    // Past the throttle, and still nothing new to say.
    expect(await alerter.missedVisits(at('2026-09-19T09:15:00'))).toBe(0)
    expect(sent).toHaveLength(2)

    const [xiva, urganch] = sent.map((s) => s.text)
    expect(urganch).toContain('ko‘rik qayd etilmadi')
    expect(urganch).toContain('Rejadagi sana: 18.09.2026')
    expect(urganch).toContain('Telegram: ulangan')
    expect(urganch).toContain('https://muhim-davr.example/patients/preg-a')
    expect(xiva).toContain('Telegram: ulanmagan — telefon orqali bog‘lanish kerak.')
    expect(sent.every((s) => s.chatId === SEND.chatId)).toBe(true)
  })

  it('retries a notice whose send failed', async () => {
    const store = storeWithMissed()
    const { client, sent } = fakeTelegram([{ ok: false, blocked: false, description: 'timeout' }])
    const alerter = createStaffAlerter(store, client, SEND, () => {}, noDigest)
    expect(await alerter.missedVisits(at('2026-09-19T09:05:00'))).toBe(0)
    expect(await alerter.missedVisits(at('2026-09-19T09:06:00'))).toBe(2)
    expect(sent).toHaveLength(3)
  })

  it('only logs in a dry run, once per contact, and claims nothing', async () => {
    const store = storeWithMissed()
    const { client, sent } = fakeTelegram()
    const lines: string[] = []
    const alerter = createStaffAlerter(store, client, DRY, (l) => lines.push(l), noDigest)
    await alerter.missedVisits(at('2026-09-19T09:05:00'))
    await alerter.missedVisits(at('2026-09-19T09:15:00'))
    expect(sent).toEqual([])
    expect(lines.filter((l) => l.includes('ko‘rik qayd etilmadi'))).toHaveLength(2)
    expect(store.staffClaims.size).toBe(0)
  })
})

describe('her survey answers', () => {
  const noDigest = { read: () => null, write: () => {} }

  async function closedSurvey(store: FakeStore, chatId: number, answers: Record<string, unknown>, escalationId: string | null = null) {
    const id = await store.createSurvey({ pregnancyId: `preg-${chatId}`, telegramChatId: chatId, visitId: 'v-1', step: 'bp', expiresAt: new Date('2026-09-20T00:00:00Z') })
    await store.closeSurvey(id!, { status: 'yakunlangan', answers, triageLevel: 'none', escalationId })
  }

  it('relays a closed survey’s answers without her own words, and not one from before the start', async () => {
    const store = createFakeStore()
    store.districts.set('preg-2', 'Urganch')
    store.visits.push({ visitId: 'v-1', pregnancyId: 'preg-2', targetDate: '2026-09-18', district: 'Urganch' })
    await closedSurvey(store, 1, { bp: null })
    const { client, sent } = fakeTelegram()
    const alerter = createStaffAlerter(store, client, SEND, () => {}, noDigest)

    expect(await alerter.surveys()).toBe(0) // start: the one above stays in the app
    await closedSurvey(store, 2, { bp: { systolic: 150, diastolic: 95 }, vaginal_bleeding: false, fever: true, other: 'mening ismim Nodira' })
    expect(await alerter.surveys()).toBe(1)
    expect(await alerter.surveys()).toBe(0)

    const text = sent[0].text
    expect(text).toContain('so‘rovnoma javoblari')
    expect(text).toContain('Tuman: Urganch')
    expect(text).toContain('Qayd etilmagan ko‘rik: 18.09.2026')
    expect(text).toContain('Qon bosimi (uyda o‘lchangan): 150/95')
    expect(text).toContain('Isitma: ha')
    expect(text).toContain('Qindan qon ketishi: yo‘q')
    expect(text).toContain('Qo‘shimcha: yozgan — ilovada o‘qing')
    expect(text).not.toContain('Nodira')
  })

  it('skips a survey that already raised a red alert', async () => {
    const store = createFakeStore()
    const { client, sent } = fakeTelegram()
    const alerter = createStaffAlerter(store, client, SEND, () => {}, noDigest)
    await alerter.surveys()
    await closedSurvey(store, 3, { vaginal_bleeding: true }, 'escalation-9')
    expect(await alerter.surveys()).toBe(0)
    expect(sent).toEqual([])
  })
})
