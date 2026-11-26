-- Read-only pre-check, before the apply of migrations/2026112602_score_rows_carry_their_class.sql (S0-M6).
-- SELECTs only. It returns the rows that differ from what the file was written and tested against, and
-- five count rows, "count: <table>", the rows that get their class (no other part of any row changes).
-- Only the five count rows means ready. Any other row names what would stop the file, or what it was not
-- tested against. Works with or without public on the search path.
with tables(t) as (values ('score'), ('tag_score'), ('rubric_score'), ('rubric_check_score'), ('dibels_score')),
keys(t, k) as (select t, k from tables cross join (values ('enrollment'), ('assessment')) v(k)),
checks(check_name, value) as (
    -- Rows that name another class than their student's: the file stops on any of them.
    select 'cross-class: score, assessment', count(*)::text from public.score x
      join public.enrollment e on e.id = x.enrollment_id join public.assessment a on a.id = x.assessment_id
     where a.course_id <> e.course_id having count(*) > 0
    union all
    select 'cross-class: tag_score, assessment', count(*)::text from public.tag_score x
      join public.enrollment e on e.id = x.enrollment_id join public.assessment a on a.id = x.assessment_id
     where a.course_id <> e.course_id having count(*) > 0
    union all
    select 'cross-class: rubric_score, assessment', count(*)::text from public.rubric_score x
      join public.enrollment e on e.id = x.enrollment_id join public.assessment a on a.id = x.assessment_id
     where a.course_id <> e.course_id having count(*) > 0
    union all
    select 'cross-class: rubric_check_score, assessment', count(*)::text from public.rubric_check_score x
      join public.enrollment e on e.id = x.enrollment_id join public.assessment a on a.id = x.assessment_id
     where a.course_id <> e.course_id having count(*) > 0
    union all
    select 'cross-class: dibels_score, assessment', count(*)::text from public.dibels_score x
      join public.enrollment e on e.id = x.enrollment_id join public.assessment a on a.id = x.assessment_id
     where a.course_id <> e.course_id having count(*) > 0
    union all
    select 'cross-class: tag_score, competency', count(*)::text from public.tag_score x
      join public.enrollment e on e.id = x.enrollment_id join public.tag t on t.id = x.tag_id
      join public.section s on s.id = t.section_id
     where s.course_id <> e.course_id having count(*) > 0
    union all
    select 'cross-class: rubric_score, criterion', count(*)::text from public.rubric_score x
      join public.enrollment e on e.id = x.enrollment_id join public.criterion c on c.id = x.criterion_id
      join public.rubric r on r.id = c.rubric_id
     where r.course_id <> e.course_id having count(*) > 0
    union all
    select 'cross-class: rubric_check_score, checkbox', count(*)::text from public.rubric_check_score x
      join public.enrollment e on e.id = x.enrollment_id join public.criterion_check k on k.id = x.check_id
      join public.criterion c on c.id = k.criterion_id join public.rubric r on r.id = c.rubric_id
     where r.course_id <> e.course_id having count(*) > 0
    union all
    -- The shape the file was written for.
    select 'key ' || keys.t || '_' || keys.k || '_id_fkey', coalesce(replace(pg_get_constraintdef(c.oid), 'public.', ''), 'missing')
      from keys left join pg_constraint c on c.conrelid = ('public.' || keys.t)::regclass and c.conname = keys.t || '_' || keys.k || '_id_fkey'
     where replace(pg_get_constraintdef(c.oid), 'public.', '') is distinct from format('FOREIGN KEY (%s_id) REFERENCES %s(id) ON DELETE CASCADE', keys.k, keys.k)
    union all
    select 'another key to enrollment or assessment', c.conrelid::regclass::text || '.' || c.conname
      from pg_constraint c join tables on c.conrelid = ('public.' || tables.t)::regclass
     where c.contype = 'f' and c.confrelid in ('public.enrollment'::regclass, 'public.assessment'::regclass)
       and c.conname not in (tables.t || '_enrollment_id_fkey', tables.t || '_assessment_id_fkey')
    union all
    select 'can be null: ' || c.relname || '.' || a.attname, 'nullable'
      from pg_class c join pg_attribute a on a.attrelid = c.oid join tables on c.oid = ('public.' || tables.t)::regclass
     where a.attname in ('enrollment_id', 'assessment_id') and not a.attnotnull
    union all
    select 'already there: column ' || c.relname || '.course_id', format_type(a.atttypid, a.atttypmod)
      from pg_class c join pg_attribute a on a.attrelid = c.oid join tables on c.oid = ('public.' || tables.t)::regclass
     where a.attname = 'course_id' and not a.attisdropped
    union all
    select 'trigger not in its normal state', t.tgrelid::regclass::text || '.' || t.tgname || ' ' || t.tgenabled::text
      from pg_trigger t join tables on t.tgrelid = ('public.' || tables.t)::regclass
     where not t.tgisinternal and t.tgenabled <> 'O'
    union all
    select 'already there: trigger', t.tgrelid::regclass::text || '.' || t.tgname
      from pg_trigger t
     where t.tgname in ('score_class', 'tag_score_class', 'rubric_score_class', 'rubric_check_score_class', 'dibels_score_class',
                        'tag_score_class_parent', 'rubric_score_class_parent', 'rubric_check_score_class_parent',
                        'section_class_fixed', 'rubric_class_fixed', 'tag_class_fixed', 'criterion_class_fixed', 'criterion_check_class_fixed')
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_score_row_class', '_score_row_parent_class', '_class_is_fixed')
    union all
    select 'already there: constraint ' || c.conname, c.conrelid::regclass::text
      from pg_constraint c where c.conname in ('enrollment_id_course_uk', 'assessment_id_course_uk')
    union all
    -- ALTER TABLE ... DISABLE TRIGGER and the new keys need the tables' owner; the move trigger reads course as its owner.
    select 'not the owner: ' || c.relname, c.relowner::regrole::text || ', not ' || current_user
      from pg_class c
     where c.oid in ('public.score'::regclass, 'public.tag_score'::regclass, 'public.rubric_score'::regclass,
                     'public.rubric_check_score'::regclass, 'public.dibels_score'::regclass, 'public.enrollment'::regclass,
                     'public.assessment'::regclass, 'public.section'::regclass, 'public.tag'::regclass, 'public.rubric'::regclass,
                     'public.criterion'::regclass, 'public.criterion_check'::regclass, 'public.course'::regclass)
       and not pg_has_role(current_user, c.relowner, 'usage')
    union all
    select 'deadlock_timeout under 500 ms', current_setting('deadlock_timeout')
     where current_setting('deadlock_timeout')::interval < interval '500 milliseconds'
    union all
    select 'server version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17
    union all
    -- How many rows get their class.
    select 'count: score', count(*)::text from public.score
    union all select 'count: tag_score', count(*)::text from public.tag_score
    union all select 'count: rubric_score', count(*)::text from public.rubric_score
    union all select 'count: rubric_check_score', count(*)::text from public.rubric_check_score
    union all select 'count: dibels_score', count(*)::text from public.dibels_score
)
select check_name, value from checks order by check_name collate "C", value collate "C";
