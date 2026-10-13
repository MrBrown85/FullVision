-- Fix score writes and deletes reported by a teacher on 2026-10-12.
--
-- 1. upsert_score: select-then-insert raced when the gradebook fired two
--    writes for one cell (unique violation on score_enrollment_id_assessment_id_key).
--    Now atomic; audit row only when the value actually changes.
-- 2. upsert_tag_score: points assessments sent raw points (5, 6, 0) into
--    tag_score, whose CHECK is 1..4, so the write failed and a stale value
--    stayed behind. For points assessments the value belongs on score, so
--    route it there. A value of 0/null on a proficiency tag clears the row
--    instead of violating the CHECK.
-- 3. delete_student: the client passes the enrollment id (its student id is
--    the enrollment id). Resolve an enrollment id to its student.
-- 4. delete_subject / delete_section / delete_tag / delete_competency_group:
--    deleting a row that is already gone is a success. The learning-map save
--    fires overlapping deletes and one "not found" aborted the whole save.

create or replace function public.upsert_score(p_enrollment_id uuid, p_assessment_id uuid, p_value numeric)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _id uuid; _old_v numeric; _old_s text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    insert into score (enrollment_id, assessment_id, value)
    values (p_enrollment_id, p_assessment_id, p_value)
    on conflict (enrollment_id, assessment_id) do nothing
    returning id into _id;

    if _id is not null then
        perform _score_audit_diff(_id, null, p_value, null, null);
        return _id;
    end if;

    select id, value, status into _id, _old_v, _old_s
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       for update;

    if _old_v is distinct from p_value then
        update score set value = p_value, scored_at = now(), updated_at = now()
         where id = _id;
        perform _score_audit_diff(_id, _old_v, p_value, _old_s, _old_s);
    end if;
    return _id;
end; $function$;

create or replace function public.upsert_tag_score(p_enrollment_id uuid, p_assessment_id uuid, p_tag_id uuid, p_value integer)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare _id uuid; _rubric uuid; _mode text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select rubric_id, score_mode into _rubric, _mode from assessment where id = p_assessment_id;
    if _rubric is not null then
        raise exception 'tag_score is not used for rubric assessments' using errcode = '22023';
    end if;

    if _mode = 'points' then
        delete from tag_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        return upsert_score(p_enrollment_id, p_assessment_id, p_value);
    end if;

    if p_value is null or p_value = 0 then
        delete from tag_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        return null;
    end if;

    insert into tag_score (enrollment_id, assessment_id, tag_id, value)
    values (p_enrollment_id, p_assessment_id, p_tag_id, p_value)
    on conflict (enrollment_id, assessment_id, tag_id) do update
       set value = excluded.value, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

create or replace function public.delete_student(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _student_id uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    select id into _student_id from student where id = p_id;
    if _student_id is null then
        select student_id into _student_id from enrollment where id = p_id;
    end if;
    delete from student where id = _student_id;
    if not found then
        raise exception 'student not found' using errcode = 'P0002';
    end if;
end; $function$;

create or replace function public.delete_subject(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from subject where id = p_id;
end; $function$;

create or replace function public.delete_section(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from section where id = p_id;
end; $function$;

create or replace function public.delete_tag(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from tag where id = p_id;
end; $function$;

create or replace function public.delete_competency_group(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    -- section.competency_group_id is ON DELETE SET NULL (composite FK, match simple).
    delete from competency_group where id = p_id;
end; $function$;
