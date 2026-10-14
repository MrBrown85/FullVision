/**
 * Assessments linked to no curricular competency (requested 2026-10-14).
 * Their score is kept under UNLINKED_TAG_ID locally and sent as the
 * assessment's single score (upsert_score). It counts toward the assessment,
 * never toward a competency.
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
const TAG = '77777777-7777-4777-8777-777777777777';

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
}

describe('scoreTagIds', () => {
  it('uses the competencies, or the one unlinked key when there are none', () => {
    expect(scoreTagIds({ tagIds: [TAG] })).toEqual([TAG]);
    expect(scoreTagIds({ tagIds: [] })).toEqual([UNLINKED_TAG_ID]);
    expect(scoreTagIds({})).toEqual([UNLINKED_TAG_ID]);
    expect(isUnlinkedTag('')).toBe(true);
  });
});

describe('unlinked assessments', () => {
  var fake, originalGetSupabase, originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (field) {
      if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
        _cache[field] = {};
      }
    });
    _assessmentSaveQueue = {};
    _serverState = {};
    _idRekeys = {};
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('creates an assessment with no competencies', async () => {
    seed('assessments', []);
    saveAssessments(CID, [{ id: 'sLOCALUNLINKED', title: 'Reading log', type: 'summative', tagIds: [] }]);
    await settle();
    expect(fake.committedCount('create_assessment', p => p.p_title === 'Reading log' && !p.p_tag_ids.length)).toBe(1);
  });

  it('sends a proficiency score as the assessment score, and a clear as no score', async () => {
    seed('assessments', [{ id: AID, title: 'Reading log', type: 'summative', tagIds: [] }]);
    seed('scores', {});
    upsertScore(CID, ENR, AID, UNLINKED_TAG_ID, 3, '2026-10-14', 'summative', '');
    await settle();
    expect(fake.committedCount('upsert_score', p => p.p_assessment_id === AID && p.p_value === 3)).toBe(1);
    expect(fake.count('upsert_tag_score')).toBe(0);

    upsertScore(CID, ENR, AID, UNLINKED_TAG_ID, 0, '2026-10-14', 'summative', '');
    await settle();
    expect(fake.committedCount('upsert_score', p => p.p_assessment_id === AID && p.p_value === null)).toBe(1);
  });

  it('stores and sends a points score', async () => {
    seed('assessments', [
      { id: AID, title: 'Quiz', type: 'summative', tagIds: [], scoreMode: 'points', maxPoints: 10 },
    ]);
    seed('scores', {});
    setPointsScore(CID, ENR, AID, 7.5);
    expect(getPointsScore(CID, ENR, AID)).toBe(7.5);
    await settle();
    expect(fake.committedCount('upsert_score', p => p.p_value === 7.5)).toBe(1);
  });

  it('sends Incomplete as 0', async () => {
    seed('assessments', [
      { id: AID, title: 'Homework', type: 'summative', tagIds: [], scoreMode: 'complete', maxPoints: 1 },
    ]);
    seed('scores', {});
    setCompletionMark(CID, ENR, AID, 'incomplete');
    expect(getCompletionMark(CID, ENR, AID)).toBe('incomplete');
    await settle();
    expect(fake.committedCount('upsert_score', p => p.p_value === 0)).toBe(1);
  });

  it('counts toward the assessment, never toward a competency', () => {
    seed('assessments', [
      { id: AID, title: 'Reading log', type: 'summative', tagIds: [] },
      { id: 'linked', title: 'Lab', type: 'summative', tagIds: [TAG] },
    ]);
    seed('scores', {
      [ENR]: [
        { assessmentId: AID, tagId: UNLINKED_TAG_ID, score: 1, date: '2026-10-14' },
        { assessmentId: 'linked', tagId: TAG, score: 4, date: '2026-10-10' },
      ],
    });
    _cache.statuses[CID] = {};
    clearProfCache();
    expect(getAssessmentOverallScore(CID, ENR, AID)).toBe(1);
    expect(getTagScores(CID, ENR, TAG).map(s => s.assessmentId)).toEqual(['linked']);
  });
});
