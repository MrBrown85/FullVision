-- The same-teacher rule (migrations/2026111301_same_teacher_links.sql), tried
-- on every column it guards.
--
-- For each same_teacher trigger and each id its rows name (after the row's
-- parent): take one of teacher A's rows, point that one column at a record
-- of teacher B, and note what the database says. It runs as the owner, so
-- row security is skipped and only a trigger or a constraint can refuse.
-- Each try is undone at once.
--
-- The list of guarded columns is read from the triggers themselves. A
-- trigger that goes missing is caught elsewhere: docs/schema.generated.sql
-- lists every trigger and CI compares it with the live database.
create function rls_test.same_teacher_links(p_a uuid, p_b uuid) returns jsonb
language plpgsql
as $$
declare
    t       record;
    pcol    text;
    pkind   text;
    i       int;
    col     text;
    kind    text;
    base    text;
    home    text;
    is_list boolean;
    bval    text;
    arow    tid;
    out     jsonb := '[]';
    result  text;
    detail  text;
begin
    for t in
        select n.nspname || '.' || c.relname as tbl,
               string_to_array(regexp_replace(encode(g.tgargs, 'escape'), '\\000$', ''), E'\\000') as args
          from pg_trigger g
          join pg_class c on c.oid = g.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
         where g.tgname = 'same_teacher' and not g.tgisinternal
         order by 1
    loop
        pcol := split_part(t.args[1], ':', 1);
        pkind := split_part(t.args[1], ':', 2);
        execute format('select ctid from %s where fv_private.teacher_of(%L, %I) = $1 limit 1', t.tbl, pkind, pcol)
           into arow using p_a;
        for i in 2 .. array_length(t.args, 1) loop
            col := split_part(t.args[i], ':', 1);
            kind := split_part(t.args[i], ':', 2);
            is_list := kind like '%[]';
            base := replace(kind, '[]', '');
            bval := null;
            if base in ('assessment_copy_group', 'rubric_copy_group') then
                -- A copy group another teacher's work already uses.
                execute format('select %I::text from %s where fv_private.teacher_of(%L, %I) = $1 and %I is not null limit 1',
                               col, t.tbl, pkind, pcol, col) into bval using p_b;
            elsif base = 'teacher' then
                bval := p_b::text;
            else
                -- One of B's records of this kind, from the table that holds them.
                home := 'public.' || case base when 'access_code' then 'student_access_code' else base end;
                execute format('select id::text from %s where fv_private.teacher_of(%L, id) = $1 limit 1', home, base)
                   into bval using p_b;
            end if;
            if arow is null or bval is null then
                out := out || jsonb_build_object('tbl', t.tbl, 'col', col, 'outcome', 'no seed row',
                    'detail', case when arow is null then 'teacher A has no row in the table' else 'teacher B has no ' || base end);
                continue;
            end if;
            begin
                if is_list then
                    execute format('update %s set %I = array[$1::uuid] where ctid = $2', t.tbl, col) using bval, arow;
                else
                    execute format('update %s set %I = $1::uuid where ctid = $2', t.tbl, col) using bval, arow;
                end if;
                raise exception 'rls_test: the update went through' using errcode = 'P0001';
            exception
                when insufficient_privilege then
                    result := 'refused by the rule';
                    detail := sqlerrm;
                when others then
                    if sqlerrm = 'rls_test: the update went through' then
                        result := 'ALLOWED';
                        detail := '';
                    else
                        result := 'refused by another check';
                        detail := sqlstate || ' ' || left(sqlerrm, 120);
                    end if;
            end;
            out := out || jsonb_build_object('tbl', t.tbl, 'col', col, 'outcome', result, 'detail', detail);
        end loop;
    end loop;
    return out;
end;
$$;
