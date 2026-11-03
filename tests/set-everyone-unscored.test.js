/**
 * Set Everyone To overwrote scores already entered (Nov 3 bug sweep, Step 4,
 * group 1), and on the rubric grid painted the fill on students marked
 * Missing, who looked scored. Colin (2026-11-03, DECISIONS "Set Everyone
 * To"): it sets only cells with no score yet, a rubric criterion at a time,
 * and leaves out Missing and Excused students. _setEveryonePlan
 * (teacher/page-assignments.js) picks those cells and the dialog's counts.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

const CID = 'set-everyone';

function plan(aid) {
  const src = readFileSync('teacher/page-assignments.js', 'utf-8');
  const fn = src.match(/ {2}function _setEveryonePlan\([^)]*\) \{[\s\S]*?\n {2}\}\n/);
  expect(fn, '_setEveryonePlan in page-assignments.js').toBeTruthy();
  // eslint-disable-next-line no-new-func
  return new Function(fn[0] + '\nreturn _setEveryonePlan;')()(CID, aid);
}

beforeEach(() => {
  ['students', 'assessments', 'scores', 'statuses', 'rubrics'].forEach(function (field) {
    if (_cache[field]) _cache[field][CID] = undefined;
  });
  localStorage.clear();
  saveStudents(CID, [
    { id: 'ann', firstName: 'Ann', lastName: 'A' },
    { id: 'ben', firstName: 'Ben', lastName: 'B' },
    { id: 'cy', firstName: 'Cy', lastName: 'C' },
    { id: 'dee', firstName: 'Dee', lastName: 'D' },
  ]);
  saveRubrics(CID, [
    {
      id: 'rub',
      name: 'Lab Rubric',
      criteria: [
        { id: 'hyp', name: 'Hypothesis', tagIds: ['t1'] },
        { id: 'data', name: 'Data', tagIds: ['t2'] },
      ],
    },
  ]);
  saveAssessments(CID, [
    { id: 'lab', title: 'Lab', date: '2026-10-31', type: 'summative', tagIds: ['t1', 't2'], rubricId: 'rub' },
    { id: 'quiz', title: 'Quiz', date: '2026-10-31', type: 'summative', tagIds: ['t1'] },
  ]);
  saveScores(CID, {});
});

describe('Set Everyone To', () => {
  it('sets only the rubric criteria with no score yet', () => {
    upsertScore(CID, 'ann', 'lab', 'hyp', 2, '2026-10-31', 'summative');
    const p = plan('lab');
    const cells = p.cells.map(c => c.sid + ':' + c.keys.join(','));
    expect(cells).toEqual(['ann:data', 'ben:hyp', 'ben:data', 'cy:hyp', 'cy:data', 'dee:hyp', 'dee:data']);
    expect(p.scored).toBe(1);
    expect(p.students).toBe(4);
  });

  it('leaves out Missing and Excused students but not Late ones', () => {
    setAssignmentStatus(CID, 'ben', 'lab', 'NS');
    setAssignmentStatus(CID, 'cy', 'lab', 'EXC');
    setAssignmentStatus(CID, 'dee', 'lab', 'LATE');
    const p = plan('lab');
    expect(p.locked).toBe(2);
    expect([...new Set(p.cells.map(c => c.sid))]).toEqual(['ann', 'dee']);
  });

  it('counts one cell per student on work with one competency', () => {
    upsertScore(CID, 'cy', 'quiz', 't1', 3, '2026-10-31', 'summative');
    const p = plan('quiz');
    expect(p.perStudent).toBe(1);
    expect(p.rubric).toBe(false);
    expect(p.cells.map(c => c.sid)).toEqual(['ann', 'ben', 'dee']);
  });
});
