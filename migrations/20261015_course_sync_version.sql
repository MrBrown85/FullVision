-- A version number per class, maintained by the database (2026-10-15).
--
-- docs/class-loading-plan.md, Phase 2. The client will keep a saved copy of
-- each class and ask the server "has this class changed since version N?".
-- That only works if every change to a class's data moves its version.
--
-- course_sync_cursor already had per-class timestamps, but:
--   * they were set with now(), the transaction start time, so two
--     overlapping writers could leave the cursor earlier than it was;
--   * about twenty tables never touched it: the learning map, rubrics,
--     assessment tags, modules, notes, custom tags, observation joins and
--     the term-rating children;
--   * _touch_course_sync_cursor was executable by any signed-in user for
--     any class.
--
-- version only goes up: it is incremented under the cursor row's lock, so
-- writers to one class are serialized and each committed change gets a new
-- number. Clients compare it for equality. The timestamps keep updating for
-- clients that still compare them.

alter table public.course_sync_cursor add column if not exists version bigint not null default 0;

create or replace function public._touch_course_sync_cursor(p_course_id uuid, p_bucket text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    if p_course_id is null then
        return;
    end if;

    -- Course already deleted (we are inside its delete cascade): nothing to touch.
    if not exists (select 1 from public.course where id = p_course_id) then
        return;
    end if;

    insert into public.course_sync_cursor (course_id)
    values (p_course_id)
    on conflict (course_id) do nothing;

    update public.course_sync_cursor
       set version = version + 1,
           gradebook_updated_at =
               case when p_bucket = 'gradebook' then now() else gradebook_updated_at end,
           student_records_updated_at =
               case when p_bucket = 'student-records' then now() else student_records_updated_at end
     where course_id = p_course_id;
end;
$function$;

-- tg_argv[1] names how a row leads to its class. Each branch reads only
-- columns its tables have: a record field that doesn't exist is a runtime
-- error. During a delete cascade the parent may already be gone; the lookup
-- then finds nothing and the parent's own trigger has bumped the class.
create or replace function public._touch_course_sync_cursor_from_trigger()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _bucket    text := coalesce(tg_argv[0], 'gradebook');
    _source    text := coalesce(tg_argv[1], 'course');
    _course_id uuid;
    _student_id uuid;
    _row       record;
begin
    if _source = 'student' then
        _student_id := coalesce(new.id, old.id);
        for _row in
            select distinct e.course_id
              from public.enrollment e
             where e.student_id = _student_id
        loop
            perform public._touch_course_sync_cursor(_row.course_id, _bucket);
        end loop;
        return coalesce(new, old);
    end if;

    if _source = 'course' then
        if tg_table_name = 'course' then
            if tg_op = 'DELETE' then
                return old;
            end if;
            _course_id := coalesce(new.id, old.id);
        else
            _course_id := coalesce(new.course_id, old.course_id);
        end if;
    elsif _source = 'assessment' then
        select a.course_id into _course_id
          from public.assessment a
         where a.id = coalesce(new.assessment_id, old.assessment_id);
    elsif _source = 'section' then
        select s.course_id into _course_id
          from public.section s
         where s.id = coalesce(new.section_id, old.section_id);
    elsif _source = 'rubric' then
        select r.course_id into _course_id
          from public.rubric r
         where r.id = coalesce(new.rubric_id, old.rubric_id);
    elsif _source = 'criterion' then
        select r.course_id into _course_id
          from public.criterion c
          join public.rubric r on r.id = c.rubric_id
         where c.id = coalesce(new.criterion_id, old.criterion_id);
    elsif _source = 'observation' then
        select o.course_id into _course_id
          from public.observation o
         where o.id = coalesce(new.observation_id, old.observation_id);
    elsif _source = 'term_rating' then
        select e.course_id into _course_id
          from public.term_rating tr
          join public.enrollment e on e.id = tr.enrollment_id
         where tr.id = coalesce(new.term_rating_id, old.term_rating_id);
    else
        select e.course_id into _course_id
          from public.enrollment e
         where e.id = coalesce(new.enrollment_id, old.enrollment_id, new.id, old.id);
    end if;

    perform public._touch_course_sync_cursor(_course_id, _bucket);
    return coalesce(new, old);
end;
$function$;

-- Tables that change a class but never touched its cursor.
do $$
declare
    _t record;
begin
    for _t in
        select * from (values
            ('module',                  'gradebook',       'course'),
            ('subject',                 'gradebook',       'course'),
            ('competency_group',        'gradebook',       'course'),
            ('section',                 'gradebook',       'course'),
            ('tag',                     'gradebook',       'section'),
            ('assessment_tag',          'gradebook',       'assessment'),
            ('rubric',                  'gradebook',       'course'),
            ('criterion',               'gradebook',       'rubric'),
            ('criterion_tag',           'gradebook',       'criterion'),
            ('note',                    'student-records', 'enrollment'),
            ('custom_tag',              'student-records', 'course'),
            ('observation_template',    'student-records', 'course'),
            ('observation_student',     'student-records', 'observation'),
            ('observation_tag',         'student-records', 'observation'),
            ('observation_custom_tag',  'student-records', 'observation'),
            ('term_rating_dimension',   'student-records', 'term_rating'),
            ('term_rating_strength',    'student-records', 'term_rating'),
            ('term_rating_growth_area', 'student-records', 'term_rating'),
            ('term_rating_assessment',  'student-records', 'term_rating'),
            ('term_rating_observation', 'student-records', 'term_rating')
        ) as v(tbl, bucket, source)
    loop
        execute format('drop trigger if exists %I on public.%I',
                       'course_sync_cursor_' || _t.tbl || '_' || replace(_t.bucket, '-', '_'), _t.tbl);
        execute format(
            'create trigger %I after insert or update or delete on public.%I '
            'for each row execute function public._touch_course_sync_cursor_from_trigger(%L, %L)',
            'course_sync_cursor_' || _t.tbl || '_' || replace(_t.bucket, '-', '_'), _t.tbl, _t.bucket, _t.source);
    end loop;
end;
$$;

-- Only triggers call these. Trigger functions don't check EXECUTE when they
-- fire, and _touch_course_sync_cursor runs as the definer's role.
revoke execute on function public._touch_course_sync_cursor(uuid, text) from public, anon, authenticated;
revoke execute on function public._touch_course_sync_cursor_from_trigger() from public, anon, authenticated;

notify pgrst, 'reload schema';
