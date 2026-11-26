-- Comment Bank per Rubric (2026-11-25). NOT APPLIED: waits for the owner's OK.
-- A teacher keeps reusable feedback comments with a rubric: per criterion, at a level, and overall for the
-- rubric. They are written in the rubric editor, or kept while grading with Add to Bank, and offered under the
-- comment box while grading. Teacher-only: never printed, never sent to the student page. The plan is
-- docs/plans/comment-bank-plan.md ("The shape", "Database").
--
-- == What it adds ==
--   1. public.criterion.comments jsonb not null default '[]': [{level, text}], in the order shown.
--      public.rubric.overall_comments jsonb not null default '[]': [text], in the order shown.
--      Each with a check that it is a list (criterion_comments_is_list, rubric_overall_comments_is_list).
--   2. public._rubric_comment_list(list, levels): the one rule for a list, used by every function below. A
--      level is 1..4, or 1..6 on a rubric with its own levels (as a check's level is read); a text is trimmed
--      of spaces, tabs and line breaks and must be 1 to 500 characters; a repeat of the same level and text
--      is kept once, where it first came; at most 40. Anything else stops the call with 22023, nothing saved.
--   3. public.add_criterion_comment(criterion, level, text, key) and public.add_rubric_overall_comment(rubric,
--      text, key), for Add to Bank: they append one comment unless the same one is there, refuse past 40, and
--      return the whole list. They run as the teacher, check the class is theirs (fv_owns_course), replay a
--      used idempotency key (fv_idem_check / fv_idem_store), and move the class's sync cursor (the existing
--      triggers on criterion and rubric) so another device reloads the class. A repeat changes nothing and
--      does not move it.
--
-- == What it changes that exists ==
--   upsert_rubric           gains p_overall_comments (last, default null): null keeps the rubric's overall
--                           comments, a list replaces them. Each criterion in p_criteria may carry "comments":
--                           no key (or null) keeps what is stored, a list replaces it; a new criterion with no
--                           key gets []. The app already in teachers' browsers sends neither, so its saves keep
--                           the bank. Made from the live nine-argument definition by ten exact edits (each found
--                           once); the nine-argument one is dropped in the same transaction so PostgREST has one
--                           function to call; calls of eight or nine arguments, named or not, still match.
--   get_class_bundle        "comments" on each rubrics.criteria row, "overall_comments" on each rubrics.rubrics
--                           row. Nothing else in the bundle changes.
--   duplicate_course        copies both.
--   import_json_restore     reads "comments" on each criteria row and "overall_comments" on each rubrics row of
--                           the backup, by the same rule; missing (or not a list) means [].
-- Each patched in place behind its live md5 (migrations/baseline), one exact edit at a time.
-- Not changed: student_submit.page lists the criterion fields it sends, so neither column reaches a student
-- (its md5 is checked; the harness reads a student's page for a class with a bank). get_assessment_detail, a
-- teacher-only reader that sends whole rows, now also shows a rubric's bank to its own teacher.
--
-- == What it does to existing rows ==
-- Nothing but the two new columns: every existing criterion and rubric reads [] (a constant default, stored
-- once; no row is rewritten and no sync cursor moves). Live pre-check, read-only, on <date>: <n> criteria,
-- <m> rubrics (local-test/rubric-comment-bank-live-precheck.sql, the rows "count: criteria" and
-- "count: rubrics"; the query is select count(*) from public.criterion, and from public.rubric).
--
-- == What applying it accepts ==
-- A browser still on the old app ignores the new keys in the bundle, and its rubric saves keep the bank. A
-- rubric save from the new editor that carries a list replaces the criterion's list: an Add to Bank made on
-- another device between that editor opening and its save is replaced too (the app's draft must carry it).
-- A backup made before this file, restored over the same class, empties the bank of the rubrics it holds,
-- as it puts back every other rubric field. A backup whose comments break the rule stops the restore.
-- The undo's PART 0 puts saves back as before and stops Add to Bank, and keeps the bank; its full removal
-- deletes the bank, and refuses while one comment is kept.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the running role owns criterion and rubric;
-- every function it relies on or patches is the one it was tested against (md5 of pg_get_functiondef, public on
-- the search path), or, on a second run, as this file leaves it; the nine-argument upsert_rubric is as live
-- has it or gone; the four new functions are absent or as this file makes them, and no other function has one
-- of their names; criterion and rubric have the columns live has (or those and the new one). Its last step
-- checks everything came out as written, grants included.
--
-- == What it does not depend on ==
-- Collation, locale, time zone, search path and the applying role: comments are compared byte for byte (jsonb
-- containment), the one ordered aggregate sorts under collate "C", the file sets its own search path and each
-- function pins its own, the owner is checked and grants are read from proacl. Lengths count characters (the
-- database is UTF-8). No backslash and no non-ASCII character is in the file.
--
-- == Locks ==
-- criterion and rubric for a moment each (add column with a constant default, and a check that reads the
-- table); it gives up after five seconds with nothing applied if a long transaction holds one: run it again.
-- One transaction.
--
-- == How to apply ==
-- Only on the owner's OK. Tested on a throwaway PostgreSQL 17, ICU en-US and C (local-test/README.md,
-- "Comment Bank per Rubric").
--   0. local-test/rubric-comment-bank-live-fingerprints.sql, read-only. Expected: no rows.
--   1. local-test/rubric-comment-bank-live-precheck.sql, read-only. Expected: only the two count rows.
--   2. This whole file as one migration named rubric_comment_bank.
--   3. local-test/rubric-comment-bank-live-postcheck.sql. Every row ok.
--   4. docs/schema.generated.sql and migrations/baseline/ are refreshed from live (docs/database-rebuild.md),
--      then types/database.d.ts.
-- Undo: local-test/rubric-comment-bank-undo.sql. PART 0 alone is the stop that deletes nothing; the whole file
-- is the full removal.
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _f    record;
    _md5  text;
    _c    text;
    _me   oid := (select oid from pg_roles where rolname = current_user);
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    if (select relowner from pg_class where oid = to_regclass('public.criterion')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.rubric')) is distinct from _me then
        raise exception 'Run this as the owner of public.criterion and public.rubric (% is not). Nothing was changed.', current_user;
    end if;
    -- What the new code calls or relies on, as live has it.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied
            ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
            ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
            ('public._touch_course_sync_cursor(uuid,text)', 'b0b9eb6dbbe09e9edc5640cde262248d'),
            ('public._touch_course_sync_cursor_from_trigger()', '225aac90e5534c2826298d084e77991c'),
            ('fv_private.same_teacher()', '81cd77e2e122e6b12562a3ff412871f0'),
            ('public.delete_rubric(uuid)', '8800838f8148a080b9042c1e646c1ca7'),
            ('public.get_assessment_detail(uuid)', '55d1f49f14d78a713eebadfd20417afa'),
            ('student_submit.page(text,uuid,text)', '0caa34be2c4c9f26f36a6776664d1bfa')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The three patched in place: as live had them, or as this file leaves them (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces
            ('public.get_class_bundle(uuid,bigint)', '1bf06bc81bcdae7f51bfdcd594f02311', '481cba076e47cf26dbd523cfe7943d2e'),
            ('public.duplicate_course(uuid,uuid)', '27a2bdb32de32b2c2eea29e45bd7186d', '07496e59952ea9fddc55373e21322b09'),
            ('public.import_json_restore(jsonb,uuid)', '313b640628406434ac900443f0e91976', 'c2943dda03581e9397b1d5e3e44ec5d6')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    -- The nine-argument upsert_rubric: as live has it, or gone (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN dropped
            ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)', '8346ff56ec20239d3289f641597401d4')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The four new ones: absent, or as this file leaves them.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new
            ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)', '9ee43afa5a004f1eb49c19ea066b4f09'),
            ('public._rubric_comment_list(jsonb,integer)', '3c09d92742de880fac5cafa2657a6f99'),
            ('public.add_criterion_comment(uuid,smallint,text,uuid)', 'bb89f9e27e67e91b03606cd753b2a19a'),
            ('public.add_rubric_overall_comment(uuid,text,uuid)', 'f39938dae40b2c981c43f76a1b934640')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists and is not as this file leaves it (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if to_regprocedure('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)') is null
       and to_regprocedure('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)') is null then
        raise exception 'public.upsert_rubric is in neither its old nor its new form. Nothing was changed.';
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname in ('upsert_rubric', 'add_criterion_comment', 'add_rubric_overall_comment', '_rubric_comment_list')
                  and p.oid not in (select coalesce(to_regprocedure(s)::oid, 0) from unnest(array[
                      'public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)',
                      'public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)',
                      'public.add_criterion_comment(uuid,smallint,text,uuid)',
                      'public.add_rubric_overall_comment(uuid,text,uuid)',
                      'public._rubric_comment_list(jsonb,integer)']) s)) then
        raise exception 'a function named upsert_rubric, add_criterion_comment, add_rubric_overall_comment or _rubric_comment_list with other arguments is there. Nothing was changed.';
    end if;
    select string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end, ', ' order by attnum) into _c
      from pg_attribute where attrelid = 'public.criterion'::regclass and attnum > 0 and not attisdropped;
    if _c not in ('id uuid not null, rubric_id uuid not null, name text not null, level_4_descriptor text, level_3_descriptor text, level_2_descriptor text, level_1_descriptor text, level_4_value numeric not null, level_3_value numeric not null, level_2_value numeric not null, level_1_value numeric not null, weight numeric not null, display_order integer not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, level_5_descriptor text, level_6_descriptor text',
                  'id uuid not null, rubric_id uuid not null, name text not null, level_4_descriptor text, level_3_descriptor text, level_2_descriptor text, level_1_descriptor text, level_4_value numeric not null, level_3_value numeric not null, level_2_value numeric not null, level_1_value numeric not null, weight numeric not null, display_order integer not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, level_5_descriptor text, level_6_descriptor text, comments jsonb not null') then
        raise exception 'public.criterion is not as 2026111901 left it (found %). Nothing was changed.', _c;
    end if;
    select string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end, ', ' order by attnum) into _c
      from pg_attribute where attrelid = 'public.rubric'::regclass and attnum > 0 and not attisdropped;
    if _c not in ('id uuid not null, course_id uuid not null, name text not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, copy_group uuid, style text not null, scale jsonb',
                  'id uuid not null, course_id uuid not null, name text not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, copy_group uuid, style text not null, scale jsonb, overall_comments jsonb not null') then
        raise exception 'public.rubric is not as 2026111901 left it (found %). Nothing was changed.', _c;
    end if;
