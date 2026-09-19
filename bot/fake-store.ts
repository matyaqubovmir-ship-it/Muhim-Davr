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
  FinishedSurvey,
  LinkedChannel,
  OpenEscalation,
  OpenSurvey,
  PatientReportRow,
  PlannedVisit,
  ReminderKind,
  SurveyClose,
} from './store.ts'

/** A survey row as the fake keeps it: open, or closed with how it closed. */
export interface FakeSurvey extends OpenSurvey {
  expiresAt: Date
  closed: (SurveyClose & { finishedAt: string }) | null
}

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
  /** What the staff-alert reads see: every escalation, with its status. */
  escalationFeed: (OpenEscalation & { status: 'ochiq' | 'qabul' | 'yopiq' | 'bekor' })[]
  surveys: FakeSurvey[]
  /** District per pregnancy, for the specialist's survey summary. */
  districts: Map<string, string>
  staffClaims: Set<string>
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
    escalationFeed: [],
    surveys: [],
    districts: new Map(),
    staffClaims: new Set(),
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
    async releaseReminder(visitId, chatId, kind) {
      fail('releaseReminder')
      store.claims.delete(`${visitId}|${chatId}|${kind}`)
    },
    async findBroadcastTargets(tuman) {
      fail('findBroadcastTargets')
      return store.broadcastTargets.get(tuman) ?? []
    },
    async listDistricts() {
      fail('listDistricts')
      return [...store.broadcastTargets.keys()].sort()
    },
    async plannedVisitsBetween(since, today) {
      fail('plannedVisitsBetween')
      return store.visits.filter((v) => v.targetDate >= since && v.targetDate <= today)
    },
    async latestEscalationCreatedAt() {
      fail('latestEscalationCreatedAt')
      const times = store.escalationFeed.map((e) => e.createdAt).sort()
      return times.at(-1) ?? null
    },
    async openEscalationsAfter(after, limit) {
      fail('openEscalationsAfter')
      return store.escalationFeed
        .filter((e) => e.status === 'ochiq' && (after === null || e.createdAt > after))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit)
        .map(({ status: _status, ...alert }) => alert)
    },

    async findOpenSurvey(chatId) {
      fail('findOpenSurvey')
      const found = store.surveys.find((s) => s.telegramChatId === chatId && s.closed === null)
      return found === undefined ? null : openView(found)
    },
    async createSurvey(survey) {
      fail('createSurvey')
      if (store.surveys.some((s) => s.telegramChatId === survey.telegramChatId && s.closed === null)) return null
      const id = `survey-${store.surveys.length + 1}`
      store.surveys.push({ id, ...survey, answers: {}, closed: null })
      return id
    },
    async saveSurveyProgress(id, step, answers) {
      fail('saveSurveyProgress')
      const survey = store.surveys.find((s) => s.id === id && s.closed === null)
      if (survey === undefined) return
      survey.step = step
      survey.answers = structuredClone(answers)
    },
    async closeSurvey(id, close) {
      fail('closeSurvey')
      const survey = store.surveys.find((s) => s.id === id && s.closed === null)
      if (survey === undefined) return
      survey.answers = structuredClone(close.answers)
      // Strictly increasing, so the summary watermark has something to order by.
      const finishedAt = new Date(Date.UTC(2026, 8, 19, 9, 0, store.surveys.filter((s) => s.closed).length)).toISOString()
      survey.closed = { ...close, answers: survey.answers, finishedAt }
    },
    async expiredSurveys(now, limit) {
      fail('expiredSurveys')
      return store.surveys
        .filter((s) => s.closed === null && s.expiresAt < now)
        .slice(0, limit)
        .map(openView)
    },
    async latestSurveyFinishedAt() {
      fail('latestSurveyFinishedAt')
      const times = store.surveys.flatMap((s) => (s.closed ? [s.closed.finishedAt] : [])).sort()
      return times.at(-1) ?? null
    },
    async finishedSurveysAfter(after, limit) {
      fail('finishedSurveysAfter')
      return store.surveys
        .flatMap((s): FinishedSurvey[] => {
          if (s.closed === null || (after !== null && s.closed.finishedAt <= after)) return []
          return [
            {
              id: s.id,
              finishedAt: s.closed.finishedAt,
              status: s.closed.status,
              pregnancyId: s.pregnancyId,
              district: store.districts.get(s.pregnancyId) ?? null,
              visitDate: store.visits.find((v) => v.visitId === s.visitId)?.targetDate ?? null,
              answers: s.closed.answers,
              escalationId: s.closed.escalationId,
            },
          ]
        })
        .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
        .slice(0, limit)
    },
    async claimStaffVisitAlert(visitId, chatId) {
      fail('claimStaffVisitAlert')
      const key = `${visitId}|${chatId}`
      if (store.staffClaims.has(key)) return false
      store.staffClaims.add(key)
      return true
    },
    async releaseStaffVisitAlert(visitId, chatId) {
      fail('releaseStaffVisitAlert')
      store.staffClaims.delete(`${visitId}|${chatId}`)
    },
  }

  function openView(s: FakeSurvey): OpenSurvey {
    return { id: s.id, pregnancyId: s.pregnancyId, telegramChatId: s.telegramChatId, visitId: s.visitId, step: s.step, answers: structuredClone(s.answers) }
  }

  function fail(method: keyof BotStore): void {
    if (store.failing.has(method)) throw new Error(`${method} is down`)
  }

  return store
}
