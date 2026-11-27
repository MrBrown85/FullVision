-- Undo for migrations/2026112702_student_writing.sql (2026-11-27).
--
-- == Which lever: PART 0 first ==
-- PART 0 deletes nothing. The full removal (the whole file) deletes nothing either, but refuses while any
-- writing, draft or pinned comment is kept: removing the tables would delete students' work.
--
-- == PART 0, the stop that deletes nothing (recommended) ==
-- Takes away execute on the five functions that are the only ways in: student_submit.writing, writing_save
-- and writing_start (from service_role), get_submission_writing and save_writing_comments (from
-- authenticated and service_role). Every draft save, writing send, writing read and pinned comment is then
-- refused; the student page and grader fall back to what they show without writing. Everything else is as
-- before the file: a send, replace, finish, unsend or revision with no writing in it takes exactly the path
-- it took before (each edit the file made is reached only when writing exists or p_draft_rev is given).
-- Writing already sent stays with its submission; drafts and comments stay. Run PART 0 alone (from "PART 0
-- begins" to "PART 0 ends"). On a database without the file it changes nothing; a second run changes nothing.
--
-- == PART 1, the full removal: the rest of this file ==
-- Puts the thirteen functions back word for word (the file's edits reversed, each found once, then checked
-- against the md5 live had): _send_begin and revision_start with their old arguments (revision_start keeps
-- service_role's execute); drops the file's thirteen new functions and the three tables; puts write_log's
-- check back (its rows of kind 'writing' are rate-limit counts, not anyone's work: they are deleted first).
-- It stops with nothing changed while any row is in writing_draft, submission_writing or writing_comments,
-- or while a function is neither as the file left it nor as it was before. Work sent as writing alone has no
-- pages; the old functions do not expect that, which is why it refuses. To remove the feature with writing
-- kept, use PART 0 and leave the tables.
-- On a database where the file was never applied it changes nothing; a second run changes nothing.

-- PART 0 begins
begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;
do $stop$
begin
    if to_regprocedure('student_submit.writing(text,uuid,uuid,text)') is not null then
        revoke all on function student_submit.writing(text, uuid, uuid, text),
            student_submit.writing_save(text, uuid, uuid, jsonb, integer, text),
            student_submit.writing_start(text, uuid, uuid, text, jsonb, integer, text, text, uuid, text)
            from public, anon, authenticated, service_role;
    end if;
    if to_regprocedure('public.get_submission_writing(uuid)') is not null then
        revoke all on function public.get_submission_writing(uuid), public.save_writing_comments(uuid, jsonb, integer, uuid)
            from public, anon, authenticated, service_role;
    end if;
end
$stop$;
commit;
-- PART 0 ends

-- PART 1 begins
begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;

lock table public.enrollment, public.assessment, public.submission in share row exclusive mode;
lock table student_submit.write_log in access exclusive mode;
do $locks$
begin
    if to_regclass('public.writing_comments') is not null then
        lock table public.writing_draft, public.submission_writing, public.writing_comments in access exclusive mode;
    end if;
end
$locks$;

do $refuse$
declare
    _f   record;
    _md5 text;
begin
    if to_regclass('public.writing_draft') is not null
       and (exists (select 1 from public.writing_draft) or exists (select 1 from public.submission_writing)
            or exists (select 1 from public.writing_comments)) then
        raise exception 'Students'' writing is kept (% drafts, % sent, % with comments): removing it would delete their work. Use PART 0. Nothing was changed.',
            (select count(*) from public.writing_draft), (select count(*) from public.submission_writing),
            (select count(*) from public.writing_comments);
    end if;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-patched
        ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'f9a5a0b8a32f4f4d11e8a0715472db6a', '340cb72444d555a9cef594b543e2674c'),
        ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'c318d2887499162bb1e8fe708f3ed923', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
        ('student_submit.unsend(text,uuid,uuid,text)', '697fc569e89c9ec421c00e349fdd853d', '68665f35e1678f1bba64d30c082409d8'),
        ('student_submit.revision_unsend(text,uuid,uuid,text)', '2f462712bd33bba734fd4419652c8b9f', '73ac162e56dde98d11ffcd03aa4b5ffa'),
        ('public.delete_submission(uuid,uuid)', '534dc8ee7e2448695f6254f5fe3843b7', 'c1f98e77a7fb756e75af4334d520f5fc'),
        ('public.finish_work_upload(uuid,jsonb,uuid)', '005384268d5a0be403bdcd52c31b2ad0', 'c8c5c26be1758ec2e07fe73a68731159'),
        ('public._markup_give(uuid,uuid)', '68ed4bdfa5ca39324217788ff02169a4', 'f0f07a1b879ff038e2f0afe020233c29'),
        ('public._markup_on_release()', '747a6a625b7be23c096619eb37226739', 'a7e8838702d000c42621d72bf8621dfb'),
        ('student_submit._grading_started(uuid,uuid)', '059a3ce924808dc33421cee5912b0066', '586a6a0b5910e6c153b72e73a5b672bc'),
        ('public._submission_json(uuid)', 'fe00bc0b12796163e57c273831213cae', 'a1933b27974307aeae814ce98714c18f'),
        ('student_submit.work(text,uuid,text)', '2f8c6e8f284e051320620700bc6b054d', '9e237f6e19649807b64aa6dc870de3f3')
        -- FINGERPRINTS-END
    ) as v(fn, now, was) loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.now and _md5 <> _f.was then
            raise exception '% is neither as the file left it nor as it was before (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-resigned
        ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)', '3fb68d3590a8d265c9343d3743589131', 'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '6cad6dd40eb1c33451a5dcf4f60e7624'),
        ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)', 'a489d7771345b6a75c43cd038733b715', 'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84')
        -- FINGERPRINTS-END
    ) as v(fn, now, old, was) loop
        if not ((md5(pg_get_functiondef(to_regprocedure(_f.fn))) = _f.now and to_regprocedure(_f.old) is null)
                or (to_regprocedure(_f.fn) is null and md5(pg_get_functiondef(to_regprocedure(_f.old))) = _f.was)) then
            raise exception '% / % are neither as the file left them nor as they were before. Nothing was changed.', _f.fn, _f.old;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-new
        ('public._writing_runs(jsonb)', '04fc22dfbf4abd15a9cd0fb4d0ff2d2d'),
        ('public._writing_plain(jsonb)', 'a3879b9da077187277c9b3a882f6ebab'),
        ('public._writing_comment_list(jsonb,integer)', '4733d9b3998516b26cc80ccdefe56ccf'),
        ('public._writing_take(uuid,uuid,integer)', '74750ed12de507435b19994a9b451706'),
        ('public._writing_attach(uuid,integer)', '82813807957f5922afcb2f6e306de555'),
        ('public._writing_draft_done(uuid)', '3b84964b5ebce61c75bd215821df5bdf'),
        ('public._writing_back_to_draft(uuid)', 'c555af37199c7cd50d72f73a6e57f777'),
        ('public._work_check_send_files(uuid,jsonb)', '69c4c4be2414afec4c99b428846a2cf3'),
        ('student_submit.writing(text,uuid,uuid,text)', 'ded44bf06f5ca15e344c07cfa1a316a1'),
        ('student_submit.writing_save(text,uuid,uuid,jsonb,integer,text)', 'be98cfa8f342ffb87d3453ca39d6bd6c'),
        ('student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)', '49e18446699e681a1cf843e348bd89ac'),
        ('public.get_submission_writing(uuid)', '0c6a5dcb8c91f786c6bccfffbe2822ac'),
        ('public.save_writing_comments(uuid,jsonb,integer,uuid)', 'cbfcd69bc677cf0ee1b3f41b0281da4b')
        -- FINGERPRINTS-END
    ) as v(fn, now) loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.now and _md5 <> 'absent' then
            raise exception '% is not as the file made it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$refuse$;

