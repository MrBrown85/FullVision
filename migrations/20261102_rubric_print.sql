-- Printed rubric handouts: which students' completed rubrics were printed,
-- and when (2026-11-02, Colin: "I don't want to print the rubrics that I've
-- already handed back again ... I'd also like to know which assignments were
-- changed and can be printed again").
--
-- Print Rubrics records each scored student it prints. The dialog then offers
-- Not Yet Printed and Changed Since Printed, and the Assignments page shows
-- "Printed Oct 30" or "Changed Since Printed" beside the name. "Changed" is
-- worked out on the client: it fingerprints what the sheet shows (levels,
-- comments, overall, feedback, ticks, status) and compares that with the
-- fingerprint saved at print time. The server only stores the two values.
--
-- What it adds:
--   rubric_print                 (enrollment, assessment): printed_at and
--                                content_hash. One row per student and
--                                assessment; printing again replaces it.
--                                Cascades with the enrollment and the
--                                assessment. RLS through fv_owns_enrollment.
--   set_rubric_printed(p_enrollment_id, p_assessment_id, p_hash,
--                      p_printed_at, p_idempotency_key)
--                                A hash records a print (p_printed_at, or now
--                                when null); a null hash clears it (Undo, Mark
--                                Not Printed). Idempotent by key through
--                                fv_idem_check (CLAUDE.md rule 7); a replay
--                                returns the first call's answer.
--   get_class_bundle             the gradebook block gains `print_rows`
--                                ([student, assessment, printed_at, hash]),
--                                after check_rows. Patched in place from the
--                                live body. bundle_schema stays 3: the field
--                                is additive, and a client that does not know
--                                it ignores it.
--
-- No existing data changes: the table starts empty. No grade changes.
-- Test with begin … rollback before applying to gradebook-prod.

-- ── rubric_print ─────────────────────────────────────────────────────────────
create table if not exists public.rubric_print (
    enrollment_id uuid        not null references public.enrollment(id) on delete cascade,
    assessment_id uuid        not null references public.assessment(id) on delete cascade,
    printed_at    timestamptz not null default now(),
    content_hash  text        not null
        constraint rubric_print_hash_length check (char_length(content_hash) between 1 and 64),
    primary key (enrollment_id, assessment_id)
);

create index if not exists rubric_print_assessment_idx on public.rubric_print (assessment_id);

comment on table public.rubric_print is
    'A completed rubric handout printed for one student. content_hash fingerprints what the sheet showed, so the client can tell when it has changed since.';

alter table public.rubric_print enable row level security;

drop policy if exists rubric_print_via_enrollment on public.rubric_print;
create policy rubric_print_via_enrollment on public.rubric_print
    for all
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));

revoke all on table public.rubric_print from public, anon;
grant select, insert, update, delete on table public.rubric_print to authenticated;

-- Through the assessment, as rubric_check_score: the trigger's enrollment
-- branch also reads new.id, which this table has none of. Other devices
-- reload the class and see the marks.
drop trigger if exists course_sync_cursor_rubric_print_gradebook on public.rubric_print;
create trigger course_sync_cursor_rubric_print_gradebook
    after insert or delete or update on public.rubric_print
    for each row execute function public._touch_course_sync_cursor_from_trigger('gradebook', 'assessment');

-- ── set_rubric_printed ───────────────────────────────────────────────────────
create or replace function public.set_rubric_printed(
    p_enrollment_id uuid,
    p_assessment_id uuid,
    p_hash          text,
    p_printed_at    timestamptz default null,
    p_idempotency_key uuid default null
) returns boolean
language plpgsql set search_path to 'public' as $function$
declare _hash text; _cached jsonb; _on boolean;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'set_rubric_printed');
    if _cached is not null then
        return (_cached->>'on')::boolean;
    end if;

    -- The student and the work must be in the same class. Row security on
    -- both tables keeps this to the teacher's own classes.
    if not exists (
        select 1
          from enrollment e
          join assessment a on a.course_id = e.course_id
         where e.id = p_enrollment_id and a.id = p_assessment_id
    ) then
        raise exception 'enrollment % and assessment % are not in one class', p_enrollment_id, p_assessment_id
            using errcode = '22023';
    end if;

    _hash := nullif(btrim(p_hash), '');
    if char_length(_hash) > 64 then
        raise exception 'print hash must be 64 characters or fewer' using errcode = '22023';
    end if;
    _on := _hash is not null;

    if _on then
        insert into rubric_print (enrollment_id, assessment_id, printed_at, content_hash)
        values (p_enrollment_id, p_assessment_id, coalesce(p_printed_at, now()), _hash)
        on conflict (enrollment_id, assessment_id) do update
           set printed_at = excluded.printed_at, content_hash = excluded.content_hash;
    else
        delete from rubric_print
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    end if;

    perform fv_idem_store(p_idempotency_key, 'set_rubric_printed', jsonb_build_object('on', _on));
    return _on;
end;
$function$;
revoke all on function public.set_rubric_printed(uuid, uuid, text, timestamptz, uuid) from public, anon;
grant execute on function public.set_rubric_printed(uuid, uuid, text, timestamptz, uuid) to authenticated, service_role;

-- ── get_class_bundle: print_rows ─────────────────────────────────────────────
-- Patched in place from the live body; the anchor must be found once or the
-- migration stops here.
do $patch$
declare
    _def text;
    _anchor text := $s$join ck on ck.id = x.check_id), '[]'::jsonb)$s$;
    _hits int;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    if position('''print_rows''' in _def) > 0 then
        return;  -- already patched (a re-run)
    end if;
    _hits := (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
    if _hits <> 1 then
        raise exception 'get_class_bundle has % matches for the check_rows anchor, expected 1', _hits;
    end if;
    _def := replace(_def, _anchor, _anchor || $s$,
        -- [student, assessment, printed_at, hash]: a printed rubric (rubric_print)
        'print_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, p.printed_at, p.content_hash))
              from public.rubric_print p
              join enr on enr.id = p.enrollment_id
              join asm on asm.id = p.assessment_id), '[]'::jsonb)$s$);
    execute _def;
end
$patch$;
