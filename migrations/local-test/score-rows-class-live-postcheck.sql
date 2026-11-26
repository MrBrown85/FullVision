-- Read-only post-check, after the apply of migrations/2026112602_score_rows_carry_their_class.sql (S0-M6).
-- SELECTs only. Every row should say ok. Works with or without public on the search path.
with tables(t) as (values ('score'), ('tag_score'), ('rubric_score'), ('rubric_check_score'), ('dibels_score')),
keys(t, k) as (select t, k from tables cross join (values ('enrollment'), ('assessment')) v(k)),
checks(check_name, ok) as (
    select 'column ' || tables.t || '.course_id, a nullable uuid',
           exists (select 1 from pg_attribute a where a.attrelid = ('public.' || tables.t)::regclass and a.attname = 'course_id'
                      and not a.attisdropped and a.atttypid = 'uuid'::regtype and not a.attnotnull)
      from tables
    union all
    select 'key ' || keys.t || '_' || keys.k || '_id_fkey carries the class',
           (select replace(pg_get_constraintdef(c.oid), 'public.', '') from pg_constraint c
             where c.conrelid = ('public.' || keys.t)::regclass and c.conname = keys.t || '_' || keys.k || '_id_fkey')
           = format('FOREIGN KEY (%s_id, course_id) REFERENCES %s(id, course_id) MATCH FULL ON DELETE CASCADE', keys.k, keys.k)
      from keys
    union all
    select 'unique key ' || u.n,
           exists (select 1 from pg_constraint c where c.conname = u.n and c.contype = 'u' and c.conrelid = u.rel::regclass
                      and replace(pg_get_constraintdef(c.oid), ' ', '') = 'UNIQUE(id,course_id)')
      from (values ('enrollment_id_course_uk', 'public.enrollment'), ('assessment_id_course_uk', 'public.assessment')) u(n, rel)
    union all
    select 'trigger ' || w.tbl || '.' || w.trg || ', as the file makes it, switched on',
           exists (select 1 from pg_trigger t where t.tgrelid = ('public.' || w.tbl)::regclass and t.tgname = w.trg and t.tgenabled = 'O'
                      and replace(pg_get_triggerdef(t.oid), 'public.', '') = w.def)
      from (values
                   ('criterion_check', 'criterion_check_class_fixed', 'CREATE TRIGGER criterion_check_class_fixed BEFORE UPDATE OF criterion_id ON criterion_check FOR EACH ROW WHEN ((old.criterion_id IS DISTINCT FROM new.criterion_id)) EXECUTE FUNCTION _class_is_fixed(''checkbox'')'),
                   ('criterion', 'criterion_class_fixed', 'CREATE TRIGGER criterion_class_fixed BEFORE UPDATE OF rubric_id ON criterion FOR EACH ROW WHEN ((old.rubric_id IS DISTINCT FROM new.rubric_id)) EXECUTE FUNCTION _class_is_fixed(''criterion'')'),
                   ('dibels_score', 'dibels_score_class', 'CREATE TRIGGER dibels_score_class BEFORE INSERT OR UPDATE OF enrollment_id, course_id ON dibels_score FOR EACH ROW EXECUTE FUNCTION _score_row_class()'),
                   ('rubric_check_score', 'rubric_check_score_class', 'CREATE TRIGGER rubric_check_score_class BEFORE INSERT OR UPDATE OF enrollment_id, course_id ON rubric_check_score FOR EACH ROW EXECUTE FUNCTION _score_row_class()'),
                   ('rubric_check_score', 'rubric_check_score_class_parent', 'CREATE TRIGGER rubric_check_score_class_parent AFTER INSERT OR UPDATE OF check_id, enrollment_id, course_id ON rubric_check_score FOR EACH ROW EXECUTE FUNCTION _score_row_parent_class()'),
                   ('rubric', 'rubric_class_fixed', 'CREATE TRIGGER rubric_class_fixed BEFORE UPDATE OF course_id ON rubric FOR EACH ROW WHEN ((old.course_id IS DISTINCT FROM new.course_id)) EXECUTE FUNCTION _class_is_fixed(''rubric'')'),
                   ('rubric_score', 'rubric_score_class', 'CREATE TRIGGER rubric_score_class BEFORE INSERT OR UPDATE OF enrollment_id, course_id ON rubric_score FOR EACH ROW EXECUTE FUNCTION _score_row_class()'),
                   ('rubric_score', 'rubric_score_class_parent', 'CREATE TRIGGER rubric_score_class_parent AFTER INSERT OR UPDATE OF criterion_id, enrollment_id, course_id ON rubric_score FOR EACH ROW EXECUTE FUNCTION _score_row_parent_class()'),
                   ('score', 'score_class', 'CREATE TRIGGER score_class BEFORE INSERT OR UPDATE OF enrollment_id, course_id ON score FOR EACH ROW EXECUTE FUNCTION _score_row_class()'),
                   ('section', 'section_class_fixed', 'CREATE TRIGGER section_class_fixed BEFORE UPDATE OF course_id ON section FOR EACH ROW WHEN ((old.course_id IS DISTINCT FROM new.course_id)) EXECUTE FUNCTION _class_is_fixed(''section'')'),
                   ('tag', 'tag_class_fixed', 'CREATE TRIGGER tag_class_fixed BEFORE UPDATE OF section_id ON tag FOR EACH ROW WHEN ((old.section_id IS DISTINCT FROM new.section_id)) EXECUTE FUNCTION _class_is_fixed(''competency'')'),
                   ('tag_score', 'tag_score_class', 'CREATE TRIGGER tag_score_class BEFORE INSERT OR UPDATE OF enrollment_id, course_id ON tag_score FOR EACH ROW EXECUTE FUNCTION _score_row_class()'),
                   ('tag_score', 'tag_score_class_parent', 'CREATE TRIGGER tag_score_class_parent AFTER INSERT OR UPDATE OF tag_id, enrollment_id, course_id ON tag_score FOR EACH ROW EXECUTE FUNCTION _score_row_parent_class()')) w(tbl, trg, def)
    union all
    select 'every trigger on the five tables switched on',
           not exists (select 1 from pg_trigger t join tables on t.tgrelid = ('public.' || tables.t)::regclass
                        where not t.tgisinternal and t.tgenabled <> 'O')
    union all
    select 'function ' || f.sig || ': no client role may run it',
           to_regprocedure(f.sig) is not null
           and not has_function_privilege('anon', to_regprocedure(f.sig), 'execute')
           and not has_function_privilege('authenticated', to_regprocedure(f.sig), 'execute')
           and not has_function_privilege('service_role', to_regprocedure(f.sig), 'execute')
      from (values ('public._score_row_class()'), ('public._score_row_parent_class()'), ('public._class_is_fixed()')) f(sig)
    union all
    select 'every score row has its student''s class',
           not exists (select 1 from public.score x join public.enrollment e on e.id = x.enrollment_id where x.course_id is distinct from e.course_id)
    union all
    select 'every tag_score row has its student''s class',
           not exists (select 1 from public.tag_score x join public.enrollment e on e.id = x.enrollment_id where x.course_id is distinct from e.course_id)
    union all
    select 'every rubric_score row has its student''s class',
           not exists (select 1 from public.rubric_score x join public.enrollment e on e.id = x.enrollment_id where x.course_id is distinct from e.course_id)
    union all
    select 'every rubric_check_score row has its student''s class',
           not exists (select 1 from public.rubric_check_score x join public.enrollment e on e.id = x.enrollment_id where x.course_id is distinct from e.course_id)
    union all
    select 'every dibels_score row has its student''s class',
           not exists (select 1 from public.dibels_score x join public.enrollment e on e.id = x.enrollment_id where x.course_id is distinct from e.course_id)
)
select check_name, case when ok then 'ok' else 'NOT OK' end as result from checks order by check_name collate "C";
