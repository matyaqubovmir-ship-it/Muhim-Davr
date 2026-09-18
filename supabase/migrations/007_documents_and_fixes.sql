-- ONA (Muhim Davr) — migration 007: kept documents, and three fixes found in audit
--
-- Safe to run twice: every statement is guarded or idempotent.

-- ---------------------------------------------------------------------------
-- patient_documents — a lab sheet or card, kept with the record
-- ---------------------------------------------------------------------------
-- The midwife can photograph a lab sheet (or upload a PDF) and let the model
-- read it into the form. The file itself is kept too: a value the model read
-- is only auditable next to the paper it was read from.
--
-- The file lives in Storage (bucket 'patient-documents', private); this row
-- says whose it is and which visit it belongs to. Same composite key as
-- escalations: a document attached to a visit must belong to that visit's
-- pregnancy, and the database refuses it otherwise.
--
-- No UPDATE or DELETE policy: a document that informed a clinical record is
-- part of it, like the assessment itself.

create table if not exists patient_documents (
  id                  uuid primary key default gen_random_uuid(),
  pregnancy_id        uuid not null references pregnancies (id) on delete cascade,
  assessment_id       uuid,
  storage_path        text not null unique,
  file_name           text not null,
  media_type          text not null,
  size_bytes          integer not null,
  -- True when the model read it into the form before the visit was saved.
  used_for_extraction boolean not null default false,
  created_by          uuid references auth.users (id) default auth.uid(),
  created_at          timestamptz not null default now(),

  constraint patient_documents_media_type
    check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  constraint patient_documents_size_sane
    check (size_bytes > 0 and size_bytes <= 10485760),
  constraint patient_documents_name_not_blank
    check (length(btrim(file_name)) > 0),
  constraint patient_documents_assessment_matches_pregnancy
    foreign key (assessment_id, pregnancy_id)
    references assessments (id, pregnancy_id)
    on delete restrict
);

create index if not exists patient_documents_pregnancy_idx
  on patient_documents (pregnancy_id, created_at desc);

alter table patient_documents enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'patient_documents' and policyname = 'patient_documents_staff_read') then
    create policy patient_documents_staff_read on patient_documents for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_documents' and policyname = 'patient_documents_staff_insert') then
    create policy patient_documents_staff_insert on patient_documents for insert to authenticated with check (true);
  end if;
end
$$;

revoke all on patient_documents from anon;

-- The private bucket the files go in. 10 MB each, the four types the app sends.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-documents', 'patient-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Staff may add files and read them (the app asks for a short-lived signed
-- link to open one). Same hackathon posture as every table: any
-- authenticated session is staff — see 001 and the README.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'patient_documents_staff_read') then
    create policy patient_documents_staff_read on storage.objects
      for select to authenticated using (bucket_id = 'patient-documents');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'patient_documents_staff_insert') then
    create policy patient_documents_staff_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'patient-documents');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fix: a reminder whose send failed was lost for good
-- ---------------------------------------------------------------------------
-- The bot claims a reminder (inserts into visit_reminders) before sending, so
-- two sweeps can never send it twice. When Telegram then fails — a timeout, a
-- rate limit — the claim stayed and the reminder was never tried again. The bot
-- now releases the claim on a failed send; it needs permission to delete it.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'visit_reminders' and policyname = 'visit_reminders_staff_delete') then
    create policy visit_reminders_staff_delete on visit_reminders for delete to authenticated using (true);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fix: visits saved after midnight were dated the day before
-- ---------------------------------------------------------------------------
-- visit_date defaulted to current_date, which is UTC: from 00:00 to 05:00 in
-- Tashkent it is still yesterday. The app now sends the midwife's own date,
-- and the check compares with Tashkent's date so that is not refused.
alter table assessments drop constraint if exists assessments_visit_not_future;
alter table assessments add constraint assessments_visit_not_future
  check (visit_date <= (now() at time zone 'Asia/Tashkent')::date);
alter table assessments alter column visit_date
  set default (now() at time zone 'Asia/Tashkent')::date;

-- ---------------------------------------------------------------------------
-- Realtime for new registrations and schedule changes
-- ---------------------------------------------------------------------------
-- The registry re-reads on a new assessment (005). A newly registered woman has
-- none yet, so she did not appear until something else changed; and an overdue
-- flag could lag the schedule write. Same guard as 005 and 006.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['pregnancies', 'visits'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end
$$;

notify pgrst, 'reload schema';
