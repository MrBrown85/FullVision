/**
 * The phone card's growth line (studentGrowthLine): where a student's work
 * started and where it is now, in the grade the class shows first. Step 4
 * sweep group 2 #37: the line compared the first and last single scores in
 * proficiency words, so a C+ 70% student read "Extending → Extending" and a
 * Letter class showed proficiency words.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-growth';
const A = 'stu-a';
const TAG = 'tag-1';

const points = (id, max, date) => ({ id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [TAG], date });
const level = (id, date) => ({ id, title: id, tagIds: [TAG], type: 'summative', date });
const score = (assessmentId, value, date) => ({ assessmentId, tagId: TAG, score: value, mod: 0, date });

function seed({ gradingSystem, assessments, scores, statuses }) {
  COURSES[CID] = { id: CID, name: 'Science 10', gradingSystem };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = scores;
  _cache.statuses[CID] = statuses || {};
  _cache.rubrics[CID] = [];
  _cache.courseConfigs[CID] = { roundPercent: true };
  clearProfCache();
}

describe('studentGrowthLine', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    delete COURSES[CID];
  });

  it('reads a Letter class in % from each piece, Missing as 0, not in proficiency words', () => {
    const work = [
      points('q1', 20, '2026-09-08'),
      points('q2', 20, '2026-09-10'),
      points('q3', 20, '2026-10-28'),
      points('q4', 20, '2026-10-30'),
    ];
    seed({
      gradingSystem: 'letter',
      assessments: work,
      // 19/20 and 17/20 early; 16/20 and a Missing late.
      scores: {
        [A]: [score('q1', 19, '2026-09-08'), score('q2', 17, '2026-09-10'), score('q3', 16, '2026-10-28')],
      },
      statuses: { [A + ':q4']: 'NS' },
    });
    const g = studentGrowthLine(CID, A, [TAG]);
    expect(g.startText).toBe('90%');
    expect(g.nowText).toBe('40%');
    expect(g.change).toBe('−50%');
    expect(g.dir).toBe(-1);
    expect(g.count).toBe(4);
    expect(g.nowText).not.toMatch(/Extending|Proficient|Developing|Emerging/);
  });

  it('averages the first and last weeks, so one late score does not decide it', () => {
    const work = [
      level('a', '2026-09-08'),
      level('b', '2026-09-10'),
      level('c', '2026-10-27'),
      level('d', '2026-10-28'),
      level('e', '2026-10-30'),
    ];
    seed({
      gradingSystem: 'proficiency',
      assessments: work,
      scores: {
        [A]: [
          score('a', 4, '2026-09-08'),
          score('b', 4, '2026-09-10'),
          score('c', 4, '2026-10-27'),
          score('d', 4, '2026-10-28'),
          score('e', 2, '2026-10-30'),
        ],
      },
    });
    const g = studentGrowthLine(CID, A, [TAG]);
    // The first single score (4) against the last (2) read Extending ↓ Developing.
    expect(g.startText).toBe('4.0 Extending');
    expect(g.nowText).toBe('3.3 Proficient');
    expect(g.change).toBe('−0.7');
    expect(g.dir).toBe(-1);
  });

  it('shows only where it is now when the work spans under two weeks', () => {
    seed({
      gradingSystem: 'proficiency',
      assessments: [level('a', '2026-10-01'), level('b', '2026-10-05')],
      scores: { [A]: [score('a', 3, '2026-10-01'), score('b', 2, '2026-10-05')] },
    });
    const g = studentGrowthLine(CID, A, [TAG]);
    expect(g.startText).toBeNull();
    expect(g.nowText).toBe('2.5 Proficient');
    expect(g.count).toBe(2);
  });

  it('is null with no work', () => {
    seed({ gradingSystem: 'letter', assessments: [points('q1', 20, '2026-10-01')], scores: {} });
    expect(studentGrowthLine(CID, A, [TAG])).toBeNull();
  });
});
