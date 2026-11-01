-- Assignment feedback moves to the Overall Comment (score.comment).
--
-- What was wrong: the rubric handout and the Quick Report's assignment
-- cards print, as the feedback on a piece of work, every non-private
-- observation linked to it and then the Overall Comment
-- (RubricPrint.feedbackItems). Since the Oct 2026 observations work, the
-- student Comment button in Assignments wrote observations, so teachers'
-- comments on work landed there instead of in the Overall Comment.
-- Decided Nov 1 2026: the bottom of a rubric or assignment prints the
-- Overall Comment only; observations stay a separate record.
--
-- What this does: for each student and piece of work with printable linked
-- observations (not Concern or Note) and an empty Overall Comment, it sets
-- the Overall Comment to those observations' text, oldest first, one per
-- line, trimmed as the print trims it. A student with no score row on the
-- work gets one holding only the comment (value null), as
-- save_score_comment makes. So once printing reads the Overall Comment
-- only, every handout and report prints the same words as before.
--
-- Not changed: the observations themselves (they stay on the Observations
-- page and the report's Observations card), any Overall Comment that
-- already has text, levels, points and statuses. No grade changes.
--
-- Live data on Nov 1 2026: 45 student and work pairs, one observation each,
-- none with an Overall Comment; 44 on points work (all scored), 1 with no
-- score row.
--
-- Safe to run twice: the second run finds every Overall Comment filled.
--
-- Undo (only rows this set, matched by their exact text):
--   update public.score s set comment = null, updated_at = now()
--     from (<the "printable" select below>) p
--    where s.enrollment_id = p.enrollment_id and s.assessment_id = p.assessment_id
--      and s.comment = p.body;
--   (the one inserted row keeps value null; delete it too if wanted:
--    delete from public.score where comment is null and value is null
--      and status is null and report_note is null
--      and (enrollment_id, assessment_id) in (<the same pairs>);)

begin;

do $migration$
declare
  _expected int;
  _updated int;
  _inserted int;
begin
  create temporary table _printable on commit drop as
  select os.enrollment_id,
         o.assessment_id,
         string_agg(regexp_replace(o.body, '^\s+|\s+$', '', 'g'), E'\n' order by o.created_at, o.id) as body
    from public.observation o
    join public.observation_student os on os.observation_id = o.id
    join public.enrollment e on e.id = os.enrollment_id
    join public.assessment a on a.id = o.assessment_id and a.course_id = e.course_id
   where o.assessment_id is not null
     and regexp_replace(coalesce(o.body, ''), '^\s+|\s+$', '', 'g') <> ''
     and (o.sentiment is null or o.sentiment not in ('concern', 'note'))
   group by os.enrollment_id, o.assessment_id;

  -- Only pairs whose Overall Comment is empty are written.
  select count(*) into _expected
    from _printable p
    left join public.score s on s.enrollment_id = p.enrollment_id and s.assessment_id = p.assessment_id
   where coalesce(btrim(s.comment), '') = '';

  update public.score s
     set comment = p.body,
         updated_at = now()
    from _printable p
   where s.enrollment_id = p.enrollment_id
     and s.assessment_id = p.assessment_id
     and coalesce(btrim(s.comment), '') = '';
  get diagnostics _updated = row_count;

  insert into public.score (enrollment_id, assessment_id, comment)
  select p.enrollment_id, p.assessment_id, p.body
    from _printable p
   where not exists (
     select 1 from public.score s
      where s.enrollment_id = p.enrollment_id and s.assessment_id = p.assessment_id
   );
  get diagnostics _inserted = row_count;

  if _updated + _inserted <> _expected then
    raise exception 'expected % Overall Comments, wrote % (updated %, inserted %)',
      _expected, _updated + _inserted, _updated, _inserted;
  end if;

  raise notice 'Overall Comments written: % (updated %, inserted %)', _updated + _inserted, _updated, _inserted;
end
$migration$;

commit;
