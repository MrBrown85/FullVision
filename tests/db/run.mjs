#!/usr/bin/env node
/*
 * The security rule tests: on a database rebuilt from the repo, one teacher
 * can neither read nor change another teacher's rows, and a visitor who is
 * not signed in can do nothing. See docs/database-rebuild.md.
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db
 *
 * DATABASE_URL names any database on a PostgreSQL 17 server on this
 * computer. The run makes a fresh database beside it, rebuilds the
 * structure there with scripts/db-rebuild.mjs --check, seeds two teachers
 * (tests/db/seed.sql), runs every test, and drops the database again
 * (KEEP_DB=1 keeps it). It refuses any host but this computer.
 *
 * What it tests, all read from the catalogs at run time:
 *   1. Tables. Every table in public, student_submit and fv_private has an
 *      owner in tests/db/table-owners.mjs. As teacher A: no read returns a
 *      row of B's; no update or delete reaches one; no insert that names
 *      B's class, student, assessment or other row gets in. As a visitor:
 *      nothing is read or written.
 *   2. Functions. A visitor may run none. A teacher may run nothing in
 *      student_submit. Each function a teacher may run is called with B's
 *      ids (tests/db/function-args.mjs): B's rows must not change and none
 *      of B's data may come back. Each call is also made with A's own ids,
 *      to show what the function does when it is allowed.
 *   3. The student page's functions (student_submit) run only for
 *      service_role, the edge functions' key.
 *   4. Links. Every column a same_teacher trigger guards is pointed at a
 *      record of teacher B from one of A's rows; each try must be refused
 *      (tests/db/same-teacher.sql).
 *   5. Schemas. Neither a visitor nor a teacher may create a table or a
 *      function in public, student_submit or fv_private.
 *
 * Runs psql (set PSQL to use another one), as scripts/db-rebuild.mjs does.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalUrl } from '../../scripts/db-rebuild.mjs';
import { OWNERS, NO_TEACHER } from './table-owners.mjs';
import { KIND_BY_ARG, KIND_BY_FUNCTION, ASSESSMENT_BY_FUNCTION, VALUES, INERT } from './function-args.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const APP_SCHEMAS = ['public', 'student_submit', 'fv_private'];
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const MARK = { a: 'Alpha', b: 'Bravo' };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const tmp = mkdtempSync(join(tmpdir(), 'fv-rls-'));

const claims = (uid, mark) =>
  JSON.stringify({ sub: uid, role: 'authenticated', email: `${mark.toLowerCase()}@example.test` });
const AS = {
  a: { role: 'authenticated', claims: claims(A, MARK.a) },
  anon: { role: 'anon', claims: JSON.stringify({ role: 'anon' }) },
};
const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const qname = name =>
  name
    .split('.')
    .map(p => `"${p}"`)
    .join('.');

/* ---------- talking to the database ---------- */

