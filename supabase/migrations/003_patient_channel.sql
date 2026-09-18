-- ONA — migration 003: the patient's Telegram channel
--
-- The midwife has an app. The patient has neither an app nor a password: she
-- has Telegram, and her case is linked to it by a short code the midwife reads
-- out at registration. Everything below exists to support that one channel.
--
-- WHAT THIS CHANNEL IS ALLOWED TO CARRY is decided in bot/, not here, but the
-- boundary is worth stating next to the tables: the bot relays what she reports
-- and what the schedule already says. It does not diagnose, it does not
-- reassure, and it never answers a question about medicine — protocol reminders
-- stay on the doctor's screen where a clinician confirms them.

-- ---------------------------------------------------------------------------
-- who recorded an assessment
-- ---------------------------------------------------------------------------
-- A home blood pressure reading she sends over Telegram is a real observation
-- and is stored as a real assessment, scored by the same rules as any other.
-- It is not, however, the same kind of evidence as a reading a midwife took on
-- a calibrated cuff, and a row that cannot say which one it is loses that
-- distinction permanently. Hence a column, defaulted to 'midwife' so every row
-- written before this migration keeps the meaning it was written with.

create type recorded_by_kind as enum ('midwife', 'patient');

alter table assessments
  add column recorded_by recorded_by_kind not null default 'midwife';

create index assessments_patient_recorded_idx
  on assessments (pregnancy_id, created_at desc)
  where recorded_by = 'patient';

-- ---------------------------------------------------------------------------
-- where an escalation came from
-- ---------------------------------------------------------------------------
-- A doctor working the queue needs to know whether the woman in front of the
-- row was assessed by a midwife or typed a danger sign into her phone. The two
-- warrant the same urgency and a different first question.

create type escalation_source as enum ('clinic', 'telegram');

alter table escalations
  add column source escalation_source not null default 'clinic';

create index escalations_source_idx on escalations (source, created_at desc)
  where status in ('ochiq', 'qabul');

-- ---------------------------------------------------------------------------
-- the link code
-- ---------------------------------------------------------------------------
-- The short code the midwife reads out at registration, and the only thing the
-- patient ever has to type. A GENERATED column, not a stored secret:
--
--   * generated, so it exists for every pregnancy already in the table with no
--     backfill and no registration step to remember. There is no patient
--     registration screen in this app — the midwife types a pregnancy id that
--     was created elsewhere — so a code that has to be issued would simply be
--     missing for most rows.
--   * stored and indexed, so /start <code> is one equality lookup. A code
--     derived only in application code would force the bot to scan every
--     pregnancy and compute candidates, which is the kind of thing that works
--     in a demo and falls over in a district.
--   * derived from the id, so it cannot drift from the row it points at.
--
-- Hex, so it reads aloud cleanly: the alphabet is 0-9 and A-F, which contains
-- no letter O and no letter I, so a heard "oh" is unambiguously zero and a
-- heard "eye" is unambiguously one.
--
-- src/lib/link-code.ts computes the same string for the midwife's screen, and
-- src/lib/link-code.test.ts pins the two definitions together.
--
-- THE TRADE: six hex characters is 16.7 million codes and the code cannot be
-- rotated, because it is a function of the id. Revoking a link means deleting
-- the patient_channels row, not issuing a new code. For a pilot behind a
-- rate-limited bot that is acceptable. At national scale it is not, and the fix
-- is a real invitation table with an expiry and a rotation path.
--
-- NOT UNIQUE, and the bot must not assume it is: 16.7 million codes collide by
-- birthday long before they run out. handleStart in bot/linking.ts refuses to
-- link when a code matches more than one pregnancy rather than guessing between
-- two women, and allows a chat five wrong codes an hour.

alter table pregnancies
  add column link_code text
  generated always as (upper(substr(replace(id::text, '-', ''), 1, 6))) stored;

create index pregnancies_link_code_idx on pregnancies (link_code);

-- ---------------------------------------------------------------------------
-- patient_channels
-- ---------------------------------------------------------------------------
-- One row per linked Telegram chat.

create table patient_channels (
  id                uuid primary key default gen_random_uuid(),
  pregnancy_id      uuid not null references pregnancies (id) on delete cascade,

  -- bigint, not integer: Telegram chat ids have already outgrown 32 bits.
  telegram_chat_id  bigint not null,

  linked_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A chat belongs to exactly one pregnancy. Sending /start with a second code
  -- from the same phone re-points that chat; it does not leave it subscribed to
  -- two women at once, which would cross one woman's reminders into another's
  -- conversation.
  constraint patient_channels_one_pregnancy_per_chat unique (telegram_chat_id)
);

