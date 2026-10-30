/**
 * assessmentCellValue (shared/calc.js): what one gradebook cell holds. The
 * Scores view draws it and the printed grade sheet prints it, so the two
 * cannot drift. Each case below is what the Scores view showed for that
 * kind of cell before the logic moved out of teacher/page-gradebook.js.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-cell';
const SID = 'stu-1';

const points = (id, max, extra) =>
  Object.assign({ id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [], type: 'summative' }, extra);
const level = (id, tagIds, extra) =>
  Object.assign({ id, title: id, scoreMode: 'proficiency', tagIds, type: 'summative' }, extra);
const complete = id => ({ id, title: id, scoreMode: 'complete', maxPoints: 1, tagIds: [], type: 'summative' });

function seed({ assessments, entries = [], statuses = {}, config = {}, rubrics = [], gradingSystem = 'proficiency' }) {
  COURSES[CID] = { id: CID, name: 'Cell Class', gradingSystem };
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: entries };
  _cache.statuses[CID] = statuses;
  _cache.courseConfigs[CID] = config;
  _cache.rubrics[CID] = rubrics;
  clearProfCache();
}

beforeEach(() => {
  localStorage.clear();
});

describe('assessmentCellValue', () => {
  it('prints points as points, with the level band for the colour', () => {
    const a = points('quiz', 20);
    seed({ assessments: [a], entries: [{ assessmentId: 'quiz', tagId: 'overall', score: 17 }] });
    const cell = assessmentCellValue(CID, SID, a);
    expect(cell.kind).toBe('points');
    expect(cell.text).toBe('17');
    expect(cell.value).toBe(17);
    expect(cell.level).toBe(pointsToProf(17, 20, getGradingScale(CID)));
    expect(cell.outOfRange).toBe(false);
  });

  it('keeps a points 0 as a score', () => {
    const a = points('quiz', 20);
    seed({ assessments: [a], entries: [{ assessmentId: 'quiz', tagId: 'overall', score: 0 }] });
    const cell = assessmentCellValue(CID, SID, a);
    expect(cell.kind).toBe('points');
    expect(cell.text).toBe('0');
  });

  it('flags extra credit past twice the maximum', () => {
    const a = points('quiz', 10);
    seed({ assessments: [a], entries: [{ assessmentId: 'quiz', tagId: 'overall', score: 25 }] });
    expect(assessmentCellValue(CID, SID, a).outOfRange).toBe(true);
  });

  it('averages a level across competencies with the ± and formats it for the class', () => {
    const a = level('lab', ['T1', 'T2']);
    seed({
      assessments: [a],
      entries: [
        { assessmentId: 'lab', tagId: 'T1', score: 3, mod: 1 },
        { assessmentId: 'lab', tagId: 'T2', score: 3, mod: 1 },
      ],
    });
    const cell = assessmentCellValue(CID, SID, a);
    expect(cell.kind).toBe('level');
    expect(cell.level).toBe(3);
    expect(cell.text).toBe(formatLevel(CID, 3 + 1 / 3));
    expect(cell.text).toBe('3.3');
  });

  it('follows a Letter class: the level prints as a %', () => {
    const a = level('lab', ['T1']);
    seed({ assessments: [a], entries: [{ assessmentId: 'lab', tagId: 'T1', score: 3 }], gradingSystem: 'letter' });
    expect(assessmentCellValue(CID, SID, a).text).toBe('75%');
  });

  it('counts a rubric criterion once at its weight', () => {
    const rubric = {
      id: 'rub',
      name: 'Lab',
      criteria: [
        { id: 'c1', name: 'Inquiry', tagIds: ['T1'], weight: 1 },
        { id: 'c2', name: 'Writing', tagIds: ['T2'], weight: 1 },
      ],
    };
    const a = level('rlab', ['T1', 'T2'], { rubricId: 'rub' });
    seed({
      assessments: [a],
      rubrics: [rubric],
      entries: [
        { assessmentId: 'rlab', tagId: 'T1', score: 4 },
        { assessmentId: 'rlab', tagId: 'T2', score: 2 },
      ],
    });
    const cell = assessmentCellValue(CID, SID, a);
    expect(cell.kind).toBe('level');
    expect(cell.value).toBe(getRubricAssessmentScore(CID, a, _cache.scores[CID][SID]));
    expect(cell.text).toBe('3.0');
  });

  it('shows Complete and Incomplete as marks', () => {
    const a = complete('hw');
    seed({ assessments: [a], entries: [{ assessmentId: 'hw', tagId: 'overall', score: 1 }] });
    expect(assessmentCellValue(CID, SID, a)).toMatchObject({ kind: 'complete', mark: 'complete', text: '✓' });
    seed({ assessments: [a], entries: [{ assessmentId: 'hw', tagId: 'overall', score: 0 }] });
    expect(assessmentCellValue(CID, SID, a)).toMatchObject({ kind: 'complete', mark: 'incomplete', text: '✗' });
  });

  it('replaces the score with NS or EXC', () => {
    const a = points('quiz', 20);
    seed({
      assessments: [a],
      entries: [{ assessmentId: 'quiz', tagId: 'overall', score: 12 }],
      statuses: { [SID + ':quiz']: 'NS' },
    });
    expect(assessmentCellValue(CID, SID, a)).toMatchObject({ kind: 'status', status: 'NS', text: 'M' });
    seed({ assessments: [a], statuses: { [SID + ':quiz']: 'EXC' } });
    expect(assessmentCellValue(CID, SID, a)).toMatchObject({ kind: 'status', status: 'EXC', text: 'EXC' });
  });

  it('keeps a late score and marks it late', () => {
    const a = points('quiz', 20);
    seed({
      assessments: [a],
      entries: [{ assessmentId: 'quiz', tagId: 'overall', score: 15 }],
      statuses: { [SID + ':quiz']: 'LATE' },
    });
    expect(assessmentCellValue(CID, SID, a)).toMatchObject({ kind: 'points', text: '15', late: true });
  });

  it('leaves an empty cell past its due date empty: only a Missing label makes work missing', () => {
    const a = level('lab', ['T1'], { dueDate: '2026-10-01' });
    seed({ assessments: [a], config: { missingPolicy: 'zero' } });
    expect(assessmentCellValue(CID, SID, a)).toMatchObject({ kind: 'none', text: '—', level: 0 });
    const p = points('quiz', 20, { dueDate: '2026-10-01' });
    seed({ assessments: [p] });
    expect(assessmentCellValue(CID, SID, p)).toMatchObject({ kind: 'none', text: '—' });
  });

  it('shows labelled Missing as M before and after the due date', () => {
    const early = level('lab', ['T1'], { dueDate: '2099-11-01' });
    seed({ assessments: [early], statuses: { [SID + ':lab']: 'NS' } });
    expect(assessmentCellValue(CID, SID, early)).toMatchObject({ kind: 'status', status: 'NS', text: 'M' });
    const late = level('lab', ['T1'], { dueDate: '2026-10-01' });
    seed({ assessments: [late], statuses: { [SID + ':lab']: 'NS' } });
    expect(assessmentCellValue(CID, SID, late)).toMatchObject({ kind: 'status', status: 'NS', text: 'M' });
  });

  it('prints a dash for work not yet scored or not yet due', () => {
    const a = level('lab', ['T1'], { dueDate: '2026-11-01' });
    seed({ assessments: [a] });
    expect(assessmentCellValue(CID, SID, a)).toMatchObject({ kind: 'none', text: '—', level: 0 });
  });
});
