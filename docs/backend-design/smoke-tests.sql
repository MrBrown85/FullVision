-- FullVision v2 — smoke-test pack (Phase 5.3)
--
-- Goal: a single file that exercises every deployed Phase 1 + 3.2 RPC and
-- the key invariants (RLS isolation, audit semantics, cascade + SET NULL
-- behaviour, trigger-enforced constraints, immutability flags, idempotent
-- re-imports). Runnable as:
--
--   PGPASSWORD=$SVC_ROLE_KEY psql \
--     "postgresql://postgres.novsfeqjhbleyyaztmlh:[REDACTED]@aws-0-ca-central-1.pooler.supabase.com:6543/postgres" \
--     -v ON_ERROR_STOP=1 \
--     -f docs/backend-design/smoke-tests.sql
--
-- Each block:
--   • seeds its own teacher + fixtures (random UUID → no collision with
--     prior runs or other smokes),
--   • runs the RPC under test,
--   • asserts expected state,
--   • RAISEs a sentinel so the PL/pgSQL BEGIN...EXCEPTION subtransaction
--     rolls back the fixtures.  The sentinel is caught + swallowed so the
--     script's exit code stays clean under ON_ERROR_STOP=1.
--
-- Run order isn't significant — each block is independent.
--
-- Prerequisite: all fullvision_v2_* migrations are applied.  Run against
-- `gradebook-prod` directly (safe — no data persists), against a Supabase
-- branch, or against a locally-shadowed copy.

\set ON_ERROR_STOP on
\set VERBOSITY terse
\pset pager off
\echo === FullVision v2 smoke-test pack ===

-- Shared helpers: every block uses this exception pattern so the sentinel
-- rolls back fixtures without bubbling up to psql.
--
--   do $$
--   declare ...
--   begin
--     begin
--       <body>
--       raise exception 'ROLLBACK_SMOKE_OK';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
--     end;
--   end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 1.  Auth / bootstrap  (Phase 1.1)
-- ═════════════════════════════════════════════════════════════════════════
\echo [1/14] auth / bootstrap
do $$
declare
    _uid uuid := gen_random_uuid();
    _res jsonb;
begin
  begin
    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _res := bootstrap_teacher('smoke-auth@test.local', 'Smoke Teacher');
    assert (_res->>'id')::uuid = _uid, 'teacher id mismatch';
    assert (_res->'preferences'->>'active_course_id') is not null, 'welcome class should be active';
    assert exists (select 1 from course where teacher_id = _uid and name = 'Welcome Class'),
           'welcome class not created';

    perform soft_delete_teacher();
    assert (select deleted_at from teacher where id = _uid) is not null, 'soft_delete missed';

    perform restore_teacher();
    assert (select deleted_at from teacher where id = _uid) is null, 'restore failed';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2.  Course CRUD  (Phase 1.2)
