-- BATCH A, UNDONE. Not a migration: a way back, written and tested before
-- Batch A (migrations/2026110901 to 2026110904, PR 966) is applied.
--
-- It lives under migrations/local-test/ on purpose: CI's drift check treats
-- every file in migrations/ as something to be applied, and this is only to
-- be run if Batch A has to come out.
--
-- THREE PARTS, each its own transaction (begin ... commit), each with its
-- checks first and a five-second lock timeout, each safe to run again. Run
-- one part by pasting from its "begin;" to its "commit;".
--
--   PART 1   The fast stop. Drops Batch A's 18 triggers: the 12 statement
--            triggers and 3 re-pointing triggers on score, tag_score,
--            rubric_score and rubric_check_score, the 2 on enrollment and
--            assessment deletes, and the 1 on course settings. Nothing else.
--            Safe in seconds with teachers working: each drop takes a short
--            lock on its table. After it no save, delete or setting change
--            runs any Batch A code.
--            DESTROYS: nothing. But grade_return stops following the grades
--            from that moment: it is frozen, and wrong for any grade saved
--            afterwards. That does not matter while every class's student
--            page is off (nothing reads it). If a class has it ON, students
--            in that class keep seeing whatever was Returned when the
--            triggers were dropped, and every grade saved after it is shown
--            to them at once whether the teacher returned it or not, until
--            PART 2 is run or Batch A's file 02 is run again.
--            To turn Batch A back on after PART 1 alone: run
--            2026110902_grade_return.sql again. It recreates the triggers,
--            its backfill makes a row (Returned) for any graded cell saved
--            in between, and its last statement brings every working copy
--            up to date.
--
--   PART 1B  The five score-table policies as they were before file 01
--            (the caller owns the enrollment, and nothing more). PART 1 does
--            not touch them: file 01 is independent of the rest, and a save
--            it refuses says "violates row-level security policy" (42501).
--            Run this only if that is the trouble. Fast: a short lock on
--            each of the five tables.
--            DESTROYS: nothing. A teacher can again save a score against
--            another class's assessment by sending its id, as today.
--
--   PART 2   The full removal. Everything the four files created or changed
--            goes, in an order that works, and the seven functions they
--            patched are put back to their bodies of before by making each
--            edit backwards; then each is checked against its fingerprint on
--            the live database before Batch A (md5 of pg_get_functiondef),
--            and the transaction fails, with nothing changed, if any is not
--            exactly that. It includes PART 1 and PART 1B, so it can be run
--            without them.
--            DESTROYS, for good:
--              grade_return            which grades are Draft and which
--                                      Returned, when each was returned,
--                                      what each student was shown before a
--                                      change, and when they last opened a
--                                      piece
--              student_card            every card: its code, its password,
--                                      when it was printed and last used,
--                                      its wrong tries and lock
--              device sessions         every signed-in phone
--              the sign-in log         the rows for card scans (route
--                                      'card'); slip rows stay
--              three class settings    student_page_enabled, return_grades
--                                      and cards_work_until, on every class
--            While no class has the student page on, none of that has been
--            used and nothing is lost that anyone has seen. After a class
--            HAS used it: every printed card stops working and must be
--            printed again if Batch A returns (new codes); every student in
--            it is signed out; the line between Draft and Returned is gone,
--            so on re-applying Batch A every grade there is, drafts
--            included, comes back as Returned (its backfill), and the
--            "Updated" marks and "since you last looked" are lost.
--            NOT touched, ever: score, tag_score, rubric_score,
--            rubric_check_score, dibels_score. No grade, level, comment,
--            tick, status or Note for the Report changes in any part.
--
-- Written for Batch A alone. PART 2 refuses to run if 2026110905 (S0-M4b)
-- is in: that file adds functions, triggers and a nightly job this script
-- does not know.
--
-- After PART 2 the database is as it was before Batch A, and the four files
-- apply again cleanly. migrations/local-test/batch_a_undo.py proves both:
-- the whole catalog compared line by line, and every table's rows.
--
-- GENERATED from the four files and from the difference between a database
-- without them and with them (scratch tool; the proof is batch_a_undo.py).

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1: the fast stop
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $guard$
begin
    -- Nothing to check but that the tables are there: every drop below is
    -- "if exists", so a second run does nothing.
    perform 'public.score'::regclass, 'public.tag_score'::regclass, 'public.rubric_score'::regclass,
            'public.rubric_check_score'::regclass, 'public.enrollment'::regclass, 'public.assessment'::regclass,
            'public.course'::regclass;
