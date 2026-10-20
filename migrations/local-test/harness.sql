-- Stand-in for the parts of gradebook-prod the drafts touch. Roles and
-- auth.uid() as Supabase provides them; the four base tables with the
-- columns the drafts use; the idempotency and ownership helpers copied from
-- migrations/20260423_write_path_idempotency.sql and
-- migrations/20261012_course_soft_delete.sql.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create or replace function auth.uid() returns uuid
 language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.teacher (
  id uuid primary key, email text not null unique, display_name text,
  created_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.course (
  id uuid primary key default gen_random_uuid(), teacher_id uuid not null references teacher(id) on delete cascade,
  name text not null, deleted_at timestamptz, created_at timestamptz not null default now()
);
create table public.student (
  id uuid primary key default gen_random_uuid(), teacher_id uuid not null references teacher(id) on delete cascade,
  first_name text not null, last_name text, created_at timestamptz not null default now()
);
create table public.enrollment (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references student(id) on delete cascade,
  course_id uuid not null references course(id) on delete cascade,
  roster_position integer not null default 0, withdrawn_at timestamptz,
  unique (student_id, course_id)
);
alter table teacher enable row level security;
alter table course enable row level security;
alter table student enable row level security;
alter table enrollment enable row level security;
create policy course_self on course for all to authenticated using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy student_self on student for all to authenticated using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy enrollment_self on enrollment for all to authenticated using (exists (select 1 from course c where c.id = course_id and c.teacher_id = (select auth.uid())));

create table if not exists fv_idempotency (
    key uuid not null, teacher_id uuid not null references teacher(id) on delete cascade,
    endpoint text not null, result jsonb, created_at timestamptz not null default now(),
    primary key (key, teacher_id)
);
alter table fv_idempotency enable row level security;
create policy fv_idempotency_self on fv_idempotency for select using (teacher_id = auth.uid());

create or replace function fv_idem_check(p_key uuid, p_endpoint text) returns jsonb
 language plpgsql security definer set search_path = public
as $$
declare _uid uuid := (select auth.uid()); _r jsonb;
begin
    if _uid is null or p_key is null then return null; end if;
    select result into _r from fv_idempotency where key = p_key and teacher_id = _uid and endpoint = p_endpoint;
    return _r;
end; $$;
create or replace function fv_idem_store(p_key uuid, p_endpoint text, p_result jsonb) returns void
 language plpgsql security definer set search_path = public
as $$
declare _uid uuid := (select auth.uid());
begin
    if _uid is null or p_key is null then return; end if;
    insert into fv_idempotency (key, teacher_id, endpoint, result) values (p_key, _uid, p_endpoint, p_result)
      on conflict (key, teacher_id) do nothing;
end; $$;
create or replace function public.fv_owns_course(cid uuid) returns boolean
 language sql stable security definer set search_path to 'public'
as $function$
    select exists (select 1 from course c where c.id = cid and c.teacher_id = (select auth.uid()) and c.deleted_at is null);
$function$;
create or replace function public.fv_owns_enrollment(eid uuid) returns boolean
 language sql stable security definer set search_path to 'public'
as $function$
    select exists (select 1 from enrollment e join course c on c.id = e.course_id
                   where e.id = eid and c.teacher_id = (select auth.uid()) and c.deleted_at is null);
$function$;

-- Supabase grants these to the API roles on every public table.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
grant execute on function fv_idem_check(uuid, text), fv_idem_store(uuid, text, jsonb), fv_owns_course(uuid), fv_owns_enrollment(uuid) to authenticated;

-- Two teachers, a course each, students and enrollments.
insert into teacher (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'Teacher A'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', 'Teacher B');
insert into course (id, teacher_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Science 8'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Socials 10');
insert into student (id, teacher_id, first_name, last_name) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cece', 'Adeyemi'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Marcus', 'Lee'),
  ('bbbbbbbb-2222-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Someone', 'Else');
insert into enrollment (id, student_id, course_id, roster_position) values
  ('eeeeeeee-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1),
  ('eeeeeeee-1111-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 2),
  ('eeeeeeee-2222-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