-- ═════════════════════════════════════════════════════════════════════════
\echo [2/14] course CRUD
do $$
declare
    _uid uuid := gen_random_uuid();
    _a   uuid;  _b   uuid;  _dup uuid;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-course@test.local');
    insert into teacher_preference (teacher_id) values (_uid);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _a := create_course('Algebra', '8', null, null, 'proficiency', 'average',
                        null, 'America/Vancouver', null, array['Number','Algebra']);
    assert exists (select 1 from course where id = _a);
    assert (select count(*) from subject where course_id = _a) = 2;
    assert exists (select 1 from report_config where course_id = _a);

    _b := create_course('Geometry', '9');
    perform update_course(_b, jsonb_build_object('name','Geometry (Honours)','grade_level','10'));
    assert (select name from course where id = _b) = 'Geometry (Honours)';

    perform archive_course(_b, true);
    assert (select is_archived from course where id = _b) = true;
    perform archive_course(_b, false);

    _dup := duplicate_course(_a);
    assert (select name from course where id = _dup) = 'Algebra (copy)';
    assert (select count(*) from subject where course_id = _dup) = 2;

    perform delete_course(_b);
    assert not exists (select 1 from course where id = _b);

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3.  Category + Module + Rubric CRUD + weight-cap trigger  (Phase 1.3)
-- ═════════════════════════════════════════════════════════════════════════
\echo [3/14] category / module / rubric
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _tag uuid;
    _cat uuid; _mod uuid; _rub uuid; _crit1 uuid;
    _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-cmr@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'S') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'Sec') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _tag;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _cat := upsert_category(null, _course, 'Tests', 50, 0);
    perform upsert_category(null, _course, 'Quizzes', 40, 1);

    -- trigger: >100 total must be rejected
    _ok := false;
    begin
      perform upsert_category(null, _course, 'Bad', 20, 2);
    exception when others then _ok := true; end;
    assert _ok, 'weight-cap trigger did not reject';

    _mod := upsert_module(null, _course, 'M', '#abc', null);
    _rub := upsert_rubric(null, _course, 'R',
      jsonb_build_array(
        jsonb_build_object('name','Clarity','weight',1.5,
          'linked_tag_ids', jsonb_build_array(_tag::text)),
        jsonb_build_object('name','Voice','weight',1.0)
      )
    );
    assert (select count(*) from criterion where rubric_id = _rub) = 2;
    assert (select count(*) from criterion_tag ct join criterion c on c.id = ct.criterion_id
            where c.rubric_id = _rub) = 1;

    -- Edit: drop a criterion, add another; tag link replaced to zero.
    select id into _crit1 from criterion where rubric_id = _rub and name = 'Clarity';
    perform upsert_rubric(_rub, _course, 'R-v2',
      jsonb_build_array(
        jsonb_build_object('id', _crit1::text, 'name','Clarity+','weight',1.0,'linked_tag_ids', '[]'::jsonb),
        jsonb_build_object('name','Evidence','weight',2.0)
      )
    );
    assert (select count(*) from criterion where rubric_id = _rub) = 2;
    assert not exists (select 1 from criterion where rubric_id = _rub and name = 'Voice');
    assert (select count(*) from criterion_tag where criterion_id = _crit1) = 0;

    perform delete_module(_mod);
    perform delete_category(_cat);
    perform delete_rubric(_rub);
    assert not exists (select 1 from rubric where id = _rub);

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4.  Learning map CRUD + reorder + SET NULL on competency group  (1.4)
-- ═════════════════════════════════════════════════════════════════════════
\echo [4/14] learning map + SET NULL fix
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj1 uuid; _subj2 uuid; _grp uuid; _s1 uuid; _s2 uuid;
    _t1 uuid; _t2 uuid;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-lm@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _subj1 := upsert_subject(null, _course, 'Math', null);
    _subj2 := upsert_subject(null, _course, 'Sci',  null);
    _grp   := upsert_competency_group(null, _course, 'Core', null, null);
    _s1    := upsert_section(null, _subj1, 'Algebra', _grp, null);
    _s2    := upsert_section(null, _subj1, 'Geometry', null, null);
    _t1    := upsert_tag(null, _s1, 'Solve eqns', 'A1', null, null);
    _t2    := upsert_tag(null, _s1, 'Graph',      'A2', null, null);

    perform reorder_subjects(array[_subj2, _subj1]);
    assert (select display_order from subject where id = _subj2) = 0;

    perform reorder_tags(array[_t2, _t1]);
    assert (select display_order from tag where id = _t2) = 0;

    -- competency_group SET NULL must NOT null section.course_id (the 1.4 fix).
    perform delete_competency_group(_grp);
    assert (select competency_group_id from section where id = _s1) is null;
    assert (select course_id            from section where id = _s1) = _course,
           'section.course_id was nulled — FK column-list not applied';

    -- subject delete cascades sections + tags
    perform delete_subject(_subj1);
    assert not exists (select 1 from section where subject_id = _subj1);

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5.  Student + Enrollment + import_roster_csv reactivate  (1.5)
-- ═════════════════════════════════════════════════════════════════════════
\echo [5/14] student / enrollment / CSV import
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _r jsonb; _sid uuid; _eid uuid; _e2 uuid; _sum jsonb;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-stu@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _r := create_student_and_enroll(_course, 'Alice', 'Adams', null, 'she/her',
                                    'SN-1', null, null, array['IEP']::text[], null);
    _sid := (_r->>'student_id')::uuid; _eid := (_r->>'enrollment_id')::uuid;

    _r := create_student_and_enroll(_course, 'Bob', 'Baker');
    _e2 := (_r->>'enrollment_id')::uuid;

    perform update_student(_sid, jsonb_build_object('last_name','Atkins'));
    assert (select last_name from student where id = _sid) = 'Atkins';

    perform update_enrollment(_eid, jsonb_build_object(
      'designations', jsonb_build_array('MOD','ELL'),
      'is_flagged', true, 'roster_position', 3));
    assert (select is_flagged from enrollment where id = _eid) = true;

    perform withdraw_enrollment(_e2);
    assert (select withdrawn_at from enrollment where id = _e2) is not null;

    -- Import: Alice matches by SN → reactivated (already active, just
    -- confirmed); Bob (withdrawn) re-imported → reactivated (withdrawn_at=null);
    -- Eve new → created + enrolled.
    _sum := import_roster_csv(_course, jsonb_build_array(
      jsonb_build_object('first_name','X','last_name','Y','student_number','SN-1'),
      jsonb_build_object('first_name','Bob','last_name','Baker'),
      jsonb_build_object('first_name','Eve','last_name','E')
    ));
    assert (_sum->>'created')::int = 1, 'expected 1 created, got ' || (_sum->>'created');
    assert (_sum->>'enrolled')::int = 1, 'expected 1 enrolled, got ' || (_sum->>'enrolled');
    assert (_sum->>'reactivated')::int = 2, 'expected 2 reactivated, got ' || (_sum->>'reactivated');
    assert (select withdrawn_at from enrollment where id = _e2) is null, 'Bob should be reactivated';

    perform reorder_roster(array[_e2, _eid]);
    assert (select roster_position from enrollment where id = _e2) = 0;

    perform bulk_apply_pronouns(array[_sid], 'she/they');
    assert (select pronouns from student where id = _sid) = 'she/they';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 6.  Assessment CRUD + duplicate + collab validation  (1.6)
