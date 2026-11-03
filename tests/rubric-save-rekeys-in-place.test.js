/**
 * Signed in, saveRubrics gives a new rubric and its criteria their server
 * ids in place, in the very objects it was handed, before it resolves (the
 * outbox lands the create and _rekey rewrites the cached rows). The
 * assessment form keeps its own copy of the ids it sent
 * (_persistPendingFormRubric), and e2e/helpers.js serverRekeysRubrics
 * stands in for this in Demo Mode.
 */
import './setup.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-1111-1111-111111111111';
const RUBRIC_ID = '44444444-4444-4444-8444-444444444444';
const CRIT1 = '55555555-5555-4555-8555-555555555555';
const CRIT2 = '66666666-6666-4666-8666-666666666666';

// upsert_rubric returns the new id; table reads return the saved rows.
function makeClient() {
  var tables = {
    rubric: [{ id: RUBRIC_ID, course_id: CID, name: 'Copy', created_at: '2026-11-02T12:00:00Z' }],
    criterion: [CRIT1, CRIT2].map(function (id, i) {
      return {
        id: id,
        rubric_id: RUBRIC_ID,
        name: i ? 'B' : 'A',
        level_4_value: 4,
        level_3_value: 3,
        level_2_value: 2,
        level_1_value: 1,
        weight: 1,
        display_order: i,
      };
    }),
  };
  function query(table) {
    var filters = [];
    return {
      select() {
        return this;
      },
      eq(column, value) {
        filters.push(row => row[column] === value);
        return this;
      },
      in(column, values) {
        filters.push(row => values.includes(row[column]));
        return this;
      },
      then(res, rej) {
        var rows = (tables[table] || []).filter(row => filters.every(f => f(row)));
        return Promise.resolve({ data: structuredClone(rows), error: null }).then(res, rej);
      },
    };
  }
  return {
    rpc(name) {
      return Promise.resolve({ data: name === 'upsert_rubric' ? RUBRIC_ID : null, error: null });
    },
    from: query,
  };
}

var originalGetSupabase;
var originalUseSupabase;
beforeEach(() => {
  originalGetSupabase = getSupabase;
  originalUseSupabase = _useSupabase;
  localStorage.clear();
  delete _cache.rubrics[CID];
  _rubricSaveQueue = {};
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  window.v2Queue.clear();
  _useSupabase = true;
  globalThis.getSupabase = () => makeClient();
});
afterEach(() => {
  globalThis.getSupabase = originalGetSupabase;
  _useSupabase = originalUseSupabase;
  window.v2Queue.clear();
});

it('gives a new rubric and its criteria their server ids in place before it resolves', async () => {
  var held = {
    id: 'c-form-copy',
    name: 'Copy',
    criteria: [
      { id: 'c-form-crit-1', name: 'A', tagIds: [], levels: {}, weight: 1 },
      { id: 'c-form-crit-2', name: 'B', tagIds: [], levels: {}, weight: 1 },
    ],
  };
  var done = null;
  saveRubrics(CID, [held]).then(r => (done = r));
  for (var i = 0; i < 20 && !done; i++) await settle(100);

  expect(done).not.toBeNull();
  expect(held.id).toBe(RUBRIC_ID);
  expect(held.criteria.map(c => c.id)).toEqual([CRIT1, CRIT2]);
});
