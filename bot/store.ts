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

export type ReminderKind = 'ikki_kun' | 'ertalab'

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

export interface BotStore {
  findChannel(chatId: number): Promise<LinkedChannel | null>
  /** Active pregnancies with this link code. At most two: two means ambiguous. */
  findActivePregnancyIdsByCode(code: string): Promise<string[]>
  /** Points this chat at this pregnancy, replacing any earlier link. */
  linkChat(pregnancyId: string, chatId: number): Promise<void>

  insertAssessment(row: Record<string, unknown>): Promise<string>
  insertEscalation(row: EscalationRow): Promise<string>
  insertReport(row: PatientReportRow): Promise<void>

  /** Planned visits on these dates, for active pregnancies only. */
  findPlannedVisits(dates: readonly string[]): Promise<PlannedVisit[]>
  findChatsForPregnancies(pregnancyIds: readonly string[]): Promise<Map<string, number[]>>
  /**
   * Records that this reminder is being sent. False if it was already recorded,
   * which is how a reminder is never sent twice.
   */
  claimReminder(visitId: string, chatId: number, kind: ReminderKind): Promise<boolean>

  /** Linked chats of active pregnancies whose patient lives in this tuman. */
  findBroadcastTargets(tuman: string): Promise<BroadcastTarget[]>
  /** Every tuman with at least one patient, for correcting a misspelt one. */
  listDistricts(): Promise<string[]>
}

/** Postgres unique_violation: the row is already there. */
const UNIQUE_VIOLATION = '23505'

/** Supabase caps a response at 1000 rows by default; pages stay under it. */
const PAGE_SIZE = 500

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
        .select('pregnancy_id')
        .eq('telegram_chat_id', chatId)
        .maybeSingle()
      if (error) throw new Error(`patient_channels lookup failed: ${error.message}`)
      if (!data) return null
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

    async insertReport(row) {
      const { error } = await db.from('patient_reports').insert(row)
      if (error) throw new Error(`patient_reports insert failed: ${error.message}`)
    },

    async findPlannedVisits(dates) {
      if (dates.length === 0) return []
      // !inner so the is_active filter removes the visit, not just the embed. A
      // reminder for a pregnancy that has ended — in a birth or in a loss — is
      // the one message this channel must never send.
      const { data, error } = await db
        .from('visits')
        .select('id, pregnancy_id, target_date, pregnancies!inner(is_active, patients(district))')
        .eq('status', 'rejalashtirilgan')
        .in('target_date', [...dates])
        .eq('pregnancies.is_active', true)
      if (error) throw new Error(`due visit lookup failed: ${error.message}`)

      const visits: PlannedVisit[] = []
      for (const row of data ?? []) {
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

      const { data, error } = await db
        .from('patient_channels')
        .select('pregnancy_id, telegram_chat_id')
        .in('pregnancy_id', [...pregnancyIds])
      if (error) throw new Error(`channel lookup failed: ${error.message}`)

      for (const row of data ?? []) {
        const key = String(row.pregnancy_id)
        const chats = byPregnancy.get(key) ?? []
        chats.push(Number(row.telegram_chat_id))
        byPregnancy.set(key, chats)
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
      throw new Error(`reminder claim failed: ${error.message}`)
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
  }
}