-- ═════════════════════════════════════════════════════════════════════════
\echo [6/14] assessment CRUD
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _t uuid;
    _a uuid; _dup uuid;
    _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-asmt@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'S') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'Sec') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _t;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _a := create_assessment(_course, 'Quiz', null, null, null, null,
                            'proficiency', null, 1, null, null, null, array[_t]::uuid[]);
    assert (select count(*) from assessment_tag where assessment_id = _a) = 1;

    perform update_assessment(_a,
      jsonb_build_object('title','Quiz v2','weight','2'), array[_t]::uuid[]);
    assert (select title from assessment where id = _a) = 'Quiz v2';

    _dup := duplicate_assessment(_a);
    assert (select title from assessment where id = _dup) = 'Quiz v2 (copy)';

    perform save_collab(_a, 'groups', jsonb_build_object('g', jsonb_build_array('a','b')));
    assert (select collab_mode from assessment where id = _a) = 'groups';
    perform save_collab(_a, 'none', null);
    assert (select collab_config from assessment where id = _a) is null;

    _ok := false;
    begin
      perform save_collab(_a, 'invalid-mode', null);
    exception when others then _ok := true; end;
    assert _ok, 'save_collab should reject invalid mode';

    perform delete_assessment(_dup);
    assert not exists (select 1 from assessment where id = _dup);

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 7.  Scoring + score_audit diff semantics  (1.7)
-- ═════════════════════════════════════════════════════════════════════════
\echo [7/14] scoring + audit
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _t uuid;
    _stu uuid; _enr uuid;
    _a uuid; _arub uuid; _rub uuid; _crit uuid; _sid uuid; _n int;
    _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-score@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'S') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'Sec') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _t;
    insert into student (teacher_id, first_name) values (_uid, 'Stu') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into assessment (course_id, title) values (_course, 'A') returning id into _a;
    insert into rubric (course_id, name) values (_course, 'R') returning id into _rub;
    insert into criterion (rubric_id, name) values (_rub, 'C') returning id into _crit;
    insert into assessment (course_id, title, rubric_id) values (_course, 'AR', _rub) returning id into _arub;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _sid := upsert_score(_enr, _a, 3.5);
    assert (select count(*) from score_audit where score_id = _sid) = 1, 'first audit missing';

    perform upsert_score(_enr, _a, 3.5);         -- no-op
    assert (select count(*) from score_audit where score_id = _sid) = 1, 'no-op wrote audit';

    perform upsert_score(_enr, _a, 4.0);         -- changed
    assert (select count(*) from score_audit where score_id = _sid) = 2, 'change missed audit';
    assert (select changed_by from score_audit where score_id = _sid order by changed_at desc limit 1) = _uid;

    perform set_score_status(_enr, _a, 'LATE');
    perform save_score_comment(_enr, _a, 'nice');
    assert (select status  from score where id = _sid) = 'LATE';
    assert (select comment from score where id = _sid) = 'nice';

    _n := fill_rubric(_enr, _arub, 3);
    assert _n = 1, 'fill_rubric should have populated 1 criterion';
    assert (select value from rubric_score where enrollment_id = _enr and criterion_id = _crit) = 3;

    perform upsert_tag_score(_enr, _a, _t, 4);
    assert (select value from tag_score where enrollment_id = _enr and tag_id = _t) = 4;

    -- tag_score on rubric assessment must be rejected
    _ok := false;
    begin
      perform upsert_tag_score(_enr, _arub, _t, 3);
    exception when others then _ok := true; end;
    assert _ok, 'tag_score should reject rubric assessment';

    perform clear_score(_enr, _a);
    assert not exists (select 1 from score where enrollment_id = _enr and assessment_id = _a);

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 8.  Observation + Template immutability + CustomTag  (1.8)
-- ═════════════════════════════════════════════════════════════════════════
\echo [8/14] observation + templates
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _tag uuid;
    _stu uuid; _enr uuid;
    _ct uuid; _obs uuid; _tpl uuid; _seed uuid;
    _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-obs@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'S') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'Sec') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _tag;
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into observation_template (course_id, body, is_seed) values (_course, 'Seed', true) returning id into _seed;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _ct := create_custom_tag(_course, 'Curiosity');
    _obs := create_observation(_course, 'Great', 'strength', 'class', null,
                               array[_enr]::uuid[], array[_tag]::uuid[], array[_ct]::uuid[]);
    assert (select count(*) from observation_student where observation_id = _obs) = 1;

    perform update_observation(_obs, jsonb_build_object('body','Updated'), null, null, null);
    assert (select body from observation where id = _obs) = 'Updated';

    _tpl := upsert_observation_template(null, _course, 'My template', 'growth', null, null);
    perform upsert_observation_template(_tpl, _course, 'My template v2', null, null, null);

    _ok := false;
    begin
      perform upsert_observation_template(_seed, _course, 'hacked', null, null, null);
    exception when others then _ok := true; end;
    assert _ok, 'seed template should be immutable';

    _ok := false;
    begin
      perform delete_observation_template(_seed);
    exception when others then _ok := true; end;
    assert _ok, 'seed template delete should be rejected';

    perform delete_observation(_obs);
    assert not exists (select 1 from observation where id = _obs);

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 9.  Student records (note immutable, goal/reflection/override guards)  (1.9)
-- ═════════════════════════════════════════════════════════════════════════
\echo [9/14] student records
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid;
    _stu uuid; _enr uuid;
    _nid uuid; _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-rec@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'S') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'Sec') returning id into _sect;
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _nid := upsert_note(_enr, 'hello');
    perform delete_note(_nid);
    assert not exists (select 1 from note where id = _nid);

    perform upsert_goal(_enr, _sect, 'read more');
    perform upsert_reflection(_enr, _sect, 'growing', 4);
    perform upsert_section_override(_enr, _sect, 3, 'judgment');

    _ok := false;
    begin perform upsert_reflection(_enr, _sect, 'x', 9);
    exception when others then _ok := true; end;
    assert _ok, 'confidence must be 1..5';

    _ok := false;
    begin perform upsert_section_override(_enr, _sect, 5, null);
    exception when others then _ok := true; end;
    assert _ok, 'level must be 1..4';

    perform clear_section_override(_enr, _sect);
    assert not exists (select 1 from section_override where enrollment_id = _enr);

    -- same-day attendance overwrite
    perform bulk_attendance(array[_enr]::uuid[], '2026-04-19', 'Present');
    perform bulk_attendance(array[_enr]::uuid[], '2026-04-19', 'Late');
    assert (select status from attendance where enrollment_id = _enr and attendance_date = '2026-04-19') = 'Late';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 10.  Term rating composite save + audit  (1.10)
