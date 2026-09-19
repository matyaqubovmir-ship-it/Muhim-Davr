-- ONA (Muhim Davr) — migration 008: a planned contact nobody recorded, followed up
--
-- The morning after a planned contact whose day passed with no visit recorded,
-- the bot tells the specialist (their Telegram chat, bot/staff-alerts.ts) and
-- the woman (her Telegram, bot/missed-visits.ts), and asks her a fixed list of
-- questions (bot/survey.ts). Her answers go through the same triage as anything
-- else she writes: the WHO danger-sign list and the point table decide, never a
-- model.
--
-- WHAT THIS DOES NOT DO: mark the visit missed. 004 says why — the calendar can
-- say a date passed, but not whether she came; a midwife may have seen her and
-- not yet typed it in. So the visit stays 'rejalashtirilgan', and every message
-- says the visit "was not recorded", never that she skipped it.
--
-- Safe to run twice: every statement is guarded or idempotent.

-- ---------------------------------------------------------------------------
-- A third reminder kind: the morning after, when nothing was recorded
-- ---------------------------------------------------------------------------
-- Claimed in visit_reminders exactly like the other two, so a woman gets this
-- notice once per contact per chat however often the sweep runs.
alter type visit_reminder_kind add value if not exists 'kechikkan';

-- ---------------------------------------------------------------------------
-- patient_surveys — the questions she is asked, and where she is in them
-- ---------------------------------------------------------------------------
-- The conversation state lives here, not in the bot's memory, so a restart
-- in the middle of her answers picks up at the same question.
--
-- answers holds only what she answered, in the three-state convention of 001:
-- a key present with true or false is an answer, a key absent is a question
-- never answered. bp is {"systolic": n, "diastolic": n}, or null when she
-- pressed "cannot measure". Nothing unanswered is ever stored as "no".
--
-- When it closes, her answers are written as a patient_reports row (and an
-- assessment and an escalation when the rules say so) by the same code as a
-- free-text report. triage_level and escalation_id copy the outcome here, so
-- the specialist's summary can tell which surveys already raised an alert.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_survey_status') then
    create type patient_survey_status as enum (
      'ochiq',          -- open: waiting for her next answer
      'yakunlangan',    -- finished: answered to the end, or stopped at a danger sign
      'muddati_otgan'   -- expired: 24 hours without finishing; what she did answer is recorded
    );
  end if;
end
$$;

create table if not exists patient_surveys (
  id                uuid primary key default gen_random_uuid(),
  pregnancy_id      uuid not null references pregnancies (id) on delete cascade,
  telegram_chat_id  bigint not null,
  -- The contact that was not recorded. Null once that planned row is replaced
  -- by a later schedule write (004 deletes stale planned contacts).
  visit_id          uuid references visits (id) on delete set null,

  status            patient_survey_status not null default 'ochiq',
  -- The question she is being asked now; bot/survey.ts owns the list.
  step              text not null,
  answers           jsonb not null default '{}'::jsonb,

  triage_level      patient_report_triage,
  escalation_id     uuid references escalations (id) on delete restrict,

  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  finished_at       timestamptz,

  constraint patient_surveys_answers_is_object
    check (jsonb_typeof(answers) = 'object'),
  constraint patient_surveys_finished_iff_closed
    check ((status = 'ochiq') = (finished_at is null))
);

-- One conversation at a time per chat: two open surveys would each take her
-- next "Ha" as its own answer.
create unique index if not exists patient_surveys_one_open_per_chat
  on patient_surveys (telegram_chat_id) where status = 'ochiq';
create index if not exists patient_surveys_pregnancy_idx
  on patient_surveys (pregnancy_id, started_at desc);
create index if not exists patient_surveys_finished_idx
  on patient_surveys (finished_at) where finished_at is not null;

-- ---------------------------------------------------------------------------
-- staff_visit_alerts — the specialist is told about each contact once
-- ---------------------------------------------------------------------------
-- Same mechanism as visit_reminders: insert first, send only if the insert
-- succeeded, give the claim back if the send failed.
create table if not exists staff_visit_alerts (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits (id) on delete cascade,
  telegram_chat_id  bigint not null,
  sent_at           timestamptz not null default now(),

  constraint staff_visit_alerts_once unique (visit_id, telegram_chat_id)
);

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Same posture as every table: any authenticated session is staff (the bot
-- signs in as one — see bot/supabase.ts), anonymous is denied. A survey is
-- updated as she answers and never deleted: it is part of her record.

alter table patient_surveys    enable row level security;
alter table staff_visit_alerts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'patient_surveys' and policyname = 'patient_surveys_staff_read') then
    create policy patient_surveys_staff_read on patient_surveys for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_surveys' and policyname = 'patient_surveys_staff_insert') then
    create policy patient_surveys_staff_insert on patient_surveys for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_surveys' and policyname = 'patient_surveys_staff_update') then
    create policy patient_surveys_staff_update on patient_surveys for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staff_visit_alerts' and policyname = 'staff_visit_alerts_staff_read') then
    create policy staff_visit_alerts_staff_read on staff_visit_alerts for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staff_visit_alerts' and policyname = 'staff_visit_alerts_staff_insert') then
    create policy staff_visit_alerts_staff_insert on staff_visit_alerts for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staff_visit_alerts' and policyname = 'staff_visit_alerts_staff_delete') then
    create policy staff_visit_alerts_staff_delete on staff_visit_alerts for delete to authenticated using (true);
  end if;
end
$$;

revoke all on patient_surveys from anon;
revoke all on staff_visit_alerts from anon;

notify pgrst, 'reload schema';