-- The file's edits, reversed: each replacement found once and put back as it was. Then each is checked
-- against the md5 it had before the file.
do $unpatch$
declare
  -- EDITS-BEGIN
  _edits text[][] := array[
    -- function, text to find, replacement
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          'p_request_id uuid)',
          'p_request_id uuid, p_draft_rev integer DEFAULT NULL::integer)'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          '    _id      uuid;
begin',
          '    _id      uuid;
    _took    jsonb;
begin'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          '    perform public._work_check_pages(p_pages);',
          '    -- 2026112702: a send with writing (p_draft_rev) may have no pages; pages it has keep the rule.
    if p_draft_rev is null or p_pages is distinct from ''[]''::jsonb then
        perform public._work_check_pages(p_pages);
    end if;'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          '    -- Twenty sends an hour for one card (Colin, Nov 9).',
          '    -- 2026112702: the writing is the student''s draft at the revision the phone saved last, not empty.
    if p_draft_rev is not null then
        _took := public._writing_take(p_enrollment_id, _a.id, p_draft_rev);
        if _took is not null then
            return _took;
        end if;
    end if;

    -- Twenty sends an hour for one card (Colin, Nov 9).'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          'p_pages, p_note, p_followed_plan, (_w->>''late'')::boolean, _card, p_request_id);',
          'p_pages, p_note, p_followed_plan, (_w->>''late'')::boolean, _card, p_request_id);
    if p_draft_rev is not null then
        perform public._writing_attach(_id, p_draft_rev);
    end if;'],

    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          'p_request_id uuid, p_ip_hash text)',
          'p_request_id uuid, p_ip_hash text, p_draft_rev integer DEFAULT NULL::integer)'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    _id      uuid;
