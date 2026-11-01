-- The audit writers only record changes to the caller's own records
-- (2026-11-02).
--
-- _score_audit_diff and _term_rating_audit_field are SECURITY DEFINER and
-- signed-in teachers can execute them: the SECURITY INVOKER RPCs that call
-- them (upsert_score, set_score_status, clear_score, clear_row_scores,
-- clear_column_scores, save_term_rating, save_term_attendance) need that
-- EXECUTE, so it can't be revoked. Neither checked who owned the row, so any
-- teacher could call /rest/v1/rpc/_score_audit_diff with another teacher's
-- score id and add a false entry to that score's change history.
--
-- Each now writes only when the caller owns the score or term rating. The
-- RPCs above call them after their own ownership checks and before any
-- delete, so every call the app makes still writes its row. Any other call
-- writes nothing and raises nothing, so no caller changes.

create or replace function public._score_audit_diff(
    p_score_id uuid, p_old_value numeric, p_new_value numeric,
    p_old_status text, p_new_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    if not exists (select 1 from score s
                   where s.id = p_score_id and fv_owns_enrollment(s.enrollment_id)) then
        return;
    end if;
    if p_old_value is distinct from p_new_value
       or p_old_status is distinct from p_new_status then
        insert into score_audit (score_id, changed_by,
                                 old_value, new_value, old_status, new_status)
        values (p_score_id, (select auth.uid()),
                p_old_value, p_new_value, p_old_status, p_new_status);
    end if;
end; $function$;

create or replace function public._term_rating_audit_field(
    p_tr_id uuid, p_field text, p_old text, p_new text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    if not fv_owns_term_rating(p_tr_id) then
        return;
    end if;
    if p_old is distinct from p_new then
        insert into term_rating_audit (term_rating_id, changed_by, field_changed, old_value, new_value)
        values (p_tr_id, (select auth.uid()), p_field, p_old, p_new);
    end if;
end; $function$;
