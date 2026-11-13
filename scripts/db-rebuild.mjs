#!/usr/bin/env node
/*
 * Rebuilds FullVision's database structure on an EMPTY local PostgreSQL 17.
 * See docs/database-rebuild.md.
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54417/fv_rebuild node scripts/db-rebuild.mjs [--from-snapshot] [--check]
 *
 * Loads every file in migrations/baseline/ in name order, each in one
 * transaction, and stops at the first error with the statement that
 * failed. 00-supabase-stubs.sql comes first: the roles and schemas Supabase
 * gives every project.
 *
 *   --from-snapshot  after the stubs, load a SHELL made from
 *                    docs/schema.generated.sql instead of the other files:
 *                    every table, column, constraint, index, trigger and
 *                    policy it lists, and every function it lists with a
 *                    body that only raises an error. The snapshot has no
 *                    function bodies, so the shell cannot run the app. It
 *                    proves the stubs and the snapshot load together.
 *   --check          then run scripts/schema-snapshot.sql against the
 *                    rebuilt database and compare its answer with
 *                    docs/schema.generated.sql, line by line.
 *
 * Runs psql, as scripts/schema-snapshot.mjs does (set PSQL to use another
 * one). Refuses any host but this computer, and any database that already
 * has tables in public.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotText } from './schema-snapshot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'migrations', 'baseline');
const SNAPSHOT = join(root, 'docs', 'schema.generated.sql');
const SNAPSHOT_SQL = join(root, 'scripts', 'schema-snapshot.sql');
const STUBS = '00-supabase-stubs.sql';

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
    const f = line.match(/^function (\w+)\.(\w+)\((.*)\) returns (.*?)( security definer)?$/);
    if (f) {
      cur = null;
      functions.push({ schema: f[1], name: f[2], args: f[3], returns: f[4], definer: !!f[5] });
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

/* The types a function's signature names that the snapshot does not make:
   schema-qualified names that are not tables. */
export function missingTypes({ tables, functions }) {
  const made = new Set(tables.map(t => t.schema + '.' + t.name));
  const named = new Set();
  for (const f of functions) {
    for (const m of (f.args + ' ' + f.returns).matchAll(/\b(public|student_submit)\.(\w+)/g)) {
      if (!made.has(m[0])) named.add(m[0]);
    }
  }
  return [...named].sort();
}

/* The shell: SQL that makes every object the snapshot lists. */
export function shellFromSnapshot(text) {
  const snap = parseSnapshot(text);
  const out = [];
  const w = s => out.push(s);
  const q = t => `${t.schema}.${t.name}`;
  w('-- A shell made by scripts/db-rebuild.mjs --from-snapshot from docs/schema.generated.sql.');
  w('-- Every function body only raises an error: the snapshot has no bodies.\n');
  const schemas = [...new Set([...snap.tables, ...snap.functions].map(o => o.schema))].filter(s => s !== 'public');
  for (const s of schemas) w(`create schema ${s};`);
  for (const ty of missingTypes(snap)) {
    w(`-- ${ty} is named by a function but not listed in the snapshot: made empty.`);
    w(`create type ${ty} as ();`);
  }
  // Tables first with bare columns, so functions can name their row types.
  for (const t of snap.tables) {
    const cols = t.cols.map(c => `  ${c.name} ${c.type}${c.notNull ? ' not null' : ''}`);
    w(`create table ${q(t)} (\n${cols.join(',\n')}\n);`);
  }
  for (const f of snap.functions) {
    w(
      `create function ${f.schema}.${f.name}(${f.args}) returns ${f.returns}` +
        `${f.definer ? ' security definer' : ''} language plpgsql as $shell$ ` +
        `begin raise exception 'shell: ${f.schema}.${f.name} has no body'; end $shell$;`,
    );
  }
  for (const t of snap.tables)
    for (const c of t.cols) if (c.dflt !== null) w(`alter table ${q(t)} alter column ${c.name} set default ${c.dflt};`);
  for (const wantFk of [false, true]) {
    for (const t of snap.tables) {
      for (const con of t.cons) {
        const [, name, def] = con.match(/^constraint (\S+) (.*)$/s);
        if (def.startsWith('TRIGGER')) continue; // made by its CREATE CONSTRAINT TRIGGER line
        if (def.startsWith('FOREIGN KEY') === wantFk) w(`alter table ${q(t)} add constraint ${name} ${def};`);
      }
    }
  }
  for (const t of snap.tables) {
    const made = new Set(t.cons.map(c => c.split(' ')[1]));
    for (const idx of t.idx) if (!made.has(idx.match(/INDEX (\S+) /)[1])) w(idx + ';');
  }
  for (const t of snap.tables) for (const trg of t.trg) w(trg + ';');
  for (const t of snap.tables) {
    if (t.rls) w(`alter table ${q(t)} enable row level security;`);
    for (const pol of t.pol) {
      const [, name, rest] = pol.match(/^policy (\S+) (.*)$/s);
      w(`create policy ${name} on ${q(t)} ${rest};`);
    }
  }
  return out.join('\n') + '\n';
}

/* Lines only in a, lines only in b (as sorted multisets). */
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

function psql(url, args) {
  return execFileSync(process.env.PSQL || 'psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
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

function main() {
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
  const fromSnapshot = process.argv.includes('--from-snapshot');
  const files = readdirSync(BASELINE)
    .filter(f => f.endsWith('.sql'))
    .sort();
  if (!files.includes(STUBS)) throw new Error(`migrations/baseline/${STUBS} is missing.`);
  load(url, join(BASELINE, STUBS), `migrations/baseline/${STUBS}`);
  if (fromSnapshot) {
    const shell = join(mkdtempSync(join(tmpdir(), 'fv-shell-')), 'shell.sql');
    writeFileSync(shell, shellFromSnapshot(readFileSync(SNAPSHOT, 'utf-8')));
    load(url, shell, `the shell from docs/schema.generated.sql (${shell})`);
  } else {
    const rest = files.filter(f => f !== STUBS);
    if (!rest.length) {
      console.error('migrations/baseline/ has only the stubs: no schema dump yet. See docs/database-rebuild.md.');
      process.exit(1);
    }
    for (const f of rest) load(url, join(BASELINE, f), `migrations/baseline/${f}`);
  }
  if (!process.argv.includes('--check')) return;
  // The live reader's names come out schema-qualified (public.course), so
  // its search path holds no app schema. An empty path gives the same.
  const raw = execFileSync(
    process.env.PSQL || 'psql',
    [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'set search_path = pg_catalog', '-f', SNAPSHOT_SQL],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  const rebuilt = snapshotText(raw);
  const committed = readFileSync(SNAPSHOT, 'utf-8');
  if (rebuilt === committed) {
    console.log('The rebuilt database gives docs/schema.generated.sql byte for byte.');
    return;
  }
  const { onlyA, onlyB } = lineDifferences(committed, rebuilt);
  console.error(`The rebuilt database differs from docs/schema.generated.sql.`);
  for (const l of onlyA) console.error('  only in the snapshot: ' + l);
  for (const l of onlyB) console.error('  only in the rebuild:  ' + l);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