let url = null;
let step = 0;
function psql(target, sql) {
  const file = join(tmp, `q${++step}.sql`);
  writeFileSync(file, sql);
  try {
    return execFileSync(
      process.env.PSQL || 'psql',
      [target, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', file],
      { encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    throw new Error(`psql failed on ${file}:\n${String(e.stderr || e.message).trim()}`);
  }
}
/* Runs sql whose last statement gives one jsonb, and answers it parsed. */
function json(sql) {
  const out = psql(url, sql.replace(/;\s*$/, '') + ';\n')
    .trim()
    .split('\n');
  return JSON.parse(out[out.length - 1]);
}
/* Runs cases through rls_test.attempt in batches. */
function attempt(cases) {
  const out = [];
  for (let i = 0; i < cases.length; i += 150) {
    const batch = cases.slice(i, i + 150);
    out.push(...json(`select rls_test.attempt(${lit(JSON.stringify(batch))}::jsonb, '${A}', '${B}')::text`));
  }
  return out;
}

/* ---------- the same-teacher rule ---------- */

/* Every column a same_teacher trigger guards refuses a record of another
   teacher (tests/db/same-teacher.sql). */
function testSameTeacherLinks() {
  psql(url, readFileSync(join(here, 'same-teacher.sql'), 'utf-8'));
  const tries = json(`select rls_test.same_teacher_links('${A}', '${B}')::text`);
  const count = outcome => tries.filter(r => r.outcome === outcome).length;
  for (const r of tries) {
    if (r.outcome === 'ALLOWED')
      fail('links', `${r.tbl}.${r.col} took a record of another teacher. The same-teacher rule must refuse it.`);
    if (r.outcome === 'no seed row')
      fail('links', `${r.tbl}.${r.col} was not tried: ${r.detail}. Add a row to tests/db/seed.sql.`);
  }
  if (!tries.length) fail('links', 'no same_teacher trigger was found, so nothing was tried');
  say(`Links: ${tries.length} columns that name a second record, each pointed at a record of teacher B.`);
  say(`  Refused by the same-teacher rule: ${count('refused by the rule')}.`);
  say(`  Refused by another check that fires first: ${count('refused by another check')}.`);
  return tries;
}

/* ---------- nothing new in the app's schemas ---------- */

/* Neither a visitor nor a teacher may create an object in the app's
   schemas. The catalog is asked, and then each role really tries. */
function testNoCreate() {
  const schemas = ['public', 'student_submit', 'fv_private'];
  const roles = ['anon', 'authenticated'];
  const held = json(
    `select coalesce(jsonb_agg(jsonb_build_object('role', r, 'schema', s)), '[]'::jsonb)::text
       from unnest(array[${roles.map(lit).join(', ')}]) r, unnest(array[${schemas.map(lit).join(', ')}]) s
      where has_schema_privilege(r, s, 'CREATE')`,
  );
  for (const h of held)
    fail('schemas', `${h.role} holds CREATE on schema ${h.schema}. Revoke it: nothing in the app creates objects.`);
  const kinds = {
    table: s => `create table ${s}.rls_probe (x int)`,
    function: s => `create function ${s}.rls_probe() returns int language sql as 'select 1'`,
  };
  let tried = 0;
  for (const role of roles)
    for (const schema of schemas)
      for (const [kind, make] of Object.entries(kinds)) {
        tried++;
        let refusal = null;
        try {
          psql(url, `begin;\nset local role ${role};\n${make(schema)};\nrollback;\n`);
        } catch (e) {
          refusal = String(e.message);
        }
        if (refusal === null) fail('schemas', `${role} created a ${kind} in schema ${schema}.`);
        else if (!/permission denied for schema/.test(refusal))
          fail(
            'schemas',
            `${role} creating a ${kind} in ${schema} failed for another reason: ${refusal.split('\n').pop()}`,
          );
      }
  say(`Schemas: ${tried} tries by a visitor and a teacher to create a table or a function in ${schemas.join(', ')}.`);
  say(
    `  Refused for want of permission on the schema: ${tried - failures.filter(f => f.startsWith('schemas: ') && / created a | failed for another /.test(f)).length}.`,
  );
  return { held, tried };
}

/* ---------- the run ---------- */

const failures = [];
const fail = (area, what) => failures.push(`${area}: ${what}`);
const summary = [];
const say = line => {
  console.log(line);
  summary.push(line);
};

function setUp() {
  const admin = process.env.DATABASE_URL;
  if (!admin) {
    console.error('DATABASE_URL is not set. It names a database on a local PostgreSQL 17 server.');
    process.exit(2);
  }
  if (!isLocalUrl(admin)) {
    console.error('DATABASE_URL must name a database on this computer (127.0.0.1). This never runs against Supabase.');
    process.exit(2);
  }
  const name = `fv_rls_${process.pid}_${Date.now().toString(36)}`;
  psql(admin, `create database ${name};`);
  const u = new URL(admin);
  u.pathname = '/' + name;
  url = u.toString();
  const drop = () => {
    if (process.env.KEEP_DB === '1') return console.log(`Kept the database ${name}.`);
    try {
      psql(admin, `drop database if exists ${name} with (force);`);
    } catch (e) {
      console.error(`Could not drop ${name}: ${e.message}`);
    }
  };
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'db-rebuild.mjs'), '--check'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });
  } catch {
    drop();
    console.error('The rebuild failed, so the tests did not run.');
    process.exit(1);
  }
  return drop;
}