end
$guard$;

drop trigger if exists grade_return_gone on public.assessment;
drop trigger if exists grade_return_release on public.course;
drop trigger if exists grade_return_gone on public.enrollment;
drop trigger if exists grade_return_delete on public.rubric_check_score;
drop trigger if exists grade_return_insert on public.rubric_check_score;
drop trigger if exists grade_return_repoint on public.rubric_check_score;
drop trigger if exists grade_return_update on public.rubric_check_score;
drop trigger if exists grade_return_delete on public.rubric_score;
drop trigger if exists grade_return_insert on public.rubric_score;
drop trigger if exists grade_return_repoint on public.rubric_score;
drop trigger if exists grade_return_update on public.rubric_score;
drop trigger if exists grade_return_delete on public.score;
drop trigger if exists grade_return_insert on public.score;
drop trigger if exists grade_return_update on public.score;
drop trigger if exists grade_return_delete on public.tag_score;
drop trigger if exists grade_return_insert on public.tag_score;
drop trigger if exists grade_return_repoint on public.tag_score;
drop trigger if exists grade_return_update on public.tag_score;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1B: the five score-table policies as they were before file 01
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $guard$
begin
    perform 'public.fv_owns_enrollment(uuid)'::regprocedure;
end
$guard$;

drop policy if exists score_same_class on public.score;
drop policy if exists score_via_enrollment on public.score;
create policy score_via_enrollment on public.score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists tag_score_same_class on public.tag_score;
drop policy if exists tag_score_via_enrollment on public.tag_score;
create policy tag_score_via_enrollment on public.tag_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_score_same_class on public.rubric_score;
drop policy if exists rubric_score_via_enrollment on public.rubric_score;
create policy rubric_score_via_enrollment on public.rubric_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_check_score_same_class on public.rubric_check_score;
drop policy if exists rubric_check_score_via_enrollment on public.rubric_check_score;
create policy rubric_check_score_via_enrollment on public.rubric_check_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists dibels_score_same_class on public.dibels_score;
drop policy if exists dibels_score_via_enrollment on public.dibels_score;
create policy dibels_score_via_enrollment on public.dibels_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2: the full removal
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _def text;
begin
    if to_regprocedure('public.grade_return_repair()') is not null then
        raise exception '2026110905 (S0-M4b) is applied, and this script does not know it. Nothing was changed.';
    end if;
    -- Each of the seven functions must be either the function Batch A left
    -- (it carries the line Batch A added) or already the one from before (a
    -- second run). Anything else: stop.
    for _f in
        select * from (values
            ('public.update_course(uuid,jsonb)', '8aacf4f24b0b7133352379e89978776b'),
            ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', '92f7ff4b840c1dd9fe473f8ecdee29b5'),
            ('public.duplicate_course(uuid,uuid)', '528aacf8cb9581682178b1914a32fc20'),
            ('public.import_json_restore(jsonb,uuid)', '58e48ae4f7ebcc05489b489a4f8906df'),
            ('public._issue_access_code(uuid,uuid,timestamptz)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('student_submit.open(text,text)', '91123d2f5a0d964be66b62ee8f91c047')
        ) as v(fn, was)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        if md5(_def) <> _f.was and not exists (
                select 1 from (values

                    ('public.update_course(uuid,jsonb)', $m$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,
        student_page_enabled = case when p_patch ? 'student_page_enabled'
                                then coalesce((p_patch->>'student_page_enabled')::boolean, false)
                                else student_page_enabled end,
        return_grades    = case when p_patch ? 'return_grades'
                                then nullif(p_patch->>'return_grades', '')
                                else return_grades end,$m$),
                    ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', $m$    -- Draft and Returned: the updates below point scores at the copy's
    -- criteria and checkboxes. They are a rubric move, not a change to any
    -- grade, and the triggers read this flag to know it. Only a move to
    -- another rubric is one: a map that starts from a criterion or checkbox
    -- of the target rubric itself swaps levels inside one rubric, and that
    -- is a change like any other.
    perform set_config('fv.moving_rubric',
        case when exists (select 1 from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
                            join criterion c on c.id::text = m.key where c.rubric_id = p_rubric_id)
               or exists (select 1 from jsonb_each_text(coalesce(p_check_map, '{}')) m
                            join criterion_check ck on ck.id::text = m.key
                            join criterion c on c.id = ck.criterion_id where c.rubric_id = p_rubric_id)
             then '' else 'on' end, true);

    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$m$),
                    ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', $m$    -- The copies kept for students follow the scores to the new ids, also
    -- where the working copy no longer has the row.
    perform fv_private.grade_return_remap(p_assessment_id, p_criterion_map, p_check_map);
    perform set_config('fv.moving_rubric', '', true);

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$m$),
                    ('public.duplicate_course(uuid,uuid)', $m$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades)$m$),
                    ('public.duplicate_course(uuid,uuid)', $m$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades
$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally, student_page_enabled, return_grades)$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$                coalesce((_row->>'courses_count_equally')::boolean, false),
                -- A backup from before Draft and Returned has neither: the
                -- student page is off and no choice is made (works as on_save).
                coalesce((_row->>'student_page_enabled')::boolean, false),
                nullif(_row->>'return_grades', ''))$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$          courses_count_equally=excluded.courses_count_equally,
          student_page_enabled=excluded.student_page_enabled, return_grades=excluded.return_grades,$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$    -- Draft and Returned: the state in the backup, or Returned for a
    -- backup that has none. The score-table triggers stood aside above.
    perform fv_private.restore_grade_returns(p_payload);

    perform set_config('fv.restoring', '', true);$m$),
                    ('public._issue_access_code(uuid,uuid,timestamptz)', $m$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$m$),
                    ('public._issue_report_code(uuid,uuid,timestamptz)', $m$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$m$),
                    ('student_submit.open(text,text)', $m$           and at > now() - interval '15 minutes') >= 300 then$m$)
                ) as e(fn, added) where e.fn = _f.fn and position(e.added in _def) > 0) then
            raise exception '% is neither the function Batch A left nor the one from before it (md5 %). Nothing was changed.',
                _f.fn, md5(_def);
        end if;
    end loop;