-- ═════════════════════════════════════════════════════════════════════════
\echo [10/14] term rating + audit
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _s1 uuid; _s2 uuid; _t1 uuid; _t2 uuid;
    _stu uuid; _enr uuid; _tr uuid; _n int; _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-tr@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'S') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'S1') returning id into _s1;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'S2') returning id into _s2;
    insert into tag (section_id, label) values (_s1, 'T1') returning id into _t1;
    insert into tag (section_id, label) values (_s1, 'T2') returning id into _t2;
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _tr := save_term_rating(_enr, 1, jsonb_build_object(
      'narrative_html','<p>Great</p>', 'work_habits_rating', 3, 'participation_rating', 4,
      'social_traits', jsonb_build_array('kind','curious'),
      'dimensions', jsonb_build_array(
        jsonb_build_object('section_id', _s1::text, 'rating', 3),
        jsonb_build_object('section_id', _s2::text, 'rating', 4)),
      'strength_tags', jsonb_build_array(_t1::text),
      'growth_tags',   jsonb_build_array(_t2::text)
    ));
    select count(*) into _n from term_rating_audit where term_rating_id = _tr;
    assert _n >= 6, 'expected ≥ 6 audit rows on first save, got ' || _n;

    -- partial edit keeps unchanged fields
    perform save_term_rating(_enr, 1, jsonb_build_object(
      'participation_rating', 3,
      'strength_tags', jsonb_build_array(_t2::text)
    ));
    assert (select work_habits_rating from term_rating where id = _tr) = 3;
    assert (select participation_rating from term_rating where id = _tr) = 3;
    assert (select count(*) from term_rating_strength where term_rating_id = _tr and tag_id = _t2) = 1;

    _ok := false;
    begin perform save_term_rating(_enr, 7, jsonb_build_object('narrative_html','x'));
    exception when others then _ok := true; end;
    assert _ok, 'term must be 1..6';

    _ok := false;
    begin perform save_term_rating(_enr, 1, jsonb_build_object('work_habits_rating', 9));
    exception when others then _ok := true; end;
    assert _ok, 'work_habits_rating must be 1..4';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 11.  ReportConfig + preferences (preset CHECK inc. 'custom')  (1.11)
-- ═════════════════════════════════════════════════════════════════════════
\echo [11/14] report config + prefs
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid;
    _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-rc@test.local');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into report_config (course_id) values (_course);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    perform apply_report_preset(_course, 'brief');
    assert (select preset from report_config where course_id = _course) = 'brief';

    perform toggle_report_block(_course, 'attendance', false);
    assert (select preset from report_config where course_id = _course) = 'custom';

    _ok := false;
    begin
      perform apply_report_preset(_course, 'custom');
    exception when others then _ok := true; end;
    assert _ok, 'apply_report_preset should reject custom';

    perform save_teacher_preferences(jsonb_build_object(
      'view_mode','list','active_course_id', _course::text));
    assert (select view_mode from teacher_preference where teacher_id = _uid) = 'list';

    -- partial keeps existing view_mode
    perform save_teacher_preferences(jsonb_build_object('mobile_sort_mode','alpha'));
    assert (select view_mode from teacher_preference where teacher_id = _uid) = 'list';
    assert (select mobile_sort_mode from teacher_preference where teacher_id = _uid) = 'alpha';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 12.  Retention cleanup (1.12)
-- ═════════════════════════════════════════════════════════════════════════
\echo [12/14] retention cleanup
do $$
declare
    _stale uuid := gen_random_uuid();
    _fresh uuid := gen_random_uuid();
    _course uuid; _stu uuid; _enr uuid; _a uuid; _sid uuid;
    _res jsonb;
begin
  begin
    -- stale soft-deleted teacher
    insert into teacher (id, email, deleted_at) values (_stale, 'stale@t', now() - interval '40 days');
    insert into teacher_preference (teacher_id) values (_stale);
    insert into course (teacher_id, name) values (_stale, 'stale') returning id into _course;

    -- fresh teacher with a stale + a fresh audit row
    insert into teacher (id, email) values (_fresh, 'fresh@t');
    insert into teacher_preference (teacher_id) values (_fresh);
    insert into course (teacher_id, name) values (_fresh, 'c') returning id into _course;
    insert into student (teacher_id, first_name) values (_fresh, 'x') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into assessment (course_id, title) values (_course, 'a') returning id into _a;
    insert into score (enrollment_id, assessment_id, value) values (_enr, _a, 3) returning id into _sid;
    insert into score_audit (score_id, changed_by, new_value, changed_at)
      values (_sid, _fresh, 1, now() - interval '3 years');
    insert into score_audit (score_id, changed_by, new_value, changed_at)
      values (_sid, _fresh, 2, now());

    _res := fv_retention_cleanup();

    assert (_res->>'teachers_purged')::int >= 1, 'stale teacher not purged';
    assert not exists (select 1 from teacher where id = _stale);
    assert (_res->>'score_audit_purged')::int >= 1, 'stale audit not purged';
    assert (select count(*) from score_audit where score_id = _sid) = 1, 'fresh audit must survive';
    assert exists (select 1 from teacher where id = _fresh), 'fresh teacher must survive';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 13.  Imports: Teams + JSON restore (4.9) + idempotent re-run
