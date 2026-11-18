-- Bulletins, the teacher's side (2026-11-17). Not applied: needs Colin's OK.
-- THIS FILE CHANGES NO EXISTING ROW, TABLE, POLICY OR FUNCTION. It adds four
-- empty tables (bulletin, bulletin_file, bulletin_seen, bulletin_reaction: row
-- security on, no policy, no grant), the private bucket bulletin-files with
-- four storage policies, and seven functions for a signed-in teacher, one of
-- which, delete_bulletin, DELETES a bulletin and what students did on it.
-- Contract: local-test/bulletins-contract.md. Tests: local-test/bulletins.py.
-- local-test/bulletins-live-precheck.sql, -postcheck.sql, -undo.sql.
-- It stops with nothing changed unless what it relies on is as tested (the
-- checks below). Adds one row, the bucket's. Locks course, enrollment,
-- assessment, storage.objects a moment; gives up after 5 s if one is held.
-- One transaction. A second run changes nothing, and is refused once a later
-- file has changed one of its functions or tables.
-- Accepts: until B1b teaches the removal worker this bucket, a queued page is
-- handed out on every run, the hourly call logs an error, and
-- photo_lifecycle_nightly RAISES once one has waited six hours. A page is
-- queued only when a bulletin with a file is deleted, which no released app does.

begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

-- 1. The checks
do $guard$
declare
  _f record;
  _c text;
  _b record;
begin
  for _f in select * from (values
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'), ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'), ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527')
  ) as v(fn, md5) loop
    if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.md5 then
      raise exception '% is missing or not the definition this file was tested against. Nothing was changed.', _f.fn;
    end if;
  end loop;
  -- Its function names in public and fv_private: none, or exactly this file's (one md5, bulletins.py writes it).
  perform set_config('fv.b1a', 'bulletin_file_path,bulletin_file_path_parts,bulletin_file_upload_allowed,bulletin_file_read_allowed,'
    || 'bulletin_audience,bulletin_pinned_now,bulletin_json,bulletin_patched,bulletin_drop_expired,bulletin_student_same_class,'
    || 'bulletin_file_removed,list_bulletins,post_bulletin,finish_bulletin_file,edit_bulletin,delete_bulletin,list_bulletin_seen,show_bulletin_again', true);
  select md5(string_agg(p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text))
   into _c from pg_proc p where p.proname = any (string_to_array(current_setting('fv.b1a'), ','))
    and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace);
  if _c is distinct from null and _c is distinct from '3cdbfe6ce2a43145f01c101ef5377a7f' then -- fp:own
    raise exception 'functions of this file''s names are there and are not exactly this file''s. Nothing was changed.';
  end if;
  -- Its tables: none, or exactly this file's columns.
  select md5(string_agg(attrelid::regclass::text || '.' || attname || ' ' || format_type(atttypid, atttypmod), ',' order by attrelid::regclass::text, attnum))
   into _c from pg_attribute
  where attrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname in ('bulletin', 'bulletin_file', 'bulletin_seen', 'bulletin_reaction'))
   and attnum > 0 and not attisdropped;
  if _c is distinct from null and _c is distinct from '55a7166be4a1bb643f1d1c02f4c80447' then -- fp:tables
    raise exception 'tables of this file''s names are there and are not exactly this file''s. Nothing was changed.';
  end if;
  -- The columns it reads.
  for _f in select * from (values
    ('public.course', 'id uuid, teacher_id uuid, timezone text, deleted_at timestamp with time zone, student_page_enabled boolean'),
    ('public.enrollment', 'id uuid, course_id uuid, roster_position integer, withdrawn_at timestamp with time zone, page_paused_at timestamp with time zone'),
    ('public.student_card', 'enrollment_id uuid, stopped_at timestamp with time zone, works_until date'),
    ('public.assessment', 'id uuid, course_id uuid'),
    ('public.submission_file_removal', 'bucket text, path text, course_id uuid, reason text, link_dies_at timestamp with time zone'),
    ('storage.buckets', 'id text, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]'),
    ('storage.objects', 'bucket_id text, name text, metadata jsonb, archived_at timestamp with time zone, is_delete_marker boolean')
  ) as v(tbl, cols) loop
    select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ') into _c
     from pg_attribute where attrelid = to_regclass(_f.tbl) and attnum > 0 and not attisdropped;
    if _c is null or not string_to_array(_f.cols, ', ') <@ string_to_array(_c, ', ') then
      raise exception '% does not have the columns this file reads (%). Nothing was changed.', _f.tbl, _f.cols;
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.submission_file_removal'::regclass and contype = 'u'
          and pg_get_constraintdef(oid) = 'UNIQUE (bucket, path)')
   or not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'submission_file_removal has no unique (bucket, path), or storage.objects has row security off. Nothing was changed.';
  end if;
  -- Live's ten (the pre-check names them).
  if (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname !~ '^fv_bulletin_files_') <> 10 then
    raise exception 'storage.objects does not have the ten policies this file was tested with. Nothing was changed.';
  end if;
  select public, file_size_limit, allowed_mime_types into _b from storage.buckets where id = 'bulletin-files';
  if found and (_b.public is distinct from false or _b.file_size_limit is distinct from 2097152 or _b.allowed_mime_types is distinct from array['image/jpeg']) then
    raise exception 'a bucket bulletin-files exists and is not private, 2097152 bytes, image/jpeg only. Nothing was changed.';
  end if;
  if to_regclass('public.bulletin_file') is null and exists (select 1 from storage.objects where bucket_id = 'bulletin-files') then
    raise exception 'the bucket bulletin-files holds files, and this file is not applied. Nothing was changed.';
  end if;
