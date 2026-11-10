-- Undo for migrations/2026111001_assessment_created_at_in_bundle.sql (S0-M4).
-- NOT a migration: it lives under local-test/ so the drift check does not
-- treat it as something to apply. Run it only to take S0-M4 back out.
--
-- What it does: takes the one added `created_at` line back out of
-- get_class_bundle and get_gradebook, so each is again the definition that
-- was live before S0-M4. It changes no row and no sync version. Old and new
-- clients both keep working either way: a client ignores a missing
-- created_at (shared/data.js treats it as not known).
--
-- Guards: each function must be either the patched definition (then it is
-- undone, and the result must be the original, by fingerprint) or already
-- the original (then it is left alone). Anything else stops the file with
-- nothing changed. One transaction, five-second lock timeout, can be run
-- again.
--
-- Order: if S0-M5 (search_path) has been applied since, it changed
-- get_class_bundle's fingerprint and this guard will stop: undo S0-M5 first.
--
-- Written and run by the independent reviewer of PR 985 on PostgreSQL 17.11
-- and 18.6 (2026-11-10): both originals restored, owner and grants
-- unchanged, a second run changed nothing, and S0-M4 applied again after it.
begin;
set local lock_timeout = '5s';
do $undo$
declare _f record; _def text;
begin
    for _f in select * from (values
        ('public.get_class_bundle(uuid,bigint)', '845b42513d1f556dc941a1cc11cf9567', '119165287207814181c5875d81451147',
         E',\n                       ''created_at'', asm.created_at', ''),
        ('public.get_gradebook(uuid)', 'beec0fae104cd7f4a0e96364130f267d', '2876cd40c373b8a59bff4464008c8601',
         E'\n               ''created_at'', a.created_at,', '')) as v(fn, patched, original, added, nothing)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        continue when md5(_def) = _f.original;
        if md5(_def) <> _f.patched then raise exception '% is neither the patched nor the original definition. Nothing was changed.', _f.fn; end if;
        _def := replace(_def, _f.added, _f.nothing);
        if md5(_def) <> _f.original then raise exception '% does not undo to the original. Nothing was changed.', _f.fn; end if;
        execute _def;
    end loop;
end $undo$;
commit;
