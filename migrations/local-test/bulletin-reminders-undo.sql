-- Undo for migrations/2026111809_bulletin_reminders.sql: the two functions as
-- they were live on Nov 18, and bulletin_reminder dropped. One transaction.
begin;
set local lock_timeout = '5s';
drop function if exists public.show_bulletin_again(uuid,uuid,uuid[]);
CREATE OR REPLACE FUNCTION public.show_bulletin_again(p_bulletin_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _cached jsonb;
  _course uuid;
  _b bulletin%rowtype;
  _out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  _cached := fv_idem_check(p_idempotency_key, 'show_bulletin_again');
  if _cached is not null then return _cached; end if;
  select b.course_id into _course from bulletin b where b.id = p_bulletin_id and fv_owns_course(b.course_id);
  if _course is not null then
    perform pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(_course::text));
    -- Re-read under the lock.
    select * into _b from bulletin where id = p_bulletin_id for update;
  end if;
  if _b.id is null then
    raise exception 'bulletin not found' using errcode = 'P0002';
  elsif _b.posted_at is null then
    raise exception 'a bulletin students cannot see yet cannot be shown again' using errcode = '22023';
  end if;
  update bulletin set shown_again_at = now(), updated_at = now() where id = p_bulletin_id;
  _out := jsonb_build_object('bulletin', fv_private.bulletin_json(p_bulletin_id));
  perform fv_idem_store(p_idempotency_key, 'show_bulletin_again', _out);
  return _out;
end;
$function$;
revoke all on function public.show_bulletin_again(uuid,uuid) from public, anon;
grant execute on function public.show_bulletin_again(uuid,uuid) to authenticated;
CREATE OR REPLACE FUNCTION student_submit.bulletins(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _course uuid;
    _tz     text;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _course := (_in->>'course_id')::uuid;
    select c.timezone, (now() at time zone public._fv_timezone(c.timezone))::date into _tz, _today from public.course c where c.id = _course;
    return jsonb_build_object(
        'ok', true,
        -- Oldest first; one shown again that this student has not seen sorts at its Show It Again time.
        -- The newest 100 of that order.
        'bulletins', coalesce((
            select jsonb_agg(x.item order by x.sort_at, x.id)
              from (select b.id,
                           coalesce(case when b.shown_again_at is not null and s.seen_at is null then b.shown_again_at end,
                                    b.posted_at) as sort_at,
                           jsonb_build_object(
                               'id', b.id, 'kind', b.kind, 'body', b.body,
                               'link_url', b.link_url, 'link_title', b.link_title,
                               -- Pinned as the teacher's list shows it (M1's rule): off once its last day has passed.
                               'pinned', fv_private.bulletin_pinned_now(b.pinned, b.pinned_until, _tz),
                               'pinned_until', b.pinned_until,
                               -- The linked piece only when the student's page lists it (not a draft, assigned).
                               'assessment_id', (select a.id from public.assessment a
                                                  where a.id = b.assessment_id and a.course_id = b.course_id
                                                    and student_submit._listed(a, _today)),
                               'reactions_on', b.reactions_on,
                               'posted_at', b.posted_at, 'edited_at', b.edited_at,
                               'files', coalesce((select jsonb_agg(jsonb_build_object(
                                                         'id', f.id, 'kind', f.kind, 'title', f.title,
                                                         'page_count', f.page_count, 'position', f.position)
                                                         order by f.position, f.id)
                                                    from public.bulletin_file f
                                                   where f.bulletin_id = b.id and f.status = 'ready'), '[]'::jsonb),
                               -- This student's own, and no one else's.
                               'seen_at', s.seen_at,
                               'reaction', r.word) as item
                      from public.bulletin b
                      left join public.bulletin_seen s on s.bulletin_id = b.id and s.enrollment_id = p_enrollment_id
                      left join public.bulletin_reaction r on r.bulletin_id = b.id and r.enrollment_id = p_enrollment_id
                     where b.course_id = _course and student_submit._bulletin_visible(b.id, p_enrollment_id)
                     order by sort_at desc, b.id desc
                     limit 100) x), '[]'::jsonb),
        -- For each class on this device, that student's own count of bulletins not yet seen.
        'new', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'enrollment_id', k.enrollment_id,
                       'count', (select count(*) from public.bulletin b
                                   join public.enrollment e on e.id = k.enrollment_id and e.course_id = b.course_id
                                  where student_submit._bulletin_visible(b.id, k.enrollment_id)
                                    and not exists (select 1 from public.bulletin_seen s
                                                     where s.bulletin_id = b.id and s.enrollment_id = k.enrollment_id)))
                       order by k.n)
              from unnest(student_submit._bulletin_session_enrollments((_in->>'session_id')::uuid))
                   with ordinality as k(enrollment_id, n)), '[]'::jsonb));
end;
$function$;
drop table if exists public.bulletin_reminder;
commit;
