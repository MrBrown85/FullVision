-- Undo for migrations/2026111002_security_definer_search_path.sql (S0-M5).
-- NOT a migration: it lives under local-test/ so the drift check does not
-- treat it as something to apply. Run it only to take S0-M5 back out.
--
-- What it does: puts the search_path of each of the sixteen SECURITY DEFINER
-- functions back to what it was before S0-M5 (public; nothing for
-- get_class_bundle; pg_catalog for rls_auto_enable). No body is replaced, no
-- row changes and no sync version moves. Every function returns what it
-- returned either way, so old and new clients keep working.
--
-- What it reopens: without pg_temp named last, a caller's temporary table is
-- looked at first again (S0-M5's header, "What was wrong"). Nobody can reach
-- that through the app.
--
-- Guards: each function must exist, be SECURITY DEFINER, and have either
-- S0-M5's search_path (then it is put back) or the earlier one (then it is
-- left as it is). The four whose fingerprints are on file
-- (live-function-md5.txt: fv_owns_assessment, fv_owns_course,
-- fv_owns_enrollment, and get_class_bundle as S0-M4 leaves it) must be the
-- S0-M5 definition or the earlier one, by fingerprint, and must come out as
-- the earlier one. Anything else stops the file with nothing changed. One
-- transaction, five-second lock timeout, can be run again.
--
-- Order: S0-M4's undo (s0-m4-undo.sql) checks get_class_bundle's
-- fingerprint, which S0-M5 changed, so it stops while S0-M5 is applied. Run
-- this file first, then S0-M4's. After this file S0-M5 can be applied again.
--
-- Run by search_path.py on PostgreSQL 17.11 and 18.6 (2026-11-10): all
-- sixteen rows of pg_proc back to what they were, column for column, the
-- sixteen fingerprints included; a second run and a run with S0-M5 never
-- applied changed nothing; S0-M4's undo stopped before this file and ran
-- after it; S0-M5 applied again after it.
begin;
set local lock_timeout = '5s';
do $guard$
declare _f record; _p record;
begin
    for _f in select * from (values
        ('public._fv_release_orphan_teacher_email()',                'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public._fv_teacher_sign_in_deleted()',                     'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public._score_audit_diff(uuid,numeric,numeric,text,text)', 'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public._term_rating_audit_field(uuid,text,text,text)',     'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public._touch_course_sync_cursor(uuid,text)',              'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public._touch_course_sync_cursor_from_trigger()',          'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public._touch_teacher_sync_cursor_from_trigger()',         'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public.fv_idem_check(uuid,text)',                          'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public.fv_idem_store(uuid,text,jsonb)',                    'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public.fv_owns_assessment(uuid)',                          'search_path=public, pg_temp',     'search_path=public',     '9f4c680c35f9f3ac32e8290824707673', '852322ca22024d49dcc4f88a6863a4cf'),
        ('public.fv_owns_course(uuid)',                              'search_path=public, pg_temp',     'search_path=public',     'e3afeca06043a6e907e6f4ae777c85da', '61fa41c6c4e94a1e27b606e454262baf'),
        ('public.fv_owns_enrollment(uuid)',                          'search_path=public, pg_temp',     'search_path=public',     '728526648388367393162be706f7f9ea', '9c1d01d07ad0e2402784a2257e13aecb'),
        ('public.fv_owns_term_rating(uuid)',                         'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public.fv_retention_cleanup()',                            'search_path=public, pg_temp',     'search_path=public',     null, null),
        ('public.get_class_bundle(uuid,bigint)',                     'search_path=pg_catalog, pg_temp', 'search_path=""',         '116294a41f043458e3ddec694520cf0d', '845b42513d1f556dc941a1cc11cf9567'),
        ('public.rls_auto_enable()',                                 'search_path=pg_catalog, pg_temp', 'search_path=pg_catalog', null, null)
        ) as v(fn, applied, original, applied_md5, original_md5)
    loop
        select p.prosecdef, p.proconfig, md5(pg_get_functiondef(p.oid)) as md5 into _p from pg_proc p where p.oid = to_regprocedure(_f.fn);
        if not found then raise exception '% does not exist with these arguments. Nothing was changed.', _f.fn; end if;
        if not _p.prosecdef then raise exception '% is not SECURITY DEFINER. Nothing was changed.', _f.fn; end if;
        if _p.proconfig is distinct from array[_f.applied] and _p.proconfig is distinct from array[_f.original] then
            raise exception '% has the settings % (expected % or %). Nothing was changed.', _f.fn, coalesce(_p.proconfig::text, 'none'), _f.applied, _f.original;
        end if;
        if _f.applied_md5 is not null and _p.md5 not in (_f.applied_md5, _f.original_md5) then
            raise exception '% is neither the S0-M5 definition nor the one before it (md5 %). Nothing was changed.', _f.fn, _p.md5;
        end if;
    end loop;
end $guard$;

alter function public._fv_release_orphan_teacher_email()                    set search_path = public;
alter function public._fv_teacher_sign_in_deleted()                         set search_path = public;
alter function public._score_audit_diff(uuid, numeric, numeric, text, text) set search_path = public;
alter function public._term_rating_audit_field(uuid, text, text, text)      set search_path = public;
alter function public._touch_course_sync_cursor(uuid, text)                 set search_path = public;
alter function public._touch_course_sync_cursor_from_trigger()              set search_path = public;
alter function public._touch_teacher_sync_cursor_from_trigger()             set search_path = public;
alter function public.fv_idem_check(uuid, text)                             set search_path = public;
alter function public.fv_idem_store(uuid, text, jsonb)                      set search_path = public;
alter function public.fv_owns_assessment(uuid)                              set search_path = public;
alter function public.fv_owns_course(uuid)                                  set search_path = public;
alter function public.fv_owns_enrollment(uuid)                              set search_path = public;
alter function public.fv_owns_term_rating(uuid)                             set search_path = public;
alter function public.fv_retention_cleanup()                                set search_path = public;
alter function public.get_class_bundle(uuid, bigint)                        set search_path = '';
alter function public.rls_auto_enable()                                     set search_path = pg_catalog;

do $check$
declare _f record; _md5 text;
begin
    for _f in select * from (values
        ('public.fv_owns_assessment(uuid)',      '852322ca22024d49dcc4f88a6863a4cf'),
        ('public.fv_owns_course(uuid)',          '61fa41c6c4e94a1e27b606e454262baf'),
        ('public.fv_owns_enrollment(uuid)',      '9c1d01d07ad0e2402784a2257e13aecb'),
        ('public.get_class_bundle(uuid,bigint)', '845b42513d1f556dc941a1cc11cf9567')) as v(fn, original_md5)
    loop
        _md5 := md5(pg_get_functiondef(_f.fn::regprocedure));
        if _md5 <> _f.original_md5 then
            raise exception '% does not undo to the definition before S0-M5 (md5 %, expected %). Nothing was changed.', _f.fn, _md5, _f.original_md5;
        end if;
    end loop;
end $check$;
commit;
