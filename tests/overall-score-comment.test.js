/**
 * The overall comment on a piece of work (score.comment, cached as `note`
 * on the student's score entries). The Assignments Comment button shows
 * and edits it through getScoreComment / saveScoreComment.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const SID2 = '44444444-4444-4444-8444-444444444444';
const TAG_1 = '88888888-8888-4888-8888-888888888888';
const TAG_2 = '99999999-9999-4999-8999-999999999999';

function seedClass() {
  saveStudents(CID, [
    { id: SID, firstName: 'Ada', lastName: 'Lovelace' },
    { id: SID2, firstName: 'Alan', lastName: 'Turing' },
  ]);
  saveAssessments(CID, [
    { id: AID, title: 'Levels lab', date: '2026-10-03', type: 'summative', tagIds: [TAG_1, TAG_2], rubricId: '' },
  ]);
  saveScores(CID, {
    [SID]: [
      { id: 'e1', assessmentId: AID, tagId: TAG_1, score: 3, date: '2026-10-03', type: 'summative', note: 'Good lab.' },
      { id: 'e2', assessmentId: AID, tagId: TAG_2, score: 2, date: '2026-10-03', type: 'summative', note: 'Good lab.' },
    ],
  });
}

describe('overall comment', () => {
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

  const commentCalls = () => client.calls.filter(c => c.name === 'save_score_comment');

  it('reads the note on the student’s score', () => {
    expect(getScoreComment(CID, SID, AID)).toBe('Good lab.');
    expect(getScoreComment(CID, SID2, AID)).toBe('');
  });

  it('saves an edit to every entry and sends save_score_comment', () => {
    saveScoreComment(CID, SID, AID, '  Label the axes.  ');
    expect(getScoreComment(CID, SID, AID)).toBe('Label the axes.');
    getScores(CID)[SID].forEach(function (e) {
      expect(e.note).toBe('Label the axes.');
    });
    expect(commentCalls()).toHaveLength(1);
    expect(commentCalls()[0].payload).toEqual({
      p_enrollment_id: SID,
      p_assessment_id: AID,
      p_comment: 'Label the axes.',
    });
  });

  it('clears the comment with an empty string', () => {
    saveScoreComment(CID, SID, AID, '');
    expect(getScoreComment(CID, SID, AID)).toBe('');
    expect(commentCalls()[0].payload.p_comment).toBe('');
  });

  it('does nothing when the text is unchanged', () => {
    saveScoreComment(CID, SID, AID, 'Good lab.');
    expect(commentCalls()).toHaveLength(0);
  });

  it('writes nothing for work with no score entry', () => {
    expect(saveScoreComment(CID, SID2, AID, 'Hello')).toBe(false);
    expect(commentCalls()).toHaveLength(0);
  });
});
