/**
 * Generate's notice on an approved comment named a piece as "marked after"
 * the approval when nothing was re-marked: #885 changed how a rubric
 * piece's % is worked out, so its % in the approval's record no longer
 * matched though its mark was the same (step 4 batch).
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'stale-remark';

describe('changedPieces names only work that was marked', () => {
  afterEach(() => delete _cache.assessments[CID]);

  it('leaves out a rubric or proficiency piece whose mark is the same and only its % moved', () => {
    _cache.assessments[CID] = [
      { id: 'lab', title: 'Pendulum Lab Report', rubricId: 'r1' },
      { id: 'quiz', title: 'Unit Quiz', scoreMode: 'points', maxPoints: 20 },
      { id: 'essay', title: 'Essay' },
    ];
    const was = {
      'work:lab': { t: 'Pendulum Lab Report', m: '3|75|75' },
      'work:quiz': { t: 'Unit Quiz', m: '3|80|80' },
      'work:essay': { t: 'Essay', m: '2|50|50' },
    };
    const now = {
      'work:lab': { t: 'Pendulum Lab Report', m: '3|78|78' },
      'work:quiz': { t: 'Unit Quiz', m: '3|85|85' },
      'work:essay': { t: 'Essay', m: '3|75|75' },
    };
    // The quiz's points changed (its % is its mark) and the essay was
    // re-marked; the lab's % was only worked out again.
    expect(CommentBank.changedPieces(was, now, CID)).toEqual(['Unit Quiz', 'Essay']);
    // Without the class, every difference counts, as before.
    expect(CommentBank.changedPieces(was, now)).toEqual(['Pendulum Lab Report', 'Unit Quiz', 'Essay']);
  });

  it('still names a piece newly marked or no longer Missing', () => {
    _cache.assessments[CID] = [{ id: 'lab', title: 'Pendulum Lab Report', rubricId: 'r1' }];
    expect(
      CommentBank.changedPieces({ 'missing:Pendulum Lab Report': { t: 'Pendulum Lab Report', m: 'NS' } }, {
        'work:lab': { t: 'Pendulum Lab Report', m: '3|75|75' },
      }, CID),
    ).toEqual(['Pendulum Lab Report']);
  });
});