end
$guard$;

-- 2. The tables
create table if not exists public.bulletin (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course(id) on delete cascade,
  -- M3 and M4 widen this check (drop, add not valid, validate): no row is rewritten.
  kind text not null constraint bulletin_kind_check check (kind in ('announcement', 'reminder')),
  body text not null default '' constraint bulletin_body_check check (char_length(body) <= 2000),
  link_url text constraint bulletin_link_check check (link_url is null or (char_length(link_url) <= 2000
            and link_url ~* '^https?://[^[:space:][:cntrl:]/?#@\\]+([/?#][^[:space:][:cntrl:]]*)?$')),
  link_title text,
  pinned boolean not null default false,
  pinned_until date,
  assessment_id uuid references public.assessment(id) on delete set null,
  reactions_on boolean not null default false,
  shown_again_at timestamptz,
  -- Null until every file is ready.
  posted_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key uuid,
  constraint bulletin_link_title_check check (link_title is null or (link_url is not null and char_length(link_title) between 1 and 200)),
  constraint bulletin_pinned_until_check check (pinned_until is null or (pinned and kind = 'reminder' and isfinite(pinned_until))),
  constraint bulletin_id_course_key unique (id, course_id),
  constraint bulletin_course_key_key unique (course_id, idempotency_key)
);
create index if not exists bulletin_course_idx on public.bulletin (course_id, posted_at);
create index if not exists bulletin_assessment_idx on public.bulletin (assessment_id) where assessment_id is not null;

create table if not exists public.bulletin_file (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course(id) on delete cascade,
  bulletin_id uuid not null,
  kind text not null constraint bulletin_file_kind_check check (kind in ('photo', 'pdf')),
  title text not null constraint bulletin_file_title_check check (char_length(title) between 1 and 200),
  page_count integer not null constraint bulletin_file_page_count_check check (page_count between 1 and 20 and (kind = 'pdf' or page_count = 1)),
  bytes bigint,
  status text not null default 'uploading' constraint bulletin_file_status_check check (status in ('uploading', 'ready')),
  position integer not null,
  created_at timestamptz not null default now(),
  constraint bulletin_file_bytes_check check ((status = 'uploading' and bytes is null)
                      or (status = 'ready' and bytes is not null and bytes between 1 and page_count * 2097152::bigint)),
  constraint bulletin_file_bulletin_fkey foreign key (bulletin_id, course_id) references public.bulletin (id, course_id) on delete cascade
);
create index if not exists bulletin_file_bulletin_idx on public.bulletin_file (bulletin_id, position);
create index if not exists bulletin_file_course_idx on public.bulletin_file (course_id);