begin',
          '    _id      uuid;
    _took    jsonb;
begin'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    perform public._work_check_pages(p_pages);',
          '    -- 2026112702: a revision with writing (p_draft_rev) may have no pages; pages it has keep the rule.
    if p_draft_rev is null or p_pages is distinct from ''[]''::jsonb then
        perform public._work_check_pages(p_pages);
    end if;'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    -- Twenty sends an hour for one card, counted as Batch B counts them.',
          '    -- 2026112702: the writing is the student''s draft at the revision the phone saved last, not empty.
    if p_draft_rev is not null then
        _took := public._writing_take(p_enrollment_id, _a.id, p_draft_rev);
        if _took is not null then
            return _took;
        end if;
    end if;

    -- Twenty sends an hour for one card, counted as Batch B counts them.'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    update submission set version = _version where id = _id;',
          '    update submission set version = _version where id = _id;
    if p_draft_rev is not null then
        perform public._writing_attach(_id, p_draft_rev);
    end if;'],

    array['student_submit.send_finish(text,uuid,uuid,jsonb,text)',
          '    perform public._work_check_files(p_files);',
          '    -- 2026112702: no files is a finish only for a send that carries writing.
    perform public._work_check_send_files(p_submission_id, p_files);'],
    array['student_submit.send_finish(text,uuid,uuid,jsonb,text)',
          '    returning * into _sub;',
          '    returning * into _sub;
    -- 2026112702: the draft it was sent from is done (a newer draft is kept).
    perform public._writing_draft_done(_sub.id);'],

    array['student_submit.revision_finish(text,uuid,uuid,jsonb,text)',
          '    perform public._work_check_files(p_files);',
          '    -- 2026112702: no files is a finish only for a send that carries writing.
    perform public._work_check_send_files(p_submission_id, p_files);'],
    array['student_submit.revision_finish(text,uuid,uuid,jsonb,text)',
          '    returning * into _sub;',
          '    returning * into _sub;
    -- 2026112702: the draft it was sent from is done (a newer draft is kept).
    perform public._writing_draft_done(_sub.id);'],

    array['student_submit.unsend(text,uuid,uuid,text)',
          '    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    if _kept = 0 then',
          '    -- 2026112702: the student''s writing goes back to their draft (a newer draft is kept).
    perform public._writing_back_to_draft(_sent.id);
    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    if _kept = 0 then'],
    array['student_submit.unsend(text,uuid,uuid,text)',
          '        delete from submission_file where submission_id = _sent.id and added_by = ''student'';',
          '        delete from submission_writing where submission_id = _sent.id;
        delete from submission_file where submission_id = _sent.id and added_by = ''student'';'],

    array['student_submit.revision_unsend(text,uuid,uuid,text)',
          '    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    delete from submission where id = _old;',
          '    -- 2026112702: the student''s writing goes back to their draft (a newer draft is kept).
    perform public._writing_back_to_draft(_old);
    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    delete from submission where id = _old;'],

    array['public.delete_submission(uuid,uuid)',
          '    perform set_config(''fv.work_removal_reason'', ''teacher'', true);',
          '    -- 2026112702: a student''s writing goes back to the student''s draft (a newer draft is kept).
    if _course is not null then
        perform public._writing_back_to_draft(p_submission_id);
    end if;
    perform set_config(''fv.work_removal_reason'', ''teacher'', true);'],

    array['public.finish_work_upload(uuid,jsonb,uuid)',
          '            perform set_config(''fv.work_removal_reason'', ''replace'', true);
            delete from submission where id = _target.id;',
          '            -- 2026112702: a student''s writing goes back to the student''s draft (a newer draft is kept).
            perform public._writing_back_to_draft(_target.id);
            perform set_config(''fv.work_removal_reason'', ''replace'', true);
            delete from submission where id = _target.id;'],

    array['public._markup_give(uuid,uuid)',
          '    get diagnostics _n = row_count;
    return _n;',
          '    get diagnostics _n = row_count;
    -- 2026112702: comments pinned to the student''s writing for the piece are given with the marks.
    update writing_comments c
       set given = c.working, given_rev = c.working_rev, given_at = clock_timestamp()
      from submission s
     where s.id = c.submission_id and s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id
       and c.given_rev is distinct from c.working_rev
       and not (c.given is null and jsonb_array_length(coalesce(c.working->''comments'', ''[]''::jsonb)) = 0);
    return _n;'],

    array['public._markup_on_release()',
          '                and g.returned_at is not null and not g.is_draft) p;',
          '                and g.returned_at is not null and not g.is_draft
             -- 2026112702: and the pieces with comments on writing waiting
             union
             select s.enrollment_id, s.assessment_id
               from writing_comments c
               join submission s on s.id = c.submission_id and s.course_id = new.id
               join grade_return g on g.enrollment_id = s.enrollment_id and g.assessment_id = s.assessment_id
              where c.given_rev is distinct from c.working_rev
                and g.returned_at is not null and not g.is_draft) p;'],

    array['student_submit._grading_started(uuid,uuid)',
          '                      and jsonb_array_length(coalesce(k.working->''marks'', ''[]''::jsonb)) > 0);',
          '                      and jsonb_array_length(coalesce(k.working->''marks'', ''[]''::jsonb)) > 0)
        -- 2026112702: the teacher''s comments pinned to this student''s writing for the piece
        or exists (select 1 from writing_comments c
                    join submission s on s.id = c.submission_id
                    where s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id
                      and jsonb_array_length(coalesce(c.working->''comments'', ''[]''::jsonb)) > 0);'],

    array['public._submission_json(uuid)',
          '''created_at'', s.created_at, ''sent_at'', s.sent_at,',
          '''created_at'', s.created_at, ''sent_at'', s.sent_at,
               -- 2026112702: the writing sent with it: its length and its first 280 characters
               ''writing'', (select jsonb_build_object(''chars'', sw.chars, ''start'', left(sw.plain, 280))
                             from submission_writing sw where sw.submission_id = s.id),'],

    array['student_submit.work(text,uuid,text)',
          '''pages'', (select count(*) from submission_file f where f.submission_id = s.id),',
          '''pages'', (select count(*) from submission_file f where f.submission_id = s.id),
                                   -- 2026112702: the writing sent with it, its length, or null
                                   ''writing'', (select sw.chars from submission_writing sw where sw.submission_id = s.id),'],
    array['student_submit.work(text,uuid,text)',
          '''late_now'', w.j->''late'',',
          '''late_now'', w.j->''late'',
                       -- 2026112702: the student''s draft for the piece, or null
                       ''draft'', (select jsonb_build_object(''rev'', d.rev, ''chars'', d.chars, ''saved_at'', d.saved_at)
                                   from writing_draft d where d.enrollment_id = p_enrollment_id and d.assessment_id = a.id),']
  ];
  _resigned text[][] := array[
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)']
  ];
  -- EDITS-END
  _fn    text;
  _new   text;
  _def   text;
  _hits  int;
  i      int;
  j      int;
begin
  for _fn in select x.f from (select _edits[k][1] as f, k from generate_subscripts(_edits, 1) k) x
              group by x.f order by min(x.k) loop
    _new := null;
    for j in 1 .. array_length(_resigned, 1) loop
      if _resigned[j][1] = _fn then _new := _resigned[j][2]; end if;
    end loop;
    if _new is not null then
      if to_regprocedure(_new) is null then continue; end if;
      _def := pg_get_functiondef(_new::regprocedure);
    else
      if md5(pg_get_functiondef(_fn::regprocedure)) = (select v.was from (values
          -- FINGERPRINTS-BEGIN undo-patched
          ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'f9a5a0b8a32f4f4d11e8a0715472db6a', '340cb72444d555a9cef594b543e2674c'),
          ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'c318d2887499162bb1e8fe708f3ed923', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
          ('student_submit.unsend(text,uuid,uuid,text)', '697fc569e89c9ec421c00e349fdd853d', '68665f35e1678f1bba64d30c082409d8'),
          ('student_submit.revision_unsend(text,uuid,uuid,text)', '2f462712bd33bba734fd4419652c8b9f', '73ac162e56dde98d11ffcd03aa4b5ffa'),
          ('public.delete_submission(uuid,uuid)', '534dc8ee7e2448695f6254f5fe3843b7', 'c1f98e77a7fb756e75af4334d520f5fc'),
          ('public.finish_work_upload(uuid,jsonb,uuid)', '005384268d5a0be403bdcd52c31b2ad0', 'c8c5c26be1758ec2e07fe73a68731159'),
          ('public._markup_give(uuid,uuid)', '68ed4bdfa5ca39324217788ff02169a4', 'f0f07a1b879ff038e2f0afe020233c29'),
          ('public._markup_on_release()', '747a6a625b7be23c096619eb37226739', 'a7e8838702d000c42621d72bf8621dfb'),
          ('student_submit._grading_started(uuid,uuid)', '059a3ce924808dc33421cee5912b0066', '586a6a0b5910e6c153b72e73a5b672bc'),
          ('public._submission_json(uuid)', 'fe00bc0b12796163e57c273831213cae', 'a1933b27974307aeae814ce98714c18f'),
          ('student_submit.work(text,uuid,text)', '2f8c6e8f284e051320620700bc6b054d', '9e237f6e19649807b64aa6dc870de3f3')
          -- FINGERPRINTS-END
          ) as v(fn, now, was) where v.fn = _fn) then
        continue;
      end if;
      _def := pg_get_functiondef(_fn::regprocedure);
    end if;
    for i in reverse array_length(_edits, 1) .. 1 loop
      if _edits[i][1] = _fn then
        _hits := (length(_def) - length(replace(_def, _edits[i][3], ''))) / length(_edits[i][3]);
        if _hits <> 1 then
          raise exception '% has % matches for "%", expected 1. Nothing was changed.', coalesce(_new, _fn), _hits, _edits[i][3];
        end if;
        _def := replace(_def, _edits[i][3], _edits[i][2]);
      end if;
    end loop;
    execute _def;
    if _new is not null then
      execute 'drop function ' || _new;
    end if;
  end loop;
end
$unpatch$;

revoke all on function student_submit._send_begin(text, text, uuid, uuid, jsonb, text, text, uuid) from public;
revoke all on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text) from public;
grant execute on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text) to service_role;

drop function if exists student_submit.writing(text, uuid, uuid, text);
drop function if exists student_submit.writing_save(text, uuid, uuid, jsonb, integer, text);
drop function if exists student_submit.writing_start(text, uuid, uuid, text, jsonb, integer, text, text, uuid, text);
drop function if exists public.get_submission_writing(uuid);
drop function if exists public.save_writing_comments(uuid, jsonb, integer, uuid);
drop function if exists public._writing_take(uuid, uuid, integer);
drop function if exists public._writing_attach(uuid, integer);
drop function if exists public._writing_draft_done(uuid);
drop function if exists public._writing_back_to_draft(uuid);
drop function if exists public._work_check_send_files(uuid, jsonb);
drop table if exists public.writing_comments;
drop table if exists public.submission_writing;
drop table if exists public.writing_draft;
drop function if exists public._writing_comment_list(jsonb, integer);
drop function if exists public._writing_plain(jsonb);
drop function if exists public._writing_runs(jsonb);

do $kind$
begin
    if exists (select 1 from pg_constraint where conrelid = 'student_submit.write_log'::regclass
                and conname = 'write_log_kind_check' and pg_get_constraintdef(oid) like '%''writing''%') then
        delete from student_submit.write_log where kind = 'writing';
        alter table student_submit.write_log
            drop constraint write_log_kind_check,
            add constraint write_log_kind_check
                check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text, 'quiz'::text]));
    end if;
end
$kind$;

do $after$
declare
    _f   record;
    _bad text[] := '{}';
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-patched
        ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'f9a5a0b8a32f4f4d11e8a0715472db6a', '340cb72444d555a9cef594b543e2674c'),
        ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'c318d2887499162bb1e8fe708f3ed923', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
        ('student_submit.unsend(text,uuid,uuid,text)', '697fc569e89c9ec421c00e349fdd853d', '68665f35e1678f1bba64d30c082409d8'),
        ('student_submit.revision_unsend(text,uuid,uuid,text)', '2f462712bd33bba734fd4419652c8b9f', '73ac162e56dde98d11ffcd03aa4b5ffa'),
        ('public.delete_submission(uuid,uuid)', '534dc8ee7e2448695f6254f5fe3843b7', 'c1f98e77a7fb756e75af4334d520f5fc'),
        ('public.finish_work_upload(uuid,jsonb,uuid)', '005384268d5a0be403bdcd52c31b2ad0', 'c8c5c26be1758ec2e07fe73a68731159'),
        ('public._markup_give(uuid,uuid)', '68ed4bdfa5ca39324217788ff02169a4', 'f0f07a1b879ff038e2f0afe020233c29'),
        ('public._markup_on_release()', '747a6a625b7be23c096619eb37226739', 'a7e8838702d000c42621d72bf8621dfb'),
        ('student_submit._grading_started(uuid,uuid)', '059a3ce924808dc33421cee5912b0066', '586a6a0b5910e6c153b72e73a5b672bc'),
        ('public._submission_json(uuid)', 'fe00bc0b12796163e57c273831213cae', 'a1933b27974307aeae814ce98714c18f'),
        ('student_submit.work(text,uuid,text)', '2f8c6e8f284e051320620700bc6b054d', '9e237f6e19649807b64aa6dc870de3f3')
        -- FINGERPRINTS-END
    ) as v(fn, now, was) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.was then
            _bad := _bad || _f.fn;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-resigned
        ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)', '3fb68d3590a8d265c9343d3743589131', 'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '6cad6dd40eb1c33451a5dcf4f60e7624'),
        ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)', 'a489d7771345b6a75c43cd038733b715', 'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84')
        -- FINGERPRINTS-END
    ) as v(fn, now, old, was) loop
        if to_regprocedure(_f.fn) is not null or md5(pg_get_functiondef(to_regprocedure(_f.old))) is distinct from _f.was then
            _bad := _bad || _f.old;
        end if;
    end loop;
    if not has_function_privilege('service_role', 'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)'::regprocedure, 'execute') then
        _bad := _bad || 'service_role may not run revision_start'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not back as before: %. Nothing was changed.', array_to_string(_bad, ', ');
    end if;
end
$after$;

notify pgrst, 'reload schema';
commit;
-- PART 1 ends
