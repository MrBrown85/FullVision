-- A slip's token never reaches the database (2026-11-24).
--
-- 2026112401 did this for a card's session. A questionnaire or phone-report
-- slip still sent its token to the database in the clear on every verify,
-- check and submit, and the database made each new one in open: someone
-- watching the database live could catch a token and answer that student's
-- questionnaire or read their phone report until it ran out.
--
-- Now the student-submit function hashes the slip token (SHA-256, hex)
-- before any statement, and makes a new slip token itself. The database
-- compares hashes and keeps only the hash it is given. session.token_hash
-- already holds SHA-256 of the token, so a slip opened before this keeps
-- working once the function is out.
--
-- 1. verify, check and submit compare p_token, the hash, as sent.
-- 2. open gains p_new_token_hash, the hash of the token the function made,
--    stored when a slip session starts; it answers new_token (true) in
--    place of token. The four-argument version is dropped.
--
-- Each is edited in place from its live definition: every edit must match
-- exactly as often as listed, or nothing is applied. No data changes.
-- Between this and the function's deploy, a slip cannot open and an open
-- slip session finds no match. Undo: restore the four old definitions from
-- migrations/baseline/30-functions.sql (drop the five-argument open first)
-- and redeploy the previous function.

begin;

do $$
declare
    -- [function, text to find, times it must appear, replacement]
    _edits text[][] := array[
        array['student_submit."check"(text,text,text)',
              $s$token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')$s$, '1',
              $s$token_hash = p_token$s$],
        array['student_submit.verify(text,text,text,text,text,text,text)',
              $s$token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')$s$, '1',
              $s$token_hash = p_token$s$],
        array['student_submit.submit(text,jsonb,text)',
              $s$token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')$s$, '1',
              $s$token_hash = p_token$s$],
        array['student_submit.open(text,text,text,text)',
              $s$p_ip_hash text)
 RETURNS jsonb$s$, '1',
              $s$p_ip_hash text, p_new_token_hash text)
 RETURNS jsonb$s$],
        array['student_submit.open(text,text,text,text)',
              $s$    _token  text;
$s$, '1', ''],
        array['student_submit.open(text,text,text,text)',
              $s$        raise exception 'malformed key id' using errcode = '22023';
    end if;
$s$, '1',
              $s$        raise exception 'malformed key id' using errcode = '22023';
    end if;
    -- The hash of a token the function made: the database never sees the token.
    if coalesce(p_new_token_hash, '') !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed token hash' using errcode = '22023';
    end if;
$s$],
        array['student_submit.open(text,text,text,text)',
              $s$_token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');$s$, '2',
              $s$-- The token is the function's; the database keeps only its hash.$s$],
        array['student_submit.open(text,text,text,text)',
              $s$encode(sha256(convert_to(_token, 'UTF8')), 'hex')$s$, '2',
              $s$p_new_token_hash$s$],
        array['student_submit.open(text,text,text,text)',
              $s$'token', _token,$s$, '2',
              $s$'new_token', true,$s$]];
    _fns text[] := array['student_submit."check"(text,text,text)', 'student_submit.verify(text,text,text,text,text,text,text)',
                         'student_submit.submit(text,jsonb,text)', 'student_submit.open(text,text,text,text)'];
    _f    text;
    _def  text;
    _hits int;
begin
    foreach _f in array _fns loop
        _def := pg_get_functiondef(_f::regprocedure);
        for i in 1 .. array_length(_edits, 1) loop
            continue when _edits[i][1] <> _f;
            _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
            if _hits <> _edits[i][3]::int then
                raise exception '%: found % of "%", expected %', _f, _hits, left(_edits[i][2], 60), _edits[i][3];
            end if;
            _def := replace(_def, _edits[i][2], _edits[i][4]);
        end loop;
        if _def ~ 'sha256\(convert_to\((p_token|_token)' then
            raise exception '%: a token is still hashed in the database', _f;
        end if;
        if _f = 'student_submit.open(text,text,text,text)' then
            -- A new argument: the old open goes, the new one takes its place.
            drop function student_submit.open(text, text, text, text);
        end if;
        execute _def;
    end loop;
end $$;

-- As the four-argument open had it: the owner, the service role and
-- student-submit's own login (2026112402). The other three keep theirs.
revoke all on function student_submit.open(text, text, text, text, text) from public, anon, authenticated;
grant execute on function student_submit.open(text, text, text, text, text) to service_role;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'fv_student_submit') then
        grant execute on function student_submit.open(text, text, text, text, text) to fv_student_submit;
    end if;
end $$;

commit;
