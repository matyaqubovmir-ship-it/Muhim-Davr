/**
 * Every database read and write the bot makes, behind one interface.
 *
 * The handlers take a BotStore rather than a Supabase client so the decisions
 * they make — who is linked, what is written, which reminder goes out — can be
 * tested against an in-memory store with no network. createSupabaseStore is the
 * only implementation that touches a real database.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EscalationRow } from '../src/lib/escalation.ts'

export interface LinkedChannel {
  pregnancyId: string
  telegramChatId: number
}

/** 'kechikkan' is the morning-after notice for a contact nobody recorded (needs 008). */
export type ReminderKind = 'ikki_kun' | 'ertalab' | 'kechikkan'

export type SurveyStatus = 'ochiq' | 'yakunlangan' | 'muddati_otgan'

/** A survey still waiting for her next answer (patient_surveys, 008). */
export interface OpenSurvey {
  id: string
  pregnancyId: string
  telegramChatId: number
  visitId: string | null
  /** The question she is being asked now. */
  step: string
  /** Only what she answered: a missing key is a question never answered. */
  answers: Record<string, unknown>
}

export interface NewSurvey {
  pregnancyId: string
  telegramChatId: number
  visitId: string | null
  step: string
  expiresAt: Date
}

export interface SurveyClose {
  status: Exclude<SurveyStatus, 'ochiq'>
  answers: Record<string, unknown>
  /** Null when nothing she answered was written as a report. */
  triageLevel: 'immediate' | 'prompt' | 'none' | null
  escalationId: string | null
}

/** A closed survey, as much of it as the specialist's summary carries. */
export interface FinishedSurvey {
  id: string
  /** As Postgres returned it: the watermark survey summaries resume from. */
  finishedAt: string
  status: Exclude<SurveyStatus, 'ochiq'>
  pregnancyId: string
  district: string | null
  /** The contact that was not recorded, YYYY-MM-DD, if its row still exists. */
  visitDate: string | null
  answers: Record<string, unknown>
  escalationId: string | null
}

export interface PlannedVisit {
  visitId: string
  pregnancyId: string
  /** YYYY-MM-DD, exactly as Postgres stores the date. */
  targetDate: string
  /** The patient's tuman, for the "where to go" line. Null if not recorded. */
  district: string | null
}

export interface BroadcastTarget {
  chatId: number
  pregnancyId: string
}

export interface PatientReportRow {
  pregnancy_id: string
  telegram_chat_id: number
  message_text: string
  extracted_json: unknown
  triage_level: 'immediate' | 'prompt' | 'none'
  matched_signs: string[]
  assessment_id: string | null
  escalation_id: string | null
}

export type { EscalationRow }

/** An open escalation, as much of it as a specialist's Telegram alert carries. */
export interface OpenEscalation {
  id: string
  /** As Postgres returned it: the watermark staff alerts resume from. */
  createdAt: string
  source: 'clinic' | 'telegram'
  reason: string
  pregnancyId: string
  district: string | null
}

export interface BotStore {
  findChannel(chatId: number): Promise<LinkedChannel | null>
  /** Active pregnancies with this link code. At most two: two means ambiguous. */
  findActivePregnancyIdsByCode(code: string): Promise<string[]>
  /** Points this chat at this pregnancy, replacing any earlier link. */
  linkChat(pregnancyId: string, chatId: number): Promise<void>

  insertAssessment(row: Record<string, unknown>): Promise<string>
  insertEscalation(row: EscalationRow): Promise<string>
  /** Her Telegram escalation still waiting for a specialist (ochiq), if one exists. */
  findOpenTelegramEscalation(pregnancyId: string): Promise<string | null>
  insertReport(row: PatientReportRow): Promise<void>

  /** Planned visits on these dates, for active pregnancies only. */
  findPlannedVisits(dates: readonly string[]): Promise<PlannedVisit[]>
  findChatsForPregnancies(pregnancyIds: readonly string[]): Promise<Map<string, number[]>>
  /**
   * Records that this reminder is being sent. False if it was already recorded,
   * which is how a reminder is never sent twice.
   */
  claimReminder(visitId: string, chatId: number, kind: ReminderKind): Promise<boolean>
  /** Gives a claim back after a send that failed, so a later sweep tries again (needs 007). */
  releaseReminder(visitId: string, chatId: number, kind: ReminderKind): Promise<void>