end
$guard$;

-- The triggers (PART 1).
drop trigger if exists grade_return_gone on public.assessment;
drop trigger if exists grade_return_release on public.course;
drop trigger if exists grade_return_gone on public.enrollment;
drop trigger if exists grade_return_delete on public.rubric_check_score;
drop trigger if exists grade_return_insert on public.rubric_check_score;
drop trigger if exists grade_return_repoint on public.rubric_check_score;
drop trigger if exists grade_return_update on public.rubric_check_score;
drop trigger if exists grade_return_delete on public.rubric_score;
drop trigger if exists grade_return_insert on public.rubric_score;
drop trigger if exists grade_return_repoint on public.rubric_score;
drop trigger if exists grade_return_update on public.rubric_score;
drop trigger if exists grade_return_delete on public.score;
drop trigger if exists grade_return_insert on public.score;
drop trigger if exists grade_return_update on public.score;
drop trigger if exists grade_return_delete on public.tag_score;
drop trigger if exists grade_return_insert on public.tag_score;
drop trigger if exists grade_return_repoint on public.tag_score;
drop trigger if exists grade_return_update on public.tag_score;

-- The five policies as they were (PART 1B), then file 01's four helpers.
drop policy if exists score_same_class on public.score;
drop policy if exists score_via_enrollment on public.score;
create policy score_via_enrollment on public.score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists tag_score_same_class on public.tag_score;
drop policy if exists tag_score_via_enrollment on public.tag_score;
create policy tag_score_via_enrollment on public.tag_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_score_same_class on public.rubric_score;
drop policy if exists rubric_score_via_enrollment on public.rubric_score;
create policy rubric_score_via_enrollment on public.rubric_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_check_score_same_class on public.rubric_check_score;
drop policy if exists rubric_check_score_via_enrollment on public.rubric_check_score;
create policy rubric_check_score_via_enrollment on public.rubric_check_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists dibels_score_same_class on public.dibels_score;
drop policy if exists dibels_score_via_enrollment on public.dibels_score;
create policy dibels_score_via_enrollment on public.dibels_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop function if exists public.fv_owns_rubric_check_cell(uuid,uuid,uuid);
drop function if exists public.fv_owns_rubric_score_cell(uuid,uuid,uuid);
drop function if exists public.fv_owns_score_cell(uuid,uuid);
drop function if exists public.fv_owns_tag_score_cell(uuid,uuid,uuid);

