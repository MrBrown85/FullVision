/**
 * Every screen shows grades the way the class is set to grade
 * (shared/calc.js): Proficiency shows levels out of 4, Letter shows the
 * letter grade and %, Both shows both. A competency's level shows as a %
 * by level ÷ 4.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'f0000000-0000-4000-8000-000000000001';

describe('grades shown by grading setting', () => {
  var originalOverall;
  var originalLetter;
  var overall;
  var letter;

  beforeEach(() => {
    originalOverall = globalThis.getOverallProficiency;
    originalLetter = globalThis.getCourseLetterData;
    overall = { s1: 2.8, s2: 3.4, s3: 0 };
    letter = { s1: { S: 'B', R: 78.9 }, s2: { S: 'A', R: 91 }, s3: { S: null, R: null } };
    globalThis.getOverallProficiency = function (cid, sid) {
      return overall[sid] || 0;
    };
    globalThis.getCourseLetterData = function (cid, sid) {
      return letter[sid];
    };
    if (typeof COURSES === 'undefined') globalThis.COURSES = {};
  });

  afterEach(() => {
    globalThis.getOverallProficiency = originalOverall;
    globalThis.getCourseLetterData = originalLetter;
    delete COURSES[CID];
  });

  function setting(gradingSystem) {
    COURSES[CID] = { id: CID, name: 'Philosophy 12', gradingSystem: gradingSystem };
  }

  it('reads the class setting, Proficiency by default', () => {
    expect(courseGradeMode(CID)).toBe('proficiency');
    setting('letter');
    expect(courseGradeMode(CID)).toBe('letter');
    setting('both');
    expect(courseGradeMode(CID)).toBe('both');
  });

  it('shows a competency level as a level, a %, or both', () => {
    setting('proficiency');
    expect(formatLevel(CID, 2.8)).toBe('2.8');
    setting('letter');
    expect(formatLevel(CID, 2.8)).toBe('70%');
    setting('both');
    expect(formatLevel(CID, 2.8)).toBe('2.8 · 70%');
    expect(formatLevel(CID, 0)).toBe('—');
  });

  it("shows a student's overall grade as the class grades", () => {
    setting('proficiency');
    expect(studentGradeSummary(CID, 's1')).toEqual({ text: '2.8', level: 3 });
    setting('letter');
    expect(studentGradeSummary(CID, 's1')).toEqual({ text: 'B 78.9%', level: 3 });
    setting('both');
    expect(studentGradeSummary(CID, 's1')).toEqual({ text: '2.8 · B 78.9%', level: 3 });
    expect(studentGradeSummary(CID, 's3').text).toBe('');
  });

  it('colours a letter grade by its band', () => {
    setting('letter');
    expect(studentGradeSummary(CID, 's2').level).toBe(4);
    letter.s2 = { S: 'C', R: 62 };
    expect(studentGradeSummary(CID, 's2').level).toBe(2);
  });

  it('drops the proficiency word in a Letter class', () => {
    setting('letter');
    expect(levelWord(CID, 2.8)).toBe('');
    setting('both');
    expect(levelWord(CID, 2.8)).toBe(PROF_LABELS[3]);
  });

  it('averages the class the same way', () => {
    setting('proficiency');
    expect(classGradeSummary(CID, ['s1', 's2', 's3']).text).toBe('3.1');
    setting('letter');
    // (78.9 + 91) / 2 = 84.95, shown to one decimal as 85%, a B.
    expect(classGradeSummary(CID, ['s1', 's2', 's3']).text).toBe('B 85%');
  });
});