-- ═════════════════════════════════════════════════════════════════════════
\echo [13/14] imports
do $$
declare
    _uid uuid := gen_random_uuid();
    _teams jsonb; _json jsonb;
    _src_course uuid := gen_random_uuid();
    _src_subj   uuid := gen_random_uuid();
    _src_stu    uuid := gen_random_uuid();
    _src_enr    uuid := gen_random_uuid();
    _src_asm    uuid := gen_random_uuid();
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-imp@test.local');
    insert into teacher_preference (teacher_id) values (_uid);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _teams := import_teams_class(jsonb_build_object(
      'class_name','Teams','students',jsonb_build_array(
        jsonb_build_object('first_name','A','last_name','B'),
        jsonb_build_object('first_name','C','last_name','D')),
      'assignments',jsonb_build_array(
        jsonb_build_object('title','Q1'),
        jsonb_build_object('title','Essay','score_mode','points','max_points',100))));
    assert (_teams->>'students_created')::int = 2;
    assert (_teams->>'assessments_created')::int = 2;

    _json := import_json_restore(jsonb_build_object(
      'courses', jsonb_build_array(jsonb_build_object('id', _src_course::text, 'name','JR')),
      'subjects', jsonb_build_array(jsonb_build_object(
        'id', _src_subj::text, 'course_id', _src_course::text, 'name','Math')),
      'students', jsonb_build_array(jsonb_build_object(
        'id', _src_stu::text, 'first_name','Stu')),
      'enrollments', jsonb_build_array(jsonb_build_object(
        'id', _src_enr::text, 'student_id', _src_stu::text,
        'course_id', _src_course::text, 'roster_position', 0)),
      'assessments', jsonb_build_array(jsonb_build_object(
        'id', _src_asm::text, 'course_id', _src_course::text, 'title', 'Q1')),
      'scores', jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'enrollment_id', _src_enr::text,
        'assessment_id', _src_asm::text, 'value', 3.5))
    ));
    assert (_json->>'courses')::int     = 1;
    assert (_json->>'students')::int    = 1;
    assert (_json->>'enrollments')::int = 1;
    assert (_json->>'scores')::int      = 1;
    assert (select value from score where enrollment_id = _src_enr) = 3.5;

    -- Idempotent re-run (update-in-place on UUID match).
    _json := import_json_restore(jsonb_build_object(
      'courses', jsonb_build_array(jsonb_build_object(
        'id', _src_course::text, 'name','JR v2'))));
    assert (select name from course where id = _src_course) = 'JR v2';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 14.  Read paths + RLS cross-tenant isolation
-- ═════════════════════════════════════════════════════════════════════════
\echo [14/14] read paths + RLS isolation
do $$
declare
    _a uuid := gen_random_uuid();
    _b uuid := gen_random_uuid();
    _a_course uuid; _a_stu uuid; _a_enr uuid; _a_asm uuid;
    _gb jsonb; _prof jsonb; _ok boolean;
begin
  begin
    -- Teacher A with a full mini-course
    insert into teacher (id, email) values (_a, 'A@t');
    insert into teacher_preference (teacher_id) values (_a);
    insert into course (teacher_id, name) values (_a, 'A''s course') returning id into _a_course;
    insert into student (teacher_id, first_name) values (_a, 'Stu') returning id into _a_stu;
    insert into enrollment (student_id, course_id, roster_position) values (_a_stu, _a_course, 0) returning id into _a_enr;
    insert into assessment (course_id, title) values (_a_course, 'Quiz') returning id into _a_asm;
    insert into score (enrollment_id, assessment_id, value) values (_a_enr, _a_asm, 3.5);

    -- Teacher B (no data)
    insert into teacher (id, email) values (_b, 'B@t');
    insert into teacher_preference (teacher_id) values (_b);

    -- As A: reads succeed
    perform set_config('request.jwt.claim.sub', _a::text, true);
    perform set_config('role', 'authenticated', true);

    _gb := get_gradebook(_a_course);
    assert jsonb_array_length(_gb->'students') = 1;
    assert jsonb_array_length(_gb->'assessments') = 1;
    assert (_gb->'cells'->_a_enr::text->_a_asm::text->'score'->>'value')::numeric = 3.5;

    _prof := get_student_profile(_a_enr);
    assert (_prof->'enrollment'->>'id')::uuid = _a_enr;

    assert (select count(*) from list_teacher_courses()) = 1;

    -- As B: RLS denies A's course to B
    perform set_config('request.jwt.claim.sub', _b::text, true);
    perform set_config('role', 'authenticated', true);

    assert (select count(*) from list_teacher_courses()) = 0, 'B should see no courses';

    _ok := false;
    begin
      perform get_gradebook(_a_course);
    exception when others then _ok := true; end;
    assert _ok, 'B should not be able to read A''s gradebook';

    _ok := false;
    begin
      perform get_student_profile(_a_enr);
    exception when others then _ok := true; end;
    assert _ok, 'B should not be able to read A''s student profile';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;

\echo === all 23 smoke blocks passed ===