/* The tables and views in the app's schemas, with their columns. */
function catalogTables() {
  return json(`
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', n.nspname || '.' || c.relname, 'kind', c.relkind, 'rls', c.relrowsecurity,
             'cols', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                                                         'skip', a.attidentity = 'a' or a.attgenerated <> '')
                                       order by a.attnum)
                        from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
             'pk', (select jsonb_agg(a.attname) from pg_index i join pg_attribute a
                      on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                     where i.indrelid = c.oid and i.indisprimary))
           order by 1), '[]')::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in (${APP_SCHEMAS.map(lit).join(', ')})
       and c.relkind in ('r', 'p', 'v', 'm', 'f')`);
}

/* rls_test.prints(teacher): one md5 per owned table, of that teacher's rows. */
function makePrints(tables) {
  const parts = tables
    .filter(t => OWNERS[t.name])
    .map(
      t =>
        `jsonb_build_object(${lit(t.name)}, (select md5(coalesce(string_agg(md5(t::text), ',' order by md5(t::text)), ''))` +
        ` from ${qname(t.name)} t where (${OWNERS[t.name]}) = p))`,
    );
  psql(
    url,
    `create function rls_test.prints(p uuid) returns jsonb language sql stable as $$ select ${parts.join('\n || ')} $$;`,
  );
  const marked = tables
    .filter(t => OWNERS[t.name])
    .map(
      t =>
        `select ${lit(t.name)} where exists (select 1 from ${qname(t.name)} t where (${OWNERS[t.name]}) = p and t::text like ${lit('%' + MARK.b + '%')})`,
    );
  psql(
    url,
    `create function rls_test.marked(p uuid) returns jsonb language sql stable as $$ select coalesce(jsonb_agg(n), '[]') from (${marked.join('\n union all ')}) x(n) $$;`,
  );
}

/* Each owned table's rows for A and for B: ctid, md5, and the row as jsonb. */
function rowsByTeacher(tables) {
  const parts = tables.map(t => {
    const own = OWNERS[t.name] ? `(${OWNERS[t.name]})` : 'null::uuid';
    const pick = who =>
      `(select coalesce(jsonb_agg(jsonb_build_object('ctid', t.ctid::text, 'md5', md5(t::text), 'row', to_jsonb(t))), '[]')` +
      ` from ${qname(t.name)} t where ${who})`;
    return `jsonb_build_object(${lit(t.name)}, jsonb_build_object('a', ${pick(`${own} = '${A}'`)}, 'b', ${pick(`${own} = '${B}'`)}, 'all', ${pick('true')}))`;
  });
  const out = {};
  for (let i = 0; i < parts.length; i += 40)
    Object.assign(out, json(`select (${parts.slice(i, i + 40).join(' || ')})::text`));
  return out;
}

/* ---------- 1. tables ---------- */

function freshKey(t, row) {
  const r = { ...row };
  for (const c of t.cols) {
    if (c.name !== 'id' && !(t.pk || []).includes(c.name)) continue;
    if (c.type === 'uuid' && c.name === 'id') r.id = crypto.randomUUID();
    if (c.type === 'bigint' && c.name === 'id') r.id = 900000000 + Math.floor(Math.random() * 1e6);
  }
  return r;
}
function insertSql(t, row) {
  const cols = t.cols.filter(c => !c.skip).map(c => `"${c.name}"`);
  const body = JSON.stringify(row).replace(/\$rls\$/g, '');
  return `insert into ${qname(t.name)} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_record(null::${qname(t.name)}, $rls$${body}$rls$::jsonb)`;
}
const ctids = rows => `'{${rows.map(r => `"${r.ctid}"`).join(',')}}'::tid[]`;

