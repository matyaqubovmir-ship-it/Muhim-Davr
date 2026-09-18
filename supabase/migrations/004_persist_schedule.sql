-- ONA — migration 004: persisting the visit schedule
--
-- generateSchedule in src/lib/schedule.ts computes the contact schedule on the
-- midwife's device. Until now nothing wrote it anywhere, so the visits table
-- stayed empty and bot/reminders.ts — which reads only that table — had nothing
-- to remind anyone of. The app now calls replace_planned_visits after every
-- saved assessment.
--
-- The dates still come from generateSchedule and nowhere else. This function
-- only writes what it is given; it computes no date.
--
-- WHY A FUNCTION AND NOT A FEW INSERTS FROM THE BROWSER:
--
--   * Atomic. Rewriting a schedule is delete, insert and renumber. Done as
--     separate requests, a failure halfway leaves a pregnancy with no planned
--     visits and so no reminders, silently. One function is one transaction.
--
--   * Renumbering. contact_number is the position in the schedule (see 002),
--     and the yellow zone inserts contacts, so a zone change renumbers every
--     later contact. visits_one_row_per_contact is unique on
--     (pregnancy_id, contact_number); renumbering in place collides with itself
--     part way through. The constraint is made deferrable below so the function
--     can renumber freely and have uniqueness checked once, at the end.
--
--   * Reminder history survives. A planned contact whose week and date are
--     unchanged keeps its row, and with it its id — and visit_reminders is keyed
--     on that id. Deleting and re-inserting every row would forget which
--     reminders had gone out, and the sweep would send them again.

alter table visits drop constraint visits_one_row_per_contact;
alter table visits add constraint visits_one_row_per_contact
  unique (pregnancy_id, contact_number) deferrable initially immediate;

-- replace_planned_visits
--
--   p_pregnancy_id   the pregnancy whose schedule is being rewritten
--   p_today          the midwife's calendar date. Passed in rather than read
--                    from current_date, which is UTC: from midnight to 05:00 in
--                    Tashkent it is still yesterday there.
--   p_assessment_id  the assessment just saved, or null
--   p_visits         [{"target_week": 30, "target_date": "2026-10-02"}, ...],
--                    the upcoming contacts from generateSchedule
--
-- What it does, in order:
--
--   1. A planned contact dated today is marked 'bajarilgan', completed by
--      p_assessment_id. She was seen today; that is what the assessment is.
--   2. Planned contacts not in p_visits are deleted — superseded dates, and
--      stale ones whose day has passed. Only 'rejalashtirilgan' rows are ever
--      deleted. A completed or missed row is a record and is never touched.
--   3. Contacts in p_visits dated after p_today that are not already planned
--      are inserted. Nothing on or before today is written as planned, and
--      nothing past is ever written as missed: the calendar can say a date
--      passed, but not whether she came.
--   4. Every row of the pregnancy is renumbered in date order.
--
-- Returns how many planned contacts the pregnancy now has.
--
-- SECURITY INVOKER: it runs with the caller's own rights, so the RLS policies
-- on visits apply exactly as they would to the same statements sent directly.

create or replace function replace_planned_visits(
  p_pregnancy_id  uuid,
  p_today         date,
  p_assessment_id uuid,
  p_visits        jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  planned_count integer;
begin
  if p_today is null then
    raise exception 'p_today is required' using errcode = 'null_value_not_allowed';
  end if;
  if jsonb_typeof(p_visits) is distinct from 'array' then
    raise exception 'p_visits must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  -- Two saves for the same woman at once would otherwise interleave their
  -- deletes and inserts.
  perform 1 from pregnancies where id = p_pregnancy_id for update;
  if not found then
    raise exception 'pregnancy % not found', p_pregnancy_id using errcode = 'foreign_key_violation';
  end if;

  set constraints visits_one_row_per_contact deferred;

  -- 1. Seen today.
  if p_assessment_id is not null then
    update visits
       set status = 'bajarilgan',
           completed_assessment_id = p_assessment_id
     where pregnancy_id = p_pregnancy_id
       and status = 'rejalashtirilgan'
       and target_date = p_today;
  end if;

  -- 2. Superseded and stale planned contacts.
  delete from visits v
   where v.pregnancy_id = p_pregnancy_id
     and v.status = 'rejalashtirilgan'
     and not exists (
       select 1
         from jsonb_to_recordset(p_visits) as n(target_week smallint, target_date date)
        where n.target_date > p_today
          and n.target_week = v.target_week
          and n.target_date = v.target_date
     );

  -- 3. New contacts. The contact number is provisional; step 4 sets it.
  insert into visits (pregnancy_id, contact_number, target_week, target_date)
  select p_pregnancy_id,
         row_number() over (order by n.target_date, n.target_week),
         n.target_week,
         n.target_date
    from (
      select distinct target_week, target_date
        from jsonb_to_recordset(p_visits) as r(target_week smallint, target_date date)
       where target_date > p_today
    ) as n
   where not exists (
     select 1
       from visits v
      where v.pregnancy_id = p_pregnancy_id
        and v.status = 'rejalashtirilgan'
        and v.target_week = n.target_week
        and v.target_date = n.target_date
   );

  -- 4. Positions, in date order, across completed and planned alike.
  update visits v
     set contact_number = ordered.position
    from (
      select id,
             row_number() over (order by target_date, target_week, created_at, id) as position
        from visits
       where pregnancy_id = p_pregnancy_id
    ) as ordered
   where v.id = ordered.id
     and v.contact_number is distinct from ordered.position;

  -- Check uniqueness here, so a violation is reported by this function rather
  -- than at some later commit.
  set constraints visits_one_row_per_contact immediate;

  select count(*) into planned_count
    from visits
   where pregnancy_id = p_pregnancy_id
     and status = 'rejalashtirilgan';

  return planned_count;
end;
$fn$;

-- Staff only, like every table it writes to. Supabase grants new functions to
-- anon by default; RLS would refuse anon anyway, but it should not get that far.
revoke execute on function replace_planned_visits(uuid, date, uuid, jsonb) from public, anon;
grant execute on function replace_planned_visits(uuid, date, uuid, jsonb) to authenticated;