-- ═════════════════════════════════════════════════════════════════════════
-- 15.  get_learning_map (Phase 5.4.1)
-- ═════════════════════════════════════════════════════════════════════════
\echo [15/23] get_learning_map
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _grp uuid; _sect1 uuid; _sect2 uuid;
    _t1 uuid; _t2 uuid; _t3 uuid;
    _stu uuid; _stu2 uuid; _enr uuid; _enr2 uuid; _a uuid;
    _lm jsonb; _avg numeric; _cov int;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-lm@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'M') returning id into _subj;
    insert into competency_group (course_id, name) values (_course, 'Core') returning id into _grp;
    insert into section (course_id, subject_id, competency_group_id, name) values (_course, _subj, _grp, 'S1') returning id into _sect1;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'S2') returning id into _sect2;
    insert into tag (section_id, label) values (_sect1, 'T1') returning id into _t1;
    insert into tag (section_id, label) values (_sect1, 'T2') returning id into _t2;
    insert into tag (section_id, label) values (_sect2, 'T3') returning id into _t3;
    insert into student (teacher_id, first_name) values (_uid, 'A') returning id into _stu;
    insert into student (teacher_id, first_name) values (_uid, 'B') returning id into _stu2;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into enrollment (student_id, course_id) values (_stu2, _course) returning id into _enr2;
    insert into assessment (course_id, title) values (_course, 'A') returning id into _a;
    insert into assessment_tag (assessment_id, tag_id) values (_a, _t1), (_a, _t2);
    insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (_enr, _a, _t1, 3);
    insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (_enr2, _a, _t1, 4);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);
    _lm := get_learning_map(_course);

    assert jsonb_array_length(_lm->'competency_groups') = 1;
    assert jsonb_array_length(_lm->'subjects') = 1;
    assert jsonb_array_length(_lm->'subjects'->0->'sections') = 2;

    select (t->>'class_avg')::numeric, (t->>'coverage_count')::int into _avg, _cov
      from jsonb_array_elements(_lm->'subjects'->0->'sections'->0->'tags') t
     where (t->>'id')::uuid = _t1;
    assert _avg = 3.5 and _cov = 1;

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 16.  get_class_dashboard (Phase 5.4.2)
-- ═════════════════════════════════════════════════════════════════════════
\echo [16/23] get_class_dashboard
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _grp uuid; _sect uuid; _t1 uuid; _t2 uuid;
    _s1 uuid; _s2 uuid; _s3 uuid; _e1 uuid; _e2 uuid; _e3 uuid;
    _a1 uuid; _a2 uuid; _db jsonb;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-dash@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name, grading_system) values (_uid, 'c', 'proficiency') returning id into _course;
    insert into subject (course_id, name) values (_course, 'M') returning id into _subj;
    insert into competency_group (course_id, name) values (_course, 'Core') returning id into _grp;
    insert into section (course_id, subject_id, competency_group_id, name) values (_course, _subj, _grp, 'S') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T1') returning id into _t1;
    insert into tag (section_id, label) values (_sect, 'T2') returning id into _t2;
    insert into student (teacher_id, first_name) values (_uid, 'A') returning id into _s1;
    insert into student (teacher_id, first_name) values (_uid, 'B') returning id into _s2;
    insert into student (teacher_id, first_name) values (_uid, 'C') returning id into _s3;
    insert into enrollment (student_id, course_id) values (_s1, _course) returning id into _e1;
    insert into enrollment (student_id, course_id) values (_s2, _course) returning id into _e2;
    insert into enrollment (student_id, course_id, is_flagged) values (_s3, _course, true) returning id into _e3;
    insert into assessment (course_id, title) values (_course, 'A1') returning id into _a1;
    insert into assessment (course_id, title) values (_course, 'A2') returning id into _a2;
    insert into assessment_tag (assessment_id, tag_id) values (_a1, _t1), (_a1, _t2), (_a2, _t1);
    insert into score (enrollment_id, assessment_id, value) values (_e1, _a1, 4), (_e2, _a1, 2), (_e3, _a1, 3), (_e1, _a2, 4), (_e2, _a2, 1);
    insert into tag_score (enrollment_id, assessment_id, tag_id, value)
         values (_e1, _a1, _t1, 4), (_e2, _a1, _t1, 2), (_e3, _a1, _t2, 3),
                (_e1, _a2, _t1, 4), (_e2, _a2, _t1, 1);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);
    _db := get_class_dashboard(_course);

    assert (_db->>'flagged_count')::int = 1;
    assert jsonb_array_length(_db->'per_assessment_avg') = 2;
    assert (_db->'letter_histogram') = 'null'::jsonb;
    assert (_db->>'class_avg_proficiency')::numeric between 1 and 4;

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 17.  get_term_rating (Phase 5.4.3)
-- ═════════════════════════════════════════════════════════════════════════
\echo [17/23] get_term_rating
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _t uuid;
    _stu uuid; _enr uuid; _a uuid; _obs uuid;
    _tr jsonb; _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-tr@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'M') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'S') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _t;
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into assessment (course_id, title) values (_course, 'A') returning id into _a;
    insert into observation (course_id, body) values (_course, 'O') returning id into _obs;
    insert into observation_student (observation_id, enrollment_id) values (_obs, _enr);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _tr := get_term_rating(_enr, 2);
    assert (_tr->'term_rating') = 'null'::jsonb;
    assert jsonb_array_length(_tr->'pickers'->'observations') = 1;

    _ok := false;
    begin perform get_term_rating(_enr, 7); exception when others then _ok := true; end;
    assert _ok, 'term 7 rejected';

    perform save_term_rating(_enr, 2, jsonb_build_object('narrative_html','x','work_habits_rating',3));
    _tr := get_term_rating(_enr, 2);
    assert (_tr->'term_rating'->>'narrative_html') = 'x';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 18.  get_observations (Phase 5.4.4)