end
$guard$;

-- == 1. The two columns ==
-- A constant default: PostgreSQL 17 stores it once and rewrites no row.
alter table public.criterion add column if not exists comments jsonb not null default '[]'::jsonb;
alter table public.rubric add column if not exists overall_comments jsonb not null default '[]'::jsonb;
do $checks$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.criterion'::regclass and conname = 'criterion_comments_is_list') then
        alter table public.criterion add constraint criterion_comments_is_list check (jsonb_typeof(comments) = 'array');
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.rubric'::regclass and conname = 'rubric_overall_comments_is_list') then
        alter table public.rubric add constraint rubric_overall_comments_is_list check (jsonb_typeof(overall_comments) = 'array');
    end if;
end
$checks$;
comment on column public.criterion.comments is
    'The teacher''s comment bank for this criterion (2026112601): [{level, text}], in the order shown. Teacher-only; never sent to the student page.';
comment on column public.rubric.overall_comments is
    'The teacher''s overall comments for this rubric (2026112601): [text], in the order shown. Teacher-only; never sent to the student page.';

-- == 2. The one rule for a list of comments ==
create or replace function public._rubric_comment_list(p_list jsonb, p_levels integer)
 returns jsonb
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
-- p_levels null: a rubric's overall comments, a list of texts. Otherwise a criterion's comments, a list of
-- {level, text} with level 1..p_levels (4, or 6 on a rubric with its own levels), read as upsert_rubric
-- reads a check's level. Each text is trimmed of spaces, tabs and line breaks and must then be 1 to 500
-- characters. A repeat of the same level and text is kept once, where it first came. At most 40. Returns
-- the list as it is to be stored, or stops with 22023.
declare
    _e     jsonb;
    _t     text;
    _lv    int;
    _item  jsonb;
    _out   jsonb := '[]'::jsonb;
    _trim  text := chr(32) || chr(9) || chr(10) || chr(13);
