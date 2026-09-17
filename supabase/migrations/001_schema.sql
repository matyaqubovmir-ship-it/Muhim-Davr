-- ONA — perinatal risk registry, Khorezm region, Uzbekistan
-- Migration 001: core schema
--
-- Design notes:
--   * assessments is APPEND-ONLY. A new visit is always a new row. There is no
--     UPDATE path for clinical values; the triggers below enforce this at the
--     database level so a buggy client cannot silently rewrite history.
--   * Risk score/zone are stored as written at the time of the visit. They are
--     NOT recomputed on read: if the scoring rules change later, historical rows
--     must still show what the midwife actually saw.
--   * extracted_json holds the raw structured output of the (later) AI
--     extraction step, kept verbatim for audit. corrected_by_human records
--     whether a person edited those values before the row was saved.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type risk_zone as enum ('qizil', 'sariq', 'yashil');   -- red / yellow / green

create type escalation_status as enum (
  'ochiq',        -- open, nobody has picked it up
  'qabul',        -- acknowledged by a receiving clinician
  'yopiq',        -- closed / resolved
  'bekor'         -- cancelled (created in error)
);

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------

create table patients (
  id                uuid primary key default gen_random_uuid(),

  full_name         text not null,
  birth_date        date not null,

  -- National ID (JSHSHIR) is 14 digits. Nullable: rural intake often happens
  -- before documents are on hand, and a missing ID must not block care.
  national_id       text unique,

  phone             text,

  -- Khorezm administrative geography, kept as plain text for hackathon speed.
  district          text not null,          -- tuman, e.g. 'Urganch'
  village           text,                   -- mahalla / qishloq
  address_note      text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint patients_national_id_format
    check (national_id is null or national_id ~ '^[0-9]{14}$'),
  constraint patients_birth_date_sane
    check (birth_date > date '1900-01-01' and birth_date <= current_date)
);

create index patients_district_idx on patients (district);
create index patients_full_name_idx on patients (lower(full_name));

-- ---------------------------------------------------------------------------
-- pregnancies
-- ---------------------------------------------------------------------------
-- One row per pregnancy episode. A patient may have several over time, but only
-- one may be active at a time — enforced by the partial unique index below.

create table pregnancies (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references patients (id) on delete cascade,

  lmp_date          date,                   -- last menstrual period
  edd_date          date,                   -- estimated delivery date
  gravida           smallint,               -- total pregnancies incl. this one
  para              smallint,               -- prior births >= 22 weeks

  is_active         boolean not null default true,
  outcome           text,                   -- free text until outcomes are modelled
  outcome_date      date,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint pregnancies_gravida_sane check (gravida is null or gravida between 1 and 20),
  constraint pregnancies_para_sane    check (para is null or para between 0 and 20),
  constraint pregnancies_para_lt_gravida
    check (gravida is null or para is null or para < gravida),
  constraint pregnancies_closed_has_outcome
    check (is_active or outcome is not null)
);

create index pregnancies_patient_idx on pregnancies (patient_id);

-- A patient can only have one open pregnancy at a time.
create unique index pregnancies_one_active_per_patient
  on pregnancies (patient_id)
  where is_active;

