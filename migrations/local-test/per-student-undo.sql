-- Undo for migrations/2026111720_student_page_per_student.sql (2026-11-17).
--
-- ── PART 1, the fast stop (deletes nothing) ─────────────────────────────────
-- Puts the four student_submit functions back, word for word as live had
-- them before the file. Every student then sees exactly what they saw
-- before: a paused student's card opens their page again, and Show Overall
-- Grade follows the class for everyone. The two columns, the teachers'
-- choices in them and the two teacher functions stay, so the Student Page
-- tab still shows and saves the options; they just do nothing for students
-- until the migration file is run again (it patches the four again and keeps
-- every choice). Run PART 1 alone (from "PART 1 begins" to "PART 1 ends").
--
-- ── PART 2, the full removal: the rest of this file ─────────────────────────
-- Drops the two teacher functions and the two columns. It STOPS, with
-- everything kept, while any student has an option set: dropping the
-- columns would delete those choices. To remove them anyway (Colin's call;
-- it deletes teachers' choices, nothing else), first run
--   update public.enrollment set show_overall_grade = null, page_paused_at = null
--    where show_overall_grade is not null or page_paused_at is not null;
-- It also stops if a function is neither this file's nor the one before it
-- (a later change would be lost). Rows of fv_idempotency the teacher
-- function wrote stay until the idempotency cleanup takes them.
--
-- Lock: dropping a column needs public.enrollment to itself for a moment.
-- While PART 2 waits, reads and writes of enrollment queue behind it; after
-- five seconds it gives up with PART 2 not applied. Run it at a quiet time.
--
-- Run whole, the file is PART 1 and then PART 2, each its own transaction:
-- a PART 2 that stops leaves PART 1 done. On a database where the file was
-- never applied it changes nothing; a second run changes nothing.
--
-- md5 of pg_get_functiondef (function, before the file, as the file leaves it):
--   student_submit._card_refusal(uuid)        cb88af0a6bf62c22ff6c636b291b1a25  4b982e451dbd5c9c68916c99d29d2d37
--   student_submit._session_classes(uuid)     35e766379278258651709e73b9f05940  92eb84de662304124deb198baa75111e
--   student_submit.page(text,uuid,text)       b2781abd6d579e3dc72b3f5f801bb917  9e16e8aaa8f1379beca4f64d4111fa1d
--   student_submit.feedback(text,uuid,text)   e093fd549255e5f938491066a5e2ea1c  73b78adc4b6661bc99ca0eaebf2e81bb
--   public.set_student_page_options(uuid,uuid[],text,boolean,uuid)   1578d29d0af1a5cf25818878d811e5c1
--   public.list_student_page_options(uuid)                           6913c1c295727391000044c2f7098b88

-- PART 1 begins
begin;

set local lock_timeout = '5s';

do $stop$
declare
    _f    record;
    _s    record;
    _def  text;
    _md5  text;
    _n    int;
begin
    -- Each of the four is the file's or the one before it, or nothing changes.
    for _f in select * from (values
        ('student_submit._card_refusal(uuid)', 'cb88af0a6bf62c22ff6c636b291b1a25', '4b982e451dbd5c9c68916c99d29d2d37'),
        ('student_submit._session_classes(uuid)', '35e766379278258651709e73b9f05940', '92eb84de662304124deb198baa75111e'),
        ('student_submit.page(text,uuid,text)', 'b2781abd6d579e3dc72b3f5f801bb917', '9e16e8aaa8f1379beca4f64d4111fa1d'),
        ('student_submit.feedback(text,uuid,text)', 'e093fd549255e5f938491066a5e2ea1c', '73b78adc4b6661bc99ca0eaebf2e81bb')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and _md5 is distinct from _f.now then
            raise exception '% is neither the file''s definition nor the one before it (md5 %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing');
        end if;
    end loop;
    for _f in select * from (values
        ('student_submit._card_refusal(uuid)', 'cb88af0a6bf62c22ff6c636b291b1a25'),
        ('student_submit._session_classes(uuid)', '35e766379278258651709e73b9f05940'),
        ('student_submit.page(text,uuid,text)', 'b2781abd6d579e3dc72b3f5f801bb917'),
        ('student_submit.feedback(text,uuid,text)', 'e093fd549255e5f938491066a5e2ea1c')
    ) as v(fn, was) loop
        _def := pg_get_functiondef(to_regprocedure(_f.fn));
        continue when md5(_def) = _f.was;
        -- the file's text swapped back (find: what the file put in; put: what was there)
        for _s in select * from (values
        ('student_submit._card_refusal(uuid)',
         $n$               -- 2026111720: a student whose page the teacher paused is refused as a class with its page off
               when not c.student_page_enabled or e.page_paused_at is not null then 'closed'
$n$,
         $o$               when not c.student_page_enabled then 'closed'
$o$),
        ('student_submit._session_classes(uuid)',
         $n$and c.deleted_at is null and c.student_page_enabled
       and e.page_paused_at is null;  -- 2026111720: a class whose page the teacher paused for this student is left out
$n$,
         $o$and c.deleted_at is null and c.student_page_enabled;
$o$),
        ('student_submit.page(text,uuid,text)',
         $n$    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- 2026111720: Show Overall Grade as this student has it (their own, or the class's when they have none).
    -- Every read of _course.show_my_learning below is this student's value.
    _course.show_my_learning := coalesce((select e.show_overall_grade from enrollment e where e.id = p_enrollment_id),
                                         _course.show_my_learning);
$n$,
         $o$    select * into _course from course where id = (_in->>'course_id')::uuid;
$o$),
        ('student_submit.feedback(text,uuid,text)',
         $n$    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- 2026111720: Show Overall Grade as this student has it (their own, or the class's when they have none).
    _course.show_my_learning := coalesce((select e.show_overall_grade from enrollment e where e.id = p_enrollment_id),
                                         _course.show_my_learning);
$n$,
         $o$    select * into _course from course where id = (_in->>'course_id')::uuid;
$o$)
        ) as s(fn, find, put) where s.fn = _f.fn loop
            _n := (length(_def) - length(replace(_def, _s.find, ''))) / length(_s.find);
            if _n <> 1 then
                raise exception '% holds the file''s text % time(s), not once. Nothing was changed.', _f.fn, _n;
            end if;
            _def := replace(_def, _s.find, _s.put);
        end loop;
        if md5(_def) <> _f.was then
            raise exception '% would not be the definition before the file (md5 %). Nothing was changed.', _f.fn, md5(_def);
        end if;
        execute _def;
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) <> _f.was then
            raise exception '% did not come back as before. Nothing was changed.', _f.fn;
        end if;
    end loop;
end
$stop$;

commit;
-- PART 1 ends

begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f    record;
    _md5  text;
    _set  bigint;
begin
    for _f in select * from (values
        ('student_submit._card_refusal(uuid)', 'cb88af0a6bf62c22ff6c636b291b1a25'),
        ('student_submit._session_classes(uuid)', '35e766379278258651709e73b9f05940'),
        ('student_submit.page(text,uuid,text)', 'b2781abd6d579e3dc72b3f5f801bb917'),
        ('student_submit.feedback(text,uuid,text)', 'e093fd549255e5f938491066a5e2ea1c')
    ) as v(fn, was) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.was then
            raise exception '% still reads the columns (run PART 1 first). Nothing was changed.', _f.fn;
        end if;
    end loop;
    for _f in select * from (values
        ('public.set_student_page_options(uuid,uuid[],text,boolean,uuid)', '1578d29d0af1a5cf25818878d811e5c1'),
        ('public.list_student_page_options(uuid)', '6913c1c295727391000044c2f7098b88')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the file''s definition (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if exists (select 1 from pg_attribute where attrelid = 'public.enrollment'::regclass and not attisdropped
                and attname in ('show_overall_grade', 'page_paused_at')) then
        -- the lock the drop needs, taken first, so no option is set between the count and the drop and
        -- nothing is upgraded later (a weaker lock here, then the drop's, can deadlock a transaction that
        -- read enrollment and then writes it)
        lock table public.enrollment in access exclusive mode;
        execute 'select count(*) from public.enrollment where show_overall_grade is not null or page_paused_at is not null' into _set;
        if _set > 0 then
            raise exception '% student(s) have an option set; dropping the columns would delete those choices. Nothing was changed (PART 1 stays done).', _set;
        end if;
    end if;
end
$guard$;

drop function if exists public.set_student_page_options(uuid, uuid[], text, boolean, uuid);
drop function if exists public.list_student_page_options(uuid);
alter table public.enrollment
    drop column if exists show_overall_grade,
    drop column if exists page_paused_at;

commit;