begin
    if p_list is null or jsonb_typeof(p_list) <> 'array' then
        raise exception 'comments must be a list' using errcode = '22023';
    end if;
    for _e in select x.v from jsonb_array_elements(p_list) with ordinality as x(v, n) order by x.n loop
        if p_levels is null then
            if jsonb_typeof(_e) <> 'string' then
                raise exception 'an overall comment must be text' using errcode = '22023';
            end if;
            _t := _e #>> '{}';
        else
            if jsonb_typeof(_e) <> 'object' or jsonb_typeof(_e->'text') is distinct from 'string' then
                raise exception 'a comment must have a level and a text' using errcode = '22023';
            end if;
            _lv := (_e->>'level')::int;
            if _lv is null or _lv < 1 or _lv > p_levels then
                raise exception 'a comment''s level must be 1..4, or 1..6 on a rubric with its own levels' using errcode = '22023';
            end if;
            _t := _e->>'text';
        end if;
        _t := btrim(_t, _trim);
        if length(_t) < 1 or length(_t) > 500 then
            raise exception 'a comment must be 1 to 500 characters' using errcode = '22023';
        end if;
        _item := case when p_levels is null then to_jsonb(_t) else jsonb_build_object('level', _lv, 'text', _t) end;
        -- jsonb containment compares texts byte for byte: no collation is involved.
        if not _out @> jsonb_build_array(_item) then
            if jsonb_array_length(_out) >= 40 then
                raise exception 'at most 40 comments' using errcode = '22023';
            end if;
            _out := _out || jsonb_build_array(_item);
        end if;
    end loop;
    return _out;
