-- A points assessment can show students its score times its Factor (2026-11-18).
--
-- THIS FILE DELETES NOTHING AND CHANGES NO EXISTING ROW. It adds one column,
-- public.assessment.students_see_factored (false on every row there now:
-- students see the score as entered, as today), gives create_assessment one
-- more parameter, and replaces five functions, each the live definition with
-- students_see_factored added and nothing else changed.
--
-- -- What was missing, and why ----------------------------------------------
-- Teachers, Nov 18: an assignment out of 6 at Factor 4x counts as 24 points
-- in the course %, and the teacher wants the student to see "20 / 24", not
-- "5 / 6". The score as entered (5 / 6) stays the only stored score and what
-- the teacher grades in; the factored score is worked out for display only,
-- in shared/calc.js. Nothing about the course % changes.
--
-- -- What it does -----------------------------------------------------------
-- 1. assessment.students_see_factored boolean not null default false.
-- 2. create_assessment(... , p_is_draft, p_students_see_factored boolean
--    default false). The old signature is dropped in the same transaction,
--    so there is still exactly one. The app sends it only when it is true.
-- 3. update_assessment takes students_see_factored in p_patch (a JSON true
--    or false; anything else: 22023).
-- 4. get_class_bundle and get_gradebook send 'students_see_factored' on each
--    assessment; duplicate_assessment copies it.
-- 5. student_submit.page sends 'students_see_factored' on each piece it
--    already lists. It sends nothing it did not send before: the piece's
--    max_points and weight were already there.
--
-- Left alone: import_json_restore and import_teams_class (a restored or
-- imported piece starts with it off, as every piece did before this file).
--
-- -- The checks it makes first ----------------------------------------------
-- It stops with nothing changed unless every function it replaces is the
-- live definition (migrations/baseline/function-md5.txt, Nov 18) or this
-- file's (a second run). md5 of pg_get_functiondef on PostgreSQL 17:
--   function                                   before                            after
--   public.create_assessment (old, dropped)    2852ea5862f02785711a2d8125b5fadf
--   public.create_assessment (new)                                               c8389c88180a9e4d4f36200b5ff94270
--   public.update_assessment                   c48044d5e0d902e3e5a6fef63cb74049  adb8a2212c88e31e81833efad294ebe3
--   public.get_class_bundle                    ed59fcd4ef9bc85c6e5bcc24c3fdd608  c3f21f882ec87368e9584976bc5ca122
--   public.get_gradebook                       08d83934dcacbf14ddfce6ec6cf9068b  0ca28a1e62ef28fd30e9312e61346041
--   public.duplicate_assessment                91fb43611f5a93739c32e2ee8cbcc7d2  3797369592647effba25aaedaa9f18d6
--   student_submit.page                        9e16e8aaa8f1379beca4f64d4111fa1d  4a255085ecbe97a940225744f4153ce4
--
-- -- Order with the app -----------------------------------------------------
-- Apply before the app that sends p_students_see_factored is released: on
-- the database without this file a create with it fails (no such function).
-- update_assessment without this file ignores the key, so an update is safe
-- either way. The app in teachers' browsers now never sends it.
--
-- get_class_bundle's own comments had box-drawing characters; they are
-- written with plain hyphens here (comments only), so the file is plain
-- ASCII (tests/migrations-route-safe.test.js). Its md5 differs for that alone.
--
-- Tested on a throwaway PostgreSQL 17 rebuilt from the repo and proved equal
-- to live (scripts/db-rebuild.mjs --check), with the security rule tests
-- (tests/db/run.mjs, FV_DB_TEST_APPLY=this file): all passed.
-- Undo: migrations/local-test/factored-score-undo.sql.
--
-- One transaction: all or nothing.

begin;

set local lock_timeout = '5s';

-- -- 1. The checks, before anything changes ---------------------------------
do $guard$
declare
    _f    record;
    _md5  text;
    _old  text := md5(pg_get_functiondef(to_regprocedure('public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean)')));
    _new  text := md5(pg_get_functiondef(to_regprocedure('public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean,boolean)')));
    _col  record;
begin
    for _f in select * from (values
        ('public.update_assessment(uuid,jsonb,uuid[])', 'c48044d5e0d902e3e5a6fef63cb74049', 'adb8a2212c88e31e81833efad294ebe3'),
        ('public.get_class_bundle(uuid,bigint)',        'ed59fcd4ef9bc85c6e5bcc24c3fdd608', 'c3f21f882ec87368e9584976bc5ca122'),
        ('public.get_gradebook(uuid)',                  '08d83934dcacbf14ddfce6ec6cf9068b', '0ca28a1e62ef28fd30e9312e61346041'),
        ('public.duplicate_assessment(uuid,uuid)',      '91fb43611f5a93739c32e2ee8cbcc7d2', '3797369592647effba25aaedaa9f18d6'),
        ('student_submit.page(text,uuid,text)',         '9e16e8aaa8f1379beca4f64d4111fa1d', '4a255085ecbe97a940225744f4153ce4')) v(sig, live, mine)
    loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.sig)));
        if _md5 is null or (_md5 <> _f.live and _md5 <> _f.mine) then
            raise exception '% is not the definition this file was written against (found %, expected %). Nothing was changed.',
                _f.sig, coalesce(_md5, 'absent'), _f.live;
        end if;
    end loop;
    if not ((_old = '2852ea5862f02785711a2d8125b5fadf' and _new is null) or (_old is null and _new = 'c8389c88180a9e4d4f36200b5ff94270')) then
        raise exception 'create_assessment is not as this file expects (old signature %, new signature %). Nothing was changed.',
            coalesce(_old, 'absent'), coalesce(_new, 'absent');
    end if;
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'create_assessment') <> 1 then
        raise exception 'there is more than one create_assessment. Nothing was changed.';
    end if;
    select a.atttypid::regtype::text as t, a.attnotnull as nn, pg_get_expr(d.adbin, d.adrelid) as def into _col
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.assessment'::regclass and a.attname = 'students_see_factored' and not a.attisdropped;
    if found and not (_col.t = 'boolean' and _col.nn and _col.def = 'false') then
        raise exception 'assessment.students_see_factored exists and is not boolean not null default false. Nothing was changed.';
    end if;
