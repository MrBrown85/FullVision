-- Mark Up and Revisions: the part that changes how a grade is returned or
-- stored (2026-11-11). Student page build plan, Batch C, second file (C2).
-- The first file is 2026111120_markup_reflect_revise.sql (C1); this one
-- needs it, and Batch B, applied first.
--
-- THIS FILE CHANGES EXISTING GRADE ROWS AND RUNS INSIDE EVERY GRADE SAVE.
-- It waits for the owner's review and his word (project rules 1 and 2;
-- the standing OK of Nov 10 does not cover it). Everything else of Batch C
-- is in C1, which can be applied without this file.
--
-- ── What it changes, and why each could not be in C1 ────────────────────────
-- 1. HIDE THE GRADE DURING A REVISION (Return for Revision, "Hide the grade
--    from Jordan until then"). C1's three stand-ins are replaced:
--      public._revision_hide_available()   now true
--      public._revision_hide_grade(id)     hides the grade
--      public._revision_unhide_grade(id)   gives it back
--    Hiding writes the student's existing grade_return row: the grade the
--    student was given stops being shown to them (returned_at, updated_at
--    and returned_copy are cleared and the row becomes a draft), as "a
--    grade hidden during a revision is a draft" (DECISIONS, "Student page
--    build answers" 6) says. What the student had is kept on the request
--    (revision_request.hidden_state) so taking the request back gives it
--    back exactly. When the new version is graded and returned, the row is
--    returned as any draft is (return_grades, unchanged).
--    Why not C1: it changes a row about a student's grade that exists
--    today, and what the student page and every report count.
-- 2. MARKS ARE GIVEN WHENEVER A GRADE IS RETURNED, BY ANY PATH. A trigger
--    on grade_return (markup_given_on_return) gives the student the
--    teacher's marks on a piece each time its grade is returned: by
--    return_grades from an older screen, by the class leaving When I
--    Return Them (2026110902's release), by a save in a class that returns
--    at once, by a restore. C1's return_work already gives them for the
--    screens that call it; this closes the other paths.
--    Why not C1: it runs inside every grade save and every Return. A fault
--    in it would stop teachers saving or returning grades.
--
-- Nothing else: no score, level, comment or tick changes; no existing
-- function of Batch A or Batch B is replaced. The grade math (shared/
-- calc.js) is not here: "a graded revision's new grade replaces the old"
-- needs no change to how a grade is stored, because a revision is graded
-- in the same score rows and returned as any changed grade is (Draft and
-- Returned keep the student on the old grade until then), while the first
-- version's grade is kept on the request as history (C1).
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- On the apply: nothing. No request can be hiding a grade before this file
-- (C1 refuses to), and the trigger acts only on grade_return rows written
-- after it. After the apply: a Return for Revision with Hide changes that
-- student's grade_return row for that piece (1); a Return of any kind fills
-- markup.given for that piece (2).
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless C1 is applied and its three
-- stand-ins are C1's (or, on a second run, this file's), the functions the
-- new ones call are the definitions the tests ran against, and no trigger
-- of that name is on grade_return already (on a first run).
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/batch-c2-live-precheck.sql   expected: no rows.
-- migrations/local-test/batch-c2-live-postcheck.sql  expected: no rows.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/batch-c2-undo.sql (proved by batch_c_undo.py): every
-- grade still hidden is given back first, then the trigger goes and the
-- three stand-ins are put back as C1 left them.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f     record;
    _md5   text;
    _want  text;
    _first boolean;
begin
    if to_regclass('public.markup') is null or to_regclass('public.revision_request') is null then
        raise exception 'The first file of Batch C (2026111120) is not applied: apply it, then this file. Nothing was changed.';
    end if;
    _first := not exists (select 1 from pg_trigger t
                           where t.tgrelid = 'public.grade_return'::regclass and not t.tgisinternal
                             and t.tgname in ('markup_given_on_return', 'markup_given_on_insert'));
    -- The functions it calls, and the three it replaces (as C1 leaves them
    -- on a first run; as this file leaves them on a second).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN c2relied (written by migrations/local-test/batch_c_fingerprints.py)
            ('public._grade_copy(uuid,uuid)',                                '3a8e0dfbc873176692a1160150a8d43b', '3a8e0dfbc873176692a1160150a8d43b'),
            ('public._markup_give(uuid,uuid)',                               'f0f07a1b879ff038e2f0afe020233c29', 'f0f07a1b879ff038e2f0afe020233c29'),
            ('public.return_for_revision(uuid,uuid,jsonb,uuid)',             'f66c0fdd60dd969203a345125280d760', 'f66c0fdd60dd969203a345125280d760'),
            ('public.cancel_revision(uuid,uuid)',                            '03f508a459eb621f868b699a0ea3f076', '03f508a459eb621f868b699a0ea3f076'),
            ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)',            '89899f9dbc1569f7f1cc4216e252eb32', '89899f9dbc1569f7f1cc4216e252eb32'),
            ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689', '99e3165d005b5b2020ec40dcf307c689'),
            ('public._revision_hide_available()',                            'cd50f4c6493a73b3c42ae51f7580f970', 'a4b4e942de351d6849702b96f25c7356'),
            ('public._revision_hide_grade(uuid)',                            '247080f6572bb45951cef807a2b849bd', 'a4c3f002d3bb2fc01e58ec5b8dab8ecb'),
            ('public._revision_unhide_grade(uuid)',                          '26d2861325edf27f95d090ebd590eb0f', '12dd830d953d13db1617e40a27f35133'),
            ('public._markup_on_return()',                                   'absent', '7aee1528f49c74565268dd37d191afd0')
            -- FINGERPRINTS-END
        ) as v(fn, first_run, later_run)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        _want := case when _first then _f.first_run else _f.later_run end;
        if _md5 <> _want then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _want;
        end if;
    end loop;
    if _first and exists (select 1 from revision_request where grade_hidden) then
        raise exception 'a revision request is marked as hiding a grade, and this file was never applied. Nothing was changed.';
    end if;