  /** Linked chats of active pregnancies whose patient lives in this tuman. */
  findBroadcastTargets(tuman: string): Promise<BroadcastTarget[]>
  /** Every tuman with at least one patient, for correcting a misspelt one. */
  listDistricts(): Promise<string[]>

  /** Planned contacts of active pregnancies from `since` to `today` inclusive, for the morning digest. */
  plannedVisitsBetween(since: string, today: string): Promise<PlannedVisit[]>

  /** created_at of the newest escalation of any status, or null with none: where staff alerts start. */
  latestEscalationCreatedAt(): Promise<string | null>
  /** Escalations still open (ochiq) created after `after`, oldest first. */
  openEscalationsAfter(after: string | null, limit: number): Promise<OpenEscalation[]>

  // --- the survey after a contact nobody recorded (needs 008) ---------------

  findOpenSurvey(chatId: number): Promise<OpenSurvey | null>
  /** Starts one. Null if this chat already has one open — one conversation at a time. */
  createSurvey(survey: NewSurvey): Promise<string | null>
  /** Records her latest answer and the next question, while the survey is still open. */
  saveSurveyProgress(id: string, step: string, answers: Record<string, unknown>): Promise<void>
  /** Closes it. A survey already closed is left as it was. */
  closeSurvey(id: string, close: SurveyClose): Promise<void>
  /** Open surveys whose time ran out before `now`, oldest first. */
  expiredSurveys(now: Date, limit: number): Promise<OpenSurvey[]>

  /** finished_at of the newest closed survey, or null with none: where survey summaries start. */
  latestSurveyFinishedAt(): Promise<string | null>
  /** Surveys closed after `after`, oldest first. */
  finishedSurveysAfter(after: string | null, limit: number): Promise<FinishedSurvey[]>

  /** The specialist's notice about one contact, claimed like a reminder. False if already sent. */
  claimStaffVisitAlert(visitId: string, chatId: number): Promise<boolean>
  releaseStaffVisitAlert(visitId: string, chatId: number): Promise<void>
}

/** An error naming a table or enum value from 008 almost always means 008 was not applied yet. */
function migrationHint(message: string): string {
  return /patient_surveys|staff_visit_alerts|kechikkan/.test(message)
    ? `${message} — apply supabase/migrations/008_missed_visit_survey.sql`
    : message
}

function toSurvey(row: Record<string, unknown>): OpenSurvey {
  const answers = row.answers
  return {
    id: String(row.id),
    pregnancyId: String(row.pregnancy_id),
    telegramChatId: Number(row.telegram_chat_id),
    visitId: typeof row.visit_id === 'string' ? row.visit_id : null,
    step: String(row.step),
    answers: typeof answers === 'object' && answers !== null && !Array.isArray(answers) ? (answers as Record<string, unknown>) : {},
  }
}

/** Postgres unique_violation: the row is already there. */
const UNIQUE_VIOLATION = '23505'

/** Supabase caps a response at 1000 rows by default; pages stay under it. */
const PAGE_SIZE = 500

/** Ids per .in() filter, so the request URL stays short. */
const ID_BATCH = 100

/**
 * A many-to-one embed comes back as an object at runtime, but untyped clients
 * see it as possibly an array. Accept both.
 */
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  return null
}

