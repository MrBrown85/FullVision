/**
 * An undo puts no score back under Missing or Excused (Nov 3 bug sweep,
 * review of the missing-lock fix). Score a level, clear it, mark the work
 * Missing, undo: the level stays off, so the cell's M has nothing hidden
 * under it for getTagScores to count. Desktop gradebook and phone.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';

const CID = 'course-undo';

beforeEach(() => {
  localStorage.clear();
  _cache.assessments[CID] = undefined;
  _cache.scores[CID] = undefined;
  _cache.statuses[CID] = undefined;
  saveAssessments(CID, [{ id: 'a1', title: 'Lab', date: '2026-10-10', type: 'summative', tagIds: ['t1'] }]);
  saveScores(CID, {});
  clearProfCache();
});

const level = () => ((getScores(CID).s1 || []).find(e => e.assessmentId === 'a1' && e.tagId === 't1') || {}).score;

describe('the phone undo on Missing work', () => {
  it('score, clear, Missing, undo: no level comes back', () => {
    MGrade.setScore(CID, 's1', 'a1', 't1', 3);
    MGrade.setScore(CID, 's1', 'a1', 't1', 3); // tapping the level again clears it
    expect(level()).toBe(0);
    expect(setAssignmentStatus(CID, 's1', 'a1', 'NS')).toBe(true);
    MGrade.undoLastScore();
    expect(level() || 0).toBe(0);
    clearProfCache();
    expect(getTagScores(CID, 's1', 't1')).toEqual([]);
  });

  it('still puts the level back when the work has no status', () => {
    MGrade.setScore(CID, 's1', 'a1', 't1', 3);
    MGrade.setScore(CID, 's1', 'a1', 't1', 3);
    MGrade.undoLastScore();
    expect(level()).toBe(3);
  });
});

describe('the gradebook Cmd+Z on Missing work', () => {
  it('skips an entry with a score when the cell is locked', () => {
    const src = readFileSync('teacher/page-gradebook.js', 'utf-8');
    expect(src).toContain('var undoLocked = isScoreLocked(undo.cid, undo.sid, undo.aid);');
    expect(src).toContain('if (prevEntry && undoLocked && isScoreEntered(undoAssess, prevEntry)) prevEntry = null;');
  });
});