function tableCases(t, rows) {
  const cases = [];
  const first = `"${t.cols[0].name}"`;
  const add = (who, kind, sql, mode, extra = {}) =>
    cases.push({ id: `${t.name}|${who}|${kind}`, ...AS[who], sql, mode, t: t.name, kind, ...extra });
  const { a, b, all } = rows;
  const read = `select coalesce(string_agg(md5(t::text), ','), '') from ${qname(t.name)} t`;
  add('a', 'read', read, 'value');
  add('anon', 'read', read, 'value');
  if (t.kind !== 'r' && t.kind !== 'p') return cases;
  const targets = OWNERS[t.name] ? b : all;
  if (targets.length) {
    add(
      'a',
      'update',
      `update ${qname(t.name)} t set ${first} = t.${first} where ctid = any (${ctids(targets)})`,
      'rows',
    );
    add('a', 'delete', `delete from ${qname(t.name)} t where ctid = any (${ctids(targets)})`, 'rows');
  }
  if (all.length) {
    add(
      'anon',
      'update',
      `update ${qname(t.name)} t set ${first} = t.${first} where ctid = any (${ctids(all)})`,
      'rows',
    );
    add('anon', 'delete', `delete from ${qname(t.name)} t where ctid = any (${ctids(all)})`, 'rows');
    add('anon', 'insert', insertSql(t, freshKey(t, all[0].row)), 'rows');
  }
  if (!OWNERS[t.name]) {
    if (all.length) add('a', 'insert', insertSql(t, freshKey(t, all[0].row)), 'rows');
    return cases;
  }
  // A copy of one of B's rows under a new key: it names B's class,
  // student, assessment or other parent row.
  if (b.length) add('a', 'insert copy of B', insertSql(t, freshKey(t, b[0].row)), 'rows');
  return cases;
}

function testTables(tables, rows) {
  const known = new Set([...Object.keys(OWNERS), ...Object.keys(NO_TEACHER)]);
  const names = new Set(tables.map(t => t.name));
  for (const t of tables) if (!known.has(t.name)) fail('tables', `${t.name} has no owner in tests/db/table-owners.mjs`);
  for (const n of known)
    if (!names.has(n)) fail('tables', `tests/db/table-owners.mjs names ${n}, which is not in the database`);
  for (const t of tables) {
    if (!t.rls && (t.kind === 'r' || t.kind === 'p')) fail('tables', `${t.name} has row security off`);
    const r = rows[t.name];
    if (OWNERS[t.name] && (!r.a.length || !r.b.length))
      fail('tables', `the seed gives ${t.name} no row for ${r.a.length ? 'B' : 'A'}`);
    if (NO_TEACHER[t.name] && !r.all.length) fail('tables', `the seed gives ${t.name} no row`);
  }
  const cases = tables.filter(t => known.has(t.name)).flatMap(t => tableCases(t, rows[t.name]));
  const results = attempt(cases);
  const byId = Object.fromEntries(results.map(r => [r.id, r]));
  const notProven = [];
  let ownSeen = 0;
  for (const c of cases) {
    const r = byId[c.id];
    const where = `${c.t}, ${c.kind} as ${c.role === 'anon' ? 'a visitor' : 'teacher A'}`;
    if (r.b_changed.length) fail('tables', `${where} changed B's rows in ${r.b_changed.join(', ')}`);
    if (r.a_took_b.length) fail('tables', `${where} put B's words into A's rows in ${r.a_took_b.join(', ')}`);
    if (c.role === 'anon' && r.a_changed.length)
      fail('tables', `${where} changed A's rows in ${r.a_changed.join(', ')}`);
    if (c.kind === 'read') {
      const seen = new Set((r.value || '').split(',').filter(Boolean));
      const rs = rows[c.t];
      if (c.role === 'anon' && seen.size) fail('tables', `${where} read ${seen.size} rows`);
      if (c.role === 'authenticated') {
        if (OWNERS[c.t] && rs.b.some(x => seen.has(x.md5))) fail('tables', `${where} read B's rows`);
        if (NO_TEACHER[c.t]?.read === 'none' && seen.size) fail('tables', `${where} read ${seen.size} rows`);
        if (OWNERS[c.t] && rs.a.some(x => seen.has(x.md5))) ownSeen++;
      }
      continue;
    }
    if (r.state === null && r.rows > 0) {
      fail('tables', `${where} reached ${r.rows} row(s)`);
      continue;
    }
    if (c.kind.startsWith('insert') && r.state !== '42501')
      notProven.push(`${where}: ${r.state ? `stopped by ${r.state} ${r.message}` : 'nothing was refused'}`);
  }
  const tested = tables.filter(t => known.has(t.name));
  say(
    `Tables: ${tested.length} tested (${Object.keys(OWNERS).length} with an owner, ${Object.keys(NO_TEACHER).length} with no one teacher), ${cases.length} attempts.`,
  );
  say(`  Teacher A read their own rows in ${ownSeen} of them and B's rows in none.`);
  for (const [n, x] of Object.entries(NO_TEACHER)) say(`  No one teacher: ${n}. ${x.reason}`);
  if (notProven.length) {
    say(`  ${notProven.length} inserts were stopped by something other than the security rules:`);
    for (const l of notProven) say('    ' + l);
  }
  return { tables: tested.length, attempts: cases.length, notProven };
}

