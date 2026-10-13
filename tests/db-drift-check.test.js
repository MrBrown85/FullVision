/**
 * scripts/check-db-drift.mjs — the comparison logic. CI runs the script
 * itself against the live database when the FV_SCHEMA_READER_URL secret is
 * set; these tests cover what it extracts and how it decides.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  APPLIED_WITHOUT_RECORD,
  CLIENT_SOURCES,
  extractRpcNames,
  findDrift,
  isApplied,
  migrationName,
} from '../scripts/check-db-drift.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('extractRpcNames', () => {
  it('finds every call form, including a name on the next line', () => {
    const src = [
      "_writeRpc('upsert_score', { p_value: 3 });",
      "_rpcOrNoop('delete_subject', { p_id: id });",
      "_callRpcWithAuthGuard('save_term_rating', payload);",
      "sb.rpc('get_gradebook', { p_course_id: cid });",
      "var createPromise = _writeRpc(\n  'create_course',\n  params,\n);",
      "ops.push({ rpc: 'upsert_tag_score', params: p });",
      "ops.push('not_an_rpc');",
    ].join('\n');
    expect([...extractRpcNames(src)].sort()).toEqual([
      'create_course',
      'delete_subject',
      'get_gradebook',
      'save_term_rating',
      'upsert_score',
      'upsert_tag_score',
    ]);
  });

  it('finds the RPCs the app actually calls', () => {
    const names = new Set();
    for (const entry of CLIENT_SOURCES) {
      const full = join(root, entry);
      const files = entry.endsWith('.js')
        ? [full]
        : readdirSync(full)
            .filter(f => f.endsWith('.js'))
            .map(f => join(full, f));
      files.forEach(f => extractRpcNames(readFileSync(f, 'utf-8')).forEach(n => names.add(n)));
    }
    for (const known of [
      'create_course',
      'delete_custom_tag',
      'delete_course',
      'bootstrap_teacher',
      'get_gradebook',
      'upsert_tag_score',
      'upsert_rubric_score',
    ]) {
      expect(names.has(known)).toBe(true);
    }
  });
});

describe('migration matching', () => {
  it('strips the date prefix', () => {
    expect(migrationName('20260501_add_delete_custom_tag.sql')).toBe('add_delete_custom_tag');
  });

  it('accepts the exact name or the fullvision_v2_ prefixed one', () => {
    expect(isApplied('20260501_add_delete_custom_tag.sql', ['add_delete_custom_tag'])).toBe(true);
    expect(isApplied('20260423_color_format_validation.sql', ['fullvision_v2_color_format_validation'])).toBe(true);
    expect(isApplied('20260501_add_delete_custom_tag.sql', ['add_delete_custom_tag_v2'])).toBe(false);
  });

  it('allowlists only migrations that exist in the repo', () => {
    const files = readdirSync(join(root, 'migrations'));
    expect(Object.keys(APPLIED_WITHOUT_RECORD).filter(f => !files.includes(f))).toEqual([]);
  });
});

describe('findDrift', () => {
  it('reports RPCs missing from the database and migrations never applied', () => {
    const drift = findDrift({
      calledRpcs: new Set(['upsert_score', 'delete_custom_tag']),
      liveFunctions: ['upsert_score'],
      migrationFiles: ['20260501_add_delete_custom_tag.sql', '20261012_course_soft_delete.sql'],
      liveMigrations: ['course_soft_delete', 'enable_realtime_course_data'],
    });
    expect(drift.missingRpcs).toEqual(['delete_custom_tag']);
    expect(drift.unapplied).toEqual(['20260501_add_delete_custom_tag.sql']);
    expect(drift.unrecorded).toEqual(['enable_realtime_course_data']);
  });

  it('passes when everything matches', () => {
    const drift = findDrift({
      calledRpcs: new Set(['upsert_score']),
      liveFunctions: ['upsert_score', 'get_gradebook'],
      migrationFiles: ['20261012_course_soft_delete.sql', '20260429_get_gradebook_full_hydration.sql'],
      liveMigrations: ['course_soft_delete'],
    });
    expect(drift.missingRpcs).toEqual([]);
    expect(drift.unapplied).toEqual([]);
  });
});