-- Deliberately NOT unique: a pregnancy may reach more than one chat, because in
-- practice the phone that receives the reminder is sometimes the husband's or
-- the mother-in-law's. Each chat is linked separately and each is reminded.
create index patient_channels_pregnancy_idx on patient_channels (pregnancy_id);

create trigger patient_channels_touch before update on patient_channels
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- patient_reports
-- ---------------------------------------------------------------------------
-- Every message she sends, with what was read out of it and what the triage
-- rule made of it.
--
-- THIS TABLE IS WHAT MAKES THE BOT'S REPLY TRUE. The bot tells her that her
-- report was passed to her midwife. Without a row here that sentence would be a
-- claim with nothing behind it: most messages raise no escalation and create no
-- assessment, so this is the only place they would exist.
--
-- It is also the audit trail for the extraction step on the patient side —
-- extracted_json is the model's response verbatim, the same convention as
-- assessments.extracted_json.
--
-- Not append-only, unlike assessments: nothing here is a clinical observation
-- recorded by a clinician. The assessment it points at, when there is one, is
-- the immutable record.

create type patient_report_triage as enum ('immediate', 'prompt', 'none');

create table patient_reports (
  id                uuid primary key default gen_random_uuid(),
  pregnancy_id      uuid not null references pregnancies (id) on delete cascade,
  telegram_chat_id  bigint not null,

  -- Her own words, kept verbatim. This is the thing a midwife will actually
  -- want to read; everything else on the row is derived from it.
  message_text      text not null,

  -- The model's response, verbatim, for audit. Null when extraction failed —
  -- and the row is still written, because a message that could not be processed
  -- is exactly the kind a midwife needs to see.
  extracted_json    jsonb,

  triage_level      patient_report_triage not null,
  -- Danger sign codes from src/lib/danger-signs.ts, as matched by the fixed
  -- triage rule. Never a model's opinion about severity.
  matched_signs     jsonb not null default '[]'::jsonb,

  -- Set when the report also produced a scored assessment or an escalation.
  assessment_id     uuid references assessments (id) on delete restrict,
  escalation_id     uuid references escalations (id) on delete restrict,

  created_at        timestamptz not null default now(),

  constraint patient_reports_matched_signs_is_array
    check (jsonb_typeof(matched_signs) = 'array'),
  constraint patient_reports_text_not_blank
    check (length(btrim(message_text)) > 0)
);

create index patient_reports_pregnancy_idx
  on patient_reports (pregnancy_id, created_at desc);
create index patient_reports_triage_idx
  on patient_reports (triage_level, created_at desc)
  where triage_level in ('immediate', 'prompt');

-- ---------------------------------------------------------------------------
-- visit_reminders
-- ---------------------------------------------------------------------------
-- The send log, and the reason a woman is not woken up by the same reminder
-- every time the bot polls.
--
-- The unique constraint is the whole mechanism: the sender inserts first and
-- sends only if the insert succeeded, so a duplicate is refused by the database
-- rather than prevented by the scheduler remembering correctly. A crash between
-- insert and send costs one missed reminder, which is the safer failure —
-- losing one message beats sending eleven.

create type visit_reminder_kind as enum (
  'ikki_kun',   -- two days before
  'ertalab'     -- the morning of
);

create table visit_reminders (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits (id) on delete cascade,
  telegram_chat_id  bigint not null,
  kind              visit_reminder_kind not null,
  sent_at           timestamptz not null default now(),

  constraint visit_reminders_once unique (visit_id, telegram_chat_id, kind)
);

create index visit_reminders_visit_idx on visit_reminders (visit_id);

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Same posture as 001 and 002: authenticated only, anonymous denied. The bot
-- reaches the database as an authenticated user like any other client — see
-- bot/supabase.ts. It is not given a service role by default and it does not
-- need one; nothing here is readable without a session.

alter table patient_channels enable row level security;
alter table patient_reports  enable row level security;
alter table visit_reminders  enable row level security;

create policy patient_channels_staff_read   on patient_channels for select to authenticated using (true);
create policy patient_channels_staff_insert on patient_channels for insert to authenticated with check (true);
create policy patient_channels_staff_update on patient_channels for update to authenticated using (true) with check (true);
create policy patient_channels_staff_delete on patient_channels for delete to authenticated using (true);

create policy patient_reports_staff_read   on patient_reports for select to authenticated using (true);
create policy patient_reports_staff_insert on patient_reports for insert to authenticated with check (true);

create policy visit_reminders_staff_read   on visit_reminders for select to authenticated using (true);
create policy visit_reminders_staff_insert on visit_reminders for insert to authenticated with check (true);
