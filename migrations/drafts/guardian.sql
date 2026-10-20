-- DRAFT, not applied. Guardians: who a student's report goes home to, and
-- whether they agreed to receive it by email (2026-10-21).
--
-- Phase 4 (Send) emails a family a link to an issued report. Nothing in the
-- app does that yet, and nothing should until the district's position on
-- teacher-to-family email is known. This table is the groundwork only: a
-- place for the name, relationship, address, language and consent that
-- Class Management and the roster import will fill in.
--
-- What it adds:
--   guardian(id, student_id, name, relationship, email, phone, language,
--     consent_at, consent_source, notes, created_at, updated_at). A student
--     may have several; an email is unique per student.
--   upsert_guardian(p_student_id, p_name, p_relationship, p_email, p_phone,
--     p_language, p_consent_at, p_consent_source, p_id, p_idempotency_key):
--     inserts, or updates the row p_id when it belongs to the teacher's
--     student. Consent is never set unless the caller passes it: a form the
--     guardian signed, a verbal yes the teacher records, or a roster import
--     whose source says so. Returns the row as jsonb.
--   delete_guardian(p_id, p_idempotency_key).
--   list_course_guardians(p_course_id): every guardian of every student
--     enrolled in the course, as [{ enrollment_id, student_id, guardian… }],
--     for the Reports page and, later, the Send dialog.
--
-- Students are teacher-owned (student.teacher_id); guardians follow them:
-- RLS resolves through the student to the signed-in teacher, and the RPCs
-- are SECURITY INVOKER and check that too. Nothing here is readable by
-- anon. A guardian's email is personal information under FOIPPA; it stays
-- in gradebook-prod (ca-central-1) and is sent nowhere by this migration.

create table if not exists public.guardian (
  id              uuid        primary key default gen_random_uuid(),
  student_id      uuid        not null references public.student(id) on delete cascade,
  name            text        not null check (char_length(btrim(name)) between 1 and 120),
  relationship    text        check (relationship is null or char_length(relationship) <= 40),
  email           text        check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone           text        check (phone is null or char_length(phone) <= 40),
  language        text        not null default 'en' check (char_length(language) between 2 and 12),
  consent_at      timestamptz,
  consent_source  text        check (consent_source is null or consent_source in ('form', 'verbal', 'roster_import', 'portal')),
  notes           text        check (notes is null or char_length(notes) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint guardian_consent_pair check ((consent_at is null) = (consent_source is null))
);

create unique index if not exists guardian_student_email
  on public.guardian (student_id, lower(email)) where email is not null;
create index if not exists guardian_student on public.guardian (student_id);

alter table public.guardian enable row level security;

drop policy if exists guardian_owner on public.guardian;
create policy guardian_owner on public.guardian
  for all to authenticated
  using (exists (select 1 from public.student s where s.id = student_id and s.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.student s where s.id = student_id and s.teacher_id = (select auth.uid())));

-- ── upsert_guardian ──────────────────────────────────────────────────────
create or replace function public.upsert_guardian(
    p_student_id uuid, p_name text, p_relationship text default null, p_email text default null,
    p_phone text default null, p_language text default 'en', p_consent_at timestamptz default null,
    p_consent_source text default null, p_id uuid default null, p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _row    guardian%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'upsert_guardian');
    if _cached is not null then
        return _cached;
    end if;

    if not exists (select 1 from student s where s.id = p_student_id and s.teacher_id = (select auth.uid())) then
        raise exception 'student not found' using errcode = 'P0002';
    end if;

    if p_id is not null then
        update guardian
           set name = btrim(p_name),
               relationship = nullif(btrim(coalesce(p_relationship, '')), ''),
               email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
               phone = nullif(btrim(coalesce(p_phone, '')), ''),
               language = coalesce(nullif(btrim(p_language), ''), 'en'),
               consent_at = p_consent_at,
               consent_source = p_consent_source,
               updated_at = now()
         where id = p_id and student_id = p_student_id
        returning * into _row;
        if not found then
            raise exception 'guardian not found' using errcode = 'P0002';
        end if;
    else
        insert into guardian (student_id, name, relationship, email, phone, language, consent_at, consent_source)
        values (p_student_id, btrim(p_name),
                nullif(btrim(coalesce(p_relationship, '')), ''),
                nullif(lower(btrim(coalesce(p_email, ''))), ''),
                nullif(btrim(coalesce(p_phone, '')), ''),
                coalesce(nullif(btrim(p_language), ''), 'en'),
                p_consent_at, p_consent_source)
        returning * into _row;
    end if;

    _cached := to_jsonb(_row);
    perform fv_idem_store(p_idempotency_key, 'upsert_guardian', _cached);
    return _cached;
end;
$function$;

revoke all on function public.upsert_guardian(uuid, text, text, text, text, text, timestamptz, text, uuid, uuid) from public, anon;
grant execute on function public.upsert_guardian(uuid, text, text, text, text, text, timestamptz, text, uuid, uuid) to authenticated;

-- ── delete_guardian ──────────────────────────────────────────────────────
create or replace function public.delete_guardian(p_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_guardian');
    if _cached is not null then
        return _cached;
    end if;

    delete from guardian g
     where g.id = p_id
       and exists (select 1 from student s where s.id = g.student_id and s.teacher_id = (select auth.uid()));
    if not found then
        raise exception 'guardian not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_guardian', _result);
    return _result;
end;
$function$;

revoke all on function public.delete_guardian(uuid, uuid) from public, anon;
grant execute on function public.delete_guardian(uuid, uuid) to authenticated;

-- ── list_course_guardians ────────────────────────────────────────────────
create or replace function public.list_course_guardians(p_course_id uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;

    return coalesce((
        select jsonb_agg(to_jsonb(g) || jsonb_build_object('enrollment_id', e.id)
                         order by e.roster_position, e.id, g.name)
          from enrollment e
          join guardian g on g.student_id = e.student_id
         where e.course_id = p_course_id
           and e.withdrawn_at is null
    ), '[]'::jsonb);
end;
$function$;

revoke all on function public.list_course_guardians(uuid) from public, anon;
grant execute on function public.list_course_guardians(uuid) to authenticated;