create table if not exists public.bulletin_seen (
  bulletin_id uuid not null references public.bulletin(id) on delete cascade,
  enrollment_id uuid not null references public.enrollment(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (bulletin_id, enrollment_id)
);
create index if not exists bulletin_seen_enrollment_idx on public.bulletin_seen (enrollment_id);

create table if not exists public.bulletin_reaction (
  bulletin_id uuid not null references public.bulletin(id) on delete cascade,
  enrollment_id uuid not null references public.enrollment(id) on delete cascade,
  word text not null constraint bulletin_reaction_word_check check (word in ('got_it', 'done', 'question')),
  updated_at timestamptz not null default now(),
  primary key (bulletin_id, enrollment_id)
);
create index if not exists bulletin_reaction_enrollment_idx on public.bulletin_reaction (enrollment_id);

alter table public.bulletin enable row level security;
alter table public.bulletin_file enable row level security;
alter table public.bulletin_seen enable row level security;
alter table public.bulletin_reaction enable row level security;
revoke all on table public.bulletin, public.bulletin_file, public.bulletin_seen, public.bulletin_reaction
  from public, anon, authenticated, service_role;

-- 3. Where a page is, and what the storage policies ask
create or replace function fv_private.bulletin_file_path(p_course_id uuid, p_file_id uuid, p_page integer)
 returns text language sql immutable set search_path to 'public', 'pg_temp'
as $function$
  select p_course_id::text || '/' || p_file_id::text || '/' || p_page::text || '.jpg';
$function$;

-- A page's name's parts, or no row.
create or replace function fv_private.bulletin_file_path_parts(p_name text)
 returns table (course_id uuid, file_id uuid, page integer) language sql immutable set search_path to 'public', 'pg_temp'
as $function$
  select m[1]::uuid, m[2]::uuid, m[3]::integer
   from regexp_match(p_name, '^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/([1-9]|1[0-9]|20)\.jpg$') m
  where m is not null;
$function$;

-- Upload: the teacher's own file, uploading, within two hours.
create or replace function fv_private.bulletin_file_upload_allowed(p_name text)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select (select auth.uid()) is not null
   and exists (select 1 from fv_private.bulletin_file_path_parts(p_name) h join bulletin_file f on f.id = h.file_id
          where f.course_id = h.course_id and h.page <= f.page_count and f.status = 'uploading'
           and f.created_at >= now() - interval '2 hours' and fv_owns_course(f.course_id));
$function$;

create or replace function fv_private.bulletin_file_read_allowed(p_name text)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select (select auth.uid()) is not null
   and exists (select 1 from fv_private.bulletin_file_path_parts(p_name) h join bulletin_file f on f.id = h.file_id
          where f.course_id = h.course_id and h.page <= f.page_count and fv_owns_course(f.course_id));
$function$;

-- 4. Helpers
-- Each student not withdrawn: paused, can_see (a card not stopped or expired, _card_refusal's tests) or no_card.
create or replace function fv_private.bulletin_audience(p_course_id uuid)
 returns table (enrollment_id uuid, roster_position integer, state text) language sql stable set search_path to 'public', 'pg_temp'
as $function$
  select e.id, e.roster_position,
     case when e.page_paused_at is not null then 'paused'
        when exists (select 1 from student_card k
               where k.enrollment_id = e.id and k.stopped_at is null
                and k.works_until >= (now() at time zone _fv_timezone(c.timezone))::date) then 'can_see'
        else 'no_card' end
   from enrollment e join course c on c.id = e.course_id
  where e.course_id = p_course_id and e.withdrawn_at is null;
$function$;

create or replace function fv_private.bulletin_pinned_now(p_pinned boolean, p_until date, p_timezone text)
 returns boolean language sql stable set search_path to 'public', 'pg_temp'
as $function$
  select p_pinned and (p_until is null or p_until >= (now() at time zone _fv_timezone(p_timezone))::date);
$function$;

-- One bulletin, as the contract has it.
create or replace function fv_private.bulletin_json(p_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with a as (select * from fv_private.bulletin_audience((select course_id from bulletin where id = p_id)) where state = 'can_see')
  select jsonb_build_object(
       'id', b.id, 'kind', b.kind, 'body', b.body, 'link_url', b.link_url, 'link_title', b.link_title,
       'pinned', fv_private.bulletin_pinned_now(b.pinned, b.pinned_until, c.timezone), 'pinned_until', b.pinned_until,
       'assessment_id', b.assessment_id, 'reactions_on', b.reactions_on, 'visible', b.posted_at is not null,
       'posted_at', b.posted_at, 'shown_again_at', b.shown_again_at, 'edited_at', b.edited_at,
       'created_at', b.created_at, 'updated_at', b.updated_at, 'idempotency_key', b.idempotency_key,
       'files', coalesce((select jsonb_agg(jsonb_build_object(
              'id', f.id, 'kind', f.kind, 'title', f.title, 'page_count', f.page_count, 'bytes', f.bytes,
              'status', f.status, 'position', f.position, 'created_at', f.created_at,
              'paths', (select jsonb_agg(fv_private.bulletin_file_path(f.course_id, f.id, n) order by n) from generate_series(1, f.page_count) n))
             || case when f.status = 'uploading' then jsonb_build_object('finish_by', f.created_at + interval '2 hours') else '{}'::jsonb end
             order by f.position, f.id)
          from bulletin_file f where f.bulletin_id = b.id), '[]'::jsonb),
       'seen', (select count(*) from bulletin_seen s join a on a.enrollment_id = s.enrollment_id where s.bulletin_id = b.id),
       'can_see', (select count(*) from a),
       'reactions', (select jsonb_build_object('got_it', count(*) filter (where r.word = 'got_it'),
                           'done', count(*) filter (where r.word = 'done'),
                           'question', count(*) filter (where r.word = 'question'))
               from bulletin_reaction r join a on a.enrollment_id = r.enrollment_id where r.bulletin_id = b.id))
   from bulletin b join course c on c.id = b.course_id
  where b.id = p_id;
$function$;

-- A change applied, after every rule (22023). For post (no id yet: takes kind) and edit.
create or replace function fv_private.bulletin_patched(p_b public.bulletin, p_patch jsonb, p_has_files boolean)
 returns public.bulletin language plpgsql stable set search_path to 'public', 'pg_temp'
as $function$
declare
  _p jsonb := coalesce(p_patch, 'null'::jsonb);
  _k text;
  _v jsonb;
  _t text;
  _why text;
begin
  if jsonb_typeof(_p) <> 'object' then
    raise exception 'a bulletin is an object' using errcode = '22023';
  end if;
  for _k, _v in select key, value from jsonb_each(_p) loop
    _t := case when _k in ('pinned', 'reactions_on') then 'boolean' else 'string' end;
    if _k not in ('body', 'link_url', 'link_title', 'pinned', 'pinned_until', 'assessment_id', 'reactions_on') and not (_k = 'kind' and p_b.id is null) then
      raise exception 'a bulletin has no % that can be set', _k using errcode = '22023';
    end if;
    if jsonb_typeof(_v) not in (_t, 'null') then
      raise exception '% must be a %', _k, _t using errcode = '22023';
    end if;
    _t := nullif(regexp_replace(_v #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    begin
      case _k
        when 'kind' then p_b.kind := _t;
        when 'body' then p_b.body := coalesce(_t, '');
        when 'link_url' then p_b.link_url := _t;
        when 'link_title' then p_b.link_title := _t;
        when 'pinned' then p_b.pinned := coalesce(_t::boolean, false);
        when 'reactions_on' then p_b.reactions_on := coalesce(_t::boolean, false);
        when 'pinned_until' then
          if _t !~ '^\d{4}-\d\d-\d\d$' then raise exception using errcode = '22007'; end if;
          p_b.pinned_until := _t::date;
        else p_b.assessment_id := _t::uuid;
      end case;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception '% must be a %', _k, case _k when 'pinned_until' then 'date' else 'id' end using errcode = '22023';
    end;
  end loop;
  if p_b.link_url is null and not (_p ? 'link_title' and p_b.link_title is not null) then p_b.link_title := null; end if;
  if _p ? 'pinned' and not p_b.pinned and not (_p ? 'pinned_until' and p_b.pinned_until is not null) then p_b.pinned_until := null; end if;
  _why := case
    when p_b.kind is null or p_b.kind not in ('announcement', 'reminder') then 'a bulletin is an announcement or a reminder'
    when char_length(p_b.body) > 2000 then 'a bulletin''s words can be 2000 characters at most'
    when char_length(p_b.link_url) > 2000 or p_b.link_url !~* '^https?://[^[:space:][:cntrl:]/?#@\\]+([/?#][^[:space:][:cntrl:]]*)?$'
       or p_b.link_url ~ '[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]'
      then 'a link must start with http:// or https:// and a host (no name or password), with no spaces or hidden characters, 2000 characters at most'
    when p_b.link_title is not null and p_b.link_url is null then 'a link''s name needs a link'
    when char_length(p_b.link_title) > 200 then 'a link''s name can be 200 characters at most'
    when p_b.pinned_until is not null and p_b.kind <> 'reminder' then 'only a reminder can stay pinned until a date'
    when p_b.pinned_until is not null and not p_b.pinned then 'a date to stay pinned until needs the reminder pinned'
    when (_p ? 'pinned' or _p ? 'pinned_until')
      and p_b.pinned_until < (select (now() at time zone _fv_timezone(c.timezone))::date from course c where c.id = p_b.course_id)
      then 'the date to stay pinned until has passed'
    when p_b.assessment_id is not null and not exists (select 1 from assessment a where a.id = p_b.assessment_id and a.course_id = p_b.course_id)
      then 'the linked assessment is not in this class'
    when p_b.body = '' and p_b.link_url is null and not p_has_files then 'a bulletin needs words, a link or a file'
  end;
  if _why is not null then
    raise exception '%', _why using errcode = '22023';
  end if;
  return p_b;
end;
$function$;

-- A class's bulletins not visible two hours after their post go, under its lock.
create or replace function fv_private.bulletin_drop_expired(p_course_id uuid)
 returns integer language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _n int;
begin
  perform set_config('fv.bulletin_removal_reason', 'bulletin_expired', true);
  perform pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(p_course_id::text));
  delete from bulletin b where b.course_id = p_course_id and b.posted_at is null and b.created_at < now() - interval '2 hours';
  get diagnostics _n = row_count;
  perform set_config('fv.bulletin_removal_reason', '', true);
  return _n;
end;
$function$;

-- 5. Triggers
create or replace function fv_private.bulletin_student_same_class()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (select 1 from bulletin b join enrollment e on e.course_id = b.course_id where b.id = new.bulletin_id and e.id = new.enrollment_id) then
    raise exception '%: the student is not in the bulletin''s class', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- A file row going, by any path, queues its pages.
create or replace function fv_private.bulletin_file_removed()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
  select 'bulletin-files', fv_private.bulletin_file_path(old.course_id, old.id, n), old.course_id,
     coalesce(nullif(current_setting('fv.bulletin_removal_reason', true), ''), 'bulletin_removed'), now() + interval '10 minutes'
   from generate_series(1, old.page_count) n
  on conflict (bucket, path) do nothing;
  return null;
end;
$function$;

create or replace trigger bulletin_seen_same_class before insert or update on public.bulletin_seen
  for each row execute function fv_private.bulletin_student_same_class();
create or replace trigger bulletin_reaction_same_class before insert or update on public.bulletin_reaction
  for each row execute function fv_private.bulletin_student_same_class();
create or replace trigger bulletin_file_removed after delete on public.bulletin_file
  for each row execute function fv_private.bulletin_file_removed();

-- 6. The teacher's functions
-- A class's writes take its lock, after the idempotency key's.
create or replace function public.list_bulletins(p_course_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _c course%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  if not fv_owns_course(p_course_id) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if current_setting('transaction_read_only') = 'off' then
    perform fv_private.bulletin_drop_expired(p_course_id);
  end if;
  select * into _c from course where id = p_course_id;
  return (
    with b as (select b.id, fv_private.bulletin_pinned_now(b.pinned, b.pinned_until, _c.timezone) pin, coalesce(b.posted_at, b.created_at) at
          from bulletin b
          where b.course_id = p_course_id and not (b.posted_at is null and b.created_at < now() - interval '2 hours')),
      a as (select state, count(*) n from fv_private.bulletin_audience(p_course_id) group by state)
    select jsonb_build_object(
      'bulletins', coalesce((select jsonb_agg(fv_private.bulletin_json(x.id) order by x.pin desc, x.at desc, x.id desc)
                  from (select * from b order by pin desc, at desc, id desc limit 100) x), '[]'::jsonb),
      'more', (select count(*) > 100 from b),
      'can_see', coalesce((select n from a where state = 'can_see'), 0),
      'no_card', coalesce((select n from a where state = 'no_card'), 0),
      'paused', coalesce((select n from a where state = 'paused'), 0),
      'page_on', _c.student_page_enabled));
end;
$function$;

create or replace function public.post_bulletin(p_course_id uuid, p_bulletin jsonb, p_files jsonb default null, p_idempotency_key uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _cached jsonb;
  _fs jsonb := coalesce(p_files, '[]'::jsonb);
  _f jsonb;
  _n bulletin%rowtype;
  _pages int := 0;
  _id uuid;
  _out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  _cached := fv_idem_check(p_idempotency_key, 'post_bulletin');
  if _cached is not null then return _cached; end if;
  if not fv_owns_course(p_course_id) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(p_course_id::text));
  -- Posted with this key, its stored reply since cleared: the row now.
  select b.id into _id from bulletin b where b.course_id = p_course_id and b.idempotency_key = p_idempotency_key;
  if _id is not null then
    return jsonb_build_object('bulletin', fv_private.bulletin_json(_id), 'bucket', 'bulletin-files');
  end if;
  perform fv_private.bulletin_drop_expired(p_course_id);
  if jsonb_typeof(_fs) <> 'array' then
    raise exception 'files must be a list' using errcode = '22023';
  end if;
  for _f in select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end from jsonb_array_elements(_fs) loop
    if exists (select 1 from jsonb_object_keys(_f) k where k not in ('kind', 'title', 'pages'))
     or coalesce(_f->>'kind', '') not in ('photo', 'pdf') or jsonb_typeof(_f->'pages') is distinct from 'number'
     or jsonb_typeof(coalesce(_f->'title', '""')) not in ('string', 'null')
     or _f->>'pages' !~ (case when _f->>'kind' = 'photo' then '^1$' else '^([1-9]|1[0-9]|20)$' end) then
      raise exception 'a file is { kind: photo or pdf, title, pages }: a photo is 1 page, a PDF 1 to 20' using errcode = '22023';
    end if;
    if char_length(regexp_replace(coalesce(_f->>'title', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) > 200 then
      raise exception 'a file''s name can be 200 characters at most' using errcode = '22023';
    end if;
    _pages := _pages + (_f->>'pages')::int;
  end loop;
  if _pages > 20 then
    raise exception 'a bulletin can have 20 pages at most' using errcode = '22023';
  end if;
  if _pages + (select coalesce(sum(f.page_count), 0) from bulletin_file f where f.course_id = p_course_id) > 2000 then
    raise exception 'a class can hold 2000 bulletin pages at most: delete some bulletins with files first' using errcode = '22023';
  end if;
  _n.course_id := p_course_id; _n.body := ''; _n.pinned := false; _n.reactions_on := false;
  _n := fv_private.bulletin_patched(_n, p_bulletin, _pages > 0);
  insert into bulletin (course_id, kind, body, link_url, link_title, pinned, pinned_until, assessment_id, reactions_on, posted_at, idempotency_key)
  values (p_course_id, _n.kind, _n.body, _n.link_url, _n.link_title, _n.pinned, _n.pinned_until, _n.assessment_id, _n.reactions_on,
      case when _pages = 0 then now() end, p_idempotency_key)
  returning id into _id;
  insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position)
  select p_course_id, _id, e.value->>'kind',
     coalesce(nullif(regexp_replace(coalesce(e.value->>'title', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), case when e.value->>'kind' = 'photo' then 'Photo' else 'PDF' end),
     (e.value->>'pages')::int, e.n
   from jsonb_array_elements(_fs) with ordinality e(value, n);
  _out := jsonb_build_object('bulletin', fv_private.bulletin_json(_id), 'bucket', 'bulletin-files');
  perform fv_idem_store(p_idempotency_key, 'post_bulletin', _out);
  return _out;
end;
$function$;

-- Not there: an answer, not an error, so an expired upload's drop is kept.
create or replace function public.finish_bulletin_file(p_bulletin_file_id uuid, p_idempotency_key uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _cached jsonb;
  _course uuid;
  _f bulletin_file%rowtype;
  _missing jsonb;
  _bad jsonb;
  _bytes bigint;
  _out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  _cached := fv_idem_check(p_idempotency_key, 'finish_bulletin_file');
  if _cached is not null then return _cached; end if;
  select f.course_id into _course from bulletin_file f where f.id = p_bulletin_file_id and fv_owns_course(f.course_id);
  if _course is not null then
    perform pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(_course::text));
    perform fv_private.bulletin_drop_expired(_course);
    select * into _f from bulletin_file where id = p_bulletin_file_id for update;
  end if;
  if _f.id is null then
    return jsonb_build_object('file_id', p_bulletin_file_id, 'status', 'gone');
  end if;
  if _f.status = 'uploading' then
    select coalesce(jsonb_agg(g.n order by g.n) filter (where o.n is null), '[]'::jsonb),
       coalesce(jsonb_agg(g.n order by g.n) filter (where o.n is not null and (o.mimetype = 'image/jpeg' and o.bytes between 1 and 2097152) is not true), '[]'::jsonb),
       sum(o.bytes)
     into _missing, _bad, _bytes
     from generate_series(1, _f.page_count) g(n)
     left join lateral (select g.n, nullif(x.metadata->>'size', '')::bigint bytes, x.metadata->>'mimetype' mimetype
               from storage.objects x where x.bucket_id = 'bulletin-files' and x.name = fv_private.bulletin_file_path(_f.course_id, _f.id, g.n) collate "C"
                and x.archived_at is null and not x.is_delete_marker limit 1) o on true;
    if _missing <> '[]'::jsonb or _bad <> '[]'::jsonb then
      return jsonb_build_object('file_id', _f.id, 'bulletin', fv_private.bulletin_json(_f.bulletin_id), 'missing', _missing, 'bad', _bad);
    end if;
    update bulletin_file set status = 'ready', bytes = _bytes where id = _f.id;
    if not exists (select 1 from bulletin_file x where x.bulletin_id = _f.bulletin_id and x.status = 'uploading') then
      update bulletin set posted_at = now(), updated_at = now() where id = _f.bulletin_id and posted_at is null;
    end if;
  end if;
  _out := jsonb_build_object('file_id', _f.id, 'bulletin', fv_private.bulletin_json(_f.bulletin_id));
  perform fv_idem_store(p_idempotency_key, 'finish_bulletin_file', _out);
  return _out;
end;
$function$;

create or replace function public.edit_bulletin(p_bulletin_id uuid, p_patch jsonb, p_idempotency_key uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _cached jsonb;
  _course uuid;
  _o bulletin%rowtype;
  _n bulletin%rowtype;
  _out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  _cached := fv_idem_check(p_idempotency_key, 'edit_bulletin');
  if _cached is not null then return _cached; end if;
  select b.course_id into _course from bulletin b where b.id = p_bulletin_id and fv_owns_course(b.course_id);
  if _course is not null then
    perform pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(_course::text));
    select * into _o from bulletin where id = p_bulletin_id for update;
  end if;
  if _o.id is null then
    raise exception 'bulletin not found' using errcode = 'P0002';
  end if;
  _n := fv_private.bulletin_patched(_o, p_patch, exists (select 1 from bulletin_file f where f.bulletin_id = _o.id));
  if (_n.body, _n.link_url, _n.link_title, _n.pinned, _n.pinned_until, _n.assessment_id, _n.reactions_on)
   is distinct from (_o.body, _o.link_url, _o.link_title, _o.pinned, _o.pinned_until, _o.assessment_id, _o.reactions_on) then
    update bulletin
     set body = _n.body, link_url = _n.link_url, link_title = _n.link_title, pinned = _n.pinned, pinned_until = _n.pinned_until,
       assessment_id = _n.assessment_id, reactions_on = _n.reactions_on, updated_at = now(),
       edited_at = case when (_n.body, _n.link_url, _n.link_title) is distinct from (_o.body, _o.link_url, _o.link_title) then now() else edited_at end
    where id = _o.id;
  end if;
  _out := jsonb_build_object('bulletin', fv_private.bulletin_json(_o.id));
  perform fv_idem_store(p_idempotency_key, 'edit_bulletin', _out);
  return _out;
end;
$function$;

-- DELETES the bulletin and every row under it.
create or replace function public.delete_bulletin(p_bulletin_id uuid, p_idempotency_key uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _cached jsonb;
  _course uuid;
  _out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  _cached := fv_idem_check(p_idempotency_key, 'delete_bulletin');
  if _cached is not null then return _cached; end if;
  select b.course_id into _course from bulletin b where b.id = p_bulletin_id and fv_owns_course(b.course_id);
  if _course is not null then
    perform pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(_course::text));
    delete from bulletin where id = p_bulletin_id;
  end if;
  if _course is null or not found then
    raise exception 'bulletin not found' using errcode = 'P0002';
  end if;
  _out := jsonb_build_object('deleted', true, 'id', p_bulletin_id);
  perform fv_idem_store(p_idempotency_key, 'delete_bulletin', _out);
  return _out;
end;
$function$;

create or replace function public.list_bulletin_seen(p_bulletin_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _course uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  select b.course_id into _course from bulletin b where b.id = p_bulletin_id and fv_owns_course(b.course_id);
  if _course is null then
    raise exception 'bulletin not found' using errcode = 'P0002';
  end if;
  return (
    with a as (select x.enrollment_id id, x.roster_position, r.word,
             case when x.state <> 'can_see' then x.state when s.enrollment_id is null then 'not_seen' else 'seen' end k
          from fv_private.bulletin_audience(_course) x
          left join bulletin_seen s on s.bulletin_id = p_bulletin_id and s.enrollment_id = x.enrollment_id
          left join bulletin_reaction r on r.bulletin_id = p_bulletin_id and r.enrollment_id = x.enrollment_id)
    select jsonb_build_object('bulletin_id', p_bulletin_id, 'reactions',
             (select jsonb_object_agg(g, coalesce((select jsonb_agg(id order by roster_position, id) from a where word = g and k like '%seen'), '[]'))
                from unnest(array['got_it', 'done', 'question']) g))
        || (select jsonb_object_agg(g, coalesce((select jsonb_agg(id order by roster_position, id) from a where k = g), '[]'))
              from unnest(array['not_seen', 'seen', 'paused', 'no_card']) g));
end;
$function$;

create or replace function public.show_bulletin_again(p_bulletin_id uuid, p_idempotency_key uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  _cached jsonb;
  _course uuid;
  _b bulletin%rowtype;
  _out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  _cached := fv_idem_check(p_idempotency_key, 'show_bulletin_again');
  if _cached is not null then return _cached; end if;
  select b.course_id into _course from bulletin b where b.id = p_bulletin_id and fv_owns_course(b.course_id);
  if _course is not null then
    perform pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(_course::text));
    -- Read again under the lock.
    select * into _b from bulletin where id = p_bulletin_id for update;
  end if;
  if _b.id is null then
    raise exception 'bulletin not found' using errcode = 'P0002';
  elsif _b.posted_at is null then
    raise exception 'a bulletin students cannot see yet cannot be shown again' using errcode = '22023';
  end if;
  update bulletin set shown_again_at = now(), updated_at = now() where id = p_bulletin_id;
  _out := jsonb_build_object('bulletin', fv_private.bulletin_json(p_bulletin_id));
  perform fv_idem_store(p_idempotency_key, 'show_bulletin_again', _out);
  return _out;
end;
$function$;

-- 7. The bucket and who may touch its files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bulletin-files', 'bulletin-files', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists fv_bulletin_files_read on storage.objects;
create policy fv_bulletin_files_read on storage.objects for select to authenticated
  using (bucket_id = 'bulletin-files' and fv_private.bulletin_file_read_allowed(name));
drop policy if exists fv_bulletin_files_upload on storage.objects;
create policy fv_bulletin_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'bulletin-files' and fv_private.bulletin_file_upload_allowed(name));
drop policy if exists fv_bulletin_files_teachers_only on storage.objects;
create policy fv_bulletin_files_teachers_only on storage.objects as restrictive for all to public
  using (bucket_id is distinct from 'bulletin-files' or current_user = 'authenticated')
  with check (bucket_id is distinct from 'bulletin-files' or current_user = 'authenticated');
drop policy if exists fv_bulletin_files_fence on storage.objects;
create policy fv_bulletin_files_fence on storage.objects as restrictive for all to authenticated
  using (bucket_id is distinct from 'bulletin-files' or fv_private.bulletin_file_read_allowed(name))
  with check (bucket_id is distinct from 'bulletin-files' or fv_private.bulletin_file_upload_allowed(name));

-- 8. Who can run what
do $grants$
declare
  _p regprocedure;
begin
  for _p in select p.oid from pg_proc p where p.proname = any (string_to_array(current_setting('fv.b1a'), ','))
               and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', _p);
    -- The teacher's seven, and the two the storage policies call.
    if _p::text ~ '^(list_bulletins|post_bulletin|finish_bulletin_file|edit_bulletin|delete_bulletin|list_bulletin_seen|show_bulletin_again)\('
     or _p::text ~ '^fv_private\.bulletin_file_(upload|read)_allowed\(' then
      execute format('grant execute on function %s to authenticated', _p);
    end if;
  end loop;
end
$grants$;

-- 9. Everything came out as written
do $final$
begin
  if (select md5(string_agg(p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text))
     from pg_proc p where p.proname = any (string_to_array(current_setting('fv.b1a'), ','))
        and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace)) is distinct from '3cdbfe6ce2a43145f01c101ef5377a7f' -- fp:own
   or (select md5(string_agg(polname || polcmd::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname))
      from pg_policy where polrelid = 'storage.objects'::regclass and polname ~ '^fv_bulletin_files_') is distinct from 'f47bbf23863608c3e1310969de4f36ee' -- fp:policies
   or (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass) <> 14
   or not exists (select 1 from storage.buckets where id = 'bulletin-files' and public = false and file_size_limit = 2097152 and allowed_mime_types = array['image/jpeg'])
   or not has_function_privilege('authenticated', 'fv_private.bulletin_file_read_allowed(text)', 'execute')
   or not has_function_privilege('authenticated', 'fv_private.bulletin_file_upload_allowed(text)', 'execute')
   or exists (select 1 from pg_proc p where p.proname = any (string_to_array(current_setting('fv.b1a'), ','))
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
            or (p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$'))))
   or exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('bulletin', 'bulletin_file', 'bulletin_seen', 'bulletin_reaction')
          and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) then
    raise exception 'a function, policy, grant or the bucket did not come out as written. Nothing was changed.';
  end if;
end
$final$;

commit;
