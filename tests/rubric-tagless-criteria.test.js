/**
 * Rubric criteria linked to no curricular competency (requested 2026-10-15).
 * Their score is kept under the criterion's own id locally and sent as a
 * rubric score (upsert_rubric_score). It counts toward the assessment and the
 * course grade, never toward a competency.
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
const LINKED_CRIT = '66666666-6666-4666-8666-666666666661';
const TAGLESS_CRIT = '66666666-6666-4666-8666-666666666662';
const TAG = '77777777-7777-4777-8777-777777777777';
const SEC = 'sec-1';

const rubric = {
  id: RUBRIC,
  name: 'Lab report',
  criteria: [
    { id: LINKED_CRIT, name: 'Analysis', tagIds: [TAG], levels: {} },
    { id: TAGLESS_CRIT, name: 'Neatness', tagIds: [], levels: {} },
  ],
};

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
}

function resetCache() {
  localStorage.clear();
  Object.keys(_cache).forEach(function (field) {
    if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
      _cache[field] = {};
    }
  });
}

describe('score keys for a rubric criterion with no competency', () => {
  beforeEach(() => {
    resetCache();
    seed('rubrics', [rubric]);
  });

  it('uses the criterion id when the criterion has no competency', () => {
    expect(rubricCriterionScoreKeys(rubric.criteria[0])).toEqual([TAG]);
    expect(rubricCriterionScoreKeys(rubric.criteria[1])).toEqual([TAGLESS_CRIT]);
  });

  it('adds the criterion id to the assessment competencies', () => {
    const a = { id: AID, rubricId: RUBRIC, tagIds: [TAG] };
    expect(scoreTagIds(a, CID)).toEqual([TAG, TAGLESS_CRIT]);
    // Without the course the rubric can't be found: competencies only.
    expect(scoreTagIds(a)).toEqual([TAG]);
  });

  it('uses criterion ids, not the unlinked key, when no criterion has a competency', () => {
    seed('rubrics', [{ id: RUBRIC, name: 'Effort', criteria: [{ id: TAGLESS_CRIT, name: 'Effort', tagIds: [] }] }]);
    expect(scoreTagIds({ id: AID, rubricId: RUBRIC, tagIds: [] }, CID)).toEqual([TAGLESS_CRIT]);
  });

  it('ignores the rubric on a points assessment', () => {
    const a = { id: AID, rubricId: RUBRIC, tagIds: [], scoreMode: 'points', maxPoints: 10 };
    expect(scoreTagIds(a, CID)).toEqual([UNLINKED_TAG_ID]);
  });

  it('labels the criterion column with the criterion name', () => {
    const info = scoreKeyInfo(CID, { id: AID, rubricId: RUBRIC, tagIds: [TAG] }, TAGLESS_CRIT);
    expect(info.label).toBe('Neatness');
    expect(info.tag).toBeUndefined();
  });
});

describe('grades with a rubric criterion that has no competency', () => {
  beforeEach(() => {
    resetCache();
    seed('rubrics', [rubric]);
    seed('assessments', [{ id: AID, title: 'Lab', type: 'summative', rubricId: RUBRIC, tagIds: [TAG] }]);
    seed('learningMaps', { sections: [{ id: SEC, name: 'Analysis', tags: [{ id: TAG, label: 'Analyze' }] }] });
    seed('courseConfigs', { calcMethod: 'mostRecent', decayWeight: 0.65 });
    _cache.statuses[CID] = {};
  });

  function scoreWith(entries) {
    seed('scores', { [ENR]: entries });
    clearProfCache();
  }

  it('counts toward the assessment and course grade, not the competency', () => {
    scoreWith([{ assessmentId: AID, tagId: TAG, score: 4, date: '2026-10-15' }]);
    expect(getAssessmentOverallScore(CID, ENR, AID)).toBe(4);
    expect(getCourseLetterData(CID, ENR).Q).toBe(4);
    expect(getSectionProficiency(CID, ENR, SEC)).toBe(4);

    scoreWith([
      { assessmentId: AID, tagId: TAG, score: 4, date: '2026-10-15' },
      { assessmentId: AID, tagId: TAGLESS_CRIT, score: 2, date: '2026-10-15' },
    ]);
    expect(getAssessmentOverallScore(CID, ENR, AID)).toBe(3);
    expect(getCourseLetterData(CID, ENR).Q).toBe(3);
    expect(getSectionProficiency(CID, ENR, SEC)).toBe(4);
    expect(getTagScores(CID, ENR, TAG).map(s => s.score)).toEqual([4]);
  });

  it('weights the criterion and uses its level values like any other', () => {
    seed('rubrics', [
      {
        id: RUBRIC,
        name: 'Lab report',
        criteria: [
          { id: LINKED_CRIT, name: 'Analysis', tagIds: [TAG], weight: 1 },
          { id: TAGLESS_CRIT, name: 'Neatness', tagIds: [], weight: 3, levelValues: { 2: 2.5 } },
        ],
      },
    ]);
    scoreWith([
      { assessmentId: AID, tagId: TAG, score: 4, date: '2026-10-15' },
      { assessmentId: AID, tagId: TAGLESS_CRIT, score: 2, date: '2026-10-15' },
    ]);
    // (1 × 4 + 3 × 2.5) / 4 — unweighted at the plain level it would be 3.
    expect(getAssessmentOverallScore(CID, ENR, AID)).toBeCloseTo(2.875, 5);
    expect(getCourseLetterData(CID, ENR).Q).toBeCloseTo(2.875, 5);
    expect(getSectionProficiency(CID, ENR, SEC)).toBe(4);
    expect(getTagScores(CID, ENR, TAG).map(s => s.score)).toEqual([4]);
  });

  it('does not also count a leftover overall score', () => {
    seed('rubrics', [{ id: RUBRIC, name: 'Effort', criteria: [{ id: TAGLESS_CRIT, name: 'Effort', tagIds: [] }] }]);
    seed('assessments', [{ id: AID, title: 'Effort', type: 'summative', rubricId: RUBRIC, tagIds: [] }]);
    scoreWith([
      { assessmentId: AID, tagId: TAGLESS_CRIT, score: 3, date: '2026-10-15' },
      { assessmentId: AID, tagId: UNLINKED_TAG_ID, score: 1, date: '2026-10-14' },
    ]);
    expect(getAssessmentOverallScore(CID, ENR, AID)).toBe(3);
  });
});

describe('saving a rubric criterion score with no competency', () => {
  var fake, originalGetSupabase, originalUseSupabase;

  beforeEach(() => {
    resetCache();
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

  it('sends a rubric score for the criterion', async () => {
    seed('rubrics', [rubric]);
    seed('assessments', [{ id: AID, title: 'Lab', type: 'summative', rubricId: RUBRIC, tagIds: [TAG] }]);
    seed('scores', {});
    upsertScore(CID, ENR, AID, TAGLESS_CRIT, 3, '2026-10-15', 'summative', '');
    await settle();
    const sent = fake.committedCount('upsert_rubric_score', p => p.p_criterion_id === TAGLESS_CRIT && p.p_value === 3);
    expect(sent).toBe(1);
    expect(fake.count('upsert_score')).toBe(0);
    expect(fake.count('upsert_tag_score')).toBe(0);
  });
});