end;
$function$;

-- == 3. upsert_rubric: comments on each criterion, and p_overall_comments ==
-- Edits to the live nine-argument definition, each found exactly once, then the ten-argument function is
-- made from it and the nine-argument one dropped, so PostgREST has one function to call. The app already in
-- teachers' browsers names no p_overall_comments and sends no "comments" key, and keeps what is stored.
do $upsert$
declare
  _edits text[][] := array[
    -- text to find, replacement
    array['p_scale jsonb DEFAULT NULL::jsonb)',
          'p_scale jsonb DEFAULT NULL::jsonb, p_overall_comments jsonb DEFAULT NULL::jsonb)'],
    array['    _level       int;
begin',
          '    _level       int;
    _comments    jsonb;
    _overall     jsonb;
begin'],
    array['    if p_linked_tag_ids is not null and jsonb_typeof(p_linked_tag_ids) <> ''array'' then',
          '    -- 2026112601: the rubric''s overall comments. Null keeps them; a list replaces them.
    if p_overall_comments is not null then
        _overall := public._rubric_comment_list(p_overall_comments, null);
    end if;

    if p_linked_tag_ids is not null and jsonb_typeof(p_linked_tag_ids) <> ''array'' then'],
    array['insert into rubric (course_id, name, copy_group, style, scale)',
          'insert into rubric (course_id, name, copy_group, style, scale, overall_comments)'],
    -- the update first: the insert's edit below adds a second "else p_scale end,"
    array['else p_scale end,
',
          'else p_scale end,
                          overall_comments = coalesce(_overall, overall_comments),
'],
    array['else p_scale end)
        returning id into _rubric_id;',
          'else p_scale end,
                coalesce(_overall, ''[]''::jsonb))
        returning id into _rubric_id;'],
    array['for _elem in select * from jsonb_array_elements(p_criteria) loop
',
          'for _elem in select * from jsonb_array_elements(p_criteria) loop
        -- 2026112601: this criterion''s comment bank. No "comments" key (or null) keeps what is stored;
        -- a list replaces it.
        _comments := case when jsonb_typeof(_elem->''comments'') is distinct from ''null''
                               and jsonb_typeof(_elem->''comments'') is not null
                          then public._rubric_comment_list(_elem->''comments'',
                                   case when (select scale from rubric where id = _rubric_id) is not null then 6 else 4 end)
                     end;
'],
    array['display_order      = coalesce((_elem->>''display_order'')::int, 0),
',
          'display_order      = coalesce((_elem->>''display_order'')::int, 0),
                comments           = coalesce(_comments, comments),
'],
    array['weight, display_order, level_5_descriptor, level_6_descriptor
',
          'weight, display_order, level_5_descriptor, level_6_descriptor, comments
'],
    array['_elem->>''level_5_descriptor'', _elem->>''level_6_descriptor''
',
          '_elem->>''level_5_descriptor'', _elem->>''level_6_descriptor'',
                coalesce(_comments, ''[]''::jsonb)
']
  ];
  _old  text := 'public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)';
  _new  text := 'public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)';
  _def  text;
  _hits int;
  i     int;
begin
  if to_regprocedure(_new) is null then
    _def := pg_get_functiondef(_old::regprocedure);
    for i in 1 .. array_length(_edits, 1) loop
      _hits := (length(_def) - length(replace(_def, _edits[i][1], ''))) / length(_edits[i][1]);
      if _hits <> 1 then
        raise exception '% has % matches for "%", expected 1. Nothing was changed.', _old, _hits, _edits[i][1];
      end if;
      _def := replace(_def, _edits[i][1], _edits[i][2]);
    end loop;
    execute _def;
  end if;
end
$upsert$;
drop function if exists public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb);

-- == 4. The three patched in place ==
-- Each function's edits are made together, each found exactly once, then the function is replaced once.
-- A function already as this file leaves it is skipped.
do $migration$
declare
  _edits text[][] := array[
    -- function, text to find, replacement
    array['public.get_class_bundle(uuid,bigint)',
          '''copy_group'', r.copy_group, ''style'', r.style, ''scale'', r.scale)',
          '''copy_group'', r.copy_group, ''style'', r.style, ''scale'', r.scale,
                                                ''overall_comments'', r.overall_comments)'],
    array['public.get_class_bundle(uuid,bigint)',
          '''weight'', c.weight, ''display_order'', c.display_order
',
          '''weight'', c.weight, ''display_order'', c.display_order, ''comments'', c.comments
'],
    array['public.duplicate_course(uuid,uuid)',
          'insert into rubric (id, course_id, name, style, scale) values (_new_id, _new_course, _row.name, _row.style, _row.scale);',
          'insert into rubric (id, course_id, name, style, scale, overall_comments) values (_new_id, _new_course, _row.name, _row.style, _row.scale, _row.overall_comments);'],
    array['public.duplicate_course(uuid,uuid)',
          'level_5_descriptor, level_6_descriptor)',
          'level_5_descriptor, level_6_descriptor, comments)'],
    array['public.duplicate_course(uuid,uuid)',
          '_row.level_5_descriptor, _row.level_6_descriptor);',
          '_row.level_5_descriptor, _row.level_6_descriptor, _row.comments);'],
    array['public.import_json_restore(jsonb,uuid)',
          'insert into rubric (id, course_id, name, style, scale)',
          'insert into rubric (id, course_id, name, style, scale, overall_comments)'],
    array['public.import_json_restore(jsonb,uuid)',
          'case when jsonb_typeof(_row->''scale'') = ''array'' then _row->''scale'' end)',
          'case when jsonb_typeof(_row->''scale'') = ''array'' then _row->''scale'' end,
                case when jsonb_typeof(_row->''overall_comments'') = ''array''
                     then public._rubric_comment_list(_row->''overall_comments'', null) else ''[]''::jsonb end)'],
    array['public.import_json_restore(jsonb,uuid)',
          'scale=excluded.scale, updated_at=now();',
          'scale=excluded.scale, overall_comments=excluded.overall_comments, updated_at=now();'],
    array['public.import_json_restore(jsonb,uuid)',
          'level_5_descriptor, level_6_descriptor)',
          'level_5_descriptor, level_6_descriptor, comments)'],
    array['public.import_json_restore(jsonb,uuid)',
          '_row->>''level_5_descriptor'', _row->>''level_6_descriptor'')',
          '_row->>''level_5_descriptor'', _row->>''level_6_descriptor'',
                case when jsonb_typeof(_row->''comments'') = ''array''
                     then public._rubric_comment_list(_row->''comments'',
                              case when (select scale from rubric where id = (_row->>''rubric_id'')::uuid) is not null then 6 else 4 end)
                     else ''[]''::jsonb end)'],
    array['public.import_json_restore(jsonb,uuid)',
          'level_5_descriptor=excluded.level_5_descriptor, level_6_descriptor=excluded.level_6_descriptor,',
          'level_5_descriptor=excluded.level_5_descriptor, level_6_descriptor=excluded.level_6_descriptor,
          comments=excluded.comments,']
  ];
  _def  text;
  _hits int;
  _fn   text := '';
  _skip boolean := false;
  i     int;
begin
  for i in 1 .. array_length(_edits, 1) loop
    if _edits[i][1] <> _fn then
      if _fn <> '' and not _skip then execute _def; end if;
      _fn := _edits[i][1];
      _def := pg_get_functiondef(_fn::regprocedure);
      _skip := md5(_def) = (select v.becomes from (values
          -- FINGERPRINTS-BEGIN becomes
          ('public.get_class_bundle(uuid,bigint)', '481cba076e47cf26dbd523cfe7943d2e'),
          ('public.duplicate_course(uuid,uuid)', '07496e59952ea9fddc55373e21322b09'),
          ('public.import_json_restore(jsonb,uuid)', 'c2943dda03581e9397b1d5e3e44ec5d6')
          -- FINGERPRINTS-END
        ) as v(fn, becomes) where v.fn = _fn);
    end if;
    if not _skip then
      _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
      if _hits <> 1 then
        raise exception '% has % matches for "%", expected 1. Nothing was changed.', _fn, _hits, _edits[i][2];
      end if;
      _def := replace(_def, _edits[i][2], _edits[i][3]);
    end if;
  end loop;
  if not _skip then execute _def; end if;
end
$migration$;

-- == 5. Add to Bank: one comment at a time, so grading never sends a whole rubric ==
-- Both run as the teacher (row security applies) and check the class is theirs. Each locks the rubric row
-- first and then the criterion row, in the order upsert_rubric and import_json_restore write them, so an add
-- and a rubric save wait for each other and never deadlock over the class's sync cursor. "No key update"
-- locks do not hold up a grade being saved (a score row only needs the criterion to stay).
create or replace function public.add_criterion_comment(p_criterion_id uuid, p_level smallint, p_text text, p_idempotency_key uuid default null::uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
-- Adds one comment at one level to a criterion's bank, unless the same level and text is there already, and
-- returns the criterion's whole list. Refuses past 40.
declare
    _cached jsonb;
    _rubric uuid;
    _scale  jsonb;
    _list   jsonb;
    _one    jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'add_criterion_comment');
    if _cached is not null then
        return _cached;
    end if;
    select r.id, r.scale into _rubric, _scale
      from rubric r join criterion c on c.rubric_id = r.id
     where c.id = p_criterion_id and fv_owns_course(r.course_id)
       for no key update of r;
    if not found then
        raise exception 'criterion not found' using errcode = 'P0002';
    end if;
    select c.comments into _list from criterion c where c.id = p_criterion_id and c.rubric_id = _rubric
       for no key update;
    if not found then
        raise exception 'criterion not found' using errcode = 'P0002';
    end if;
    _one := _rubric_comment_list(jsonb_build_array(jsonb_build_object('level', p_level, 'text', p_text)),
                                 case when _scale is not null then 6 else 4 end);
    if not _list @> _one then
        if jsonb_array_length(_list) >= 40 then
            raise exception 'this criterion already has 40 comments' using errcode = '22023';
        end if;
        _list := _list || _one;
        update criterion set comments = _list, updated_at = now() where id = p_criterion_id;
    end if;
    perform fv_idem_store(p_idempotency_key, 'add_criterion_comment', _list);
    return _list;
end;
$function$;

create or replace function public.add_rubric_overall_comment(p_rubric_id uuid, p_text text, p_idempotency_key uuid default null::uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
-- Adds one overall comment to a rubric, unless the same text is there already, and returns the rubric's whole
-- list. Refuses past 40.
declare
    _cached jsonb;
    _list   jsonb;
    _one    jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'add_rubric_overall_comment');
    if _cached is not null then
        return _cached;
    end if;
    select r.overall_comments into _list from rubric r
     where r.id = p_rubric_id and fv_owns_course(r.course_id)
       for no key update;
    if not found then
        raise exception 'rubric not found' using errcode = 'P0002';
    end if;
    _one := _rubric_comment_list(jsonb_build_array(to_jsonb(p_text)), null);
    if not _list @> _one then
        if jsonb_array_length(_list) >= 40 then
            raise exception 'this rubric already has 40 overall comments' using errcode = '22023';
        end if;
        _list := _list || _one;
        update rubric set overall_comments = _list, updated_at = now() where id = p_rubric_id;
    end if;
    perform fv_idem_store(p_idempotency_key, 'add_rubric_overall_comment', _list);
    return _list;
end;
$function$;

-- == 6. Who can run what ==
-- As upsert_rubric is today: a signed-in teacher and the service role; a visitor never. The rule for a list
-- is run inside the teacher's own calls (they are not security definer), so the teacher needs it too.
revoke all on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.add_criterion_comment(uuid, smallint, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.add_criterion_comment(uuid, smallint, text, uuid) to authenticated, service_role;
revoke all on function public.add_rubric_overall_comment(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.add_rubric_overall_comment(uuid, text, uuid) to authenticated, service_role;
revoke all on function public._rubric_comment_list(jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public._rubric_comment_list(jsonb, integer) to authenticated, service_role;

-- == Everything is as the header says ==
do $final$
declare
    _f    record;
    _md5  text;
    _bad  text[] := '{}';
    _got  text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN after
            ('public.get_class_bundle(uuid,bigint)', '481cba076e47cf26dbd523cfe7943d2e'),
            ('public.duplicate_course(uuid,uuid)', '07496e59952ea9fddc55373e21322b09'),
            ('public.import_json_restore(jsonb,uuid)', 'c2943dda03581e9397b1d5e3e44ec5d6'),
            ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)', '9ee43afa5a004f1eb49c19ea066b4f09'),
            ('public._rubric_comment_list(jsonb,integer)', '3c09d92742de880fac5cafa2657a6f99'),
            ('public.add_criterion_comment(uuid,smallint,text,uuid)', 'bb89f9e27e67e91b03606cd753b2a19a'),
            ('public.add_rubric_overall_comment(uuid,text,uuid)', 'f39938dae40b2c981c43f76a1b934640')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.becomes);
        end if;
    end loop;
    if to_regprocedure('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)') is not null then
        _bad := _bad || 'the nine-argument upsert_rubric is still there'::text;
    end if;
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('upsert_rubric', 'add_criterion_comment', 'add_rubric_overall_comment', '_rubric_comment_list')) <> 4 then
        _bad := _bad || 'the four functions do not have one signature each'::text;
    end if;
    for _f in
        select * from (values
            ('public.criterion'::regclass, 'comments', 'criterion_comments_is_list'),
            ('public.rubric'::regclass, 'overall_comments', 'rubric_overall_comments_is_list')
        ) as v(rel, col, con)
    loop
        if not exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                        where a.attrelid = _f.rel and a.attname = _f.col and not a.attisdropped and a.attnotnull
                          and a.atttypid = 'jsonb'::regtype and pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb') then
            _bad := _bad || format('%s.%s is not jsonb not null default []', _f.rel, _f.col);
        end if;
        if not exists (select 1 from pg_constraint where conrelid = _f.rel and conname = _f.con and contype = 'c' and convalidated) then
            _bad := _bad || format('%s has no check %s', _f.rel, _f.con);
        end if;
    end loop;
    -- Grants are read from proacl itself, so default privileges show here.
    for _f in
        select * from (values
            ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)'),
            ('public.add_criterion_comment(uuid,smallint,text,uuid)'),
            ('public.add_rubric_overall_comment(uuid,text,uuid)'),
            ('public._rubric_comment_list(jsonb,integer)')
        ) as v(fn)
    loop
        select coalesce(string_agg(w, ', ' order by w collate "C"), '') into _got
          from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(_f.fn) and a.grantee <> p.proowner) x;
        if _got is distinct from 'authenticated, service_role' then
            _bad := _bad || format('grant: %s may be run by "%s", not "authenticated, service_role"', _f.fn, _got);
        end if;
    end loop;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
