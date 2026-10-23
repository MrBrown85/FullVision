/**
 * Rubric Bank class stats (teacher/rubric-bank.js): per criterion, one level
 * per student per assessment; excused students left out; a custom-criteria
 * rubric also counts each student's overall level. Teacher only.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'cls-bank-stats';
const A1 = 'as-1';
const A2 = 'as-2';
const S1 = 'st-1';
const S2 = 'st-2';
const S3 = 'st-3';

function entry(aid, tagId, score, mod) {
  return { assessmentId: aid, tagId: tagId, score: score, mod: mod || 0, type: 'summative', note: '' };
}

beforeEach(() => {
  localStorage.clear();
  ['scores', 'assessments', 'rubrics', 'students', 'statuses'].forEach(function (field) {
    if (_cache[field]) delete _cache[field][CID];
  });
  saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
  saveStudents(CID, [
    { id: S1, firstName: 'Ada', lastName: 'A' },
    { id: S2, firstName: 'Ben', lastName: 'B' },
    { id: S3, firstName: 'Cy', lastName: 'C' },
  ]);
  saveRubrics(CID, [
    {
      id: 'r-comp',
      name: 'Lab',
      criteria: [{ id: 'c-inq', name: 'Inquiry', tagIds: ['t1', 't2'], levels: { 4: '', 3: '', 2: '', 1: '' } }],
    },
    {
      id: 'r-custom',
      name: 'Talk',
      criteria: [
        { id: 'c-content', name: 'Content', tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' } },
        { id: 'c-voice', name: 'Delivery', tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' } },
      ],
    },
  ]);
  saveAssessments(CID, [
    { id: A1, title: 'Lab 1', date: '2026-09-10', type: 'summative', tagIds: ['t1', 't2'], rubricId: 'r-comp' },
    { id: A2, title: 'Lab 2', date: '2026-10-10', type: 'summative', tagIds: ['t1', 't2'], rubricId: 'r-comp' },
    { id: 'as-talk', title: 'Talks', date: '2026-10-12', type: 'summative', tagIds: [], rubricId: 'r-custom' },
  ]);
  saveScores(CID, {
    // A criterion linked to two competencies counts once.
    [S1]: [entry(A1, 't1', 3, 1), entry(A1, 't2', 3, 1), entry(A2, 't1', 4), entry(A2, 't2', 4)],
    [S2]: [entry(A1, 't1', 2), entry(A1, 't2', 2), entry('as-talk', 'c-content', 4), entry('as-talk', 'c-voice', 3)],
    [S3]: [entry(A1, 't1', 1), entry(A1, 't2', 1), entry('as-talk', 'c-content', 2), entry('as-talk', 'c-voice', 2)],
  });
});

describe('Rubric Bank class stats', () => {
  it('counts one level per student per assessment, ignoring + and −', () => {
    var s = RubricBank.classStats(CID, getRubricById(CID, 'r-comp'));
    expect(s.assessments).toBe(2);
    expect(s.scores).toBe(4);
    expect(s.byCrit['c-inq']).toEqual({ 4: 1, 3: 1, 2: 1, 1: 1 });
    expect(s.custom).toBe(false);
    expect(s.overallCount).toBe(0);
  });

  it('narrows to one assessment', () => {
    var s = RubricBank.classStats(CID, getRubricById(CID, 'r-comp'), A2);
    expect(s.assessments).toBe(1);
    expect(s.byCrit['c-inq']).toEqual({ 4: 1, 3: 0, 2: 0, 1: 0 });
  });

  it('leaves excused students out', () => {
    setAssignmentStatus(CID, S3, A1, 'EXC');
    var s = RubricBank.classStats(CID, getRubricById(CID, 'r-comp'), A1);
    expect(s.byCrit['c-inq']).toEqual({ 4: 0, 3: 1, 2: 1, 1: 0 });
  });

  it('counts overall levels for a custom-criteria rubric', () => {
    var r = getRubricById(CID, 'r-custom');
    expect(RubricBank.isCustomCriteria(r)).toBe(true);
    expect(RubricBank.isCustomCriteria(getRubricById(CID, 'r-comp'))).toBe(false);
    var s = RubricBank.classStats(CID, r);
    expect(s.custom).toBe(true);
    expect(s.overallCount).toBe(2);
    expect(s.overall[2]).toBe(1);
    expect(s.overall[4] + s.overall[3]).toBe(1);
  });

  it('draws the pie and its label in the class level order, skipping empty levels', () => {
    var counts = { 4: 1, 3: 3, 2: 0, 1: 0 };
    expect(RubricBank.pieBackground(CID, counts)).toBe(
      'conic-gradient(var(--score-4) 0.00% 25.00%, var(--score-3) 25.00% 100.00%)',
    );
    expect(RubricBank.countsText(CID, counts)).toBe('Extending 1, Proficient 3, Developing 0, Emerging 0');
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { levelOrder: 'asc' }));
    expect(RubricBank.countsText(CID, counts)).toBe('Emerging 0, Developing 0, Proficient 3, Extending 1');
    expect(RubricBank.pieBackground(CID, { 4: 0, 3: 0, 2: 0, 1: 0 })).toBe('');
  });
});
