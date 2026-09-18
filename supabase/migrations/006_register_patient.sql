-- ONA (Muhim Davr) — migration 006: registering a patient, and live escalations
--
-- Until now there was no way to create a patient from the app: the midwife
-- typed the id of a pregnancy made somewhere else. This adds the database side
-- of the quick-create form (/patients/new), and puts escalations on Realtime so
-- a specialist's screen hears about a new one the moment it is raised.

-- ---------------------------------------------------------------------------
-- where an LMP came from
-- ---------------------------------------------------------------------------
-- The form takes either the last menstrual period, as she reports it, or her
-- gestational age today, from which the LMP is estimated. Both are stored in
-- pregnancies.lmp_date, because both anchor the schedule. They are not the same
-- evidence, and a screen that labels a date "recorded" must be able to tell
-- which it is. Hence:
--
--   lmp_estimated = false   she (or her record) gave the date
--   lmp_estimated = true    worked back from a gestational age in weeks
--   lmp_estimated = null    not known: every row written before this migration
--
-- A flag without a date means nothing, so the check refuses it.

alter table pregnancies
  add column lmp_estimated boolean;

alter table pregnancies
  add constraint pregnancies_lmp_estimated_needs_date
  check (lmp_date is not null or lmp_estimated is null);

-- ---------------------------------------------------------------------------
-- register_patient
-- ---------------------------------------------------------------------------
-- The patient and her first pregnancy, in one transaction. Two inserts sent
-- separately from the browser could leave a patient with no pregnancy — a woman
-- the search box finds but nobody can record a visit for — and patients has no
-- DELETE policy to clean one up with.
--
-- Returns the new pregnancy's id, which is what every other screen keys on.
--
-- SECURITY INVOKER: the caller's own rights, so the insert policies of 001
-- apply exactly as they would to the two inserts sent directly.

create or replace function register_patient(
  p_full_name     text,
  p_birth_date    date,
  p_district      text,
  p_village       text,
  p_phone         text,
  p_lmp_date      date,
  p_lmp_estimated boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  new_patient_id   uuid;
  new_pregnancy_id uuid;
begin
  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'full name is required' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_district, '')) = '' then
    raise exception 'district is required' using errcode = 'check_violation';
  end if;

  insert into patients (full_name, birth_date, district, village, phone)
  values (
    btrim(p_full_name),
    p_birth_date,
    btrim(p_district),
    nullif(btrim(coalesce(p_village, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), '')
  )
  returning id into new_patient_id;

  insert into pregnancies (patient_id, lmp_date, lmp_estimated)
  values (
    new_patient_id,
    p_lmp_date,
    case when p_lmp_date is null then null else coalesce(p_lmp_estimated, false) end
  )
  returning id into new_pregnancy_id;

  return new_pregnancy_id;
end;
$fn$;

-- Staff only. Supabase grants new functions to anon by default.
revoke execute on function register_patient(text, date, text, text, text, date, boolean) from public, anon;
grant execute on function register_patient(text, date, text, text, text, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime for escalations
-- ---------------------------------------------------------------------------
-- A specialist's screen shows a toast and a badge when an escalation is raised
-- or changes, and the queue re-reads itself. Same guard as 005: apply only
-- where the publication exists, and only once. RLS still decides who hears.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'escalations'
     )
  then
    alter publication supabase_realtime add table escalations;
  end if;
end
$$;

notify pgrst, 'reload schema';