/* ---------- 2. functions ---------- */

function catalogFunctions() {
  return json(`
    select coalesce(jsonb_agg(jsonb_build_object(
             'schema', n.nspname, 'name', p.proname,
             'sig', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             'returns', pg_get_function_result(p.oid), 'kind', p.prokind,
             'args', (select coalesce(jsonb_agg(jsonb_build_object('name', a.n, 'type', format_type(a.t, null),
                                                               'dflt', a.i > p.pronargs - p.pronargdefaults)
                                              order by a.i), '[]')
                        from unnest(p.proargtypes::oid[], p.proargnames[1:p.pronargs]) with ordinality a(t, n, i)),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'auth', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'))
           order by 3), '[]')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in (${APP_SCHEMAS.map(lit).join(', ')})`);
}

const DEFAULT_BY_TYPE = {
  text: "'rls test'",
  integer: '1',
  smallint: '1::smallint',
  bigint: '1::bigint',
  numeric: '1',
  boolean: 'true',
  date: 'current_date + 7',
  'timestamp with time zone': 'now()',
  jsonb: "'{}'::jsonb",
  'text[]': "'{}'::text[]",
  'bigint[]': "'{}'::bigint[]",
};

/* The kinds a function's arguments name, and how to build each argument. */
function planCall(f) {
  const values = VALUES[f.name] || {};
  const parts = [];
  const kinds = new Set();
  const unknown = [];
  for (const a of f.args) {
    let kind = KIND_BY_ARG[a.name];
    if (['p_id', 'p_ids', 'p_src_id'].includes(a.name)) kind = KIND_BY_FUNCTION[f.name];
    if (kind === 'assessment' && ASSESSMENT_BY_FUNCTION[f.name]) kind = ASSESSMENT_BY_FUNCTION[f.name];
    if (a.name in values) {
      const v = values[a.name];
      const text = typeof v === 'string' ? v : `${lit(JSON.stringify(v))}::jsonb`;
      for (const m of text.matchAll(/\$\{(\w+)\}/g)) kinds.add(m[1]);
      parts.push({ name: a.name, text });
    } else if (kind && a.type === 'uuid') {
      kinds.add(kind);
      parts.push({ name: a.name, text: `'\${${kind}}'::uuid` });
    } else if (kind && a.type === 'uuid[]') {
      kinds.add(kind);
      parts.push({ name: a.name, text: `array['\${${kind}}']::uuid[]` });
    } else if (a.name === 'p_idempotency_key') {
      parts.push({ name: a.name, text: 'gen_random_uuid()' });
    } else if (!a.dflt) {
      if (a.type === 'uuid' || a.type === 'uuid[]') unknown.push(a.name);
      parts.push({ name: a.name, text: DEFAULT_BY_TYPE[a.type] ?? `null::${a.type}` });
    }
  }
  return { parts, kinds: [...kinds].sort(), unknown };
}