-- ═════════════════════════════════════════════════════════════════════════
\echo [18/23] get_observations
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _tag uuid;
    _s1 uuid; _s2 uuid; _e1 uuid; _e2 uuid; _ct uuid;
    _o1 uuid; _o2 uuid; _o3 uuid; _res jsonb;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-obs@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'M') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'S') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _tag;
    insert into student (teacher_id, first_name) values (_uid, 'A') returning id into _s1;
    insert into student (teacher_id, first_name) values (_uid, 'B') returning id into _s2;
    insert into enrollment (student_id, course_id) values (_s1, _course) returning id into _e1;
    insert into enrollment (student_id, course_id) values (_s2, _course) returning id into _e2;
    insert into custom_tag (course_id, label) values (_course, 'CT') returning id into _ct;
    insert into observation (course_id, body, sentiment) values (_course, 'alpha', 'strength') returning id into _o1;
    insert into observation_student (observation_id, enrollment_id) values (_o1, _e1);
    insert into observation_tag (observation_id, tag_id) values (_o1, _tag);
    insert into observation (course_id, body, sentiment) values (_course, 'beta', 'growth') returning id into _o2;
    insert into observation_student (observation_id, enrollment_id) values (_o2, _e2);
    insert into observation_custom_tag (observation_id, custom_tag_id) values (_o2, _ct);
    insert into observation (course_id, body, sentiment) values (_course, 'gamma zebra', 'strength') returning id into _o3;
    insert into observation_student (observation_id, enrollment_id) values (_o3, _e1), (_o3, _e2);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _res := get_observations(_course, '{}'::jsonb, 1, 50);
    assert (_res->>'total')::int = 3;

    _res := get_observations(_course, jsonb_build_object('enrollment_id', _e1::text), 1, 50);
    assert (_res->>'total')::int = 2;

    _res := get_observations(_course, jsonb_build_object('tag_ids', jsonb_build_array(_tag::text)), 1, 50);
    assert (_res->>'total')::int = 1;

    _res := get_observations(_course, jsonb_build_object('search', 'zebra'), 1, 50);
    assert (_res->>'total')::int = 1;

    _res := get_observations(_course, '{}'::jsonb, 1, 2);
    assert (_res->>'has_more')::boolean = true;

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 19.  get_assessment_detail (Phase 5.4.5)
-- ═════════════════════════════════════════════════════════════════════════
\echo [19/23] get_assessment_detail
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _t uuid;
    _cat uuid; _rub uuid; _crit uuid;
    _stu uuid; _enr uuid;
    _a_plain uuid; _a_rub uuid; _r jsonb; _ok boolean;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-ad@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'M') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'S') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _t;
    insert into category (course_id, name, weight) values (_course, 'Tests', 40) returning id into _cat;
    insert into rubric (course_id, name) values (_course, 'R') returning id into _rub;
    insert into criterion (rubric_id, name) values (_rub, 'C') returning id into _crit;
    insert into criterion_tag (criterion_id, tag_id) values (_crit, _t);
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into assessment (course_id, title, category_id) values (_course, 'Plain', _cat) returning id into _a_plain;
    insert into assessment_tag (assessment_id, tag_id) values (_a_plain, _t);
    insert into score (enrollment_id, assessment_id, value) values (_enr, _a_plain, 3.5);
    insert into assessment (course_id, title, rubric_id) values (_course, 'Rubric', _rub) returning id into _a_rub;
    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) values (_enr, _a_rub, _crit, 3);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _r := get_assessment_detail(_a_plain);
    assert (_r->'category'->>'id')::uuid = _cat;
    assert jsonb_array_length(_r->'linked_tags') = 1;
    assert ((_r->'cells'->0->'overall'->>'value')::numeric) = 3.5;

    _r := get_assessment_detail(_a_rub);
    assert jsonb_array_length(_r->'criteria') = 1;
    assert ((_r->'cells'->0->'overall'->>'value')::numeric) = 3;

    _ok := false;
    begin perform get_assessment_detail(gen_random_uuid()); exception when others then _ok := true; end;
    assert _ok, 'not-found should raise';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 20.  get_report (Phase 5.4.6)
-- ═════════════════════════════════════════════════════════════════════════
\echo [20/23] get_report
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _tag uuid;
    _stu uuid; _enr uuid; _a uuid; _rep jsonb;
    _has bool;
begin
  begin
    insert into teacher (id, email, display_name) values (_uid, 'smoke-rep@t', 'T');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name, grade_level) values (_uid, 'Sci', '8') returning id into _course;
    insert into subject (course_id, name) values (_course, 'Bio') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'Cells') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T') returning id into _tag;
    insert into student (teacher_id, first_name, last_name) values (_uid, 'Alice', 'A') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into assessment (course_id, title) values (_course, 'Q1') returning id into _a;
    insert into assessment_tag (assessment_id, tag_id) values (_a, _tag);
    insert into score (enrollment_id, assessment_id, value) values (_enr, _a, 3);
    insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (_enr, _a, _tag, 3);
    insert into goal (enrollment_id, section_id, body) values (_enr, _sect, 'x');
    insert into report_config (course_id, preset, blocks_config) values (_course, 'detailed',
      jsonb_build_object('header',true,'narrative',true,'grades',true,'competencies',true,
                         'goals',true,'reflections',true,'attendance',true,
                         'strengths',true,'growth',true));

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    perform save_term_rating(_enr, 2, jsonb_build_object(
      'narrative_html','<p>n</p>','strength_tags', jsonb_build_array(_tag::text)));

    _rep := get_report(_enr);
    assert jsonb_array_length(_rep->'blocks') >= 5;
    select exists (select 1 from jsonb_array_elements(_rep->'blocks') b
                   where b->>'type' = 'strengths'
                     and jsonb_array_length(b->'data'->'tags') = 1)
      into _has;
    assert _has, 'strengths block';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 21.  get_student_profile competency_tree backfill (Phase 5.4.7)
