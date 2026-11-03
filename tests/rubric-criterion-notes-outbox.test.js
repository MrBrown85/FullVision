/**
 * A single-point rubric criterion has two notes, Work On (rubric_score.comment)
 * and Went Beyond (rubric_score.beyond). The outbox keeps only the newest
 * write to one criterion, so each note write carries both notes: a Work On
 * saved offline must still reach the server after a Went Beyond saved behind
 * it (Nov 3 bug sweep, Database changes, group 1).
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
const RUBRIC = '55555555-5555-4555-8555-555555555555';
const CRIT = '66666666-6666-4666-8666-666666666661';
const TAG = '77777777-7777-4777-8777-777777777777';

describe('single-point rubric notes in the outbox', () => {
  let fake, originalGetSupabase, originalUseSupabase;
  const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'rubrics', 'students'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    _serverState = {};
    saveStudents(CID, [{ id: ENR, firstName: 'Ada', lastName: 'Lovelace' }]);
    saveRubrics(CID, [
      { id: RUBRIC, name: 'Lab', style: 'single_point', criteria: [{ id: CRIT, name: 'Graph', tagIds: [TAG] }] },
    ]);
    saveAssessments(CID, [
      { id: AID, title: 'Lab', date: '2026-10-03', type: 'summative', tagIds: [TAG], rubricId: RUBRIC },
    ]);
    saveScores(CID, {
      [ENR]: [{ id: 'e1', assessmentId: AID, tagId: CRIT, score: 3, date: '2026-10-03', type: 'summative', note: '' }],
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

  it('sends Work On and Went Beyond when both are saved offline', async () => {
    saveRubricCriterionComment(CID, ENR, AID, CRIT, 'Label the axes.');
    saveRubricCriterionBeyond(CID, ENR, AID, CRIT, 'Added a trend line.');
    setOnline(true);
    await window.v2Queue.flush();
    await settle();

    const sent = fake.committed.filter(c => c.name === 'upsert_rubric_score').map(c => c.params);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      p_criterion_id: CRIT,
      p_value: 3,
      p_comment: 'Label the axes.',
      p_beyond: 'Added a trend line.',
    });
  });

  it('keeps the server note when the other one is empty here', async () => {
    saveRubricCriterionBeyond(CID, ENR, AID, CRIT, 'Added a trend line.');
    setOnline(true);
    await window.v2Queue.flush();
    await settle();

    const sent = fake.committed.filter(c => c.name === 'upsert_rubric_score').map(c => c.params);
    expect(sent).toHaveLength(1);
    expect(sent[0].p_beyond).toBe('Added a trend line.');
    expect(sent[0].p_comment).toBeNull();
  });
});
