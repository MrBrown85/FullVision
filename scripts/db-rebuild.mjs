#!/usr/bin/env node
/*
 * Rebuilds FullVision's database structure on an EMPTY local PostgreSQL 17,
 * from the repo alone. See docs/database-rebuild.md.
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54417/fv_rebuild node scripts/db-rebuild.mjs [--check]
 *   node scripts/db-rebuild.mjs --import db-baseline.out
 *
 * The rebuild loads, in this order, each part in one transaction, and stops
 * at the first error with the statement that failed:
 *
 *   migrations/baseline/00-supabase-stubs.sql  what Supabase gives every project
 *   migrations/baseline/05-schemas.sql         the app's schemas
 *   migrations/baseline/10-types.sql           types
 *   migrations/baseline/20-sequences.sql       sequences
 *   tables, from docs/schema.generated.sql     bare columns
 *   migrations/baseline/30-functions.sql       every function and procedure, whole
 *   keys, from docs/schema.generated.sql       defaults, constraints, indexes, triggers, row security on
 *   migrations/baseline/40-views.sql           views
 *   migrations/baseline/50-table-extras.sql    policies, identity columns, the publication, outside pieces
 *   migrations/baseline/60-grants.sql          grants to the client roles
 *
 * Every file but the stubs is printed from the live catalogs by
 * scripts/db-baseline.sql. --import splits that output into those files.
 *
 * --check then proves the rebuild three ways:
 *   1. scripts/schema-snapshot.sql on the rebuilt database gives
 *      docs/schema.generated.sql, apart from KNOWN_DIFFERENCES;
 *   2. scripts/db-baseline.sql on the rebuilt database gives the same md5 for
 *      every function and procedure as migrations/baseline/function-md5.txt;
 *   3. it gives the same 60-grants.sql, and the same other parts too.
 *
 * Runs psql, as scripts/schema-snapshot.mjs does (set PSQL to use another
 * one). Refuses any host but this computer, and any database that already
 * has tables in public.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotText } from './schema-snapshot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'migrations', 'baseline');
const SNAPSHOT = join(root, 'docs', 'schema.generated.sql');
const SNAPSHOT_SQL = join(root, 'scripts', 'schema-snapshot.sql');
const BASELINE_SQL = join(root, 'scripts', 'db-baseline.sql');

/* The parts scripts/db-baseline.sql prints, and which --check compares.
   checks.txt is information only: it names this computer's own extensions
   and schemas too, so it is not compared. */
export const PARTS = [
  '05-schemas.sql',
  '10-types.sql',
  '20-sequences.sql',
  '30-functions.sql',
  'function-md5.txt',
  '40-views.sql',
  '50-table-extras.sql',
  '60-grants.sql',
  'checks.txt',
];
const COMPARED = PARTS.filter(p => p !== 'checks.txt');

/* Lines of docs/schema.generated.sql a rebuild cannot give back exactly.
   Live stores these two checks with a nested AND (they were written with
   BETWEEN). Printed and loaded again, PostgreSQL flattens it. The two allow
   the same rows. A difference is accepted only for these constraints, and
   only when the two lines are equal once every bracket is taken out. */
export const KNOWN_DIFFERENCES = ['rubric_score_modifier_check', 'tag_score_modifier_check'];

export const HEADER =
  "-- Printed by scripts/db-baseline.sql from gradebook-prod's system catalogs.\n" +
  "-- Don't edit by hand: refresh it with the Database baseline workflow (docs/database-rebuild.md).\n";

/* Only a database on this computer. */
export function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname;
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host);
  } catch {
    return false;
  }
}

/* The whole statement that holds line `line` (1-based) of `sql`: from the
   line after the previous line ending in ';' to the next one. Good enough
   to show which statement psql stopped at. */
export function statementAt(sql, line) {
  const lines = sql.split('\n');
  let start = line - 1;
  while (start > 0 && !/;\s*$/.test(lines[start - 1])) start--;
  let end = line - 1;
  while (end < lines.length - 1 && !/;\s*$/.test(lines[end])) end++;
  return lines
    .slice(start, end + 1)
    .join('\n')
    .trim();
}

/* docs/schema.generated.sql as {tables: [...], functions: [...]}. */
export function parseSnapshot(text) {
  const tables = [];
  const functions = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('--') || !line.trim()) continue;
    const t = line.match(/^table (\w+)\.(\w+)( \(rls on\))?$/);
    if (t) {
      cur = { schema: t[1], name: t[2], rls: !!t[3], cols: [], cons: [], idx: [], trg: [], pol: [] };
      tables.push(cur);
      continue;
    }
    const f = line.match(/^(function|procedure) (\w+)\.(\w+)\((.*?)\)( returns (.*?))?( security definer)?$/);
    if (f) {
      cur = null;
      functions.push({ schema: f[2], name: f[3], args: f[4], returns: f[6] ?? null, definer: !!f[7] });
      continue;
    }
    if (line.startsWith('event trigger ')) {
      cur = null;
      continue;
    }
    if (!cur) throw new Error('A snapshot line outside a table: ' + line);
    if (!line.startsWith('  ')) {
      // A policy's expression runs over several lines.
      cur.pol[cur.pol.length - 1] += '\n' + line;
      continue;
    }
    const body = line.slice(2);
    if (body.startsWith('policy ')) cur.pol.push(body);
    else if (body.startsWith('constraint ')) cur.cons.push(body);
    else if (/^CREATE (UNIQUE )?INDEX /.test(body)) cur.idx.push(body);
    else if (/^CREATE (CONSTRAINT )?TRIGGER /.test(body)) cur.trg.push(body);
    else if (cur.pol.length) cur.pol[cur.pol.length - 1] += '\n' + line;
    else cur.cols.push(parseColumn(body));
  }
  return { tables, functions };
}