-- The seven patched functions: each edit made backwards, in the reverse of
-- the order Batch A made them.
do $unpatch$
declare
    _edits text[][] := array[
      -- function, the text Batch A put in, the text that was there
      array['public.update_course(uuid,jsonb)',
$s$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,
        student_page_enabled = case when p_patch ? 'student_page_enabled'
                                then coalesce((p_patch->>'student_page_enabled')::boolean, false)
                                else student_page_enabled end,
        return_grades    = case when p_patch ? 'return_grades'
                                then nullif(p_patch->>'return_grades', '')
                                else return_grades end,$s$,
$s$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,$s$],
      array['public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)',
$s$    -- Draft and Returned: the updates below point scores at the copy's
    -- criteria and checkboxes. They are a rubric move, not a change to any
    -- grade, and the triggers read this flag to know it. Only a move to
    -- another rubric is one: a map that starts from a criterion or checkbox
    -- of the target rubric itself swaps levels inside one rubric, and that
    -- is a change like any other.
    perform set_config('fv.moving_rubric',
        case when exists (select 1 from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
                            join criterion c on c.id::text = m.key where c.rubric_id = p_rubric_id)
               or exists (select 1 from jsonb_each_text(coalesce(p_check_map, '{}')) m
                            join criterion_check ck on ck.id::text = m.key
                            join criterion c on c.id = ck.criterion_id where c.rubric_id = p_rubric_id)
             then '' else 'on' end, true);

    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$s$,
$s$    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$s$],
      array['public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)',
$s$    -- The copies kept for students follow the scores to the new ids, also
    -- where the working copy no longer has the row.
    perform fv_private.grade_return_remap(p_assessment_id, p_criterion_map, p_check_map);
    perform set_config('fv.moving_rubric', '', true);

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$,
$s$    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$],
      array['public.duplicate_course(uuid,uuid)',
$s$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades)$s$,
$s$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally)$s$],
      array['public.duplicate_course(uuid,uuid)',
$s$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades
$s$,
$s$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally
$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally, student_page_enabled, return_grades)$s$,
$s$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally)$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$                coalesce((_row->>'courses_count_equally')::boolean, false),
                -- A backup from before Draft and Returned has neither: the
                -- student page is off and no choice is made (works as on_save).
                coalesce((_row->>'student_page_enabled')::boolean, false),
                nullif(_row->>'return_grades', ''))$s$,
$s$                coalesce((_row->>'courses_count_equally')::boolean, false))$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$          courses_count_equally=excluded.courses_count_equally,
          student_page_enabled=excluded.student_page_enabled, return_grades=excluded.return_grades,$s$,
$s$          courses_count_equally=excluded.courses_count_equally,$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$    -- Draft and Returned: the state in the backup, or Returned for a
    -- backup that has none. The score-table triggers stood aside above.
    perform fv_private.restore_grade_returns(p_payload);

    perform set_config('fv.restoring', '', true);$s$,
$s$    perform set_config('fv.restoring', '', true);$s$],
      array['public._issue_access_code(uuid,uuid,timestamptz)',
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$s$,
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));$s$],
      array['public._issue_report_code(uuid,uuid,timestamptz)',
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$s$,
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));$s$],
      array['student_submit.open(text,text)',
$s$           and at > now() - interval '15 minutes') >= 300 then$s$,
$s$           and at > now() - interval '15 minutes') >= 60 then$s$]
    ];
    _def  text;
    _hits int;
    i     int;
begin
    for i in reverse array_length(_edits, 1) .. 1 loop
        _def := pg_get_functiondef(_edits[i][1]::regprocedure);
        _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
        continue when _hits = 0;   -- already as it was
        if _hits <> 1 then
            raise exception '% has % matches for a line Batch A added, expected 1', _edits[i][1], _hits;
        end if;
        execute replace(_def, _edits[i][2], _edits[i][3]);
    end loop;
end
$unpatch$;

