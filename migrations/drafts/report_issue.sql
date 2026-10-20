-- DRAFT, not applied. Issued reports: a fixed copy of every report at the
-- moment it went home (2026-10-21).
--
-- Issue Reports… saves each student's sheets so a reprint in February is the
-- report that went home in November, not a re-render of today's scores, and
-- so "changed since the last issue" can compare. Today that copy lives in
-- the issuing browser's IndexedDB (teacher/report-issues.js). These tables
-- make it the class's, on the server, which is also what Send (Phase 4)
-- links a family to. DECISIONS.md "Report forms" 9.
--
-- What it adds:
--   report_issue(id, course_id, term, term_label, paper, form, issued_at,
--     issued_by, student_count, created_at): one row per Issue.
--   report_issue_student(issue_id, enrollment_id, sheets, hash, html):
--     one row per student in the issue; html is the sheets as rendered
--     (self-contained; the client prints it as it is). hash is the client's
--     djb2 of that html, for "changed since".
--   create_report_issue(p_course_id, p_term, p_term_label, p_paper, p_form,
--     p_students jsonb, p_idempotency_key): p_students is an array of
--     { enrollment_id, sheets, hash, html }. Every enrollment must belong to
--     the course. Returns { id, issued_at, student_count }.
--   list_report_issues(p_course_id, p_term): the course's issues for a term
--     (all terms when p_term is null), newest first, without html, with
--     hashes as { enrollment_id: hash } so the client can diff.
--   get_report_issue(p_issue_id): one issue with every student's html.
--   delete_report_issue(p_issue_id, p_idempotency_key).
--
-- Size: a student's sheets are 15–40 KB of HTML. A class of 30 issued six
-- times a year is about 6 MB. Postgres carries that comfortably; if it ever
-- does not, html can give way to a Storage object path in the same row.
-- Retention: copies are records. They go when the course is purged (the
-- cascade through course_id) or when the teacher deletes the issue.
-- RLS: through the course. RPCs are SECURITY INVOKER and check ownership.