/* "name type [not null] [default expr]" */
export function parseColumn(body) {
  const sp = body.indexOf(' ');
  const name = body.slice(0, sp);
  let rest = body.slice(sp + 1);
  let dflt = null;
  const d = rest.indexOf(' default ');
  if (d >= 0) {
    dflt = rest.slice(d + ' default '.length);
    rest = rest.slice(0, d);
  }
  const notNull = rest.endsWith(' not null');
  if (notNull) rest = rest.slice(0, -' not null'.length);
  return { name, type: rest, notNull, dflt };
}

/* The tables docs/schema.generated.sql lists, as two parts: `tables`, the
   bare columns, loaded before the functions so they can name row types;
   and `keys`, loaded after them: defaults, constraints (foreign keys last),
   indexes no constraint made, triggers, and row security on. Policies come
   from 50-table-extras.sql, which knows permissive from restrictive. */
export function tablesFromSnapshot(text) {
  const snap = parseSnapshot(text);
  const q = t => `${t.schema}.${t.name}`;
  const tables = [];
  const keys = [];
  for (const t of snap.tables) {
    const cols = t.cols.map(c => `  ${c.name} ${c.type}${c.notNull ? ' not null' : ''}`);
    tables.push(`create table ${q(t)} (\n${cols.join(',\n')}\n);`);
  }
  for (const t of snap.tables)
    for (const c of t.cols)
      if (c.dflt !== null) keys.push(`alter table ${q(t)} alter column ${c.name} set default ${c.dflt};`);
  for (const wantFk of [false, true]) {
    for (const t of snap.tables) {
      for (const con of t.cons) {
        const [, name, def] = con.match(/^constraint (\S+) (.*)$/s);
        if (def.startsWith('TRIGGER')) continue; // made by its CREATE CONSTRAINT TRIGGER line
        if (def.startsWith('FOREIGN KEY') === wantFk) keys.push(`alter table ${q(t)} add constraint ${name} ${def};`);
      }
    }
  }
  for (const t of snap.tables) {
    const made = new Set(t.cons.map(c => c.split(' ')[1]));
    for (const idx of t.idx) if (!made.has(idx.match(/INDEX (\S+) /)[1])) keys.push(idx + ';');
  }
  for (const t of snap.tables) for (const trg of t.trg) keys.push(trg + ';');
  for (const t of snap.tables) if (t.rls) keys.push(`alter table ${q(t)} enable row level security;`);
  const head = '-- Made by scripts/db-rebuild.mjs from docs/schema.generated.sql.\n';
  return { tables: head + tables.join('\n') + '\n', keys: head + keys.join('\n') + '\n' };
}

/* scripts/db-baseline.sql's output as {name: text}, split at its
   "-- @file NAME" lines. Each text ends with one newline. */
export function splitBaseline(out) {
  const parts = {};
  let name = null;
  let buf = [];
  const flush = () => {
    if (name) parts[name] = buf.join('\n').replace(/\s+$/, '') + '\n';
  };
  for (const line of out.split('\n')) {
    const m = line.match(/^-- @file (\S+)$/);
    if (m) {
      flush();
      name = m[1];
      buf = [];
    } else if (name) buf.push(line);
  }
  flush();
  return parts;
}

/* A committed part without its header. */
export function withoutHeader(text) {
  return text.startsWith(HEADER) ? text.slice(HEADER.length) : text;
}

/* Lines only in a, lines only in b (as multisets). */
export function lineDifferences(a, b) {
  const count = new Map();
  for (const l of a.split('\n')) count.set(l, (count.get(l) || 0) + 1);
  const onlyB = [];
  for (const l of b.split('\n')) {
    if (count.get(l)) count.set(l, count.get(l) - 1);
    else onlyB.push(l);
  }
  const onlyA = [];
  for (const [l, n] of count) for (let i = 0; i < n; i++) onlyA.push(l);
  return { onlyA, onlyB };
}

/* Takes the KNOWN_DIFFERENCES pairs out of lineDifferences' answer. */
export function withoutKnown({ onlyA, onlyB }) {
  const flat = l => l.replace(/[()]/g, '');
  const nameOf = l => (l.match(/^ {2}constraint (\S+) /) || [])[1];
  const a = [...onlyA];
  const b = [...onlyB];
  const accepted = [];
  for (let i = a.length - 1; i >= 0; i--) {
    if (!KNOWN_DIFFERENCES.includes(nameOf(a[i]))) continue;
    const j = b.findIndex(l => nameOf(l) === nameOf(a[i]) && flat(l) === flat(a[i]));
    if (j < 0) continue;
    accepted.push(nameOf(a[i]));
    a.splice(i, 1);
    b.splice(j, 1);
  }
  return { onlyA: a, onlyB: b, accepted: accepted.sort() };
}