function callSql(f, plan, ids) {
  const args = plan.parts
    .map(
      p =>
        `"${p.name}" => ${p.text.replace(/\$\{(\w+)\}/g, (_, k) => (ids[k] === undefined ? '00000000-0000-0000-0000-000000000000' : ids[k]))}`,
    )
    .join(', ');
  return `select string_agg(coalesce(r::text, ''), E'\\n') from "${f.schema}"."${f.name}"(${args}) as r`;
}

const OWNERSHIP =
  /not found|not owned|row-level security|permission denied|not (both )?in (that|this|the) class|is not in the class|not one of this|not on this/i;

/* What came back that belongs to `who` and was not in the call's own arguments. */
function leaked(text, sql, who, uuids) {
  if (!text) return false;
  if (text.includes(MARK[who])) return true;
  const passed = new Set(sql.match(UUID) || []);
  return (text.match(UUID) || []).some(u => uuids[who].has(u) && !passed.has(u));
}

function testFunctions(fns, ids, uuids) {
  const anonCan = fns.filter(f => f.anon);
  for (const f of anonCan) fail('functions', `a visitor may run ${f.sig}`);
  const studentSide = fns.filter(f => f.schema === 'student_submit');
  for (const f of studentSide.filter(f => f.auth)) fail('student page', `a signed-in teacher may run ${f.sig}`);
  const callable = fns.filter(f => f.auth && f.schema !== 'student_submit');
  const triggers = callable.filter(f => /^(trigger|event_trigger)$/.test(f.returns));
  const toCall = callable.filter(f => !triggers.includes(f));

  const cases = [];
  const plans = {};
  for (const f of toCall) {
    const plan = (plans[f.sig] = planCall(f));
    cases.push({ id: `${f.sig}|control`, ...AS.a, sql: callSql(f, plan, ids.a), mode: 'value' });
    cases.push({ id: `${f.sig}|anon`, ...AS.anon, sql: callSql(f, plan, ids.a), mode: 'value' });
    if (!plan.kinds.length) continue;
    cases.push({
      id: `${f.sig}|B's ${plan.kinds.join(', ')}`,
      ...AS.a,
      sql: callSql(f, plan, ids.b),
      mode: 'value',
      attack: true,
    });
  }
  const results = attempt(cases);
  const byId = Object.fromEntries(results.map(r => [r.id, r]));

  const verdicts = { refused: [], refusedOther: [], noEffect: [], inert: [], noId: [], notProven: [] };
  for (const f of toCall) {
    const plan = plans[f.sig];
    const control = byId[`${f.sig}|control`];
    const anon = byId[`${f.sig}|anon`];
    if (anon.state !== '42501')
      fail('functions', `a visitor ran ${f.sig}${anon.state ? ` (${anon.state} ${anon.message})` : ''}`);
    for (const c of cases.filter(c => c.id.startsWith(f.sig + '|'))) {
      const r = byId[c.id];
      if (r.b_changed.length)
        fail('functions', `${c.id.replace('|', ' with ')} as teacher A changed B's rows in ${r.b_changed.join(', ')}`);
      if (r.a_took_b.length)
        fail('functions', `${c.id.replace('|', ' with ')} as teacher A copied B's words into ${r.a_took_b.join(', ')}`);
      if (c.role === 'authenticated' && (leaked(r.value, c.sql, 'b', uuids) || (r.message || '').includes(MARK.b)))
        fail('functions', `${c.id.replace('|', ' with ')} as teacher A gave back B's data`);
    }
    if (!plan.kinds.length) {
      verdicts.noId.push(f.sig);
      continue;
    }
    // With A's own ids the call changed A's rows, gave back A's data, or
    // gave a different answer: so the same call with B's ids was able to act.
    const r = byId[`${f.sig}|B's ${plan.kinds.join(', ')}`];
    const controlActed =
      control.state === null &&
      (control.a_changed.length > 0 || leaked(control.value, '', 'a', uuids) || control.value !== r.value);
    const sameAsControl = r.state === control.state && r.message === control.message;
    let verdict = null;
    if (INERT[f.name]) {
      const empty = v => !v || /^\(,*\)$/.test(v);
      if (control.state === null && empty(control.value) && empty(r.value) && !control.a_changed.length)
        verdict = 'inert';
      else
        verdict = `listed as doing nothing, but the call with A's own ids ${control.state ? `failed (${control.state})` : 'acted'}`;
    } else if (
      r.state !== null &&
      !sameAsControl &&
      (r.state === 'P0002' || r.state === '42501' || OWNERSHIP.test(r.message))
    )
      verdict = 'refused';
    else if (r.state !== null && control.state === null) verdict = 'refusedOther';
    else if (r.state === null && controlActed) verdict = 'noEffect';
    else if (r.state === null)
      verdict = `ran and did nothing, and so did the call with A's own ids${control.state ? ` (${control.state} ${control.message})` : ''}`;
    else if (sameAsControl) verdict = `the call with A's own ids failed the same way (${r.state} ${r.message})`;
    else
      verdict = `both calls failed, differently: with B's ids ${r.state} ${r.message}; with A's ${control.state} ${control.message}`;
    if (verdicts[verdict]) verdicts[verdict].push(f.sig);
    else verdicts.notProven.push({ sig: f.sig, why: verdict, unknown: plan.unknown });
  }

  say(
    `Functions: ${fns.length} in the app's schemas; a signed-in teacher may run ${callable.length}, a visitor ${anonCan.length}.`,
  );
  say(
    `  Called as teacher A: ${toCall.length} functions, ${cases.length} calls (with A's own ids, with B's, and as a visitor).`,
  );
  say(
    `  Not called: ${triggers.length} trigger function(s), which run only as triggers: ${triggers.map(f => f.sig).join(', ') || 'none'}.`,
  );
  say(`  Take no id, ran as A, B's rows unchanged and nothing of B's back: ${verdicts.noId.length}.`);
  const proven = verdicts.refused.length + verdicts.refusedOther.length + verdicts.noEffect.length;
  say(`  Do nothing whatever they are given (function-args.mjs, INERT; checked): ${verdicts.inert.length}.`);
  say(`  Take an id: ${proven + verdicts.notProven.length}. Proven: ${proven}.`);
  say(
    `    Refused with B's ids by the ownership check ("not found", "permission denied"): ${verdicts.refused.length}.`,
  );
  say(
    `    Refused with B's ids for another reason, where the same call with A's own ids ran: ${verdicts.refusedOther.length}.`,
  );
  say(
    `    Ran with B's ids but changed and gave back nothing of B's, where A's own ids made it act: ${verdicts.noEffect.length}.`,
  );
  say(`    Not proven (B's rows still unchanged and nothing of B's back): ${verdicts.notProven.length}.`);
  for (const v of verdicts.notProven)
    say(`      ${v.sig}${v.unknown.length ? ` (no kind for ${v.unknown.join(', ')})` : ''}: ${v.why}`);
  return { callable: callable.length, called: toCall.length, calls: cases.length, triggers: triggers.length, verdicts };
}

