-- Mark Up and Revisions: marks and finished revisions follow every Return
-- (2026-11-11). Student page build plan, Batch C, second file (C2). The
-- first file is 2026111120_markup_reflect_revise.sql (C1); this one needs
-- it, and Batch B, applied first.
--
-- THIS FILE ADDS A TRIGGER THAT RUNS INSIDE EVERY RETURN OF A GRADE. It
-- waits for the owner's review and his word (project rules 1 and 2; the
-- standing OK of Nov 10 does not cover it). Everything else of Batch C is
-- in C1, which can be applied without this file.
--
-- Hiding a grade during a revision is NOT in this file or in Batch C
-- (Colin, Nov 11: "Take hide out and we'll work on it later"). Return for
-- Revision keeps the grade; a request for Hide answers hide_not_available
-- and writes nothing, with this file or without it.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- One function, public._markup_on_return(), and two triggers on
-- grade_return that run it after a grade is returned: a row inserted
-- returned (markup_given_on_insert), or a row whose returned_at is
-- updated to a new date while it is not a draft (markup_given_on_return).
-- A Return is exactly a write that stamps a new returned date: every
-- Return in Batch A does (return_grades and the class leaving When I
-- Return Them, or turning the Student Page off, through _grade_return_one;
-- a save in a class that returns at once through _grade_return_apply,
-- which the nightly repair and the DIBELS switch use too), and nothing
-- else does. A draft put back to the returned grade (a grade changed and
-- changed back, a comment typed and deleted) is Returned again with its
-- old date: it is not a Return, and this trigger does not run.
-- Each time it runs, for that student and piece:
--   1. the teacher's marks are given (C1's _markup_give), as return_work
--      gives them. C1's return_work stays the call the screens use; this
--      covers return_grades from an older screen, a class leaving When I
--      Return Them, a save in a class that returns at once, a restore;
--   2. a revision request whose revision's grade has now been returned is
--      stored as done (C1's _revision_settle), so nothing done to the work
--      or the grade later (its photos deleted, the grade cleared) opens it
--      again. With C1 alone that is stored only at the next Batch C call.
--      (Not during a restore: the backup's own state is written over
--      what the restore first marks Returned.)
-- And one more function, public._markup_on_release(), and one trigger on
-- course that runs it (markup_given_on_release) when a class stops holding
-- grades: it leaves When I Return Them, or its Student Page is turned off
-- (the condition Batch A's grade_return_release has, and after it). Batch
-- A then returns each draft, and the trigger above gives those pieces'
-- marks. Marks drawn after a grade was already returned are waiting for a
-- next Return the class no longer has: they are given then, for every
-- piece of the class whose grade is returned, as a Return gives them
-- (C1's _markup_give; while Students See Your Mark Up is off, or the piece
-- is Missing or Excused, the student's calls show none, as after any
-- Return). Marks on a piece with no grade yet are not given by it: they
-- go with the grade, or at the next save of marks.
-- Why not C1: it runs inside every Return. A fault in it would stop
-- teachers saving or returning grades.
--
-- ── What it writes ──────────────────────────────────────────────────────────
-- markup.given, given_rev and given_at, and revision_request's state,
-- closed_at and updated_at (the course trigger: markup only). NEVER A GRADE ROW: no grade_return, score,
-- tag_score, rubric_score or rubric_check_score row is written by it
-- (batch_c.py's same_rows runs one script with and without this file and
-- finds them all the same). On the apply: no row at all.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless C1 is applied, the functions the
-- triggers call or rely on are the definitions the tests ran against
-- (and its own, on a second run), and no trigger of those names is on
-- grade_return or course already (on a first run).
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/batch-c2-live-precheck.sql   expected: no rows.
-- migrations/local-test/batch-c2-live-postcheck.sql  expected: no rows.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/batch-c2-undo.sql (proved by batch_c_undo.py): the
-- three triggers and the two functions go. No row changes: marks already
-- given stay given and requests stored done stay done.
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
    if _first and exists (select 1 from pg_trigger t
                           where t.tgrelid = 'public.course'::regclass and not t.tgisinternal
                             and t.tgname = 'markup_given_on_release') then
        raise exception 'a trigger named markup_given_on_release is already on course, and this file''s triggers on grade_return are not there. Nothing was changed.';
    end if;
    -- The functions it calls or relies on (as C1 leaves them), and its own
    -- (absent on a first run; as this file leaves it on a second).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN c2relied (written by migrations/local-test/batch_c_fingerprints.py)
            ('public._markup_give(uuid,uuid)',                               'f0f07a1b879ff038e2f0afe020233c29', 'f0f07a1b879ff038e2f0afe020233c29'),
            ('public._revision_settle(uuid,uuid,boolean)',                   '5abc02afbaa29294cdb317838657b37c', '5abc02afbaa29294cdb317838657b37c'),
            ('public._grade_return_lock(uuid)',                              '530dca441198b1546a4ec4967cd83b9f', '530dca441198b1546a4ec4967cd83b9f'),
            ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)',            '89899f9dbc1569f7f1cc4216e252eb32', '89899f9dbc1569f7f1cc4216e252eb32'),
            ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689', '99e3165d005b5b2020ec40dcf307c689'),
            ('public._markup_on_return()',                                   'absent', 'ce8ceaa830617aa9caf935b161d7e379'),
            ('public._markup_on_release()',                                  'absent', 'a7e8838702d000c42621d72bf8621dfb')
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
end
$guard$;

-- ── Marks and finished revisions follow every Return ───────────────────────
-- After a grade is returned (a row inserted returned, or a row's
-- returned_at updated to a new date while it is not a draft), the student
-- is given the marks on that piece and a finished revision request is
-- stored as done. grade_return is written only under the class's lock, so
-- markup and revision_request are too. It writes no grade row.
create or replace function public._markup_on_return()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform _markup_give(new.enrollment_id, new.assessment_id);
    -- A restore (fv.restoring) writes the backup's own state over what it
    -- first marks Returned: no request is closed from that. (The app
    -- restores as a new class, where there is no request.)
    if current_setting('fv.restoring', true) = 'on' then
        return null;
    end if;
    -- The revision's grade returned: the request is done, for good.
    perform _revision_settle(new.enrollment_id, new.assessment_id, false);
    return null;
end;
$function$;
create or replace trigger markup_given_on_insert after insert on public.grade_return
    for each row when (new.returned_at is not null and not new.is_draft)
    execute function public._markup_on_return();
-- A Return is a write that stamps a new returned date (see the header). A
-- draft put back to the returned grade is Returned again with its old
-- date: not a Return, so nothing is given and no request closes.
create or replace trigger markup_given_on_return after update of returned_at on public.grade_return
    for each row when (new.returned_at is not null and not new.is_draft
                       and old.returned_at is distinct from new.returned_at)
    execute function public._markup_on_return();


-- ── Marks waiting on returned work, when a class stops holding grades ──────
-- After a class leaves When I Return Them, or its Student Page is turned
-- off (and after Batch A's grade_return_release, which returns its drafts
-- under the class's lock: trigger names run in order), every page of the
-- class with marks not yet given, on a piece whose grade is returned, is
-- given, as a Return gives it. It writes no grade row.
create or replace function public._markup_on_release()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform _grade_return_lock(new.id);
    perform _markup_give(p.enrollment_id, p.assessment_id)
       from (select distinct m.enrollment_id, m.assessment_id
               from markup m
               join enrollment e on e.id = m.enrollment_id and e.course_id = new.id
               join grade_return g on g.enrollment_id = m.enrollment_id and g.assessment_id = m.assessment_id
              where m.course_id = new.id and m.given_rev is distinct from m.working_rev
                and g.returned_at is not null and not g.is_draft) p;
    return null;
end;
$function$;
create or replace trigger markup_given_on_release after update of student_page_enabled, return_grades on public.course
    for each row when (old.student_page_enabled and old.return_grades is not distinct from 'on_return'
                       and not (new.student_page_enabled and new.return_grades is not distinct from 'on_return'))
    execute function public._markup_on_release();

revoke all on function public._markup_on_return() from public, anon, authenticated, service_role;
revoke all on function public._markup_on_release() from public, anon, authenticated, service_role;

do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN c2new (written by migrations/local-test/batch_c_fingerprints.py)
            ('public._markup_on_return()',  'ce8ceaa830617aa9caf935b161d7e379'),
            ('public._markup_on_release()', 'a7e8838702d000c42621d72bf8621dfb')
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