-- ---------------------------------------------------------------------------
-- assessments  (APPEND-ONLY)
-- ---------------------------------------------------------------------------
--
-- THE SNAPSHOT RULE — read this before adding a scoring factor.
--
--   Every input the risk score is computed from is snapshotted onto THIS row.
--   Not referenced, not joined, not derived at read time. Copied.
--
--   A row here is a permanent record of one visit: the inputs, the score they
--   produced, and the version of the rules that produced it. It must stay
--   reproducible forever, from itself alone, with no join to anything mutable.
--   That is why:
--     * age_at_assessment is stored as a number, not derived from
--       patients.birth_date — age changes, the score must not.
--     * gravida and para are duplicated from pregnancies even though they live
--       there too — that row can be edited, this one cannot.
--
-- THE NULL CONVENTION — one rule for every clinical column on this table.
--
--   null  = not recorded. Nobody looked, or nobody wrote it down.
--   false = recorded as absent. Somebody checked and found nothing.
--   true  = recorded as present.
--
--   These are three different facts and the table keeps them apart. No clinical
--   column carries `not null default false`, because that default silently
--   converts the first case into the second: a midwife who skipped the dipstick
--   would be stored as "no protein", and a finding that was never looked for
--   would read as a finding that was ruled out. On a preeclampsia input that is
--   the difference between an escalation and a green screen.
--
--   src/lib/risk.ts matches this: a factor fires only on an explicit true, and
--   never on null. Absent critical inputs come back in missingCriticalFields so
--   the UI can show unknown risk instead of a reassuring colour.
--
--   corrected_by_human is the one boolean that is legitimately `not null
--   default false` — it records what the system did, not what a clinician
--   observed, and "no human edited this" is a fact we always know.
--
--   IF YOU ADD A FACTOR TO src/lib/risk.ts, ADD ITS COLUMN HERE.
--   Column names match the AssessmentInput field names in risk.ts exactly, with
--   one deliberate exception: `age` is stored as `age_at_assessment`.
--   src/lib/schema-sync.test.ts parses this file and fails the build if a
--   scoring input has no column. Do not silence that test; add the column.
--
create table assessments (
  id                    uuid primary key default gen_random_uuid(),
  pregnancy_id          uuid not null references pregnancies (id) on delete restrict,

  visit_date            date not null default current_date,
  gestational_age_weeks smallint,

  -- vitals / labs -----------------------------------------------------------
  bp_systolic           smallint,
  bp_diastolic          smallint,
  hemoglobin            smallint,           -- g/L, not g/dL
  proteinuria           boolean,
  antepartum_bleeding   boolean,
  temperature_c         numeric(4,1),
  fetal_movements_ok    boolean,
  edema                 boolean,
  headache_or_visual    boolean,

  -- history / context, all scoring inputs -----------------------------------
  multiple_gestation    boolean,
  prior_caesarean       boolean,
  prior_stillbirth_or_neonatal_death boolean,
  diabetes              boolean,
  chronic_hypertension  boolean,
  prior_preeclampsia    boolean,
  kidney_disease        boolean,
  family_history_preeclampsia boolean,

  -- Age as a number, deliberately not a reference to patients.birth_date.
  -- See the snapshot rule above.
  age_at_assessment     integer,

  -- Snapshotted from pregnancies so this row stands alone.
  gravida               integer,
  para                  integer,

  birth_interval_months integer,
  bmi                   numeric,
  travel_minutes_to_facility integer,
  missed_visits         integer,

  -- scoring result, frozen at write time ------------------------------------
  risk_score            smallint not null,
  risk_zone             risk_zone not null,
  fired_factors         jsonb not null default '[]'::jsonb,
  -- Which version of the point table produced the values above. A frozen score
  -- is only interpretable if we know the rules behind it. No default on
  -- purpose: the client must state it, so a score can never be stored
  -- anonymously. Mirrors RULES_VERSION in src/lib/risk.ts.
  rules_version         text not null,

  -- provenance --------------------------------------------------------------
  -- Raw structured output of the extraction step, stored verbatim for audit.
  extracted_json        jsonb,
  -- True when a human edited the extracted values before this row was saved.
  corrected_by_human    boolean not null default false,

  note                  text,
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default now(),

  constraint assessments_bp_sane
    check ((bp_systolic is null or bp_systolic between 50 and 300)
       and (bp_diastolic is null or bp_diastolic between 20 and 200)),
  -- Half a blood pressure reading is a data-entry error, not a measurement.
  constraint assessments_bp_paired
    check ((bp_systolic is null) = (bp_diastolic is null)),
  constraint assessments_hemoglobin_sane
    check (hemoglobin is null or hemoglobin between 10 and 250),
  constraint assessments_ga_sane
    check (gestational_age_weeks is null or gestational_age_weeks between 1 and 45),
  -- Ranges below are deliberately generous: they catch transposed digits and
  -- unit mistakes, not unusual patients. None of them encode a scoring
  -- threshold — thresholds live only in src/lib/risk.ts.
  constraint assessments_age_sane
    check (age_at_assessment is null or age_at_assessment between 10 and 60),
  constraint assessments_gravida_sane
    check (gravida is null or gravida between 1 and 20),
  constraint assessments_para_sane
    check (para is null or para between 0 and 20),
  constraint assessments_bmi_sane
    check (bmi is null or bmi between 10 and 100),
  constraint assessments_birth_interval_sane
    check (birth_interval_months is null or birth_interval_months between 0 and 600),
  constraint assessments_travel_sane
    check (travel_minutes_to_facility is null or travel_minutes_to_facility between 0 and 1440),
  constraint assessments_missed_visits_sane
    check (missed_visits is null or missed_visits between 0 and 50),
  constraint assessments_score_sane
    check (risk_score >= 0),
  constraint assessments_rules_version_not_blank
    check (length(btrim(rules_version)) > 0),
  constraint assessments_fired_factors_is_array
    check (jsonb_typeof(fired_factors) = 'array'),
  constraint assessments_visit_not_future
    check (visit_date <= current_date)
);

