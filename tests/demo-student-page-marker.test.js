/**
 * The front page's Try Demo Mode link starts Demo Mode with the student
 * features on for the sample class (shared/data.js, applyDemoStudentPage).
 * Demo Mode started any other way leaves them off.
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

  it('leaves them off when the front page did not start it', () => {
    expect(applyDemoStudentPage()).toBe(false);
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(getReturnSettings(CID).return_grades).not.toBe('on_return');
    expect(getCourseSendWork(CID).send_work).toBe(false);
    expect(getCourseConfig(CID).reflect_on_feedback).not.toBe(true);
    expect(getCourseConfig(CID).show_my_learning).not.toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('turns on all five when the front page started it, once', () => {
    localStorage.setItem(KEY, 'pending');
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
