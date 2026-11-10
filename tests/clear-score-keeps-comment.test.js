/**
 * Clear Score clears the score, not the Overall Comment, the Note for the
 * Report or a Missing / Late mark (Nov 3 bug sweep). The gradebook's Clear
 * Score keeps the two notes in the cache (clearScoreEntries), and
 * migrations/20261103_clear_score_keeps_comment.sql makes the server's
 * clear_score keep the score row that holds them instead of deleting it.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const CID = 'course-clear';
const prof = { id: 'lv', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1', 'T2'], date: '2026-10-10' };
const pts = { id: 'qz', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };
const entry = (aid, tagId, score, extra) => ({ assessmentId: aid, tagId, score, date: '2026-10-10', ...extra });

function seed(scores) {
  _cache.assessments[CID] = [prof, pts];
  _cache.scores[CID] = scores;
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

describe('clearScoreEntries', () => {
  beforeEach(() => localStorage.clear());

  it('clears every level and keeps the Overall Comment and Note for the Report', () => {
    const notes = { note: 'Clear diagram.', reportNote: 'labelled every part' };
    seed({ s1: [entry('lv', 'T1', 3, notes), entry('lv', 'T2', 4, notes), entry('qz', 'T1', 8)] });
    const scores = clearScoreEntries(CID, getScores(CID), 's1', prof, ['T1', 'T2']);
    const left = scores.s1.filter(e => e.assessmentId === 'lv');
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ tagId: 'T1', score: 0, note: 'Clear diagram.', reportNote: 'labelled every part' });
    expect(getScoreComment(CID, 's1', 'lv')).toBe('Clear diagram.');
    expect(getScoreReportNote(CID, 's1', 'lv')).toBe('labelled every part');
    // Other work is untouched.
    expect(scores.s1.find(e => e.assessmentId === 'qz').score).toBe(8);
  });

  it('keeps a Note for the Report alone, with no score, on points work', () => {
    seed({ s1: [entry('qz', 'T1', 8, { note: '', reportNote: 'showed all steps' })] });
    const scores = clearScoreEntries(CID, getScores(CID), 's1', pts, ['T1']);
    expect(scores.s1).toHaveLength(1);
    expect(scores.s1[0].score).toBeNull();
    expect(getPointsScore(CID, 's1', 'qz')).toBeNull();
    expect(getScoreReportNote(CID, 's1', 'qz')).toBe('showed all steps');
  });

  it('leaves nothing when the cell had only a score', () => {
    seed({ s1: [entry('lv', 'T1', 3, { note: '' }), entry('lv', 'T2', 2, { note: '' })] });
    const scores = clearScoreEntries(CID, getScores(CID), 's1', prof, ['T1', 'T2']);
    expect(scores.s1).toEqual([]);
  });
});

describe('the gradebook and the server agree', () => {
  it('Clear Score in the gradebook goes through clearScoreEntries', () => {
    // Through the grader's Clear Score since S1-T1 (shared/grader.js).
    const src = readFileSync('teacher/page-gradebook.js', 'utf-8');
    expect(src).toContain('Grader.clearScore(cid, scores, sid, assess, clearIds);');
    const grader = readFileSync('shared/grader.js', 'utf-8');
    expect(grader).toContain('clearScoreEntries(cid, scores, sid, assessment, keys);');
  });

  const sql = readFileSync('migrations/20261103_clear_score_keeps_comment.sql', 'utf-8');

  it('clear_score keeps a score row with a status, a comment or a Note for the Report', () => {
    expect(sql).toMatch(
      /status is not null\s+or nullif\(btrim\(comment\), ''\) is not null\s+or report_note is not null\s+into _id, _old_v, _old_s, _keep/,
    );
    expect(sql).toMatch(
      /if _keep then\s+update score set value = null, modifier = 0, updated_at = now\(\) where id = _id;\s+else\s+delete from score where id = _id;/,
    );
    // No delete of the score row by enrollment and assessment is left.
    expect(sql).not.toMatch(/delete from score\s+where enrollment_id/);
  });

  it('still clears the rubric and competency levels and writes the audit row', () => {
    expect(sql).toContain('perform _score_audit_diff(_id, _old_v, null, _old_s, _old_s);');
    expect(sql).toMatch(
      /delete from rubric_score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;/,
    );
    expect(sql).toMatch(
      /delete from tag_score\s+where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;/,
    );
  });
});