end
$guard$;

-- ── 1. Hide the grade during a revision ─────────────────────────────────────
create or replace function public._revision_hide_available()
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select true;
$function$;

-- The caller (C1's return_for_revision) holds the class's lock and has just
-- returned the work, in a class that holds grades. The student's grade on
-- the piece stops showing: the row becomes a draft that was never
-- returned, as the student page and the reports read it. What the student
-- had is kept on the request. Returns false, changing nothing, when the
-- student has no returned grade on the piece.
create or replace function public._revision_hide_grade(p_request_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _r    revision_request%rowtype;
    _g    grade_return%rowtype;
    _copy jsonb;
begin
    select * into _r from revision_request where id = p_request_id and state = 'open' for update;
    if not found or _r.grade_hidden or _r.hide_ended_at is not null then
        return false;
    end if;
    select * into _g from grade_return
     where enrollment_id = _r.enrollment_id and assessment_id = _r.assessment_id
       for update;
    if not found or _g.returned_at is null then
        return false;
    end if;
    -- What the student sees now: the returned copy while a draft sits on it,
    -- else the grade as it is.
    _copy := case when _g.is_draft then _g.returned_copy else _grade_copy(_r.enrollment_id, _r.assessment_id) end;
    if _copy is null then
        return false;
    end if;
    -- The hide begins: what the student had is kept on the request, where
    -- nothing the teacher does to the score can reach it.
    update revision_request
       set grade_hidden = true,
           hidden_state = jsonb_build_object('returned_at', _g.returned_at, 'updated_at', _g.updated_at,
                                             'previous_copy', _g.previous_copy,
                                             'copy', _copy, 'hidden_at', clock_timestamp()),
           hide_ended_at = null, hide_ended_by = null,
           updated_at = now()
     where id = _r.id;
    update grade_return
       set is_draft = true, returned_at = null, returned_copy = null, updated_at = null
     where enrollment_id = _r.enrollment_id and assessment_id = _r.assessment_id;
    return true;
end;
$function$;

-- The request is taken back while its grade is hidden (the hide is on: it
-- began and has not ended). The student is given back exactly what they
-- had when it began, kept on the request; whatever the teacher has done to
-- the score since (changed it, cleared it by any writer, Set Everyone To,
-- a restore) waits as a draft on it, as any change to a returned grade
-- does. Once a hide has ended (a Return gave the student a grade for the
-- piece, or it was taken back), nothing is given back. The hide ends here.
-- Called under the class's lock. Returns whether a grade was given back.
create or replace function public._revision_unhide_grade(p_request_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _r   revision_request%rowtype;
    _h   jsonb;
    _now jsonb;
begin
    select * into _r from revision_request where id = p_request_id for update;
    if not found or not _r.grade_hidden then
        return false;
    end if;
    _h := _r.hidden_state;
    update revision_request
       set grade_hidden = false, hide_ended_at = clock_timestamp(), hide_ended_by = 'taken_back', updated_at = now()
     where id = _r.id;
    -- The row is there: no writer deletes it but the delete of its student
    -- or piece, which takes this request with it.
    perform 1 from grade_return
     where enrollment_id = _r.enrollment_id and assessment_id = _r.assessment_id
       for update;
    if not found then
        return false;
    end if;
    _now := _grade_copy(_r.enrollment_id, _r.assessment_id);
    update grade_return
       set is_draft = _now is distinct from _h->'copy',
           returned_at = (_h->>'returned_at')::timestamptz,
           updated_at = (_h->>'updated_at')::timestamptz,
           previous_copy = nullif(_h->'previous_copy', 'null'::jsonb),
           returned_copy = case when _now is distinct from _h->'copy' then _h->'copy' end
     where enrollment_id = _r.enrollment_id and assessment_id = _r.assessment_id;
    return true;
end;
$function$;

-- ── 2. Marks are given whenever a grade is returned ─────────────────────────
-- After a grade_return row is written so that a grade is returned (a row
-- made returned, or a row whose returned_at changes while it is not a
-- draft), the student is given the marks on that piece. grade_return is
-- written only under the class's lock, so markup is too.
create or replace function public._markup_on_return()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform _markup_give(new.enrollment_id, new.assessment_id);
    return null;
end;
$function$;
create or replace trigger markup_given_on_insert after insert on public.grade_return
    for each row when (new.returned_at is not null and not new.is_draft)
    execute function public._markup_on_return();
create or replace trigger markup_given_on_return after update of returned_at, is_draft on public.grade_return
    for each row when (new.returned_at is not null and not new.is_draft
                       and (old.returned_at is distinct from new.returned_at or old.is_draft))
    execute function public._markup_on_return();

revoke all on function public._revision_hide_available() from public, anon, authenticated, service_role;
revoke all on function public._revision_hide_grade(uuid) from public, anon, authenticated, service_role;
revoke all on function public._revision_unhide_grade(uuid) from public, anon, authenticated, service_role;
revoke all on function public._markup_on_return() from public, anon, authenticated, service_role;

do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN c2new (written by migrations/local-test/batch_c_fingerprints.py)
            ('public._revision_hide_available()',   'a4b4e942de351d6849702b96f25c7356'),
            ('public._revision_hide_grade(uuid)',   'a4c3f002d3bb2fc01e58ec5b8dab8ecb'),
            ('public._revision_unhide_grade(uuid)', '12dd830d953d13db1617e40a27f35133'),
            ('public._markup_on_return()',          '7aee1528f49c74565268dd37d191afd0')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                        where s ~ '^search_path=(.*, )?pg_temp$');
    if _left is not null then
        raise exception 'SECURITY DEFINER without pg_temp last in its search_path: %. Nothing was changed.', _left;
    end if;
end
$final$;

commit;
