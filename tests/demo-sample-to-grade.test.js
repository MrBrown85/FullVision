/**
 * Demo Mode's piece with work waiting (ruling 115, "Add one piece"): Light
 * Refraction Lab in Science 8 (shared/seed-data.js), read as it is seeded.
 *
 * - The piece: its date, due date, rubric, pair and Students Send.
 * - The work: six students sent, one late, one with two pages and a note,
 *   one for his pair.
 * - The drafts: Maya's and Liv's work is a draft only once the class holds
 *   grades (the build switch on, When I Return Them) and Demo Mode opens
 *   again. Each is an Overall Comment with no level. Never in a class that
 *   does not hold grades, never over a teacher's grading, made once.
 * - The counts, all from GraderWork: To Grade 4 with the pair once, To
 *   Return 2, Not In 20; the class's To Grade is the piece's.
 * - No existing grade moves: every student's grades with the drafts made
 *   are their grades without them (the golden grades file pins the rest).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LIGHT = 'sci8a21';
let wasDemo;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

// The build switch (When I Return Them) and Send Work on, as Class Settings turns them on.
function turnOn() {
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
}
// ...then Demo Mode opened again.
function turnOnAndReopen() {
  turnOn();
  seedIfNeeded();
}

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
  clearProfCache();
});
beforeEach(() => seedDemo());

describe('the piece and its work', () => {
  it('is a lab taking photos, due two days after its date, with one pair sending as a group', () => {
    const a = getAssessments(CID).find(x => x.id === LIGHT);
    expect(a.title).toBe('Light Refraction Lab');
    expect(a.rubricId).toBe('rub_sci8_lab');
    expect(Date.parse(a.dueDate) - Date.parse(a.date)).toBe(2 * 86400000);
    expect(a.collaboration).toBe('pair');
    expect(a.pairs).toEqual([['st16', 'st17']]);
    expect(getAssessmentStudentWork(CID, LIGHT)).toMatchObject({ students_send: 'photos', group_work: 'group' });
    // Send Work starts off, as for every class.
    expect(getCourseSendWork(CID).send_work).toBe(false);
  });

  it('has six students’ work in: one late, one with two pages and a note, one for his pair', () => {
    const subs = getCourseSubmissions(CID).submissions.filter(s => s.assessment_id === LIGHT);
    expect(subs.map(s => s.enrollment_id).sort()).toEqual(['st11', 'st12', 'st14', 'st16', 'st19', 'st20']);
    const a = getAssessments(CID).find(x => x.id === LIGHT);
    subs.forEach(s => expect(s.is_late).toBe(s.sent_at.slice(0, 10) > a.dueDate));
    expect(subs.filter(s => s.is_late).map(s => s.enrollment_id)).toEqual(['st12']);
    const sofia = getStudentSubmission(CID, 'st14', LIGHT);
    expect(sofia.files).toHaveLength(2);
    expect(sofia.note).toBe('My answers are on page 2.');
    expect(subs.filter(s => s.note).length).toBe(1);
    // Olivia sent nothing; Aiden's work is the pair's.
    expect(getStudentSubmission(CID, 'st17', LIGHT)).toBeNull();
    expect(groupWorkIn(CID, 'st17', LIGHT)).toBe(true);
  });

  it('has no grade on it for anyone, as seeded', () => {
    getStudents(CID).forEach(s => expect(studentWorkGradingStarted(CID, s.id, LIGHT), s.id).toBe(false));
    expect(GradeState.draftsWaiting(CID)).toBe(0);
  });
});

describe('the two drafts', () => {
  it('are not made while the class does not hold grades, Demo Mode opened again or not', () => {
    seedIfNeeded();
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    setStudentPageSwitch(CID, true, 'on_save');
    seedIfNeeded();
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    // Nor written as a returned comment: Maya and Liv have nothing on it.
    expect(getScoreComment(CID, 'st19', LIGHT)).toBe('');
    expect(getScoreComment(CID, 'st20', LIGHT)).toBe('');
  });

  it('are not made while Send Work is off, the class holding grades or not', () => {
    setStudentPageSwitch(CID, true, 'on_return');
    seedIfNeeded();
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    expect(getScoreComment(CID, 'st19', LIGHT)).toBe('');
  });

  it('are made once the class holds grades: an Overall Comment each, no level', () => {
    turnOnAndReopen();
    expect(
      GradeState.draftsIn(
        CID,
        LIGHT,
        getStudents(CID).map(s => s.id),
      ),
    ).toEqual(['st19', 'st20']);
    expect(GradeState.draftsWaiting(CID)).toBe(2);
    expect(getScoreComment(CID, 'st19', LIGHT)).toBe(
      'Clear diagram and a full table. Say why the ray bends, not just that it does.',
    );
    expect(getAssessmentOverallScore(CID, 'st19', LIGHT)).toBeFalsy();
    expect(getAssessmentOverallScore(CID, 'st20', LIGHT)).toBeFalsy();
    // Opened again: nothing more is made.
    const scores = JSON.stringify(getScores(CID));
    seedIfNeeded();
    expect(JSON.stringify(getScores(CID))).toBe(scores);
  });

  it('are never made over a teacher’s grading', () => {
    turnOn();
    Grader.setOverallComment(CID, 'st19', LIGHT, 'My own words.');
    seedIfNeeded();
    expect(getScoreComment(CID, 'st19', LIGHT)).toBe('My own words.');
    expect(GradeState.draftsIn(CID, LIGHT, ['st19', 'st20'])).toEqual(['st19', 'st20']);
  });

  it('move no grade: every student’s grades are what they were without them', () => {
    const grades = () =>
      getStudents(CID).map(s => [s.id, getOverallProficiency(CID, s.id), getCourseLetterData(CID, s.id)]);
    turnOn();
    clearProfCache();
    const before = JSON.stringify(grades());
    seedIfNeeded();
    expect(GradeState.draftsWaiting(CID)).toBe(2);
    clearProfCache();
    expect(JSON.stringify(grades())).toBe(before);
  });
});

describe('the counts, from GraderWork', () => {
  it('Send Work off: nothing to grade, to return or not in', () => {
    setStudentPageSwitch(CID, true, 'on_return');
    seedIfNeeded();
    const c = GraderWork.workCounts(CID, LIGHT);
    expect([c.tograde, c.toreturn, c.notin]).toEqual([0, 0, 0]);
  });

  it('on: To Grade 4 with the pair once, To Return 2, Not In 20, and the class’s To Grade is the piece’s', () => {
    turnOnAndReopen();
    const c = GraderWork.workCounts(CID, LIGHT);
    expect([c.tograde, c.toreturn, c.returned, c.notin, c.all, c.groups]).toEqual([4, 2, 0, 20, 27, 1]);
    expect(c.ids.tograde).toEqual(['st11', 'st12', 'st14', 'st16', 'st17']);
    expect(c.ids.toreturn).toEqual(['st19', 'st20']);
    // The longest waiting is Ines's, the first sent.
    expect(c.oldest).toBe(getStudentSubmission(CID, 'st11', LIGHT).sent_at);
    const all = GraderWork.classWorkCounts(CID);
    expect([all.tograde, all.toreturn, all.groups]).toEqual([4, 2, 1]);
    expect(all.pieces.find(p => p.aid === LIGHT)).toEqual({ aid: LIGHT, tograde: 4, toreturn: 2, notin: 20 });
    // Every other piece has nothing to grade or to return.
    all.pieces.filter(p => p.aid !== LIGHT).forEach(p => expect([p.tograde, p.toreturn], p.aid).toEqual([0, 0]));
  });
});
