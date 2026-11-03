/**
 * A competency or rubric criterion comment deleted offline stays deleted when
 * the level is changed before the delete is sent. The level write sends the
 * comment as null ("keep the saved one") and the outbox keeps only the newest
 * write to a cell, so it used to replace the queued '' ("clear") and the
 * server kept the comment (Nov 3 bug sweep, Database changes, group 2).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

// Production loads the outbox next to shared/data.js; so do these tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const ENR = '22222222-2222-4222-8222-222222222222';
const AID = '44444444-4444-4444-8444-444444444444';
const AID_R = '44444444-4444-4444-8444-444444444445';
const RUBRIC = '55555555-5555-4555-8555-555555555555';
const CRIT = '66666666-6666-4666-8666-666666666661';
const TAG = '77777777-7777-4777-8777-777777777777';

const entry = (aid, tagId, extra) =>
  Object.assign(
    { id: aid + tagId, assessmentId: aid, tagId, score: 2, date: '2026-10-03', type: 'summative', note: '' },
    extra,
  );

describe('a comment deleted offline, then a level change', () => {
  let fake, originalGetSupabase, originalUseSupabase;
  const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
  const sent = name => fake.committed.filter(c => c.name === name).map(c => c.params);
  async function sendAll() {
    setOnline(true);
    await window.v2Queue.flush();
    await settle();
  }

  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'rubrics', 'students'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    _serverState = {};
    saveStudents(CID, [{ id: ENR, firstName: 'Ada', lastName: 'Lovelace' }]);
    saveRubrics(CID, [{ id: RUBRIC, name: 'Lab', criteria: [{ id: CRIT, name: 'Graph', tagIds: [TAG] }] }]);
    saveAssessments(CID, [
      { id: AID, title: 'Levels', date: '2026-10-03', type: 'summative', tagIds: [TAG], rubricId: '' },
      { id: AID_R, title: 'Rubric', date: '2026-10-03', type: 'summative', tagIds: [TAG], rubricId: RUBRIC },
    ]);
    saveScores(CID, {
      [ENR]: [
        entry(AID, TAG, { critNote: 'Old note about Ada.' }),
        entry(AID_R, CRIT, { critNote: 'Wrong student.', critBeyond: 'Wrong too.' }),
      ],
    });
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    setOnline(false);
    window.v2Queue.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    setOnline(true);
    window.v2Queue.clear();
  });

  it('sends the competency comment as cleared with the new level', async () => {
    saveTagComment(CID, ENR, AID, TAG, '');
    upsertScore(CID, ENR, AID, TAG, 3, '2026-10-03', 'summative', '');
    await sendAll();

    const calls = sent('upsert_tag_score');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_tag_id: TAG, p_value: 3, p_comment: '' });
  });

  it('sends a rubric criterion comment and Went Beyond as cleared with the new level', async () => {
    saveRubricCriterionComment(CID, ENR, AID_R, CRIT, '');
    saveRubricCriterionBeyond(CID, ENR, AID_R, CRIT, '');
    upsertScore(CID, ENR, AID_R, CRIT, 4, '2026-10-03', 'summative', '');
    await sendAll();

    const calls = sent('upsert_rubric_score');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_criterion_id: CRIT, p_value: 4, p_comment: '', p_beyond: '' });
  });

  it('still lets a newer comment replace a queued one', async () => {
    saveTagComment(CID, ENR, AID, TAG, '');
    saveTagComment(CID, ENR, AID, TAG, 'Right note.');
    await sendAll();

    const calls = sent('upsert_tag_score');
    expect(calls).toHaveLength(1);
    expect(calls[0].p_comment).toBe('Right note.');
  });
});
