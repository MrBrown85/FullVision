#!/usr/bin/env node
/* Fails when the repo and the live database disagree in a way that loses
 * teachers' work:
 *
 *   - the client calls an RPC the database doesn't have, so every call to it
 *     fails (custom-tag deletes failed this way for five months), or
 *   - a file in migrations/ was never applied (class delete stayed a hard
 *     delete while the UI promised 30 days).
 *
 * Usage: DATABASE_URL=postgresql://… node scripts/check-db-drift.mjs
 *
 * DATABASE_URL should log in as the read-only fv_schema_reader role (see
 * migrations/20261012_ci_schema_reader_role.sql). Needs psql on PATH. Live
 * migrations with no file in the repo are listed as a warning only. */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const CLIENT_SOURCES = ['shared', 'teacher', 'teacher-mobile', 'login-auth.js'];

// Applied before migrations were tracked (through the SQL editor), so
// schema_migrations has no row for them. Their effects were checked live on
// 2026-10-12.
export const APPLIED_WITHOUT_RECORD = {
  '20260429_get_gradebook_full_hydration.sql': 'get_gradebook since replaced by get_gradebook_include_modules',
  '20260429_restore_list_course_student_profiles.sql': 'list_course_student_profiles exists',
  '20260429_restore_live_profile_and_sync_read_paths.sql':
    'list_course_student_profiles and the course_sync_cursor triggers exist',
};

/* RPC names a source file calls: _writeRpc('x', …), _rpcOrNoop('x', …),
   _callRpcWithAuthGuard('x', …) and sb.rpc('x', …), quote on the same line
   or the next, plus op objects sent later ({ rpc: 'x', params }). */
export function extractRpcNames(source) {
  const names = new Set();
  const re = /(?:(?:\b_writeRpc|\b_rpcOrNoop|\b_callRpcWithAuthGuard|\.rpc)\(\s*|\brpc:\s*)'([a-z][a-z0-9_]*)'/g;
  let m;
  while ((m = re.exec(source))) names.add(m[1]);
  return names;
}

/* 20260501_add_delete_custom_tag.sql → add_delete_custom_tag */
export function migrationName(file) {
  return file.replace(/^\d{8,14}_/, '').replace(/\.sql$/, '');
}

/* A file counts as applied when a live migration has its name, or ends in
   _<name> (early migrations were applied with a fullvision_v2_ prefix). */
export function isApplied(file, liveNames) {
  const name = migrationName(file);
  return liveNames.some(live => live === name || live.endsWith('_' + name));
}

export function findDrift({ calledRpcs, liveFunctions, migrationFiles, liveMigrations }) {
  const functions = new Set(liveFunctions);
  const missingRpcs = [...calledRpcs].filter(name => !functions.has(name)).sort();
  const unapplied = migrationFiles.filter(file => !APPLIED_WITHOUT_RECORD[file] && !isApplied(file, liveMigrations));
  const unrecorded = liveMigrations.filter(
    live => !migrationFiles.some(file => live === migrationName(file) || live.endsWith('_' + migrationName(file))),
  );
  return { missingRpcs, unapplied, unrecorded };
}

function sourceFiles(entry) {
  const full = join(root, entry);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full)
    .filter(f => f.endsWith('.js'))
    .map(f => join(full, f));
}

function query(url, sql) {
  const out = execFileSync('psql', [url, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf-8',
  });
  return out.split('\n').filter(Boolean);
}

function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  const calledRpcs = new Set();
  CLIENT_SOURCES.flatMap(sourceFiles).forEach(file => {
    extractRpcNames(readFileSync(file, 'utf-8')).forEach(name => calledRpcs.add(name));
  });
  const migrationFiles = readdirSync(join(root, 'migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort();
  const liveFunctions = query(
    url,
    "select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
  );
  const liveMigrations = query(url, 'select name from supabase_migrations.schema_migrations order by version');

  const { missingRpcs, unapplied, unrecorded } = findDrift({
    calledRpcs,
    liveFunctions,
    migrationFiles,
    liveMigrations,
  });

  console.log(
    'Checked ' + calledRpcs.size + ' RPCs the client calls and ' + migrationFiles.length + ' migration files.',
  );
  if (unrecorded.length) {
    console.log('Note: ' + unrecorded.length + ' live migrations have no file in migrations/ (not an error).');
  }
  if (missingRpcs.length) {
    console.error('\nThe client calls RPCs the database does not have:\n  ' + missingRpcs.join('\n  '));
  }
  if (unapplied.length) {
    console.error('\nMigration files that were never applied:\n  ' + unapplied.join('\n  '));
  }
  if (missingRpcs.length || unapplied.length) process.exit(1);
  console.log('No drift.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
