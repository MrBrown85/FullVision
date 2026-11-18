/**
 * Demo Mode starts with the student features on for the sample class however
 * it is entered (shared/data-demo.js, applyDemoStudentPage), so Bulletins has
 * something to show. A visitor's own change sticks, and Reset Demo Data turns
 * them on again.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const KEY = 'gb-demo-student-page';
let wasDemo;

function seedDemo(mark) {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  if (mark) localStorage.setItem(KEY, mark);
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
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
});

describe('Demo Mode and the student features', () => {
  beforeEach(() => seedDemo());

  it('turns them on with no marker at all, however Demo Mode was entered', () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(applyDemoStudentPage()).toBe(true);
    expect(getReturnSettings(CID).student_page).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('on');
  });

  it('turns on all five, once', () => {
    expect(applyDemoStudentPage()).toBe(true);
    expect(getReturnSettings(CID).student_page).toBe(true);
    expect(getReturnSettings(CID).return_grades).toBe('on_return');
    expect(getCourseSendWork(CID).send_work).toBe(true);
    expect(getCourseConfig(CID).reflect_on_feedback).toBe(true);
    expect(getCourseConfig(CID).show_my_learning).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('on');

    // The visitor's own change sticks: a second call does nothing.
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { show_my_learning: false }));
    expect(applyDemoStudentPage()).toBe(false);
    expect(getCourseConfig(CID).show_my_learning).toBe(false);
  });

  it('does nothing outside Demo Mode', () => {
    localStorage.setItem(KEY, 'pending');
    window.isDemoMode = () => false;
    expect(applyDemoStudentPage()).toBe(false);
    expect(getReturnSettings(CID).student_page).toBe(false);
  });
});

/* The front page's Demo Mode turns Send Work on after the sample class is
   seeded, and the sample drafts are made only while Send Work is on. The
   first load must already have them, so the Dashboard's To Grade, the
   Inbox and Assignments agree from the start (D9, 5g). */
describe('the first load', () => {
  it('has the sample drafts, so To Grade is the same on the first load as on the next', async () => {
    seedDemo();
    await window.loadSeedIfNeeded();
    const ids = getStudents(CID).map(s => s.id);
    const first = GraderWork.classWorkCounts(CID, ids);
    expect(getCourseSendWork(CID).send_work).toBe(true);
    // Maya and Liv's Light Refraction Lab are drafts: to return, not to grade.
    expect(first).toMatchObject({ tograde: 4, toreturn: 2 });
    // The next load (seedIfNeeded again) changes nothing.
    seedIfNeeded();
    expect(GraderWork.classWorkCounts(CID, ids)).toMatchObject({ tograde: first.tograde, toreturn: first.toreturn });
  });
});
