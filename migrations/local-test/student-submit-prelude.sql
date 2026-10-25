-- The prod columns and table student_submit reads that harness.sql leaves
-- out (schema.sql has them): preferred names, the class's time zone and
-- reporting terms, course soft-delete, and core_self_assessment.
alter table public.student add column if not exists preferred_name text;
alter table public.student add column if not exists date_of_birth date;
alter table public.course add column if not exists timezone text not null default 'America/Vancouver';
alter table public.course add column if not exists reporting_terms jsonb;
alter table public.course add column if not exists block text;
create table if not exists public.core_self_assessment (
  id            uuid        not null primary key default gen_random_uuid(),
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  core_id       text        not null,
  term_key      text        not null default '',
  level         integer,
  body          text,
  goal          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, core_id, term_key)
);