end
$guard$;

-- -- 2. The column. Every row there now shows the score as entered: false. --
-- A constant default: PostgreSQL 11 and later add it without rewriting the table.
alter table public.assessment add column if not exists students_see_factored boolean not null default false;

comment on column public.assessment.students_see_factored is
    'Points work: students see the score times the Factor ("20 / 24" for 5 / 6 at 4x). Display only; the stored score is the one entered.';

-- -- 3. create_assessment, plus p_students_see_factored ---------------------
drop function if exists public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean);

CREATE OR REPLACE FUNCTION public.create_assessment(p_course_id uuid, p_title text, p_category_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_date_assigned date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_score_mode text DEFAULT 'proficiency'::text, p_max_points numeric DEFAULT NULL::numeric, p_weight numeric DEFAULT 1.0, p_evidence_type text DEFAULT NULL::text, p_rubric_id uuid DEFAULT NULL::uuid, p_module_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT '{}'::uuid[], p_copy_group uuid DEFAULT NULL::uuid, p_core_competency_ids text[] DEFAULT '{}'::text[], p_idempotency_key uuid DEFAULT NULL::uuid, p_is_draft boolean DEFAULT false, p_students_see_factored boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _id       uuid;
    _next_pos int;
    _tag      uuid;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = p_course_id
       and module_id is not distinct from p_module_id;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, display_order, copy_group, core_competency_ids, is_draft, students_see_factored)
    values (p_course_id, p_category_id, p_title, p_description, p_date_assigned, p_due_date,
            p_score_mode, p_max_points, p_weight, p_evidence_type,
            p_rubric_id, p_module_id, _next_pos, p_copy_group,
            array(select distinct c from unnest(coalesce(p_core_competency_ids, '{}')) c order by c),
            coalesce(p_is_draft, false), coalesce(p_students_see_factored, false))
    returning id into _id;

    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id)
              values (_id, _tag) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_assessment', jsonb_build_object('id', _id));
    return _id;
end; $function$;

revoke all on function public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean,boolean) from public, anon;
grant execute on function public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean,boolean) to authenticated, service_role;

-- -- 4. update_assessment takes it in p_patch -------------------------------
CREATE OR REPLACE FUNCTION public.update_assessment(p_id uuid, p_patch jsonb, p_tag_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    -- 2026111701: is_draft is true or false. Only false -> true (Unassign) is checked, by the
    -- trigger assessment_draft_guard: refused with draft_has_work while a student has a result or work.
    if p_patch ? 'is_draft' and jsonb_typeof(p_patch->'is_draft') is distinct from 'boolean' then
        raise exception 'is_draft must be true or false' using errcode = '22023';
    end if;
    -- 2026111901: students_see_factored is true or false.
    if p_patch ? 'students_see_factored' and jsonb_typeof(p_patch->'students_see_factored') is distinct from 'boolean' then
        raise exception 'students_see_factored must be true or false' using errcode = '22023';
    end if;

    update assessment set
        title         = coalesce(p_patch->>'title', title),
        description   = case when p_patch ? 'description'   then p_patch->>'description'   else description end,
        category_id   = case when p_patch ? 'category_id'
                             then nullif(p_patch->>'category_id','')::uuid else category_id end,
        date_assigned = case when p_patch ? 'date_assigned'
                             then nullif(p_patch->>'date_assigned','')::date else date_assigned end,
        due_date      = case when p_patch ? 'due_date'
                             then nullif(p_patch->>'due_date','')::date else due_date end,
        score_mode    = coalesce(p_patch->>'score_mode', score_mode),
        max_points    = case when p_patch ? 'max_points'
                             then nullif(p_patch->>'max_points','')::numeric else max_points end,
        weight        = coalesce((p_patch->>'weight')::numeric, weight),
        evidence_type = case when p_patch ? 'evidence_type' then p_patch->>'evidence_type' else evidence_type end,
        rubric_id     = case when p_patch ? 'rubric_id'
                             then nullif(p_patch->>'rubric_id','')::uuid else rubric_id end,
        module_id     = case when p_patch ? 'module_id'
                             then nullif(p_patch->>'module_id','')::uuid else module_id end,
        display_order = case when p_patch ? 'display_order'
                             then (p_patch->>'display_order')::int else display_order end,
        copy_group    = case when p_patch ? 'copy_group'
                             then nullif(p_patch->>'copy_group','')::uuid else copy_group end,
        core_competency_ids = case
                             when not (p_patch ? 'core_competency_ids') then core_competency_ids
                             when jsonb_typeof(p_patch->'core_competency_ids') = 'array'
                             then array(select distinct c
                                          from jsonb_array_elements_text(p_patch->'core_competency_ids') c
                                         order by c)
                             else '{}' end,
        is_draft      = case when p_patch ? 'is_draft'
                             then (p_patch->>'is_draft')::boolean else is_draft end,
        students_see_factored = case when p_patch ? 'students_see_factored'
                             then (p_patch->>'students_see_factored')::boolean else students_see_factored end,
        updated_at    = now()
    where id = p_id;

    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    if p_tag_ids is not null then
        delete from assessment_tag where assessment_id = p_id;
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag)
            on conflict do nothing;
        end loop;
    end if;
end; $function$;

