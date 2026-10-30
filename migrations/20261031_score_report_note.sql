-- Note for the Report on a scored piece (Generate plan, PR 7).
--
-- What is needed: the comment's best-piece sentence ("Her best piece was
-- “{title}”, where she {note}.") takes its words from the teacher, never from
-- the title. The grader gets an optional one-line "Note for the Report" under
-- Overall Feedback. Overall Feedback (score.comment) is written to the
-- student and prints on the rubric handout, so the note needs its own column.
--
-- What it adds:
--   score.report_note text: one line about what the student did, written
--     about them ("linked the poster to the Act"); null = no note. At most
--     300 characters; an empty or blank note is stored as null.
--   save_score_report_note(p_enrollment_id, p_assessment_id, p_note,
--     p_idempotency_key): sets the note, in the style of save_score_comment
--     (a score row is made when there is none; null or '' clears the note and
--     leaves the row). Returns the score id. RLS on score
--     (fv_owns_enrollment) is the ownership check, as for save_score_comment.
--     Idempotent by key through fv_idem_check (CLAUDE.md rule 7); a replay
--     returns the first call's id.
--   get_class_bundle: score_rows gain report_note as a seventh tuple element
--     (patched in place from the live body; clients that read six elements
--     are unaffected).
-- No data changes: every existing score gets null. No grade changes.

begin;

alter table public.score
  add column if not exists report_note text
    constraint score_report_note_length check (report_note is null or char_length(report_note) between 1 and 300);

create or replace function public.save_score_report_note(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_note text,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _note text; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'save_score_report_note');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    _note := nullif(btrim(p_note), '');
    if char_length(_note) > 300 then
        raise exception 'report note must be 300 characters or fewer' using errcode = '22023';
    end if;

    select id into _id from score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;

    if _id is null then
        insert into score (enrollment_id, assessment_id, report_note)
        values (p_enrollment_id, p_assessment_id, _note)
        returning id into _id;
    else
        update score set report_note = _note, updated_at = now() where id = _id;
    end if;

    perform fv_idem_store(p_idempotency_key, 'save_score_report_note', jsonb_build_object('id', _id));
    return _id;
end; $function$;

revoke all on function public.save_score_report_note(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.save_score_report_note(uuid, uuid, text, uuid) to authenticated, service_role;

-- get_class_bundle: one exact edit per anchor to the live definition. Each
-- anchor must match once, or the migration stops and nothing is changed.
do $migration$
declare
  _edits text[][] := array[
    array['jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment, s.modifier)',
          'jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment, s.modifier, s.report_note)'],
    array['-- [student, assessment, value, status, comment, modifier]',
          '-- [student, assessment, value, status, comment, modifier, report_note]']
  ];
  _def text;
  _hits int;
  i int;
begin
  _def := pg_get_functiondef('public.get_class_bundle(uuid,bigint)'::regprocedure);
  if position('s.modifier, s.report_note)' in _def) > 0 then
    return;  -- already patched (a re-run)
  end if;
  for i in 1 .. array_length(_edits, 1) loop
    _hits := (length(_def) - length(replace(_def, _edits[i][1], ''))) / length(_edits[i][1]);
    if _hits <> 1 then
      raise exception 'get_class_bundle has % matches for "%", expected 1', _hits, _edits[i][1];
    end if;
    _def := replace(_def, _edits[i][1], _edits[i][2]);
  end loop;
  execute _def;
end
$migration$;

commit;