function psql(url, args) {
  return execFileSync(process.env.PSQL || 'psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function load(url, file, label) {
  try {
    psql(url, ['-1', '-f', file]);
    console.log(`Loaded ${label}.`);
  } catch (e) {
    const err = String(e.stderr || e.message).trim();
    console.error(`${label} failed. Nothing from it was kept.\n${err}`);
    const m = err.match(/^psql:[^:]*:(\d+):/m);
    if (m) console.error('The statement:\n' + statementAt(readFileSync(file, 'utf-8'), Number(m[1])));
    process.exit(1);
  }
}

function importBaseline(file) {
  const parts = splitBaseline(readFileSync(file, 'utf-8'));
  const missing = PARTS.filter(p => !(p in parts));
  if (missing.length) {
    console.error(`${file} has no part ${missing.join(', ')}. Is it scripts/db-baseline.sql's output?`);
    process.exit(1);
  }
  for (const p of PARTS) writeFileSync(join(BASELINE, p), HEADER + parts[p]);
  console.log(`Wrote ${PARTS.length} files to migrations/baseline/.`);
}

function check(url) {
  let failed = false;
  // 1. The snapshot. The live reader's names come out schema-qualified
  // (public.course), so its search path holds no app schema. A path of
  // pg_catalog alone gives the same.
  const raw = execFileSync(
    process.env.PSQL || 'psql',
    [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'set search_path = pg_catalog', '-f', SNAPSHOT_SQL],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  const snap = withoutKnown(lineDifferences(readFileSync(SNAPSHOT, 'utf-8'), snapshotText(raw)));
  if (snap.onlyA.length || snap.onlyB.length) {
    failed = true;
    console.error('1. The rebuilt snapshot differs from docs/schema.generated.sql:');
    for (const l of snap.onlyA) console.error('  only in the snapshot: ' + l);
    for (const l of snap.onlyB) console.error('  only in the rebuild:  ' + l);
  } else {
    console.log(
      `1. The rebuilt snapshot matches docs/schema.generated.sql, apart from the known ${snap.accepted.join(' and ')}.`,
    );
  }
  // 2 and 3. scripts/db-baseline.sql on the rebuilt database.
  const parts = splitBaseline(psql(url, ['-A', '-t', '-f', BASELINE_SQL]));
  for (const p of COMPARED) {
    const committed = withoutHeader(readFileSync(join(BASELINE, p), 'utf-8'));
    if (parts[p] === committed) {
      const n = committed.trim() ? committed.trim().split('\n').length : 0;
      console.log(`${p === 'function-md5.txt' ? '2' : p === '60-grants.sql' ? '3' : '-'}. ${p} matches (${n} lines).`);
      continue;
    }
    failed = true;
    const { onlyA, onlyB } = lineDifferences(committed, parts[p] || '');
    console.error(`${p} differs:`);
    for (const l of onlyA) console.error('  only in the baseline: ' + l);
    for (const l of onlyB) console.error('  only in the rebuild:  ' + l);
  }
  if (failed) process.exit(1);
}

function main() {
  const i = process.argv.indexOf('--import');
  if (i >= 0) return importBaseline(process.argv[i + 1]);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. It names an empty database on this computer.');
    process.exit(2);
  }
  if (!isLocalUrl(url)) {
    console.error('DATABASE_URL must name a database on this computer (127.0.0.1). This never runs against Supabase.');
    process.exit(2);
  }
  const tables = psql(url, ['-A', '-t', '-c', "select count(*) from pg_tables where schemaname = 'public'"]).trim();
  if (tables !== '0') {
    console.error(`The database already has ${tables} tables in public. Start from an empty one.`);
    process.exit(2);
  }
  const made = tablesFromSnapshot(readFileSync(SNAPSHOT, 'utf-8'));
  const dir = mkdtempSync(join(tmpdir(), 'fv-rebuild-'));
  writeFileSync(join(dir, 'tables.sql'), made.tables);
  writeFileSync(join(dir, 'keys.sql'), made.keys);
  const b = f => [join(BASELINE, f), `migrations/baseline/${f}`];
  const steps = [
    b('00-supabase-stubs.sql'),
    b('05-schemas.sql'),
    b('10-types.sql'),
    b('20-sequences.sql'),
    [join(dir, 'tables.sql'), 'the tables from docs/schema.generated.sql'],
    b('30-functions.sql'),
    [join(dir, 'keys.sql'), 'the keys, indexes and triggers from docs/schema.generated.sql'],
    b('40-views.sql'),
    b('50-table-extras.sql'),
    b('60-grants.sql'),
  ];
  for (const [file, label] of steps) load(url, file, label);
  if (process.argv.includes('--check')) check(url);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