export function createSupabaseStore(db: SupabaseClient): BotStore {
  return {
    async findChannel(chatId) {
      const { data, error } = await db
        .from('patient_channels')
        .select('pregnancy_id, pregnancies!patient_channels_pregnancy_id_fkey(is_active)')
        .eq('telegram_chat_id', chatId)
        .maybeSingle()
      if (error) throw new Error(`patient_channels lookup failed: ${error.message}`)
      if (!data) return null
      // A link to a pregnancy that has ended is no link: her next messages would
      // be filed under a closed case the registry never shows. She is asked to
      // link again, with the code for her current pregnancy.
      if (one(data.pregnancies)?.is_active !== true) return null
      return { pregnancyId: String(data.pregnancy_id), telegramChatId: chatId }
    },

    async findActivePregnancyIdsByCode(code) {
      const { data, error } = await db
        .from('pregnancies')
        .select('id')
        .eq('link_code', code)
        .eq('is_active', true)
        .limit(2)
      if (error) throw new Error(`pregnancy lookup failed: ${error.message}`)
      return (data ?? []).map((row) => String(row.id))
    },

    async linkChat(pregnancyId, chatId) {
      const { error } = await db.from('patient_channels').upsert(
        {
          pregnancy_id: pregnancyId,
          telegram_chat_id: chatId,
          linked_at: new Date().toISOString(),
        },
        { onConflict: 'telegram_chat_id' },
      )
      if (error) throw new Error(`linking failed: ${error.message}`)
    },

    async insertAssessment(row) {
      const { data, error } = await db.from('assessments').insert(row).select('id').single()
      if (error) throw new Error(`assessment insert failed: ${error.message}`)
      return String(data.id)
    },

    async insertEscalation(row) {
      const { data, error } = await db.from('escalations').insert(row).select('id').single()
      if (error) throw new Error(`escalation insert failed: ${error.message}`)
      return String(data.id)
    },

    async findOpenTelegramEscalation(pregnancyId) {
      const { data, error } = await db
        .from('escalations')
        .select('id')
        .eq('pregnancy_id', pregnancyId)
        .eq('source', 'telegram')
        .eq('status', 'ochiq')
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(`open escalation lookup failed: ${error.message}`)
      return data && data.length > 0 ? String(data[0].id) : null
    },

    async insertReport(row) {
      const { error } = await db.from('patient_reports').insert(row)
      if (error) throw new Error(`patient_reports insert failed: ${error.message}`)
    },

    async findPlannedVisits(dates) {
      if (dates.length === 0) return []
      // !inner so the is_active filter removes the visit, not just the embed. A
      // reminder for a pregnancy that has ended — in a birth or in a loss — is
      // the one message this channel must never send.
      // Paged: a region's day of due visits can pass the 1000 rows a response
      // holds, and an unpaged sweep would re-read the same first page forever.
      const rows: Record<string, unknown>[] = []
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await db
          .from('visits')
          .select('id, pregnancy_id, target_date, pregnancies!inner(is_active, patients(district))')
          .eq('status', 'rejalashtirilgan')
          .in('target_date', [...dates])
          .eq('pregnancies.is_active', true)
          .order('id')
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(`due visit lookup failed: ${error.message}`)
        rows.push(...((data ?? []) as Record<string, unknown>[]))
        if (!data || data.length < PAGE_SIZE) break
      }

      const visits: PlannedVisit[] = []
      for (const row of rows) {
        const pregnancy = one(row.pregnancies)
        // Checked again here, not only trusted to the filter above.
        if (pregnancy?.is_active !== true) continue
        const patient = one(pregnancy.patients)
        const district = typeof patient?.district === 'string' ? patient.district : null
        visits.push({
          visitId: String(row.id),
          pregnancyId: String(row.pregnancy_id),
          targetDate: String(row.target_date),
          district,
        })
      }
      return visits
    },

    async findChatsForPregnancies(pregnancyIds) {
      const byPregnancy = new Map<string, number[]>()
      if (pregnancyIds.length === 0) return byPregnancy

      // Batched: a long id list does not fit in one request URL.
      const ids = [...pregnancyIds]
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const { data, error } = await db
          .from('patient_channels')
          .select('pregnancy_id, telegram_chat_id')
          .in('pregnancy_id', ids.slice(i, i + ID_BATCH))
        if (error) throw new Error(`channel lookup failed: ${error.message}`)
        for (const row of data ?? []) {
          const key = String(row.pregnancy_id)
          const chats = byPregnancy.get(key) ?? []
          chats.push(Number(row.telegram_chat_id))
          byPregnancy.set(key, chats)
        }
      }
      return byPregnancy
    },

    async claimReminder(visitId, chatId, kind) {
      const { error } = await db
        .from('visit_reminders')
        .insert({ visit_id: visitId, telegram_chat_id: chatId, kind })
      if (!error) return true
      if (error.code === UNIQUE_VIOLATION) return false
      // Anything else is a fault, not a duplicate. Treating it as "already
      // sent" would silently stop every reminder the moment, say, a policy
      // started refusing the insert.
      throw new Error(migrationHint(`reminder claim failed: ${error.message}`))
    },

    async releaseReminder(visitId, chatId, kind) {
      const { error } = await db
        .from('visit_reminders')
        .delete()
        .eq('visit_id', visitId)
        .eq('telegram_chat_id', chatId)
        .eq('kind', kind)
      if (error) throw new Error(`reminder release failed: ${error.message}`)
    },

    async findBroadcastTargets(tuman) {
      const district = tuman.trim()
      const targets: BroadcastTarget[] = []

      // One joined query, paged, rather than an id list per level: a whole
      // tuman's pregnancy ids do not fit in a URL.
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await db
          .from('patient_channels')
          .select(
            'telegram_chat_id, pregnancy_id, pregnancies!inner(is_active, patients!inner(district))',
          )
          .eq('pregnancies.is_active', true)
          .eq('pregnancies.patients.district', district)
          .order('telegram_chat_id')
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(`broadcast target lookup failed: ${error.message}`)

        for (const row of data ?? []) {
          // A broadcast that silently widened its own audience would be a
          // serious failure, so the filter is re-checked on every row rather
          // than trusted to the query.
          const pregnancy = one(row.pregnancies)
          const patient = one(pregnancy?.patients)
          if (pregnancy?.is_active !== true || patient?.district !== district) continue
          targets.push({
            chatId: Number(row.telegram_chat_id),
            pregnancyId: String(row.pregnancy_id),
          })
        }
        if (!data || data.length < PAGE_SIZE) break
      }
      return targets
    },

    async listDistricts() {
      const { data, error } = await db.from('patients').select('district').limit(1000)
      if (error) throw new Error(`district list failed: ${error.message}`)
      const districts = new Set((data ?? []).map((row) => String(row.district)))
      return [...districts].sort()
    },

    async plannedVisitsBetween(since, today) {
      const { data, error } = await db
        .from('visits')
        .select('id, pregnancy_id, target_date, pregnancies!inner(is_active, patients(district))')
        .eq('status', 'rejalashtirilgan')
        .gte('target_date', since)
        .lte('target_date', today)
        .eq('pregnancies.is_active', true)
        .limit(2000)
      if (error) throw new Error(`digest visit lookup failed: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).flatMap((row) => {
        const pregnancy = one(row.pregnancies)
        if (pregnancy?.is_active !== true) return []
        const district = one(pregnancy.patients)?.district
        return [
          {
            visitId: String(row.id),
            pregnancyId: String(row.pregnancy_id),
            targetDate: String(row.target_date),
            district: typeof district === 'string' ? district : null,
          },
        ]
      })
    },

    async latestEscalationCreatedAt() {
      const { data, error } = await db
        .from('escalations')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(`latest escalation lookup failed: ${error.message}`)
      return data && data.length > 0 ? String(data[0].created_at) : null
    },

    async openEscalationsAfter(after, limit) {
      let query = db
        .from('escalations')
        .select('id, created_at, source, reason, pregnancy_id, pregnancies!escalations_pregnancy_id_fkey(patients(district))')
        .eq('status', 'ochiq')
        .order('created_at', { ascending: true })
        .limit(limit)
      if (after !== null) query = query.gt('created_at', after)
      const { data, error } = await query
      if (error) throw new Error(`open escalation lookup failed: ${error.message}`)
      return (data ?? []).map((row) => {
        const patient = one(one(row.pregnancies)?.patients)
        return {
          id: String(row.id),
          createdAt: String(row.created_at),
          source: row.source === 'telegram' ? 'telegram' : 'clinic',
          reason: String(row.reason),
          pregnancyId: String(row.pregnancy_id),
          district: typeof patient?.district === 'string' ? patient.district : null,
        }
      })
    },

    async findOpenSurvey(chatId) {
      const { data, error } = await db
        .from('patient_surveys')
        .select('id, pregnancy_id, telegram_chat_id, visit_id, step, answers')
        .eq('telegram_chat_id', chatId)
        .eq('status', 'ochiq')
        .maybeSingle()
      if (error) throw new Error(migrationHint(`open survey lookup failed: ${error.message}`))
      return data ? toSurvey(data as Record<string, unknown>) : null
    },

    async createSurvey(survey) {
      const { data, error } = await db
        .from('patient_surveys')
        .insert({
          pregnancy_id: survey.pregnancyId,
          telegram_chat_id: survey.telegramChatId,
          visit_id: survey.visitId,
          step: survey.step,
          answers: {},
          expires_at: survey.expiresAt.toISOString(),
        })
        .select('id')
        .single()
      if (!error) return String(data.id)
      // patient_surveys_one_open_per_chat: she is already in one.
      if (error.code === UNIQUE_VIOLATION) return null
      throw new Error(migrationHint(`survey insert failed: ${error.message}`))
    },

    async saveSurveyProgress(id, step, answers) {
      const { error } = await db
        .from('patient_surveys')
        .update({ step, answers })
        .eq('id', id)
        .eq('status', 'ochiq')
      if (error) throw new Error(`survey update failed: ${error.message}`)
    },

    async closeSurvey(id, close) {
      const { error } = await db
        .from('patient_surveys')
        .update({
          status: close.status,
          answers: close.answers,
          triage_level: close.triageLevel,
          escalation_id: close.escalationId,
          finished_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'ochiq')
      if (error) throw new Error(`survey close failed: ${error.message}`)
    },

    async expiredSurveys(now, limit) {
      const { data, error } = await db
        .from('patient_surveys')
        .select('id, pregnancy_id, telegram_chat_id, visit_id, step, answers')
        .eq('status', 'ochiq')
        .lt('expires_at', now.toISOString())
        .order('expires_at', { ascending: true })
        .limit(limit)
      if (error) throw new Error(migrationHint(`expired survey lookup failed: ${error.message}`))
      return ((data ?? []) as Record<string, unknown>[]).map(toSurvey)
    },

    async latestSurveyFinishedAt() {
      const { data, error } = await db
        .from('patient_surveys')
        .select('finished_at')
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(migrationHint(`latest survey lookup failed: ${error.message}`))
      return data && data.length > 0 ? String(data[0].finished_at) : null
    },

    async finishedSurveysAfter(after, limit) {
      let query = db
        .from('patient_surveys')
        .select(
          'id, finished_at, status, answers, escalation_id, pregnancy_id, visits(target_date), pregnancies!patient_surveys_pregnancy_id_fkey(patients(district))',
        )
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: true })
        .limit(limit)
      if (after !== null) query = query.gt('finished_at', after)
      const { data, error } = await query
      if (error) throw new Error(migrationHint(`finished survey lookup failed: ${error.message}`))
      return ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const district = one(one(row.pregnancies)?.patients)?.district
        const visitDate = one(row.visits)?.target_date
        return {
          id: String(row.id),
          finishedAt: String(row.finished_at),
          status: row.status === 'muddati_otgan' ? 'muddati_otgan' : 'yakunlangan',
          pregnancyId: String(row.pregnancy_id),
          district: typeof district === 'string' ? district : null,
          visitDate: typeof visitDate === 'string' ? visitDate : null,
          answers: toSurvey({ ...row, step: '' }).answers,
          escalationId: typeof row.escalation_id === 'string' ? row.escalation_id : null,
        }
      })
    },

    async claimStaffVisitAlert(visitId, chatId) {
      const { error } = await db
        .from('staff_visit_alerts')
        .insert({ visit_id: visitId, telegram_chat_id: chatId })
      if (!error) return true
      if (error.code === UNIQUE_VIOLATION) return false
      throw new Error(migrationHint(`staff visit alert claim failed: ${error.message}`))
    },

    async releaseStaffVisitAlert(visitId, chatId) {
      const { error } = await db
        .from('staff_visit_alerts')
        .delete()
        .eq('visit_id', visitId)
        .eq('telegram_chat_id', chatId)
      if (error) throw new Error(`staff visit alert release failed: ${error.message}`)
    },
  }
}
