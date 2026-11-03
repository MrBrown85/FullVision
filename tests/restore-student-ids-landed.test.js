/**
 * A class restore's student_ids are applied where the restore lands: in the
 * outbox's own event (shared/data.js _onOutboxEvent), not in the .then of
 * the tab that started it. After a reload, in another tab, or for a restore
 * made offline, no .then is waiting, and a matched student must still take
 * the record the server kept (DECISIONS "Class backups" 3), here and in the
 * writes still queued.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = 'c5000000-0000-4000-8000-000000000001';
const ENR = 'c5000000-0000-4000-8000-000000000021';
const FRESH_ADA = 'c5000000-0000-4000-8000-000000000031'; // made by this device
const FRESH_ALAN = 'c5000000-0000-4000-8000-000000000032';
const S1 = 'c5000000-0000-4000-8000-000000000011'; // Ada's existing record

describe('a restore that lands with no .then waiting', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    _serverState = {};
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.v2Queue.clear();
    _outbox();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.v2Queue.clear();
  });

  it('re-points the cached students and the queued writes when it lands', async () => {
    // As a reload finds it: the class on the device and the restore in the outbox.
    _cache.students[CID] = [
      { id: ENR, personId: FRESH_ADA, firstName: 'Ada', lastName: 'Lovelace' },
      { id: 'c5000000-0000-4000-8000-000000000022', personId: FRESH_ALAN, firstName: 'Alan', lastName: 'Turing' },
    ];
    localStorage.setItem('gb-students-' + CID, JSON.stringify(_cache.students[CID]));
    window.v2Queue.enqueue('import_json_restore', {
      p_payload: {
        courses: [{ id: CID }],
        students: [
          { id: FRESH_ADA, match_id: S1 },
          { id: FRESH_ALAN, match_id: null },
        ],
      },
    });
    // A pronoun edit made then, still waiting to go.
    window.v2Queue.enqueue(
      'update_student',
      { p_id: FRESH_ADA, p_patch: { pronouns: 'she/her' } },
      { blockedOn: ['sWAITING'] },
    );
    fake.on('import_json_restore', () => ({
      data: { student_ids: { [FRESH_ADA]: S1, [FRESH_ALAN]: FRESH_ALAN } },
      error: null,
    }));

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.flush();
    await settle();

    expect(fake.count('import_json_restore')).toBe(1);
    expect(getStudents(CID).map(s => s.personId)).toEqual([S1, FRESH_ALAN]);
    expect(JSON.parse(localStorage.getItem('gb-students-' + CID))[0].personId).toBe(S1);
    var queued = JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries;
    expect(queued.map(e => [e.endpoint, e.payload.p_id])).toEqual([['update_student', S1]]);
  });
});