/* ---------- 3. the student page's door ---------- */

function testStudentDoor(fns, ids) {
  const side = fns.filter(f => f.schema === 'student_submit');
  const schemas = json(`
    select jsonb_build_object(
      'auth', has_schema_privilege('authenticated', 'student_submit', 'usage'),
      'anon', has_schema_privilege('anon', 'student_submit', 'usage'),
      'service', has_schema_privilege('service_role', 'student_submit', 'usage'),
      'old', (select coalesce(jsonb_agg(nspname), '[]') from pg_namespace where nspname in ('fv_backup', 'fv_legacy')))::text`);
  if (schemas.auth) fail('student page', 'a signed-in teacher may use the schema student_submit');
  if (schemas.anon) fail('student page', 'a visitor may use the schema student_submit');
  if (!schemas.service) fail('student page', 'service_role may not use the schema student_submit');
  for (const f of side.filter(f => f.anon)) fail('student page', `a visitor may run ${f.sig}`);
  // fv_backup and fv_legacy are not rebuilt; the grants copied from live must not name them.
  const grants = readFileSync(join(root, 'migrations', 'baseline', '60-grants.sql'), 'utf-8');
  for (const s of ['fv_backup', 'fv_legacy']) {
    if (new RegExp(`\\b${s}\\.|schema ${s}\\b`).test(grants))
      fail('old schemas', `60-grants.sql grants something on ${s}`);
    if (schemas.old.includes(s)) fail('old schemas', `${s} is in the rebuild; the tests do not cover it`);
  }
  const cases = [];
  for (const f of side) {
    const plan = planCall(f);
    for (const who of ['a', 'anon'])
      cases.push({ id: `${f.sig}|${who}`, ...AS[who], sql: callSql(f, plan, ids.a), mode: 'value' });
  }
  const results = attempt(cases);
  for (const r of results)
    if (r.state !== '42501')
      fail(
        'student page',
        `${r.id.replace('|a', ' as teacher A').replace('|anon', ' as a visitor')} was not refused (${r.state || 'it ran'})`,
      );
  const entry = side.filter(f => f.service).length;
  say(
    `Student page: ${side.length} functions in student_submit. Teacher A and a visitor were refused all ${side.length}; service_role may run the ${entry} entry points.`,
  );
  return { functions: side.length, entry };
}

