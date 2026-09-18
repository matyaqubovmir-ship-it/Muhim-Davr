/**
 * An in-memory BotStore for tests. Not used at runtime.
 *
 * Only as clever as the tests need: it records every write so a test can assert
 * on exactly what the bot would have put in the database, and any method can be
 * made to fail to exercise the paths where the database is down.
 */

import type {
  BotStore,
  BroadcastTarget,
  EscalationRow,
  LinkedChannel,
  PatientReportRow,
  PlannedVisit,
  ReminderKind,
} from './store.ts'

export interface FakeStore extends BotStore {
  channels: Map<number, string>
  pregnanciesByCode: Map<string, string[]>
  assessments: Record<string, unknown>[]
  escalations: EscalationRow[]
  /** Ids of escalations a test has marked as already acknowledged or closed. */
  settledEscalations: Set<string>
  reports: PatientReportRow[]
  visits: PlannedVisit[]
  claims: Set<string>
  broadcastTargets: Map<string, BroadcastTarget[]>
  /** Method names that throw when called. */
  failing: Set<keyof BotStore>
}

export function createFakeStore(): FakeStore {
  const store: FakeStore = {
    channels: new Map(),
    pregnanciesByCode: new Map(),
    assessments: [],
    escalations: [],
    settledEscalations: new Set(),
    reports: [],
    visits: [],
    claims: new Set(),
    broadcastTargets: new Map(),
    failing: new Set(),

    async findChannel(chatId): Promise<LinkedChannel | null> {
      fail('findChannel')
      const pregnancyId = store.channels.get(chatId)
      return pregnancyId === undefined ? null : { pregnancyId, telegramChatId: chatId }
    },
    async findActivePregnancyIdsByCode(code) {
      fail('findActivePregnancyIdsByCode')
      return (store.pregnanciesByCode.get(code) ?? []).slice(0, 2)
    },
    async linkChat(pregnancyId, chatId) {
      fail('linkChat')
      store.channels.set(chatId, pregnancyId)
    },
    async insertAssessment(row) {
      fail('insertAssessment')
      store.assessments.push(row)
      return `assessment-${store.assessments.length}`
    },
    async insertEscalation(row) {
      fail('insertEscalation')
      store.escalations.push(row)
      return `escalation-${store.escalations.length}`
    },
    async findOpenTelegramEscalation(pregnancyId) {
      fail('findOpenTelegramEscalation')
      for (let i = store.escalations.length - 1; i >= 0; i--) {
        const row = store.escalations[i]
        const id = `escalation-${i + 1}`
        if (row.pregnancy_id === pregnancyId && row.source === 'telegram' && !store.settledEscalations.has(id)) {
          return id
        }
      }
      return null
    },
    async insertReport(row) {
      fail('insertReport')
      store.reports.push(row)
    },
    async findPlannedVisits(dates) {
      fail('findPlannedVisits')
      return store.visits.filter((visit) => dates.includes(visit.targetDate))
    },
    async findChatsForPregnancies(pregnancyIds) {
      fail('findChatsForPregnancies')
      const byPregnancy = new Map<string, number[]>()
      for (const [chatId, pregnancyId] of store.channels) {
        if (!pregnancyIds.includes(pregnancyId)) continue
        byPregnancy.set(pregnancyId, [...(byPregnancy.get(pregnancyId) ?? []), chatId])
      }
      return byPregnancy
    },
    async claimReminder(visitId, chatId, kind: ReminderKind) {
      fail('claimReminder')
      const key = `${visitId}|${chatId}|${kind}`
      if (store.claims.has(key)) return false
      store.claims.add(key)
      return true
    },
    async findBroadcastTargets(tuman) {
      fail('findBroadcastTargets')
      return store.broadcastTargets.get(tuman) ?? []
    },
    async listDistricts() {
      fail('listDistricts')
      return [...store.broadcastTargets.keys()].sort()
    },
  }

  function fail(method: keyof BotStore): void {
    if (store.failing.has(method)) throw new Error(`${method} is down`)
  }

  return store
}
