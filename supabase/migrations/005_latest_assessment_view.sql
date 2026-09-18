-- ONA (Muhim Davr) — migration 005: current zone, and the district registry
--
-- The registry answers the brief's own question — district-level monitoring —
-- by showing, per tuman, how many active pregnancies are qizil, sariq and
-- yashil right now, and who they are. Everything here is read-only views over
-- tables that already exist. No geography is stored or listed anywhere: a
-- district exists in the registry because a patient lives there.
--
-- ALL THREE VIEWS ARE security_invoker. A plain view runs with its owner's
-- rights, and the owner bypasses RLS, so a plain view over assessments would
-- hand every row to anyone allowed to select from the view. security_invoker
-- makes each view read the tables as the caller, so the RLS policies of 001-004
-- apply exactly as they do to the tables themselves. (Postgres 15+.)

-- ---------------------------------------------------------------------------
-- latest_assessment_per_pregnancy — THE ONE PLACE "current zone" IS DECIDED
-- ---------------------------------------------------------------------------
-- The latest assessment, by visit_date then created_at, with one guard:
--
--   A PATIENT'S OWN READING CAN RAISE THE ZONE, NEVER LOWER IT.
--
--   Rows with recorded_by = 'patient' come from her Telegram: a home blood
--   pressure, or a danger sign. They are real, scored observations, but they
--   carry one or two values where a midwife's visit carries twenty. If "latest
--   wins" applied to them, a woman who is qizil for severe anaemia on Monday's
--   clinic visit and texts a normal home reading on Tuesday would show as
--   yashil — the registry would have hidden a red patient because of what she
--   did not measure.
--
--   So the current zone is the most severe of: her latest midwife assessment,
--   and any patient reading since it. Only a new midwife assessment can bring
--   the zone down. With no midwife assessment yet, it is the most severe of her
--   own readings. Ties go to the most recent row.
--
-- Anything else that needs a woman's current zone reads it from here. Do not
-- write "latest assessment per pregnancy" a second time in SQL or in JS.

create view latest_assessment_per_pregnancy
with (security_invoker = true) as
with last_clinic as (
  select distinct on (pregnancy_id)
         pregnancy_id, visit_date, created_at
    from assessments
   where recorded_by = 'midwife'
   order by pregnancy_id, visit_date desc, created_at desc
),
candidates as (
  select a.*
    from assessments a
    left join last_clinic c on c.pregnancy_id = a.pregnancy_id
   where c.pregnancy_id is null
      or (a.recorded_by = 'midwife'
          and a.visit_date = c.visit_date
          and a.created_at = c.created_at)
      or (a.recorded_by = 'patient'
          and (a.visit_date, a.created_at) > (c.visit_date, c.created_at))
)
select distinct on (pregnancy_id)
       pregnancy_id,
       id as assessment_id,
       risk_zone,
       risk_score,
       visit_date,
       created_at,
       fired_factors,
       gestational_age_weeks,
       recorded_by
  from candidates
 order by pregnancy_id,
          case risk_zone when 'qizil' then 3 when 'sariq' then 2 else 1 end desc,
          visit_date desc,
          created_at desc;

-- ---------------------------------------------------------------------------
-- registry_pregnancies — one row per ACTIVE pregnancy, for the district lists
-- ---------------------------------------------------------------------------
-- risk_zone is null when she has never been assessed. That is shown as its
-- own group, never folded into yashil: missing data is unknown risk.
--
-- The remaining columns are inputs, not verdicts. Gestational week, the due
-- date fallback and whether she is overdue depend on today's date in Tashkent,
-- which the database does not know (current_date is UTC); src/lib/registry.ts
-- works them out from these columns.
--
--   last_clinic_visit_date  — the last time a midwife saw her. A home reading
--                             is not a visit and does not reset this.
--   latest_ga_weeks / _on   — the most recent gestational age written down,
--                             and the visit it was written at; the fallback
--                             when lmp_date is not recorded.
--   earliest_planned_visit  — her earliest planned contact (004). One dated
--                             before today means she has missed it.

create view registry_pregnancies
with (security_invoker = true) as
select p.id                     as pregnancy_id,
       pt.id                    as patient_id,
       pt.full_name,
       btrim(pt.district)       as district,
       pt.village,
       p.lmp_date,
       p.edd_date,
       l.risk_zone,
       l.risk_score,
       l.visit_date             as zone_assessment_date,
       l.recorded_by            as zone_recorded_by,
       clinic.last_clinic_visit_date,
       ga.gestational_age_weeks as latest_ga_weeks,
       ga.visit_date            as latest_ga_on,
       planned.earliest_planned_visit
  from pregnancies p
  join patients pt on pt.id = p.patient_id
  left join latest_assessment_per_pregnancy l on l.pregnancy_id = p.id
  left join lateral (
    select max(a.visit_date) as last_clinic_visit_date
      from assessments a
     where a.pregnancy_id = p.id
       and a.recorded_by = 'midwife'
  ) clinic on true
  left join lateral (
    select a.gestational_age_weeks, a.visit_date
      from assessments a
     where a.pregnancy_id = p.id
       and a.gestational_age_weeks is not null
     order by a.visit_date desc, a.created_at desc
     limit 1
  ) ga on true
  left join lateral (
    select min(v.target_date) as earliest_planned_visit
      from visits v
     where v.pregnancy_id = p.id
       and v.status = 'rejalashtirilgan'
  ) planned on true
 where p.is_active;

-- ---------------------------------------------------------------------------
-- registry_district_counts — the district overview
-- ---------------------------------------------------------------------------
-- One row per district with at least one active pregnancy. Counted in the
-- database rather than by fetching every row, so the overview stays one small
-- query however many districts and women it eventually covers.

create view registry_district_counts
with (security_invoker = true) as
select district,
       count(*) filter (where risk_zone = 'qizil')  as qizil,
       count(*) filter (where risk_zone = 'sariq')  as sariq,
       count(*) filter (where risk_zone = 'yashil') as yashil,
       count(*) filter (where risk_zone is null)    as unassessed,
       count(*)                                     as total
  from registry_pregnancies
 group by district;

-- Staff only, like the tables underneath. Supabase grants new views to anon by
-- default; RLS would return anon nothing anyway, but it should not get that far.
revoke all on latest_assessment_per_pregnancy, registry_pregnancies, registry_district_counts
  from public, anon;
grant select on latest_assessment_per_pregnancy, registry_pregnancies, registry_district_counts
  to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- The registry re-reads itself when an assessment is inserted, so a new red
-- result shows up without anyone pressing refresh. Supabase Realtime only
-- broadcasts tables in the supabase_realtime publication, and new tables are
-- not in it. Guarded so the migration also applies where the publication does
-- not exist, and applies twice without error.
--
-- Realtime still enforces RLS: a subscriber only receives rows it could select.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'assessments'
     )
  then
    alter publication supabase_realtime add table assessments;
  end if;
end
$$;

-- Tell PostgREST about the new views now rather than on its next restart.
notify pgrst, 'reload schema';