/* ---------- main ---------- */

function main() {
  const started = Date.now();
  const drop = setUp();
  let ok = false;
  try {
    psql(url, readFileSync(join(here, 'helpers.sql'), 'utf-8'));
    psql(url, readFileSync(join(here, 'seed.sql'), 'utf-8'));
    const seeded = json(
      `select rls_test.seed_shared(); select jsonb_build_object('a', rls_test.seed('${A}', 'alpha@example.test', '${MARK.a}'), 'b', rls_test.seed('${B}', 'bravo@example.test', '${MARK.b}'))::text`,
    );
    say(`Seeded teachers A and B through the app's own functions on the rebuilt database.`);
    const tables = catalogTables();
    makePrints(tables);
    const rows = rowsByTeacher(tables);
    const uuids = {
      a: new Set(tables.flatMap(t => rows[t.name].a).flatMap(r => JSON.stringify(r.row).match(UUID) || [])),
      b: new Set(tables.flatMap(t => rows[t.name].b).flatMap(r => JSON.stringify(r.row).match(UUID) || [])),
    };
    const fns = catalogFunctions();
    const t = testTables(tables, rows);
    const f = testFunctions(fns, seeded, uuids);
    const s = testStudentDoor(fns, seeded);
    const l = testSameTeacherLinks();
    const c = testNoCreate();
    if (process.env.RLS_REPORT)
      writeFileSync(
        process.env.RLS_REPORT,
        JSON.stringify({ tables: t, functions: f, student: s, links: l, schemas: c, failures }, null, 2),
      );
    ok = failures.length === 0;
  } finally {
    drop();
  }
  say(`Took ${Math.round((Date.now() - started) / 1000)} s.`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '## Security rule tests\n\n```\n' + [...summary, ...failures].join('\n') + '\n```\n',
    );
  if (!ok) {
    console.error(`\n${failures.length} failure(s):`);
    for (const l of failures) console.error('  ' + l);
    process.exit(1);
  }
  console.log('Every security rule test passed.');
}

main();
