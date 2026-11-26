-- Read-only fingerprints, before the apply of migrations/2026112602_score_rows_carry_their_class.sql (S0-M6).
-- SELECTs only. One row per table the file touches: an md5 of its columns, constraints, indexes, triggers
-- (and whether each is on), policies, owner and row security, with "public." taken out so the search path
-- does not matter and every list ordered by C collation so the server's collation does not; and the md5 of
-- get_assessment_detail, the one reader whose reply the file changes. Run on the database the file was
-- tested on and on live: the rows must be the same. score_rows_class.py (scenario fingerprints) writes the
-- tested values into the list below; then no rows back means live matches.
with want(what, md5) as (values
    -- FINGERPRINTS-BEGIN tables
    ('function public.get_assessment_detail(uuid)', '55d1f49f14d78a713eebadfd20417afa'),
    ('table public.assessment', '3e295e1c6f0be70a223710d9bc808235'),
    ('table public.course', '50e6b0e12c990b9696872597d23df60b'),
    ('table public.criterion', '99b10d7caa7e0147f4b314b15201cd6e'),
    ('table public.criterion_check', '133c27c9fb256230057a7afca6cd3976'),
    ('table public.dibels_score', '62c6db8a8d680649c6943407b45ce2f2'),
    ('table public.enrollment', 'a8052a3e5c9b331ef174ebe805cbb60a'),
    ('table public.rubric', '36226b89e056dd22ed02fde34741b1dc'),
    ('table public.rubric_check_score', '59c4887c071cc1b8776a711239a70bb5'),
    ('table public.rubric_score', '5204c643554132fe4f3fb04e783c5478'),
    ('table public.score', '62b6d2256b90e272731b652d1e55ce7c'),
    ('table public.section', '6b756e4a06f786d62c26f333b54af777'),
    ('table public.tag', 'feb83199a15cb6aa4cd6f64305b81294'),
    ('table public.tag_score', 'c0af8853b560312e670c0875483d0f85')
    -- FINGERPRINTS-END
),
tabs(t) as (values ('score'), ('tag_score'), ('rubric_score'), ('rubric_check_score'), ('dibels_score'),
                   ('enrollment'), ('assessment'), ('section'), ('tag'), ('rubric'), ('criterion'), ('criterion_check'), ('course')),
parts(t, line) as (
    select tabs.t, 'column ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' '
                   || coalesce(replace(pg_get_expr(d.adbin, d.adrelid), 'public.', ''), '')
      from tabs join pg_attribute a on a.attrelid = ('public.' || tabs.t)::regclass and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    union all
    -- A check is compared without its brackets: live stores two of them with a nested AND that a rebuild
    -- flattens (scripts/db-rebuild.mjs, KNOWN_DIFFERENCES); the two allow the same rows.
    select tabs.t, 'constraint ' || c.conname || ' '
                   || case when c.contype = 'c' then translate(pg_get_constraintdef(c.oid), '()', '')
                           else replace(pg_get_constraintdef(c.oid), 'public.', '') end
      from tabs join pg_constraint c on c.conrelid = ('public.' || tabs.t)::regclass
    union all
    select tabs.t, 'index ' || replace(pg_get_indexdef(i.indexrelid), 'public.', '')
      from tabs join pg_index i on i.indrelid = ('public.' || tabs.t)::regclass
    union all
    select tabs.t, 'trigger ' || replace(pg_get_triggerdef(g.oid), 'public.', '') || ' ' || g.tgenabled::text
      from tabs join pg_trigger g on g.tgrelid = ('public.' || tabs.t)::regclass and not g.tgisinternal
    union all
    select tabs.t, 'policy ' || p.polname || ' ' || p.polcmd::text || ' ' || p.polpermissive::text || ' '
                   || coalesce(replace(pg_get_expr(p.polqual, p.polrelid), 'public.', ''), '') || ' '
                   || coalesce(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '')
      from tabs join pg_policy p on p.polrelid = ('public.' || tabs.t)::regclass
    union all
    select tabs.t, 'table ' || c.relowner::regrole::text || ' ' || c.relrowsecurity::text || ' ' || c.relforcerowsecurity::text
      from tabs join pg_class c on c.oid = ('public.' || tabs.t)::regclass
),
have(what, md5) as (
    select 'table public.' || t, md5(string_agg(line, E'\n' order by line collate "C")) from parts group by t
    union all
    select 'function public.get_assessment_detail(uuid)', md5(pg_get_functiondef('public.get_assessment_detail(uuid)'::regprocedure))
)
select coalesce(h.what, w.what) as what, h.md5 as live, w.md5 as tested
  from have h full join want w on w.what = h.what
 where h.md5 is distinct from w.md5
 order by coalesce(h.what, w.what) collate "C";
