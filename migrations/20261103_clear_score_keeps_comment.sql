-- Clear Score clears the score, not the teacher's writing (2026-11-03).
--
-- What broke: the gradebook's Clear Score (right-click a cell) calls
-- clear_score, which deleted the whole score row. That row also holds the
-- Overall Comment (score.comment), the Note for the Report
-- (score.report_note) and the Missing / Excused / Late mark (score.status).
-- So:
--   - a written Overall Comment or Note for the Report was lost on the
--     server, though both save before or after any level (DECISIONS,
--     "One comment on a piece of work");
--   - ⌘Z after Clear Score put the comment back on screen and on the
--     server, but the Note for the Report only on screen: it was gone at the
--     next load;
--   - Clear Score on a Missing or Late cell left the mark on screen (the
--     gradebook never clears it) but deleted it on the server, so a Missing
--     piece stopped counting as 0 at the next load.
-- The audit row clear_score wrote went with the row (score_audit cascades).
--
-- Now clear_score clears score.value and score.modifier and removes the
-- rubric_score and tag_score rows, as before. It deletes the score row only
-- when nothing else is on it; a row with a status, an Overall Comment or a
-- Note for the Report stays with value null, which every reader already
-- treats as no score (save_score_comment and save_score_report_note make
-- such rows today). The audit row records the value going to null, status
-- unchanged.
--
-- No grade changes for any score: a cleared value is still no score. The
-- one grade that changes is a Missing piece a teacher right-clicks and
-- clears, which now stays Missing (0), as the screen already shows. No
-- existing data changes. clear_score keeps its arguments and grants; still
-- SECURITY INVOKER, so RLS on score, rubric_score and tag_score
-- (fv_owns_enrollment) is the ownership check.

create or replace function public.clear_score(p_enrollment_id uuid, p_assessment_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _id uuid; _old_v numeric; _old_s text; _keep boolean;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select id, value, status,
           status is not null
           or nullif(btrim(comment), '') is not null
           or report_note is not null
      into _id, _old_v, _old_s, _keep
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       for update;

    if _id is not null then
        perform _score_audit_diff(_id, _old_v, null, _old_s, _old_s);
        if _keep then
            update score set value = null, modifier = 0, updated_at = now() where id = _id;
        else
            delete from score where id = _id;
        end if;
    end if;
    delete from rubric_score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    delete from tag_score    where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
end; $function$;