-- The functions of file 04, file 03 and file 02, before the tables: some
-- return a row of one.
drop function if exists student_submit._card_lookup(text,text);
drop function if exists student_submit._card_refusal(uuid);
drop function if exists student_submit._device_session(text);
drop function if exists student_submit._midnight(text);
drop function if exists student_submit._returned_grade(uuid,uuid);
drop function if exists student_submit._session_class(text,uuid);
drop function if exists student_submit._session_classes(uuid);
drop function if exists student_submit.card(text,text);
drop function if exists student_submit.done(text,text);
drop function if exists student_submit.page(text,uuid,text);
drop function if exists student_submit.seen(text,uuid,uuid[],text);
drop function if exists student_submit.verify_card(text,text,text,text,text,text,boolean);
drop function if exists fv_private.grade_return_remap(uuid,jsonb,jsonb);
drop function if exists fv_private.restore_grade_returns(jsonb);
drop function if exists public._cards_work_until(uuid);
drop function if exists public._fv_date(text);
drop function if exists public._fv_timezone(text);
drop function if exists public._grade_copy(uuid,uuid);
drop function if exists public._grade_copy_entry(integer,integer,text,text,boolean);
drop function if exists public._grade_copy_in_use(jsonb,uuid);
drop function if exists public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb);
drop function if exists public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb);
drop function if exists public._grade_return_apply(uuid,uuid,jsonb,jsonb);
drop function if exists public._grade_return_gone();
drop function if exists public._grade_return_holds(uuid);
drop function if exists public._grade_return_lock(uuid);
drop function if exists public._grade_return_lock_first(uuid);
drop function if exists public._grade_return_on_change();
drop function if exists public._grade_return_one(uuid,uuid,timestamp with time zone);
drop function if exists public._grade_return_release();
drop function if exists public._grade_return_repoint();
drop function if exists public._issue_student_card(uuid,text);
drop function if exists public._student_card_json(uuid);
drop function if exists public.course_draft_count(uuid);
drop function if exists public.issue_student_cards(uuid,uuid[],uuid);
drop function if exists public.list_course_grade_returns(uuid);
drop function if exists public.list_student_cards(uuid);
drop function if exists public.mark_student_cards_printed(uuid[],uuid);
drop function if exists public.reissue_student_card(uuid,uuid);
drop function if exists public.return_grades(uuid,uuid[],uuid);
drop function if exists public.set_cards_work_until(uuid,date,uuid);
drop function if exists public.unlock_all_student_cards(uuid,uuid);
drop function if exists public.unlock_student_card(uuid,uuid);


-- The tables, newest first (a later one points at an earlier one).
drop table if exists student_submit.device_session_enrollment;
drop table if exists student_submit.device_session;
drop table if exists public.student_card;
drop table if exists public.grade_return;
drop schema if exists fv_private;

-- The sign-in log takes 'open' and 'submit' again; its card rows go first.
do $attempt$
begin
    if exists (select 1 from pg_constraint where conrelid = 'student_submit.attempt'::regclass and conname = 'attempt_route_check'
                  and pg_get_constraintdef(oid) like '%card%') then
        delete from student_submit.attempt where route = 'card';
        alter table student_submit.attempt drop constraint attempt_route_check;
        alter table student_submit.attempt add constraint attempt_route_check
            check (route = any (array['open'::text, 'submit'::text]));
    end if;
end
$attempt$;

-- The three class settings.
alter table public.course drop constraint if exists course_return_grades_check;
alter table public.course drop column if exists cards_work_until;
alter table public.course drop column if exists return_grades;
alter table public.course drop column if exists student_page_enabled;

-- Last: each of the seven must now be exactly the function from before
-- Batch A. If one is not, the whole of PART 2 is undone.
do $check$
declare
    _f record;
begin
    for _f in
        select * from (values
            ('public.update_course(uuid,jsonb)', '8aacf4f24b0b7133352379e89978776b'),
            ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', '92f7ff4b840c1dd9fe473f8ecdee29b5'),
            ('public.duplicate_course(uuid,uuid)', '528aacf8cb9581682178b1914a32fc20'),
            ('public.import_json_restore(jsonb,uuid)', '58e48ae4f7ebcc05489b489a4f8906df'),
            ('public._issue_access_code(uuid,uuid,timestamptz)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('student_submit.open(text,text)', '91123d2f5a0d964be66b62ee8f91c047')
        ) as v(fn, was)
    loop
        if md5(pg_get_functiondef(_f.fn::regprocedure)) <> _f.was then
            raise exception '% did not come back as the function from before Batch A (md5 %, expected %). Nothing was changed.',
                _f.fn, md5(pg_get_functiondef(_f.fn::regprocedure)), _f.was;
        end if;
    end loop;
end
$check$;

notify pgrst, 'reload schema';

commit;
