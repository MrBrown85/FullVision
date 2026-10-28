/**
 * Competency comments and comment-only scores (grader plan PR 12,
 * migrations/20261027_score_comments.sql): tag_score.comment travels in the
 * class bundle and on upsert_tag_score, a comment saves with no level, and
 * an entry with no level never counts as a 0.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const TAG_1 = '88888888-8888-4888-8888-888888888888';
const TAG_2 = '99999999-9999-4999-8999-999999999999';

function seedClass() {
  saveStudents(CID, [{ id: SID, firstName: 'Ada', lastName: 'Lovelace' }]);
  saveAssessments(CID, [
    { id: AID, title: 'Levels lab', date: '2026-10-03', type: 'summative', tagIds: [TAG_1, TAG_2], rubricId: '' },
  ]);
  saveScores(CID, {
    [SID]: [{ id: 'e1', assessmentId: AID, tagId: TAG_1, score: 3, date: '2026-10-03', type: 'summative', note: '' }],
  });
}

describe('competency comments', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'students'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    seedClass();
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    client = {
      calls: [],
      rpc(name, payload) {
        client.calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  const tagCalls = () => client.calls.filter(c => c.name === 'upsert_tag_score');

  it('saves a comment on a scored competency with its level', () => {
    saveTagComment(CID, SID, AID, TAG_1, 'Strong data table.');
    expect(getTagComment(CID, SID, AID, TAG_1)).toBe('Strong data table.');
    const calls = tagCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({ p_tag_id: TAG_1, p_value: 3, p_comment: 'Strong data table.' });
  });

  it('saves a comment on an unscored competency with no level', () => {
    saveTagComment(CID, SID, AID, TAG_2, 'Add units.');
    const calls = tagCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({ p_tag_id: TAG_2, p_value: null, p_comment: 'Add units.' });
  });

  it('sends the saved comment with a later level change', () => {
    saveTagComment(CID, SID, AID, TAG_2, 'Add units.');
    upsertScore(CID, SID, AID, TAG_2, 2, '2026-10-03', 'summative', '');
    const calls = tagCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].payload).toMatchObject({ p_value: 2, p_comment: 'Add units.' });
  });

  it('reads the comment from the class bundle tag_rows sixth element', () => {
    const cells = _bundleCells({
      students: [{ enrollment_id: SID }],
      assessments: [{ id: AID }],
      tag_index: [TAG_1],
      criterion_index: [],
      score_rows: [],
      tag_rows: [[0, 0, 0, null, 0, 'Comment only']],
      criterion_rows: [],
    });
    expect(cells[SID][AID].tag_scores[0]).toEqual({ tag_id: TAG_1, value: null, modifier: 0, comment: 'Comment only' });
    const entry = _scoreEntryFromCanonical(CID, getAssessments(CID)[0], TAG_1, null, '', 0, 'Comment only');
    expect(entry.score).toBe(0);
    expect(entry.critNote).toBe('Comment only');
  });

  it('an entry with no level is unscored, not a 0, in the assessment score', () => {
    clearProfCache();
    expect(getAssessmentOverallScore(CID, SID, AID)).toBe(3);
    saveTagComment(CID, SID, AID, TAG_2, 'Add units.');
    clearProfCache();
    expect(getAssessmentOverallScore(CID, SID, AID)).toBe(3);
    upsertScore(CID, SID, AID, TAG_2, 3, '2026-10-03', 'summative', '');
    upsertScore(CID, SID, AID, TAG_2, 0, '2026-10-03', 'summative', '');
    clearProfCache();
    expect(getAssessmentOverallScore(CID, SID, AID)).toBe(3);
  });
});