create index assessments_pregnancy_idx on assessments (pregnancy_id, visit_date desc);
create index assessments_red_idx on assessments (risk_zone) where risk_zone = 'qizil';

-- Append-only enforcement. UPDATE and DELETE are rejected outright: a
-- correction is recorded as a new assessment row, never as a rewrite.
create or replace function assessments_forbid_mutation()
returns trigger
language plpgsql
as $fn$
begin
  raise exception
    'assessments is append-only: % is not permitted. Record a new assessment instead.',
    tg_op
    using errcode = 'restrict_violation';
end;
$fn$;

create trigger assessments_no_update
  before update on assessments
  for each row execute function assessments_forbid_mutation();

create trigger assessments_no_delete
  before delete on assessments
  for each row execute function assessments_forbid_mutation();

-- ---------------------------------------------------------------------------
-- escalations
-- ---------------------------------------------------------------------------
-- Raised when an assessment lands in the red zone and a patient needs to be
-- moved up a level of care. Escalations ARE mutable — status moves forward as
-- the case is handled — but they always point back at the immutable assessment
-- that triggered them.

create table escalations (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references assessments (id) on delete restrict,
  pregnancy_id      uuid not null references pregnancies (id) on delete restrict,

  status            escalation_status not null default 'ochiq',
  reason            text not null,          -- why it was raised, human readable
  fired_factors     jsonb not null default '[]'::jsonb,

  referred_to       text,                   -- receiving facility
  acknowledged_at   timestamptz,
  acknowledged_by   uuid references auth.users (id),
  closed_at         timestamptz,
  closed_by         uuid references auth.users (id),
  resolution_note   text,

  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Timestamps must agree with the status they claim to describe.
  constraint escalations_status_timestamps check (
    case status
      when 'ochiq' then acknowledged_at is null     and closed_at is null
      when 'qabul' then acknowledged_at is not null and closed_at is null
      when 'yopiq' then acknowledged_at is not null and closed_at is not null
      when 'bekor' then closed_at is not null
    end
  ),
  constraint escalations_fired_factors_is_array
    check (jsonb_typeof(fired_factors) = 'array')
);

-- One live escalation per assessment — re-raising the same assessment is a
-- client bug, not a second emergency.
create unique index escalations_one_live_per_assessment
  on escalations (assessment_id)
  where status in ('ochiq', 'qabul');

create index escalations_live_idx on escalations (status, created_at desc)
  where status in ('ochiq', 'qabul');
create index escalations_pregnancy_idx on escalations (pregnancy_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger patients_touch    before update on patients
  for each row execute function touch_updated_at();
create trigger pregnancies_touch before update on pregnancies
  for each row execute function touch_updated_at();
create trigger escalations_touch before update on escalations
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Hackathon posture: any authenticated user is clinical staff and may read and
-- write. Anonymous access is denied everywhere. Role separation (midwife vs.
-- district doctor) is deliberately deferred — recorded here so it is not
-- mistaken for an oversight.

alter table patients    enable row level security;
alter table pregnancies enable row level security;
alter table assessments enable row level security;
alter table escalations enable row level security;

create policy patients_staff_read   on patients for select to authenticated using (true);
create policy patients_staff_insert on patients for insert to authenticated with check (true);
create policy patients_staff_update on patients for update to authenticated using (true) with check (true);

create policy pregnancies_staff_read   on pregnancies for select to authenticated using (true);
create policy pregnancies_staff_insert on pregnancies for insert to authenticated with check (true);
create policy pregnancies_staff_update on pregnancies for update to authenticated using (true) with check (true);

-- Note: no UPDATE or DELETE policy on assessments. The triggers above already
-- reject those operations; omitting the policies makes the intent explicit.
create policy assessments_staff_read   on assessments for select to authenticated using (true);
create policy assessments_staff_insert on assessments for insert to authenticated with check (true);

create policy escalations_staff_read   on escalations for select to authenticated using (true);
create policy escalations_staff_insert on escalations for insert to authenticated with check (true);
create policy escalations_staff_update on escalations for update to authenticated using (true) with check (true);