create table if not exists public.report_issue (
  id             uuid        primary key default gen_random_uuid(),
  course_id      uuid        not null references public.course(id) on delete cascade,
  term           integer     not null check (term between 1 and 6),
  term_label     text,
  paper          text        not null default 'letter' check (paper in ('letter', 'legal')),
  form           jsonb       check (form is null or (jsonb_typeof(form) = 'object' and jsonb_typeof(form->'front') = 'array')),
  issued_at      timestamptz not null default now(),
  issued_by      uuid        references public.teacher(id) on delete set null,
  student_count  integer     not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists report_issue_course_term on public.report_issue (course_id, term, issued_at desc);

create table if not exists public.report_issue_student (
  issue_id       uuid    not null references public.report_issue(id) on delete cascade,
  enrollment_id  uuid    not null references public.enrollment(id) on delete cascade,
  sheets         integer not null default 1 check (sheets between 1 and 20),
  hash           text    not null,
  html           text    not null,
  primary key (issue_id, enrollment_id)
);

alter table public.report_issue enable row level security;
alter table public.report_issue_student enable row level security;

drop policy if exists report_issue_owner on public.report_issue;
create policy report_issue_owner on public.report_issue
  for all to authenticated
  using (fv_owns_course(course_id))
  with check (fv_owns_course(course_id));

drop policy if exists report_issue_student_owner on public.report_issue_student;
create policy report_issue_student_owner on public.report_issue_student
  for all to authenticated
  using (exists (select 1 from public.report_issue i where i.id = issue_id and fv_owns_course(i.course_id)))
  with check (exists (select 1 from public.report_issue i where i.id = issue_id and fv_owns_course(i.course_id)));

-- ── create_report_issue ──────────────────────────────────────────────────
create or replace function public.create_report_issue(
    p_course_id uuid, p_term integer, p_term_label text, p_paper text, p_form jsonb,
    p_students jsonb, p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _id     uuid;
    _at     timestamptz;
    _n      integer;
    _bad    integer;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_report_issue');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_course(p_course_id) then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;
    if p_students is null or jsonb_typeof(p_students) <> 'array' or jsonb_array_length(p_students) = 0 then
        raise exception 'no students to issue' using errcode = '22023';
    end if;

    -- Every enrollment must be in this course (withdrawn students may be
    -- issued; a report can go home after a withdrawal).
    select count(*) into _bad
      from jsonb_array_elements(p_students) s
      left join enrollment e on e.id = (s->>'enrollment_id')::uuid and e.course_id = p_course_id
     where e.id is null;
    if _bad > 0 then
        raise exception '% student(s) are not in this course', _bad using errcode = '22023';
    end if;

    insert into report_issue (course_id, term, term_label, paper, form, issued_by, student_count)
    values (p_course_id, p_term, nullif(btrim(coalesce(p_term_label, '')), ''),
            coalesce(p_paper, 'letter'), p_form, (select auth.uid()), jsonb_array_length(p_students))
    returning id, issued_at, student_count into _id, _at, _n;

    insert into report_issue_student (issue_id, enrollment_id, sheets, hash, html)
    select _id,
           (s->>'enrollment_id')::uuid,
           greatest(1, least(20, coalesce((s->>'sheets')::integer, 1))),
           coalesce(s->>'hash', ''),
           coalesce(s->>'html', '')
      from jsonb_array_elements(p_students) s;

    _result := jsonb_build_object('id', _id, 'issued_at', _at, 'student_count', _n);
    perform fv_idem_store(p_idempotency_key, 'create_report_issue', _result);
    return _result;
end;
$function$;

revoke all on function public.create_report_issue(uuid, integer, text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_report_issue(uuid, integer, text, text, jsonb, jsonb, uuid) to authenticated;

-- ── list_report_issues ───────────────────────────────────────────────────
create or replace function public.list_report_issues(p_course_id uuid, p_term integer default null)
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
        select jsonb_agg(jsonb_build_object(
                   'id', i.id,
                   'course_id', i.course_id,
                   'term', i.term,
                   'term_label', i.term_label,
                   'paper', i.paper,
                   'issued_at', i.issued_at,
                   'student_count', i.student_count,
                   'hashes', coalesce((select jsonb_object_agg(s.enrollment_id::text, s.hash)
                                         from report_issue_student s where s.issue_id = i.id), '{}'::jsonb)
               ) order by i.issued_at desc)
          from report_issue i
         where i.course_id = p_course_id
           and (p_term is null or i.term = p_term)
    ), '[]'::jsonb);
end;
$function$;

revoke all on function public.list_report_issues(uuid, integer) from public, anon;
grant execute on function public.list_report_issues(uuid, integer) to authenticated;

-- ── get_report_issue ─────────────────────────────────────────────────────
create or replace function public.get_report_issue(p_issue_id uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
    _issue report_issue%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    select * into _issue from report_issue where id = p_issue_id;
    if not found or not fv_owns_course(_issue.course_id) then
        raise exception 'issue not found' using errcode = 'P0002';
    end if;

    return to_jsonb(_issue) || jsonb_build_object(
        'students', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'enrollment_id', s.enrollment_id,
                       'sheets', s.sheets,
                       'hash', s.hash,
                       'html', s.html
                   ) order by e.roster_position, e.id)
              from report_issue_student s
              left join enrollment e on e.id = s.enrollment_id
             where s.issue_id = _issue.id
        ), '[]'::jsonb)
    );
end;
$function$;

revoke all on function public.get_report_issue(uuid) from public, anon;
grant execute on function public.get_report_issue(uuid) to authenticated;

-- ── delete_report_issue ──────────────────────────────────────────────────
create or replace function public.delete_report_issue(p_issue_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_report_issue');
    if _cached is not null then
        return _cached;
    end if;

    select course_id into _course from report_issue where id = p_issue_id;
    if not found or not fv_owns_course(_course) then
        raise exception 'issue not found' using errcode = 'P0002';
    end if;

    delete from report_issue where id = p_issue_id;

    _result := jsonb_build_object('id', p_issue_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_report_issue', _result);
    return _result;
end;
$function$;

revoke all on function public.delete_report_issue(uuid, uuid) from public, anon;
grant execute on function public.delete_report_issue(uuid, uuid) to authenticated;