-- -- 5. The teacher's reads send it; Duplicate copies it --------------------
CREATE OR REPLACE FUNCTION public.get_class_bundle(p_course_id uuid, p_if_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
    _course public.course%rowtype;
    _version bigint;
    _gradebook jsonb;
    _learning_map jsonb;
    _rubrics jsonb;
    _observations jsonb;
    _profiles jsonb;
    _term_ratings jsonb;
    _report_config jsonb;
    _custom_tags jsonb;
    _observation_templates jsonb;
    _course_config jsonb;
    _withdrawn jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- The only access check: everything below reads by p_course_id.
    select * into _course from public.course
     where id = p_course_id and teacher_id = (select auth.uid()) and deleted_at is null;
    if not found then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;

    select coalesce((select version from public.course_sync_cursor where course_id = p_course_id), 0) into _version;
    if p_if_version is not null and p_if_version = _version then
        return jsonb_build_object('not_modified', true, 'version', _version);
    end if;

    -- -- Gradebook: get_gradebook's roster, assessments, categories and
    --    modules, with scores as compact rows instead of `cells`.
    with
    enr as (
        select e.*, s.first_name, s.last_name, s.preferred_name, s.pronouns,
               s.student_number, s.email, s.date_of_birth,
               (row_number() over (order by e.roster_position, s.last_name, s.first_name, e.id) - 1)::int as ix
          from public.enrollment e join public.student s on s.id = e.student_id
         where e.course_id = p_course_id and e.withdrawn_at is null
    ),
    asm as (
        select a.*, (row_number() over (order by a.display_order, a.created_at, a.id) - 1)::int as ix
          from public.assessment a where a.course_id = p_course_id
    ),
    tg as (
        select t.id, (row_number() over (order by t.id) - 1)::int as ix
          from public.tag t join public.section sec on sec.id = t.section_id
         where sec.course_id = p_course_id
    ),
    cr as (
        select c.id, (row_number() over (order by c.id) - 1)::int as ix
          from public.criterion c join public.rubric r on r.id = c.rubric_id
         where r.course_id = p_course_id
    ),
    ck as (
        select ck.id, (row_number() over (order by ck.id) - 1)::int as ix
          from public.criterion_check ck
          join public.criterion c on c.id = ck.criterion_id
          join public.rubric r on r.id = c.rubric_id
         where r.course_id = p_course_id
    ),
    asm_tags as (
        select at.assessment_id, jsonb_agg(at.tag_id order by t.display_order, t.label) as tag_ids
          from public.assessment_tag at
          join public.tag t on t.id = at.tag_id
          join asm on asm.id = at.assessment_id
         group by at.assessment_id
    )
    select jsonb_build_object(
        'course', to_jsonb(_course),
        'students', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'enrollment_id', enr.id, 'student_id', enr.student_id,
                       'first_name', enr.first_name, 'last_name', enr.last_name,
                       'preferred_name', enr.preferred_name, 'pronouns', enr.pronouns,
                       'student_number', enr.student_number, 'email', enr.email,
                       'date_of_birth', enr.date_of_birth, 'designations', enr.designations,
                       'enrolled_at', enr.enrolled_at, 'roster_position', enr.roster_position,
                       'is_flagged', enr.is_flagged
                   ) order by enr.ix)
              from enr), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', asm.id, 'title', asm.title, 'description', asm.description,
                       'category_id', asm.category_id, 'score_mode', asm.score_mode,
                       'max_points', asm.max_points, 'weight', asm.weight,
                       'evidence_type', asm.evidence_type, 'rubric_id', asm.rubric_id,
                       'module_id', asm.module_id, 'collab_mode', asm.collab_mode,
                       'collab_config', asm.collab_config, 'has_rubric', asm.rubric_id is not null,
                       'date_assigned', asm.date_assigned, 'due_date', asm.due_date,
                       'display_order', asm.display_order,
                       'tag_ids', coalesce(asm_tags.tag_ids, '[]'::jsonb),
                       'copy_group', asm.copy_group,
                       'core_competency_ids', to_jsonb(asm.core_competency_ids),
                       'created_at', asm.created_at,
                       'is_draft', asm.is_draft,
                       'students_see_factored', asm.students_see_factored
                   ) order by asm.ix)
              from asm left join asm_tags on asm_tags.assessment_id = asm.id), '[]'::jsonb),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                'display_order', c.display_order, 'calc_mode', c.calc_mode) order by c.display_order)
              from public.category c where c.course_id = p_course_id), '[]'::jsonb),
        'modules', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'course_id', m.course_id, 'name', m.name,
                                                'color', m.color, 'display_order', m.display_order,
                                                'created_at', m.created_at, 'updated_at', m.updated_at)
                             order by m.display_order)
              from public.module m where m.course_id = p_course_id), '[]'::jsonb),
        -- Positions in tag_rows and criterion_rows point into these.
        'tag_index', coalesce((select jsonb_agg(tg.id order by tg.ix) from tg), '[]'::jsonb),
        'criterion_index', coalesce((select jsonb_agg(cr.id order by cr.ix) from cr), '[]'::jsonb),
        'check_index', coalesce((select jsonb_agg(ck.id order by ck.ix) from ck), '[]'::jsonb),
        -- [student, assessment, value, status, comment, modifier, report_note]
        'score_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment, s.modifier, s.report_note))
              from public.score s
              join enr on enr.id = s.enrollment_id
              join asm on asm.id = s.assessment_id), '[]'::jsonb),
        -- [student, assessment, tag, value, modifier, comment]
        'tag_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, tg.ix, t.value, t.modifier, t.comment))
              from public.tag_score t
              join enr on enr.id = t.enrollment_id
              join asm on asm.id = t.assessment_id
              join tg on tg.id = t.tag_id), '[]'::jsonb),
        -- [student, assessment, criterion, value, modifier, comment, beyond]
        'criterion_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond))
              from public.rubric_score r
              join enr on enr.id = r.enrollment_id
              join asm on asm.id = r.assessment_id
              join cr on cr.id = r.criterion_id), '[]'::jsonb),
        -- [student, assessment, check]: a ticked checkbox (rubric_check_score)
        'check_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, ck.ix))
              from public.rubric_check_score x
              join enr on enr.id = x.enrollment_id
              join asm on asm.id = x.assessment_id
              join ck on ck.id = x.check_id), '[]'::jsonb),
        -- [student, assessment, printed_at, hash]: a printed rubric (rubric_print)
        'print_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, p.printed_at, p.content_hash))
              from public.rubric_print p
              join enr on enr.id = p.enrollment_id
              join asm on asm.id = p.assessment_id), '[]'::jsonb)
    ) into _gradebook;

    -- -- Learning map: same shape as get_learning_map, without the per-tag
    --    class_avg and coverage_count (the client computes its own).
    with
    sections_with_tags as (
        select s.id as section_id, s.subject_id, s.name, s.display_order, s.competency_group_id,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'code', t.code, 'label', t.label, 'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text, 'bank_id', t.bank_id,
                   'display_order', t.display_order
               ) order by t.display_order, t.label) filter (where t.id is not null), '[]'::jsonb) as tags
          from public.section s
          left join public.tag t on t.section_id = s.id
         where s.course_id = p_course_id and s.removed_at is null
         group by s.id, s.subject_id, s.name, s.display_order, s.competency_group_id
    ),
    subjects_with_sections as (
        select subj.id, subj.name, subj.display_order,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id', sec.section_id, 'name', sec.name, 'display_order', sec.display_order,
                   'competency_group_id', sec.competency_group_id, 'tags', sec.tags
               ) order by sec.display_order, sec.name) filter (where sec.section_id is not null), '[]'::jsonb) as sections
          from public.subject subj
          left join sections_with_tags sec on sec.subject_id = subj.id
         where subj.course_id = p_course_id
         group by subj.id, subj.name, subj.display_order
    )
    select jsonb_build_object(
        'competency_groups', coalesce((
            select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                'display_order', cg.display_order,
                                                'counts_as_one', cg.counts_as_one)
                             order by cg.display_order, cg.name)
              from public.competency_group cg where cg.course_id = p_course_id), '[]'::jsonb),
        'subjects', coalesce((
            select jsonb_agg(jsonb_build_object('id', sws.id, 'name', sws.name,
                                                'display_order', sws.display_order, 'sections', sws.sections)
                             order by sws.display_order, sws.name)
              from subjects_with_sections sws), '[]'::jsonb)
    ) into _learning_map;

    -- -- Rubrics: the rows the client read from three tables.
    select jsonb_build_object(
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'created_at', r.created_at,
                                                'copy_group', r.copy_group, 'style', r.style)
                             order by r.created_at, r.id)
              from public.rubric r where r.course_id = p_course_id), '[]'::jsonb),
        'criteria', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'rubric_id', c.rubric_id, 'name', c.name,
                       'level_4_descriptor', c.level_4_descriptor, 'level_3_descriptor', c.level_3_descriptor,
                       'level_2_descriptor', c.level_2_descriptor, 'level_1_descriptor', c.level_1_descriptor,
                       'level_4_value', c.level_4_value, 'level_3_value', c.level_3_value,
                       'level_2_value', c.level_2_value, 'level_1_value', c.level_1_value,
                       'weight', c.weight, 'display_order', c.display_order
                   ) order by c.display_order, c.id)
              from public.criterion c join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'criterion_tags', coalesce((
            select jsonb_agg(jsonb_build_object('criterion_id', ct.criterion_id, 'tag_id', ct.tag_id))
              from public.criterion_tag ct
              join public.criterion c on c.id = ct.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'rubric_tags', coalesce((
            select jsonb_agg(jsonb_build_object('rubric_id', rt.rubric_id, 'tag_id', rt.tag_id))
              from public.rubric_tag rt
              join public.rubric r on r.id = rt.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'criterion_checks', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', ck.id, 'criterion_id', ck.criterion_id, 'level', ck.level,
                       'label', ck.label, 'display_order', ck.display_order
                   ) order by ck.display_order, ck.id)
              from public.criterion_check ck
              join public.criterion c on c.id = ck.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb)
    ) into _rubrics;

    -- -- Observations: the most recent 500, same row shape as
    --    get_observations, plus the total so the client knows what's older.
    with
    obs as (
        select o.* from public.observation o where o.course_id = p_course_id and o.follow_up_of is null
         order by o.created_at desc limit 500
    ),
    os as (
        select observation_id, jsonb_agg(enrollment_id) as ids
          from public.observation_student where observation_id in (select id from obs) group by observation_id
    ),
    ot as (
        select observation_id, jsonb_agg(tag_id) as ids
          from public.observation_tag where observation_id in (select id from obs) group by observation_id
    ),
    oct as (
        select observation_id, jsonb_agg(custom_tag_id) as ids
          from public.observation_custom_tag where observation_id in (select id from obs) group by observation_id
    )
    select jsonb_build_object(
        'observations', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', obs.id, 'body', obs.body, 'sentiment', obs.sentiment,
                       'context_type', obs.context_type, 'assessment_id', obs.assessment_id,
                       'created_at', obs.created_at, 'updated_at', obs.updated_at,
                       'dims', to_jsonb(coalesce(obs.dims, '{}'::text[])),
                       'level', obs.level,
                       'enrollment_ids', coalesce(os.ids, '[]'::jsonb),
                       'tag_ids', coalesce(ot.ids, '[]'::jsonb),
                       'custom_tag_ids', coalesce(oct.ids, '[]'::jsonb)
                   ) order by obs.created_at desc)
              from obs
              left join os on os.observation_id = obs.id
              left join ot on ot.observation_id = obs.id
              left join oct on oct.observation_id = obs.id), '[]'::jsonb),
        'total', (select count(*) from public.observation o where o.course_id = p_course_id and o.follow_up_of is null),
        -- Follow-ups of these observations (2026111703): never one of the observations above.
        'follow_ups', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', f.id, 'follow_up_of', f.follow_up_of, 'kind', f.follow_up_kind, 'body', f.body,
                       'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at)
              from public.observation f where f.follow_up_of in (select id from obs)), '[]'::jsonb)
    ) into _observations;

    -- -- Profiles: same row shape as list_course_student_profiles, without the
    --    computed overall_proficiency / letter / counts and override
    --    'calculated', plus the notes it never returned.
    with
    enr as (
        select e.* from public.enrollment e where e.course_id = p_course_id and e.withdrawn_at is null
    ),
    g as (
        select enrollment_id, jsonb_object_agg(section_id::text, body) as v
          from public.goal where enrollment_id in (select id from enr) group by enrollment_id
    ),
    rf as (
        select enrollment_id, jsonb_object_agg(section_id::text, jsonb_build_object(
                   'confidence', confidence, 'text', body, 'date', updated_at)) as v
          from public.reflection where enrollment_id in (select id from enr) group by enrollment_id
    ),
    so as (
        select enrollment_id, jsonb_object_agg(section_id::text, jsonb_build_object(
                   'level', level, 'reason', reason, 'date', updated_at)) as v
          from public.section_override where enrollment_id in (select id from enr) group by enrollment_id
    ),
    nt as (
        select enrollment_id, jsonb_agg(jsonb_build_object('id', id, 'body', body, 'created_at', created_at)
                                        order by created_at) as v
          from public.note where enrollment_id in (select id from enr) group by enrollment_id
    ),
    recent as (
        select x.enrollment_id, jsonb_agg(jsonb_build_object(
                   'id', x.id, 'text', x.body, 'sentiment', x.sentiment, 'context', x.context_type,
                   'created_at', x.created_at, 'observed_at', x.created_at) order by x.created_at desc) as v
          from (
            select os.enrollment_id, o.id, o.body, o.sentiment, o.context_type, o.created_at,
                   row_number() over (partition by os.enrollment_id order by o.created_at desc) as rn
              from public.observation_student os
              join public.observation o on o.id = os.observation_id
             where o.course_id = p_course_id and os.enrollment_id in (select id from enr)
          ) x
         where x.rn <= 3
         group by x.enrollment_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'student', to_jsonb(s.*),
               'enrollment', to_jsonb(enr.*),
               'goals', coalesce(g.v, '{}'::jsonb),
               'reflections', coalesce(rf.v, '{}'::jsonb),
               'section_overrides', coalesce(so.v, '{}'::jsonb),
               'notes', coalesce(nt.v, '[]'::jsonb),
               'is_flagged', enr.is_flagged,
               'recent_observations', coalesce(recent.v, '[]'::jsonb)
           ) order by enr.roster_position, s.last_name, s.first_name), '[]'::jsonb)
      into _profiles
      from enr
      join public.student s on s.id = enr.student_id
      left join g on g.enrollment_id = enr.id
      left join rf on rf.enrollment_id = enr.id
      left join so on so.enrollment_id = enr.id
      left join nt on nt.enrollment_id = enr.id
      left join recent on recent.enrollment_id = enr.id;

    -- -- Term ratings, which the client never read back before.
    with
    tr as (
        select tr.* from public.term_rating tr
          join public.enrollment e on e.id = tr.enrollment_id
         where e.course_id = p_course_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', tr.enrollment_id, 'term', tr.term,
               'narrative_html', tr.narrative_html,
               'work_habits_rating', tr.work_habits_rating,
               'participation_rating', tr.participation_rating,
               'social_traits', to_jsonb(coalesce(tr.social_traits, '{}'::text[])),
               'habits', coalesce(tr.habits, '{}'::jsonb), 'approved_at', tr.approved_at,
               'reporting_basis', tr.reporting_basis, 'ie_deadline', tr.ie_deadline,
               'draft_meta', tr.draft_meta,
               'created_at', tr.created_at, 'updated_at', tr.updated_at,
               'strength_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_strength x
                                           where x.term_rating_id = tr.id), '[]'::jsonb),
               'growth_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_growth_area x
                                         where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_assessments', coalesce((select jsonb_agg(x.assessment_id) from public.term_rating_assessment x
                                                 where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_observations', coalesce((select jsonb_agg(x.observation_id) from public.term_rating_observation x
                                                  where x.term_rating_id = tr.id), '[]'::jsonb)
           )), '[]'::jsonb)
      into _term_ratings
      from tr;

    select to_jsonb(rc) into _report_config from public.report_config rc where rc.course_id = p_course_id;

    select coalesce(jsonb_agg(ct.label order by ct.label), '[]'::jsonb)
      into _custom_tags
      from public.custom_tag ct where ct.course_id = p_course_id;

    -- The class's sentence starters, in the teacher's order.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', ot.id,
               'body', ot.body,
               'default_sentiment', ot.default_sentiment,
               'default_context_type', ot.default_context_type,
               'default_dims', ot.default_dims,
               'display_order', ot.display_order,
               'use_count', (select count(*) from public.observation o where o.template_id = ot.id)
           ) order by ot.display_order, ot.created_at, ot.id), '[]'::jsonb)
      into _observation_templates
      from public.observation_template ot where ot.teacher_id = (select auth.uid());

    -- Withdrawn students, newest first: who they are and when, nothing
    -- else. Their scores and records stay out of the bundle until re-enrol.
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id, 'student_id', e.student_id,
               'first_name', s.first_name, 'last_name', s.last_name,
               'preferred_name', s.preferred_name, 'pronouns', s.pronouns,
               'student_number', s.student_number, 'email', s.email,
               'date_of_birth', s.date_of_birth, 'designations', e.designations,
               'enrolled_at', e.enrolled_at, 'roster_position', e.roster_position,
               'is_flagged', e.is_flagged, 'withdrawn_at', e.withdrawn_at
           ) order by e.withdrawn_at desc, s.last_name, s.first_name, e.id), '[]'::jsonb)
      into _withdrawn
      from public.enrollment e join public.student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is not null;

    -- Null means the class never saved one.
    _course_config := jsonb_build_object(
        'grading_scale', _course.grading_scale,
        'category_weights', _course.category_weights
    );

    return jsonb_build_object(
        'bundle_schema', 3,
        'version', _version,
        'gradebook', _gradebook,
        'learning_map', _learning_map,
        'rubrics', _rubrics,
        'observations', _observations,
        'profiles', _profiles,
        'term_ratings', _term_ratings,
        'report_config', _report_config,
        'custom_tags', _custom_tags,
        'observation_templates', _observation_templates,
        'course_config', _course_config,
        'withdrawn_students', _withdrawn
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_gradebook(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    course_row course%rowtype;
    students jsonb;
    assessments jsonb;
    categories jsonb;
    modules jsonb;
    cells jsonb;
    summaries jsonb;
begin
    select * into course_row from course where id = p_course_id;
    if not found then raise exception 'course not found or not owned'; end if;

    select jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student_id', s.id,
               'first_name', s.first_name,
               'last_name', s.last_name,
               'preferred_name', s.preferred_name,
               'pronouns', s.pronouns,
               'student_number', s.student_number,
               'email', s.email,
               'date_of_birth', s.date_of_birth,
               'designations', e.designations,
               'enrolled_at', e.enrolled_at,
               'roster_position', e.roster_position,
               'is_flagged', e.is_flagged
           ) order by e.roster_position, s.last_name, s.first_name)
      into students
      from enrollment e join student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is null;

    select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'title', a.title,
               'description', a.description,
               'category_id', a.category_id,
               'score_mode', a.score_mode,
               'max_points', a.max_points,
               'weight', a.weight,
               'evidence_type', a.evidence_type,
               'rubric_id', a.rubric_id,
               'module_id', a.module_id,
               'collab_mode', a.collab_mode,
               'collab_config', a.collab_config,
               'has_rubric', a.rubric_id is not null,
               'date_assigned', a.date_assigned,
               'due_date', a.due_date,
               'display_order', a.display_order,
               'core_competency_ids', to_jsonb(a.core_competency_ids),
               'created_at', a.created_at,
               'is_draft', a.is_draft,
               'students_see_factored', a.students_see_factored,
               'tag_ids', coalesce((
                   select jsonb_agg(at.tag_id order by t.display_order, t.label)
                     from assessment_tag at
                     join tag t on t.id = at.tag_id
                    where at.assessment_id = a.id
               ), '[]'::jsonb)
           ) order by a.display_order, a.created_at)
      into assessments
      from assessment a where a.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', cat.id, 'name', cat.name,
               'weight', cat.weight, 'display_order', cat.display_order, 'calc_mode', cat.calc_mode
           ) order by cat.display_order)
      into categories
      from category cat where cat.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'course_id', m.course_id,
               'name', m.name,
               'color', m.color,
               'display_order', m.display_order,
               'created_at', m.created_at,
               'updated_at', m.updated_at
           ) order by m.display_order)
      into modules
      from module m where m.course_id = p_course_id;

    with pairs as (
        select e.id as eid, a.id as aid,
               fv_assessment_overall(e.id, a.id) as ov
          from enrollment e cross join assessment a
         where e.course_id = p_course_id and e.withdrawn_at is null
           and a.course_id = p_course_id
    )
    select jsonb_object_agg(eid, cells_per_student)
      into cells
      from (
        select eid, jsonb_object_agg(
                       aid,
                       jsonb_build_object(
                           'kind', (ov).kind, 'value', (ov).value,
                           'score', (
                               select jsonb_build_object(
                                          'id', sc.id,
                                          'value', sc.value,
                                          'status', sc.status,
                                          'comment', sc.comment,
                                          'scored_at', sc.scored_at,
                                          'updated_at', sc.updated_at
                                      )
                                 from score sc
                                where sc.enrollment_id = p.eid
                                  and sc.assessment_id = p.aid
                           ),
                           'tag_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'tag_id', ts.tag_id,
                                          'value', ts.value, 'modifier', ts.modifier
                                      ) order by ts.tag_id)
                                 from tag_score ts
                                where ts.enrollment_id = p.eid
                                  and ts.assessment_id = p.aid
                           ), '[]'::jsonb),
                           'rubric_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'criterion_id', rs.criterion_id,
                                          'value', rs.value, 'modifier', rs.modifier
                                      ) order by rs.criterion_id)
                                 from rubric_score rs
                                where rs.enrollment_id = p.eid
                                  and rs.assessment_id = p.aid
                           ), '[]'::jsonb)
                       )
                   ) as cells_per_student
          from pairs p group by eid
      ) x;

    select jsonb_object_agg(
               e.id,
               jsonb_build_object(
                   'letter', case when course_row.grading_system in ('letter','both')
                       then fv_course_letter_pipeline(e.id, p_course_id) else null end,
                   'overall_proficiency', case when course_row.grading_system in ('proficiency','both')
                       then fv_overall_proficiency(e.id, p_course_id) else null end,
                   'counts', fv_status_counts(e.id, p_course_id)
               )
           )
      into summaries
      from enrollment e
     where e.course_id = p_course_id and e.withdrawn_at is null;

    return jsonb_build_object(
        'course', to_jsonb(course_row),
        'students', coalesce(students, '[]'::jsonb),
        'assessments', coalesce(assessments, '[]'::jsonb),
        'categories', coalesce(categories, '[]'::jsonb),
        'modules', coalesce(modules, '[]'::jsonb),
        'cells', coalesce(cells, '{}'::jsonb),
        'row_summaries', coalesce(summaries, '{}'::jsonb)
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_assessment(p_src_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _new_id   uuid;
    _course   uuid;
    _module   uuid;
    _next_pos int;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'duplicate_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select course_id, module_id into _course, _module
      from assessment
     where id = p_src_id;
    if _course is null then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = _course
       and module_id is not distinct from _module;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, collab_mode, collab_config, display_order,
                            core_competency_ids, is_draft, students_see_factored)
    select course_id, category_id, title || ' (copy)', description, date_assigned, due_date,
           score_mode, max_points, weight, evidence_type,
           rubric_id, module_id, collab_mode, collab_config, _next_pos,
           core_competency_ids, is_draft, students_see_factored
      from assessment
     where id = p_src_id
    returning id into _new_id;

    insert into assessment_tag (assessment_id, tag_id)
    select _new_id, tag_id from assessment_tag where assessment_id = p_src_id;

    perform fv_idem_store(p_idempotency_key, 'duplicate_assessment', jsonb_build_object('id', _new_id));
    return _new_id;
end; $function$;

-- -- 6. The student page sends it on each piece -----------------------------
CREATE OR REPLACE FUNCTION student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in      jsonb := _session_class(p_session_token, p_enrollment_id);
    _course  course%rowtype;
    _today   date;
    _weights numeric;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- 2026111720: Show Overall Grade as this student has it (their own, or the class's when they have none).
    -- Every read of _course.show_my_learning below is this student's value.
    _course.show_my_learning := coalesce((select e.show_overall_grade from enrollment e where e.id = p_enrollment_id),
                                         _course.show_my_learning);
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    -- What the class's category weights total: 100, or null with no categories.
    select sum(k.weight) into _weights from category k where k.course_id = _course.id;

    return jsonb_build_object(
        'ok', true, 'v', 1,
        'expires_at', _in->'expires_at',
        'student', (select jsonb_build_object('enrollment_id', e.id,
                                              'first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name))
                      from enrollment e join student s on s.id = e.student_id where e.id = p_enrollment_id),
        'course', jsonb_build_object(
            'name', _course.name, 'block', _course.block, 'grading_system', _course.grading_system,
            'grading_scale', _course.grading_scale, 'level_order', _course.level_order,
            'round_percent', _course.round_percent,
            -- The name the class's teacher signed up with, and nothing else of theirs.
            'teacher_name', (select nullif(t.display_name, '') from teacher t where t.id = _course.teacher_id)),
        'classes', _session_classes((_in->>'session_id')::uuid),
        'tags', coalesce((
            select jsonb_object_agg(t.id::text, jsonb_build_object('label', t.label, 'code', t.code,
                                                                   'i_can', to_jsonb(t.i_can_statements)))
              from tag t join section s on s.id = t.section_id
             where s.course_id = _course.id and s.removed_at is null), '{}'::jsonb),
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'name', r.name, 'style', r.style,
                       'criteria', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'id', cr.id, 'name', cr.name, 'weight', cr.weight,
                                      'level_1_value', cr.level_1_value, 'level_2_value', cr.level_2_value,
                                      'level_3_value', cr.level_3_value, 'level_4_value', cr.level_4_value,
                                      'level_1_descriptor', cr.level_1_descriptor, 'level_2_descriptor', cr.level_2_descriptor,
                                      'level_3_descriptor', cr.level_3_descriptor, 'level_4_descriptor', cr.level_4_descriptor,
                                      -- The competencies this row counts toward, only those still on the class.
                                      'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                             from criterion_tag x
                                                             join tag t on t.id = x.tag_id
                                                             join section s on s.id = t.section_id
                                                            where x.criterion_id = cr.id
                                                              and s.course_id = _course.id and s.removed_at is null), '[]'::jsonb),
                                      'checks', coalesce((
                                          select jsonb_agg(jsonb_build_object('id', ck.id, 'level', ck.level, 'label', ck.label)
                                                           order by ck.level, ck.display_order, ck.id)
                                            from criterion_check ck where ck.criterion_id = cr.id), '[]'::jsonb))
                                    order by cr.display_order, cr.id)
                             from criterion cr where cr.rubric_id = r.id), '[]'::jsonb)) order by r.id)
              from rubric r
             where r.course_id = _course.id
               and exists (select 1 from assessment a where a.rubric_id = r.id
                              and student_submit._listed(a, _today))), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(
                       jsonb_build_object(
                           'id', a.id, 'title', a.title, 'date', a.date_assigned, 'due_date', a.due_date,
                           'score_mode', a.score_mode, 'max_points', a.max_points, 'weight', a.weight,
                           'students_see_factored', a.students_see_factored,
                           'rubric_id', a.rubric_id, 'created_at', a.created_at,
                           'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                  from assessment_tag x
                                                  join tag t on t.id = x.tag_id
                                                  join section s on s.id = t.section_id
                                                 where x.assessment_id = a.id and s.removed_at is null), '[]'::jsonb),
                           'description', nullif(a.description, ''),
                           'module_name', (select m.name from module m where m.id = a.module_id and m.course_id = _course.id),
                           'category_name', k.name,
                           -- What the category counts toward the course grade as the class is set
                           -- up, or null where no percent would be true (the header says when).
                           'category_percent', case when a.score_mode = 'dibels' then null
                                                    when k.weight = 0 then 0
                                                    when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight
                                               end,
                           -- The Ministry's seven, in its order, named as shared/constants.js names them.
                           'core_competencies', coalesce((
                               select jsonb_agg(jsonb_build_object('id', cc.id, 'name', cc.name) order by cc.ord)
                                 from (values (1, 'COM', 'Communicating'),
                                              (2, 'COL', 'Collaborating'),
                                              (3, 'CT',  'Creative Thinking'),
                                              (4, 'CRT', 'Critical & Reflective Thinking'),
                                              (5, 'PPI', 'Personal & Cultural Identity'),
                                              (6, 'PAR', 'Personal Awareness & Responsibility'),
                                              (7, 'SAR', 'Social Awareness & Responsibility')) as cc(ord, id, name)
                                where cc.id = any (a.core_competency_ids)), '[]'::jsonb),
                           -- Handouts and Links (2026111170): what the teacher put on the piece, the
                           -- ready ones only, in the order added
                           'resources', coalesce((
                               select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title,
                                                                   'url', r.url, 'page_count', r.page_count)
                                                order by r.position, r.created_at, r.id)
                                 from assessment_resource r
                                where r.assessment_id = a.id and r.status = 'ready'), '[]'::jsonb))
                       -- E9: the piece's category id, only when Show My Learning is on
                       || case when _course.show_my_learning then jsonb_build_object('category_id', k.id) else '{}'::jsonb end
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
              left join category k on k.id = a.category_id and k.course_id = _course.id
             where a.course_id = _course.id
               and student_submit._listed(a, _today)), '[]'::jsonb))
        -- E9: Show My Learning on: the class's own settings, categories, folders and learning map
        -- (get_class_bundle's shapes; no tag source_text). Off: nothing is added.
        || case when _course.show_my_learning then jsonb_build_object(
               'show_my_learning', true,
               'learning', jsonb_build_object(
                   -- E9: the twelve calculation and grading-style columns of course, and no other
                   'course', jsonb_build_object(
                       'grading_system', _course.grading_system, 'calc_method', _course.calc_method,
                       'decay_weight', _course.decay_weight, 'recent_score_limit', _course.recent_score_limit,
                       'grading_scale', _course.grading_scale, 'category_weights', _course.category_weights,
                       'round_percent', _course.round_percent, 'level_order', _course.level_order,
                       'reporting_terms', _course.reporting_terms, 'timezone', _course.timezone,
                       'folders_count_as_one', _course.folders_count_as_one,
                       'courses_count_equally', _course.courses_count_equally,
                       -- 20261112: the class's grade level, so the device rounds the course % as the
                       -- teacher's app does when Round to Whole Percent was never chosen (grades 10-12)
                       'grade_level', _course.grade_level),
                   -- 20261112: the competencies each rubric scores as a whole (rubric_tag), for the
                   -- rubrics this page lists, only those still on the class; a rubric with none is left out
                   'rubric_tags', coalesce((
                       select jsonb_object_agg(w.rubric_id::text, w.tag_ids)
                         from (select rt.rubric_id, jsonb_agg(rt.tag_id order by rt.tag_id) as tag_ids
                                 from rubric_tag rt
                                 join rubric r on r.id = rt.rubric_id and r.course_id = _course.id
                                 join tag t on t.id = rt.tag_id
                                 join section s on s.id = t.section_id
                                where s.course_id = _course.id and s.removed_at is null
                                  and exists (select 1 from assessment a where a.rubric_id = r.id
                                                 and student_submit._listed(a, _today))
                                group by rt.rubric_id) w), '{}'::jsonb),
                   -- E9: every category of the class, as the bundle sends them
                   'categories', coalesce((
                       select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                           'display_order', c.display_order, 'calc_mode', c.calc_mode)
                                        order by c.display_order, c.id)
                         from category c where c.course_id = _course.id), '[]'::jsonb),
                   -- E9: this student's own hand-set levels, as the bundle sends them, without the teacher's reason
                   'section_overrides', coalesce((
                       select jsonb_object_agg(o.section_id::text, jsonb_build_object('level', o.level, 'date', o.updated_at))
                         from section_override o where o.enrollment_id = p_enrollment_id), '{}'::jsonb),
                   -- E9: the class's folders, as the bundle sends them
                   'competency_groups', coalesce((
                       select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                           'display_order', cg.display_order,
                                                           'counts_as_one', cg.counts_as_one)
                                        order by cg.display_order, cg.name)
                         from competency_group cg where cg.course_id = _course.id), '[]'::jsonb),
                   -- E9: the learning map: subjects, their sections not removed, their tags, in the bundle's order
                   'subjects', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'id', subj.id, 'name', subj.name, 'display_order', subj.display_order,
                                  'sections', coalesce((
                                      select jsonb_agg(jsonb_build_object(
                                                 'id', sec.id, 'name', sec.name, 'display_order', sec.display_order,
                                                 'competency_group_id', sec.competency_group_id,
                                                 'tags', coalesce((
                                                     select jsonb_agg(jsonb_build_object(
                                                                'id', t.id, 'code', t.code, 'label', t.label,
                                                                'i_can_text', t.i_can_text,
                                                                'i_can_statements', to_jsonb(t.i_can_statements),
                                                                'bank_id', t.bank_id, 'display_order', t.display_order)
                                                            order by t.display_order, t.label)
                                                       from tag t where t.section_id = sec.id), '[]'::jsonb))
                                             order by sec.display_order, sec.name)
                                        from section sec
                                       where sec.subject_id = subj.id and sec.course_id = _course.id
                                         and sec.removed_at is null), '[]'::jsonb))
                                order by subj.display_order, subj.name)
                         from subject subj where subj.course_id = _course.id), '[]'::jsonb)))
           else '{}'::jsonb end;
end;
$function$;

commit;