-- ═════════════════════════════════════════════════════════════════════════
\echo [21/23] get_student_profile.competency_tree
do $$
declare
    _uid uuid := gen_random_uuid();
    _course uuid; _subj uuid; _sect uuid; _t1 uuid; _t2 uuid;
    _stu uuid; _enr uuid; _a uuid; _prof jsonb; _tag_row jsonb;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-prof@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _course;
    insert into subject (course_id, name) values (_course, 'M') returning id into _subj;
    insert into section (course_id, subject_id, name) values (_course, _subj, 'S') returning id into _sect;
    insert into tag (section_id, label) values (_sect, 'T1') returning id into _t1;
    insert into tag (section_id, label) values (_sect, 'T2') returning id into _t2;
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _course) returning id into _enr;
    insert into assessment (course_id, title) values (_course, 'A') returning id into _a;
    insert into assessment_tag (assessment_id, tag_id) values (_a, _t1);
    insert into score (enrollment_id, assessment_id, value) values (_enr, _a, 3);
    insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (_enr, _a, _t1, 4);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _prof := get_student_profile(_enr);
    assert _prof->'competency_tree' <> 'null'::jsonb;
    assert jsonb_array_length(_prof->'competency_tree'->'subjects'->0->'sections'->0->'tags') = 2;

    select t into _tag_row
      from jsonb_array_elements(_prof->'competency_tree'->'subjects'->0->'sections'->0->'tags') t
     where (t->>'id')::uuid = _t1;
    assert (_tag_row->>'latest_value')::int = 4;
    assert (_tag_row->>'coverage_count')::int = 1;

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 22.  delete_student + relink_student (Phase 5.5.1 + 5.5.2)
-- ═════════════════════════════════════════════════════════════════════════
\echo [22/23] delete_student + relink_student
do $$
declare
    _uid uuid := gen_random_uuid();
    _c uuid; _stu uuid; _e uuid; _a uuid;
    _ghost uuid; _canon uuid; _ge uuid; _ce uuid;
    _res jsonb; _d text[];
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-del@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _c;
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _c) returning id into _e;
    insert into assessment (course_id, title) values (_c, 'A') returning id into _a;
    insert into score (enrollment_id, assessment_id, value) values (_e, _a, 3);

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    perform delete_student(_stu);
    assert not exists (select 1 from student where id = _stu);
    assert not exists (select 1 from enrollment where student_id = _stu);
    assert not exists (select 1 from score where enrollment_id = _e);
    assert exists (select 1 from course where id = _c);

    -- relink merge path
    insert into student (teacher_id, first_name) values (_uid, 'G') returning id into _ghost;
    insert into student (teacher_id, first_name) values (_uid, 'C') returning id into _canon;
    insert into enrollment (student_id, course_id, designations) values (_ghost, _c, array['IEP']) returning id into _ge;
    insert into enrollment (student_id, course_id, designations) values (_canon, _c, array['ELL']) returning id into _ce;

    _res := relink_student(_ghost, _canon);
    assert (_res->>'enrollments_merged')::int = 1;
    assert not exists (select 1 from student where id = _ghost);

    select designations into _d from enrollment where id = _ce;
    assert _d @> array['IEP'];
    assert _d @> array['ELL'];

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 23.  clear_data (Phase 5.5.3)
-- ═════════════════════════════════════════════════════════════════════════
\echo [23/23] clear_data
do $$
declare
    _uid uuid := gen_random_uuid();
    _other uuid := gen_random_uuid();
    _c uuid; _stu uuid; _enr uuid; _res jsonb;
begin
  begin
    insert into teacher (id, email) values (_uid, 'smoke-clr@t');
    insert into teacher_preference (teacher_id) values (_uid);
    insert into course (teacher_id, name) values (_uid, 'c') returning id into _c;
    update teacher_preference set active_course_id = _c where teacher_id = _uid;
    insert into student (teacher_id, first_name) values (_uid, 'S') returning id into _stu;
    insert into enrollment (student_id, course_id) values (_stu, _c) returning id into _enr;
    insert into teacher (id, email) values (_other, 'other@t');
    insert into teacher_preference (teacher_id) values (_other);
    insert into course (teacher_id, name) values (_other, 'O');

    perform set_config('request.jwt.claim.sub', _uid::text, true);
    perform set_config('role', 'authenticated', true);

    _res := clear_data();
    assert (_res->>'courses')::int = 1;
    assert (_res->>'students')::int = 1;
    assert not exists (select 1 from course where teacher_id = _uid);
    assert (select active_course_id from teacher_preference where teacher_id = _uid) is null;
    assert exists (select 1 from teacher where id = _uid);
    assert exists (select 1 from course where teacher_id = _other), 'other teacher''s data preserved';

    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if; end;
end $$;
